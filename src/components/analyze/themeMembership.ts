import type { EDHRECCommanderData } from '@/types';

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
}

export function themeKey(name: string): string {
  return name.toLowerCase();
}

export function buildThemeMembership(
  primary: { slug: string; name: string } | null,
  secondary: { slug: string; name: string } | null,
  themeData: Map<string, EDHRECCommanderData>,
): ThemeMembership {
  const selected: { slug: string; name: string }[] = [];
  if (primary) selected.push(primary);
  if (secondary) selected.push(secondary);

  const byCard = new Map<string, number[]>();
  selected.forEach((theme, idx) => {
    const data = themeData.get(theme.slug);
    if (!data) return;
    const stamp = (cardName: string) => {
      const key = themeKey(cardName);
      const existing = byCard.get(key);
      if (existing) existing.push(idx);
      else byCard.set(key, [idx]);
    };
    for (const c of data.cardlists.allNonLand ?? []) stamp(c.name);
    for (const c of data.cardlists.lands ?? []) stamp(c.name);
  });

  return { themes: selected, byCard };
}
