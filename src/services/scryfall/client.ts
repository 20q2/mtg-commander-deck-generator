import { useEffect, useState } from 'react';
import type { ScryfallCard, ScryfallSearchResponse, CardRuling } from '@/types';
import { getPartnerType, getPartnerWithName } from '@/lib/partnerUtils';
import { readPersisted, writePersisted, readPersistedMany, writePersistedMany } from './cache';

const BASE_URL = import.meta.env.DEV ? '/scryfall-api' : 'https://api.scryfall.com';
const MIN_REQUEST_DELAY = 100; // 100ms between requests (Scryfall allows 10/sec)
const COLLECTION_BATCH_SIZE = 75; // Scryfall /cards/collection max per request

// In-memory cache for fetched cards
const cardCache = new Map<string, ScryfallCard>();

// In-memory cache for search results (used by fillWithScryfall fallbacks)
const searchCache = new Map<string, { data: ScryfallSearchResponse; timestamp: number }>();
const SEARCH_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Extract a set code from a scryfallQuery string.
 * Recognizes: set:xxx, s:xxx, e:xxx, edition:xxx (with or without quotes).
 */
export function parseSetFromQuery(scryfallQuery: string): string | undefined {
  if (!scryfallQuery) return undefined;
  const match = scryfallQuery.match(/\b(?:set|s|e|edition):["']?([a-zA-Z0-9_]+)["']?/i);
  return match ? match[1].toLowerCase() : undefined;
}

/** Return a shallow copy with deck-generation flags stripped so cached objects stay clean. */
function freshCopy(card: ScryfallCard): ScryfallCard {
  const { isMustInclude, isGameChanger, isThemeSynergyCard, isReplacement, deckRole, isMdfcLand: _mdfc, ...clean } = card;
  return clean;
}

/**
 * Queue-based rate limiter that ensures requests are properly spaced.
 * All Scryfall requests MUST go through this to prevent 429 errors.
 *
 * Supports a global cooldown: when any caller hits a 429, it can park every
 * pending and future request until the cooldown expires, instead of letting
 * dozens of in-flight requests keep firing at 100ms intervals.
 */
class RateLimiter {
  private queue: Array<() => void> = [];
  private processing = false;
  private lastRequestTime = 0;
  private cooldownUntil = 0;

  /**
   * Wait for permission to make a request.
   * Returns a promise that resolves when it's safe to send.
   */
  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.processQueue();
    });
  }

  /**
   * Pause all pending/future acquires until `now + ms`. Idempotent — only
   * extends the cooldown, never shortens it, so concurrent 429s combine safely.
   */
  cooldown(ms: number): void {
    const target = Date.now() + Math.max(0, ms);
    if (target > this.cooldownUntil) this.cooldownUntil = target;
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();

      // Honor global cooldown first — one 429 parks the whole burst.
      if (now < this.cooldownUntil) {
        await new Promise((resolve) => setTimeout(resolve, this.cooldownUntil - now));
        continue;
      }

      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < MIN_REQUEST_DELAY) {
        await new Promise((resolve) =>
          setTimeout(resolve, MIN_REQUEST_DELAY - timeSinceLastRequest)
        );
      }

      this.lastRequestTime = Date.now();
      const resolve = this.queue.shift();
      if (resolve) resolve();
    }

    this.processing = false;
  }

  // Alias for backwards compatibility
  async throttle(): Promise<void> {
    return this.acquire();
  }
}

const rateLimiter = new RateLimiter();

const MAX_RATE_LIMIT_RETRIES = 6;
const MAX_BACKOFF_MS = 30_000;

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

/**
 * Run a fetch through the rate limiter, retrying on 429 with the server's
 * Retry-After header (preferred) or exponential backoff + jitter. Every retry
 * sets a shared cooldown so concurrent callers also back off, which is the
 * thing that actually keeps Scryfall happy.
 */
async function withRateLimit(
  doFetch: () => Promise<Response>,
  maxRetries: number = MAX_RATE_LIMIT_RETRIES,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await rateLimiter.acquire();
    const response = await doFetch();
    if (response.status !== 429) return response;
    if (attempt === maxRetries) return response;

    const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
    const expBackoff = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
    const jitter = Math.random() * 250;
    const backoffMs = (retryAfter ?? expBackoff) + jitter;
    console.warn(
      `[Scryfall] 429 on attempt ${attempt + 1}, cooling down ${Math.round(backoffMs)}ms`,
    );
    rateLimiter.cooldown(backoffMs);
  }
  // Unreachable — the loop returns or sets a final response above.
  throw new Error('Scryfall rate-limit retries exhausted');
}

