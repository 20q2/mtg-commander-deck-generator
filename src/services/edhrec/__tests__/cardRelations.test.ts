import { describe, it, expect } from 'vitest';
import { parseCardRelations } from '../client';

const raw = {
  similar: ['Lord Windgrace', 'Azusa, Lost but Seeking'],
  container: { json_dict: { cardlists: [
    { tag: 'topcommanders', cardviews: [{ name: 'Edgar Markov', inclusion: 100, potential_decks: 200 }] },
    { tag: 'highliftcards', cardviews: [
      { name: 'Dakmor Salvage', inclusion: 246, potential_decks: 4605 },
      { name: 'Squandered Resources', inclusion: 200, potential_decks: 4000 },
    ] },
    { tag: 'topcards', cardviews: [{ name: 'Swords to Plowshares', inclusion: 63, potential_decks: 100 }] },
  ] } },
};

describe('parseCardRelations', () => {
  it('extracts lift, coplay, and similar with source + co%', () => {
    const rels = parseCardRelations(raw);
    const byName = Object.fromEntries(rels.map(r => [r.name, r]));
    expect(byName['Dakmor Salvage']).toEqual({ name: 'Dakmor Salvage', source: 'lift', coPct: 5 });
    expect(byName['Swords to Plowshares']).toEqual({ name: 'Swords to Plowshares', source: 'coplay', coPct: 63 });
    expect(byName['Lord Windgrace']).toEqual({ name: 'Lord Windgrace', source: 'similar', coPct: 0 });
    // topcommanders is ignored.
    expect(byName['Edgar Markov']).toBeUndefined();
  });

  it('returns [] for an empty/garbage payload', () => {
    expect(parseCardRelations({})).toEqual([]);
  });
});
