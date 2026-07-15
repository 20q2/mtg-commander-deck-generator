import type { ScryfallCard, Customization, ThemeResult, EDHRECCommanderStats, EDHRECCombo } from '@/types';
import { fetchCommanderData, fetchPartnerCommanderData, fetchCommanderCombos, fetchColorIdentityCombos, fetchCommanderThemeData, fetchPartnerThemeData } from '@/services/edhrec/client';
import { getCardsByNames, getGameChangerNames, getArenaLegalNames, getMtgCatalogs } from '@/services/scryfall/client';
import { calculateTypeTargets, calculateCurveTargets } from '@/services/deckBuilder/curveUtils';
import { getDynamicRoleTargets, estimatePacingFromStats } from '@/services/deckBuilder/roleTargets';
import { getCardRole, getCardSubtype, loadTaggerData } from '@/services/tagger/client';
import { loadTagIndex, loadTagDictionary, tagsForOracleId, allTags } from '@/services/spellchroma/tagIndex';
import { isIgnoredTag } from '@/services/spellchroma/ignoredTags';
import { computeThemeCharTags } from './chromaTags';
import { payoffRank } from './combos';
import { bannedNameSet } from './banned';
import { classifyTheme, type ThemeKind } from './themeKind';
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

  const [edhrecData, combos, gameChangerNames, colorCombos] = await Promise.all([
    partnerCommander
      ? fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption, bracketLevel)
      : fetchCommanderData(commander.name, budgetOption, bracketLevel),
    fetchCommanderCombos(commander.name).catch(() => [] as EDHRECCombo[]),
    getGameChangerNames().catch(() => new Set<string>()),
    // Color-identity combos broaden combo-piece knowledge for the combo pack + tagging. Best-effort:
    // a failure just narrows comboPieceNames to the commander's own combos.
    fetchColorIdentityCombos(args.colorIdentity).catch(() => [] as EDHRECCombo[]),
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

  // The player's exclude list — a banned card must never enter the pool (so it can't be offered in a
  // pack, hidden as a windfall, or surfaced by discovery). Mirrors the deck generator's banned filter.
  const banned = bannedNameSet(customization);

  const candidates: BrewCandidate[] = [];
  const seen = new Set<string>();
  for (const e of edhrecData.cardlists.allNonLand) {
    if (seen.has(e.name)) continue;
    if (banned.has(e.name)) continue;
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

  // Classify each theme as a real MTG mechanic, a tribe, or a strategy archetype, from Scryfall's own
  // catalogs. Deterministic kinds (mechanic/tribal/curated) get a literal card-property gate in
  // clusterBundles; archetypes keep the statistical tag-lift gate. Best-effort — a failed catalog fetch
  // leaves themeKinds undefined and every theme falls back to archetype (today's behavior).
  let themeKinds: Record<string, ThemeKind> | undefined;
  try {
    const { mechanics, creatureTypes, permanentSubtypes } = await getMtgCatalogs();
    if (mechanics.size > 0 || creatureTypes.size > 0) {
      themeKinds = {};
      for (const [slug, name] of Object.entries(themeNames)) {
        themeKinds[slug] = classifyTheme(name, mechanics, creatureTypes, permanentSubtypes);
      }
    }
  } catch {
    // Catalogs unavailable → leave themeKinds undefined (all-archetype fallback).
  }

  // Mechanical tags (SpellChroma index): stamp each candidate with its oracle-derived tags, then
  // derive each theme's CHARACTERISTIC tags by pool-local lift. Best-effort — a failed fetch leaves
  // chromaTags empty and themeCharTags undefined, and every consumer falls back to today's behavior.
  let themeCharTags: Record<string, string[]> | undefined;
  let chromaTagLabels: Record<string, string> | undefined;
  try {
    args.onProgress?.('Reading the cards…', 85);
    const ok = await loadTagIndex();           // also loads the dictionary (decodes tag ids)
    await loadTagDictionary();
    if (ok) {
      for (const c of candidates) {
        const oid = c.scryfall.oracle_id;
        c.chromaTags = oid ? tagsForOracleId(oid).filter(t => !isIgnoredTag(t)) : [];
      }
      themeCharTags = computeThemeCharTags(candidates, Object.keys(themeNames));
      const labels: Record<string, string> = {};
      for (const e of allTags()) labels[e.s] = e.l;
      chromaTagLabels = labels;
    }
  } catch {
    // Index unavailable — leave chromaTags empty / themeCharTags undefined (graceful degrade).
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

  // Combo-piece oracle across commander AND color combos (comboPieceCounts above stays commander-only
  // for the "glue" scoring bump). Names + DFC front faces so either form matches a pool card later.
  const comboPieceNames = new Set<string>();
  const comboPiecePayoff: Record<string, number> = {};
  for (const combo of [...combos, ...colorCombos]) {
    const rank = payoffRank(combo.results);
    for (const { name } of combo.cards) {
      const record = (n: string) => {
        comboPieceNames.add(n);
        comboPiecePayoff[n] = Math.max(comboPiecePayoff[n] ?? 0, rank);
      };
      record(name);
      if (name.includes(' // ')) record(name.split(' // ')[0]);
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
    comboPieceNames,
    comboPiecePayoff,
    themeNames,
    themeSignatures,
    gameChangerNames,
    themeCharTags,
    chromaTagLabels,
    themeKinds,
  };
}