async function scryfallFetch<T>(endpoint: string): Promise<T> {
  const response = await withRateLimit(() =>
    fetch(`${BASE_URL}${endpoint}`, {
      headers: { 'Accept': 'application/json' },
    }),
  );

  if (!response.ok) {
    throw new Error(`Scryfall API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function searchCommanders(query: string): Promise<ScryfallCard[]> {
  if (!query.trim()) return [];

  try {
    const encodedQuery = encodeURIComponent(`is:commander f:commander ${query}`);
    const response = await scryfallFetch<ScryfallSearchResponse>(
      `/cards/search?q=${encodedQuery}&order=edhrec`
    );
    return response.data;
  } catch (err) {
    if (err instanceof Error && err.message.includes('404')) return [];
    throw err;
  }
}

export async function searchCards(
  query: string,
  colorIdentity: string[],
  options: {
    order?: 'edhrec' | 'cmc' | 'name';
    page?: number;
    skipFormatFilter?: boolean;
  } = {}
): Promise<ScryfallSearchResponse> {
  const { order = 'edhrec', page = 1, skipFormatFilter = false } = options;
  const colorFilter = colorIdentity.length > 0 ? `id<=${colorIdentity.join('')}` : '';
  const formatFilter = skipFormatFilter ? '' : 'f:commander';
  // Wrap query in parentheses so color filter applies to entire query (including OR clauses)
  const fullQuery = `${colorFilter} (${query}) ${formatFilter}`;
  const encodedQuery = encodeURIComponent(fullQuery.trim());

  // Check search cache first
  const cacheKey = `${encodedQuery}|${order}|${page}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL) {
    return cached.data;
  }

  const result = await scryfallFetch<ScryfallSearchResponse>(
    `/cards/search?q=${encodedQuery}&order=${order}&page=${page}`
  );

  searchCache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}

export async function getCardByName(name: string, exact = true): Promise<ScryfallCard> {
  // 1. In-memory cache (hot path)
  const cached = cardCache.get(name);
  if (cached) return freshCopy(cached);

  // 2. Persistent cache (warm path) — silent fallback if unavailable
  const persisted = await readPersisted(name);
  if (persisted) {
    cardCache.set(persisted.name, persisted);
    if (persisted.name !== name) cardCache.set(name, persisted); // hydrate under requested key too
    return freshCopy(persisted);
  }

  // 3. Cold — fetch from Scryfall
  const param = exact ? 'exact' : 'fuzzy';
  const encodedName = encodeURIComponent(name);
  const card = await scryfallFetch<ScryfallCard>(`/cards/named?${param}=${encodedName}`);

  // Cache the result in both layers
  cardCache.set(card.name, card);
  void writePersisted(card.name, card);
  return freshCopy(card);
}

// Rulings are shared across printings, so cache by oracle_id.
const rulingsCache = new Map<string, CardRuling[]>();

/**
 * Fetch a card's Scryfall rulings (official WotC + Scryfall judgment notes).
 * Cached in-memory by oracle_id. Returns [] on any error — rulings are
 * non-critical and should never break the preview modal.
 */
export async function fetchCardRulings(card: ScryfallCard): Promise<CardRuling[]> {
  const key = card.oracle_id || card.id;
  const cached = rulingsCache.get(key);
  if (cached) return cached;

  try {
    const response = await scryfallFetch<{ data: CardRuling[] }>(`/cards/${card.id}/rulings`);
    const rulings = (response.data ?? []).map((r) => ({
      source: r.source,
      published_at: r.published_at,
      comment: r.comment,
    }));
    rulingsCache.set(key, rulings);
    return rulings;
  } catch {
    return [];
  }
}

/**
 * Synchronous read of the rulings cache. Returns the cached rulings array, or
 * `undefined` if this card's rulings haven't been fetched yet. Lets the preview
 * modal resolve the side-panel layout during render (no async null frame), so
 * the card image doesn't jump when rulings load in.
 */
export function getCachedRulings(card: ScryfallCard): CardRuling[] | undefined {
  return rulingsCache.get(card.oracle_id || card.id);
}

const FALLBACK_SEARCH_BATCH_SIZE = 15;

/**
 * Batch-search Scryfall for cards by exact name using OR-joined queries.
 * Each batch is ONE /cards/search request (rate-limited) for up to
 * FALLBACK_SEARCH_BATCH_SIZE names, ordered by USD ascending so the cheapest
 * printing per name is first.
 *
 * Used by the price-upgrade and not-found-retry paths in getCardsByNames —
 * both used to fire one request per card, which 429'd on bursts.
 *
 * Callers are responsible for cache writes; this helper only resolves the
 * cards.
 */
const FALLBACK_SEARCH_MAX_PAGES = 4; // 4 × 175 = 700 printings per batch ceiling

async function batchSearchByExactName(
  names: string[],
  opts: { preferUsd: boolean },
): Promise<Map<string, ScryfallCard>> {
  const out = new Map<string, ScryfallCard>();
  if (names.length === 0) return out;

  for (let i = 0; i < names.length; i += FALLBACK_SEARCH_BATCH_SIZE) {
    const batch = names.slice(i, i + FALLBACK_SEARCH_BATCH_SIZE);
    const nameQuery = batch.map(n => `!"${n}"`).join(' OR ');
    const fullQuery = `(${nameQuery}) -is:digital`;

    // Collect printings across however many pages it takes. Stop early once
    // every name in the batch has at least one printing, or when Scryfall
    // tells us there are no more pages, or when we hit the page cap. Without
    // pagination, popular cards (Command Tower has 200+ printings) flood the
    // first page of 175 and starve other names in the batch.
    const byName = new Map<string, ScryfallCard[]>();
    const namesFound = new Set<string>();
    let totalRows = 0;
    let pagesFetched = 0;

    for (let page = 1; page <= FALLBACK_SEARCH_MAX_PAGES; page++) {
      const url = `${BASE_URL}/cards/search?q=${encodeURIComponent(fullQuery)}&unique=prints&order=usd&dir=asc&page=${page}`;
      try {
        const response = await withRateLimit(() =>
          fetch(url, { headers: { 'Accept': 'application/json' } }),
        );
        if (!response.ok) break; // 404 on page 1 = no matches at all; later pages just stop here

        const data = await response.json() as ScryfallSearchResponse;
        pagesFetched++;
        totalRows += data.data.length;

        for (const card of data.data) {
          const arr = byName.get(card.name) ?? [];
          arr.push(card);
          byName.set(card.name, arr);
          if (batch.includes(card.name)) namesFound.add(card.name);
          if (card.name.includes(' // ')) {
            const front = card.name.split(' // ')[0];
            const farr = byName.get(front) ?? [];
            farr.push(card);
            byName.set(front, farr);
            if (batch.includes(front)) namesFound.add(front);
          }
        }

        if (!data.has_more) break;
        if (batch.every(n => namesFound.has(n))) break; // every name has at least one row
      } catch (err) {
        console.warn('[Scryfall] batchSearchByExactName batch failed:', err);
        break;
      }
    }

    const missing = batch.filter(n => !namesFound.has(n));
    if (missing.length > 0 || pagesFetched > 1) {
      console.log(
        `[Scryfall] batch search: ${batch.length} names, ${pagesFetched} page(s), ${totalRows} prints` +
        (missing.length > 0 ? ` — missed: ${missing.join(', ')}` : ''),
      );
    }

    // Pick best printing per requested name. Printings are ordered by USD
    // ascending, so the first printing with a USD price is the cheapest.
    for (const name of batch) {
      const printings = byName.get(name);
      if (!printings || printings.length === 0) continue;
      const best = opts.preferUsd
        ? (printings.find(c => c.prices?.usd) ?? printings.find(c => getCardPrice(c)) ?? printings[0])
        : printings[0];
      out.set(name, best);
    }
  }

  return out;
}

/**
 * Batch fetch multiple cards by name using Scryfall's /cards/collection endpoint.
 * Fetches up to 75 cards per request, drastically reducing API calls vs individual lookups.
 *
 * @param names Array of card names to fetch
 * @returns Map of card name -> ScryfallCard for found cards
 */
export async function getCardsByNames(
  names: string[],
  onProgress?: (fetched: number, total: number) => void,
  preferredSet?: string
): Promise<Map<string, ScryfallCard>> {
  const result = new Map<string, ScryfallCard>();

  if (names.length === 0) return result;

  // Check in-memory cache first
  const uncachedNames: string[] = [];
  for (const name of names) {
    const cacheKey = preferredSet ? `${name}|${preferredSet}` : name;
    const cached = cardCache.get(cacheKey);
    if (cached) {
      result.set(name, freshCopy(cached));
    } else {
      uncachedNames.push(name);
    }
  }

  // Check persistent cache for in-memory misses. Persistent cache is keyed by
  // canonical name only (no preferredSet); a preferred-set request still falls
  // through to the network for the set-specific printing.
  if (!preferredSet && uncachedNames.length > 0) {
    const persisted = await readPersistedMany(uncachedNames);
    if (persisted.size > 0) {
      const stillMissing: string[] = [];
      for (const name of uncachedNames) {
        const card = persisted.get(name);
        if (card) {
          cardCache.set(card.name, card);
          if (card.name !== name) cardCache.set(name, card);
          result.set(name, freshCopy(card));
        } else {
          stillMissing.push(name);
        }
      }
      uncachedNames.length = 0;
      uncachedNames.push(...stillMissing);
    }
  }

  // If all cards were cached, return early
  if (uncachedNames.length === 0) return result;

  console.log(`[Scryfall] Fetching ${uncachedNames.length} cards via /cards/collection${preferredSet ? ` (set: ${preferredSet})` : ''}...`);

  // Track names not found in the preferred set for a fallback pass
  const setNotFoundNames: string[] = [];

  // Use Scryfall's /cards/collection endpoint (up to 75 per request)
  for (let i = 0; i < uncachedNames.length; i += COLLECTION_BATCH_SIZE) {
    const batch = uncachedNames.slice(i, i + COLLECTION_BATCH_SIZE);
    const identifiers = preferredSet
      ? batch.map(name => ({ name, set: preferredSet }))
      : batch.map(name => ({ name }));

    try {
      const response = await withRateLimit(() =>
        fetch(`${BASE_URL}/cards/collection`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ identifiers }),
        }),
      );

      if (response.ok) {
        const data = await response.json() as { data: ScryfallCard[]; not_found: Array<{ name?: string; set?: string }> };
        for (const card of data.data) {
          const cacheKey = preferredSet ? `${card.name}|${preferredSet}` : card.name;
          cardCache.set(cacheKey, card);
          if (!preferredSet) cardCache.set(card.name, card); // also cache under plain name when no set preference
          const copy = freshCopy(card);
          result.set(card.name, copy);
          // For DFCs, also store under front-face name so EDHREC lookups match
          if (card.name.includes(' // ')) {
            const frontFace = card.name.split(' // ')[0];
            result.set(frontFace, copy);
            if (preferredSet) cardCache.set(`${frontFace}|${preferredSet}`, card);
            else cardCache.set(frontFace, card);
          }
        }
        // Persist non-preferred-set batches. Skip for preferredSet because those
        // are printing-specific and the persistent cache is canonical-name-only.
        if (!preferredSet && data.data.length > 0) {
          void writePersistedMany(data.data.map(card => ({ name: card.name, card })));
        }
        if (data.not_found.length > 0) {
          if (preferredSet) {
            // Collect not-found names for fallback pass without set constraint
            for (const nf of data.not_found) {
              if (nf.name) setNotFoundNames.push(nf.name);
            }
          } else {
            console.warn(`[Scryfall] ${data.not_found.length} cards not found in collection batch`);
          }
        }
      }
    } catch (err) {
      console.warn('[Scryfall] Collection batch failed:', err);
    }

    onProgress?.(Math.min(i + COLLECTION_BATCH_SIZE, uncachedNames.length), uncachedNames.length);
  }

  // Fallback pass: re-fetch cards not found in the preferred set without set constraint
  if (preferredSet && setNotFoundNames.length > 0) {
    console.log(`[Scryfall] ${setNotFoundNames.length} cards not in set "${preferredSet}", re-fetching without set constraint...`);
    for (let i = 0; i < setNotFoundNames.length; i += COLLECTION_BATCH_SIZE) {
      const batch = setNotFoundNames.slice(i, i + COLLECTION_BATCH_SIZE);
      const identifiers = batch.map(name => ({ name }));

      try {
        const response = await withRateLimit(() =>
          fetch(`${BASE_URL}/cards/collection`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({ identifiers }),
          }),
        );

        if (response.ok) {
          const data = await response.json() as { data: ScryfallCard[]; not_found: Array<{ name?: string }> };
          for (const card of data.data) {
            cardCache.set(card.name, card);
            const copy = freshCopy(card);
            result.set(card.name, copy);
            if (card.name.includes(' // ')) {
              const frontFace = card.name.split(' // ')[0];
              result.set(frontFace, copy);
              cardCache.set(frontFace, card);
            }
          }
          if (data.data.length > 0) {
            void writePersistedMany(data.data.map(card => ({ name: card.name, card })));
          }
        }
      } catch (err) {
        console.warn('[Scryfall] Fallback collection batch failed:', err);
      }
    }
  }

  // Re-fetch cards that came back with no price (e.g. unreleased reprints)
  // Skip when user specified a preferred set — they want that set's printing, not the cheapest
  // Re-check ALL no-price cards in the result, not just network-fetched ones.
  // The persistent cache can hold no-price entries from earlier generations
  // (e.g. cards that were freshly-spoiled at the time and had no priced
  // printings yet). We retry the upgrade every generation so they get priced
  // once Scryfall publishes data — costs at most one batched search per gen.
  if (!preferredSet) {
    const noPriceNames: string[] = [];
    for (const name of names) {
      const card = result.get(name);
      if (card && !getCardPrice(card)) noPriceNames.push(name);
    }
    if (noPriceNames.length > 0) {
      console.log(`[Scryfall] Re-checking ${noPriceNames.length} cards with no price (batched)...`);
      const repriced = await batchSearchByExactName(noPriceNames, { preferUsd: true });
      for (const [name, card] of repriced) {
        if (!getCardPrice(card)) continue;
        cardCache.set(name, card);
        if (card.name !== name) cardCache.set(card.name, card);
        void writePersisted(card.name, card);
        result.set(name, freshCopy(card));
      }
    }
  }

  // For any names not found via collection, try a batched search fallback.
  const notFound = uncachedNames.filter(name => !result.has(name));
  if (notFound.length > 0) {
    console.log(`[Scryfall] Retrying ${notFound.length} not-found cards (batched)...`);
    const found = await batchSearchByExactName(notFound, { preferUsd: false });
    for (const [name, card] of found) {
      cardCache.set(name, card);
      if (card.name !== name) cardCache.set(card.name, card);
      void writePersisted(card.name, card);
      result.set(name, freshCopy(card));
    }
  }

  console.log(`[Scryfall] Batch fetch complete: ${result.size} cards found`);
  return result;
}

