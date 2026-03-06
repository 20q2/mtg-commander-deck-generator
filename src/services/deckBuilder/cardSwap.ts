import type { ScryfallCard, GeneratedDeck, DeckCategory } from '@/types';
import { calculateStats } from './deckGenerator';
import { getCardRole, getRampSubtype, getRemovalSubtype, getBoardwipeSubtype, getCardDrawSubtype, type RoleKey } from '@/services/tagger/client';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';

const ROLE_TO_CATEGORY: Record<RoleKey, DeckCategory> = {
  ramp: 'ramp',
  removal: 'singleRemoval',
  boardwipe: 'boardWipes',
  cardDraw: 'cardDraw',
};

/** Find which DeckCategory a card is stored in. */
function findCardCategory(
  card: ScryfallCard,
  categories: GeneratedDeck['categories']
): DeckCategory | null {
  for (const [category, cards] of Object.entries(categories)) {
    if (cards.some(c => c.name === card.name)) {
      return category as DeckCategory;
    }
  }
  return null;
}

/** Determine the appropriate DeckCategory for a card being swapped in. */
function getCategoryForCard(card: ScryfallCard): DeckCategory {
  const typeLine = getFrontFaceTypeLine(card).toLowerCase();
  if (typeLine.includes('land')) return 'lands';

  const role = getCardRole(card.name);
  if (role) return ROLE_TO_CATEGORY[role];

  if (typeLine.includes('creature')) return 'creatures';
  if (typeLine.includes('planeswalker')) return 'utility';
  return 'synergy';
}

export interface SwapResult {
  deck: GeneratedDeck;
  success: boolean;
  error?: string;
}

/**
 * Swap a card in the generated deck with a candidate.
 * Returns a NEW GeneratedDeck object (immutable update).
 */
export function swapCard(
  deck: GeneratedDeck,
  oldCard: ScryfallCard,
  newCard: ScryfallCard,
): SwapResult {
  const oldCategory = findCardCategory(oldCard, deck.categories);
  if (!oldCategory) {
    return { deck, success: false, error: `Card "${oldCard.name}" not found in deck` };
  }

  const newCategory = getCategoryForCard(newCard);

  // Build new categories (immutable)
  const newCategories = { ...deck.categories };

  // Remove first instance of old card
  const oldArr = [...newCategories[oldCategory]];
  const idx = oldArr.findIndex(c => c.name === oldCard.name);
  if (idx !== -1) oldArr.splice(idx, 1);
  newCategories[oldCategory] = oldArr;

  // Stamp role and subtype on new card
  const newRole = getCardRole(newCard.name);
  if (newRole) {
    newCard.deckRole = newRole;
    if (newRole === 'ramp') newCard.rampSubtype = getRampSubtype(newCard.name) ?? undefined;
    else if (newRole === 'removal') newCard.removalSubtype = getRemovalSubtype(newCard.name) ?? undefined;
    else if (newRole === 'boardwipe') newCard.boardwipeSubtype = getBoardwipeSubtype(newCard.name) ?? undefined;
    else if (newRole === 'cardDraw') newCard.cardDrawSubtype = getCardDrawSubtype(newCard.name) ?? undefined;
  }

  // Add new card
  newCategories[newCategory] = [...newCategories[newCategory], newCard];

  // Recalculate stats
  const newStats = calculateStats(newCategories);

  // Update swap candidates: remove new card, add old card back
  let newSwapCandidates = deck.swapCandidates;
  if (deck.swapCandidates) {
    newSwapCandidates = { ...deck.swapCandidates };
    const key = oldCard.deckRole ?? getPrimaryTypeKey(oldCard);
    if (key) {
      const pool = newSwapCandidates[key] ?? [];
      newSwapCandidates[key] = [
        ...pool.filter(c => c.name !== newCard.name),
        oldCard,
      ];
    }
  }

  // Recalculate role counts and all subtype counts
  let newRoleCounts = deck.roleCounts;
  let newRampSubtypeCounts = deck.rampSubtypeCounts;
  let newRemovalSubtypeCounts = deck.removalSubtypeCounts;
  let newBoardwipeSubtypeCounts = deck.boardwipeSubtypeCounts;
  let newCardDrawSubtypeCounts = deck.cardDrawSubtypeCounts;
  if (deck.roleCounts && deck.roleTargets) {
    newRoleCounts = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
    newRampSubtypeCounts = { 'mana-producer': 0, 'mana-rock': 0, 'cost-reducer': 0, ramp: 0 };
    newRemovalSubtypeCounts = { counterspell: 0, bounce: 0, 'spot-removal': 0, removal: 0 };
    newBoardwipeSubtypeCounts = { 'bounce-wipe': 0, boardwipe: 0 };
    newCardDrawSubtypeCounts = { tutor: 0, wheel: 0, cantrip: 0, 'card-draw': 0, 'card-advantage': 0 };
    for (const cards of Object.values(newCategories)) {
      for (const card of cards) {
        if (card.deckRole && card.deckRole in newRoleCounts) {
          newRoleCounts[card.deckRole] = (newRoleCounts[card.deckRole] || 0) + 1;
        }
        if (card.rampSubtype) newRampSubtypeCounts[card.rampSubtype] = (newRampSubtypeCounts[card.rampSubtype] || 0) + 1;
        if (card.removalSubtype) newRemovalSubtypeCounts[card.removalSubtype] = (newRemovalSubtypeCounts[card.removalSubtype] || 0) + 1;
        if (card.boardwipeSubtype) newBoardwipeSubtypeCounts[card.boardwipeSubtype] = (newBoardwipeSubtypeCounts[card.boardwipeSubtype] || 0) + 1;
        if (card.cardDrawSubtype) newCardDrawSubtypeCounts[card.cardDrawSubtype] = (newCardDrawSubtypeCounts[card.cardDrawSubtype] || 0) + 1;
      }
    }
  }

  return {
    deck: {
      ...deck,
      categories: newCategories,
      stats: newStats,
      swapCandidates: newSwapCandidates,
      roleCounts: newRoleCounts,
      rampSubtypeCounts: newRampSubtypeCounts,
      removalSubtypeCounts: newRemovalSubtypeCounts,
      boardwipeSubtypeCounts: newBoardwipeSubtypeCounts,
      cardDrawSubtypeCounts: newCardDrawSubtypeCounts,
    },
    success: true,
  };
}

/** Map a card to its type-based swap bucket key. */
function getPrimaryTypeKey(card: ScryfallCard): string | null {
  const t = getFrontFaceTypeLine(card).toLowerCase();
  if (t.includes('land')) return null;
  if (t.includes('creature')) return 'type:creature';
  if (t.includes('instant')) return 'type:instant';
  if (t.includes('sorcery')) return 'type:sorcery';
  if (t.includes('artifact')) return 'type:artifact';
  if (t.includes('enchantment')) return 'type:enchantment';
  if (t.includes('planeswalker')) return 'type:planeswalker';
  return null;
}

/**
 * Get swap candidates for a card based on its deckRole or card type.
 * Returns empty array if deck has no candidates.
 */
export function getSwapCandidatesForCard(
  deck: GeneratedDeck,
  card: ScryfallCard,
): ScryfallCard[] {
  if (!deck.swapCandidates) return [];
  // Role-based lookup for tagged cards
  if (card.deckRole) return deck.swapCandidates[card.deckRole] ?? [];
  // Type-based fallback for non-role cards
  const typeKey = getPrimaryTypeKey(card);
  if (typeKey) return deck.swapCandidates[typeKey] ?? [];
  return [];
}
