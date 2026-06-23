import type { ScryfallCard } from '@/types';
import { cardMatchesRole } from '@/services/tagger/client';

export type GroupKey =
  | 'type'
  | 'cmc'
  | 'color'
  | 'colorIdentity'
  | 'rarity'
  | 'role'
  | 'none';

export const GROUP_OPTIONS: { value: GroupKey; label: string }[] = [
  { value: 'type', label: 'Type' },
  { value: 'cmc', label: 'Mana Value' },
  { value: 'color', label: 'Color' },
  { value: 'colorIdentity', label: 'Color Identity' },
  { value: 'rarity', label: 'Rarity' },
  { value: 'role', label: 'Role' },
];

export type CardEntry = { card: ScryfallCard; quantity: number };

const ORDER: Record<GroupKey, string[]> = {
  type: ['Commander', 'Planeswalker', 'Creature', 'Battle', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Land'],
  cmc: ['0', '1', '2', '3', '4', '5', '6', '7+', 'Lands'],
  color: ['White', 'Blue', 'Black', 'Red', 'Green', 'Multicolor', 'Colorless'],
  colorIdentity: ['White', 'Blue', 'Black', 'Red', 'Green', 'Multicolor', 'Colorless'],
  rarity: ['Mythic', 'Rare', 'Uncommon', 'Common', 'Special'],
  role: ['Ramp', 'Removal', 'Boardwipe', 'Card Draw', 'Protection', 'Other'],
  none: ['All Cards'],
};

const COLOR_LABEL: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };

function colorBucket(colors: string[] | undefined): string {
  if (!colors || colors.length === 0) return 'Colorless';
  if (colors.length > 1) return 'Multicolor';
  return COLOR_LABEL[colors[0]] ?? 'Colorless';
}

function rarityBucket(card: ScryfallCard): string {
  switch (card.rarity) {
    case 'mythic': return 'Mythic';
    case 'rare': return 'Rare';
    case 'uncommon': return 'Uncommon';
    case 'common': return 'Common';
    default: return 'Special';
  }
}

function cmcBucket(card: ScryfallCard, isLand: boolean): string {
  if (isLand) return 'Lands';
  const cmc = Math.floor(card.cmc ?? 0);
  if (cmc >= 7) return '7+';
  return String(cmc);
}

function roleBucket(card: ScryfallCard): string {
  if (card.deckRole === 'ramp' || cardMatchesRole(card.name, 'ramp')) return 'Ramp';
  if (card.deckRole === 'removal' || cardMatchesRole(card.name, 'removal')) return 'Removal';
  if (card.deckRole === 'boardwipe' || cardMatchesRole(card.name, 'boardwipe')) return 'Boardwipe';
  if (card.deckRole === 'cardDraw' || cardMatchesRole(card.name, 'cardDraw')) return 'Card Draw';
  // Protection is checked last (mirrors getCardRole priority) so a card with another primary role
  // groups under that role; only protection-only cards form the Protection section.
  if (card.deckRole === 'protection' || cardMatchesRole(card.name, 'protection')) return 'Protection';
  return 'Other';
}

function bucketFor(card: ScryfallCard, groupKey: GroupKey, fallbackType: string): string {
  switch (groupKey) {
    case 'type': return fallbackType;
    case 'cmc': return cmcBucket(card, fallbackType === 'Land');
    case 'color': return colorBucket(card.colors);
    case 'colorIdentity': return colorBucket(card.color_identity);
    case 'rarity': return rarityBucket(card);
    case 'role': return roleBucket(card);
    case 'none': return 'All Cards';
  }
}

/**
 * Group cards by the chosen key. Commander cards (type === 'Commander') are
 * always returned in a 'Commander' bucket at the head of the result, regardless
 * of groupKey. Empty buckets are omitted; unknown buckets are appended alphabetically.
 */
export function groupCardsBy(
  entries: { entry: CardEntry; type: string }[],
  groupKey: GroupKey
): { label: string; cards: CardEntry[] }[] {
  const buckets = new Map<string, CardEntry[]>();
  const commanderCards: CardEntry[] = [];

  for (const { entry, type } of entries) {
    if (type === 'Commander') {
      commanderCards.push(entry);
      continue;
    }
    const label = bucketFor(entry.card, groupKey, type);
    const list = buckets.get(label) ?? [];
    list.push(entry);
    buckets.set(label, list);
  }

  const ordered: { label: string; cards: CardEntry[] }[] = [];
  if (commanderCards.length > 0) ordered.push({ label: 'Commander', cards: commanderCards });

  const knownOrder = ORDER[groupKey];
  for (const label of knownOrder) {
    const cards = buckets.get(label);
    if (cards && cards.length > 0) {
      ordered.push({ label, cards });
      buckets.delete(label);
    }
  }
  const leftovers = Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [label, cards] of leftovers) {
    if (cards.length > 0) ordered.push({ label, cards });
  }

  return ordered;
}
