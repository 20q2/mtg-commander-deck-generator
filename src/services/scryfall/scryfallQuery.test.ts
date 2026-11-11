import { describe, it, expect } from 'vitest';
import { normalizeScryfallQuery, parseSetsFromQuery, stripSetTerms } from './client';

/**
 * Regression: "set:tla set:tle" is an implicit AND on Scryfall, and one printing can't
 * be in two sets, so the query matched nothing (live: 404, while each set alone returns
 * 50+ cards). Every Scryfall-sourced fill came back empty and the deck was padded with
 * basics. Two bare set terms can only mean "either set".
 */
describe('normalizeScryfallQuery', () => {
  it('turns several bare set terms into one OR group', () => {
    expect(normalizeScryfallQuery('set:tla set:tle')).toBe('(set:tla or set:tle)');
  });

  it('keeps the other filters and puts the group where the first set was', () => {
    expect(normalizeScryfallQuery('is:foil set:tla set:tle f:commander'))
      .toBe('is:foil (set:tla or set:tle) f:commander');
  });

  it('understands the s:/e:/edition: aliases and ignores case and duplicates', () => {
    expect(normalizeScryfallQuery('s:TLA e:tle edition:tla')).toBe('(set:tla or set:tle)');
  });

  it('leaves a single set, or no set, alone', () => {
    expect(normalizeScryfallQuery('set:tla')).toBe('set:tla');
    expect(normalizeScryfallQuery('  is:full-art ')).toBe('is:full-art');
    expect(normalizeScryfallQuery('')).toBe('');
  });

  it('leaves a query the user already structured alone', () => {
    expect(normalizeScryfallQuery('set:tla or set:tle')).toBe('set:tla or set:tle');
    expect(normalizeScryfallQuery('(set:tla or set:tle) is:foil')).toBe('(set:tla or set:tle) is:foil');
  });

  it('does not treat a negated set as one to draw from', () => {
    expect(normalizeScryfallQuery('set:tla -set:tle')).toBe('set:tla -set:tle');
  });
});

describe('parseSetsFromQuery', () => {
  it('reads every set from a normalized multi-set query', () => {
    expect(parseSetsFromQuery(normalizeScryfallQuery('set:tla set:tle'))).toEqual(['tla', 'tle']);
  });

  it('skips negated sets', () => {
    expect(parseSetsFromQuery('set:tla -set:tle')).toEqual(['tla']);
  });
});

describe('stripSetTerms', () => {
  it('leaves nothing behind when the query was only sets', () => {
    expect(stripSetTerms('(set:tla or set:tle)')).toBe('');
    expect(stripSetTerms('set:tla or set:tle')).toBe('');
  });

  it('keeps the non-set filters, and negated sets', () => {
    expect(stripSetTerms('(set:tla or set:tle) is:full-art')).toBe('is:full-art');
    expect(stripSetTerms('set:tla -set:tle')).toBe('-set:tle');
  });
});
