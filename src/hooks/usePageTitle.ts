import { useEffect } from 'react';
import { DEFAULT_TITLE, formatTitle, type TitlePart } from '@/services/title';

/**
 * Sets `document.title` for the current page from contextual parts, and
 * restores the default title on unmount. Re-runs whenever the parts change, so
 * a page can pass live data (a commander or deck name) that resolves after the
 * initial render.
 *
 *   usePageTitle('Build');
 *   usePageTitle([commanderName, 'Build']);   // "Krenko — Build · ManaFoundry"
 *
 * Pass nothing (or all-empty parts) for the default "ManaFoundry — EDH Deck Builder".
 */
export function usePageTitle(parts?: TitlePart | TitlePart[]): void {
  // Array identity would change every render; depend on the resolved string.
  const title = formatTitle(parts);

  useEffect(() => {
    document.title = title;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}
