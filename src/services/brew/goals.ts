import type { BrewContext, BrewState, BrewGoal } from './brewTypes';
import { typeKey } from './health';
import { IDENTITY_COMMIT_THRESHOLD } from './identity';

/**
 * The "Brewer's Goal" — a soft objective the player can chase across the run, derived deterministically
 * from the commander so it's stable across resume/undo (no RNG). It gives the run a direction and a
 * payoff to nail (celebrated when met), without ever blocking: you can finish whether or not you hit it.
 *
 *  - combo:    the commander has known combos → "assemble one." The headline goal for most commanders.
 *  - wide:     a creature-dominant deck → flood the board.
 *  - identity: fallback → lean hard into a single strategy (commit a theme).
 */
const WIDE_TARGET = 12;

export function brewGoal(ctx: BrewContext): BrewGoal {
  if (ctx.combos.length > 0) {
    return { id: 'combo', label: 'Assemble a combo', description: 'Complete a combo from your picks — go infinite.', target: 1 };
  }
  const creatureTarget = ctx.typeTargets.creature ?? 0;
  if (creatureTarget >= ctx.nonLandTarget * 0.4) {
    return { id: 'wide', label: 'Build a board', description: `Draft ${WIDE_TARGET} creatures and flood the battlefield.`, target: WIDE_TARGET };
  }
  return { id: 'identity', label: 'Find your identity', description: 'Lean hard into a single strategy.', target: IDENTITY_COMMIT_THRESHOLD };
}

/** Owned card names (commander + partner + picks), front-face included for DFCs. */
function ownedSet(ctx: BrewContext, state: BrewState): Set<string> {
  const s = new Set<string>();
  const add = (n: string) => { s.add(n); if (n.includes(' // ')) s.add(n.split(' // ')[0]); };
  add(ctx.commander.name);
  if (ctx.partnerCommander) add(ctx.partnerCommander.name);
  for (const n of state.usedNames) add(n);
  return s;
}

/** How far along the run's goal is, and whether it's met. Pure read of (ctx, state). */
export function goalProgress(ctx: BrewContext, state: BrewState): { current: number; target: number; done: boolean } {
  const goal = brewGoal(ctx);
  let current = 0;
  if (goal.id === 'combo') {
    const owned = ownedSet(ctx, state);
    current = ctx.combos.filter(c => c.cards.length > 0 && c.cards.every(card => owned.has(card.name))).length;
  } else if (goal.id === 'wide') {
    current = state.picks.filter(p => typeKey(p.card.type_line) === 'creature').length;
  } else {
    const weights = Object.values(state.themeAffinity);
    current = weights.length ? Math.max(...weights) : 0;
  }
  return { current, target: goal.target, done: current >= goal.target };
}
