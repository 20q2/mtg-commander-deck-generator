import type { ScryfallCard, Customization, ThemeResult, EDHRECCommanderStats, EDHRECCombo } from '@/types';
import { fetchCommanderData, fetchPartnerCommanderData, fetchCommanderCombos, fetchCommanderThemeData, fetchPartnerThemeData } from '@/services/edhrec/client';
import { getCardsByNames } from '@/services/scryfall/client';
import { calculateTypeTargets, calculateCurveTargets } from '@/services/deckBuilder/curveUtils';
import { getDynamicRoleTargets, estimatePacingFromStats } from '@/services/deckBuilder/roleTargets';
import { getCardRole, getCardSubtype, loadTaggerData } from '@/services/tagger/client';
import type { BrewContext, BrewCandidate } from './brewTypes';

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

  const [edhrecData, combos] = await Promise.all([
    partnerCommander
      ? fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption, bracketLevel)
      : fetchCommanderData(commander.name, budgetOption, bracketLevel),
    fetchCommanderCombos(commander.name).catch(() => [] as EDHRECCombo[]),
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

  const candidates: BrewCandidate[] = [];
  const seen = new Set<string>();
  for (const e of edhrecData.cardlists.allNonLand) {
    if (seen.has(e.name)) continue;
    const scryfall = cardMap.get(e.name);
    if (!scryfall) continue;
    if (ownedOnly && args.collectionNames && !args.collectionNames.has(e.name)) continue;
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

  // Theme membership: fetch each selected theme's card list and tag candidates that appear on it.
  // This is the honest "identity" signal — a card belongs to Tokens because EDHREC's Tokens page lists it.
  const themeNames: Record<string, string> = {};
  const selected = (args.selectedThemes ?? []).filter(t => t.isSelected && t.slug);
  if (selected.length > 0) {
    args.onProgress?.('Reading your themes…', 80);
    const membership = new Map<string, Set<string>>(); // slug -> card names on that theme page
    await Promise.all(selected.map(async (t) => {
      const slug = t.slug!;
      themeNames[slug] = t.name;
      try {
        const data = partnerCommander
          ? await fetchPartnerThemeData(commander.name, partnerCommander.name, slug, budgetOption, bracketLevel)
          : await fetchCommanderThemeData(commander.name, slug, budgetOption, bracketLevel);
        membership.set(slug, new Set(data.cardlists.allNonLand.map(c => c.name)));
      } catch {
        membership.set(slug, new Set()); // a theme that won't load just contributes no tags
      }
    }));
    for (const c of candidates) {
      c.themeTags = selected.map(t => t.slug!).filter(slug => membership.get(slug)?.has(c.name));
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
    themeNames,
  };
}
