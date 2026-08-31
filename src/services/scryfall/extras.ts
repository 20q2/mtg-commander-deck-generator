// src/services/scryfall/extras.ts
import type { ScryfallCard } from '@/types';

/**
 * Scryfall layouts for "extras" — printed objects that can never go in a deck.
 *
 * These matter far more than they look like they should, because both card caches
 * (the in-memory Map and the Dexie `cards` table) are keyed by NAME, and an extra can
 * share its name with a real card. Every embalm/eternalize token is a name-identical
 * copy of its parent: Scryfall's "Fanatic of Rhonas" token is a 4/4 BLACK Zombie Snake
 * Druid with color identity {B,G}, against the creature's {G}. Cache that under its
 * name and it silently stands in for the real card on every later lookup — which
 * surfaces downstream as a color-identity violation, a 0-cost curve entry, a $0 price,
 * and a card that's illegal in every format.
 */
const EXTRA_LAYOUTS = new Set([
  'token',
  'double_faced_token',
  'emblem',
  'art_series',
]);

/**
 * True for token / emblem / art-series printings. Use it before writing any card into
 * a name-keyed cache, and before handing a card to deck-building code.
 *
 * `layout` is the authority; the type-line test is a fallback for entries cached before
 * `layout` was stored. No real card's type line starts with "Token" or "Emblem".
 */
export function isExtraPrinting(
  card: Pick<ScryfallCard, 'layout' | 'type_line'> | null | undefined,
): boolean {
  if (!card) return false;
  if (card.layout && EXTRA_LAYOUTS.has(card.layout)) return true;
  return /^(?:Token|Emblem)\b/.test(card.type_line ?? '');
}
