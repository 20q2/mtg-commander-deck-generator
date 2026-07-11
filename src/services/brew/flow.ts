import type { BrewContext, BrewState, BrewNode } from './brewTypes';
import { buildPackNode } from './nodes';
import { isComplete } from './health';
import { nextEvent, comboFragmentEvent, MIN_MOMENT_GAP } from './events';
import { FIRST_PHILOSOPHY_AT } from './relics';
import { nextQuestion } from './questions';
import { deckFill, IDENTITY_PHASE_FILL } from './scoring';

/**
 * Run cadence: the player opens a pack at each node, and every STEER_EVERY-th node is a "moment"
 * (the steering fork / an event / a relic) instead. With STEER_EVERY = 4 that reads as "three
 * packs, then a moment" — the rhythm the upcoming-track surfaces under the health bar.
 */
export const STEER_EVERY = 4;

/**
 * Is the node shown at this history length a steering "moment" rather than a pack? The moment lands
 * on the last node of each STEER_EVERY-sized cycle (indices 3, 7, 11… for STEER_EVERY = 4), so each
 * cycle is (STEER_EVERY − 1) packs followed by one moment. Shared by advanceAfterPick and the track.
 */
export function isSteerIndex(historyLen: number): boolean {
  return (historyLen + 1) % STEER_EVERY === 0;
}

/**
 * What to show after a pick:
 *  - `null` → surface the steering fork (BrewPath) / event / relic. Happens at each steer node, once
 *    the deck is complete, or when the only move left is the mana base.
 *  - a `BrewNode` → keep the player opening packs.
 *
 * Pure: derived entirely from (ctx, state). The store calls this after applyPick.
 */
export function advanceAfterPick(ctx: BrewContext, state: BrewState): BrewNode | null {
  if (isComplete(ctx, state)) return null;
  if (isSteerIndex(state.history.length)) return null;   // steering moment → surface the fork
  // Between moments, keep the player opening packs. Combos and elite drafts are deliberate moves
  // elected at the fork, so they never auto-open. An empty pool returns null → mana base.
  return buildPackNode(ctx, state);
}

// --- Acts: naming the phases the engine already has -------------------------
// The run always had three internal phases (identity fill < 0.3 → engine-building → complete +
// capstone); the acts NAME them so the pack mix changing character reads as story structure, not
// as arbitrary. Pure presentation: nothing below changes what any phase actually does.

export interface BrewAct {
  act: 1 | 2 | 3;
  title: string;      // "The Spark"
  numeral: string;    // "Act I"
}

const ACTS: BrewAct[] = [
  { act: 1, numeral: 'Act I', title: 'The Spark' },      // identity forms (fill < IDENTITY_PHASE_FILL)
  { act: 2, numeral: 'Act II', title: 'The Engine' },    // deficits steer; the deck gets built
  { act: 3, numeral: 'Act III', title: 'The Finish' },   // complete → capstone → recap
];

/** Which act the run is in right now. Thresholds mirror the engine's real phase boundaries. */
export function currentAct(ctx: BrewContext, state: BrewState): BrewAct {
  if (isComplete(ctx, state)) return ACTS[2];
  return deckFill(ctx, state) < IDENTITY_PHASE_FILL ? ACTS[0] : ACTS[1];
}

/** How many upcoming nodes the fate-map forecasts. */
export const HORIZON_LENGTH = 5;
/** Mirrors the store's SECOND_QUESTION_AT (kept local so the engine never imports the store). */
const QUESTION_AT = 8;

export type HorizonMomentCategory = 'philosophy' | 'combo' | 'question' | 'unknown';
export type HorizonSlot =
  | { kind: 'pack' }
  | { kind: 'moment'; category: HorizonMomentCategory }
  | { kind: 'manabase' };

/**
 * The fate-map: a forecast of the next HORIZON_LENGTH nodes, dry-running the same priority chain
 * the store resolves at steer time (relic → event → question → fork). Honest by construction — a
 * moment only names its category when the prediction is stable under future picks:
 *  - philosophy: the relic check is FIRST in the chain and its two conditions (no relic yet, pick
 *    threshold met) are monotone in picks, so once due it stays due;
 *  - combo: the moment gap already passes NOW (monotone — picks only grow, lastMomentPick is fixed
 *    until the moment itself) and a near-miss combo exists, the top of the event chain;
 *  - question: due and nothing currently eligible to preempt it.
 * Anything genuinely dependent on future picks is 'unknown' — the "?" rune (a wrong icon is worse
 * than a rune). Only the NEAREST steer slot is forecast; later steers are always 'unknown'.
 * Pure: derived entirely from (ctx, state).
 */
export function peekHorizon(ctx: BrewContext, state: BrewState): HorizonSlot[] {
  if (isComplete(ctx, state)) return [{ kind: 'manabase' }];
  const slots: HorizonSlot[] = [];
  let firstSteerSeen = false;
  for (let i = state.history.length; slots.length < HORIZON_LENGTH; i++) {
    if (!isSteerIndex(i)) { slots.push({ kind: 'pack' }); continue; }
    slots.push({ kind: 'moment', category: firstSteerSeen ? 'unknown' : forecastMoment(ctx, state) });
    firstSteerSeen = true;
  }
  return slots;
}

function forecastMoment(ctx: BrewContext, state: BrewState): HorizonMomentCategory {
  if (state.relics.length === 0 && state.picks.length >= FIRST_PHILOSOPHY_AT) return 'philosophy';
  const gapOkNow = state.picks.length - state.lastMomentPick >= MIN_MOMENT_GAP;
  if (gapOkNow && comboFragmentEvent(ctx, state)) return 'combo';
  if (state.picks.length >= QUESTION_AT && !nextEvent(ctx, state) && nextQuestion(ctx, state)) return 'question';
  return 'unknown';
}
