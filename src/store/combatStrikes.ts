import { useCardFlights, STRIKE_MS } from '@/components/playtest/CardFlight';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import type { ScryfallCard } from '@/types';

/**
 * Combat, paced out one creature at a time.
 *
 * Resolving an attack used to be a single frame: every death, every point of
 * life and every graveyard move landed together, and the only way to know what
 * had happened was to read the log afterwards. The fight was over before it was
 * legible.
 *
 * So each attacker gets a beat of its own. A ghost of the card lunges at what
 * it is fighting — its blocker, or the seat's life total when nothing is in the
 * way — and the damage, the death and the sound all land on the frame it
 * arrives. The board state is unchanged by any of this; the beats only decide
 * *when* the store applies each part of a resolution it has already worked out.
 *
 * Nothing here is allowed to be load-bearing. A ghost that cannot be measured —
 * a seat folded away on a phone, a card scrolled off — simply does not fly, and
 * the beat applies its damage on schedule regardless. See `strikeAt`.
 */

/**
 * Where in the flight the hit lands. Matches the impact keyframe in
 * `strikeFrames`, and the two have to move together: this is the number the
 * store waits out before taking the life off, and a mismatch shows up as
 * damage that lands early or a ghost that has already bounced.
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

export interface StrikePacing {
  /** Gap between one attacker's lunge and the next's. */
  beatMs: number;
  /** How long after a lunge starts that it connects. */
  impactMs: number;
  /** Flight time handed to the layer, so impact lands on `impactMs`. */
  flightMs: number;
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
  const flightMs = Math.max(MIN_STRIKE_MS, Math.min(STRIKE_MS, beatMs / IMPACT_FRACTION));
  return { beatMs, impactMs: flightMs * IMPACT_FRACTION, flightMs };
}

/** The `data-float-id` a seat's life total answers to. */
export function seatLifeAnchor(opponentId: string): string {
  return `opp-life-${opponentId}`;
}

/**
 * The live rect of whatever answers to a `data-float-id`.
 *
 * Deliberately not `boxOf` from the flight layer: that drops the height,
 * because a zone flight lands on a pile of cards and a card's height follows
 * from its width. A strike aims at two very differently shaped things — a
 * blocker, which is a card, and a life total, which is a small pill — so it
 * needs to know how tall the target actually is to hit the middle of it.
 */
function anchorRect(floatId: string): { x: number; y: number; width: number; height: number } | null {
  if (typeof document === 'undefined') return null;
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(floatId) : floatId;
  const el = document.querySelector<HTMLElement>(`[data-float-id="${escaped}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0) return null;
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

/**
 * Throw a ghost of `card` from the attacker at whatever it is fighting.
 *
 * Both ends are measured off the live DOM at the moment of the beat, which is
 * why this must be called while the attacker and its target are both still on
 * the board — a blocker measured after it has been buried has no box left. The
 * ghost is a copy: combat relocates nothing, so the real card must not appear
 * to move.
 *
 * Returns whether anything actually flew, which callers may use for logging but
 * must never gate state on.
 */
export function strikeAt(
  attackerInstanceId: string,
  card: ScryfallCard,
  targetFloatId: string,
  pacing: StrikePacing,
): boolean {
  if (!usePlaytestSettings.getState().animations) return false;

  const from = anchorRect(attackerInstanceId);
  const to = anchorRect(targetFloatId);
  if (!from || !to) return false;

  useCardFlights.getState().launch([
    {
      card,
      from: { x: from.x, y: from.y, width: from.width },
      // The ghost keeps the attacker's own size and is merely aimed at the
      // middle of the target. Landing at the target's width instead would
      // shrink a creature to a chip against a life pill on the very frame it
      // is supposed to hit hardest — and blow a token up against a big card.
      //
      // Centre on centre, so the impact reads at the thing being hit rather
      // than at a corner of it. The flight layer positions by top-left.
      to: {
        x: to.x + to.width / 2 - from.width / 2,
        y: to.y + to.height / 2 - from.height / 2,
        width: from.width,
      },
      delay: 0,
      duration: pacing.flightMs,
      strike: true,
    },
  ]);
  return true;
}
