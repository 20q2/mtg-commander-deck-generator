import type { ScryfallCard, DeckCategory, DetectedCombo, EDHRECCommanderData, EDHRECCard, GapAnalysisCard, CardEdhrecMeta } from '@/types';
import { loadTaggerData, getCardRole, hasMultipleRoles, getRampSubtype, getRemovalSubtype, getBoardwipeSubtype, getCardDrawSubtype, getProtectionSubtype, type RoleKey } from '@/services/tagger/client';
import { getFrontFaceTypeLine, getGameChangerNames, isChannelLand, isMdfcLand, getCardsByNames } from '@/services/scryfall/client';
import { CHANNEL_LAND_BOOST, MDFC_LAND_BOOST, collectSwapCandidates, mergeThemeCardlists } from './deckGenerator';
import { fetchCommanderData, fetchPartnerCommanderData, fetchCommanderThemeData, fetchPartnerThemeData, fetchTagPageData } from '@/services/edhrec/client';
import { blendArchetypeData, buildArchetypeSourceLabel } from './archetypeBlend';
import { getBaseRoleTargets, getDynamicRoleTargets } from './roleTargets';
import { buildGapAnalysis } from './gapAnalysisBuilder';
import { estimateBracket, type BracketEstimation } from './bracketEstimator';
import { scoreRecommendation, type ScoringContext } from './deckAnalyzer';

const BASIC_LAND_NAMES = new Set([
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest',
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
  'Snow-Covered Mountain', 'Snow-Covered Forest',
  'Wastes',
]);

export interface EnrichResult {
  categories: Record<DeckCategory, ScryfallCard[]>;
  roleCounts: Record<string, number>;
  roleTargets: Record<string, number>;
  rampSubtypeCounts: Record<string, number>;
  removalSubtypeCounts: Record<string, number>;
  boardwipeSubtypeCounts: Record<string, number>;
  cardDrawSubtypeCounts: Record<string, number>;
  protectionSubtypeCounts: Record<string, number>;
  bracketEstimation?: BracketEstimation;
  gameChangerNames?: string[];
  cardInclusionMap?: Record<string, number>;
  cardSynergyMap?: Record<string, number>;
  cardRelevancyMap?: Record<string, number>;
  cardEdhrecMetaMap?: Record<string, CardEdhrecMeta>;
  deckScore?: number;
  gapAnalysis?: GapAnalysisCard[];
  swapCandidates?: Record<string, ScryfallCard[]>;
  edhrecCurve?: Record<number, number>;
  edhrecTypes?: Record<string, number>;
}

export interface TaggerStampResult {
  categories: Record<DeckCategory, ScryfallCard[]>;
  roleCounts: Record<string, number>;
  rampSubtypeCounts: Record<string, number>;
  removalSubtypeCounts: Record<string, number>;
  boardwipeSubtypeCounts: Record<string, number>;
  cardDrawSubtypeCounts: Record<string, number>;
  protectionSubtypeCounts: Record<string, number>;
  bracketEstimation?: BracketEstimation;
  gameChangerNames?: string[];
  gcSet: Set<string> | null;
  cmcSum: number;
  nonLandCount: number;
}

/**
 * Phase B: stamp tagger roles + game changer flags onto cards.
 * Synchronously mutates each card with deckRole / subtypes / isGameChanger.
 */
