import type { ScryfallCard } from '@/types';
import { testMembership, type ThemeModel, type MembershipResult } from '@/services/themes';

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
