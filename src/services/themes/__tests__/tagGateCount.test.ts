import { describe, it, expect } from 'vitest';
import { buildThemeModel, scoreThemesForDeck, survivingThemes } from '..';
import type { MtgCatalogs } from '@/services/scryfall/client';
import type { EDHRECTag, ScryfallCard } from '@/types';

/**
 * One pod effect does not make a pod deck.
 *
 * REQUIRED_TAGS gated on presence, so a single pod card opened the gate and the theme then claimed
 * its members through `sacrifice-outlet` and friends — what a pod deck's SUPPORT looks like, not its
 * engine. Measured on a Nath of the Gilt-Leaf stax list holding one pod card: Birthing Pod was
 * promoted ahead of Stax and Discard. Same correction `deserts` already carries.
 */
const CATALOGS: MtgCatalogs = {
  mechanics: new Set(),
  creatureTypes: new Set(),
  permanentSubtypes: new Set(),
};

const tag = (name: string, slug: string): EDHRECTag => ({ name, slug, numDecks: 20000 });

function card(name: string): ScryfallCard {
  return {
    id: name, oracle_id: `oid-${name}`, name, cmc: 3,
    type_line: 'Creature — Elf', keywords: [], color_identity: ['B', 'G'],
    rarity: 'rare', set: 'tst', set_name: 'Test',
    prices: {}, legalities: { commander: 'legal' },
  } as ScryfallCard;
}

/** Sacrifice vocabulary — a pod deck's support, and any elves-and-sac deck's too. */
const SUPPORT = ['Sac Outlet A', 'Sac Outlet B', 'Sac Outlet C', 'Sac Outlet D',
  'Reanimator A', 'Reanimator B', 'Reanimator C', 'Reanimator D'];
const POD_A = 'Birthing Pod';
const POD_B = 'Prime Speaker Vannifar';

const model = buildThemeModel(
  tag('Birthing Pod', 'birthing-pod'),
  CATALOGS,
  {
    'birthing-pod': {
      charTags: ['birthing-pod', 'sacrifice-outlet', 'repeatable-sacrifice-outlet', 'reanimate-creature'],
      baseRate: 0.09,
    } as never,
  },
);

/** Support cards carry only the generic vocabulary; pod cards carry the engine tag too. */
const tagsFor = (c: ScryfallCard): readonly string[] =>
  c.name.startsWith('Sac Outlet') ? ['sacrifice-outlet', 'repeatable-sacrifice-outlet']
  : c.name.startsWith('Reanimator') ? ['reanimate-creature']
  : ['birthing-pod', 'sacrifice-outlet'];

function score(deck: string[]) {
  const cards = deck.map(card);
  const scored = scoreThemesForDeck(cards, [model], tagsFor, new Set(), undefined, new Set(), null);
  return scored[0];
}

describe('tag gate counts cards, not mere presence', () => {
  it('blocks declaration on a single pod effect', () => {
    const s = score([...SUPPORT, POD_A]);
    // Still scored — the data is informative, the deck really does look pod-adjacent.
    expect(s.members).toBeGreaterThan(1);
    // But it cannot be the answer.
    expect(s.gateMissing).toEqual({
      kind: 'tag', subject: 'birthing-pod', need: 2, have: 1,
    });
    expect(survivingThemes([s])).toEqual([]);
  });

  it('allows it once the engine appears on two cards', () => {
    const s = score([...SUPPORT, POD_A, POD_B]);
    expect(s.gateMissing).toBeUndefined();
  });

  it('blocks a deck with the support vocabulary and no engine at all', () => {
    const s = score(SUPPORT);
    expect(s.gateMissing?.kind).toBe('tag');
    expect(s.gateMissing?.have).toBe(0);
  });

  it('counts cards, not tag occurrences on one card', () => {
    // Two pod cards clear min 2; one pod card cannot, however many tags it carries.
    expect(score([...SUPPORT, POD_A]).gateMissing?.have).toBe(1);
    expect(score([...SUPPORT, POD_A, POD_B]).gateMissing).toBeUndefined();
  });
});
