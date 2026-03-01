import type { ScryfallCard, ScryfallSearchResponse } from '@/types';
import { getPartnerType, getPartnerWithName } from '@/lib/partnerUtils';

const BASE_URL = import.meta.env.DEV ? '/scryfall-api' : 'https://api.scryfall.com';
const MIN_REQUEST_DELAY = 100; // 100ms between requests (Scryfall allows 10/sec)
const COLLECTION_BATCH_SIZE = 75; // Scryfall /cards/collection max per request

// In-memory cache for fetched cards
const cardCache = new Map<string, ScryfallCard>();

/**
 * Queue-based rate limiter that ensures requests are properly spaced.
 * All Scryfall requests MUST go through this to prevent 429 errors.
 */
class RateLimiter {
  private queue: Array<() => void> = [];
  private processing = false;
  private lastRequestTime = 0;

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

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
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

async function scryfallFetch<T>(endpoint: string): Promise<T> {
  await rateLimiter.throttle();

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 429) {
      // Rate limited - wait and retry once
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return scryfallFetch<T>(endpoint);
    }
    throw new Error(`Scryfall API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function searchCommanders(query: string): Promise<ScryfallCard[]> {
  if (!query.trim()) return [];

  const encodedQuery = encodeURIComponent(`is:commander f:commander ${query}`);
  const response = await scryfallFetch<ScryfallSearchResponse>(
    `/cards/search?q=${encodedQuery}&order=edhrec`
  );

  return response.data;
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

  return scryfallFetch<ScryfallSearchResponse>(
    `/cards/search?q=${encodedQuery}&order=${order}&page=${page}`
  );
}

export async function getCardByName(name: string, exact = true): Promise<ScryfallCard> {
  // Check cache first
  const cached = cardCache.get(name);
  if (cached) return cached;

  const param = exact ? 'exact' : 'fuzzy';
  const encodedName = encodeURIComponent(name);
  const card = await scryfallFetch<ScryfallCard>(`/cards/named?${param}=${encodedName}`);

  // Cache the result
  cardCache.set(card.name, card);
  return card;
}

/**
 * Fetch a single card by name with proper rate limiting.
 * Returns null if not found instead of throwing.
 */
async function fetchCardByNameThrottled(name: string, retries = 2): Promise<ScryfallCard | null> {
  try {
    await rateLimiter.acquire();

    // Search for cheapest USD paper printing across all sets
    // Filter out digital-only printings and require a USD price
    const searchQuery = encodeURIComponent(`!"${name}" -is:digital`);
    const response = await fetch(
      `${BASE_URL}/cards/search?q=${searchQuery}&unique=prints&order=usd&dir=asc`,
      { headers: { 'Accept': 'application/json' } }
    );

    if (response.ok) {
      const searchResult = await response.json() as ScryfallSearchResponse;
      if (searchResult.data.length > 0) {
        // Prefer a printing with a normal USD price, then any price, then first result
        const card = searchResult.data.find(c => c.prices?.usd)
          || searchResult.data.find(c => getCardPrice(c))
          || searchResult.data[0];
        cardCache.set(name, card);
        // Also cache under Scryfall's canonical name if different
        if (card.name !== name) cardCache.set(card.name, card);
        return card;
      }
    }

    if (response.status === 429 && retries > 0) {
      const backoffMs = 1000 * (3 - retries);
      console.warn(`[Scryfall] Rate limited, backing off ${backoffMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      return fetchCardByNameThrottled(name, retries - 1);
    }

    // Fallback to /cards/named if search returned no results (name mismatch, etc.)
    if (response.status === 404) {
      await rateLimiter.acquire();
      const namedResponse = await fetch(
        `${BASE_URL}/cards/named?exact=${encodeURIComponent(name)}`,
        { headers: { 'Accept': 'application/json' } }
      );
      if (!namedResponse.ok) return null;
      const card = await namedResponse.json() as ScryfallCard;
      cardCache.set(card.name, card);
      return card;
    }

    return null;
  } catch {
    return null;
  }
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
  onProgress?: (fetched: number, total: number) => void
): Promise<Map<string, ScryfallCard>> {
  const result = new Map<string, ScryfallCard>();

  if (names.length === 0) return result;

  // Check cache first and collect uncached names
  const uncachedNames: string[] = [];
  for (const name of names) {
    const cached = cardCache.get(name);
    if (cached) {
      result.set(name, cached);
    } else {
      uncachedNames.push(name);
    }
  }

  // If all cards were cached, return early
  if (uncachedNames.length === 0) return result;

  console.log(`[Scryfall] Fetching ${uncachedNames.length} cards via /cards/collection...`);

  // Use Scryfall's /cards/collection endpoint (up to 75 per request)
  for (let i = 0; i < uncachedNames.length; i += COLLECTION_BATCH_SIZE) {
    const batch = uncachedNames.slice(i, i + COLLECTION_BATCH_SIZE);
    const identifiers = batch.map(name => ({ name }));

    await rateLimiter.acquire();

    try {
      const response = await fetch(`${BASE_URL}/cards/collection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ identifiers }),
      });

      if (response.ok) {
        const data = await response.json() as { data: ScryfallCard[]; not_found: Array<{ name?: string }> };
        for (const card of data.data) {
          result.set(card.name, card);
          cardCache.set(card.name, card);
          // For DFCs, also store under front-face name so EDHREC lookups match
          if (card.name.includes(' // ')) {
            const frontFace = card.name.split(' // ')[0];
            result.set(frontFace, card);
            cardCache.set(frontFace, card);
          }
        }
        if (data.not_found.length > 0) {
          console.warn(`[Scryfall] ${data.not_found.length} cards not found in collection batch`);
        }
      } else if (response.status === 429) {
        // Rate limited - back off and retry this batch
        console.warn('[Scryfall] Rate limited on collection fetch, backing off...');
        await new Promise(resolve => setTimeout(resolve, 1500));
        i -= COLLECTION_BATCH_SIZE; // retry this batch
        continue;
      }
    } catch (err) {
      console.warn('[Scryfall] Collection batch failed:', err);
    }

    onProgress?.(Math.min(i + COLLECTION_BATCH_SIZE, uncachedNames.length), uncachedNames.length);
  }

  // Re-fetch cards that came back with no price (e.g. unreleased reprints)
  // fetchCardByNameThrottled searches across all printings sorted by price
  const noPriceNames = uncachedNames.filter(name => {
    const card = result.get(name);
    return card && !getCardPrice(card);
  });
  if (noPriceNames.length > 0) {
    console.log(`[Scryfall] Re-fetching ${noPriceNames.length} cards with no price for older printings...`);
    for (const name of noPriceNames) {
      const card = await fetchCardByNameThrottled(name);
      if (card && getCardPrice(card)) {
        result.set(name, card);
        cardCache.set(name, card);
      }
    }
  }

  // For any names not found via collection, try individual fallback
  const notFound = uncachedNames.filter(name => !result.has(name));
  if (notFound.length > 0) {
    console.log(`[Scryfall] Retrying ${notFound.length} not-found cards individually...`);
    for (const name of notFound) {
      const card = await fetchCardByNameThrottled(name);
      if (card) {
        result.set(name, card);
      }
    }
  }

  console.log(`[Scryfall] Batch fetch complete: ${result.size} cards found`);
  return result;
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
  return cardCache.get(name);
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
const BASIC_LAND_NAMES = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes']);

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
