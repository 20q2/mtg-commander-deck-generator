import { searchCards } from '@/services/scryfall/client';
import type { ScryfallCard, ScryfallSearchResponse } from '@/types';

export type ExplorerSort = 'edhrec' | 'cmc' | 'name' | 'type';

/** How the selected colors constrain a card's color identity. */
export type ColorMatch = 'subset' | 'exact' | 'atleast';

/** The eight major card types, in canonical display/grouping order. */
export const MAJOR_TYPES: { slug: string; label: string }[] = [
  { slug: 'creature',     label: 'Creature' },
  { slug: 'instant',      label: 'Instant' },
  { slug: 'sorcery',      label: 'Sorcery' },
  { slug: 'artifact',     label: 'Artifact' },
  { slug: 'enchantment',  label: 'Enchantment' },
  { slug: 'planeswalker', label: 'Planeswalker' },
  { slug: 'land',         label: 'Land' },
  { slug: 'battle',       label: 'Battle' },
];

/** Grouping rank for a card's type_line — first matching MAJOR_TYPES wins. */
export function typeRank(card: ScryfallCard): number {
  const tl = (card.type_line ?? '').toLowerCase();
  const i = MAJOR_TYPES.findIndex(t => tl.includes(t.slug));
  return i === -1 ? MAJOR_TYPES.length : i;
}

export interface ExplorerFilters {
  colorIdentity: string[];   // the lit "include" colors (WUBRG)
  colorMode: ColorMatch;     // how include colors are matched
  excludedColors: string[];  // colors a card's identity must NOT contain
  typeFilter: string[];      // MAJOR_TYPES slugs, OR-ed
}

/**
 * Color-identity clause. `subset` = at most (id<=), `exact` = id=, `atleast`
 * = id>=. Each excluded color adds `-id>=c` (identity must not contain it).
 * Empty include = no positive clause (excludes still apply).
 */
export function buildColorClause(include: string[], mode: ColorMatch, exclude: string[]): string {
  const parts: string[] = [];
  if (include.length > 0) {
    const op = mode === 'exact' ? '=' : mode === 'atleast' ? '>=' : '<=';
    parts.push(`id${op}${include.join('')}`);
  }
  for (const c of exclude) parts.push(`-id>=${c}`);
  return parts.join(' ');
}

/** OR-ed type clause, e.g. `(t:creature or t:instant)`. Empty = no clause. */
export function buildTypeClause(types: string[]): string {
  if (types.length === 0) return '';
  return `(${types.map(t => `t:${t}`).join(' or ')})`;
}

/**
 * Tag terms only. Tags are AND-ed (cards must carry every selected tag),
 * matching the original SpellChroma.
 */
export function buildOtagQuery(slugs: string[]): string {
  return slugs.map(s => `otag:${s}`).join(' ');
}

/**
 * Full Scryfall query body for the explorer: tags + type clause + color clause.
 * Color identity is baked in here (not via `searchCards`' colorIdentity arg) so
 * the match mode / excludes are honored; callers pass `[]` for that arg.
 */
export function buildExplorerQuery(slugs: string[], f: ExplorerFilters): string {
  return [
    buildOtagQuery(slugs),
    buildTypeClause(f.typeFilter),
    buildColorClause(f.colorIdentity, f.colorMode, f.excludedColors),
  ].filter(Boolean).join(' ');
}

/** One page of results. `searchCards` adds `f:commander` and wraps in parens. */
export function searchTagPage(
  slugs: string[],
  filters: ExplorerFilters,
  sort: ExplorerSort,
  page: number,
): Promise<ScryfallSearchResponse> {
  // Scryfall has no "type" order; type grouping is applied client-side, so the
  // server still sorts by edhrec for that mode.
  const order = sort === 'type' ? 'edhrec' : sort;
  return searchCards(buildExplorerQuery(slugs, filters), [], { order, page });
}

/**
 * Fetch every page for a query and return the flattened card list. Stops when
 * Scryfall reports no more pages. `searchCards` is internally cached +
 * rate-limited, so this is safe to call directly.
 */
export async function searchAllTagPages(
  slugs: string[],
  filters: ExplorerFilters,
  sort: ExplorerSort,
  firstPage: ScryfallSearchResponse,
): Promise<ScryfallCard[]> {
  const cards = [...firstPage.data];
  let page = 1;
  let hasMore = firstPage.has_more;
  while (hasMore) {
    page += 1;
    const res = await searchTagPage(slugs, filters, sort, page);
    cards.push(...res.data);
    hasMore = res.has_more;
  }
  return cards;
}
