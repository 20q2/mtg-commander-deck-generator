import type { GeneratedDeck, ScryfallCard, Customization } from '@/types';

export interface BrewListPayload {
  name: string;
  cards: string[];
  generationSummary?: string;
  deckSize: number;
}

/** Flatten a finished brewed deck into a UserCardList payload (commander first, then all categories). */
export function brewDeckToList(
  deck: GeneratedDeck,
  commander: ScryfallCard,
  partnerCommander: ScryfallCard | null,
  customization: Customization,
): BrewListPayload {
  const cards: string[] = [];
  cards.push(commander.name);
  if (partnerCommander) cards.push(partnerCommander.name);
  for (const list of Object.values(deck.categories)) {
    for (const card of list) cards.push(card.name);
  }

  const name = `${commander.name}${partnerCommander ? ` & ${partnerCommander.name}` : ''} (Brewed)`;

  const parts: string[] = ['Brewed'];
  if (deck.usedThemes && deck.usedThemes.length > 0) parts.push(`Built with: ${deck.usedThemes.join(', ')}`);
  const sym = customization.currency === 'EUR' ? '€' : '$';
  if (customization.bracketLevel !== 'all') parts.push(`Bracket ${customization.bracketLevel}`);
  if (customization.budgetOption === 'budget') parts.push('Budget');
  if (customization.budgetOption === 'expensive') parts.push('Expensive');
  if (customization.maxCardPrice !== null) parts.push(`<${sym}${customization.maxCardPrice}/card`);
  if (customization.deckBudget !== null) parts.push(`${sym}${customization.deckBudget} deck budget`);
  if (customization.collectionMode) {
    parts.push(customization.collectionStrategy === 'partial'
      ? `Collection (${customization.collectionOwnedPercent}%)` : 'Collection Only');
  }

  return { name, cards, generationSummary: parts.join(' · '), deckSize: cards.length };
}
