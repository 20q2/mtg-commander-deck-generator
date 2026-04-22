import type { ScryfallCard, DeckCategory, DetectedCombo, EDHRECCommanderData, EDHRECCard } from '@/types';
import { loadTaggerData, getCardRole, hasMultipleRoles, getRampSubtype, getRemovalSubtype, getBoardwipeSubtype, getCardDrawSubtype, type RoleKey } from '@/services/tagger/client';
import { getFrontFaceTypeLine, getGameChangerNames, isChannelLand, isMdfcLand } from '@/services/scryfall/client';
import { CHANNEL_LAND_BOOST, MDFC_LAND_BOOST } from './deckGenerator';
import { fetchCommanderData, fetchPartnerCommanderData } from '@/services/edhrec/client';
import { getBaseRoleTargets as getRoleTargets } from './roleTargets';
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
  bracketEstimation?: BracketEstimation;
  gameChangerNames?: string[];
  cardInclusionMap?: Record<string, number>;
  cardRelevancyMap?: Record<string, number>;
  deckScore?: number;
}

/**
 * Enrich an array of ScryfallCards with tagger role data and sort into categories.
 * Used by ListDeckView to provide role badges and distribution without full deck generation.
 */
export async function enrichDeckCards(
  cards: ScryfallCard[],
  deckSize: number,
  detectedCombos?: DetectedCombo[],
  commanderName?: string,
  partnerCommanderName?: string,
): Promise<EnrichResult> {
  // Ensure tagger data is loaded (cached after first call)
  await loadTaggerData();

  const categories: Record<DeckCategory, ScryfallCard[]> = {
    lands: [],
    ramp: [],
    cardDraw: [],
    singleRemoval: [],
    boardWipes: [],
    creatures: [],
    synergy: [],
    utility: [],
  };

  const roleCounts: Record<string, number> = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
  const rampSubtypeCounts: Record<string, number> = { 'mana-producer': 0, 'mana-rock': 0, 'cost-reducer': 0, ramp: 0 };
  const removalSubtypeCounts: Record<string, number> = { counterspell: 0, bounce: 0, 'spot-removal': 0, removal: 0 };
  const boardwipeSubtypeCounts: Record<string, number> = { 'bounce-wipe': 0, boardwipe: 0 };
  const cardDrawSubtypeCounts: Record<string, number> = { tutor: 0, wheel: 0, cantrip: 0, 'card-draw': 0, 'card-advantage': 0 };

  const ROLE_TO_CATEGORY: Record<string, DeckCategory> = {
    ramp: 'ramp',
    removal: 'singleRemoval',
    boardwipe: 'boardWipes',
    cardDraw: 'cardDraw',
  };

  let cmcSum = 0;
  let nonLandCount = 0;

  // Pre-fetch game changer names for GC stamping + bracket estimation
  let gcSet: Set<string> | null = null;
  try { gcSet = await getGameChangerNames(); } catch { /* non-critical */ }

  for (const card of cards) {
    const typeLine = getFrontFaceTypeLine(card).toLowerCase();

    // Stamp game changer flag
    if (gcSet?.has(card.name)) card.isGameChanger = true;

    // Stamp role + subtypes
    const role = getCardRole(card.name);
    if (role) {
      card.deckRole = role;
      card.multiRole = hasMultipleRoles(card.name);
      switch (role) {
        case 'ramp': card.rampSubtype = getRampSubtype(card.name) ?? undefined; break;
        case 'removal': card.removalSubtype = getRemovalSubtype(card.name) ?? undefined; break;
        case 'boardwipe': card.boardwipeSubtype = getBoardwipeSubtype(card.name) ?? undefined; break;
        case 'cardDraw': card.cardDrawSubtype = getCardDrawSubtype(card.name) ?? undefined; break;
      }
      // Don't count lands toward role totals — they occupy land slots, not spell slots
      if (!typeLine.includes('land')) roleCounts[role]++;
      if (card.rampSubtype) rampSubtypeCounts[card.rampSubtype] = (rampSubtypeCounts[card.rampSubtype] || 0) + 1;
      if (card.removalSubtype) removalSubtypeCounts[card.removalSubtype] = (removalSubtypeCounts[card.removalSubtype] || 0) + 1;
      if (card.boardwipeSubtype) boardwipeSubtypeCounts[card.boardwipeSubtype] = (boardwipeSubtypeCounts[card.boardwipeSubtype] || 0) + 1;
      if (card.cardDrawSubtype) cardDrawSubtypeCounts[card.cardDrawSubtype] = (cardDrawSubtypeCounts[card.cardDrawSubtype] || 0) + 1;
    }

    // Track CMC for avg calculation
    if (!typeLine.includes('land')) {
      cmcSum += card.cmc ?? 0;
      nonLandCount++;
    }

    // Sort into categories — creatures stay in creatures (matches generator behavior)
    if (typeLine.includes('land')) {
      categories.lands.push(card);
    } else if (typeLine.includes('creature')) {
      categories.creatures.push(card);
    } else if (role && ROLE_TO_CATEGORY[role]) {
      categories[ROLE_TO_CATEGORY[role]].push(card);
    } else if (typeLine.includes('planeswalker')) {
      categories.utility.push(card);
    } else {
      categories.synergy.push(card);
    }
  }

  const roleTargets = getRoleTargets(deckSize);

  // Bracket estimation (reuses gcSet from above)
  let bracketEstimation: BracketEstimation | undefined;
  const gcNames = gcSet ? [...gcSet] : undefined;
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

  // Optional: fetch EDHREC commander data and build inclusion + relevancy maps.
  // Used by list-based decks so the optimizer shows real commander-specific
  // inclusion % instead of the Scryfall edhrec_rank fallback (which clamps at 1%).
  let cardInclusionMap: Record<string, number> | undefined;
  let cardRelevancyMap: Record<string, number> | undefined;
  let deckScore: number | undefined;
  if (commanderName) {
    try {
      const edhrecData: EDHRECCommanderData = partnerCommanderName
        ? await fetchPartnerCommanderData(commanderName, partnerCommanderName)
        : await fetchCommanderData(commanderName);

      // Build inclusion index keyed by card name (front-face fallback for DFCs)
      const inclusionIndex = new Map<string, number>();
      for (const c of edhrecData.cardlists.allNonLand) inclusionIndex.set(c.name, c.inclusion);
      for (const c of edhrecData.cardlists.lands) {
        if (!BASIC_LAND_NAMES.has(c.name)) inclusionIndex.set(c.name, c.inclusion);
      }

      const inclMap: Record<string, number> = {};
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
        }
      }
      cardInclusionMap = inclMap;
      deckScore = Math.round(score);

      // Build relevancy map — uses scoreRecommendation with a scoring context
      // derived from roleCounts/roleTargets + current curve & types.
      const edhrecCardIndex = new Map<string, EDHRECCard>();
      for (const c of edhrecData.cardlists.allNonLand) edhrecCardIndex.set(c.name, c);
      for (const c of edhrecData.cardlists.lands) {
        if (!BASIC_LAND_NAMES.has(c.name)) edhrecCardIndex.set(c.name, c);
      }

      const roleDeficits = Object.entries(roleTargets).map(([role, target]) => ({
        role,
        label: role,
        current: roleCounts[role] ?? 0,
        target,
        deficit: Math.max(0, target - (roleCounts[role] ?? 0)),
      }));

      // Current curve from enriched cards (non-land)
      const nonLandForScoring = Object.values(categories).flat()
        .filter(c => !BASIC_LAND_NAMES.has(c.name) && !getFrontFaceTypeLine(c).toLowerCase().includes('land'));
      const actualCurve: Record<number, number> = {};
      for (const c of nonLandForScoring) {
        const cmc = Math.min(Math.floor(c.cmc ?? 0), 7);
        actualCurve[cmc] = (actualCurve[cmc] || 0) + 1;
      }
      // Target curve from EDHREC's stats (normalize to deckSize-ish scale)
      const edhrecCurve = edhrecData.stats?.manaCurve || {};
      const curveAnalysis = Object.keys(edhrecCurve).map(Number).map(cmc => ({
        cmc,
        current: actualCurve[cmc] || 0,
        target: edhrecCurve[cmc] || 0,
        delta: (actualCurve[cmc] || 0) - (edhrecCurve[cmc] || 0),
      }));

      // Current types from enriched cards
      const TYPE_KEYS = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker'] as const;
      const actualTypes: Record<string, number> = {};
      for (const c of nonLandForScoring) {
        const t = getFrontFaceTypeLine(c).toLowerCase();
        const type = TYPE_KEYS.find(tp => t.includes(tp)) || 'other';
        actualTypes[type] = (actualTypes[type] || 0) + 1;
      }
      // Target types from EDHREC's stats
      const edhrecTypes = edhrecData.stats?.typeDistribution || {};
      const typeAnalysis = TYPE_KEYS.map(type => ({
        type,
        current: actualTypes[type] || 0,
        target: (edhrecTypes as Record<string, number>)[type] || 0,
        delta: (actualTypes[type] || 0) - ((edhrecTypes as Record<string, number>)[type] || 0),
      }));

      const currentSubtypeCounts: Record<string, number> = {
        ...rampSubtypeCounts,
        ...removalSubtypeCounts,
        ...boardwipeSubtypeCounts,
        ...cardDrawSubtypeCounts,
      };

      const scoringCtx: ScoringContext = {
        roleDeficits,
        curveAnalysis,
        typeAnalysis,
        currentSubtypeCounts,
      };

      const relMap: Record<string, number> = {};
      for (const cards of Object.values(categories)) {
        for (const card of cards) {
          if (BASIC_LAND_NAMES.has(card.name)) continue;
          const ec = edhrecCardIndex.get(card.name)
            ?? (card.name.includes(' // ') ? edhrecCardIndex.get(card.name.split(' // ')[0]) : undefined);
          if (!ec) { relMap[card.name] = 0; continue; }
          const role = (card.deckRole as RoleKey) || null;
          const sub = card.rampSubtype || card.removalSubtype || card.boardwipeSubtype || card.cardDrawSubtype || null;
          let score = scoreRecommendation(ec, role, sub, scoringCtx);
          if (isChannelLand(card)) score += CHANNEL_LAND_BOOST;
          else if (isMdfcLand(card)) score += MDFC_LAND_BOOST;
          relMap[card.name] = Math.round(score);
        }
      }
      cardRelevancyMap = relMap;

      console.log(`[Enricher] Built inclusion map (${Object.keys(inclMap).length} cards, score ${deckScore}) + relevancy map (${Object.keys(relMap).length} cards) from EDHREC`);
    } catch (err) {
      console.warn('[Enricher] Failed to fetch EDHREC data — skipping inclusion/relevancy maps', err);
    }
  }

  return {
    categories,
    roleCounts,
    roleTargets,
    rampSubtypeCounts,
    removalSubtypeCounts,
    boardwipeSubtypeCounts,
    cardDrawSubtypeCounts,
    bracketEstimation,
    gameChangerNames: gcNames,
    cardInclusionMap,
    cardRelevancyMap,
    deckScore,
  };
}
