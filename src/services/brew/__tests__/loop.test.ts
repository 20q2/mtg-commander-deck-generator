import { describe, it, expect } from 'vitest';
import { nextRoutes, openNode, applyPick, isComplete, buildHealth } from '../engine';
import { makeContext, makeState, makeCandidate } from './fixtures';
import type { BrewState, BrewPick } from '../brewTypes';

function bigPool() {
  const cards = [];
  for (let i = 0; i < 12; i++) cards.push(makeCandidate(`Ramp${i}`, { role: 'ramp', subtype: 'mana-rock', primary_type: 'Artifact', type_line: 'Artifact', inclusion: 70 - i }));
  for (let i = 0; i < 12; i++) cards.push(makeCandidate(`Removal${i}`, { role: 'removal', subtype: 'spot-removal', primary_type: 'Instant', type_line: 'Instant', inclusion: 65 - i }));
  for (let i = 0; i < 12; i++) cards.push(makeCandidate(`Draw${i}`, { role: 'cardDraw', subtype: 'card-draw', primary_type: 'Sorcery', type_line: 'Sorcery', inclusion: 60 - i }));
  for (let i = 0; i < 30; i++) cards.push(makeCandidate(`Creature${i}`, { role: null, primary_type: 'Creature', type_line: 'Creature — Beast', inclusion: 55 - (i % 20) }));
  return cards;
}

describe('brew loop', () => {
  it('drives from empty to nonland-complete by always taking the first option of the first route', () => {
    const ctx = makeContext({ candidates: bigPool(), nonLandTarget: 40, landTarget: 36 });
    let state: BrewState = makeState();
    let guard = 0;
    while (!isComplete(ctx, state) && guard < 200) {
      guard += 1;
      const routes = nextRoutes(ctx, state);
      expect(routes.length).toBeGreaterThanOrEqual(1);
      const route = routes[0];
      if (route.type === 'manabase') break;
      const node = openNode(ctx, state, route);
      if (node.options.length === 0) break; // pool exhausted for this route; loop will pick another
      const option = node.options[0];
      const picks: BrewPick[] = option.cards.map(c => ({
        name: c.name, card: c.scryfall, role: c.role, subtype: c.subtype,
        inclusion: c.inclusion, viaRouteId: route.id, reasons: [],
      }));
      state = applyPick(state, picks, { routeType: route.type, passed: [], tags: {} });
    }
    expect(guard).toBeLessThan(200);            // converged, didn't spin
    const health = buildHealth(ctx, state);
    expect(health.cardCount).toBeGreaterThanOrEqual(Math.floor(40 * 0.95) - 5);
    expect(isComplete(ctx, state)).toBe(true);
  });

  it('never offers an exhausted route with zero options without an alternative', () => {
    const ctx = makeContext({ candidates: [
      makeCandidate('OnlyRemoval', { role: 'removal', primary_type: 'Instant', type_line: 'Instant' }),
    ], nonLandTarget: 10 });
    const state = makeState({ usedNames: ['OnlyRemoval'] });
    const routes = nextRoutes(ctx, state);
    // removal pool empty -> a removal-targeting route must not appear (manabase/finish surfaces instead)
    expect(routes.every(r => r.targetRole !== 'removal')).toBe(true);
  });
});
