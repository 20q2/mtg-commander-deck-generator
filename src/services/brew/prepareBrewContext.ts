import type { ScryfallCard, Customization, ThemeResult, EDHRECCommanderStats, EDHRECCombo } from '@/types';
import { fetchCommanderData, fetchPartnerCommanderData, fetchCommanderCombos, fetchCommanderThemeData, fetchPartnerThemeData } from '@/services/edhrec/client';
import { getCardsByNames, getGameChangerNames, getArenaLegalNames } from '@/services/scryfall/client';
import { calculateTypeTargets, calculateCurveTargets } from '@/services/deckBuilder/curveUtils';
import { getDynamicRoleTargets, estimatePacingFromStats } from '@/services/deckBuilder/roleTargets';
import { getCardRole, getCardSubtype, loadTaggerData } from '@/services/tagger/client';
import type { BrewContext, BrewCandidate } from './brewTypes';

// Tag candidates with the commander's top-N themes so the player has lots of directions to lean
// into at the start; the deck's identity then emerges from the cards they actually pick. Each
// theme is one EDHREC fetch at brew start, so this is a deliberate breadth-vs-latency trade.
const THEME_TAG_LIMIT = 8;

export interface PrepareBrewArgs {
  commander: ScryfallCard;
  partnerCommander: ScryfallCard | null;
  colorIdentity: string[];
  customization: Customization;
  selectedThemes?: ThemeResult[];
  collectionNames?: Set<string>;
  onProgress?: (message: string, percent: number) => void;
}

