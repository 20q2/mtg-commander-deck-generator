import type { BrewContext, BrewState, BrewNode } from './brewTypes';
import { nextRoutes } from './routes';
import { openNode } from './nodes';
import { isComplete } from './health';

/**
 * Decisions between steers. You shouldn't have to choose a path after every pick — so between
 * steers the engine auto-routes to the deck's current top need and you just pick cards. The
 * steering fork returns every STEER_EVERY decisions.
 */
export const STEER_EVERY = 5;

/**
 * What to show after a pick:
 *  - `null` → surface the steering fork (BrewPath). Happens at every STEER_EVERY-th decision, once
 *    the deck is complete, or when the only move left is the mana base.
 *  - a `BrewNode` → keep the player picking cards, auto-routed to the current top need.
 *
 * Pure: derived entirely from (ctx, state). The store calls this after applyPick.
 */
export function advanceAfterPick(ctx: BrewContext, state: BrewState): BrewNode | null {
  if (isComplete(ctx, state)) return null;
  if (state.history.length % STEER_EVERY === 0) return null;   // steering milestone
  // Auto-turns are plain "choose a card" draws toward the deck's current needs. Combos and
  // lightning rounds are deliberate moves the player elects at the steer fork — not something to
  // auto-route into — so skip them here. No draftable need left → surface the fork (mana base / finish).
  const route = nextRoutes(ctx, state).find(r => r.type === 'draft' || r.type === 'bundle');
  if (!route) return null;
  return openNode(ctx, state, route);
}
