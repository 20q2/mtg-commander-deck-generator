import { describe, it, expect } from 'vitest';
import type { EDHRECCommanderData, EDHRECTheme, ScryfallCard } from '@/types';
import { scoreThemeMatch } from '../themeDetector';

/**
 * The Sapling of Colfenor case: a Pestilence group-slug deck with three toughness cards in it still
 * overlaps the Toughness Matters theme page heavily, because a theme page is mostly format
 * goodstuff and any deck in the right colors matches it. Synergy is what separates "this card is
 * here because of the theme" from "this card is on every page".
 */
const theme = (name: string): EDHRECTheme => ({ name, slug: name.toLowerCase(), count: 1000, url: '' });

function card(name: string): ScryfallCard {
  return {
    id: name, oracle_id: `oid-${name}`, name, cmc: 3,
    type_line: 'Creature — Treefolk', keywords: [], color_identity: ['B', 'G'],
    rarity: 'rare', set: 'tst', set_name: 'Test',
    prices: {}, legalities: { commander: 'legal' },
  } as ScryfallCard;
}

/** A theme page: `specific` cards carry real synergy, `staples` sit at zero. */
function page(specific: string[], staples: string[]): EDHRECCommanderData {
  return {
    cardlists: {
      allNonLand: [
        ...specific.map(name => ({ name, inclusion: 30, synergy: 0.4 })),
        ...staples.map(name => ({ name, inclusion: 60, synergy: 0 })),
      ],
      lands: [],
    },
  } as unknown as EDHRECCommanderData;
}

const STAPLES = ['Sol Ring', 'Cultivate', 'Beast Within', 'Chaos Warp', 'Krosan Grip',
  'Harmonize', 'Rampant Growth', 'Explore', 'Naturalize', 'Fling'];
const TOUGHNESS = ['Doran, the Siege Tower', 'Assault Formation', 'High Alert'];
const SLUG = ['Pestilence', 'Pyrohemia', 'Toxic Deluge', 'Blood Artist', 'Zulaport Cutthroat',
  'Bond of Agony', 'Vito, Thorn of the Dusk Rose', 'Sanguine Bond', 'Exquisite Blood', 'Bitterblossom'];

const deck = [...STAPLES, ...TOUGHNESS, ...SLUG].map(card);

describe('scoreThemeMatch synergy-gated overlap', () => {
  // Toughness Matters: 3 real hits, and every staple in the deck also on its page.
  const toughness = scoreThemeMatch(theme('Toughness'), page(TOUGHNESS, STAPLES), deck);
  // Self-Damage: 10 real hits carrying synergy, no staple padding needed.
  const selfDamage = scoreThemeMatch(theme('SelfDamage'), page(SLUG, []), deck);

  it('still reports the true overlap count for display', () => {
    expect(toughness.cardOverlap).toBe(TOUGHNESS.length + STAPLES.length); // 13
    expect(selfDamage.cardOverlap).toBe(SLUG.length); // 10
  });

  it('scores the theme the deck is actually about above the staple-padded one', () => {
    // Raw counts would put Toughness (13 overlapping cards) above Self-Damage (10).
    expect(toughness.cardOverlap).toBeGreaterThan(selfDamage.cardOverlap);
    // Synergy-gated credit reverses it: 3 + 10x0.25 = 5.5 against a full 10.
    expect(selfDamage.score).toBeGreaterThan(toughness.score);
  });

  it('does not zero out a staple-only overlap — it is real, just not evidence', () => {
    const staplesOnly = scoreThemeMatch(theme('Goodstuff'), page([], STAPLES), deck);
    expect(staplesOnly.score).toBeGreaterThan(0);
    expect(staplesOnly.score).toBeLessThan(selfDamage.score);
  });

  it('keeps synergySum available on the result', () => {
    expect(selfDamage.synergySum).toBeCloseTo(SLUG.length * 0.4, 5);
  });

  it('grades credit by synergy rather than gating on sign', () => {
    // A binary `synergy > 0` test passed 79% of a real page's cards, so a barely-above-baseline
    // staple counted as much as a payoff. Measured on Sapling: Treefolk's page kept 90% of its
    // credit under the gate and 57% under grading, because its median synergy is 0.06.
    const barelyPositive = scoreThemeMatch(theme('Fringe'), page([], []), deck);
    const nudged = scoreThemeMatch(
      theme('Nudged'),
      {
        cardlists: {
          allNonLand: SLUG.map(name => ({ name, inclusion: 30, synergy: 0.01 })),
          lands: [],
        },
      } as unknown as EDHRECCommanderData,
      deck,
    );
    // Same ten matching cards as selfDamage, but at noise-level synergy instead of 0.4.
    expect(nudged.cardOverlap).toBe(selfDamage.cardOverlap);
    expect(nudged.score).toBeLessThan(selfDamage.score);
    expect(barelyPositive.score).toBe(0);
  });
});

