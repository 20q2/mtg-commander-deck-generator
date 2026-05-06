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
