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
