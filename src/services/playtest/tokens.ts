import type { ScryfallCard } from '@/types';

const SCRYFALL_BASE = 'https://api.scryfall.com';
const tokenCache = new Map<string, ScryfallCard[]>();

/**
 * Resolves a list of Scryfall token cards filterable for the deck's color identity.
 * Returns up to ~60 of the most popular tokens within the color identity.
 *
 * `colorIdentity` is a string like 'WUB' (subset of WUBRG). Empty string means colorless.
 */
export async function resolveTokens(colorIdentity: string): Promise<ScryfallCard[]> {
  const key = colorIdentity.toLowerCase().split('').sort().join('') || 'c';
  if (tokenCache.has(key)) return tokenCache.get(key)!;

  const colorPart = colorIdentity ? `id<=${colorIdentity.toLowerCase()}` : 'id:c';
  const query = `is:token ${colorPart}`;
  const url = `${SCRYFALL_BASE}/cards/search?q=${encodeURIComponent(query)}&unique=cards&order=edhrec`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      tokenCache.set(key, []);
      return [];
    }
    const data = await res.json();
    const cards: ScryfallCard[] = (data.data ?? [])
      .filter((c: ScryfallCard & { set_type?: string }) => c.set_type === 'token')
      .slice(0, 60);
    tokenCache.set(key, cards);
    return cards;
  } catch {
    tokenCache.set(key, []);
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
