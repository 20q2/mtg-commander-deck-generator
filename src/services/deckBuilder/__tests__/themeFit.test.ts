import { describe, it, expect } from 'vitest';
import { buildThemeModel } from '@/services/themes';
import type { ThemeTableEntry } from '@/services/themes';
import type { MtgCatalogs } from '@/services/scryfall/client';
import type { EDHRECTag, ScryfallCard } from '@/types';
import { computeThemeFit, hasLiteralThemeMatch, literalThemeMembers } from '../themeFit';

/**
 * Minimal catalogs — only the vocabulary these themes need. Real ones come from Scryfall, but
 * `classifyTheme` is pure over whatever Sets it's handed, so this keeps the suite offline.
 */
const CATALOGS: MtgCatalogs = {
  mechanics: new Set(['landfall']),
  creatureTypes: new Set(['elf']),
  permanentSubtypes: new Set(),
};

const tag = (name: string, slug: string, numDecks = 1000): EDHRECTag => ({ name, slug, numDecks });

function card(over: Partial<ScryfallCard> & { name: string }): ScryfallCard {
  return {
    id: over.name,
    oracle_id: `oid-${over.name}`,
    cmc: 3,
    type_line: 'Creature — Human',
    keywords: [],
    color_identity: ['G'],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...over,
  } as ScryfallCard;
}

// Landfall is an ability word, so it lands in `mechanics` → tested against card.keywords.
const landfall = buildThemeModel(tag('Landfall', 'landfall', 19932), CATALOGS, {});
// Elves is a creature type → tested against the type line's subtypes.
const elves = buildThemeModel(tag('Elves', 'elves', 9000), CATALOGS, {});
// Aristocrats names no card attribute → archetype → tested against oracle tags.
const ARISTO_ENTRY: ThemeTableEntry = { charTags: ['sacrifice-outlet'], baseRate: 0.02 };
const aristocrats = buildThemeModel(
  tag('Aristocrats', 'aristocrats', 5000), CATALOGS, { aristocrats: ARISTO_ENTRY },
);

describe('computeThemeFit', () => {
  it('marks a keyword carrier as a literal member', () => {
    const scute = card({ name: 'Scute Swarm', keywords: ['Landfall'] });
    const fit = computeThemeFit([scute], [landfall], () => []);

    expect(fit.byCard.get('scute swarm')).toEqual({
      indices: [0], basis: 'literal', matched: ['landfall'],
    });
    expect(hasLiteralThemeMatch(fit, 'Scute Swarm')).toBe(true);
  });

  it('does not mark an enabler that lacks the keyword', () => {
    const loot = card({ name: 'Loot, Exuberant Explorer', keywords: [] });
    const fit = computeThemeFit([loot], [landfall], () => []);

    expect(fit.byCard.has('loot, exuberant explorer')).toBe(false);
    expect(hasLiteralThemeMatch(fit, 'Loot, Exuberant Explorer')).toBe(false);
  });

  it('records a tag match as basis "tag", not "literal"', () => {
    const pod = card({ name: 'Birthing Pod' });
    const fit = computeThemeFit([pod], [aristocrats], () => ['sacrifice-outlet']);

    expect(fit.byCard.get('birthing pod')?.basis).toBe('tag');
    // Inferred evidence must not confer the protection that proof does.
    expect(hasLiteralThemeMatch(fit, 'Birthing Pod')).toBe(false);
  });

  it('literal evidence wins when a card matches two themes on different bases', () => {
    const elf = card({ name: 'Elvish Pod Elf', type_line: 'Creature — Elf' });
    const fit = computeThemeFit([elf], [aristocrats, elves], () => ['sacrifice-outlet']);

    const entry = fit.byCard.get('elvish pod elf')!;
    expect(entry.indices).toEqual([0, 1]);
    expect(entry.basis).toBe('literal');
    expect(entry.matched).toContain('elf');
    expect(entry.matched).toContain('sacrifice-outlet');
  });

  it('matches a DFC on either face name', () => {
    const dfc = card({ name: 'A // B', keywords: ['Landfall'] });
    const fit = computeThemeFit([dfc], [landfall], () => []);

    expect(hasLiteralThemeMatch(fit, 'A // B')).toBe(true);
    expect(hasLiteralThemeMatch(fit, 'A')).toBe(true);
  });

  it('returns an empty fit when no themes are selected', () => {
    const fit = computeThemeFit([card({ name: 'Anything' })], [], () => []);
    expect(fit.byCard.size).toBe(0);
    expect(fit.themes).toEqual([]);
  });

  it('literalThemeMembers lists only the proven members', () => {
    const cards = [
      card({ name: 'Scute Swarm', keywords: ['Landfall'] }),
      card({ name: 'Birthing Pod' }),
    ];
    const fit = computeThemeFit(cards, [landfall, aristocrats], () => ['sacrifice-outlet']);

    expect(literalThemeMembers(fit)).toEqual(new Set(['scute swarm']));
  });
});
