// Parse a dragged card link (from EDHREC / Scryfall / Moxfield) into a reference
// we can resolve to a card. Dragging a link puts its URL on the drop's
// dataTransfer — but *what* URL depends on what you grabbed:
//   - a card page link  → the page URL, whose slug is the card name
//   - a card image      → the image URL (cards.scryfall.io/.../<uuid>.jpg),
//                         whose filename is the card's Scryfall id
//
// So we return a discriminated ref: resolve `name` via fuzzy name lookup, or
// `scryfallId` via a by-id lookup. Returns null for anything unrecognized.

export type CardDropRef =
  | { kind: 'name'; query: string }
  | { kind: 'scryfallId'; id: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** De-hyphenate a URL slug into a space-separated query. "claim-the-kingdom" → "claim the kingdom" */
function slugToQuery(slug: string): string {
  return decodeURIComponent(slug).replace(/-+/g, ' ').trim();
}

/** Host suffix match so `www.` and other subdomains are accepted. */
function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith('.' + domain);
}

function nameRef(slug: string | undefined): CardDropRef | null {
  const query = slug ? slugToQuery(slug) : '';
  return query ? { kind: 'name', query } : null;
}

/**
 * text is the drop's dataTransfer content — `text/uri-list` (preferred) or
 * `text/plain`. `text/uri-list` may contain comment lines (starting with `#`) and
 * multiple URLs; we take the first real URL line.
 */
export function parseCardDropUrl(text: string | null | undefined): CardDropRef | null {
  if (!text) return null;

  const firstUrl = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .find(l => l && !l.startsWith('#'));
  if (!firstUrl) return null;

  let url: URL;
  try {
    url = new URL(firstUrl);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  // Path segments with empties stripped ("/cards/claim-the-kingdom" → ["cards","claim-the-kingdom"])
  const segments = url.pathname.split('/').filter(Boolean);

  // Scryfall card image: https://cards.scryfall.io/<size>/<face>/<a>/<b>/<uuid>.jpg
  // The filename is the card's Scryfall id — resolve it by id. (scryfall.io serves
  // images/symbols only; non-UUID filenames like symbol SVGs fall through to null.)
  if (hostIs(host, 'scryfall.io')) {
    const last = segments[segments.length - 1];
    const id = last ? last.replace(/\.[a-z]+$/i, '') : ''; // strip extension
    return UUID_RE.test(id) ? { kind: 'scryfallId', id } : null;
  }

  // EDHREC: https://edhrec.com/cards/<slug>  (commanders/decks pages are ignored)
  if (hostIs(host, 'edhrec.com')) {
    if (segments.length >= 2 && segments[0] === 'cards') return nameRef(segments[1]);
    return null;
  }

  // Scryfall card page: https://scryfall.com/card/<set>/<num>/<slug>
  if (hostIs(host, 'scryfall.com')) {
    if (segments.length >= 4 && segments[0] === 'card') return nameRef(segments[3]);
    return null;
  }

  // Moxfield: card links live under /cards/<...>. Best-effort — Moxfield sometimes
  // uses opaque IDs rather than name slugs, in which case the fuzzy lookup fails
  // gracefully downstream.
  if (hostIs(host, 'moxfield.com')) {
    if (segments.length >= 2 && segments[0] === 'cards') return nameRef(segments[1]);
    return null;
  }

  return null;
}
