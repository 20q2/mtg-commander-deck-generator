import { describe, it, expect } from 'vitest';
import {
  offerRelics, applyRelic, shouldOfferRelic, relicMult, relicThemeMult, relicPackBonus, relicBudgetCap,
  FIRST_PHILOSOPHY_AT,
} from '../relics';
import { makeContext, makeState, makeCandidate } from './fixtures';
import type { BrewPick, BrewRelic, BrewState } from '../brewTypes';

function picks(n: number): BrewPick[] {
  return Array.from({ length: n }, (_, i) => {
    const c = makeCandidate(`P${i}`, {});
    return { name: c.name, card: c.scryfall, role: null, subtype: null, inclusion: 40, viaRouteId: 'x', reasons: [] };
  });
}
function withPicks(n: number, over: Partial<BrewState> = {}): BrewState {
  return makeState({ picks: picks(n), ...over });
}

describe('shouldOfferRelic (philosophy — once per run)', () => {
  it('holds until the deck has some shape, then offers exactly once', () => {
    expect(shouldOfferRelic(withPicks(FIRST_PHILOSOPHY_AT - 1))).toBe(false);
    expect(shouldOfferRelic(withPicks(FIRST_PHILOSOPHY_AT))).toBe(true);
    // Once a philosophy is chosen, it never offers again.
    const chosen = [{ id: 'philosophy:spicy' }] as BrewRelic[];
    expect(shouldOfferRelic(withPicks(FIRST_PHILOSOPHY_AT + 20, { relics: chosen }))).toBe(false);
  });
});

describe('offerRelics (deck philosophies)', () => {
  it('offers the three philosophies, deterministically', () => {
    const a = offerRelics(makeContext(), withPicks(FIRST_PHILOSOPHY_AT));
    const b = offerRelics(makeContext(), withPicks(FIRST_PHILOSOPHY_AT));
    expect(a.map(r => r.id)).toEqual(['philosophy:efficient', 'philosophy:spicy', 'philosophy:combo']);
    expect(a.map(r => r.id)).toEqual(b.map(r => r.id));   // stable across resume
  });

  it('never re-offers a philosophy already chosen', () => {
    const owned = [{ id: 'philosophy:spicy' }] as BrewRelic[];
    const offered = offerRelics(makeContext(), withPicks(FIRST_PHILOSOPHY_AT, { relics: owned }));
    expect(offered.some(r => r.id === 'philosophy:spicy')).toBe(false);
  });
});

describe('applyRelic', () => {
  it('appends the philosophy, logs an "Embraced" moment, and marks the moment gap', () => {
    const state = withPicks(FIRST_PHILOSOPHY_AT);
    const philosophy = offerRelics(makeContext(), state)[0];
    const next = applyRelic(state, philosophy);
    expect(next.relics).toContainEqual(philosophy);
    expect(next.lastMomentPick).toBe(state.picks.length);
    expect(next.moments[next.moments.length - 1]?.kind).toBe('relic');
    expect(next.moments[next.moments.length - 1]?.label).toBe(`Embraced ${philosophy.name}`);
  });

  it('is idempotent — the same philosophy is never added twice', () => {
    const philosophy = { id: 'philosophy:combo', name: 'The Combo Brew', description: '', effect: { type: 'comboBias', mult: 1.8 } } as BrewRelic;
    const once = applyRelic(withPicks(2), philosophy);
    expect(applyRelic(once, philosophy)).toBe(once);
  });
});

describe('effect readers', () => {
  const relics: BrewRelic[] = [
    { id: 'a', name: 'a', description: '', effect: { type: 'efficiency', mult: 2 } },
    { id: 'b', name: 'b', description: '', effect: { type: 'themeWeight', slug: 'tokens', mult: 1.8 } },
    { id: 'c', name: 'c', description: '', effect: { type: 'packBonus', role: 'ramp', extra: 1 } },
    { id: 'd', name: 'd', description: '', effect: { type: 'budgetCap', maxUsd: 8 } },
    { id: 'e', name: 'e', description: '', effect: { type: 'budgetCap', maxUsd: 5 } },
  ];
  it('reads multipliers, theme weight, pack bonus and the tightest budget cap', () => {
    expect(relicMult(relics, 'efficiency')).toBe(2);
    expect(relicMult(relics, 'comboBias')).toBe(1);            // none → identity
    expect(relicThemeMult(relics, 'tokens')).toBe(1.8);
    expect(relicThemeMult(relics, 'aristocrats')).toBe(1);
    expect(relicPackBonus(relics, 'ramp')).toBe(1);
    expect(relicPackBonus(relics, 'removal')).toBe(0);
    expect(relicBudgetCap(relics)).toBe(5);                    // tightest of 8 and 5
    expect(relicBudgetCap([])).toBeNull();
  });
});
