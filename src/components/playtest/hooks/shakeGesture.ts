/**
 * Shake-to-stack gesture detection.
 *
 * Tabletop Simulator's tidy gesture: grab a handful of cards, waggle the mouse,
 * and they snap into a neat pile. All we get from dnd-kit is a stream of drag
 * deltas, so a "shake" here is a run of direction reversals on one axis where
 * every swing clears a minimum distance — that separates a deliberate waggle
 * from the wobble of an ordinary drag across the table.
 *
 * Axes are tracked independently and either can fire, so a diagonal or vertical
 * shake counts too; nobody shakes perfectly horizontally.
 */

/** Minimum travel, in px, before a change of direction counts as a swing. */
const MIN_SWING = 18;
/** Reversals needed to call it a shake. Three ≈ two full back-and-forths. */
const REVERSALS = 3;
/** All of those reversals must land inside this window. */
const WINDOW_MS = 700;

interface Axis {
  /** Current direction of travel: +1, -1, or 0 before the first real move. */
  dir: number;
  /** The furthest point reached in `dir` — the swing measures back from here. */
  peak: number;
  /** Timestamps of recent reversals, pruned to WINDOW_MS. */
  reversals: number[];
}

export interface ShakeDetector {
  /**
   * Feed a drag position. Returns true on the frame the shake completes, and
   * only once — the caller doesn't have to debounce. Call `reset` per drag.
   */
  push: (x: number, y: number, now: number) => boolean;
  reset: () => void;
}

export function createShakeDetector(): ShakeDetector {
  let fired = false;
  const axes: Axis[] = [
    { dir: 0, peak: 0, reversals: [] },
    { dir: 0, peak: 0, reversals: [] },
  ];

  const pushAxis = (axis: Axis, v: number, now: number): boolean => {
    const travel = v - axis.peak;
    if (axis.dir === 0) {
      // Waiting for enough movement to establish a direction at all.
      if (Math.abs(travel) >= MIN_SWING) {
        axis.dir = Math.sign(travel);
        axis.peak = v;
      }
      return false;
    }
    if (Math.sign(travel) === axis.dir) {
      axis.peak = v;                    // still going: extend the peak
      return false;
    }
    if (Math.abs(travel) < MIN_SWING) return false;  // jitter, not a swing
    axis.dir = -axis.dir;
    axis.peak = v;
    axis.reversals.push(now);
    while (axis.reversals.length && now - axis.reversals[0] > WINDOW_MS) {
      axis.reversals.shift();
    }
    return axis.reversals.length >= REVERSALS;
  };

  return {
    push(x, y, now) {
      if (fired) return false;
      // Both axes always get the sample — a shake that drifts from horizontal
      // to vertical shouldn't reset the axis that was mid-count.
      const hit = pushAxis(axes[0], x, now) || pushAxis(axes[1], y, now);
      if (hit) fired = true;
      return hit;
    },
    reset() {
      fired = false;
      for (const a of axes) { a.dir = 0; a.peak = 0; a.reversals.length = 0; }
    },
  };
}
