import type { ScryfallCard } from '@/types';
import { searchCards, getCardsByIds } from '@/services/scryfall/client';

/**
 * Resolves the tokens this deck can actually create by walking each card's
 * Scryfall `all_parts` field for entries with component === 'token'.
 *
 * Token cards are fetched in a single batched POST to /cards/collection.
 * Results are cached in-memory per session (keyed by sorted token-id list).
 *
 * Returns deduped tokens, preserving first-encountered order so the
 * commanders' tokens tend to surface near the top.
 */
const deckTokensCache = new Map<string, ScryfallCard[]>();

export async function resolveDeckTokens(deckCards: ScryfallCard[]): Promise<ScryfallCard[]> {
  // Collect unique token ids (preserve order of first appearance)
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const card of deckCards) {
    const parts = card.all_parts ?? [];
    for (const p of parts) {
      if (p.component !== 'token') continue;
      // Skip self-references (some cards include themselves in all_parts)
      if (p.id === card.id) continue;
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      ids.push(p.id);
    }
  }
  if (ids.length === 0) return [];

  const cacheKey = [...ids].sort().join(',');
  const cached = deckTokensCache.get(cacheKey);
  if (cached) return cached;

  // Goes through the central rate limiter + persistent cache.
  const byId = await getCardsByIds(ids);
  const cards: ScryfallCard[] = [];
  for (const id of ids) {
    const card = byId.get(id);
    if (card) cards.push(card);
  }

  // Dedupe by name + type_line so different printings of the "same" token
  // (different art / set) only appear once in the spawn list.
  const seenKey = new Set<string>();
  const deduped: ScryfallCard[] = [];
  for (const c of cards) {
    const key = `${c.name.toLowerCase()}|${c.type_line.toLowerCase()}`;
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    deduped.push(c);
  }

  deckTokensCache.set(cacheKey, deduped);
  return deduped;
}

/**
 * Color-identity-based token search. Used as a fallback when the deck has
 * no all_parts data (e.g. older cached cards without that field).
 */
export async function resolveTokens(colorIdentity: string): Promise<ScryfallCard[]> {
  const ci = colorIdentity ? colorIdentity.toUpperCase().split('') : [];
  const query = ci.length === 0 ? 'is:token id:c' : 'is:token';
  try {
    const response = await searchCards(query, ci, {
      order: 'edhrec',
      skipFormatFilter: true,
    });
    return (response.data ?? [])
      .filter((c: ScryfallCard & { set_type?: string }) => c.set_type === 'token')
      .slice(0, 60);
  } catch {
    return [];
  }
}

/** Derives a color-identity string ('WUBRG' subset) from the command zone cards. */
export function deriveColorIdentity(commanders: ScryfallCard[]): string {
  const set = new Set<string>();
  for (const c of commanders) {
    for (const ch of c.color_identity ?? []) set.add(ch.toUpperCase());
  }
  return ['W', 'U', 'B', 'R', 'G'].filter(c => set.has(c)).join('');
}
