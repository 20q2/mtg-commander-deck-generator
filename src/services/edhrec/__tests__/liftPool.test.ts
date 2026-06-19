import { describe, it, expect } from 'vitest';
import { parseCardLiftPool } from '../client';

// Minimal card-page payload: one cardlist of cardviews.
function page(cardviews: Array<Record<string, unknown>>) {
  return { container: { json_dict: { cardlists: [{ tag: 'creatures', cardviews }] } } } as Parameters<typeof parseCardLiftPool>[0];
}

describe('parseCardLiftPool', () => {
  it('keeps well-supported lift and drops low-sample noise (the Greel ×1376 bug)', () => {
    // Jolrael-popularity seed (~2570 decks) → strict floor of 50.
    const out = parseCardLiftPool(page([
      // EDHREC card-page cardviews carry inclusion == num_decks; coPct is derived from inclusion.
      { name: 'Real Synergy', lift: 8.2, inclusion: 400, num_decks: 400, potential_decks: 2570 },
      { name: 'Noise Bomb', lift: 1376.9, inclusion: 12, num_decks: 12, potential_decks: 2570 }, // huge lift, ~no support
    ]));
    expect(out.map(e => e.name)).toEqual(['Real Synergy']);
    expect(out[0].lift).toBe(8.2);
    expect(out[0].numDecks).toBe(400);
    expect(out[0].coPct).toBe(Math.round((400 / 2570) * 100)); // 16
  });

  it('relaxes the floor for niche seeds so a thin archetype still surfaces', () => {
    // Niche seed (~600 decks) → adaptive floor clamps to 12; 20 shared decks now qualifies.
    const niche = parseCardLiftPool(page([
      { name: 'Fringe Treefolk', lift: 40, inclusion: 20, num_decks: 20, potential_decks: 600 },
      { name: 'Single-deck fluke', lift: 900, inclusion: 6, num_decks: 6, potential_decks: 600 },
    ]));
    expect(niche.map(e => e.name)).toEqual(['Fringe Treefolk']);

    // Same 20-deck card under a MAINSTREAM seed (~140k decks) is below the strict floor → dropped.
    const mainstream = parseCardLiftPool(page([
      { name: 'Fringe Treefolk', lift: 40, inclusion: 20, num_decks: 20, potential_decks: 140000 },
    ]));
    expect(mainstream).toHaveLength(0);
  });

  it('ignores cardviews without a numeric lift or deck pool', () => {
    const out = parseCardLiftPool(page([
      { name: 'No Lift', num_decks: 500, potential_decks: 2570 },
      { name: 'No Pool', lift: 6, num_decks: 500 },
    ]));
    expect(out).toHaveLength(0);
  });

  it('dedupes by name keeping the max lift', () => {
    const out = parseCardLiftPool(page([
      { name: 'Dup', lift: 3, num_decks: 100, potential_decks: 1000 },
      { name: 'Dup', lift: 7, num_decks: 100, potential_decks: 1000 },
    ]));
    expect(out).toHaveLength(1);
    expect(out[0].lift).toBe(7);
  });
});
