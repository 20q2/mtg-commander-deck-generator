import type { EDHRECCommanderData } from '@/types';
import type { ThemeFit } from '@/services/deckBuilder/themeFit';

/**
 * How a card earned its membership, strongest first.
 *
 * `literal` — the card's own type line, keywords or rules text carries the theme's mechanic. Proof.
 * `tag`     — inferred from oracle-tag co-occurrence. Informative, but can be wrong.
 * `edhrec`  — the commander's theme page lists it. Says the card is statistically at home in the
 *             strategy, which is the only way to know about an enabler that carries no marker.
 */
export type ThemeBasis = 'literal' | 'tag' | 'edhrec';

/**
 * Theme membership for cards in the current deck, scoped to the user's
 * currently selected themes (primary + optional secondary). Theme indices
 * match the order chips appear in the THEMES popover:
 *   0 = primary (violet chip "1")
 *   1 = secondary (amber chip "2")
 */
export interface ThemeMembership {
  themes: { slug: string; name: string }[];
  /** lowercased card name → indices into `themes` */
  byCard: Map<string, number[]>;
  /** lowercased card name → strongest basis for that card's membership. */
  basisByCard: Map<string, ThemeBasis>;
}

export function themeKey(name: string): string {
  return name.toLowerCase();
}

const BASIS_RANK: Record<ThemeBasis, number> = { edhrec: 0, tag: 1, literal: 2 };

/**
 * Theme membership for the deck's cards, unioned from two independent sources.
 *
 * EDHREC's theme page knows cards that statistically belong but carry no marker — an
 * extra-land-drop enabler in a Landfall deck has no landfall keyword, yet sits in a quarter of
 * those decks. The classifier knows cards whose own text proves membership, including ones EDHREC
 * has never listed for this commander, which is exactly what a thin page cannot tell us (Toph's
 * landfall page: 166 decks). Neither source contains the other, so take both and keep the stronger
 * basis per card.
 */
export function buildThemeMembership(
  primary: { slug: string; name: string } | null,
  secondary: { slug: string; name: string } | null,
  themeData: Map<string, EDHRECCommanderData>,
  fit?: ThemeFit | null,
): ThemeMembership {
  const selected: { slug: string; name: string }[] = [];
  if (primary) selected.push(primary);
  if (secondary) selected.push(secondary);

  const byCard = new Map<string, number[]>();
  const basisByCard = new Map<string, ThemeBasis>();

  const stamp = (cardName: string, idx: number, basis: ThemeBasis) => {
    const key = themeKey(cardName);
    const existing = byCard.get(key);
    if (existing) { if (!existing.includes(idx)) existing.push(idx); }
    else byCard.set(key, [idx]);

    const prev = basisByCard.get(key);
    if (!prev || BASIS_RANK[basis] > BASIS_RANK[prev]) basisByCard.set(key, basis);
  };

  selected.forEach((theme, idx) => {
    const data = themeData.get(theme.slug);
    if (data) {
      for (const c of data.cardlists.allNonLand ?? []) stamp(c.name, idx, 'edhrec');
      for (const c of data.cardlists.lands ?? []) stamp(c.name, idx, 'edhrec');
    }
    // The fit indexes into ITS OWN theme list, which can be ordered differently or hold a subset
    // (a slug missing from EDHREC's taxonomy is skipped). Match on slug, never on index.
    if (!fit) return;
    const fitIdx = fit.themes.findIndex(t => t.slug === theme.slug);
    if (fitIdx < 0) return;
    for (const [key, v] of fit.byCard) {
      if (v.indices.includes(fitIdx)) stamp(key, idx, v.basis);
    }
  });

  return { themes: selected, byCard, basisByCard };
}

/**
 * Does this card provably carry a selected theme's mechanic? The cut-protection test.
 *
 * Deliberately excludes `edhrec` and `tag`: page presence and tag co-occurrence are aggregate
 * signals that can be wrong about any individual card, and a wrong keep is as bad as a wrong cut.
 * Only the card's own text earns an exemption.
 */
export function isLiteralThemeMember(
  membership: ThemeMembership | null | undefined,
  cardName: string,
): boolean {
  if (!membership) return false;
  const lower = cardName.toLowerCase();
  const keys = cardName.includes(' // ') ? [lower, lower.split(' // ')[0]] : [lower];
  return keys.some(k => membership.basisByCard.get(k) === 'literal');
}
