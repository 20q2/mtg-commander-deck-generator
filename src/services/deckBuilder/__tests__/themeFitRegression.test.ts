import { describe, it, expect } from 'vitest';
import { buildThemeModel } from '@/services/themes';
import type { MtgCatalogs } from '@/services/scryfall/client';
import type { EDHRECTag, ScryfallCard } from '@/types';
import { computeThemeFit, literalThemeMembers } from '../themeFit';
import { computeMisfits } from '../cardFit';
import { buildThemeMembership } from '@/components/analyze/themeMembership';

/**
 * Regression harness for the Toph, Hardheaded Teacher deck that exposed the bug: a Landfall deck on
 * a commander whose EDHREC page is too thin to list most of its own cards (166 decks on the landfall
 * theme page). Keywords below are the real Scryfall `keywords` values, checked against the API on
 * 2026-08-22.
 *
 * Uses no tuning numbers and no network — buildThemeModel over a minimal catalog is pure — so this
 * suite is unaffected by ongoing classifier tuning. It asserts outcomes, not weights.
 */
const CATALOGS: MtgCatalogs = {
  mechanics: new Set(['landfall', 'earthbend']),
  creatureTypes: new Set(),
  permanentSubtypes: new Set(),
};

const tag = (name: string, slug: string, numDecks: number): EDHRECTag => ({ name, slug, numDecks });

function card(name: string, keywords: string[] = []): ScryfallCard {
  return {
    id: name,
    oracle_id: `oid-${name}`,
    name,
    cmc: 4,
    type_line: 'Creature — Human',
    keywords,
    color_identity: ['G'],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
  } as ScryfallCard;
}

/** Cards from that deck which carry the Landfall keyword on the card itself. */
const KEYWORD_CARRIERS = [
  'Scute Swarm',
  'Moraug, Fury of Akoum',
  'Avenger of Zendikar',
  'Tunneling Geopede',
  'Omnath, Locus of Rage',
  'Bristly Bill, Spine Sower',
  'Evolution Sage',
];

/**
 * In the deck and genuinely on-strategy, but carrying no landfall keyword — these ENABLE landfall
 * rather than trigger on it, and the classifier cannot see them by design. Only EDHREC's archetype
 * pool knows they belong (Loot sits in 24.9% of Gruul landfall decks). Pinned here so that if a
 * future change starts matching them, someone notices and decides whether that is correct.
 */
const ENABLERS_WITHOUT_KEYWORD = [
  'Loot, Exuberant Explorer',
  'Azusa, Lost but Seeking',
  'Spelunking',
  'Horizon Explorer',
  'Terrasymbiosis',
  'Traveling Chocobo',
];

const landfall = buildThemeModel(tag('Landfall', 'landfall', 19932), CATALOGS, {});

const deckCards = [
  ...KEYWORD_CARRIERS.map(n => card(n, ['Landfall'])),
  ...ENABLERS_WITHOUT_KEYWORD.map(n => card(n)),
  card('Plain Vanilla Beast'), // no keyword, no theme, no role — must stay cuttable
];

describe('Toph landfall deck: theme fit', () => {
  const fit = computeThemeFit(deckCards, [landfall], () => []);

  it('recognises every keyword carrier as a literal member', () => {
    for (const name of KEYWORD_CARRIERS) {
      expect(fit.byCard.get(name.toLowerCase()), name).toEqual({
        indices: [0], basis: 'literal', matched: ['landfall'],
      });
    }
    expect(literalThemeMembers(fit).size).toBe(KEYWORD_CARRIERS.length);
  });

  it('documents that keyword-less enablers are NOT matched (EDHREC must supply these)', () => {
    for (const name of ENABLERS_WITHOUT_KEYWORD) {
      expect(fit.byCard.has(name.toLowerCase()), name).toBe(false);
    }
  });
});

describe('Toph landfall deck: cut behavior', () => {
  const fit = computeThemeFit(deckCards, [landfall], () => []);
  // No EDHREC data for anything — the exact condition that produced the bug.
  const membership = buildThemeMembership(
    { slug: 'landfall', name: 'Landfall' }, null, new Map(), fit,
  );
  const zeros = Object.fromEntries(deckCards.map(c => [c.name, 0]));

  const misfits = computeMisfits({
    cards: deckCards,
    cardInclusionMap: zeros,
    cardSynergyMap: zeros,
    themeMembership: membership,
  }).map(m => m.card.name);

  it('proposes no keyword carrier as a misfit', () => {
    for (const name of KEYWORD_CARRIERS) {
      expect(misfits, `${name} must not be flagged`).not.toContain(name);
    }
  });

  it('still proposes a genuinely off-plan card', () => {
    expect(misfits).toContain('Plain Vanilla Beast');
  });

  it('does not silence cuts wholesale', () => {
    // The exemption has to be targeted. Enablers and the vanilla card are still evaluated, so with
    // zero EDHREC data across the board the misfit list stays non-empty. Zero here would mean the
    // guard swallowed everything.
    expect(misfits.length).toBeGreaterThan(0);
  });

  it('flags exactly the cards with no literal theme evidence', () => {
    expect([...misfits].sort()).toEqual(
      [...ENABLERS_WITHOUT_KEYWORD, 'Plain Vanilla Beast'].sort(),
    );
  });
});
