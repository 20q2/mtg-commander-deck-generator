import { describe, it, expect } from 'vitest';
import { applyPick, undoLast } from '../picks';
import { makeState, makeCandidate } from './fixtures';
import type { BrewPick } from '../brewTypes';

function toPick(c: ReturnType<typeof makeCandidate>, routeId = 'draft:ramp'): BrewPick {
  return { name: c.name, card: c.scryfall, role: c.role, subtype: c.subtype,
    inclusion: c.inclusion, viaRouteId: routeId, reasons: [] };
}

describe('applyPick', () => {
  it('adds picks, records used names, and is immutable', () => {
    const state = makeState();
    const c = makeCandidate('Sol Ring', { role: 'ramp' });
    const next = applyPick(state, [toPick(c)], { routeType: 'draft', passed: [], tags: { 'Sol Ring': ['ramp'] } });
    expect(next.picks).toHaveLength(1);
    expect(next.usedNames).toContain('Sol Ring');
    expect(state.picks).toHaveLength(0); // original untouched
  });

  it('accumulates theme affinity from picked tags', () => {
    const state = makeState();
    const c = makeCandidate('Tireless Provisioner', { role: 'ramp' });
    const next = applyPick(state, [toPick(c)], { routeType: 'draft', passed: ['Lotus Cobra'], tags: { 'Tireless Provisioner': ['tokens', 'landfall'] } });
    expect(next.themeAffinity.tokens).toBeGreaterThan(0);
    expect(next.themeAffinity.landfall).toBeGreaterThan(0);
  });

  it('writes a history entry with pick number, added and passed', () => {
    const state = makeState();
    const c = makeCandidate('Cultivate', { role: 'ramp' });
    const next = applyPick(state, [toPick(c)], { routeType: 'draft', passed: ['Kodama\'s Reach'], tags: {} });
    expect(next.history).toHaveLength(1);
    expect(next.history[0].pickNumber).toBe(1);
    expect(next.history[0].added).toEqual(['Cultivate']);
    expect(next.history[0].passed).toEqual(["Kodama's Reach"]);
  });
});

describe('undoLast', () => {
  it('reverts the last decision wholesale (bundle undoes as a unit)', () => {
    let state = makeState();
    const a = makeCandidate('Harmonize', { role: 'cardDraw' });
    const b = makeCandidate('Beast Whisperer', { role: 'cardDraw' });
    state = applyPick(state, [toPick(a, 'bundle:draw'), toPick(b, 'bundle:draw')],
      { routeType: 'bundle', passed: [], tags: { Harmonize: ['draw'], 'Beast Whisperer': ['tokens'] } });
    expect(state.picks).toHaveLength(2);
    const reverted = undoLast(state);
    expect(reverted.picks).toHaveLength(0);
    expect(reverted.usedNames).toHaveLength(0);
    expect(reverted.themeAffinity.tokens ?? 0).toBe(0);
  });
});
