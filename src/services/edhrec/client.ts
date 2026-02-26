import type {
  EDHRECTheme,
  EDHRECCard,
  EDHRECCombo,
  EDHRECCommanderData,
  EDHRECCommanderStats,
  EDHRECSimilarCommander,
  EDHRECTopCommander,
  BudgetOption,
  BracketLevel,
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
const partnerPopularityCache = new Map<string, { data: Map<string, number>; timestamp: number }>();
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
  // EDHREC may return a redirect instead of actual data (e.g. partner name ordering)
  redirect?: string;

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
 * "Clavileño, First of the Blessed" -> "clavileno-first-of-the-blessed"
 *
 * For double-faced cards (containing "//"), EDHREC uses only the front face name.
 */
export function formatCommanderNameForUrl(name: string): string {
  // Handle double-faced cards - use only the front face name
  const frontFace = name.split(' // ')[0];

  return frontFace
    .normalize('NFD')              // Decompose accented chars (ñ -> n + combining tilde)
    .replace(/[\u0300-\u036f]/g, '') // Strip combining diacritical marks
    .toLowerCase()
    .replace(/[',]/g, '') // Remove apostrophes and commas
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/[^a-z0-9-]/g, ''); // Remove other special characters
}

/**
 * Get the URL suffix for budget/expensive card pools.
 * 'any' -> '', 'budget' -> '/budget', 'expensive' -> '/expensive'
 */
function getBudgetSuffix(budgetOption?: BudgetOption): string {
  if (budgetOption === 'budget') return '/budget';
  if (budgetOption === 'expensive') return '/expensive';
  return '';
}

const BRACKET_SLUGS: Record<number, string> = {
  1: 'exhibition',
  2: 'core',
  3: 'upgraded',
  4: 'optimized',
  5: 'cedh',
};

function getBracketSuffix(bracketLevel?: BracketLevel): string {
  if (!bracketLevel || bracketLevel === 'all') return '';
  return `/${BRACKET_SLUGS[bracketLevel]}`;
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

  const data = await response.json();

  // EDHREC returns { redirect: "..." } instead of real data for wrong partner orderings
  if (data.redirect) {
    throw new Error(`EDHREC redirect to ${data.redirect}`);
  }

  return data;
}

// Tags that represent high-priority theme synergy cards
const THEME_SYNERGY_TAGS = new Set(['highsynergycards', 'topcards', 'gamechangers']);

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
  const isNewCard = tagLower === 'newcards';
  const isGameChanger = tagLower === 'gamechangers';

  return {
    name: raw.name,
    sanitized: raw.sanitized,
    primary_type: primaryType,
    inclusion: inclusionPercent, // Now a percentage (0-100)
    num_decks: raw.num_decks || 0,
    synergy: raw.synergy,
    isThemeSynergyCard,
    isNewCard,
    isGameChanger,
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
 * Build both possible EDHREC slugs for partner commanders.
 * EDHREC doesn't always use alphabetical order (e.g. commander before background),
 * so we return both orderings to try.
 */
function getPartnerSlugs(commander1: string, commander2: string): [string, string] {
  const slug1 = formatCommanderNameForUrl(commander1);
  const slug2 = formatCommanderNameForUrl(commander2);
  // Primary: commander1 first, secondary: commander2 first
  return [`${slug1}-${slug2}`, `${slug2}-${slug1}`];
}

/**
 * Parse a raw EDHREC response into structured commander data.
 * Shared by both single-commander and partner-commander fetches.
 */
function parseEdhrecResponse(
  response: RawEDHRECResponse,
  cacheKey: string
): EDHRECCommanderData {
  // Parse themes from taglinks
  const rawTaglinks = response.panels?.taglinks || [];
  const themes: EDHRECTheme[] = rawTaglinks.map(t => ({
    name: t.value,
    slug: t.slug,
    count: t.count,
    url: `/themes/${t.slug}/${cacheKey}`,
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
  const cardlists = parseCardlists(response);

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
  commanderCache.set(cacheKey, { data, timestamp: Date.now() });

  return data;
}

/**
 * Parse cardlists from a raw EDHREC response into categorized lists.
 * Shared by both commander data and theme data parsing.
 */
function parseCardlists(response: RawEDHRECResponse): EDHRECCommanderData['cardlists'] {
  const rawCardLists = response.container?.json_dict?.cardlists || [];
  console.log('[EDHREC] Raw cardlists count:', rawCardLists.length);
  console.log('[EDHREC] Available tags:', rawCardLists.map((l: RawCardList) => l.tag));

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

  return cardlists;
}

/**
 * Merge cardlists from two EDHREC datasets (for partner fallback)
 */
function mergeCardlists(
  data1: EDHRECCommanderData,
  data2: EDHRECCommanderData
): EDHRECCommanderData['cardlists'] {
  const mergeCategory = (list1: EDHRECCard[], list2: EDHRECCard[]): EDHRECCard[] => {
    const cardMap = new Map<string, EDHRECCard>();
    for (const card of [...list1, ...list2]) {
      const existing = cardMap.get(card.name);
      if (!existing || card.inclusion > existing.inclusion) {
        cardMap.set(card.name, card);
      }
    }
    return Array.from(cardMap.values()).sort((a, b) => b.inclusion - a.inclusion);
  };

  return {
    creatures: mergeCategory(data1.cardlists.creatures, data2.cardlists.creatures),
    instants: mergeCategory(data1.cardlists.instants, data2.cardlists.instants),
    sorceries: mergeCategory(data1.cardlists.sorceries, data2.cardlists.sorceries),
    artifacts: mergeCategory(data1.cardlists.artifacts, data2.cardlists.artifacts),
    enchantments: mergeCategory(data1.cardlists.enchantments, data2.cardlists.enchantments),
    planeswalkers: mergeCategory(data1.cardlists.planeswalkers, data2.cardlists.planeswalkers),
    lands: mergeCategory(data1.cardlists.lands, data2.cardlists.lands),
    allNonLand: mergeCategory(data1.cardlists.allNonLand, data2.cardlists.allNonLand),
  };
}

/**
 * Fetch full commander data from EDHREC
 */
export async function fetchCommanderData(commanderName: string, budgetOption?: BudgetOption, bracketLevel?: BracketLevel): Promise<EDHRECCommanderData> {
  const formattedName = formatCommanderNameForUrl(commanderName);
  const bracketSuffix = getBracketSuffix(bracketLevel);
  const budgetSuffix = getBudgetSuffix(budgetOption);
  const cacheKey = `${formattedName}${bracketSuffix}${budgetSuffix}`;

  // Check cache first
  const cached = commanderCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await edhrecFetch<RawEDHRECResponse>(
      `/pages/commanders/${formattedName}${bracketSuffix}${budgetSuffix}.json`
    );

    return parseEdhrecResponse(response, cacheKey);
  } catch (error) {
    console.error('Failed to fetch EDHREC commander data:', error);
    throw error;
  }
}

/**
 * Fetch EDHREC data for partner commanders.
 * Tries the combined partner page first, falls back to merging individual data.
 */
export async function fetchPartnerCommanderData(
  commander1: string,
  commander2: string,
  budgetOption?: BudgetOption,
  bracketLevel?: BracketLevel
): Promise<EDHRECCommanderData> {
  const [slugA, slugB] = getPartnerSlugs(commander1, commander2);
  const bracketSuffix = getBracketSuffix(bracketLevel);
  const budgetSuffix = getBudgetSuffix(budgetOption);

  // Check cache for either ordering
  for (const slug of [slugA, slugB]) {
    const cacheKey = `${slug}${bracketSuffix}${budgetSuffix}`;
    const cached = commanderCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
  }

  // Try both orderings - EDHREC doesn't always use alphabetical order
  // (redirects are detected and thrown by edhrecFetch)
  for (const slug of [slugA, slugB]) {
    const cacheKey = `${slug}${bracketSuffix}${budgetSuffix}`;
    try {
      const response = await edhrecFetch<RawEDHRECResponse>(
        `/pages/commanders/${slug}${bracketSuffix}${budgetSuffix}.json`
      );
      console.log(`[EDHREC] Found partner page: /pages/commanders/${slug}${bracketSuffix}${budgetSuffix}.json`);
      return parseEdhrecResponse(response, cacheKey);
    } catch {
      console.log(`[EDHREC] No partner page at ${slug}${bracketSuffix}${budgetSuffix}`);
    }
  }

  console.log(`[EDHREC] No partner page found, merging individual data`);

  // Fallback: fetch both individually and merge
  const [data1, data2] = await Promise.all([
    fetchCommanderData(commander1, budgetOption, bracketLevel).catch(() => null),
    fetchCommanderData(commander2, budgetOption, bracketLevel).catch(() => null),
  ]);

  if (data1 && data2) {
    const mergedData: EDHRECCommanderData = {
      themes: data1.themes,
      stats: data1.stats,
      cardlists: mergeCardlists(data1, data2),
      similarCommanders: data1.similarCommanders,
    };
    commanderCache.set(slugA, { data: mergedData, timestamp: Date.now() });
    return mergedData;
  }

  if (data1) return data1;
  if (data2) return data2;

  throw new Error(`Failed to fetch EDHREC data for both ${commander1} and ${commander2}`);
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
  // Try both orderings - EDHREC doesn't always use alphabetical order
  const [slugA, slugB] = getPartnerSlugs(commander1, commander2);

  for (const slug of [slugA, slugB]) {
    try {
      const data = await fetchCommanderData(slug);
      if (data.themes.length > 0) {
        return data.themes;
      }
    } catch {
      // This ordering didn't work, try the other
    }
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
  themeSlug: string,
  budgetOption?: BudgetOption,
  bracketLevel?: BracketLevel
): Promise<EDHRECCommanderData> {
  const formattedName = formatCommanderNameForUrl(commanderName);
  const bracketSuffix = getBracketSuffix(bracketLevel);
  const budgetSuffix = getBudgetSuffix(budgetOption);
  const cacheKey = `${formattedName}${bracketSuffix}/${themeSlug}${budgetSuffix}`;

  // Check cache first
  const cached = commanderCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await edhrecFetch<RawEDHRECResponse>(
      `/pages/commanders/${formattedName}${bracketSuffix}/${themeSlug}${budgetSuffix}.json`
    );

    // Parse stats
    const stats: EDHRECCommanderStats = {
      avgPrice: response.avg_price || 0,
      numDecks: response.num_decks_avg || 0,
      deckSize: response.deck_size || 81,
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

    // Parse card lists using shared parser
    const cardlists = parseCardlists(response);

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
 * Fetch theme-specific data for partner commanders.
 * Tries the combined partner theme page first, falls back to primary commander's theme.
 */
export async function fetchPartnerThemeData(
  commander1: string,
  commander2: string,
  themeSlug: string,
  budgetOption?: BudgetOption,
  bracketLevel?: BracketLevel
): Promise<EDHRECCommanderData> {
  const [slugA, slugB] = getPartnerSlugs(commander1, commander2);
  const bracketSuffix = getBracketSuffix(bracketLevel);
  const budgetSuffix = getBudgetSuffix(budgetOption);

  // Check cache for either ordering
  for (const slug of [slugA, slugB]) {
    const cacheKey = `${slug}${bracketSuffix}/${themeSlug}${budgetSuffix}`;
    const cached = commanderCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
  }

  // Try both orderings
  for (const slug of [slugA, slugB]) {
    const cacheKey = `${slug}${bracketSuffix}/${themeSlug}${budgetSuffix}`;
    try {
      const response = await edhrecFetch<RawEDHRECResponse>(
        `/pages/commanders/${slug}${bracketSuffix}/${themeSlug}${budgetSuffix}.json`
      );
      console.log(`[EDHREC] Found partner theme page: ${slug}${bracketSuffix}/${themeSlug}${budgetSuffix}`);

      const stats: EDHRECCommanderStats = {
        avgPrice: response.avg_price || 0,
        numDecks: response.num_decks_avg || 0,
        deckSize: response.deck_size || 81,
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

      const cardlists = parseCardlists(response);

      const data: EDHRECCommanderData = {
        themes: [],
        stats,
        cardlists,
        similarCommanders: [],
      };

      commanderCache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch {
      // This ordering didn't work, try the other
    }
  }

  console.log(`[EDHREC] No partner theme page found, falling back to primary commander`);
  // Fallback: use primary commander's theme data
  return fetchCommanderThemeData(commander1, themeSlug, budgetOption, bracketLevel);
}

/**
 * Partner popularity data from EDHREC's /partners/ endpoint
 */
export interface PartnerPopularity {
  name: string;       // Partner commander name
  numDecks: number;   // Number of decks with this pairing
}

/**
 * Fetch partner popularity data from EDHREC.
 * Returns a map of partner name -> deck count for the given commander.
 */
export async function fetchPartnerPopularity(
  commanderName: string
): Promise<Map<string, number>> {
  const formattedName = formatCommanderNameForUrl(commanderName);
  const cacheKey = `partners-${formattedName}`;

  // Check cache
  const cached = partnerPopularityCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await edhrecFetch<{ partnercounts?: Array<{ value: string; count: number }> }>(
      `/pages/partners/${formattedName}.json`
    );

    const result = new Map<string, number>();
    for (const entry of response.partnercounts || []) {
      result.set(entry.value, entry.count);
    }

    partnerPopularityCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch (error) {
    console.error(`[EDHREC] Failed to fetch partner popularity for ${commanderName}:`, error);
    return new Map();
  }
}

/**
 * Clear the commander cache
 */
export function clearCommanderCache(): void {
  commanderCache.clear();
}

// --- Top commanders (fetched live from EDHREC) ---

const WUBRG = 'WUBRG';

/** Map sorted color key → EDHREC URL slug */
const COLOR_SLUG_MAP: Record<string, string> = {
  '': 'year',
  C: 'colorless',
  W: 'mono-white', U: 'mono-blue', B: 'mono-black', R: 'mono-red', G: 'mono-green',
  WU: 'azorius', WB: 'orzhov', WR: 'boros', WG: 'selesnya',
  UB: 'dimir', UR: 'izzet', UG: 'simic',
  BR: 'rakdos', BG: 'golgari', RG: 'gruul',
  WUB: 'esper', WUR: 'jeskai', WUG: 'bant',
  WBR: 'mardu', WBG: 'abzan', WRG: 'naya',
  UBR: 'grixis', UBG: 'sultai', URG: 'temur', BRG: 'jund',
  WUBR: 'yore-tiller', WUBG: 'witch-maw', WURG: 'ink-treader',
  WBRG: 'dune-brood', UBRG: 'glint-eye', WUBRG: 'five-color',
};

interface RawTopCommanderEntry {
  name: string;
  sanitized: string;
  num_decks?: number;
  inclusion?: number;
  color_identity?: string[];
}

interface RawTopCommandersResponse {
  container?: {
    json_dict?: {
      cardlists?: Array<{
        cardviews?: RawTopCommanderEntry[];
      }>;
    };
  };
}

const topCommanderCache = new Map<string, { data: EDHRECTopCommander[]; timestamp: number }>();
const TOP_COMMANDER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch top commanders from EDHREC for a given color identity.
 * Pass an empty array for overall top commanders (past year).
 * Results are cached for 30 minutes.
 */
export async function fetchTopCommanders(colors: string[]): Promise<EDHRECTopCommander[]> {
  // Sort colors in WUBRG order and build cache key
  const sorted = [...colors].filter(c => c !== 'C').sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));
  const key = colors.includes('C') ? 'C' : sorted.join('');
  const slug = COLOR_SLUG_MAP[key];
  if (!slug) return [];

  const cached = topCommanderCache.get(key);
  if (cached && Date.now() - cached.timestamp < TOP_COMMANDER_CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await edhrecFetch<RawTopCommandersResponse>(
      `/pages/commanders/${slug}.json`
    );

    const cardviews = response.container?.json_dict?.cardlists?.[0]?.cardviews ?? [];
    const isOverall = key === '';
    // Filter out partner pairs (e.g. "Kraum // Tymna") before taking top 12
    const top = cardviews.filter(e => !e.name.includes('//')).slice(0, 12);

    let commanders: EDHRECTopCommander[] = top.map((entry, i) => ({
      rank: i + 1,
      name: entry.name,
      sanitized: entry.sanitized,
      colorIdentity: isOverall
        ? (entry.color_identity?.map(c => c.toUpperCase()) ?? [])
        : (key === 'C' ? [] : sorted),
      numDecks: entry.num_decks ?? entry.inclusion ?? 0,
    }));

    // The overall "year" endpoint doesn't include color_identity on page 1.
    // Batch-fetch from Scryfall to fill them in.
    if (isOverall && commanders.some(c => c.colorIdentity.length === 0)) {
      try {
        const { getCardsByNames } = await import('@/services/scryfall/client');
        const names = commanders.filter(c => c.colorIdentity.length === 0).map(c => c.name);
        const cardMap = await getCardsByNames(names);
        commanders = commanders.map(c => {
          if (c.colorIdentity.length > 0) return c;
          const card = cardMap.get(c.name);
          return { ...c, colorIdentity: card?.color_identity ?? [] };
        });
      } catch {
        // Scryfall lookup failed — show without color pips
      }
    }

    topCommanderCache.set(key, { data: commanders, timestamp: Date.now() });
    return commanders;
  } catch (error) {
    console.warn(`[EDHREC] Failed to fetch top commanders for "${slug}":`, error);
    return cached?.data ?? [];
  }
}

/**
 * Fetch all multi-copy card quantities from an EDHREC average deck.
 * Returns a Map of cardName → quantity for cards with >1 copy, or null if the fetch failed entirely.
 * Returning null (fetch failed) vs empty Map (fetch succeeded, no multi-copy cards) is important
 * for distinguishing fallback behavior.
 */
export async function fetchAverageDeckMultiCopies(
  commanderName: string,
  cardNamesToCheck: string[],
  themeSlug?: string
): Promise<Map<string, number> | null> {
  try {
    await rateLimiter.throttle();

    const formatted = formatCommanderNameForUrl(commanderName);
    const themePart = themeSlug ? `/${themeSlug}` : '';
    const url = `${BASE_URL}/pages/average-decks/${formatted}${themePart}.json`;

    console.log(`[EDHREC] Fetching average deck from: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[EDHREC] Average deck fetch failed (${response.status}) for ${formatted}${themePart}`);
      return null;
    }

    const data = await response.json();
    const deckList: string[] = data?.deck || data?.decklist || [];

    if (!Array.isArray(deckList) || deckList.length === 0) {
      console.warn('[EDHREC] Average deck has no deck array');
      return null;
    }

    // Build a lookup set for the cards we care about
    const lookupSet = new Set(cardNamesToCheck.map(n => n.toLowerCase()));
    const result = new Map<string, number>();

    // Each entry is "N CardName" (e.g., "20 Slime Against Humanity", "1 Sol Ring")
    for (const entry of deckList) {
      const match = entry.match(/^(\d+)\s+(.+)$/);
      if (match) {
        const quantity = parseInt(match[1], 10);
        const name = match[2].trim();
        if (quantity > 1 && lookupSet.has(name.toLowerCase())) {
          // Use the original casing from cardNamesToCheck
          const originalName = cardNamesToCheck.find(n => n.toLowerCase() === name.toLowerCase());
          result.set(originalName ?? name, quantity);
          console.log(`[EDHREC] Found ${quantity} copies of "${originalName ?? name}" in average deck`);
        }
      }
    }

    return result;
  } catch (error) {
    console.warn('[EDHREC] Failed to fetch average deck multi-copies:', error);
    return null;
  }
}

// --- Combo data ---

const comboCache = new Map<string, { data: EDHRECCombo[]; timestamp: number }>();

interface RawComboEntry {
  cardviews: { name: string; id: string; sanitized: string }[];
  combo: {
    comboId: string;
    count: number;
    results: string[];
    nonCardPrerequisiteCount: number;
    rank: number;
    comboVote?: { bracket: string };
  };
}

interface RawComboResponse {
  container?: {
    json_dict?: {
      cardlists?: RawComboEntry[];
    };
  };
}

/**
 * Fetch known combos for a commander from EDHREC.
 * Returns combos sorted by popularity (deckCount descending).
 */
export async function fetchCommanderCombos(commanderName: string): Promise<EDHRECCombo[]> {
  const slug = formatCommanderNameForUrl(commanderName);

  const cached = comboCache.get(slug);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await edhrecFetch<RawComboResponse>(
      `/pages/combos/${slug}.json`
    );

    const rawCombos = response.container?.json_dict?.cardlists || [];

    const combos: EDHRECCombo[] = rawCombos.map(entry => ({
      comboId: entry.combo.comboId,
      cards: entry.cardviews.map(cv => ({ name: cv.name, id: cv.id })),
      results: entry.combo.results || [],
      deckCount: entry.combo.count || 0,
      rank: entry.combo.rank || 0,
      bracket: entry.combo.comboVote?.bracket || 'unknown',
      prereqCount: entry.combo.nonCardPrerequisiteCount || 0,
    }));

    combos.sort((a, b) => b.deckCount - a.deckCount);

    comboCache.set(slug, { data: combos, timestamp: Date.now() });
    return combos;
  } catch (error) {
    console.error(`[EDHREC] Failed to fetch combos for ${commanderName}:`, error);
    return [];
  }
}