export async function stampTaggerAndGameChangers(
  cards: ScryfallCard[],
  detectedCombos?: DetectedCombo[],
): Promise<TaggerStampResult> {
  await loadTaggerData();

  const categories: Record<DeckCategory, ScryfallCard[]> = {
    lands: [], ramp: [], cardDraw: [], singleRemoval: [],
    boardWipes: [], protection: [], creatures: [], synergy: [], utility: [],
  };
  const roleCounts: Record<string, number> = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0, protection: 0 };
  const rampSubtypeCounts: Record<string, number> = { 'mana-producer': 0, 'mana-rock': 0, 'cost-reducer': 0, ramp: 0 };
  const removalSubtypeCounts: Record<string, number> = { bounce: 0, 'spot-removal': 0, removal: 0 };
  const boardwipeSubtypeCounts: Record<string, number> = { 'bounce-wipe': 0, boardwipe: 0 };
  const cardDrawSubtypeCounts: Record<string, number> = { tutor: 0, wheel: 0, cantrip: 0, 'card-draw': 0, 'card-advantage': 0 };
  const protectionSubtypeCounts: Record<string, number> = { counterspell: 0, protection: 0 };

  const ROLE_TO_CATEGORY: Record<string, DeckCategory> = {
    ramp: 'ramp', removal: 'singleRemoval', boardwipe: 'boardWipes', cardDraw: 'cardDraw', protection: 'protection',
  };

  let cmcSum = 0;
  let nonLandCount = 0;
  let gcSet: Set<string> | null = null;
  try { gcSet = await getGameChangerNames(); } catch { /* non-critical */ }

  for (const card of cards) {
    const typeLine = getFrontFaceTypeLine(card).toLowerCase();
    if (gcSet?.has(card.name)) card.isGameChanger = true;

    const role = getCardRole(card.name);
    if (role) {
      card.deckRole = role;
      card.multiRole = hasMultipleRoles(card.name);
      switch (role) {
        case 'ramp': card.rampSubtype = getRampSubtype(card.name) ?? undefined; break;
        case 'removal': card.removalSubtype = getRemovalSubtype(card.name) ?? undefined; break;
        case 'boardwipe': card.boardwipeSubtype = getBoardwipeSubtype(card.name) ?? undefined; break;
        case 'cardDraw': card.cardDrawSubtype = getCardDrawSubtype(card.name) ?? undefined; break;
        case 'protection': card.protectionSubtype = getProtectionSubtype(card.name) ?? undefined; break;
      }
      if (!typeLine.includes('land')) roleCounts[role]++;
      if (card.rampSubtype) rampSubtypeCounts[card.rampSubtype] = (rampSubtypeCounts[card.rampSubtype] || 0) + 1;
      if (card.removalSubtype) removalSubtypeCounts[card.removalSubtype] = (removalSubtypeCounts[card.removalSubtype] || 0) + 1;
      if (card.boardwipeSubtype) boardwipeSubtypeCounts[card.boardwipeSubtype] = (boardwipeSubtypeCounts[card.boardwipeSubtype] || 0) + 1;
      if (card.cardDrawSubtype) cardDrawSubtypeCounts[card.cardDrawSubtype] = (cardDrawSubtypeCounts[card.cardDrawSubtype] || 0) + 1;
      if (card.protectionSubtype) protectionSubtypeCounts[card.protectionSubtype] = (protectionSubtypeCounts[card.protectionSubtype] || 0) + 1;
    }

    if (!typeLine.includes('land')) {
      cmcSum += card.cmc ?? 0;
      nonLandCount++;
    }

    if (typeLine.includes('land')) categories.lands.push(card);
    else if (typeLine.includes('creature')) categories.creatures.push(card);
    else if (role && ROLE_TO_CATEGORY[role]) categories[ROLE_TO_CATEGORY[role]].push(card);
    else if (typeLine.includes('planeswalker')) categories.utility.push(card);
    else categories.synergy.push(card);
  }

  let bracketEstimation: BracketEstimation | undefined;
  const gameChangerNames = gcSet ? [...gcSet] : undefined;
  if (gcSet) {
    const avgCmc = nonLandCount > 0 ? parseFloat((cmcSum / nonLandCount).toFixed(2)) : 0;
    bracketEstimation = estimateBracket(
      cards.map(c => c.name),
      detectedCombos,
      avgCmc,
      undefined,
      roleCounts,
      gcSet,
    );
  }

  return {
    categories,
    roleCounts,
    rampSubtypeCounts,
    removalSubtypeCounts,
    boardwipeSubtypeCounts,
    cardDrawSubtypeCounts,
    protectionSubtypeCounts,
    bracketEstimation,
    gameChangerNames,
    gcSet,
    cmcSum,
    nonLandCount,
  };
}

