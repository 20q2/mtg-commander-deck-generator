// Encodes a decklist into a URL fragment so a share link carries its own
// payload. No server, no stored state: the link IS the storage.
//
// The fragment (not the query string) is the carrier on purpose. The GitHub
// Pages SPA redirect rewrites `&` to `~and~` inside the query string
// (public/404.html) and reassembles it in index.html, but both hops append
// `l.hash` verbatim — so a fragment survives untouched. It also never reaches
// the server, keeping decklists out of request logs.

export interface SharedDeckPayload {
  /**
   * Every card in the deck, INCLUDING the commanders, quantities expanded into
   * repeats. Same contract as `PasteLaneResult.cardNames`, because
   * `hydrateDeckForAnalysis` resolves the commander by looking `commanderName`
   * up in the card map it builds from this list — a commander left out of here
   * silently hydrates as a deck with no commander, which renders as a blank
   * Inspector.
   */
  cardNames: string[];
  commanderName?: string;
  partnerCommanderName?: string;
}

export type DeckLinkFailure =
  | 'malformed'
  | 'unsupported-version'
  | 'too-large'
  | 'unsupported-browser';

export class DeckLinkError extends Error {
  constructor(public readonly reason: DeckLinkFailure, message?: string) {
    super(message ?? reason);
    this.name = 'DeckLinkError';
  }
}

/** Fragment key this module owns. */
const HASH_KEY = 'd';

/**
 * Max length of the encoded fragment value. A proxy for keeping the whole URL
 * under 8000 characters — origin plus path contribute well under 500. A normal
 * 100-card deck encodes to roughly 1200.
 */
const MAX_ENCODED_LENGTH = 7500;

// ─── base64url ───────────────────────────────────────────────────────

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new DeckLinkError('malformed', 'Not valid base64url');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ─── deflate-raw via Web Streams ─────────────────────────────────────

