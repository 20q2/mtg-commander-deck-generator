import type { ScryfallCard } from '@/types';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';

export function makeInstanceId(): string {
  // crypto.randomUUID is available in modern browsers; the Vite dev server runs on https/localhost.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Fallback (very unlikely path).
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isLand(card: ScryfallCard): boolean {
  return getFrontFaceTypeLine(card).toLowerCase().includes('land');
}

export function isAuraOrEquipment(card: ScryfallCard): boolean {
  const tl = getFrontFaceTypeLine(card).toLowerCase();
  return tl.includes('aura') || tl.includes('equipment');
}

export function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface HitCard {
  instanceId: string;
  x: number;
  y: number;
  attachedTo?: string;
  tapped?: boolean;
  rotation?: number;
}

/**
 * Topmost battlefield card under a battlefield-space point, with the point
 * converted into that card's own unrotated space — the frame stickers and
 * counter badges are positioned in.
 *
 * A tapped card is drawn rotated about its centre, so the visible card and its
 * layout box only coincide when it's upright; rotating the point back by the
 * card's total rotation tests against what's actually on screen. Attached cards
 * are offset exactly as BattlefieldCard draws them, and are tested first since
 * Battlefield paints them above their parents.
 */
export function battlefieldCardAt<T extends HitCard>(
  cards: T[],
  x: number,
  y: number,
  cardWidth: number,
  cardHeight: number,
): { card: T; localX: number; localY: number } | null {
  // Same paint order as Battlefield: parents first, attached children after.
  const painted = [...cards].sort((a, b) => (a.attachedTo ? 1 : 0) - (b.attachedTo ? 1 : 0));
  for (let i = painted.length - 1; i >= 0; i--) {
    const c = painted[i];
    let cx = c.x;
    let cy = c.y;
    if (c.attachedTo) {
      const parent = cards.find(p => p.instanceId === c.attachedTo);
      if (parent) {
        const idx = cards.filter(s => s.attachedTo === c.attachedTo).findIndex(s => s.instanceId === c.instanceId);
        cx = parent.x + (idx + 1) * 8;
        cy = parent.y + (idx + 1) * 28;
      }
    }
    // Undo the card's rotation about its centre to land in card space.
    const rad = (-((c.tapped ? 90 : 0) + (c.rotation ?? 0)) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = x - (cx + cardWidth / 2);
    const dy = y - (cy + cardHeight / 2);
    const localX = cardWidth / 2 + dx * cos - dy * sin;
    const localY = cardHeight / 2 + dx * sin + dy * cos;
    if (localX >= 0 && localX <= cardWidth && localY >= 0 && localY <= cardHeight) {
      return { card: c, localX, localY };
    }
  }
  return null;
}

/** Snap rule for cards arriving on the battlefield from another zone. */
export function snapArrival(
  card: ScryfallCard,
  rawX: number,
  _rawY: number,
  containerHeight: number,
  cardHeight = 140,
): { x: number; y: number } {
  const margin = 16;
  // Deliberately blind to the opponent seats. This used to take their measured
  // height and drop non-lands below it, so a creature never arrived underneath
  // an opaque seat — but that made where YOUR cards land a function of how big
  // somebody else's area happened to be, and the seats both grow on their own
  // and are drag-resizable. A card that lands under a seat can be dragged out,
  // or the seat moved; a table that rearranges itself around the bots cannot
  // be undone.
  const y = isLand(card) ? Math.max(margin, containerHeight - cardHeight - margin) : margin;
  return { x: rawX, y };
}

/**
 * Find a non-overlapping slot for an arriving card. Starts at (startX,startY),
 * bumps right by 0.75 * card width, and wraps to a new row when out of horizontal
 * space. Lands move up (their snap is the bottom row), spells move down.
 */
export function findArrivalSlot(
  battlefield: { x: number; y: number }[],
  startX: number,
  startY: number,
  containerWidth: number,
  containerHeight: number,
  goingUp: boolean,
  cardWidth = 100,
  cardHeight = 140,
): { x: number; y: number } {
  if (containerWidth <= 0 || containerHeight <= 0) return { x: startX, y: startY };
  const stepX = Math.round(cardWidth * 0.75);
  const stepY = cardHeight + 8;
  const margin = 16;
  const overlaps = (x: number, y: number) =>
    battlefield.some(b => Math.abs(b.x - x) < cardWidth && Math.abs(b.y - y) < cardHeight);
  let x = startX;
  let y = startY;
  const minY = margin;
  const maxY = Math.max(margin, containerHeight - cardHeight - margin);
  for (let row = 0; row < 12; row++) {
    while (x + cardWidth <= containerWidth - margin) {
      if (!overlaps(x, y)) return { x, y };
      x += stepX;
    }
    x = startX;
    y = goingUp ? y - stepY : y + stepY;
    if (y < minY || y > maxY) {
      y = goingUp ? minY : maxY;
      while (x + cardWidth <= containerWidth - margin) {
        if (!overlaps(x, y)) return { x, y };
        x += stepX;
      }
      return { x: startX, y };
    }
  }
  return { x: startX, y: startY };
}

/**
 * Where a card dropped at `pointerX` would land in the hand.
 *
 * Returns two different numbers on purpose. `index` is the hand index the move
 * needs; `fanPos` is the position in the rendered row, which is what the cards
 * part around. They diverge whenever the hand is sorted, because then the row
 * order is not the hand order.
 *
 * Midpoints come from layout position (`offsetLeft`), never from
 * `getBoundingClientRect`. The rect includes the parting transform, so
 * measuring it would let the gap move the very cards that decide where the gap
 * belongs — the answer would oscillate around every seam. Layout position is
 * unaffected by the cards' transforms, so the decision stays still while the
 * animation plays over it.
 */
export function handInsertAt(pointerX: number): { index: number; fanPos: number } {
  const els = Array.from(document.querySelectorAll<HTMLElement>('[data-hand-index]'));
  if (els.length === 0) return { index: 0, fanPos: 0 };
  // Every hand card is `relative`, so they all share one offsetParent — the
  // untransformed row container.
  const parent = els[0].offsetParent as HTMLElement | null;
  const parentLeft = parent ? parent.getBoundingClientRect().left : 0;
  for (let i = 0; i < els.length; i++) {
    const mid = parentLeft + els[i].offsetLeft + els[i].offsetWidth / 2;
    if (pointerX < mid) {
      return { index: Number(els[i].dataset.handIndex), fanPos: i };
    }
  }
  return { index: els.length, fanPos: els.length };
}
