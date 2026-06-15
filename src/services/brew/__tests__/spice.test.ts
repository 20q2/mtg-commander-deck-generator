import { describe, it, expect } from 'vitest';
import { openNode } from '../nodes';
import { makeContext, makeState, makeCandidate } from './fixtures';
import type { BrewRoute, BrewHistoryEntry } from '../brewTypes';

function history(n: number): BrewHistoryEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    pickNumber: i + 1, routeId: 'draft:creature', routeType: 'draft' as const, added: ['X'], passed: [],
  }));
}

const route: BrewRoute = {
  id: 'draft:creature', type: 'draft', title: 'Add Creatures',
  description: '', targetRole: null, targetType: 'creature', tone: 'need', fills: 1,
};

// 5 popular creatures + 5 underutilized (low-inclusion) ones.
const pool = [
  ...Array.from({ length: 5 }, (_, i) => makeCandidate(`Popular ${i}`, { primary_type: 'Creature', type_line: 'Creature — Beast', inclusion: 90 - i })),
  ...Array.from({ length: 5 }, (_, i) => makeCandidate(`Obscure ${i}`, { primary_type: 'Creature', type_line: 'Creature — Beast', inclusion: 5 + i })),
];

describe('spice — rare wildcard slot', () => {
  it('shows no spicy option on a normal screen', () => {
    const node = openNode(makeContext({ candidates: pool }), makeState({ history: history(1) }), route);
    expect(node.options.some(o => o.spicy)).toBe(false);
  });

  it('drops exactly one spicy underutilized card on the cadence screen', () => {
    // history length 7 → 7 % 8 === 7 → spice-eligible.
    const node = openNode(makeContext({ candidates: pool }), makeState({ history: history(7) }), route);
    const spicy = node.options.filter(o => o.spicy);
    expect(spicy).toHaveLength(1);
    expect(spicy[0].cards[0].inclusion).toBeLessThan(50); // a buried, low-inclusion card
  });
});
