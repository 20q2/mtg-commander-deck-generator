import type { ScryfallCard } from '@/types';

// Primary card type, ordered so combined types resolve to the most informative
// supertype (Artifact Creature → creature, Artifact Land → land).
const TYPE_PRECEDENCE = ['planeswalker', 'creature', 'land', 'battle', 'instant', 'sorcery', 'artifact', 'enchantment', 'tribal'];

/** The card's primary type for icon/grouping purposes (front face, supertype-precedence). */
export function primaryType(typeLine?: string): string | null {
  if (!typeLine) return null;
  const front = typeLine.split('//')[0].split('—')[0].toLowerCase();
  return TYPE_PRECEDENCE.find(t => front.includes(t)) ?? null;
}

// Weights — EDHREC's similarity ordering dominates (it reflects how real decks
// treat cards as interchangeable); the structural signals refine it.
const W_EDHREC = 0.5;
const W_TYPE = 0.25;
const W_KEYWORDS = 0.15;
const W_CMC = 0.10;
const CMC_RANGE = 3;

/**
 * Functional similarity between a deck card and a candidate replacement, 0..1.
 * No oracle-text parsing (deliberately) — leans on EDHREC's similarity order
 * plus shared type, keywords, and mana-value proximity.
 *
 * @param edhrecIndex position of the candidate in the card's EDHREC "similar"
 *        list (0 = most similar); @param poolSize length of that list.
 */
export function scoreSimilarity(
  current: ScryfallCard,
  candidate: ScryfallCard,
  edhrecIndex: number,
  poolSize: number,
): number {
  // EDHREC order — earlier in the list = more similar.
  const edhrec = poolSize > 1 ? (poolSize - 1 - edhrecIndex) / (poolSize - 1) : 1;

  // Same primary card type.
  const curType = primaryType(current.type_line);
  const type = curType != null && curType === primaryType(candidate.type_line) ? 1 : 0;

  // Shared keywords (flying, deathtouch, ward, …).
  const curKw = new Set((current.keywords ?? []).map(k => k.toLowerCase()));
  const shared = (candidate.keywords ?? []).filter(k => curKw.has(k.toLowerCase())).length;
  const keywords = curKw.size > 0 ? shared / curKw.size : 0;

  // Mana-value proximity.
  const cmcDelta = Math.abs((current.cmc ?? 0) - (candidate.cmc ?? 0));
  const cmc = 1 - Math.min(cmcDelta, CMC_RANGE) / CMC_RANGE;

  return W_EDHREC * edhrec + W_TYPE * type + W_KEYWORDS * keywords + W_CMC * cmc;
}
