import { describe, it, expect } from 'vitest';
import { computeOptimizeSwaps, type DeckAnalysis, type RecommendedCard } from '../deckAnalyzer';
import type { ScryfallCard } from '@/types';

/**
 * The ADD side of the Optimize tab. Two things are under test:
 *
 *  1. Classifier theme evidence waives the 20% inclusion floor — but only `literal` evidence.
 *     Low commander-page inclusion means "few decks with THIS commander run it", which for a
 *     themed build is frequently the point rather than a warning. `tag` evidence is inferred, and
 *     the floor is the only thing between the page's long tail and the suggestion list.
 *  2. The suggestion says which theme it serves, so the reason is checkable rather than a nudge
 *     buried in a score.
 */
function card(name: string): ScryfallCard {
  return {
    id: name, oracle_id: `oid-${name}`, name, cmc: 3,
    type_line: 'Creature', keywords: [], color_identity: ['G'],
    rarity: 'rare', set: 'tst', set_name: 'Test',
    prices: {}, legalities: { commander: 'legal' },
  } as ScryfallCard;
}

const rec = (
  name: string,
  inclusion: number,
  extra: Partial<RecommendedCard> = {},
): RecommendedCard => ({
  name, inclusion, synergy: 0, fillsDeficit: false, primaryType: 'Creature', score: inclusion, ...extra,
});

const RECS: RecommendedCard[] = [
  rec('Popular Ramp', 60),
  rec('Tail Landfall', 5, { themeMatched: ['Landfall'], themeBasis: 'literal' }),
  rec('Tail Tagged', 5, { themeMatched: ['Landfall'], themeBasis: 'tag' }),
  rec('Tail Nothing', 5),
];

const deck = ['Alpha', 'Beta', 'Gamma', 'Delta'].map(card);

/** Every grade healthy and no deficits, so only the general recommendation pass fires. */
const analysis = {
  roleDeficits: [],
  curveAnalysis: [],
  manaBase: {
    currentLands: 36, adjustedSuggestion: 36, taplandCount: 0, verdict: 'healthy', deckSize: 100,
  },
  manaGrade: { letter: 'B' },
  curveGrade: { letter: 'B' },
  colorFixing: { fixingGrade: 'B', colorsNeeded: [] },
  misfits: [],
  recommendations: RECS,
  roleBreakdowns: [],
  curvePhases: [],
  mdfcsInDeck: [],
  channelLandsInDeck: [],
  landRecommendations: [],
  typeAnalysis: [],
  gapAnalysis: [],
} as unknown as DeckAnalysis;

function additions() {
  return computeOptimizeSwaps({
    analysis,
    currentCards: deck,
    cardInclusionMap: Object.fromEntries(deck.map(c => [c.name, 40])),
    commanderName: 'Omnath, Locus of Rage',
    partnerCommanderName: undefined,
    mustIncludeNames: new Set<string>(),
    bannedNames: new Set<string>(),
  }).additions;
}

describe('theme evidence on suggested additions', () => {
  it('admits a low-inclusion card whose own text carries the theme', () => {
    expect(additions().map(a => a.name)).toContain('Tail Landfall');
  });

  it('still keeps the page tail out when the only evidence is inferred', () => {
    const names = additions().map(a => a.name);
    expect(names).not.toContain('Tail Tagged');
    expect(names).not.toContain('Tail Nothing');
  });

  it('names the theme in the reason and groups by it', () => {
    const hit = additions().find(a => a.name === 'Tail Landfall')!;
    expect(hit.reason).toBe('On theme: Landfall');
    expect(hit.reasonCategory).toBe('on-theme:Landfall');
  });

  it('carries the matched themes through for the drill-down chips', () => {
    expect(additions().find(a => a.name === 'Tail Landfall')!.themeMatched).toEqual(['Landfall']);
  });

  it('leaves an ordinary popular pick labeled as before', () => {
    const hit = additions().find(a => a.name === 'Popular Ramp')!;
    expect(hit.reasonCategory).toBe('synergy');
    expect(hit.themeMatched).toBeUndefined();
  });
});
