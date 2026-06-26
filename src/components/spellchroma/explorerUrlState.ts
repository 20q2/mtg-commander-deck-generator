import type { ExplorerSort, ColorMatch, SortDir } from '@/services/spellchroma/explorerSearch';

export interface ExplorerFilterState {
  selectedTags: string[];
  colorIdentity: string[];
  colorMode: ColorMatch;
  excludedColors: string[];
  typeFilter: string[];
  sort: ExplorerSort;
  sortDir: SortDir;
  textFilter: string;
}

export const DEFAULT_FILTERS: ExplorerFilterState = {
  selectedTags: [],
  colorIdentity: [],
  colorMode: 'subset',
  excludedColors: [],
  typeFilter: [],
  sort: 'edhrec',
  sortDir: 'asc',
  textFilter: '',
};

const COLOR_MODES: ColorMatch[] = ['subset', 'exact', 'atleast'];
const SORTS: ExplorerSort[] = ['edhrec', 'cmc', 'name', 'type'];
const DIRS: SortDir[] = ['asc', 'desc'];
const COLOR_LETTERS = new Set(['W', 'U', 'B', 'R', 'G']);

// Query-string keys this module owns. serializeFilters clears all of these before
// writing, so a filter returning to its default drops its key. Foreign keys
// (deck, card, …) are left untouched.
const OWNED_KEYS = ['tags', 'types', 'colors', 'colorMode', 'exclude', 'sort', 'dir', 'q'] as const;

const splitCsv = (raw: string | null): string[] =>
  raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];

const splitColors = (raw: string | null): string[] =>
  raw ? raw.toUpperCase().split('').filter(c => COLOR_LETTERS.has(c)) : [];

export function parseFilters(params: URLSearchParams): ExplorerFilterState {
  const colorMode = params.get('colorMode') as ColorMatch | null;
  const sort = params.get('sort') as ExplorerSort | null;
  const dir = params.get('dir') as SortDir | null;
  return {
    selectedTags: splitCsv(params.get('tags')),
    colorIdentity: splitColors(params.get('colors')),
    colorMode: colorMode && COLOR_MODES.includes(colorMode) ? colorMode : 'subset',
    excludedColors: splitColors(params.get('exclude')),
    typeFilter: splitCsv(params.get('types')),
    sort: sort && SORTS.includes(sort) ? sort : 'edhrec',
    sortDir: dir && DIRS.includes(dir) ? dir : 'asc',
    textFilter: params.get('q') ?? '',
  };
}

// Returns a NEW URLSearchParams: `base` cloned, owned keys cleared, then non-default
// values written. Foreign keys in `base` are preserved.
export function serializeFilters(f: ExplorerFilterState, base: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(base);
  for (const k of OWNED_KEYS) out.delete(k);

  if (f.selectedTags.length) out.set('tags', f.selectedTags.join(','));
  if (f.typeFilter.length) out.set('types', f.typeFilter.join(','));
  if (f.colorIdentity.length) out.set('colors', f.colorIdentity.join(''));
  if (f.colorMode !== 'subset') out.set('colorMode', f.colorMode);
  if (f.excludedColors.length) out.set('exclude', f.excludedColors.join(''));
  if (f.sort !== 'edhrec') out.set('sort', f.sort);
  if (f.sortDir !== 'asc') out.set('dir', f.sortDir);
  if (f.textFilter) out.set('q', f.textFilter);

  return out;
}
