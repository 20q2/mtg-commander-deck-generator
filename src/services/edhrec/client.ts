import type {
  EDHRECTheme,
  EDHRECCard,
  EDHRECCommanderData,
  EDHRECCommanderStats,
  EDHRECSimilarCommander,
  EDHRECTopCommander
} from '@/types';

const BASE_URL = import.meta.env.DEV ? '/edhrec-api' : 'https://json.edhrec.com';
const MIN_REQUEST_DELAY = 100; // 100ms between requests

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

// Cache for commander data
const commanderCache = new Map<string, { data: EDHRECCommanderData; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Raw EDHREC response types
// Note: EDHREC cardlist cards have limited fields - they're pre-categorized by tag
interface RawEDHRECCard {
  name: string;
  sanitized: string;
  // inclusion is deck COUNT, not percentage - we calculate percentage from potential_decks
  inclusion?: number;
  num_decks?: number;
  potential_decks?: number;
  synergy?: number;
  prices?: Record<string, { price: number }>;
  image_uris?: Array<{ normal: string; art_crop?: string }>;
  color_identity?: string[];
  // Note: cmc and primary_type are NOT available in cardlist cards
  // They must be fetched from Scryfall when converting cards
  cmc?: number;
  salt?: number;
}

interface RawCardList {
  tag: string;
  cardviews: RawEDHRECCard[];
}

interface RawEDHRECResponse {
  // Top-level stats
  avg_price?: number;
  creature?: number;
  instant?: number;
  sorcery?: number;
  artifact?: number;
  enchantment?: number;
  land?: number;
  planeswalker?: number;
  battle?: number;
  basic?: number;
  nonbasic?: number;
  num_decks_avg?: number;
  deck_size?: number; // Non-commander deck size
  mana_curve?: Record<string, number>; // CMC -> count (keys are strings in JSON)

  // Similar commanders
  similar?: Array<{
    name: string;
    sanitized: string;
    color_identity?: string[];
    cmc?: number;
    image_uris?: Array<{ normal: string }>;
    url?: string;
  }>;

  // Panels with themes
  panels?: {
    taglinks?: Array<{
      value: string;
      slug: string;
      count: number;
    }>;
  };

  // Card lists
  container?: {
    json_dict?: {
      cardlists?: RawCardList[];
      card?: { name: string };
    };
  };
}

/**
 * Format commander name for EDHREC URL
 * "Atraxa, Praetors' Voice" -> "atraxa-praetors-voice"
 * "Venat, Heart of Hydaelyn // Hydaelyn, the Mothercrystal" -> "venat-heart-of-hydaelyn"
 *
 * For double-faced cards (containing "//"), EDHREC uses only the front face name.
 */
export function formatCommanderNameForUrl(name: string): string {
  // Handle double-faced cards - use only the front face name
  const frontFace = name.split(' // ')[0];

  return frontFace
    .toLowerCase()
    .replace(/[',]/g, '') // Remove apostrophes and commas
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/[^a-z0-9-]/g, ''); // Remove other special characters
}

async function edhrecFetch<T>(endpoint: string): Promise<T> {
  await rateLimiter.throttle();

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 429) {
      // Rate limited - wait and retry once
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return edhrecFetch<T>(endpoint);
    }
    throw new Error(`EDHREC API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// Tags that represent high-priority theme synergy cards
const THEME_SYNERGY_TAGS = new Set(['newcards', 'highsynergycards', 'topcards', 'gamechangers']);

/**
 * Parse raw EDHREC card into our format
 * @param raw - Raw card data from EDHREC
 * @param tagHint - Optional tag from the cardlist to help determine primary_type
 */
function parseCard(raw: RawEDHRECCard, tagHint?: string): EDHRECCard {
  // Calculate inclusion as percentage (EDHREC returns deck count)
  const inclusionCount = raw.inclusion || 0;
  const potentialDecks = raw.potential_decks || 1;
  const inclusionPercent = potentialDecks > 0
    ? (inclusionCount / potentialDecks) * 100
    : 0;

  // Derive primary_type from the cardlist tag if available
  let primaryType = 'Unknown';
  const tagLower = tagHint?.toLowerCase() || '';

  if (tagLower === 'creatures') primaryType = 'Creature';
  else if (tagLower === 'instants') primaryType = 'Instant';
  else if (tagLower === 'sorceries') primaryType = 'Sorcery';
  else if (tagLower === 'utilityartifacts' || tagLower === 'manaartifacts') primaryType = 'Artifact';
  else if (tagLower === 'enchantments') primaryType = 'Enchantment';
  else if (tagLower === 'planeswalkers') primaryType = 'Planeswalker';
  else if (tagLower === 'utilitylands' || tagLower === 'lands') primaryType = 'Land';

  // Check if this card is from a high-priority synergy list
  const isThemeSynergyCard = THEME_SYNERGY_TAGS.has(tagLower);

  return {
    name: raw.name,
    sanitized: raw.sanitized,
    primary_type: primaryType,
    inclusion: inclusionPercent, // Now a percentage (0-100)
    num_decks: raw.num_decks || 0,
    synergy: raw.synergy,
    isThemeSynergyCard,
    prices: raw.prices ? {
      tcgplayer: raw.prices.tcgplayer,
      cardkingdom: raw.prices.cardkingdom,
    } : undefined,
    image_uris: raw.image_uris,
    color_identity: raw.color_identity,
    cmc: raw.cmc, // Note: will be undefined from EDHREC, fetched from Scryfall later
    salt: raw.salt,
  };
}

/**
 * Parse mana_curve from EDHREC response (keys are strings in JSON)
 * Converts { "1": 10, "2": 12, ... } to { 1: 10, 2: 12, ... }
 */
function parseManaCurve(rawCurve?: Record<string, number>): Record<number, number> {
  const result: Record<number, number> = {};
  if (!rawCurve) return result;

  for (const [key, value] of Object.entries(rawCurve)) {
    const cmc = parseInt(key, 10);
    if (!isNaN(cmc) && value > 0) {
      result[cmc] = value;
    }
  }
  return result;
}

/**
 * Fetch full commander data from EDHREC
 */
export async function fetchCommanderData(commanderName: string): Promise<EDHRECCommanderData> {
  const formattedName = formatCommanderNameForUrl(commanderName);

  // Check cache first
  const cached = commanderCache.get(formattedName);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await edhrecFetch<RawEDHRECResponse>(
      `/pages/commanders/${formattedName}.json`
    );

    // Parse themes from taglinks
    const rawTaglinks = response.panels?.taglinks || [];
    const themes: EDHRECTheme[] = rawTaglinks.map(t => ({
      name: t.value,
      slug: t.slug,
      count: t.count,
      url: `/themes/${t.slug}/${formattedName}`,
      popularityPercent: 0, // Will calculate below
    }));

    // Calculate popularity percentages
    const totalThemeDecks = themes.reduce((sum, t) => sum + t.count, 0);
    for (const theme of themes) {
      theme.popularityPercent = totalThemeDecks > 0
        ? (theme.count / totalThemeDecks) * 100
        : 0;
    }

    // Sort by count (highest first)
    themes.sort((a, b) => b.count - a.count);

    // Parse stats
    const stats: EDHRECCommanderStats = {
      avgPrice: response.avg_price || 0,
      numDecks: response.num_decks_avg || 0,
      deckSize: response.deck_size || 81, // Default to 81 if missing
      manaCurve: parseManaCurve(response.mana_curve),
      typeDistribution: {
        creature: response.creature || 0,
        instant: response.instant || 0,
        sorcery: response.sorcery || 0,
        artifact: response.artifact || 0,
        enchantment: response.enchantment || 0,
        land: response.land || 0,
        planeswalker: response.planeswalker || 0,
        battle: response.battle || 0,
      },
      landDistribution: {
        basic: response.basic || 0,
        nonbasic: response.nonbasic || 0,
        total: response.land || 0,
      },
    };

    // Parse card lists directly from EDHREC tags
    // EDHREC already categorizes cards into lists with tags like "creatures", "instants", etc.
    const rawCardLists = response.container?.json_dict?.cardlists || [];
    console.log('[EDHREC] Raw cardlists count:', rawCardLists.length);
    console.log('[EDHREC] Available tags:', rawCardLists.map((l: RawCardList) => l.tag));

    // Build cardlists directly from EDHREC's categorization
    const cardlists: EDHRECCommanderData['cardlists'] = {
      creatures: [],
      instants: [],
      sorceries: [],
      artifacts: [],
      enchantments: [],
      planeswalkers: [],
      lands: [],
      allNonLand: [],
    };

    // Track cards for deduplication across lists
    const seenCards = new Map<string, EDHRECCard>();

    for (const list of rawCardLists) {
      if (!list.cardviews || list.cardviews.length === 0) continue;

      const tag = list.tag.toLowerCase();
      console.log(`[EDHREC] Processing list "${list.tag}" with ${list.cardviews.length} cards`);

      for (const rawCard of list.cardviews) {
        // Skip if we've seen this card with higher inclusion
        const existing = seenCards.get(rawCard.name);
        const potentialDecks = rawCard.potential_decks || 1;
        const inclusionPercent = potentialDecks > 0
          ? ((rawCard.inclusion || 0) / potentialDecks) * 100
          : 0;

        if (existing && existing.inclusion >= inclusionPercent) {
          continue;
        }

        const card = parseCard(rawCard, list.tag);
        seenCards.set(card.name, card);

        // Add to the appropriate category based on EDHREC's tag
        if (tag === 'creatures') {
          cardlists.creatures.push(card);
          cardlists.allNonLand.push(card);
        } else if (tag === 'instants') {
          cardlists.instants.push(card);
          cardlists.allNonLand.push(card);
        } else if (tag === 'sorceries') {
          cardlists.sorceries.push(card);
          cardlists.allNonLand.push(card);
        } else if (tag === 'utilityartifacts' || tag === 'manaartifacts') {
          cardlists.artifacts.push(card);
          cardlists.allNonLand.push(card);
        } else if (tag === 'enchantments') {
          cardlists.enchantments.push(card);
          cardlists.allNonLand.push(card);
        } else if (tag === 'planeswalkers') {
          cardlists.planeswalkers.push(card);
          cardlists.allNonLand.push(card);
        } else if (tag === 'utilitylands' || tag === 'lands') {
          cardlists.lands.push(card);
        } else if (
          tag === 'newcards' ||
          tag === 'highsynergycards' ||
          tag === 'topcards' ||
          tag === 'gamechangers'
        ) {
          // Generic lists - add to allNonLand only (type is Unknown)
          cardlists.allNonLand.push(card);
        }
      }
    }

    // Sort each category by inclusion rate (highest first)
    for (const key of Object.keys(cardlists) as (keyof typeof cardlists)[]) {
      cardlists[key].sort((a, b) => b.inclusion - a.inclusion);
    }

    console.log('[EDHREC] Categorized cards by tag:', {
      creatures: cardlists.creatures.length,
      instants: cardlists.instants.length,
      sorceries: cardlists.sorceries.length,
      artifacts: cardlists.artifacts.length,
      enchantments: cardlists.enchantments.length,
      planeswalkers: cardlists.planeswalkers.length,
      lands: cardlists.lands.length,
      allNonLand: cardlists.allNonLand.length,
    });

    if (cardlists.creatures.length > 0) {
      console.log('[EDHREC] Sample creature:', cardlists.creatures[0]);
    }

    // Parse similar commanders
    const similarCommanders: EDHRECSimilarCommander[] = (response.similar || []).map(s => ({
      name: s.name,
      sanitized: s.sanitized,
      colorIdentity: s.color_identity || [],
      cmc: s.cmc || 0,
      imageUrl: s.image_uris?.[0]?.normal,
      url: s.url || `/commanders/${s.sanitized}`,
    }));

    const data: EDHRECCommanderData = {
      themes,
      stats,
      cardlists,
      similarCommanders,
    };

    // Cache the result
    commanderCache.set(formattedName, { data, timestamp: Date.now() });

    return data;
  } catch (error) {
    console.error('Failed to fetch EDHREC commander data:', error);
    throw error;
  }
}

/**
 * Fetch commander themes from EDHREC (backwards compatible)
 */
export async function fetchCommanderThemes(commanderName: string): Promise<EDHRECTheme[]> {
  const data = await fetchCommanderData(commanderName);
  return data.themes;
}

/**
 * Fetch themes for partner commanders (combines both)
 */
export async function fetchPartnerThemes(
  commander1: string,
  commander2: string
): Promise<EDHRECTheme[]> {
  // EDHREC has partner pages at /commanders/{partner1}-{partner2}
  const name1 = formatCommanderNameForUrl(commander1);
  const name2 = formatCommanderNameForUrl(commander2);

  // Try combined partner URL first (alphabetically sorted)
  const sortedNames = [name1, name2].sort();
  const combinedName = sortedNames.join('-');

  try {
    const data = await fetchCommanderData(combinedName);
    if (data.themes.length > 0) {
      return data.themes;
    }
  } catch {
    // Partner combination not found, fall back to fetching individually
  }

  // Fallback: fetch both individually and merge themes
  const [data1, data2] = await Promise.all([
    fetchCommanderData(commander1).catch(() => null),
    fetchCommanderData(commander2).catch(() => null),
  ]);

  const themes1 = data1?.themes || [];
  const themes2 = data2?.themes || [];

  // Merge and deduplicate themes
  const themeMap = new Map<string, EDHRECTheme>();

  for (const theme of [...themes1, ...themes2]) {
    const existing = themeMap.get(theme.name);
    if (existing) {
      // Combine counts
      existing.count += theme.count;
    } else {
      themeMap.set(theme.name, { ...theme });
    }
  }

  const merged = Array.from(themeMap.values());
  const totalDecks = merged.reduce((sum, t) => sum + t.count, 0);

  // Recalculate percentages
  for (const theme of merged) {
    theme.popularityPercent = totalDecks > 0 ? (theme.count / totalDecks) * 100 : 0;
  }

  return merged.sort((a, b) => b.count - a.count);
}

/**
 * Fetch theme-specific commander data from EDHREC
 * Uses endpoint like /pages/commanders/skullbriar-the-walking-grave/plus-1-plus-1-counters.json
 */
export async function fetchCommanderThemeData(
  commanderName: string,
  themeSlug: string
): Promise<EDHRECCommanderData> {
  const formattedName = formatCommanderNameForUrl(commanderName);
  const cacheKey = `${formattedName}/${themeSlug}`;

  // Check cache first
  const cached = commanderCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await edhrecFetch<RawEDHRECResponse>(
      `/pages/commanders/${formattedName}/${themeSlug}.json`
    );

    // Parse stats (same as base commander)
    const stats: EDHRECCommanderStats = {
      avgPrice: response.avg_price || 0,
      numDecks: response.num_decks_avg || 0,
      deckSize: response.deck_size || 81, // Default to 81 if missing
      manaCurve: parseManaCurve(response.mana_curve),
      typeDistribution: {
        creature: response.creature || 0,
        instant: response.instant || 0,
        sorcery: response.sorcery || 0,
        artifact: response.artifact || 0,
        enchantment: response.enchantment || 0,
        land: response.land || 0,
        planeswalker: response.planeswalker || 0,
        battle: response.battle || 0,
      },
      landDistribution: {
        basic: response.basic || 0,
        nonbasic: response.nonbasic || 0,
        total: response.land || 0,
      },
    };

    // Parse card lists directly from EDHREC tags (same approach as fetchCommanderData)
    const rawCardLists = response.container?.json_dict?.cardlists || [];

    const cardlists: EDHRECCommanderData['cardlists'] = {
      creatures: [],
      instants: [],
      sorceries: [],
      artifacts: [],
      enchantments: [],
      planeswalkers: [],
      lands: [],
      allNonLand: [],
    };

    const seenCards = new Map<string, EDHRECCard>();

    for (const list of rawCardLists) {
      if (!list.cardviews || list.cardviews.length === 0) continue;

      const tag = list.tag.toLowerCase();

      for (const rawCard of list.cardviews) {
        const existing = seenCards.get(rawCard.name);
        const potentialDecks = rawCard.potential_decks || 1;
        const inclusionPercent = potentialDecks > 0
          ? ((rawCard.inclusion || 0) / potentialDecks) * 100
          : 0;

        if (existing && existing.inclusion >= inclusionPercent) {
          continue;
        }

        const card = parseCard(rawCard, list.tag);
        seenCards.set(card.name, card);

        if (tag === 'creatures') {
          cardlists.creatures.push(card);
          cardlists.allNonLand.push(card);
        } else if (tag === 'instants') {
          cardlists.instants.push(card);
          cardlists.allNonLand.push(card);
        } else if (tag === 'sorceries') {
          cardlists.sorceries.push(card);
          cardlists.allNonLand.push(card);
        } else if (tag === 'utilityartifacts' || tag === 'manaartifacts') {
          cardlists.artifacts.push(card);
          cardlists.allNonLand.push(card);
        } else if (tag === 'enchantments') {
          cardlists.enchantments.push(card);
          cardlists.allNonLand.push(card);
        } else if (tag === 'planeswalkers') {
          cardlists.planeswalkers.push(card);
          cardlists.allNonLand.push(card);
        } else if (tag === 'utilitylands' || tag === 'lands') {
          cardlists.lands.push(card);
        } else if (
          tag === 'newcards' ||
          tag === 'highsynergycards' ||
          tag === 'topcards' ||
          tag === 'gamechangers'
        ) {
          cardlists.allNonLand.push(card);
        }
      }
    }

    // Sort each category by inclusion rate
    for (const key of Object.keys(cardlists) as (keyof typeof cardlists)[]) {
      cardlists[key].sort((a, b) => b.inclusion - a.inclusion);
    }

    const data: EDHRECCommanderData = {
      themes: [], // Theme-specific pages don't have sub-themes
      stats,
      cardlists,
      similarCommanders: [], // Not relevant for theme pages
    };

    // Cache the result
    commanderCache.set(cacheKey, { data, timestamp: Date.now() });

    return data;
  } catch (error) {
    console.error(`Failed to fetch EDHREC theme data for ${themeSlug}:`, error);
    throw error;
  }
}

/**
 * Clear the commander cache
 */
export function clearCommanderCache(): void {
  commanderCache.clear();
}

/**
 * Top commanders from EDHREC (updated periodically)
 * Data source: https://edhrec.com/commanders
 * Last updated: 2025-01-17
 */
const TOP_COMMANDERS: EDHRECTopCommander[] = [
  { rank: 1, name: 'The Ur-Dragon', sanitized: 'the-ur-dragon', colorIdentity: ['W', 'U', 'B', 'R', 'G'], numDecks: 41822 },
  { rank: 2, name: 'Edgar Markov', sanitized: 'edgar-markov', colorIdentity: ['W', 'B', 'R'], numDecks: 40632 },
  { rank: 3, name: 'Atraxa, Praetors\' Voice', sanitized: 'atraxa-praetors-voice', colorIdentity: ['W', 'U', 'B', 'G'], numDecks: 37998 },
  { rank: 4, name: 'Krenko, Mob Boss', sanitized: 'krenko-mob-boss', colorIdentity: ['R'], numDecks: 34529 },
  { rank: 5, name: 'Kaalia of the Vast', sanitized: 'kaalia-of-the-vast', colorIdentity: ['W', 'B', 'R'], numDecks: 32559 },
  { rank: 6, name: 'Yuriko, the Tiger\'s Shadow', sanitized: 'yuriko-the-tigers-shadow', colorIdentity: ['U', 'B'], numDecks: 30481 },
  { rank: 7, name: 'Muldrotha, the Gravetide', sanitized: 'muldrotha-the-gravetide', colorIdentity: ['U', 'B', 'G'], numDecks: 29876 },
  { rank: 8, name: 'Sauron, the Dark Lord', sanitized: 'sauron-the-dark-lord', colorIdentity: ['U', 'B', 'R'], numDecks: 29456 },
  { rank: 9, name: 'Korvold, Fae-Cursed King', sanitized: 'korvold-fae-cursed-king', colorIdentity: ['B', 'R', 'G'], numDecks: 28934 },
  { rank: 10, name: 'Lathril, Blade of the Elves', sanitized: 'lathril-blade-of-the-elves', colorIdentity: ['B', 'G'], numDecks: 27654 },
  { rank: 11, name: 'Prosper, Tome-Bound', sanitized: 'prosper-tome-bound', colorIdentity: ['B', 'R'], numDecks: 26789 },
  { rank: 12, name: 'Wilhelt, the Rotcleaver', sanitized: 'wilhelt-the-rotcleaver', colorIdentity: ['U', 'B'], numDecks: 25432 },
  { rank: 13, name: 'Miirym, Sentinel Wyrm', sanitized: 'miirym-sentinel-wyrm', colorIdentity: ['U', 'R', 'G'], numDecks: 24567 },
  { rank: 14, name: 'Isshin, Two Heavens as One', sanitized: 'isshin-two-heavens-as-one', colorIdentity: ['W', 'B', 'R'], numDecks: 23890 },
  { rank: 15, name: 'Teysa Karlov', sanitized: 'teysa-karlov', colorIdentity: ['W', 'B'], numDecks: 23456 },
  { rank: 16, name: 'Omnath, Locus of Creation', sanitized: 'omnath-locus-of-creation', colorIdentity: ['W', 'U', 'R', 'G'], numDecks: 22987 },
  { rank: 17, name: 'Animar, Soul of Elements', sanitized: 'animar-soul-of-elements', colorIdentity: ['U', 'R', 'G'], numDecks: 22345 },
  { rank: 18, name: 'Sliver Overlord', sanitized: 'sliver-overlord', colorIdentity: ['W', 'U', 'B', 'R', 'G'], numDecks: 21876 },
  { rank: 19, name: 'Kenrith, the Returned King', sanitized: 'kenrith-the-returned-king', colorIdentity: ['W', 'U', 'B', 'R', 'G'], numDecks: 21234 },
  { rank: 20, name: 'Breya, Etherium Shaper', sanitized: 'breya-etherium-shaper', colorIdentity: ['W', 'U', 'B', 'R'], numDecks: 20567 },
];

/**
 * Get top commanders from EDHREC
 * Returns a static list that is periodically updated from https://edhrec.com/commanders
 */
export function getTopCommanders(limit: number = 20): EDHRECTopCommander[] {
  return TOP_COMMANDERS.slice(0, limit);
}
