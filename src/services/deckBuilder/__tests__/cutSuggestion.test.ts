import { describe, it, expect } from 'vitest';
import { suggestCutCandidates } from '../cutSuggestion';
import type { ScryfallCard, GeneratedDeck, DetectedCombo } from '@/types';

function makeCard(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: overrides.name ?? 'id',
    name: 'Card',
    type_line: 'Creature — Human',
    color_identity: [],
    cmc: 2,
    ...overrides,
  } as ScryfallCard;
}

function makeDeck(cards: ScryfallCard[], overrides: Partial<GeneratedDeck> = {}): GeneratedDeck {
  return {
    commander: makeCard({ name: 'Commander Test', id: 'cmd', type_line: 'Legendary Creature' }),
    partnerCommander: null,
    categories: {
      creatures: cards,
      lands: [],
      ramp: [], singleRemoval: [], boardWipes: [], cardDraw: [], protection: [], synergy: [], utility: [],
    } as unknown as GeneratedDeck['categories'],
    stats: { totalCards: cards.length, averageCmc: 2, manaCurve: {}, colorDistribution: {}, typeDistribution: {} },
    ...overrides,
  };
}

describe('suggestCutCandidates', () => {
  it('excludes the commander and the new card itself', () => {
    const cmdr = makeCard({ name: 'Commander Test', id: 'cmd' });
    const filler = makeCard({ name: 'Filler Creature', id: 'filler' });
    const deck = makeDeck([filler], { commander: cmdr });
    const newCard = makeCard({ name: 'New Card', id: 'new' });
    const ranked = suggestCutCandidates(deck, newCard);
    expect(ranked.map(r => r.card.name)).not.toContain('Commander Test');
    expect(ranked.map(r => r.card.name)).not.toContain('New Card');
    expect(ranked.map(r => r.card.name)).toContain('Filler Creature');
  });

  it('never suggests cutting a live combo piece', () => {
    const pieceA = makeCard({ name: 'Combo Piece A', id: 'a' });
    const pieceB = makeCard({ name: 'Combo Piece B', id: 'b' });
    const filler = makeCard({ name: 'Filler Creature', id: 'filler' });
    const combos: DetectedCombo[] = [{
      id: 'combo1',
      cards: ['Combo Piece A', 'Combo Piece B'],
      source: 'commander',
      isComplete: true,
      missingCards: [],
      deckCount: 2,
    } as unknown as DetectedCombo];
    const deck = makeDeck([pieceA, pieceB, filler], { detectedCombos: combos });
    const ranked = suggestCutCandidates(deck, makeCard({ name: 'New Card', id: 'new' }));
    const names = ranked.map(r => r.card.name);
    expect(names).not.toContain('Combo Piece A');
    expect(names).not.toContain('Combo Piece B');
    expect(names).toContain('Filler Creature');
  });

  it('only ranks lands against a land newCard', () => {
    const land = makeCard({ name: 'Some Land', id: 'land', type_line: 'Land' });
    const spell = makeCard({ name: 'Some Spell', id: 'spell', type_line: 'Instant' });
    const deck = makeDeck([spell], { categories: { creatures: [spell], lands: [land], ramp: [], singleRemoval: [], boardWipes: [], cardDraw: [], protection: [], synergy: [], utility: [] } as unknown as GeneratedDeck['categories'] });
    const newLand = makeCard({ name: 'New Land', id: 'newland', type_line: 'Land' });
    const ranked = suggestCutCandidates(deck, newLand);
    const names = ranked.map(r => r.card.name);
    expect(names).toContain('Some Land');
    expect(names).not.toContain('Some Spell');
  });

  it('ranks worst-fit-first (higher cutScore first)', () => {
    const bad = makeCard({ name: 'Bad Fit', id: 'bad' });
    const good = makeCard({ name: 'Good Fit', id: 'good' });
    const deck = makeDeck([bad, good], {
      cardInclusionMap: { 'Bad Fit': 1, 'Good Fit': 60 },
      cardSynergyMap: { 'Bad Fit': -2, 'Good Fit': 3 },
    });
    const ranked = suggestCutCandidates(deck, makeCard({ name: 'New Card', id: 'new' }));
    expect(ranked[0].card.name).toBe('Bad Fit');
    expect(ranked[0].cutScore).toBeGreaterThan(ranked[1].cutScore);
    expect(ranked[0].reasons.length).toBeGreaterThan(0);
  });
});
