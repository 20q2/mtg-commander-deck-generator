import type { BrewContext, BrewState, BrewNode } from './brewTypes';
import { buildPackNode } from './nodes';
import { isComplete } from './health';

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
