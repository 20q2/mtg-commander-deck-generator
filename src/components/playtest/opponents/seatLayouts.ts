/**
 * Preset arrangements for the bot seats.
 *
 * Seats can be dragged and resized one at a time, which is the right tool for
 * "make THAT one bigger" and the wrong one for "tidy this up": three bots take
 * six gestures to line up and they still end up a few pixels out. These are the
 * arrangements worth having as one click.
 *
 * Every plan is computed from the canvas and the seats currently on it, not
 * stored — so the same preset re-applied after resizing the window lays the
 * table out for the window you actually have.
 */

/**
 * A hand-set size can go well past the automatic ceiling — the whole point of
 * resizing a seat is to make one opponent big enough to actually read.
 */
export const RESIZE_MIN_W = 160;
export const RESIZE_MAX_W = 900;
/** Tall enough to still show a header and a combat strip. */
export const RESIZE_MIN_H = 110;
export const RESIZE_MAX_H = 900;

/** Breathing room between seats, and between a seat and the table's edge. */
const GAP = 8;
/**
 * Kept clear along the bottom of the canvas. The Untap chip and the Next Turn
 * button live down there, and a preset that parked a seat on top of the one
 * control you press every turn would be worse than no preset.
 */
const BOTTOM_RESERVE = 56;
/**
 * Kept clear along the top-right corner, where the ＋ and this menu's own
 * button live. A seat laid out flush to that edge puts its header controls
 * under them, and the two sets of buttons are a pixel apart.
 */
const TOP_RIGHT_RESERVE = 36;

export type SeatLayoutKind = 'row' | 'spread' | 'rail' | 'flank';

/** Either axis may be unset, meaning "whatever the content wants". */
export interface SeatBox { w?: number; h?: number }

export interface SeatLayoutPlan {
  /** Seat id → its place on the canvas. Empty means "back in the auto row". */
  positions: Record<string, { x: number; y: number }>;
  sizes: Record<string, SeatBox>;
}

/** In menu order. The default first, so the way back is the top item. */
export const SEAT_LAYOUTS: { kind: SeatLayoutKind; label: string }[] = [
  { kind: 'row',    label: 'Centred row' },
  { kind: 'spread', label: 'Spread across the top' },
  { kind: 'rail',   label: 'Column down the left' },
  { kind: 'flank',  label: 'Left and right edges' },
];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export interface Canvas { width: number; height: number }

/**
 * Where each seat goes under one preset.
 *
 * `row` is the empty plan on purpose: no position and no size IS the automatic
 * row, so the default layout is the absence of a layout rather than a fourth
 * set of coordinates that happens to look like it.
 */
export function planSeatLayout(kind: SeatLayoutKind, ids: string[], canvas: Canvas): SeatLayoutPlan {
  const empty: SeatLayoutPlan = { positions: {}, sizes: {} };
  // A canvas that hasn't been measured yet can only be laid out wrongly.
  if (kind === 'row' || ids.length === 0 || canvas.width === 0 || canvas.height === 0) return empty;

  const n = ids.length;
  const usableH = Math.max(RESIZE_MIN_H + GAP * 2, canvas.height - BOTTOM_RESERVE);
  const usableW = Math.max(RESIZE_MIN_W + GAP * 2, canvas.width - TOP_RIGHT_RESERVE);
  const plan: SeatLayoutPlan = { positions: {}, sizes: {} };
  const place = (id: string, x: number, y: number, w: number, h: number) => {
    plan.positions[id] = { x: Math.round(Math.max(GAP, x)), y: Math.round(Math.max(GAP, y)) };
    plan.sizes[id] = { w, h };
  };

  if (kind === 'spread') {
    // One band along the top, split evenly. Widest seats of any preset, which
    // is the point: this is the layout for reading their boards.
    const w = clamp(Math.round((usableW - GAP * (n + 1)) / n), RESIZE_MIN_W, RESIZE_MAX_W);
    const h = clamp(Math.round(canvas.height * 0.45), RESIZE_MIN_H, RESIZE_MAX_H);
    const span = n * w + (n - 1) * GAP;
    const startX = Math.max(GAP, Math.round((usableW - span) / 2));
    ids.forEach((id, i) => place(id, startX + i * (w + GAP), GAP, w, h));
    return plan;
  }

  if (kind === 'rail') {
    // Stacked down one edge, narrow. Costs you the least board: everything
    // right of the rail is yours, all the way down.
    const w = clamp(Math.round(Math.min(260, canvas.width * 0.22)), RESIZE_MIN_W, RESIZE_MAX_W);
    const h = clamp(Math.round((usableH - GAP * (n + 1)) / n), RESIZE_MIN_H, RESIZE_MAX_H);
    ids.forEach((id, i) => place(id, GAP, GAP + i * (h + GAP), w, h));
    return plan;
  }

  // flank: half down each edge, leaving the middle of the table open. With one
  // seat that is simply the left edge; the third goes under the first, so the
  // heavier side is the one you started reading.
  const left = Math.ceil(n / 2);
  const w = clamp(Math.round(Math.min(280, canvas.width * 0.24)), RESIZE_MIN_W, RESIZE_MAX_W);
  const rows = Math.max(left, n - left);
  const h = clamp(Math.round((usableH - GAP * (rows + 1)) / rows), RESIZE_MIN_H, RESIZE_MAX_H);
  const rightX = Math.max(GAP, usableW - w - GAP);
  ids.forEach((id, i) => {
    const onLeft = i < left;
    const slot = onLeft ? i : i - left;
    place(id, onLeft ? GAP : rightX, GAP + slot * (h + GAP), w, h);
  });
  return plan;
}

/**
 * Whether the table is currently arranged exactly as this preset would arrange
 * it — used to tick the one you are looking at. A seat nudged by hand, or a
 * window resized since, simply stops matching, which is the honest answer.
 */
export function matchesPlan(
  plan: SeatLayoutPlan,
  positions: Record<string, { x: number; y: number }>,
  sizes: Record<string, SeatBox>,
): boolean {
  const sameKeys = (a: object, b: object) =>
    Object.keys(a).length === Object.keys(b).length;
  if (!sameKeys(plan.positions, positions) || !sameKeys(plan.sizes, sizes)) return false;
  for (const [id, p] of Object.entries(plan.positions)) {
    const q = positions[id];
    if (!q || q.x !== p.x || q.y !== p.y) return false;
  }
  for (const [id, s] of Object.entries(plan.sizes)) {
    const t = sizes[id];
    if (!t || t.w !== s.w || t.h !== s.h) return false;
  }
  return true;
}
