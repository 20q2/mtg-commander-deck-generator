import { describe, it, expect } from 'vitest';
import { buildHealth, isComplete } from '../health';
import { makeContext, makeState, makeCandidate } from './fixtures';
import type { BrewPick } from '../brewTypes';

function pick(c: ReturnType<typeof makeCandidate>): BrewPick {
  return { name: c.name, card: c.scryfall, role: c.role, subtype: c.subtype,
    inclusion: c.inclusion, viaRouteId: 'r', reasons: [] };
}

describe('buildHealth', () => {
  it('counts roles, types, synergy and cost from picks', () => {
    const ctx = makeContext();
    const picks = [
      pick(makeCandidate('Sol Ring', { role: 'ramp', inclusion: 80, price: '2.00', primary_type: 'Artifact', type_line: 'Artifact' })),
      pick(makeCandidate('Cultivate', { role: 'ramp', inclusion: 60, price: '0.50', primary_type: 'Sorcery', type_line: 'Sorcery' })),
      pick(makeCandidate('Llanowar Elves', { role: 'ramp', inclusion: 40, price: '0.25', primary_type: 'Creature', type_line: 'Creature — Elf' })),
    ];
    const h = buildHealth(ctx, makeState({ picks }));
    expect(h.roleCounts.ramp).toBe(3);
    expect(h.cardCount).toBe(3);
    expect(h.deckScore).toBe(180);               // 80+60+40
    expect(h.estCostUsd).toBeCloseTo(2.75, 2);
    expect(h.typeCounts.creature).toBe(1);
    expect(h.typeCounts.artifact).toBe(1);
    expect(h.typeCounts.sorcery).toBe(1);
  });

  it('reports theme density from theme-synergy picks', () => {
    const ctx = makeContext();
    const picks = [
      pick(makeCandidate('A', { isThemeSynergyCard: true })),
      pick(makeCandidate('B', { isThemeSynergyCard: false })),
    ];
    const h = buildHealth(ctx, makeState({ picks }));
    expect(h.themeDensity).toBe(50);
  });
});

describe('isComplete', () => {
  it('is false while nonland targets are unmet', () => {
    const ctx = makeContext({ nonLandTarget: 5 });
    expect(isComplete(ctx, makeState({ picks: [] }))).toBe(false);
  });

  it('is true once phase is done', () => {
    const ctx = makeContext();
    expect(isComplete(ctx, makeState({ phase: 'done' }))).toBe(true);
  });
});
