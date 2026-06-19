import { describe, it, expect } from 'vitest';
import { advanceAfterPick, STEER_EVERY } from '../flow';
import { makeContext, makeState, makeCandidate } from './fixtures';
import type { BrewHistoryEntry } from '../brewTypes';

function history(n: number): BrewHistoryEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    pickNumber: i + 1, routeId: 'draft:creature', routeType: 'draft' as const, added: ['X'], passed: [],
  }));
}

const creaturePool = Array.from({ length: 8 }, (_, i) =>
  makeCandidate(`Creature ${i}`, { primary_type: 'Creature', type_line: 'Creature — Beast', inclusion: 80 - i }));

describe('advanceAfterPick — steering cadence', () => {
  it('auto-advances to a card node between steers (no fork)', () => {
    const node = advanceAfterPick(makeContext({ candidates: creaturePool }), makeState({ history: history(1) }));
    expect(node).not.toBeNull();
    expect(node!.options.length).toBeGreaterThan(0);
  });

  it('surfaces the steering fork on the last node of each cycle', () => {
    // The moment lands on the STEER_EVERY-th node (index STEER_EVERY - 1).
    const node = advanceAfterPick(makeContext({ candidates: creaturePool }), makeState({ history: history(STEER_EVERY - 1) }));
    expect(node).toBeNull();
  });

  it('surfaces the fork once the deck is complete', () => {
    const node = advanceAfterPick(makeContext({ candidates: creaturePool }), makeState({ history: history(1), phase: 'done' }));
    expect(node).toBeNull();
  });
});