describe('membership renormalization', () => {
  const strongPage = {
    cardlists: {
      allNonLand: SLUG.map(name => ({ name, inclusion: 60, synergy: 0.4 })),
      lands: [],
    },
  } as unknown as EDHRECCommanderData;

  const withMembership = {
    membershipScore: 20, members: 4, memberCards: [{ name: 'Pestilence', basis: 'tag', matched: [] }],
  } as never;

  it('does not reward a theme the classifier had nothing to say about', () => {
    // Same page, same deck. One theme has real (if modest) membership evidence; the other has none
    // while the classifier WAS running. The one with evidence must not score lower.
    const evidenced = scoreThemeMatch(theme('A'), strongPage, deck, withMembership, true);
    const unknown = scoreThemeMatch(theme('B'), strongPage, deck, undefined, true);
    expect(unknown.score).toBeLessThan(evidenced.score);
  });

  it('still renormalizes when the classifier did not run at all', () => {
    // Absence across the board must not deflate every score below the detection threshold, so the
    // denominator drops and the two EDHREC signals carry full weight.
    const classifierOff = scoreThemeMatch(theme('C'), strongPage, deck, undefined, false);
    const classifierOnButUnscored = scoreThemeMatch(theme('C'), strongPage, deck, undefined, true);
    expect(classifierOff.score).toBeGreaterThan(classifierOnButUnscored.score);
  });

  it('defaults to treating a supplied membership as "the classifier ran"', () => {
    const explicit = scoreThemeMatch(theme('D'), strongPage, deck, withMembership, true);
    const defaulted = scoreThemeMatch(theme('D'), strongPage, deck, withMembership);
    expect(defaulted.score).toBe(explicit.score);
  });
});

describe('synergy confidence on thin pages', () => {
  /** Same cards, same synergy — only the page's deck count differs. */
  const pageWithDecks = (numDecks: number) => ({
    stats: { numDecks },
    cardlists: {
      allNonLand: SLUG.map(name => ({ name, inclusion: 40, synergy: 0.20 })),
      lands: [],
    },
  } as unknown as EDHRECCommanderData);

  it('discounts an 8-deck page against a well-sampled one', () => {
    // Measured on Nath of the Gilt-Leaf: median synergy runs inversely to deck count —
    // birthing-pod 8 decks -> 0.124, stax 38 -> 0.097, discard 229 -> 0.060. Unshrunk, the grading
    // handed the thinnest page the most credit and Birthing Pod outscored the deck's real archetype.
    const thin = scoreThemeMatch(theme('Thin'), pageWithDecks(8), deck);
    const healthy = scoreThemeMatch(theme('Healthy'), pageWithDecks(400), deck);
    expect(thin.score).toBeLessThan(healthy.score);
  });

  it('is monotonic in deck count', () => {
    const scores = [2, 8, 38, 229, 1432].map(
      n => scoreThemeMatch(theme(`P${n}`), pageWithDecks(n), deck).score,
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
  });

  it('treats an unreported deck count as full confidence, not as zero decks', () => {
    // The archetype tag-page fallback synthesizes a page with no count, and those pool thousands of
    // decks — shrinking them to nothing would gut the only pool an off-list theme has.
    const noCount = scoreThemeMatch(theme('NoCount'), {
      cardlists: { allNonLand: SLUG.map(name => ({ name, inclusion: 40, synergy: 0.20 })), lands: [] },
    } as unknown as EDHRECCommanderData, deck);
    const healthy = scoreThemeMatch(theme('Healthy'), pageWithDecks(100000), deck);
    expect(noCount.score).toBeCloseTo(healthy.score, 1);
  });
});

describe('inclusion confidence on thin pages', () => {
  /** Identical cards and inclusion — only the page's deck count differs. */
  const pageWithDecks = (numDecks: number) => ({
    stats: { numDecks },
    cardlists: {
      allNonLand: SLUG.map(name => ({ name, inclusion: 90, synergy: 0 })),
      lands: [],
    },
  } as unknown as EDHRECCommanderData);

  it('does not let a 25-deck page outrank a 229-deck one on inclusion', () => {
    // Measured on a Nath of the Gilt-Leaf elves-discard list: Combo (25 decks) and Stax (38) both
    // pinned the inclusion term at its 25.0 maximum while Discard (229) scored 18.8, so the term
    // ranked the two themes the deck is NOT about above the one it is.
    const thin = scoreThemeMatch(theme('Thin'), pageWithDecks(25), deck);
    const healthy = scoreThemeMatch(theme('Healthy'), pageWithDecks(229), deck);
    expect(thin.score).toBeLessThan(healthy.score);
  });

  it('reports weightedOverlap raw so callers can still show the page figure', () => {
    const thin = scoreThemeMatch(theme('Thin'), pageWithDecks(25), deck);
    expect(thin.weightedOverlap).toBeCloseTo(SLUG.length * 90, 5);
  });
});
