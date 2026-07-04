import type { UserCardList } from '@/types';

export interface ThemeRef { name: string; slug: string }

type UpdateThemesFn = (id: string, updates: Partial<Pick<UserCardList, 'themes'>>) => void;

/**
 * The single write path for a list's declared themes.
 * Order carries meaning: themes[0] = primary, themes[1] = secondary.
 * Both null → the field is cleared (undefined, not []).
 */
export function persistListThemes(
  updateList: UpdateThemesFn,
  listId: string,
  primary: ThemeRef | null,
  secondary: ThemeRef | null,
): void {
  const themes = [primary, secondary].filter((t): t is ThemeRef => t !== null);
  updateList(listId, { themes: themes.length > 0 ? themes : undefined });
}
