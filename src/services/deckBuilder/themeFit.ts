import type { ScryfallCard } from '@/types';
import {
  buildThemeModel, loadThemeCharTags, testMembership,
  type ThemeModel, type MembershipResult,
} from '@/services/themes';
import { getMtgCatalogs } from '@/services/scryfall/client';
import { fetchAllTags } from '@/services/edhrec/client';
import { loadTagIndex, tagsForOracleId } from '@/services/spellchroma/tagIndex';

/**
 * Why a card counts toward the deck's selected themes.
 *
 * `literal` — the card's own type line, keywords or rules text says so. Near-certain, and the only
 * basis that earns cut protection: no amount of aggregate data argues with a card that says Elf.
 * `tag` — inferred from oracle-tag co-occurrence. Genuinely informative but can be wrong, so it
 * informs ranking without ever vetoing a cut.
 */
export interface CardThemeFit {
  /** Indices into `ThemeFit.themes` this card belongs to. */
  indices: number[];
  /** Strongest basis across all matched themes — `literal` beats `tag`. */
  basis: 'literal' | 'tag';
  /** The concrete things that matched: `['landfall']`, `['elf']`, `['sacrifice-outlet']`. */
  matched: string[];
}

export interface ThemeFit {
  themes: { slug: string; name: string }[];
  /** lowercased card name → fit. Absent means "not a member of any selected theme". */
  byCard: Map<string, CardThemeFit>;
}

export const EMPTY_THEME_FIT: ThemeFit = { themes: [], byCard: new Map() };

/** Both spellings of a DFC name, so a deck written either way resolves. */
function nameKeys(name: string): string[] {
  const lower = name.toLowerCase();
  return name.includes(' // ') ? [lower, lower.split(' // ')[0]] : [lower];
}

/**
 * Per-card membership in the deck's selected themes.
 *
 * Pure and network-free, which is the whole point: it has to work for cards EDHREC has never listed
 * for this commander, so it must not consult EDHREC. Deterministic themes (mechanics, tribes,
 * subtypes, card types, counter types) test the card itself and therefore cover every card ever
 * printed; archetype themes fall back to the oracle-tag signal.
 *
 * @param tagsFor oracle tag slugs for a card. Return `[]` when SpellChroma's index isn't loaded —
 *                archetype themes then find no members and deterministic themes are unaffected.
 */
export function computeThemeFit(
  cards: ScryfallCard[],
  models: ThemeModel[],
  tagsFor: (card: ScryfallCard) => readonly string[],
): ThemeFit {
  const byCard = new Map<string, CardThemeFit>();
  if (models.length === 0) return { themes: [], byCard };

  const themes = models.map(m => ({ slug: m.slug, name: m.name }));

  for (const card of cards) {
    const tags = tagsFor(card);
    let indices: number[] | null = null;
    let basis: MembershipResult['basis'] = 'none';
    const matched: string[] = [];

    // Indexed loop, not forEach: assigning `basis` inside a callback defeats TypeScript's
    // control-flow analysis, which then reads it as still 'none' after the loop.
    for (let idx = 0; idx < models.length; idx++) {
      const r = testMembership(models[idx], card, tags);
      if (!r.member) continue;
      (indices ??= []).push(idx);
      if (r.basis === 'literal') basis = 'literal';
      else if (basis !== 'literal') basis = 'tag';
      for (const m of r.matched) if (!matched.includes(m)) matched.push(m);
    }

    if (!indices) continue;
    const entry: CardThemeFit = {
      indices,
      basis: basis === 'literal' ? 'literal' : 'tag',
      matched,
    };
    for (const key of nameKeys(card.name)) byCard.set(key, entry);
  }

  return { themes, byCard };
}

/** Does this card provably carry a selected theme's mechanic/type/text? The cut-protection test. */
export function hasLiteralThemeMatch(fit: ThemeFit | null | undefined, cardName: string): boolean {
  if (!fit) return false;
  return nameKeys(cardName).some(key => fit.byCard.get(key)?.basis === 'literal');
}

/** Lowercased names of every card with literal theme evidence — the set the cut surfaces consume. */
export function literalThemeMembers(fit: ThemeFit | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!fit) return out;
  for (const [key, v] of fit.byCard) if (v.basis === 'literal') out.add(key);
  return out;
}

/**
 * Resolve the user's selected themes into testable models. Four dependencies, all cached after the
 * first call: Scryfall's vocabularies, EDHREC's tag taxonomy (for the display name and deck count),
 * the committed characteristic-tag table, and SpellChroma's oracle-tag index.
 *
 * Fails soft to `[]`. Every consumer treats an empty model list as "no theme evidence available",
 * which is exactly the pre-existing behavior — so a dependency outage degrades rather than breaks.
 */
export async function resolveThemeModels(
  themes: ReadonlyArray<{ slug: string; name: string }>,
): Promise<ThemeModel[]> {
  if (themes.length === 0) return [];
  try {
    const [tags, catalogs] = await Promise.all([
      fetchAllTags(),
      getMtgCatalogs(),
      loadTagIndex(),
    ]);
    const table = loadThemeCharTags();
    const forceArchetype = new Set(table.forceArchetype ?? []);
    const bySlug = new Map(tags.map(t => [t.slug, t]));

    const models: ThemeModel[] = [];
    for (const theme of themes) {
      const tag = bySlug.get(theme.slug);
      if (!tag) continue;
      models.push(buildThemeModel(tag, catalogs, table.themes, forceArchetype));
    }
    return models;
  } catch {
    return [];
  }
}

/** The `tagsFor` callback `computeThemeFit` expects, backed by SpellChroma's index. */
export function oracleTagsFor(card: ScryfallCard): readonly string[] {
  return card.oracle_id ? tagsForOracleId(card.oracle_id) : [];
}

/** One call: resolve models for the selected themes, then fit the deck's cards against them. */
export async function buildThemeFit(
  cards: ScryfallCard[],
  themes: ReadonlyArray<{ slug: string; name: string }>,
): Promise<ThemeFit> {
  const models = await resolveThemeModels(themes);
  if (models.length === 0) return EMPTY_THEME_FIT;
  return computeThemeFit(cards, models, oracleTagsFor);
}
