import type { ScryfallCard, DeckCategory, DetectedCombo } from '@/types';
import { loadTaggerData, getCardRole, hasMultipleRoles, getRampSubtype, getRemovalSubtype, getBoardwipeSubtype, getCardDrawSubtype } from '@/services/tagger/client';
import { getFrontFaceTypeLine, getGameChangerNames } from '@/services/scryfall/client';
import { getBaseRoleTargets as getRoleTargets } from './roleTargets';
import { estimateBracket, type BracketEstimation } from './bracketEstimator';

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
}

/**
 * Enrich an array of ScryfallCards with tagger role data and sort into categories.
 * Used by ListDeckView to provide role badges and distribution without full deck generation.
 */
export async function enrichDeckCards(
  cards: ScryfallCard[],
  deckSize: number,
  detectedCombos?: DetectedCombo[],
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
      roleCounts[role]++;
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
  };
}
