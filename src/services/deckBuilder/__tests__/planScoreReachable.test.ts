import { describe, it, expect } from 'vitest';
import { composePlanScore, computeRolesSubscore, computeTempoSubscore, scoreAgainstSwaps, strategyValue, projectSwaps } from '../planScore';
import { computeCardFitSubscore, pairStaplesWithCuts } from '../cardFit';
import type { GapAnalysisCard, SubScore } from '@/types';
import type { RoleBreakdown, CurvePhaseAnalysis, DeckAnalysis } from '../deckAnalyzer';

/**
 * A player asked how to get their deck to 100/100, and there was no way to. Three things made the
 * top unreachable however well the deck followed the suggestions:
 *   - every one of the top-40 most-played cards NOT in the deck counted as a gap, and a commander
 *     page has hundreds, so the gap penalty never cleared (Card Fit capped at 80);
 *   - roles charged for running MORE than a target the Roles tab itself calls "at least N";
 *   - tempo charged a phase's overshoot on top of the shortfall it forces in another phase.
 * These pin the ceiling open.
 */
const roles = (rows: [string, number, number][]) =>
  rows.map(([role, current, target]) => ({ role, label: role, current, target })) as unknown as RoleBreakdown[];
const phases = (rows: ['early' | 'mid' | 'late', number, number][]) =>
  rows.map(([phase, current, target]) => ({ phase, current, target })) as unknown as CurvePhaseAnalysis[];
const gaps = (n: number, inclusion: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `Gap ${i}`, inclusion, synergy: 0, typeLine: '', price: '1.00' })) as GapAnalysisCard[];
const scored = (value: number): SubScore => ({ value, surface: 'ok' });

describe('a perfect 100 is reachable', () => {
  it('scores 100 for a deck that meets every target', () => {
    const plan = composePlanScore({
      strategy: scored(100),
      roles: computeRolesSubscore(roles([['ramp', 11, 11], ['removal', 10, 10], ['cardDraw', 9, 9]])),
      tempo: computeTempoSubscore(phases([['early', 33, 33], ['mid', 26, 26], ['late', 4, 4]])),
      cardFit: computeCardFitSubscore([], gaps(40, 12)),
    });
    expect(plan.overall).toBe(100);
  });

  it('does not charge for running more of a role than its floor', () => {
    const met = computeRolesSubscore(roles([['ramp', 11, 11], ['removal', 10, 10], ['cardDraw', 9, 9]]));
    const over = computeRolesSubscore(roles([['ramp', 11, 11], ['removal', 13, 10], ['cardDraw', 13, 9]]));
    expect(over.value).toBe(100);
    expect(over.value).toBe(met.value);
  });

  it('treats a zero role target as met', () => {
    expect(computeRolesSubscore(roles([['ramp', 11, 11], ['boardwipe', 0, 0]])).value).toBe(100);
  });

  it('charges a misplaced curve once, at the phase that is short', () => {
    const overLate = computeTempoSubscore(phases([['early', 33, 33], ['mid', 23, 26], ['late', 7, 4]]));
    const onLate = computeTempoSubscore(phases([['early', 33, 33], ['mid', 23, 26], ['late', 4, 4]]));
    expect(overLate.value).toBe(onLate.value);
    expect(overLate.value).toBeLessThan(100);
  });

  it('counts only widely played missing cards as gaps', () => {
    expect(computeCardFitSubscore([], gaps(40, 25)).value).toBe(100);
    expect(computeCardFitSubscore([], gaps(2, 60)).value).toBeLessThan(100);
  });

  // A 60-card Valgavoth list sat 23 staples short: Card Fit 80, both columns empty, no way up.
  it('keeps counting staples past the old cap of 14', () => {
    expect(computeCardFitSubscore([], gaps(14, 60)).value).toBeGreaterThan(computeCardFitSubscore([], gaps(20, 60)).value);
  });

  it('only counts a staple as missing when it outplays a card the deck runs', () => {
    const deck = [{ name: 'Weak', inclusion: 20, isLand: false }, { name: 'Strong', inclusion: 65, isLand: false }];
    const pairs = pairStaplesWithCuts(gaps(3, 60), deck);
    expect(pairs.map(p => p.cut.name)).toEqual(['Weak']);
  });

  // A Mycotyrant Self-Mill list showed Strategy 90 "+3 to gain" with nothing offered anywhere.
  it('scores Strategy on the theme swaps Card Fit offers', () => {
    const basis = { inTheme: 30, nonLand: 60, densityTarget: 18, hits: 15, hitTarget: 20, topNames: ['a', 'b', 'c'] };
    expect(strategyValue(basis)).toBe(90);
    const plan = composePlanScore({
      strategy: { ...scored(90), value: strategyValue(basis) },
      roles: scored(100), tempo: scored(100), cardFit: scored(100),
    });
    const analysis = { planScore: plan, misfits: [], strategyBasis: basis } as unknown as DeckAnalysis;
    // Nothing offered: nothing held back.
    expect(scoreAgainstSwaps(analysis, { removals: [], additions: [], themeAdds: [] }).planScore!.subscores.strategy.value).toBe(100);
    // Two top theme cards offered: those two are the way up, and taking both reaches 100.
    const two = scoreAgainstSwaps(analysis, { removals: [], additions: [], themeAdds: ['A', 'B'] });
    const s = two.planScore!.subscores.strategy.value;
    expect(s).toBeLessThan(100);
    const after = projectSwaps(two.planScore!, [], [], [{ in: 'A' }, { in: 'B' }], { basis: two.strategyBasis!, themeAdds: ['A', 'B'] });
    expect(after[after.length - 1]).toBe(100);
  });

  it('scores Card Fit on what its columns offer', () => {
    const plan = composePlanScore({
      strategy: scored(100),
      roles: scored(100),
      tempo: scored(100),
      cardFit: computeCardFitSubscore([], gaps(23, 60)),
    });
    const analysis = { planScore: plan, misfits: [] } as unknown as DeckAnalysis;
    // Nothing offered: nothing charged.
    expect(scoreAgainstSwaps(analysis, { removals: [], additions: [], stapleGaps: [] }).planScore!.overall).toBe(100);
    // Two staples offered: charged for those two only.
    const two = scoreAgainstSwaps(analysis, { removals: [], additions: [], stapleGaps: gaps(2, 60) });
    expect(two.planScore!.subscores.cardFit.value).toBe(computeCardFitSubscore([], gaps(2, 60)).value);
  });
});