/**
 * Batch fetch cards by Scryfall id using /cards/collection (max 75 per request).
 * Mirrors getCardsByNames but uses { id } identifiers. Goes through the rate
 * limiter and writes results into both in-memory and persistent caches keyed
 * by name (consistent with all other paths).
 *
 * Returned Map is keyed by id so callers can re-establish input ordering.
 */
export async function getCardsByIds(
  ids: string[],
  onProgress?: (fetched: number, total: number) => void,
): Promise<Map<string, ScryfallCard>> {
  const result = new Map<string, ScryfallCard>();
  if (ids.length === 0) return result;

  for (let i = 0; i < ids.length; i += COLLECTION_BATCH_SIZE) {
    const batch = ids.slice(i, i + COLLECTION_BATCH_SIZE);
    const identifiers = batch.map(id => ({ id }));

    try {
      const response = await withRateLimit(() =>
        fetch(`${BASE_URL}/cards/collection`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ identifiers }),
        }),
      );

      if (response.ok) {
        const data = await response.json() as { data: ScryfallCard[]; not_found: Array<{ id?: string }> };
        for (const card of data.data) {
          cardCache.set(card.name, card);
          if (card.name.includes(' // ')) {
            const frontFace = card.name.split(' // ')[0];
            cardCache.set(frontFace, card);
          }
          result.set(card.id, card);
        }
        if (data.data.length > 0) {
          void writePersistedMany(data.data.map(card => ({ name: card.name, card })));
        }
      }
    } catch (err) {
      console.warn('[Scryfall] getCardsByIds batch failed:', err);
    }

    onProgress?.(Math.min(i + COLLECTION_BATCH_SIZE, ids.length), ids.length);
  }

  return result;
}

