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
});
