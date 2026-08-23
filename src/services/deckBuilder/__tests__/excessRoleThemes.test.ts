import { describe, it, expect } from 'vitest';
import { computeOptimizeSwaps, type DeckAnalysis } from '../deckAnalyzer';
import type { ScryfallCard } from '@/types';
import type { ThemeMembership } from '@/components/analyze/themeMembership';

/**
 * A self-damage deck's Pestilence-style pingers are tagged `boardwipe`. Against a base-page target
 * of two, the deck reads as many board wipes over — but those cards are the strategy, not a surplus
 * of it. Same "serves double duty" case the isThemeSynergyCard guard already covers, except a deck
 * this far off its commander's beaten path never appears on EDHREC's high-synergy lists.
 */
function card(name: string, deckRole?: string): ScryfallCard {
  return {
    id: name, oracle_id: `oid-${name}`, name, cmc: 4,
    type_line: 'Enchantment', keywords: [], color_identity: ['B', 'G'],
    rarity: 'rare', set: 'tst', set_name: 'Test',
    prices: {}, legalities: { commander: 'legal' },
    deckRole,
  } as ScryfallCard;
}

const PINGERS = ['Pestilence', 'Pyrohemia', 'Blight Mound', 'Pyrohemia B', 'Pestilence B'];
const PLAIN_WIPES = ['Toxic Deluge', 'Damnation', 'Languish'];

const cards = [
  ...PINGERS.map(n => card(n, 'boardwipe')),
  ...PLAIN_WIPES.map(n => card(n, 'boardwipe')),
];

/** boardwipe target 2, current 8 → 6 over. */
const analysis = {
  roleDeficits: [{ role: 'boardwipe', label: 'Board Wipes', current: 8, target: 2, deficit: 0 }],
  curveAnalysis: [],
  manaBase: { currentLands: 36, adjustedSuggestion: 36, taplandCount: 0, verdict: 'healthy' },
  manaGrade: { letter: 'B' },
  curveGrade: { letter: 'B' },
  colorFixing: { fixingGrade: 'B', colorsNeeded: [] },
  misfits: [],
  recommendations: [],
  roleBreakdowns: [],
  curvePhases: [],
  mdfcsInDeck: [],
  channelLandsInDeck: [],
  landRecommendations: [],
  typeAnalysis: [],
  gapAnalysis: [],
} as unknown as DeckAnalysis;

/** Pingers carry the theme's own vocabulary (classifier `tag`); the plain wipes do not. */
const membership: ThemeMembership = {
  themes: [{ slug: 'self-damage', name: 'Self-Damage' }],
  byCard: new Map(PINGERS.map(n => [n.toLowerCase(), [0]])),
  basisByCard: new Map(PINGERS.map(n => [n.toLowerCase(), 'tag' as const])),
};

function run(themeMembership: ThemeMembership | null) {
  return computeOptimizeSwaps({
    analysis,
    currentCards: cards,
    cardInclusionMap: Object.fromEntries(cards.map(c => [c.name, 20])),
    commanderName: 'Sapling of Colfenor',
    partnerCommanderName: undefined,
    mustIncludeNames: new Set<string>(),
    bannedNames: new Set<string>(),
    themeMembership,
  }).removals.map(r => r.name);
}

describe('excess-role cuts with classifier theme evidence', () => {
  it('proposes no on-theme pinger as an excess board wipe', () => {
    const removals = run(membership);
    for (const n of PINGERS) {
      expect(removals, `${n} is the strategy, not surplus`).not.toContain(n);
    }
  });

  it('still proposes the plain wipes that carry no theme evidence', () => {
    const removals = run(membership);
    expect(PLAIN_WIPES.some(n => removals.includes(n))).toBe(true);
  });

  it('without theme evidence, the pingers are cuttable as before', () => {
    const removals = run(null);
    expect(PINGERS.some(n => removals.includes(n))).toBe(true);
  });

  it('page-presence evidence alone does NOT exempt — too broad to mean anything', () => {
    const pageOnly: ThemeMembership = {
      themes: [{ slug: 'self-damage', name: 'Self-Damage' }],
      byCard: new Map(cards.map(c => [c.name.toLowerCase(), [0]])),
      basisByCard: new Map(cards.map(c => [c.name.toLowerCase(), 'edhrec' as const])),
    };
    expect(run(pageOnly).length).toBeGreaterThan(0);
  });
});