export interface EdhrecMapsResult {
  roleTargets: Record<string, number>;
  cardInclusionMap?: Record<string, number>;
  cardSynergyMap?: Record<string, number>;
  cardRelevancyMap?: Record<string, number>;
  cardEdhrecMetaMap?: Record<string, CardEdhrecMeta>;
  deckScore?: number;
  gapAnalysis?: GapAnalysisCard[];
  edhrecCurve?: Record<number, number>;
  edhrecTypes?: Record<string, number>;
  edhrecData?: EDHRECCommanderData;
  scoringCtx?: ScoringContext;
  edhrecCardIndex?: Map<string, EDHRECCard>;
}

/**
 * Phase C: fetch EDHREC commander data + build inclusion / synergy / relevancy maps + gap analysis.
 * Returns scoring context so phase D₂ can score swap candidates without recomputing it.
 */
export async function buildEdhrecMaps(
  taggerResult: TaggerStampResult,
  deckSize: number,
  detectedCombos: DetectedCombo[] | undefined,
  commanderName: string,
  partnerCommanderName: string | undefined,
  themes?: Array<{ name: string; slug: string }>,
): Promise<EdhrecMapsResult> {
  let roleTargets: Record<string, number> = getBaseRoleTargets(deckSize);
  const { categories, roleCounts, rampSubtypeCounts, removalSubtypeCounts, boardwipeSubtypeCounts, cardDrawSubtypeCounts, protectionSubtypeCounts } = taggerResult;

  try {
    let edhrecData: EDHRECCommanderData = partnerCommanderName
      ? await fetchPartnerCommanderData(commanderName, partnerCommanderName)
      : await fetchCommanderData(commanderName);

    // Theme-aware enrichment: when the list has assigned themes, swap the card pool
    // for the blended commander-theme + archetype pool. Stats and role targets keep
    // coming from the base commander page (already fetched above). Fail-open: any
    // fetch failure leaves base-page behavior untouched.
    if (themes && themes.length > 0) {
      const colorIdentity = [...new Set(
        Object.values(taggerResult.categories).flat().flatMap(c => c.color_identity ?? [])
      )];
      const [themeResults, tagResults] = await Promise.all([
        Promise.all(themes.map(t =>
          (partnerCommanderName
            ? fetchPartnerThemeData(commanderName, partnerCommanderName, t.slug)
            : fetchCommanderThemeData(commanderName, t.slug)
          ).catch(() => null)
        )),
        Promise.all(themes.map(t => fetchTagPageData(t.slug, colorIdentity).catch(() => null))),
      ]);
      const validThemes = themeResults.filter((r): r is EDHRECCommanderData => r !== null);
      if (validThemes.length > 0) {
        const merged = mergeThemeCardlists(validThemes);
        const tagPools = tagResults.map((r, i) =>
          r ? { pool: r.cardlists, sourceLabel: buildArchetypeSourceLabel(colorIdentity, themes[i].name, r.potentialDecks) } : null
        );
        if (tagPools.some(Boolean)) {
          const blend = blendArchetypeData(merged.cardlists, tagPools, validThemes[0].stats.numDecks || 0);
          console.log(`[Enricher] Archetype blend: ${blend.overlapCount} overlap, ${blend.injectedCount} injected`);
        }
        edhrecData = { ...edhrecData, cardlists: merged.cardlists };
      }
    }

    const dynamic = getDynamicRoleTargets(deckSize, undefined, edhrecData.stats, edhrecData);
    roleTargets = dynamic.targets;

    const inclusionIndex = new Map<string, number>();
    const synergyIndex = new Map<string, number>();
    for (const c of edhrecData.cardlists.allNonLand) {
      inclusionIndex.set(c.name, c.inclusion);
      synergyIndex.set(c.name, c.synergy ?? 0);
    }
    for (const c of edhrecData.cardlists.lands) {
      if (!BASIC_LAND_NAMES.has(c.name)) {
        inclusionIndex.set(c.name, c.inclusion);
        synergyIndex.set(c.name, c.synergy ?? 0);
      }
    }

    const inclMap: Record<string, number> = {};
    const synMap: Record<string, number> = {};
    let score = 0;
    for (const cards of Object.values(categories)) {
      for (const card of cards) {
        if (BASIC_LAND_NAMES.has(card.name)) continue;
        let incl = inclusionIndex.get(card.name);
        if (incl === undefined && card.name.includes(' // ')) {
          incl = inclusionIndex.get(card.name.split(' // ')[0]);
        }
        const val = incl ?? 0;
        inclMap[card.name] = val;
        score += val;
        let syn = synergyIndex.get(card.name);
        if (syn === undefined && card.name.includes(' // ')) {
          syn = synergyIndex.get(card.name.split(' // ')[0]);
        }
        synMap[card.name] = syn ?? 0;
      }
    }
    for (const c of edhrecData.cardlists.allNonLand) {
      if (!(c.name in inclMap)) inclMap[c.name] = c.inclusion;
      if (!(c.name in synMap)) synMap[c.name] = c.synergy ?? 0;
    }
    for (const c of edhrecData.cardlists.lands) {
      if (BASIC_LAND_NAMES.has(c.name)) continue;
      if (!(c.name in inclMap)) inclMap[c.name] = c.inclusion;
      if (!(c.name in synMap)) synMap[c.name] = c.synergy ?? 0;
    }

    const deckScore = Math.round(score);

    const edhrecCardIndex = new Map<string, EDHRECCard>();
    for (const c of edhrecData.cardlists.allNonLand) edhrecCardIndex.set(c.name, c);
    for (const c of edhrecData.cardlists.lands) {
      if (!BASIC_LAND_NAMES.has(c.name)) edhrecCardIndex.set(c.name, c);
    }

    const roleDeficits = Object.entries(roleTargets).map(([role, target]) => ({
      role, label: role,
      current: roleCounts[role] ?? 0,
      target,
      deficit: Math.max(0, target - (roleCounts[role] ?? 0)),
    }));

    const nonLandForScoring = Object.values(categories).flat()
      .filter(c => !BASIC_LAND_NAMES.has(c.name) && !getFrontFaceTypeLine(c).toLowerCase().includes('land'));
    const actualCurve: Record<number, number> = {};
    for (const c of nonLandForScoring) {
      const cmc = Math.min(Math.floor(c.cmc ?? 0), 7);
      actualCurve[cmc] = (actualCurve[cmc] || 0) + 1;
    }
    const edhrecCurve = edhrecData.stats?.manaCurve || {};
    const curveAnalysis = Object.keys(edhrecCurve).map(Number).map(cmc => ({
      cmc,
      current: actualCurve[cmc] || 0,
      target: edhrecCurve[cmc] || 0,
      delta: (actualCurve[cmc] || 0) - (edhrecCurve[cmc] || 0),
    }));

    const TYPE_KEYS = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker'] as const;
    const actualTypes: Record<string, number> = {};
    for (const c of nonLandForScoring) {
      const t = getFrontFaceTypeLine(c).toLowerCase();
      const type = TYPE_KEYS.find(tp => t.includes(tp)) || 'other';
      actualTypes[type] = (actualTypes[type] || 0) + 1;
    }
    const edhrecTypes = edhrecData.stats?.typeDistribution || {};
    const typeAnalysis = TYPE_KEYS.map(type => ({
      type,
      current: actualTypes[type] || 0,
      target: (edhrecTypes as Record<string, number>)[type] || 0,
      delta: (actualTypes[type] || 0) - ((edhrecTypes as Record<string, number>)[type] || 0),
    }));

    const currentSubtypeCounts: Record<string, number> = {
      ...rampSubtypeCounts, ...removalSubtypeCounts,
      ...boardwipeSubtypeCounts, ...cardDrawSubtypeCounts,
      ...protectionSubtypeCounts,
    };

    const scoringCtx: ScoringContext = {
      roleDeficits, curveAnalysis, typeAnalysis,
      currentSubtypeCounts, detectedCombos, roleCounts,
    };

    const relMap: Record<string, number> = {};
    const metaMap: Record<string, CardEdhrecMeta> = {};
    for (const cards of Object.values(categories)) {
      for (const card of cards) {
        if (BASIC_LAND_NAMES.has(card.name)) continue;
        const ec = edhrecCardIndex.get(card.name)
          ?? (card.name.includes(' // ') ? edhrecCardIndex.get(card.name.split(' // ')[0]) : undefined);
        if (!ec) { relMap[card.name] = 0; continue; }
        metaMap[card.name] = {
          isThemeSynergyCard: ec.isThemeSynergyCard,
          isNewCard: ec.isNewCard,
          primary_type: ec.primary_type,
          cmc: ec.cmc,
          fromArchetype: ec.fromArchetype,
          archetypeOverlap: ec.archetypeOverlap,
          archetypeSource: ec.archetypeSource,
        };
        const role = (card.deckRole as RoleKey) || null;
        const sub = card.rampSubtype || card.removalSubtype || card.boardwipeSubtype || card.cardDrawSubtype || null;
        let cardScore = scoreRecommendation(ec, role, sub, scoringCtx);
        if (isChannelLand(card)) cardScore += CHANNEL_LAND_BOOST;
        else if (isMdfcLand(card)) cardScore += MDFC_LAND_BOOST;
        relMap[card.name] = Math.round(cardScore);
      }
    }

    const deckCardNamesForGap = new Set<string>();
    for (const cards of Object.values(categories)) {
      for (const c of cards) {
        deckCardNamesForGap.add(c.name);
        if (c.name.includes(' // ')) deckCardNamesForGap.add(c.name.split(' // ')[0]);
      }
    }
    if (commanderName) deckCardNamesForGap.add(commanderName);
    if (partnerCommanderName) deckCardNamesForGap.add(partnerCommanderName);

    let gapAnalysis: GapAnalysisCard[] | undefined;
    try {
      gapAnalysis = await buildGapAnalysis({
        edhrecData,
        deckCardNames: deckCardNamesForGap,
      });
    } catch (e) {
      console.warn('[Enricher] Gap analysis build failed:', e);
    }

    // Index gap analysis cards into the relevancy map so consumers (fill drawer,
    // gap UI) can read a relevancy score, not just raw EDHREC inclusion/synergy.
    // Mirrors the equivalent block in deckGenerator.ts.
    if (gapAnalysis) {
      for (const g of gapAnalysis) {
        if (relMap[g.name] !== undefined) continue;
        const pseudoEc: EDHRECCard = {
          name: g.name,
          sanitized: g.name,
          primary_type: g.typeLine.split(' ').find(t =>
            ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land'].includes(t)) || 'Unknown',
          inclusion: g.inclusion,
          num_decks: 0,
          synergy: g.synergy,
          cmc: g.cmc,
        };
        const role = (g.role as RoleKey) || null;
        relMap[g.name] = Math.round(scoreRecommendation(pseudoEc, role, null, scoringCtx));
      }
    }

    return {
      roleTargets,
      cardInclusionMap: inclMap,
      cardSynergyMap: synMap,
      cardRelevancyMap: relMap,
      cardEdhrecMetaMap: metaMap,
      deckScore,
      gapAnalysis,
      edhrecCurve,
      edhrecTypes,
      edhrecData,
      scoringCtx,
      edhrecCardIndex,
    };
  } catch (err) {
    console.warn('[Enricher] Failed to fetch EDHREC data — skipping inclusion/relevancy maps', err);
    return { roleTargets };
  }
}

export interface SwapCandidatesResult {
  swapCandidates?: Record<string, ScryfallCard[]>;
  candidateRelevancyMap?: Record<string, number>;
}

/**
 * Phase D₂: fetch the EDHREC candidate pool from Scryfall + score them.
 * Reuses scoring context from buildEdhrecMaps to avoid recomputing it.
 */
export async function buildSwapCandidates(
  cards: ScryfallCard[],
  taggerResult: TaggerStampResult,
  edhrecResult: EdhrecMapsResult,
  commanderName: string | undefined,
  partnerCommanderName: string | undefined,
): Promise<SwapCandidatesResult> {
  const { edhrecData, scoringCtx, edhrecCardIndex } = edhrecResult;
  if (!edhrecData || !scoringCtx || !edhrecCardIndex) return {};

  try {
    const { categories } = taggerResult;
    const deckNames = new Set<string>();
    for (const cards of Object.values(categories)) {
      for (const c of cards) deckNames.add(c.name);
    }
    if (commanderName) deckNames.add(commanderName);
    if (partnerCommanderName) deckNames.add(partnerCommanderName);

    const candidateNames: string[] = [];
    const seen = new Set<string>();
    for (const c of edhrecData.cardlists.allNonLand) {
      if (deckNames.has(c.name) || seen.has(c.name)) continue;
      seen.add(c.name);
      candidateNames.push(c.name);
    }

    if (candidateNames.length === 0) return {};

    const candidateCardMap = await getCardsByNames(candidateNames);
    const colorIdentity = [...new Set(cards.flatMap(c => c.color_identity ?? []))];
    const swapCandidates = collectSwapCandidates(
      [edhrecData.cardlists.allNonLand],
      candidateCardMap,
      deckNames,
      colorIdentity,
      new Set(),
      null,
      null,
      null,
      undefined,
      'USD',
      false,
      'full',
      15,
      false,
    );

    const candidateRelevancyMap: Record<string, number> = {};
    for (const cards of Object.values(swapCandidates)) {
      for (const candidate of cards) {
        const ec = edhrecCardIndex.get(candidate.name)
          ?? (candidate.name.includes(' // ') ? edhrecCardIndex.get(candidate.name.split(' // ')[0]) : undefined);
        if (!ec) continue;
        const role = (candidate.deckRole as RoleKey) || null;
        const sub = candidate.rampSubtype || candidate.removalSubtype || candidate.boardwipeSubtype || candidate.cardDrawSubtype || null;
        let score = scoreRecommendation(ec, role, sub, scoringCtx);
        if (isChannelLand(candidate)) score += CHANNEL_LAND_BOOST;
        else if (isMdfcLand(candidate)) score += MDFC_LAND_BOOST;
        candidateRelevancyMap[candidate.name] = Math.round(score);
      }
    }

    return { swapCandidates, candidateRelevancyMap };
  } catch (e) {
    console.warn('[Enricher] Swap candidate build failed:', e);
    return {};
  }
}

/**
 * Thin orchestrator that runs all three phases in sequence.
 * Used by existing callers (AnalyzePage, ListDeckView's edit re-enrich).
 */
export async function enrichDeckCards(
  cards: ScryfallCard[],
  deckSize: number,
  detectedCombos?: DetectedCombo[],
  commanderName?: string,
  partnerCommanderName?: string,
  themes?: Array<{ name: string; slug: string }>,
): Promise<EnrichResult> {
  const tagger = await stampTaggerAndGameChangers(cards, detectedCombos);

  let edhrec: EdhrecMapsResult = { roleTargets: getBaseRoleTargets(deckSize) };
  let swaps: SwapCandidatesResult = {};

  if (commanderName) {
    edhrec = await buildEdhrecMaps(tagger, deckSize, detectedCombos, commanderName, partnerCommanderName, themes);
    swaps = await buildSwapCandidates(cards, tagger, edhrec, commanderName, partnerCommanderName);
  }

  const mergedRelevancy = edhrec.cardRelevancyMap
    ? { ...edhrec.cardRelevancyMap, ...(swaps.candidateRelevancyMap ?? {}) }
    : swaps.candidateRelevancyMap;

  return {
    categories: tagger.categories,
    roleCounts: tagger.roleCounts,
    roleTargets: edhrec.roleTargets,
    rampSubtypeCounts: tagger.rampSubtypeCounts,
    removalSubtypeCounts: tagger.removalSubtypeCounts,
    boardwipeSubtypeCounts: tagger.boardwipeSubtypeCounts,
    cardDrawSubtypeCounts: tagger.cardDrawSubtypeCounts,
    protectionSubtypeCounts: tagger.protectionSubtypeCounts,
    bracketEstimation: tagger.bracketEstimation,
    gameChangerNames: tagger.gameChangerNames,
    cardInclusionMap: edhrec.cardInclusionMap,
    cardSynergyMap: edhrec.cardSynergyMap,
    cardRelevancyMap: mergedRelevancy,
    cardEdhrecMetaMap: edhrec.cardEdhrecMetaMap,
    deckScore: edhrec.deckScore,
    gapAnalysis: edhrec.gapAnalysis,
    swapCandidates: swaps.swapCandidates,
    edhrecCurve: edhrec.edhrecCurve,
    edhrecTypes: edhrec.edhrecTypes,
  };
}
