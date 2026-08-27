/**
 * Document-title formatting. Single source of truth for the app's tab title so
 * every page reads identically. Pages set titles via the `usePageTitle` hook.
 */

export const BRAND = 'ManaFoundry';

/** The title shown on the home page and as the default fallback. */
export const DEFAULT_TITLE = `${BRAND} — EDH Deck Builder`;

/**
 * Build a document title from zero or more contextual parts.
 *
 *   formatTitle()                       → "ManaFoundry — EDH Deck Builder"
 *   formatTitle('Build')                → "Build · ManaFoundry"
 *   formatTitle(['Krenko', 'Build'])    → "Krenko — Build · ManaFoundry"
 *
 * Parts are joined left-to-right with an em dash; the brand suffix is appended
 * with a middle dot. Empty / whitespace-only parts are dropped so pages can
 * pass `[commanderName, 'Build']` before the commander has resolved.
 */
export type TitlePart = string | null | undefined | false;

/** Canonical URLs always point at the production domain, even on mirror
 * deploys (GitHub Pages), so search engines index a single origin. */
const CANONICAL_ORIGIN = 'https://manafoundry.gg';

/**
 * Point `<link rel="canonical">` at the manafoundry.gg equivalent of the
 * current route. Strips the Vite base path (the GitHub Pages mirror serves
 * under /mtg-commander-deck-generator/) and any query string.
 */
export function syncCanonical(): void {
  if (typeof document === 'undefined') return;

  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  let path = window.location.pathname;
  if (base && path.startsWith(base)) path = path.slice(base.length) || '/';
  if (path.length > 1) path = path.replace(/\/+$/, '');

  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  link.href = `${CANONICAL_ORIGIN}${path}`;
}

export function formatTitle(parts?: TitlePart | TitlePart[]): string {
  const list = (Array.isArray(parts) ? parts : parts == null || parts === false ? [] : [parts])
    .map((p) => (p ? p.trim() : ''))
    .filter((p): p is string => !!p);

  if (list.length === 0) return DEFAULT_TITLE;
  return `${list.join(' — ')} · ${BRAND}`;
}
