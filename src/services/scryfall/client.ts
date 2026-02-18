import type { ScryfallCard, ScryfallSearchResponse } from '@/types';
import { getPartnerType, getPartnerWithName } from '@/lib/partnerUtils';

const BASE_URL = import.meta.env.DEV ? '/scryfall-api' : 'https://api.scryfall.com';
const MIN_REQUEST_DELAY = 100; // 100ms between requests (Scryfall allows 10/sec)
const SEQUENTIAL_BATCH_SIZE = 5; // Fetch cards sequentially in smaller batches

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
  } = {}
): Promise<ScryfallSearchResponse> {
  const { order = 'edhrec', page = 1 } = options;
  const colorFilter = colorIdentity.length > 0 ? `id<=${colorIdentity.join('')}` : '';
  // Wrap query in parentheses so color filter applies to entire query (including OR clauses)
  const fullQuery = `${colorFilter} (${query}) f:commander`;
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
        // Pick the first printing that has a USD price; fall back to first result
        const card = searchResult.data.find(c => c.prices?.usd) || searchResult.data[0];
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
 * Batch fetch multiple cards by name with proper rate limiting.
 * Uses sequential requests with proper spacing to avoid 429 errors.
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

  console.log(`[Scryfall] Fetching ${uncachedNames.length} cards sequentially with rate limiting...`);

  // Fetch cards sequentially with rate limiting to avoid 429 errors
  // Process in small batches for progress logging
  let fetched = 0;
  for (let i = 0; i < uncachedNames.length; i += SEQUENTIAL_BATCH_SIZE) {
    const batch = uncachedNames.slice(i, i + SEQUENTIAL_BATCH_SIZE);

    // Fetch each card in the batch sequentially (rate limiter handles timing)
    for (const name of batch) {
      const card = await fetchCardByNameThrottled(name);
      if (card) {
        result.set(name, card);
      }
      fetched++;
    }

    // Report progress
    onProgress?.(fetched, uncachedNames.length);

    // Log progress for large fetches
    if (uncachedNames.length > 10 && i > 0 && i % 10 === 0) {
      console.log(`[Scryfall] Progress: ${Math.min(i + SEQUENTIAL_BATCH_SIZE, uncachedNames.length)}/${uncachedNames.length} cards`);
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
