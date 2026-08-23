import { describe, it, expect } from 'vitest';
import { scoreThemeMatch } from '../themeDetector';
import type { EDHRECCommanderData, EDHRECTheme, ScryfallCard } from '@/types';
import type { ThemeScore } from '@/services/themes';

/**
 * `basis` and `literalCount` back the theme picker's "why we think this" line, so they have to
 * describe the evidence as a whole. `basis` used to read memberCards[0] — the first matching card
 * in DECK ORDER — which meant a theme with twenty literal members reported 'tag' whenever a tag
 * match happened to be shuffled to the front.
 */
const theme = (name: string): EDHRECTheme => ({ name, slug: name.toLowerCase(), count: 1000, url: '' });

const card = (name: string): ScryfallCard =>
  ({ id: name, oracle_id: `oid-${name}`, name, cmc: 2, type_line: 'Creature' } as ScryfallCard);

const page = (names: string[]): EDHRECCommanderData => ({
  cardlists: { allNonLand: names.map(name => ({ name, inclusion: 40, synergy: 0.3 })), lands: [] },
} as unknown as EDHRECCommanderData);

const deck = ['A', 'B', 'C', 'D'].map(card);

/** A membership result whose member bases are given in deck order. */
function membership(bases: ('literal' | 'tag')[], kind = 'subtype'): ThemeScore {
  return {
    memberCards: bases.map((basis, i) => ({ name: deck[i].name, basis, matched: ['x'] })),
    members: bases.length,
    membershipScore: 60,
    ratio: bases.length / deck.length,
    model: { kind: { kind } },
  } as unknown as ThemeScore;
}

describe('theme evidence reported to the UI', () => {
  it('reports literal when ANY member is literal, whatever the deck order', () => {
    const tagFirst = scoreThemeMatch(theme('T'), page(['A']), deck, membership(['tag', 'literal']), true);
    const litFirst = scoreThemeMatch(theme('T'), page(['A']), deck, membership(['literal', 'tag']), true);

    expect(tagFirst.basis).toBe('literal');
    expect(litFirst.basis).toBe('literal');
  });

  it('counts only the literal members, not all of them', () => {
    const r = scoreThemeMatch(theme('T'), page(['A']), deck, membership(['literal', 'tag', 'tag']), true);
    expect(r.memberCount).toBe(3);
    expect(r.literalCount).toBe(1);
  });

  it('reports tag when every member is inferred', () => {
    const r = scoreThemeMatch(theme('T'), page(['A']), deck, membership(['tag', 'tag']), true);
    expect(r.basis).toBe('tag');
    expect(r.literalCount).toBe(0);
  });

  it('reports none when the classifier found no members at all', () => {
    const r = scoreThemeMatch(theme('T'), page(['A']), deck, membership([]), true);
    expect(r.basis).toBe('none');
    expect(r.memberCount).toBe(0);
  });

  it('reports none when the classifier did not run', () => {
    const r = scoreThemeMatch(theme('T'), page(['A']), deck);
    expect(r.basis).toBe('none');
    expect(r.literalCount).toBe(0);
  });
});

/**
 * The receipts must add up to the number printed beside them. A user handed "17 of your cards are
 * Auras" counted seven by eye and filed it as a bug — the count was exact (they were all mana
 * Auras like Utopia Sprawl), but nothing on screen let them confirm that.
 */
describe('memberNames matches the count the UI quotes', () => {
  it('lists exactly the literal members when there are any', () => {
    const r = scoreThemeMatch(
      theme('T'), page(['A']), deck, membership(['literal', 'tag', 'literal']), true,
    );
    expect(r.memberNames).toEqual(['A', 'C']);
    expect(r.memberNames).toHaveLength(r.literalCount);
  });

  it('falls back to every member when none are literal — still matching its count', () => {
    const r = scoreThemeMatch(theme('T'), page(['A']), deck, membership(['tag', 'tag']), true);
    expect(r.memberNames).toEqual(['A', 'B']);
    expect(r.memberNames).toHaveLength(r.memberCount);
  });

  it('is empty when the classifier found nothing', () => {
    expect(scoreThemeMatch(theme('T'), page(['A']), deck).memberNames).toEqual([]);
  });

  it('passes the theme kind through, so the UI can say "are" instead of "carry"', () => {
    expect(scoreThemeMatch(theme('T'), page(['A']), deck, membership(['literal']), true).themeKind)
      .toBe('subtype');
    expect(scoreThemeMatch(theme('T'), page(['A']), deck, membership(['literal'], 'mechanic'), true).themeKind)
      .toBe('mechanic');
  });
});
