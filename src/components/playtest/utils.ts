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
