import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FILTERS,
  parseFilters,
  serializeFilters,
  type ExplorerFilterState,
} from '../explorerUrlState';

const params = (s: string) => new URLSearchParams(s);

describe('parseFilters', () => {
  it('returns all defaults for empty params', () => {
    expect(parseFilters(params(''))).toEqual(DEFAULT_FILTERS);
  });

  it('parses tags, types, colors, mode, exclude, sort, dir, q', () => {
    const f = parseFilters(params(
      'tags=green-effect,instant-speed&types=instant,sorcery&colors=GW&colorMode=exact&exclude=R&sort=cmc&dir=desc&q=draw',
    ));
    expect(f.selectedTags).toEqual(['green-effect', 'instant-speed']);
    expect(f.typeFilter).toEqual(['instant', 'sorcery']);
    expect(f.colorIdentity).toEqual(['G', 'W']);
    expect(f.colorMode).toBe('exact');
    expect(f.excludedColors).toEqual(['R']);
    expect(f.sort).toBe('cmc');
    expect(f.sortDir).toBe('desc');
    expect(f.textFilter).toBe('draw');
  });

  it('falls back to defaults on garbage enum values', () => {
    const f = parseFilters(params('colorMode=bogus&sort=nope&dir=sideways&colors=GXZ'));
    expect(f.colorMode).toBe('subset');
    expect(f.sort).toBe('edhrec');
    expect(f.sortDir).toBe('asc');
    expect(f.colorIdentity).toEqual(['G']); // invalid color letters dropped
  });
});

describe('serializeFilters', () => {
  it('writes no keys for all-default state', () => {
    const out = serializeFilters(DEFAULT_FILTERS, params(''));
    expect(out.toString()).toBe('');
  });

  it('writes only non-default keys', () => {
    const f: ExplorerFilterState = {
      ...DEFAULT_FILTERS,
      selectedTags: ['green-effect'],
      typeFilter: ['instant'],
    };
    const out = serializeFilters(f, params(''));
    expect(out.get('tags')).toBe('green-effect');
    expect(out.get('types')).toBe('instant');
    expect(out.has('colorMode')).toBe(false);
    expect(out.has('sort')).toBe(false);
  });

  it('preserves foreign keys (deck, card)', () => {
    const out = serializeFilters({ ...DEFAULT_FILTERS, selectedTags: ['x'] }, params('deck=abc123'));
    expect(out.get('deck')).toBe('abc123');
    expect(out.get('tags')).toBe('x');
  });

  it('drops a filter key when it returns to default', () => {
    const out = serializeFilters(DEFAULT_FILTERS, params('tags=old&deck=abc'));
    expect(out.has('tags')).toBe(false);
    expect(out.get('deck')).toBe('abc');
  });

  it('round-trips through parse', () => {
    const f: ExplorerFilterState = {
      selectedTags: ['a', 'b'],
      colorIdentity: ['G', 'W'],
      colorMode: 'atleast',
      excludedColors: ['R'],
      typeFilter: ['instant'],
      sort: 'name',
      sortDir: 'desc',
      textFilter: 'token',
    };
    expect(parseFilters(serializeFilters(f, params('')))).toEqual(f);
  });
});
