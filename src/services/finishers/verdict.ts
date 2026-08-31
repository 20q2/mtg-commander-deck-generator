/** Stage 4 — roll every estimate up into one read on whether the deck can close. */

import type { KillEstimate, DeckFinisherVerdict } from '@/types';
import type { FinisherAssumptions } from './tuning';

export function summarise(
  estimates: KillEstimate[], a: FinisherAssumptions,
): DeckFinisherVerdict {
  // Non-finite guard as well as null: one NaN fraction would otherwise propagate through both
  // Math.max and the sum and render the entire headline unreadable.
  const scored = estimates.filter(e => e.tableFraction !== null && isFinite(e.tableFraction));
  const bestSingle = scored.reduce((m, e) => Math.max(m, e.tableFraction ?? 0), 0);
  const combined = Math.min(1, scored.reduce((s, e) => s + (e.tableFraction ?? 0), 0));
  const density = estimates.filter(e => e.tier === 'LIVE').length;

  const label = bestSingle < a.liveThreshold ? 'no way to close'
    : bestSingle < 0.6 ? 'grindy — needs multiple turns'
      : bestSingle < 1 ? 'has a finisher'
        : 'redundant kills';

  return { bestSingle, combined, density, label };
}

/** Estimates worth showing, best first. Modifiers and unknowns sink to the bottom. */
export function rankEstimates(estimates: KillEstimate[]): KillEstimate[] {
  return [...estimates].sort((x, y) => (y.tableFraction ?? -1) - (x.tableFraction ?? -1));
}
