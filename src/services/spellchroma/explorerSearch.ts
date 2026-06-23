import { searchCards } from '@/services/scryfall/client';
import type { ScryfallCard, ScryfallSearchResponse } from '@/types';

export type ExplorerSort = 'edhrec' | 'cmc' | 'name';

/**
 * Build the Scryfall query clause for the selected tags. Tags are AND-ed
 * (cards must carry every selected tag), matching the original SpellChroma.
 * `searchCards` wraps this in parens and appends the color filter + f:commander,
 * so we only emit the otag terms here.
 */
export function buildOtagQuery(slugs: string[]): string {
  return slugs.map(s => `otag:${s}`).join(' ');
}

/** One page of tag results. `searchCards` adds `id<=colors` + `f:commander`. */
export function searchTagPage(
  slugs: string[],
  colorIdentity: string[],
  sort: ExplorerSort,
  page: number,
): Promise<ScryfallSearchResponse> {
  return searchCards(buildOtagQuery(slugs), colorIdentity, { order: sort, page });
}

/**
 * Fetch every page for a tag query and return the flattened card list.
 * Stops when Scryfall reports no more pages. `searchCards` is internally
 * cached + rate-limited, so this is safe to call directly.
 */
export async function searchAllTagPages(
  slugs: string[],
  colorIdentity: string[],
  sort: ExplorerSort,
  firstPage: ScryfallSearchResponse,
): Promise<ScryfallCard[]> {
  const cards = [...firstPage.data];
  let page = 1;
  let hasMore = firstPage.has_more;
  while (hasMore) {
    page += 1;
    const res = await searchTagPage(slugs, colorIdentity, sort, page);
    cards.push(...res.data);
    hasMore = res.has_more;
  }
  return cards;
}