const UPGRADE_BATCH_SIZE = 15; // Card names per search query for printing upgrades

/**
 * Upgrade card printings in a map to match non-set Scryfall filters (e.g. is:full-art, frame:extendedart).
 * Searches for matching printings in batches and replaces entries in-place.
 * Set-based filters (set:xxx) are stripped since those are handled by getCardsByNames.
 * When strict=true, cards without a matching printing are REMOVED from the map.
 */
export async function upgradeCardPrintings(
  cards: Map<string, ScryfallCard>,
  scryfallQuery: string,
  strict: boolean = false
): Promise<void> {
  if (!scryfallQuery) return;

  // Strip set filters — already handled by getCardsByNames' preferredSet
  const filters = scryfallQuery.replace(/\b(?:set|s|e|edition):["']?[a-zA-Z0-9_]+["']?/gi, '').trim();
  if (!filters) return;

  // Collect card names, using front-face name for DFCs in search queries
  const entries: { searchName: string; mapKey: string }[] = [];
  for (const [key, card] of cards) {
    const searchName = card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name;
    entries.push({ searchName, mapKey: key });
  }

  if (entries.length === 0) return;

  console.log(`[Scryfall] Upgrading printings for ${entries.length} cards with filters: ${filters}${strict ? ' (strict)' : ''}`);
  const cacheKeyPrefix = `upgrade|${filters}|`;
  let upgraded = 0;
  const matchedKeys = new Set<string>();

  for (let i = 0; i < entries.length; i += UPGRADE_BATCH_SIZE) {
    const batch = entries.slice(i, i + UPGRADE_BATCH_SIZE);

    // Check cache first and separate cached vs uncached
    const uncached: typeof batch = [];
    for (const entry of batch) {
      const cached = cardCache.get(`${cacheKeyPrefix}${entry.searchName}`);
      if (cached) {
        cards.set(entry.mapKey, freshCopy(cached));
        matchedKeys.add(entry.mapKey);
        upgraded++;
      } else {
        uncached.push(entry);
      }
    }

    if (uncached.length === 0) continue;

    // Build OR query: (!"Card1" OR !"Card2" OR ...) <filters>
    const nameQuery = uncached.map(e => `!"${e.searchName}"`).join(' OR ');
    const fullQuery = `(${nameQuery}) ${filters}`;
    const encodedQuery = encodeURIComponent(fullQuery);

    try {
      const response = await withRateLimit(() =>
        fetch(`${BASE_URL}/cards/search?q=${encodedQuery}&unique=prints&order=released&dir=desc`, {
          headers: { 'Accept': 'application/json' },
        }),
      );

      if (response.ok) {
        const data = await response.json() as ScryfallSearchResponse;
        // Build a name -> first matching card map (most recent printing first due to order=released desc)
        const matchMap = new Map<string, ScryfallCard>();
        for (const card of data.data) {
          const frontName = card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name;
          if (!matchMap.has(card.name) && !matchMap.has(frontName)) {
            matchMap.set(card.name, card);
            if (frontName !== card.name) matchMap.set(frontName, card);
          }
        }

        // Replace matching cards in the result map and cache them
        for (const entry of uncached) {
          const match = matchMap.get(entry.searchName) ?? matchMap.get(cards.get(entry.mapKey)?.name ?? '');
          if (match) {
            cardCache.set(`${cacheKeyPrefix}${entry.searchName}`, match);
            cards.set(entry.mapKey, freshCopy(match));
            matchedKeys.add(entry.mapKey);
            // Also update front-face key if it exists
            if (match.name.includes(' // ')) {
              const frontFace = match.name.split(' // ')[0];
              if (cards.has(frontFace)) {
                cards.set(frontFace, freshCopy(match));
                matchedKeys.add(frontFace);
              }
            }
            upgraded++;
          }
        }
      }
      // 404 = no results for this batch, not an error — just means no matching printings
    } catch {
      // Search failed, skip this batch — cards keep their default printings
    }
  }

  // In strict mode, remove cards that had no matching printing
  if (strict) {
    const removed: string[] = [];
    for (const entry of entries) {
      if (!matchedKeys.has(entry.mapKey)) {
        cards.delete(entry.mapKey);
        removed.push(entry.searchName);
      }
    }
    if (removed.length > 0) {
      console.log(`[Scryfall] Strict filter removed ${removed.length} cards with no "${filters}" printing`);
    }
  }

  if (upgraded > 0) {
    console.log(`[Scryfall] Upgraded ${upgraded}/${entries.length} cards to match "${filters}"`);
  }
}

/**
 * Pre-cache basic lands for faster deck generation.
 * Call this once at the start of deck generation.
 */
export async function prefetchBasicLands(): Promise<void> {
  const basicLands = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes'];

  // Check if already cached
  const uncached = basicLands.filter(name => !cardCache.has(name));
  if (uncached.length === 0) return;

  await getCardsByNames(uncached);
}

/**
 * Get a cached card if available (for basic lands).
 */
export function getCachedCard(name: string): ScryfallCard | undefined {
  const cached = cardCache.get(name);
  return cached ? freshCopy(cached) : undefined;
}

// Cached set of game changer card names from Scryfall
let gameChangerNamesCache: Set<string> | null = null;
let gameChangerCacheTimestamp = 0;
const GC_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch all game changer card names from Scryfall.
 * Uses `is:gamechanger` search and paginates through all results.
 */
export async function getGameChangerNames(): Promise<Set<string>> {
  if (gameChangerNamesCache && Date.now() - gameChangerCacheTimestamp < GC_CACHE_TTL) {
    return gameChangerNamesCache;
  }

  const names = new Set<string>();
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    try {
      const response = await scryfallFetch<ScryfallSearchResponse>(
        `/cards/search?q=${encodeURIComponent('is:gamechanger')}&page=${page}`
      );
      for (const card of response.data) {
        names.add(card.name);
        // For DFCs, also index by front face so EDHREC name lookups match
        if (card.name.includes(' // ')) {
          names.add(card.name.split(' // ')[0]);
        }
      }
      hasMore = response.has_more;
      page++;
    } catch {
      break;
    }
  }

  gameChangerNamesCache = names;
  gameChangerCacheTimestamp = Date.now();
  console.log(`[Scryfall] Cached ${names.size} game changer card names`);
  return names;
}

// Cached ban list results by format
const banListCache = new Map<string, { names: string[]; timestamp: number }>();
const BAN_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Fetch all cards banned in a given format from Scryfall.
 * Uses `banned:<format>` search and paginates through all results.
 */
export async function getBanList(format: string): Promise<string[]> {
  const cached = banListCache.get(format);
  if (cached && Date.now() - cached.timestamp < BAN_CACHE_TTL) {
    return cached.names;
  }

  const names: string[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    try {
      const response = await scryfallFetch<ScryfallSearchResponse>(
        `/cards/search?q=${encodeURIComponent(`banned:${format}`)}&unique=cards&order=name&page=${page}`
      );
      for (const card of response.data) {
        names.push(card.name);
      }
      hasMore = response.has_more;
      page++;
    } catch {
      break;
    }
  }

  banListCache.set(format, { names, timestamp: Date.now() });
  return names;
}

/** Convenience alias for commander ban list */
export async function getCommanderBanList(): Promise<string[]> {
  return getBanList('commander');
}

export async function autocompleteCardName(query: string): Promise<string[]> {
  if (!query.trim() || query.length < 2) return [];

  const encodedQuery = encodeURIComponent(query);
  const response = await scryfallFetch<{ data: string[] }>(
    `/cards/autocomplete?q=${encodedQuery}`
  );

  return response.data;
}

// Helper to get image URL with fallback for double-faced cards
export function getCardImageUrl(
  card: ScryfallCard,
  size: 'small' | 'normal' | 'large' = 'normal'
): string {
  if (card.image_uris) {
    return card.image_uris[size];
  }

  // Double-faced card - use front face
  if (card.card_faces && card.card_faces[0]?.image_uris) {
    return card.card_faces[0].image_uris[size];
  }

  // Fallback placeholder
  return 'https://cards.scryfall.io/normal/front/0/0/00000000-0000-0000-0000-000000000000.jpg';
}

/**
 * Get the best available USD price for a card.
 * Falls back through: usd → usd_foil → usd_etched → eur → eur_foil
 * Returns the price string or null if no price is available.
 */
/** Names of the six basic lands, including Wastes. Snow-covered variants check separately. */
export const BASIC_LAND_NAMES: ReadonlySet<string> = new Set([
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
]);

export function getCardPrice(card: ScryfallCard, currency: 'USD' | 'EUR' = 'USD'): string | null {
  if (BASIC_LAND_NAMES.has(card.name)) return '0.05';
  const p = card.prices;
  if (currency === 'EUR') return p?.eur || p?.eur_foil || p?.usd || p?.usd_foil || p?.usd_etched || null;
  return p?.usd || p?.usd_foil || p?.usd_etched || p?.eur || p?.eur_foil || null;
}

// Get the front face type_line for a card.
// MDFCs have type_line like "Instant // Land" — this returns only "Instant" (the front face).
export function getFrontFaceTypeLine(card: ScryfallCard): string {
  if (card.card_faces && card.card_faces.length >= 2 && card.card_faces[0]?.type_line) {
    return card.card_faces[0].type_line;
  }
  return card.type_line || '';
}

// Check if a card is double-faced (has separate face images)
export function isDoubleFacedCard(card: ScryfallCard): boolean {
  return !card.image_uris && !!card.card_faces && card.card_faces.length >= 2
    && !!card.card_faces[0]?.image_uris && !!card.card_faces[1]?.image_uris;
}

// Check if a card is a Modal Double-Faced Card with a land on the back face.
// Spell/land MDFCs like "Jwari Disruption // Jwari Ruins" (Instant // Land) can be
// played as either face from hand — they're effectively spells that double as lands.
// Excludes: pathway lands (Land // Land), transform DFCs, split cards.
export function isMdfcLand(card: ScryfallCard): boolean {
  if (!card.card_faces || card.card_faces.length < 2) return false;
  // Primary check: use layout field from Scryfall API
  if (card.layout && card.layout !== 'modal_dfc') return false;
  // Fallback for missing layout: require combined type_line pattern
  if (!card.layout && !card.type_line?.includes(' // ')) return false;
  const frontType = card.card_faces[0].type_line?.toLowerCase() ?? '';
  const backType = card.card_faces[1].type_line?.toLowerCase() ?? '';
  return !frontType.includes('land') && backType.includes('land');
}

/** The five colors of mana, in WUBRG order. */
export const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const;

/** True if the card's front face type line includes "Land". */
export function isLand(card: ScryfallCard): boolean {
  return getFrontFaceTypeLine(card).toLowerCase().includes('land');
}

/** True if the card is a land OR a spell/land MDFC (its back face is a land). */
export function isAnyLand(card: ScryfallCard): boolean {
  return isLand(card) || isMdfcLand(card);
}

/** True if the card's type line is a basic land (snow-covered counts). */
export function isBasicLand(card: ScryfallCard): boolean {
  const tl = getFrontFaceTypeLine(card).toLowerCase();
  return tl.includes('land') && /\bbasic\b/.test(tl);
}

/**
 * Infer which of WUBRG (and 'C' as a fallback) a card produces.
 * Uses Scryfall's `produced_mana` first, falls back to oracle-text scanning
 * for cards that lack the field.
 */
export function getProducedColors(card: ScryfallCard): string[] {
  const produced = card.produced_mana || [];
  const colors = [...new Set(produced.filter(c => (WUBRG as readonly string[]).includes(c)))];
  if (colors.length > 0) return colors.sort((a, b) => WUBRG.indexOf(a as typeof WUBRG[number]) - WUBRG.indexOf(b as typeof WUBRG[number]));
  const oracle = (card.oracle_text || '').toLowerCase();
  if (oracle.includes('any color') || oracle.includes('any type')) return [...WUBRG];
  const found: string[] = [];
  if (oracle.includes('add {w}')) found.push('W');
  if (oracle.includes('add {u}')) found.push('U');
  if (oracle.includes('add {b}')) found.push('B');
  if (oracle.includes('add {r}')) found.push('R');
  if (oracle.includes('add {g}')) found.push('G');
  if (found.length === 0 && produced.includes('C')) return ['C'];
  return found;
}

// The 5 Kamigawa: Neon Dynasty channel lands — legendary lands with Channel abilities.
// These are format staples: lands that double as spells via discard, with no downside.
export const CHANNEL_LANDS: Record<string, string> = {
  'Boseiju, Who Endures': 'G',
  'Otawara, Soaring City': 'U',
  'Eiganjo, Seat of the Empire': 'W',
  'Takenuma, Abandoned Mire': 'B',
  'Sokenzan, Crucible of Defiance': 'R',
};

/** Check if a card is one of the 5 Kamigawa channel lands. */
export function isChannelLand(card: ScryfallCard): boolean {
  return card.name in CHANNEL_LANDS;
}

/** Get channel lands that match a given color identity. */
export function getChannelLandsForColors(colorIdentity: string[]): { name: string; color: string }[] {
  return Object.entries(CHANNEL_LANDS)
    .filter(([, color]) => colorIdentity.includes(color))
    .map(([name, color]) => ({ name, color }));
}

// Search Scryfall for MDFC spell/lands matching a commander's color identity.
// Returns ALL cards where front face is a spell and back face is a land.
// Paginates through all results so nothing is missed.
export async function searchMdfcLands(colorIdentity: string[]): Promise<ScryfallCard[]> {
  const query = 'is:mdfc t:land';
  const allCards: ScryfallCard[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const result = await searchCards(query, colorIdentity, { order: 'edhrec', page });
    allCards.push(...result.data);
    hasMore = result.has_more;
    page++;
  }

  const mdfcs = allCards.filter(card => isMdfcLand(card));
  // Populate the card cache so add-card flows can resolve these by name.
  // MDFC names are double-faced ("Front // Back"); also cache by the front-face name
  // since callers sometimes split the name.
  for (const card of mdfcs) {
    cardCache.set(card.name, card);
    const frontName = card.card_faces?.[0]?.name;
    if (frontName && frontName !== card.name) cardCache.set(frontName, card);
  }
  return mdfcs;
}

// Get back face image URL for a double-faced card
export function getCardBackFaceUrl(
  card: ScryfallCard,
  size: 'small' | 'normal' | 'large' = 'normal'
): string | null {
  if (!isDoubleFacedCard(card)) return null;
  return card.card_faces![1].image_uris![size] ?? null;
}

// Helper to get oracle text including both faces for DFCs
export function getOracleText(card: ScryfallCard): string {
  if (card.oracle_text) {
    return card.oracle_text;
  }

  if (card.card_faces) {
    return card.card_faces
      .map((face) => face.oracle_text || '')
      .filter(Boolean)
      .join('\n\n');
  }

  return '';
}

/**
 * Search for valid partner commanders based on the primary commander's partner type
 */
export async function searchValidPartners(
  commander: ScryfallCard,
  searchQuery = ''
): Promise<ScryfallCard[]> {
  const partnerType = getPartnerType(commander);

  if (partnerType === 'none') {
    return [];
  }

  let query: string;

  switch (partnerType) {
    case 'partner':
      // Generic Partner - find other commanders with Partner keyword
      // Exclude "Partner with X" and "Friends forever" (Scryfall lumps them all under keyword:partner)
      query = `is:commander f:commander keyword:partner -o:"Partner with" -o:"Friends forever"`;
      break;

    case 'partner-with': {
      // Partner with X - fetch the specific card
      const partnerName = getPartnerWithName(commander);
      if (!partnerName) return [];
      try {
        const partner = await getCardByName(partnerName, true);
        return partner ? [partner] : [];
      } catch {
        return [];
      }
    }

    case 'friends-forever':
      // Friends forever - find other commanders with Friends forever in oracle text
      // Scryfall returns keyword:Partner for these, so we must use oracle text search
      query = `is:commander f:commander o:"Friends forever"`;
      break;

    case 'choose-background':
      // Choose a Background - find Background enchantments
      query = `t:background`;
      break;

    case 'background':
      // Background - find commanders with "Choose a Background"
      query = `is:commander f:commander o:"Choose a Background"`;
      break;

    case 'doctors-companion':
      // Doctor's Companion - find Doctor creatures that are commanders
      query = `is:commander f:commander t:doctor`;
      break;

    case 'doctor':
      // Doctor - find creatures with Doctor's companion keyword
      query = `is:commander f:commander keyword:"Doctor's companion"`;
      break;

    default:
      return [];
  }

  // Add user search query if provided
  if (searchQuery.trim()) {
    query = `${query} ${searchQuery}`;
  }

  try {
    const encodedQuery = encodeURIComponent(query);
    const response = await scryfallFetch<ScryfallSearchResponse>(
      `/cards/search?q=${encodedQuery}&order=edhrec`
    );

    // Filter out the commander itself from results
    return response.data.filter((card) => card.name !== commander.name);
  } catch {
    return [];
  }
}

// Word-to-number mapping for parsing "up to seven" style caps
const WORD_TO_NUMBER: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20,
};