async function streamThrough(
  bytes: Uint8Array,
  transform: 'CompressionStream' | 'DecompressionStream',
): Promise<Uint8Array> {
  const Ctor = (globalThis as Record<string, unknown>)[transform] as
    | (new (format: string) => TransformStream<Uint8Array, Uint8Array>)
    | undefined;
  if (!Ctor) throw new DeckLinkError('unsupported-browser');

  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new Ctor('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

// ─── Body format ─────────────────────────────────────────────────────
// line 1   commander name ("" if none)
// line 2   partner commander name ("" if none)
// line 3+  one card name per line, repeated for quantity
//
// Line-based rather than JSON: smaller, and card names cannot contain
// newlines, so no escaping is needed.

function toBody(p: SharedDeckPayload): string {
  return [p.commanderName ?? '', p.partnerCommanderName ?? '', ...p.cardNames].join('\n');
}

function fromBody(body: string): SharedDeckPayload {
  const lines = body.split('\n');
  if (lines.length < 3) throw new DeckLinkError('malformed', 'Body has too few lines');
  const commanderName = lines[0].trim();
  const partnerCommanderName = lines[1].trim();
  const cardNames = lines.slice(2).map(l => l.trim()).filter(Boolean);
  if (cardNames.length === 0) throw new DeckLinkError('malformed', 'No card names');
  return {
    cardNames,
    ...(commanderName ? { commanderName } : {}),
    ...(partnerCommanderName ? { partnerCommanderName } : {}),
  };
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Encode to a fragment value (without the leading "#d="). Emits version 1
 * (deflate-raw) normally, falling back to version 0 (uncompressed) when
 * CompressionStream is unavailable, so the share button never hard-fails.
 */
export async function encodeDeckPayload(p: SharedDeckPayload): Promise<string> {
  if (p.cardNames.length === 0) throw new DeckLinkError('malformed', 'No card names to encode');

  const bytes = new TextEncoder().encode(toBody(p));

  let encoded: string;
  try {
    encoded = `1.${bytesToBase64Url(await streamThrough(bytes, 'CompressionStream'))}`;
  } catch (e) {
    if (e instanceof DeckLinkError && e.reason === 'unsupported-browser') {
      encoded = `0.${bytesToBase64Url(bytes)}`;
    } else {
      throw e;
    }
  }

  if (encoded.length > MAX_ENCODED_LENGTH) {
    throw new DeckLinkError('too-large', `Encoded to ${encoded.length} chars`);
  }
  return encoded;
}

/** Decode a fragment value. Throws DeckLinkError on anything malformed. */
export async function decodeDeckPayload(raw: string): Promise<SharedDeckPayload> {
  const dot = raw.indexOf('.');
  if (dot < 1) throw new DeckLinkError('malformed', 'Missing version prefix');
  const version = raw.slice(0, dot);
  const bytes = base64UrlToBytes(raw.slice(dot + 1));

  if (version === '0') return fromBody(new TextDecoder().decode(bytes));
  if (version !== '1') throw new DeckLinkError('unsupported-version', `Version ${version}`);

  let inflated: Uint8Array;
  try {
    inflated = await streamThrough(bytes, 'DecompressionStream');
  } catch (e) {
    if (e instanceof DeckLinkError) throw e;
    throw new DeckLinkError('malformed', 'Payload could not be decompressed');
  }
  return fromBody(new TextDecoder().decode(inflated));
}

/** Pull the "d=" value out of a location hash. Returns null when absent. */
export function readDeckHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const value = params.get(HASH_KEY);
  return value && value.length > 0 ? value : null;
}

/**
 * Build a shareable payload from a deck's cards plus its commanders. Takes the
 * minimal structural shape rather than `GeneratedDeck` so callers can pass what
 * they already hold — DeckOptimizer has a flat `currentCards` list, not the
 * categories record.
 *
 * `cards` is the 99 (commanders excluded, as `GeneratedDeck.categories` has
 * them). The commanders are prepended to `cardNames` so the payload satisfies
 * the contract above; they are also named separately so the recipient knows
 * which of those cards is the commander.
 */
export function deckToSharePayload(deck: {
  cards: readonly { name: string }[];
  commander?: { name: string } | null;
  partnerCommander?: { name: string } | null;
}): SharedDeckPayload {
  const commanderName = deck.commander?.name;
  const partnerCommanderName = deck.partnerCommander?.name;
  return {
    cardNames: [
      ...(commanderName ? [commanderName] : []),
      ...(partnerCommanderName ? [partnerCommanderName] : []),
      ...deck.cards.map(c => c.name),
    ],
    ...(commanderName ? { commanderName } : {}),
    ...(partnerCommanderName ? { partnerCommanderName } : {}),
  };
}

/**
 * User-facing copy for a failed share-link load. The reasons are about the link
 * itself and read the same wherever a link is opened; `fallback` covers everything
 * else (a hydration failure, a bad card name), which is page-specific.
 */
export function shareLinkErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof DeckLinkError) {
    switch (e.reason) {
      case 'unsupported-version':
        return 'This link was made by a newer version of the site.';
      case 'unsupported-browser':
        return 'Your browser can\'t open share links. Try a current Chrome, Firefox, or Safari.';
      default:
        return 'This share link is damaged or incomplete.';
    }
  }
  return fallback;
}

/**
 * Build the absolute share URL for a route plus deck payload.
 *
 * `routePath` is the app-relative route the link should reopen on, without a
 * leading slash — `analyze/mana` or `decks/shared`. Each surface that can share
 * passes its own route so a link reopens where it was made: the Inspector keeps
 * the tab it was shared from, the deck view lands back in a deck view.
 */
export async function buildShareUrl(routePath: string, p: SharedDeckPayload): Promise<string> {
  const encoded = await encodeDeckPayload(p);
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${window.location.origin}${base}/${routePath}#${HASH_KEY}=${encoded}`;
}
