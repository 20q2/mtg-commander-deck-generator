import { describe, it, expect } from 'vitest';
import { detectNearMissCombos } from '../combos';
import { makeContext, makeState, makeCandidate } from './fixtures';
import type { EDHRECCombo } from '@/types';

function combo(id: string, names: string[]): EDHRECCombo {
  return { comboId: id, cards: names.map(n => ({ name: n, id: n })), results: ['Infinite tokens'],
    deckCount: 1000, rank: 1, bracket: '3', prereqCount: 0 };
}

describe('detectNearMissCombos', () => {
  it('finds a combo missing 1 piece that is available in the pool', () => {
    const missingCard = makeCandidate('Cathars Crusade', { role: null });
    const ctx = makeContext({
      candidates: [missingCard],
      combos: [combo('c1', ['Ghave, Guru of Spores', 'Cathars Crusade'])],
      commander: makeCandidate('Ghave, Guru of Spores', {}).scryfall,
    });
    // commander counts as owned; only Cathars missing, and it's in the pool.
    const found = detectNearMissCombos(ctx, makeState());
    expect(found).toHaveLength(1);
    expect(found[0].missing).toEqual(['Cathars Crusade']);
    expect(found[0].have).toEqual(['Ghave, Guru of Spores']); // the owned piece it pairs with
    expect(found[0].results).toContain('Infinite tokens');
  });

  it('skips combos that are already complete', () => {
    const ctx = makeContext({
      candidates: [],
      combos: [combo('c1', ['Ghave, Guru of Spores'])],
      commander: makeCandidate('Ghave, Guru of Spores', {}).scryfall,
    });
    expect(detectNearMissCombos(ctx, makeState())).toHaveLength(0);
  });

  it('skips combos whose missing pieces are NOT in the pool', () => {
    const ctx = makeContext({
      candidates: [],   // missing piece unavailable
      combos: [combo('c1', ['Ghave, Guru of Spores', 'Some Unavailable Card'])],
      commander: makeCandidate('Ghave, Guru of Spores', {}).scryfall,
    });
    expect(detectNearMissCombos(ctx, makeState())).toHaveLength(0);
  });

  it('skips combos with no owned piece (not a near-miss yet)', () => {
    const ctx = makeContext({
      candidates: [makeCandidate('Card A', {}), makeCandidate('Card B', {})],
      combos: [combo('c1', ['Card A', 'Card B'])],
      commander: makeCandidate('Unrelated Commander', {}).scryfall,
    });
    expect(detectNearMissCombos(ctx, makeState())).toHaveLength(0);
  });
});
