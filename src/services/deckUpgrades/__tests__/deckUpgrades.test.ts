import { describe, it, expect } from 'vitest';
import { computeNewUpgrades, baselineSeen } from '../deckUpgrades';

describe('computeNewUpgrades', () => {
  it('excludes cards already in the deck and preserves recommendation order', () => {
    const recs = ['Sol Ring', 'Cyclonic Rift', 'Rhystic Study', 'Smothering Tithe'];
    const deck = ['Sol Ring'];
    const seen: string[] = [];
    expect(computeNewUpgrades(recs, deck, seen)).toEqual(['Cyclonic Rift', 'Rhystic Study', 'Smothering Tithe']);
  });

  it('excludes cards already seen', () => {
    const recs = ['Cyclonic Rift', 'Rhystic Study'];
    expect(computeNewUpgrades(recs, [], ['Cyclonic Rift'])).toEqual(['Rhystic Study']);
  });

  it('returns empty when everything is in-deck or seen', () => {
    expect(computeNewUpgrades(['A', 'B'], ['A'], ['B'])).toEqual([]);
  });
});

describe('baselineSeen', () => {
  it('returns a copy of all recommendations so nothing flags as new on first sight', () => {
    const recs = ['A', 'B', 'C'];
    const result = baselineSeen(recs);
    expect(result).toEqual(['A', 'B', 'C']);
    expect(result).not.toBe(recs);
  });

  it('a freshly-baselined deck surfaces no new cards, then surfaces only later additions', () => {
    const recs = ['A', 'B'];
    const seen = baselineSeen(recs);
    expect(computeNewUpgrades(recs, [], seen)).toEqual([]);
    // World moves: a new recommendation appears
    const nextRecs = ['A', 'B', 'C'];
    expect(computeNewUpgrades(nextRecs, [], seen)).toEqual(['C']);
  });
});
