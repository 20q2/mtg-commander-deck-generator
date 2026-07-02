import { describe, it, expect } from 'vitest';
import {
  computeNewUpgrades,
  baselineSeen,
  liftFitScore,
  rankUpgradeCandidates,
  parseIntendedThemes,
  type UpgradeCandidate,
} from '../deckUpgrades';

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

describe('liftFitScore', () => {
  const deck = new Set(['Sol Ring', 'Doubling Season']);

  it('only counts pool entries that are cards in the deck', () => {
    const pool = [
      { name: 'Doubling Season', lift: 4, coPct: 50, numDecks: 950 },
      { name: 'Some Random Card', lift: 9, coPct: 90, numDecks: 9000 },
    ];
    const onlyDeckEdge = liftFitScore(pool, deck);
    expect(onlyDeckEdge).toBeGreaterThan(0);
    expect(liftFitScore([pool[1]], deck)).toBe(0);
  });

  it('damps low-sample edges: same lift × coPct scores lower with few shared decks', () => {
    const strong = liftFitScore([{ name: 'Sol Ring', lift: 3, coPct: 40, numDecks: 1000 }], deck);
    const weak = liftFitScore([{ name: 'Sol Ring', lift: 3, coPct: 40, numDecks: 15 }], deck);
    expect(strong).toBeGreaterThan(weak);
  });

  it('sums evidence across multiple deck cards', () => {
    const one = liftFitScore([{ name: 'Sol Ring', lift: 2, coPct: 30, numDecks: 500 }], deck);
    const two = liftFitScore([
      { name: 'Sol Ring', lift: 2, coPct: 30, numDecks: 500 },
      { name: 'Doubling Season', lift: 2, coPct: 30, numDecks: 500 },
    ], deck);
    expect(two).toBeCloseTo(one * 2);
  });
});

describe('rankUpgradeCandidates', () => {
  const cand = (name: string, over: Partial<UpgradeCandidate> = {}): UpgradeCandidate =>
    ({ name, inclusion: 10, ...over });

  it('deck lift fit outranks commander-page synergy', () => {
    const ranked = rankUpgradeCandidates([
      { candidate: cand('High Synergy, No Fit', { synergy: 0.9 }), liftFit: 0 },
      { candidate: cand('Deck Fit', { synergy: 0.1 }), liftFit: 500 },
    ]);
    expect(ranked.map(c => c.name)).toEqual(['Deck Fit', 'High Synergy, No Fit']);
  });

  it('intended-theme membership boosts otherwise-equal candidates', () => {
    const ranked = rankUpgradeCandidates([
      { candidate: cand('Off Theme', { synergy: 0.3 }), liftFit: 100 },
      { candidate: cand('On Theme', { synergy: 0.3, fromTheme: true }), liftFit: 100 },
    ]);
    expect(ranked[0].name).toBe('On Theme');
  });

  it('handles the all-zero lift round (normalization must not divide by zero)', () => {
    const ranked = rankUpgradeCandidates([
      { candidate: cand('B', { synergy: 0.2 }), liftFit: 0 },
      { candidate: cand('A', { synergy: 0.4 }), liftFit: 0 },
    ]);
    expect(ranked.map(c => c.name)).toEqual(['A', 'B']);
  });
});

describe('parseIntendedThemes', () => {
  it('recovers theme names from a generation summary', () => {
    expect(parseIntendedThemes('Built with: Tokens, Aristocrats · Bracket 3 · Budget'))
      .toEqual(['Tokens', 'Aristocrats']);
  });

  it('returns empty for summaries without themes or missing summaries', () => {
    expect(parseIntendedThemes('Bracket 3 · Budget')).toEqual([]);
    expect(parseIntendedThemes(undefined)).toEqual([]);
  });
});
