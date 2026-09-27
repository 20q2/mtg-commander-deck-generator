import { usePlaytestSettings } from '@/store/playtestSettingsStore';

/**
 * Combat, paced out one creature at a time.
 *
 * Resolving an attack used to be a single frame: every death, every point of
 * life and every graveyard move landed together, and the only way to know what
 * had happened was to read the log afterwards. The fight was over before it was
 * legible.
 *
 * So each attacker gets a beat of its own: the card leans into its attack where
 * it stands in the combat strip, and the damage, the death and the sound all
 * land on the frame it is furthest forward. The board state is unchanged by any
 * of this; the beats only decide *when* the store applies each part of a
 * resolution it has already worked out.
 *
 * It used to throw a ghost of the card across the table at whatever it was
 * fighting. That read as the creature LEAVING the fight — chasing a life
 * counter that lives up in the toolbar, nowhere near the board — when what a
 * swing actually looks like is a creature leaning at you and settling back.
 *
 * Nothing here is allowed to be load-bearing. A card that cannot be found — a
 * seat folded away on a phone, a strip scrolled off — simply does not move, and
 * the beat applies its damage on schedule regardless. See `lungeAt`.
 */

/**
 * Where in the lunge the hit lands. Matches the forward keyframe in `lungeAt`,
 * and the two have to move together: this is the number the store waits out
 * before taking the life off, and a mismatch shows up as damage that lands
 * while the card is still winding up.
 */
const IMPACT_FRACTION = 0.82;

/** An unhurried beat: one creature, connecting, with room around it. */
const FULL_BEAT_MS = 230;
/**
 * How long the whole exchange may take before the beats start compressing.
 * Past a handful of attackers the pacing matters less than the pace — an alpha
 * strike should feel like a flurry, not a queue.
 */
const SEQUENCE_BUDGET_MS = 1500;
/** However big the swarm, a beat never gets shorter than this. */
const MIN_BEAT_MS = 55;
/** Nor does a lunge get faster than this, or there is nothing to see. */
const MIN_STRIKE_MS = 130;
/**
 * And never slower. A five-creature attack is five of these end to end, so a
 * lunge has to be over about as fast as a real one.
 */
const LUNGE_MS = 260;

export interface StrikePacing {
  /** Gap between one attacker's lunge and the next's. */
  beatMs: number;
  /** How long after a lunge starts that it connects. */
  impactMs: number;
  /** The lunge's own travel time, so contact lands on `impactMs`. */
  lungeMs: number;
}

/**
 * How fast to play `count` attackers. One beat each until the exchange would
 * outstay the budget, then tighter — and the lunge shortens with the beat, so
 * a compressed sequence stays in step rather than trailing ghosts behind it.
 */
export function strikePacing(count: number): StrikePacing {
  const beatMs = Math.max(
    MIN_BEAT_MS,
    Math.min(FULL_BEAT_MS, count > 0 ? SEQUENCE_BUDGET_MS / count : FULL_BEAT_MS),
  );
  const lungeMs = Math.max(MIN_STRIKE_MS, Math.min(LUNGE_MS, beatMs / IMPACT_FRACTION));
  return { beatMs, impactMs: lungeMs * IMPACT_FRACTION, lungeMs };
}

/**
 * The card standing for an attacker in a combat strip.
 *
 * `~=` rather than `=` because the strip collapses identical attackers into one
 * slot: fifty-two goblins are one card with a count on it, and every one of
 * them has to be able to find the card that is standing in for it.
 */
function attackerCard(instanceId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(instanceId) : instanceId;
  return document.querySelector<HTMLElement>(`[data-attackers~="${escaped}"]`);
}

/**
 * A creature leaning into its attack, where it stands.
 *
 * A short wind-up away from the defender, a shove towards them that peaks on
 * the frame the damage lands, and back to rest. The real element animates
 * rather than a copy of it, which it can do because the card ends exactly
 * where it began: combat relocates nothing, and nothing here may leave a
 * transform behind on a card that has to keep sitting in a flex row.
 *
 * `towards` is a side of the table rather than a measured target. The obvious
 * thing — aim at what is being hit — is wrong for the commonest case: an
 * unblocked attacker is hitting a life total, and life totals are drawn in the
 * toolbar and the seat headers, so the creatures would lunge AWAY from the
 * player they are attacking to chase a number at the top of the screen.
 *
 * Returns whether anything actually moved, which callers may use for logging
 * but must never gate state on.
 */
export function lungeAt(
  instanceId: string,
  towards: 'player' | 'seat',
  pacing: StrikePacing,
): boolean {
  if (!usePlaytestSettings.getState().animations) return false;

  const el = attackerCard(instanceId);
  if (!el) return false;
  const box = el.getBoundingClientRect();
  // The card's long side, not its height: your attackers are drawn turned
  // sideways in the strip and theirs are not, and measuring the box would give
  // the two sides of the table visibly different lunges for the same card.
  const span = Math.max(box.width, box.height);
  if (span === 0) return false;

  // Down the screen at the player, up it at the seat. Scaled off the card so a
  // strip zoomed small nudges small — and capped, because past about a third of
  // a card the lunge stops reading as a lean and starts reading as a jump.
  const dir = towards === 'player' ? 1 : -1;
  const reach = dir * Math.max(7, Math.min(24, Math.round(span * 0.17)));
  const wind = -dir * Math.max(2, Math.round(Math.abs(reach) * 0.3));

  // Long enough to have a recovery in it: the beat is over at `impactMs`, and
  // the settle back plays out under the next creature's wind-up.
  const duration = Math.round(pacing.lungeMs * 1.5);
  const hit = pacing.impactMs / duration;

  el.animate(
    [
      { transform: 'translate3d(0,0,0) scale(1)', offset: 0 },
      // The wind-up is what sells it. Without it the card simply slides, and
      // there is no moment the eye can read as the decision to attack.
      {
        transform: `translate3d(0,${wind}px,0) scale(0.99)`,
        offset: Math.max(0.04, hit * 0.45),
        easing: 'cubic-bezier(0.3, 0, 0.2, 1)',
      },
      {
        transform: `translate3d(0,${reach}px,0) scale(1.07)`,
        offset: hit,
        easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
      },
      { transform: 'translate3d(0,0,0) scale(1)', offset: 1 },
    ],
    // `fill: none` deliberately: the card must be back under the layout's
    // control the instant this is over, or a strip that re-flows around it
    // leaves it sitting a few pixels out of its own slot.
    { duration, easing: 'ease-out', fill: 'none' },
  );
  return true;
}