/** Build the immutable brew context: scored candidate pool + role/type/curve targets. */
export async function prepareBrewContext(args: PrepareBrewArgs): Promise<BrewContext> {
  const { commander, partnerCommander, customization } = args;
  args.onProgress?.('Loading card pool…', 10);
  await loadTaggerData();

  const budgetOption = customization.budgetOption !== 'any' ? customization.budgetOption : undefined;
  const bracketLevel = customization.bracketLevel !== 'all' ? customization.bracketLevel : undefined;

  const [edhrecData, combos, gameChangerNames] = await Promise.all([
    partnerCommander
      ? fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption, bracketLevel)
      : fetchCommanderData(commander.name, budgetOption, bracketLevel),
    fetchCommanderCombos(commander.name).catch(() => [] as EDHRECCombo[]),
    getGameChangerNames().catch(() => new Set<string>()),
  ]);

  args.onProgress?.('Resolving cards…', 45);
  const stats: EDHRECCommanderStats | undefined = edhrecData.stats;

  // Target math mirrors generateDeck's calculateTargetCounts inputs.
  const format = customization.deckFormat;
  const commanderCount = partnerCommander ? 2 : 1;
  const deckCards = format === 99 ? (100 - commanderCount) : (format - commanderCount);
  const landTarget = Math.min(Math.max(1, customization.landCount), deckCards - 1);
  const nonLandTarget = deckCards - landTarget;

  const typeTargets = stats
    ? calculateTypeTargets(stats, nonLandTarget)
    : { creature: Math.round(nonLandTarget * 0.5) };
  const pacing = stats?.manaCurve ? estimatePacingFromStats(stats.manaCurve) : 'balanced';
  const curveTargets = stats?.manaCurve ? calculateCurveTargets(stats.manaCurve, nonLandTarget, pacing) : {};
  const roleTargets = getDynamicRoleTargets(format, args.selectedThemes, stats, edhrecData).targets;

  // Resolve Scryfall cards for the EDHREC pool (one batched, cached call).
  const poolNames = edhrecData.cardlists.allNonLand.map(c => c.name);
  args.onProgress?.('Resolving cards…', 60);
  const cardMap = await getCardsByNames(poolNames);

  const ownedOnly = !!(customization.collectionMode
    && customization.collectionStrategy === 'full'
    && args.collectionNames);

  // Arena-only: never OFFER a pick the player couldn't actually run on Arena.
  // Resolved by name across all printings (same source the generator uses), so a
  // card like Counterspell whose default printing isn't on Arena still qualifies.
  const arenaLegalNames = customization.arenaOnly
    ? await getArenaLegalNames(poolNames)
    : null;

  const candidates: BrewCandidate[] = [];
  const seen = new Set<string>();
  for (const e of edhrecData.cardlists.allNonLand) {
    if (seen.has(e.name)) continue;
    const scryfall = cardMap.get(e.name);
    if (!scryfall) continue;
    if (ownedOnly && args.collectionNames && !args.collectionNames.has(e.name)) continue;
    if (arenaLegalNames && !arenaLegalNames.has(e.name)) continue;
    if (scryfall.type_line.toLowerCase().includes('land')) continue; // lands handled at finish/Plan 3
    seen.add(e.name);

    // Stamp the two fields the engine relies on so scoring/health work in production
    // (Plan-1 review #1 + #4). Copy the EDHREC record so we don't mutate the cached pool.
    const edhrec = { ...e, cmc: scryfall.cmc };
    scryfall.isThemeSynergyCard = e.isThemeSynergyCard; // getCardsByNames returns a fresh copy — safe to mutate

    candidates.push({
      name: e.name,
      edhrec,
      scryfall,
      role: getCardRole(e.name),
      subtype: getCardSubtype(e.name),
      inclusion: e.inclusion,
      isLand: false,
      themeTags: [],
    });
  }

  // Theme membership: fetch each of the commander's TOP themes' card lists and tag candidates that
  // appear on them. Broad on purpose — the player isn't asked to pre-pick a theme, so we surface
  // many directions and let the deck's identity emerge from what they take. A card belongs to
  // "Tokens" because EDHREC's Tokens page lists it (the honest identity signal).
  const themeNames: Record<string, string> = {};
  // Signature cards per theme: the theme page's cards ranked by EDHREC synergy (% in theme decks −
  // % overall). High synergy = defines the theme and doesn't just get played in it, so staples
  // (Sol Ring, Dark Ritual) — which have near-zero synergy everywhere — never become a theme's face.
  const themeSignatures: Record<string, string[]> = {};
  const themesToTag = (edhrecData.themes ?? []).filter(t => t.slug).slice(0, THEME_TAG_LIMIT);
  if (themesToTag.length > 0) {
    args.onProgress?.('Mapping the themes…', 80);
    const membership = new Map<string, Set<string>>(); // slug -> card names on that theme page
    await Promise.all(themesToTag.map(async (t) => {
      const slug = t.slug!;
      themeNames[slug] = t.name;
      try {
        const data = partnerCommander
          ? await fetchPartnerThemeData(commander.name, partnerCommander.name, slug, budgetOption, bracketLevel)
          : await fetchCommanderThemeData(commander.name, slug, budgetOption, bracketLevel);
        membership.set(slug, new Set(data.cardlists.allNonLand.map(c => c.name)));
        themeSignatures[slug] = [...data.cardlists.allNonLand]
          .filter(c => typeof c.synergy === 'number')
          .sort((a, b) => (b.synergy ?? 0) - (a.synergy ?? 0))
          .slice(0, 16)
          .map(c => c.name);
      } catch {
        membership.set(slug, new Set()); // a theme that won't load just contributes no tags
      }
    }));
    for (const c of candidates) {
      c.themeTags = themesToTag.map(t => t.slug!).filter(slug => membership.get(slug)?.has(c.name));
    }
  }

  // How many of the commander's known combos each card appears in. ≥2 makes a card "combo glue" —
  // a recurring piece worth flagging (e.g. Isochron Scepter, Dramatic Reversal). DFC front-faces are
  // counted under both the full name and the front face so either form matches a pool card later.
  const comboPieceCounts: Record<string, number> = {};
  for (const combo of combos) {
    for (const { name } of combo.cards) {
      comboPieceCounts[name] = (comboPieceCounts[name] ?? 0) + 1;
      if (name.includes(' // ')) {
        const front = name.split(' // ')[0];
        comboPieceCounts[front] = (comboPieceCounts[front] ?? 0) + 1;
      }
    }
  }

  args.onProgress?.('Shuffling up…', 90);
  return {
    commander,
    partnerCommander,
    colorIdentity: args.colorIdentity,
    customization,
    candidates,
    roleTargets,
    typeTargets,
    curveTargets,
    landTarget,
    nonLandTarget,
    combos,
    comboPieceCounts,
    themeNames,
    themeSignatures,
    gameChangerNames,
  };
}
