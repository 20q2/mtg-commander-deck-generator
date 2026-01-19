import type { ScryfallCard, ScryfallSearchResponse } from '@/types';
import { getPartnerType, getPartnerWithName } from '@/lib/partnerUtils';

const BASE_URL = 'https://api.scryfall.com';
const MIN_REQUEST_DELAY = 100; // 100ms between requests (10/sec max)
const PARALLEL_BATCH_SIZE = 8; // Fetch 8 cards in parallel (staying under 10/sec limit)

// In-memory cache for fetched cards
const cardCache = new Map<string, ScryfallCard>();

class RateLimiter {
  private lastRequestTime = 0;

  async throttle(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < MIN_REQUEST_DELAY) {
      await new Promise((resolve) =>
        setTimeout(resolve, MIN_REQUEST_DELAY - timeSinceLastRequest)
      );
    }

    this.lastRequestTime = Date.now();
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
 * Fetch a single card by name without rate limiting (for parallel use).
 * Returns null if not found instead of throwing.
 */
async function fetchCardByNameNoThrottle(name: string): Promise<ScryfallCard | null> {
  try {
    const encodedName = encodeURIComponent(name);
    const response = await fetch(`${BASE_URL}/cards/named?exact=${encodedName}`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      if (response.status === 429) {
        // Rate limited - wait and retry
        await new Promise(resolve => setTimeout(resolve, 1000));
        return fetchCardByNameNoThrottle(name);
      }
      return null;
    }

    const card = await response.json() as ScryfallCard;
    cardCache.set(card.name, card);
    return card;
  } catch {
    return null;
  }
}

/**
 * Batch fetch multiple cards by name using parallel GET requests.
 * Uses parallel batches to maximize speed while respecting rate limits.
 *
 * @param names Array of card names to fetch
 * @returns Map of card name -> ScryfallCard for found cards
 */
export async function getCardsByNames(names: string[]): Promise<Map<string, ScryfallCard>> {
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

  console.log(`[Scryfall] Fetching ${uncachedNames.length} cards in parallel batches...`);

  // Fetch in parallel batches
  for (let i = 0; i < uncachedNames.length; i += PARALLEL_BATCH_SIZE) {
    const batch = uncachedNames.slice(i, i + PARALLEL_BATCH_SIZE);

    // Small delay between batches to respect rate limit
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_DELAY));
    }

    // Fetch all cards in this batch in parallel
    const promises = batch.map(name => fetchCardByNameNoThrottle(name));
    const results = await Promise.all(promises);

    // Add found cards to result
    for (let j = 0; j < batch.length; j++) {
      const card = results[j];
      if (card) {
        result.set(batch[j], card);
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
  const basicLands = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];

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
      // Generic Partner - find other commanders with Partner keyword (excluding "Partner with X")
      query = `is:commander f:commander keyword:partner -o:"Partner with"`;
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
      // Friends forever - find other commanders with Friends forever keyword
      query = `is:commander f:commander keyword:"Friends forever"`;
      break;

    case 'choose-background':
      // Choose a Background - find Background enchantments
      query = `t:background`;
      break;

    case 'background':
      // Background - find commanders with "Choose a Background"
      query = `is:commander f:commander o:"Choose a Background"`;
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
