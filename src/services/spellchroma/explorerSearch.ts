import { searchCards } from '@/services/scryfall/client';
import type { ScryfallCard, ScryfallSearchResponse } from '@/types';

export type ExplorerSort = 'edhrec' | 'cmc' | 'name' | 'type' | 'new';
export type SortDir = 'asc' | 'desc';

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
 * Sentinel prefix marking a `selectedTags` entry as a raw, user-authored Scryfall
 * query fragment rather than a tag slug. Tag slugs are kebab-case and never
 * contain `:`, so the prefix is unambiguous.
 */
const RAW_TERM_PREFIX = 'raw:';

/** True if a `selectedTags` entry is a raw Scryfall query (vs. a tag slug). */
export function isRawTerm(entry: string): boolean {
  return entry.startsWith(RAW_TERM_PREFIX);
}

/** The query text of a raw term, with the sentinel prefix stripped. */
export function rawTermText(entry: string): string {
  return entry.slice(RAW_TERM_PREFIX.length);
}

/** Wrap user-typed query text as a raw-term `selectedTags` entry. */
export function makeRawTerm(text: string): string {
  return `${RAW_TERM_PREFIX}${text.trim()}`;
}

/**
 * Query terms from selected entries, AND-ed (cards must satisfy every term),
 * matching the original SpellChroma. Tag slugs become `otag:<slug>`; raw terms
 * (see {@link makeRawTerm}) emit their verbatim Scryfall query, parenthesized so
 * any internal OR stays grouped.
 */
export function buildOtagQuery(entries: string[]): string {
  return entries
    .map(e => (isRawTerm(e) ? `(${rawTermText(e)})` : `otag:${e}`))
    .join(' ');
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
  dir: SortDir = 'asc',
): Promise<ScryfallSearchResponse> {
  // Scryfall has no "type" order; type grouping is applied client-side, so the
  // server still sorts by edhrec for that mode. "new" maps to Scryfall's
  // `released` order; its direction is inverted so the UI's default `asc`
  // (= "newest first", matching how the client sorts) lines up with the page-1
  // cards the server returns (Scryfall `released asc` is oldest-first).
  const order = sort === 'type' ? 'edhrec' : sort === 'new' ? 'released' : sort;
  const effectiveDir = sort === 'new' ? (dir === 'asc' ? 'desc' : 'asc') : dir;
  return searchCards(buildExplorerQuery(slugs, filters), [], { order, dir: effectiveDir, page });
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
  dir: SortDir = 'asc',
): Promise<ScryfallCard[]> {
  const cards = [...firstPage.data];
  let page = 1;
  let hasMore = firstPage.has_more;
  while (hasMore) {
    page += 1;
    const res = await searchTagPage(slugs, filters, sort, page, dir);
    cards.push(...res.data);
    hasMore = res.has_more;
  }
  return cards;
}
