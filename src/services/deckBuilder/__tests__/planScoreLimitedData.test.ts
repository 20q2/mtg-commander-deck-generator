import { describe, it, expect } from 'vitest';
import {
  composePlanScore, computeStrategySubscore, computeRolesSubscore, computeTempoSubscore,
} from '../planScore';
import type { SubScore } from '@/types';

/**
 * "Limited EDHREC data for this commander — some sub-scores excluded" appeared on a Glissa deck
 * with 1,787 decklists behind it. The message was false: `limitedData` was set by ANY partial
 * sub-score, and strategy is partial whenever the deck has no theme — which is the user's to fix
 * and says nothing at all about EDHREC's coverage.
 *
 * Two different causes wearing one flag, and the wrong one was named. These pin them apart.
 */
const scored = (value: number): SubScore => ({ value, surface: 'ok' });

const compose = (over: Partial<Record<'strategy' | 'roles' | 'tempo' | 'cardFit', SubScore>>) =>
  composePlanScore({
    strategy: scored(70), roles: scored(70), tempo: scored(70), cardFit: scored(70),
    ...over,
  });

describe('limitedData names the real cause', () => {
  it('is false when the only gap is a missing theme', () => {
    const strategy = computeStrategySubscore({ cards: [], themeMembership: null });
    expect(strategy.partial).toBe(true);
    expect(strategy.partialReason).toBe('no-theme');
    expect(compose({ strategy }).limitedData).toBe(false);
  });

  it('is true when EDHREC genuinely gave us nothing to score', () => {
    const roles = computeRolesSubscore([]);
    expect(roles.partialReason).toBe('no-data');
    expect(compose({ roles }).limitedData).toBe(true);

    const tempo = computeTempoSubscore([]);
    expect(tempo.partialReason).toBe('no-data');
    expect(compose({ tempo }).limitedData).toBe(true);
  });

  it('is true when both apply — a real data gap is still worth saying', () => {
    const plan = compose({
      strategy: computeStrategySubscore({ cards: [], themeMembership: null }),
      tempo: computeTempoSubscore([]),
    });
    expect(plan.limitedData).toBe(true);
  });

  it('still excludes an unscored area from the composite, whatever the reason', () => {
    // Strategy would otherwise contribute 0 and drag a good deck down for a question it was
    // never asked. 70 across every scored area must stay 70.
    const plan = compose({ strategy: computeStrategySubscore({ cards: [], themeMembership: null }) });
    expect(plan.overall).toBe(70);
  });

  it('is false when nothing is partial at all', () => {
    expect(compose({}).limitedData).toBe(false);
  });
});