// Cached result so we only query Scryfall once per session
let multiCopyCardsCache: Map<string, number | null> | null = null;

/**
 * Fetches all cards with "a deck can have any number/up to N" oracle text from Scryfall.
 * Returns a map of card name → maxCopies (null = unlimited).
 * Results are cached for the session — only one API call ever made.
 */
export async function fetchMultiCopyCardNames(): Promise<Map<string, number | null>> {
  if (multiCopyCardsCache) return multiCopyCardsCache;

  const result = new Map<string, number | null>();

  try {
    const encodedQuery = encodeURIComponent('o:"a deck can have" f:commander');
    const response = await scryfallFetch<ScryfallSearchResponse>(
      `/cards/search?q=${encodedQuery}&unique=cards`
    );

    for (const card of response.data) {
      const oracle = (card.oracle_text || card.card_faces?.[0]?.oracle_text || '').toLowerCase();

      // "a deck can have any number of cards named X" → unlimited
      if (oracle.includes('any number of cards named')) {
        result.set(card.name, null);
        continue;
      }

      // "a deck can have up to seven cards named X" → parse the number
      const capMatch = oracle.match(/a deck can have up to (\w+) cards named/);
      if (capMatch) {
        const num = WORD_TO_NUMBER[capMatch[1]] ?? parseInt(capMatch[1], 10);
        result.set(card.name, isNaN(num) ? null : num);
      }
    }
  } catch (error) {
    console.warn('[Scryfall] Failed to fetch multi-copy card list:', error);
  }

  multiCopyCardsCache = result;
  return result;
}

