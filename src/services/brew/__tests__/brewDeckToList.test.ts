import { describe, it, expect } from 'vitest';
import { brewDeckToList } from '../brewDeckToList';
import type { GeneratedDeck, ScryfallCard, Customization } from '@/types';

function sf(name: string): ScryfallCard {
  return { id: name, name, cmc: 2, type_line: 'Creature', color_identity: ['G'], prices: { usd: '1' } } as ScryfallCard;
}
const commander = sf('Ghave, Guru of Spores');
const cust = { bracketLevel: 'all', budgetOption: 'any', maxCardPrice: null, deckBudget: null,
  maxRarity: null, tinyLeaders: false, arenaOnly: false, collectionMode: false, collectionStrategy: 'full',
  collectionOwnedPercent: 75, tempoAutoDetect: true, tempoPacing: 'balanced', hyperFocus: false,
  comboCount: 1, scryfallQuery: '', currency: 'USD' } as unknown as Customization;

function deck(): GeneratedDeck {
  return {
    commander, partnerCommander: null,
    categories: {
      lands: [sf('Forest'), sf('Plains')],
      ramp: [sf('Sol Ring')], cardDraw: [sf('Harmonize')], singleRemoval: [sf('Swords to Plowshares')],
      boardWipes: [], creatures: [sf('Avenger of Zendikar')], synergy: [], utility: [],
    },
    stats: { totalCards: 99 } as GeneratedDeck['stats'],
    usedThemes: ['Tokens', 'Counters'],
  } as GeneratedDeck;
}

describe('brewDeckToList', () => {
  it('flattens commander + all categories into a name list', () => {
    const out = brewDeckToList(deck(), commander, null, cust);
    expect(out.cards[0]).toBe('Ghave, Guru of Spores');     // commander first
    expect(out.cards).toContain('Sol Ring');
    expect(out.cards).toContain('Forest');
    expect(out.cards).toContain('Avenger of Zendikar');
    expect(out.deckSize).toBe(out.cards.length);
    expect(out.name).toContain('Ghave, Guru of Spores');
  });

  it('includes a partner in the name and card list', () => {
    const partner = sf('Saffi Eriksdotter');
    const out = brewDeckToList(deck(), commander, partner, cust);
    expect(out.cards).toContain('Saffi Eriksdotter');
    expect(out.name).toContain('Saffi Eriksdotter');
  });

  it('builds a generationSummary from themes + customization', () => {
    const out = brewDeckToList(deck(), commander, null, { ...cust, budgetOption: 'budget', bracketLevel: 3 } as Customization);
    expect(out.generationSummary).toContain('Brewed');          // marks it as a brewed deck
    expect(out.generationSummary).toContain('Tokens');
    expect(out.generationSummary).toContain('Bracket 3');
    expect(out.generationSummary).toContain('Budget');
  });
});