/**
 * Path to the bundled MTG card-back fallback image. Must be base-aware:
 * the app is served under Vite's `base` (e.g. /mtg-commander-deck-generator/),
 * so a root-absolute '/card-back.png' would 404. BASE_URL always ends in '/'.
 */
export const CARD_BACK_URL = `${import.meta.env.BASE_URL}card-back.png`;

/**
 * React hook returning a usable image URL for the given card name. Routes
 * the cache miss through getCardByName (rate-limited + persistent-cached).
 * Returns the card-back fallback URL until the real image resolves, on
 * errors, or when name is null/undefined.
 */
export function useScryfallImage(
  name: string | null | undefined,
  version: 'small' | 'normal' | 'large' = 'normal',
): { url: string; loading: boolean } {
  const initial = name ? cardCache.get(name) ?? null : null;
  const [resolved, setResolved] = useState<ScryfallCard | null>(initial);
  const [loading, setLoading] = useState<boolean>(!!name && !initial);

  useEffect(() => {
    if (!name) {
      setResolved(null);
      setLoading(false);
      return;
    }
    const cached = cardCache.get(name);
    if (cached) {
      setResolved(cached);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setResolved(null);
    setLoading(true);
    getCardByName(name)
      .then(card => {
        if (cancelled) return;
        setResolved(card);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        // Leave `resolved` null so the card-back stays visible
      });
    return () => { cancelled = true; };
  }, [name]);

  const url = resolved ? getCardImageUrl(resolved, version) : CARD_BACK_URL;
  return { url, loading };
}
