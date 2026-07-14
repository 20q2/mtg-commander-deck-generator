import type {
  EDHRECTheme,
  EDHRECCard,
  EDHRECCombo,
  EDHRECCommanderData,
  EDHRECCommanderStats,
  EDHRECSimilarCommander,
  EDHRECTopCommander,
  EDHRECTag,
  BudgetOption,
  BracketLevel,
} from '@/types';
import { readPersistedResponse, writePersistedResponse } from '@/services/scryfall/cache';

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
// EDHREC commander pages update on the order of days, not minutes. Hold cached
// entries for 14 days — note this is an in-memory cache so it's still capped at
// the lifetime of the browser session, but within a session we never re-fetch.
const CACHE_TTL = 14 * 24 * 60 * 60 * 1000; // 14 days

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
  type_line?: string; // Sometimes present in EDHREC data
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
  // Similar commanders
  similar?: Array<{
    name: string;
    sanitized: string;
    color_identity?: string[];
    cmc?: number;
    image_uris?: Array<{ normal: string }>;
    url?: string;
  }>;

  // Panels with themes, mana curve, etc.
  panels?: {
    taglinks?: Array<{
      value: string;
      slug: string;
      count: number;
    }>;
    mana_curve?: Record<string, number>; // CMC -> count (keys are strings in JSON)
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
    .replace(/[^a-z0-9\s-]/g, '') // Remove other special characters (& etc.) before spacing
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-'); // Collapse multiple hyphens
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
  // Persistent layer (IndexedDB): a previously-fetched endpoint needs no network across reloads.
  // Skips the rate limiter entirely on a hit. Never throws — falls through to network on any issue.
  const persisted = await readPersistedResponse<T>(endpoint);
  if (persisted !== null) return persisted;

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

  void writePersistedResponse(endpoint, data);  // fire-and-forget; never blocks
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
  // Calculate inclusion as percentage. EDHREC returns the deck count in
  // `num_decks` (older/other shapes used `inclusion`); percentage = count / potential.
  const inclusionCount = raw.num_decks ?? raw.inclusion ?? 0;
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

  // Fallback: derive from type_line if EDHREC provided it
  if (primaryType === 'Unknown' && raw.type_line) {
    const tl = raw.type_line.split('—')[0].split('//')[0].toLowerCase();
    if (tl.includes('creature')) primaryType = 'Creature';
    else if (tl.includes('instant')) primaryType = 'Instant';
    else if (tl.includes('sorcery')) primaryType = 'Sorcery';
    else if (tl.includes('artifact')) primaryType = 'Artifact';
    else if (tl.includes('enchantment')) primaryType = 'Enchantment';
    else if (tl.includes('planeswalker')) primaryType = 'Planeswalker';
    else if (tl.includes('land')) primaryType = 'Land';
    else if (tl.includes('battle')) primaryType = 'Battle';
  }

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

  // Parse stats — mana_curve lives inside panels, not at the top level
  const stats: EDHRECCommanderStats = {
    avgPrice: response.avg_price || 0,
    numDecks: response.num_decks_avg || 0,
    deckSize: response.deck_size || 81, // Default to 81 if missing
    manaCurve: parseManaCurve(response.panels?.mana_curve),
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
  // Track known types from typed lists (creatures, instants, etc.) even for deduped cards
  const knownTypes = new Map<string, string>();

  for (const list of rawCardLists) {
    if (!list.cardviews || list.cardviews.length === 0) continue;

    const tag = list.tag.toLowerCase();
    console.log(`[EDHREC] Processing list "${list.tag}" with ${list.cardviews.length} cards`);

    // Determine the type this tag implies (if any)
    const TAG_TYPE_MAP: Record<string, string> = {
      creatures: 'Creature', instants: 'Instant', sorceries: 'Sorcery',
      utilityartifacts: 'Artifact', manaartifacts: 'Artifact',
      enchantments: 'Enchantment', planeswalkers: 'Planeswalker',
      utilitylands: 'Land', lands: 'Land',
    };
    const impliedType = TAG_TYPE_MAP[tag];

    for (const rawCard of list.cardviews) {
      // Record known type from typed lists — even if the card gets deduped
      if (impliedType) {
        knownTypes.set(rawCard.name, impliedType);
      }

      // Skip if we've seen this card with higher inclusion
      const existing = seenCards.get(rawCard.name);
      const potentialDecks = rawCard.potential_decks || 1;
      const inclusionPercent = potentialDecks > 0
        ? ((rawCard.num_decks ?? rawCard.inclusion ?? 0) / potentialDecks) * 100
        : 0;

      if (existing && existing.inclusion >= inclusionPercent) {
        continue;
      }

      const card = parseCard(rawCard, list.tag);

      // Preserve known primary_type when a generic list (Unknown) replaces a typed entry
      if (card.primary_type === 'Unknown') {
        const known = existing?.primary_type !== 'Unknown' ? existing?.primary_type : knownTypes.get(card.name);
        if (known) card.primary_type = known;
      }

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
        cardlists.allNonLand.push(card);
      }
    }
  }

  // Final pass: backfill any remaining Unknown types from knownTypes map
  for (const card of cardlists.allNonLand) {
    if (card.primary_type === 'Unknown') {
      const known = knownTypes.get(card.name);
      if (known) card.primary_type = known;
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
      manaCurve: parseManaCurve(response.panels?.mana_curve),
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
        manaCurve: parseManaCurve(response.panels?.mana_curve),
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
const TOP_COMMANDER_CACHE_TTL = 14 * 24 * 60 * 60 * 1000; // 14 days (in-memory; capped by session)

/**
 * Fetch the full EDHREC commander typeahead list (all commander names).
 * Cached for the session lifetime.
 */
let allCommanderNamesCache: string[] | null = null;
export async function fetchAllCommanderNames(): Promise<string[]> {
  if (allCommanderNamesCache) return allCommanderNamesCache;
  await rateLimiter.throttle();
  const res = await fetch(`${BASE_URL}/static/typeahead/commanders`);
  if (!res.ok) throw new Error(`EDHREC typeahead failed: ${res.status}`);
  const names: string[] = await res.json();
  allCommanderNamesCache = names;
  return names;
}

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

/** All color combo keys (excluding '' for overall and 'C' for colorless) */
const ALL_COLOR_KEYS = Object.keys(COLOR_SLUG_MAP).filter(k => k !== '' && k !== 'C');

/**
 * Fetch commanders from EDHREC for all color combos that *include* the given colors.
 * E.g. colors=['G'] returns commanders from mono-green, golgari, simic, ..., WUBRG.
 * Returns all entries (not capped to 12) sorted by deck count, with duplicates removed.
 */
export async function fetchCommandersIncludingColors(colors: string[]): Promise<EDHRECTopCommander[]> {
  // Colorless is its own identity — doesn't combine with other colors
  if (colors.includes('C')) {
    return fetchAllCommandersForColor(['C']);
  }

  const required = new Set(colors.map(c => c.toUpperCase()));
  // Find all color keys that contain every required color
  const matchingKeys = ALL_COLOR_KEYS.filter(key =>
    [...required].every(c => key.includes(c))
  );
  if (matchingKeys.length === 0) return [];

  // Fetch all matching combos in parallel (uses cache internally)
  const results = await Promise.all(
    matchingKeys.map(key => fetchAllCommandersForColor(key.split('')))
  );

  // Union + dedupe by name, keeping the entry with the highest deck count
  const map = new Map<string, EDHRECTopCommander>();
  for (const list of results) {
    for (const cmd of list) {
      const existing = map.get(cmd.name);
      if (!existing || cmd.numDecks > existing.numDecks) {
        map.set(cmd.name, cmd);
      }
    }
  }

  return [...map.values()].sort((a, b) => b.numDecks - a.numDecks);
}

/**
 * Fetch commanders whose color identity is a SUBSET of the given colors — i.e.
 * every commander a collection of those colors could actually support. This is
 * the inverse of fetchCommandersIncludingColors (which requires the colors).
 * Unions all subset combos, dedupes by name, sorts by deck count descending.
 *
 * Note: colorless (identity []) commanders are not included; they live under
 * their own 'C' slug, not in the WUBRG combo keys.
 */
export async function fetchCommandersWithinColors(colors: string[]): Promise<EDHRECTopCommander[]> {
  const available = new Set(colors.map(c => c.toUpperCase()).filter(c => c !== 'C'));
  if (available.size === 0) return [];

  // Every color combo whose colors are all available in the collection.
  const matchingKeys = ALL_COLOR_KEYS.filter(key =>
    key.split('').every(c => available.has(c))
  );
  if (matchingKeys.length === 0) return [];

  const results = await Promise.all(
    matchingKeys.map(key => fetchAllCommandersForColor(key.split('')))
  );

  const map = new Map<string, EDHRECTopCommander>();
  for (const list of results) {
    for (const cmd of list) {
      const existing = map.get(cmd.name);
      if (!existing || cmd.numDecks > existing.numDecks) {
        map.set(cmd.name, cmd);
      }
    }
  }

  return [...map.values()].sort((a, b) => b.numDecks - a.numDecks);
}

/**
 * Fetch ALL commanders (up to 100) for an exact color combo from EDHREC.
 * Unlike fetchTopCommanders which returns top 12, this returns the full page.
 * Results are cached for 30 minutes.
 */
const fullCommanderCache = new Map<string, { data: EDHRECTopCommander[]; timestamp: number }>();

async function fetchAllCommandersForColor(colors: string[]): Promise<EDHRECTopCommander[]> {
  const sorted = [...colors].filter(c => c !== 'C').sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));
  const key = colors.includes('C') ? 'C' : sorted.join('');
  const slug = COLOR_SLUG_MAP[key];
  if (!slug) return [];

  const cached = fullCommanderCache.get(key);
  if (cached && Date.now() - cached.timestamp < TOP_COMMANDER_CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await edhrecFetch<RawTopCommandersResponse>(
      `/pages/commanders/${slug}.json`
    );
    const cardviews = response.container?.json_dict?.cardlists?.[0]?.cardviews ?? [];
    const commanders: EDHRECTopCommander[] = cardviews
      .filter(e => !e.name.includes('//'))
      .map((entry, i) => ({
        rank: i + 1,
        name: entry.name,
        sanitized: entry.sanitized,
        colorIdentity: key === 'C' ? [] : sorted,
        numDecks: entry.num_decks ?? entry.inclusion ?? 0,
      }));

    fullCommanderCache.set(key, { data: commanders, timestamp: Date.now() });
    return commanders;
  } catch (error) {
    console.warn(`[EDHREC] Failed to fetch all commanders for "${slug}":`, error);
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

// --- Similar cards (per-card EDHREC page) ---

const similarCardsCache = new Map<string, { data: string[]; timestamp: number }>();

interface RawCardPageView { name?: string; inclusion?: number; potential_decks?: number; num_decks?: number; lift?: number; }
interface RawCardPageList { tag?: string; cardviews?: RawCardPageView[]; }
interface RawCardPageResponse {
  similar?: string[];
  container?: { json_dict?: { cardlists?: RawCardPageList[] } };
}

export interface CardRelation { name: string; source: 'lift' | 'coplay' | 'similar'; coPct: number; }

const LIFT_TAKE = 6;
const COPLAY_TAKE = 4;
const SIMILAR_TAKE = 4;

function coPct(v: RawCardPageView): number {
  return v.potential_decks && v.potential_decks > 0 ? Math.round(((v.num_decks ?? v.inclusion ?? 0) / v.potential_decks) * 100) : 0;
}

/** Pure: turn a card-page payload into card-to-card relations (lift > coplay > similar). */
export function parseCardRelations(raw: RawCardPageResponse): CardRelation[] {
  const lists = raw.container?.json_dict?.cardlists ?? [];
  const byTag = (tag: string) => lists.find(l => l.tag === tag)?.cardviews ?? [];
  const out: CardRelation[] = [];
  for (const v of byTag('highliftcards').slice(0, LIFT_TAKE)) {
    if (v.name) out.push({ name: v.name, source: 'lift', coPct: coPct(v) });
  }
  for (const v of byTag('topcards').slice(0, COPLAY_TAKE)) {
    if (v.name) out.push({ name: v.name, source: 'coplay', coPct: coPct(v) });
  }
  for (const name of (Array.isArray(raw.similar) ? raw.similar : []).slice(0, SIMILAR_TAKE)) {
    out.push({ name, source: 'similar', coPct: 0 });
  }
  return out;
}

const cardRelationsCache = new Map<string, { data: CardRelation[]; timestamp: number }>();

/** Fetch card-to-card relations (high-lift, co-played, similar) for a single card. [] on failure. */
export async function fetchCardRelations(cardName: string): Promise<CardRelation[]> {
  const slug = formatCommanderNameForUrl(cardName);
  const cached = cardRelationsCache.get(slug);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;
  try {
    const response = await edhrecFetch<RawCardPageResponse>(`/pages/cards/${slug}.json`);
    const data = parseCardRelations(response);
    cardRelationsCache.set(slug, { data, timestamp: Date.now() });
    return data;
  } catch (error) {
    console.warn(`[EDHREC] Failed to fetch card relations for "${cardName}":`, error);
    cardRelationsCache.set(slug, { data: [], timestamp: Date.now() });
    return [];
  }
}

/**
 * Fetch EDHREC's "similar cards" list for a single card.
 * Returns an array of card names in EDHREC's native similarity order.
 * Lazy, per-card, cached for CACHE_TTL. Returns [] on any failure.
 */
export async function fetchSimilarCards(cardName: string): Promise<string[]> {
  const slug = formatCommanderNameForUrl(cardName);

  const cached = similarCardsCache.get(slug);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await edhrecFetch<RawCardPageResponse>(`/pages/cards/${slug}.json`);
    const data = Array.isArray(response.similar) ? response.similar : [];
    similarCardsCache.set(slug, { data, timestamp: Date.now() });
    return data;
  } catch (error) {
    console.warn(`[EDHREC] Failed to fetch similar cards for "${cardName}":`, error);
    similarCardsCache.set(slug, { data: [], timestamp: Date.now() });
    return [];
  }
}

// --- Full card-page lift pool ---
// Every card EDHREC lists as played alongside this one carries a numeric `lift` (how many times more
// often it co-occurs than its baseline play rate predicts) plus inclusion/potential_decks. The
// `highliftcards` list parsed above is just the curated extreme tail; this reads the whole page so a
// caller can score the full on-color pool by lift + co-occurrence. Same page fetch, cached 14 days.

export interface CardLiftEntry { name: string; lift: number; coPct: number; numDecks: number; }

// Meta lists that aren't "cards played alongside this one."
const LIFT_POOL_SKIP_TAGS = new Set(['topcommanders', 'newcards']);
// Lift from a handful of shared decks is statistical noise: a near-unplayed card posts a lift of
// hundreds/thousands off a few coincidental co-occurrences (mirrors EDHREC hiding these from "high
// lift"). The floor is ADAPTIVE: require co-occurrence in ~LIFT_MIN_FRACTION of the seed's decks, but
// clamp it — mainstream seeds get the strict floor; niche seeds relax so a thin archetype still shows
// SOMETHING (those hits are flagged low-confidence downstream). All tunable.
const LIFT_MIN_FRACTION = 0.02;
const LIFT_MIN_FLOOR = 12;     // never trust fewer than this many shared decks, even for ultra-niche seeds
export const LIFT_STRICT_FLOOR = 50;  // at/above this = high confidence; below = shown but flagged

/** Minimum shared-deck count for a seed of the given popularity (clamped fraction). */
function liftDeckFloor(potentialDecks: number): number {
  return Math.min(LIFT_STRICT_FLOOR, Math.max(LIFT_MIN_FLOOR, Math.round(potentialDecks * LIFT_MIN_FRACTION)));
}

/** Pure: every cardview on a card page with a numeric lift backed by enough decks, deduped (max lift). */
export function parseCardLiftPool(raw: RawCardPageResponse): CardLiftEntry[] {
  const lists = raw.container?.json_dict?.cardlists ?? [];
  const best = new Map<string, CardLiftEntry>();
  for (const list of lists) {
    if (list.tag && LIFT_POOL_SKIP_TAGS.has(list.tag)) continue;
    for (const v of list.cardviews ?? []) {
      if (!v.name || typeof v.lift !== 'number') continue;
      if (!v.potential_decks || v.potential_decks <= 0) continue;
      const numDecks = v.num_decks ?? v.inclusion ?? 0;
      if (numDecks < liftDeckFloor(v.potential_decks)) continue;   // adaptive low-sample filter
      const entry: CardLiftEntry = { name: v.name, lift: v.lift, coPct: coPct(v), numDecks };
      const prev = best.get(v.name);
      if (!prev || entry.lift > prev.lift) best.set(v.name, entry);
    }
  }
  return [...best.values()];
}

const cardLiftPoolCache = new Map<string, { data: CardLiftEntry[]; timestamp: number }>();

/** Fetch the full lift pool for a card (every played-alongside card with its lift + co-occurrence %). [] on failure. */
export async function fetchCardLiftPool(cardName: string, force = false): Promise<CardLiftEntry[]> {
  const slug = formatCommanderNameForUrl(cardName);
  // `force` (e.g. the "Re-scan" button) skips the in-memory parsed pool so it re-derives with current
  // parse logic from the cached raw page. Without it, a re-scan just returns the stale parsed result.
  if (!force) {
    const cached = cardLiftPoolCache.get(slug);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;
  }
  try {
    // edhrecFetch handles the persistent (cross-reload) layer for the raw page.
    const response = await edhrecFetch<RawCardPageResponse>(`/pages/cards/${slug}.json`);
    const data = parseCardLiftPool(response);
    cardLiftPoolCache.set(slug, { data, timestamp: Date.now() });
    return data;
  } catch (error) {
    console.warn(`[EDHREC] Failed to fetch card lift pool for "${cardName}":`, error);
    cardLiftPoolCache.set(slug, { data: [], timestamp: Date.now() });
    return [];
  }
}

// --- Combo data ---

const comboCache = new Map<string, { data: EDHRECCombo[]; timestamp: number }>();

interface RawComboEntry {
  cardviews: { name: string; id: string; sanitized: string }[];
  href?: string;
  combo: {
    comboId: string;
    count: number;
    results: string[];
    nonCardPrerequisiteCount: number;
    rank: number;
    comboVote?: { bracket: string };
  };
}

// Maps comboId → EDHREC href path (e.g. "/combos/golgari/250-779")
// Populated when combo list is fetched, used by fetchComboDetails
const comboHrefMap = new Map<string, string>();

interface RawComboResponse {
  container?: {
    json_dict?: {
      cardlists?: RawComboEntry[];
    };
  };
}

// EDHREC sometimes lists the same set of cards as multiple combo entries that
// differ only by a result-variant suffix in the comboId — e.g. "3470-5702--143"
// and "3470-5702--131" are both Springheart Nantuko + Lotus Cobra with the same
// deck count. To a deckbuilder these are the same combo, and since every consumer
// keys React lists / dedupe on comboId, both survive and render as visible
// duplicates. Collapse by card set, keeping the first entry (callers sort by
// deck count before calling, so the most popular variant wins).
function dedupeCombosByCardSet(combos: EDHRECCombo[]): EDHRECCombo[] {
  const seen = new Set<string>();
  const out: EDHRECCombo[] = [];
  for (const c of combos) {
    const key = c.cards.map(card => card.name).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
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

    const combos: EDHRECCombo[] = rawCombos.map(entry => {
      // Store href for later detail fetches
      if (entry.href) comboHrefMap.set(entry.combo.comboId, entry.href);
      return {
        comboId: entry.combo.comboId,
        cards: entry.cardviews.map(cv => ({ name: cv.name, id: cv.id })),
        results: entry.combo.results || [],
        deckCount: entry.combo.count || 0,
        rank: entry.combo.rank || 0,
        bracket: entry.combo.comboVote?.bracket || 'unknown',
        prereqCount: entry.combo.nonCardPrerequisiteCount || 0,
      };
    });

    combos.sort((a, b) => b.deckCount - a.deckCount);
    const deduped = dedupeCombosByCardSet(combos);

    comboCache.set(slug, { data: deduped, timestamp: Date.now() });
    return deduped;
  } catch (error) {
    console.error(`[EDHREC] Failed to fetch combos for ${commanderName}:`, error);
    return [];
  }
}

// Fetch known combos for a color identity from EDHREC's color-identity combo page.
// Used for off-commander combo detection — surfaces combos that exist in the deck
// but aren't listed under the specific commander. Returns combos sorted by popularity
// (deckCount descending). Cache keys are prefixed with "color:" to avoid colliding
// with commander slugs.
export async function fetchColorIdentityCombos(colorIdentity: string[]): Promise<EDHRECCombo[]> {
  const slug = colorIdentityToSlug(colorIdentity);
  const cacheKey = `color:${slug}`;

  const cached = comboCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await edhrecFetch<RawComboResponse>(
      `/pages/combos/${slug}.json`
    );

    const rawCombos = response.container?.json_dict?.cardlists || [];

    const combos: EDHRECCombo[] = rawCombos.map(entry => {
      if (entry.href) comboHrefMap.set(entry.combo.comboId, entry.href);
      return {
        comboId: entry.combo.comboId,
        cards: entry.cardviews.map(cv => ({ name: cv.name, id: cv.id })),
        results: entry.combo.results || [],
        deckCount: entry.combo.count || 0,
        rank: entry.combo.rank || 0,
        bracket: entry.combo.comboVote?.bracket || 'unknown',
        prereqCount: entry.combo.nonCardPrerequisiteCount || 0,
      };
    });

    combos.sort((a, b) => b.deckCount - a.deckCount);
    const deduped = dedupeCombosByCardSet(combos);

    comboCache.set(cacheKey, { data: deduped, timestamp: Date.now() });
    return deduped;
  } catch (error) {
    console.error(`[EDHREC] Failed to fetch color-identity combos for ${slug}:`, error);
    return [];
  }
}

// --- EDHREC combo details ---

export interface ComboDetails {
  prerequisites: string[];
  steps: string[];
  results: string[];
}

const comboDetailsCache = new Map<string, ComboDetails>();

interface RawComboDetailResponse {
  combo?: {
    prerequisites?: { description: string; zones: string[] }[];
    steps?: string[];
    results?: string[];
  };
}

/**
 * Fetch detailed combo info (prerequisites, steps, results) from EDHREC's
 * combo detail page JSON. Uses the href captured during combo list fetch.
 */
export async function fetchComboDetails(comboId: string): Promise<ComboDetails> {
  const cached = comboDetailsCache.get(comboId);
  if (cached) return cached;

  const href = comboHrefMap.get(comboId);
  if (!href) throw new Error(`No EDHREC href for combo ${comboId}`);

  const data = await edhrecFetch<RawComboDetailResponse>(`/pages${href}.json`);
  const combo = data.combo;
  if (!combo) throw new Error('No combo data in response');

  const details: ComboDetails = {
    prerequisites: combo.prerequisites?.map(p => p.description).filter(Boolean) ?? [],
    steps: combo.steps ?? [],
    results: combo.results ?? [],
  };

  comboDetailsCache.set(comboId, details);
  return details;
}

// --- Color-identity combo data ---

// Map a Scryfall color identity (array of single-letter codes) to the EDHREC URL slug
// used for color-identity combo pages: /pages/combos/{slug}.json. Sorted internally
// so call order doesn't matter (e.g. ["G","B"] and ["B","G"] both yield "golgari").
export function colorIdentityToSlug(colorIdentity: string[]): string {
  const set = new Set(colorIdentity.map(c => c.toUpperCase()));
  const sortedKey = ['W', 'U', 'B', 'R', 'G'].filter(c => set.has(c)).join('');

  switch (sortedKey) {
    case '': return 'colorless';
    case 'W': return 'mono-white';
    case 'U': return 'mono-blue';
    case 'B': return 'mono-black';
    case 'R': return 'mono-red';
    case 'G': return 'mono-green';
    case 'WU': return 'azorius';
    case 'UB': return 'dimir';
    case 'BR': return 'rakdos';
    case 'RG': return 'gruul';
    case 'WG': return 'selesnya';
    case 'WB': return 'orzhov';
    case 'UR': return 'izzet';
    case 'BG': return 'golgari';
    case 'WR': return 'boros';
    case 'UG': return 'simic';
    case 'WUG': return 'bant';
    case 'WUB': return 'esper';
    case 'UBR': return 'grixis';
    case 'BRG': return 'jund';
    case 'WRG': return 'naya';
    case 'WBR': return 'mardu';
    case 'URG': return 'temur';
    case 'WBG': return 'abzan';
    case 'WUR': return 'jeskai';
    case 'UBG': return 'sultai';
    case 'WUBR': return 'yore-tiller';
    case 'UBRG': return 'glint-eye';
    case 'WBRG': return 'dune-brood';
    case 'WURG': return 'ink-treader';
    case 'WUBG': return 'witch-maw';
    case 'WUBRG': return 'five-color';
    default: return 'colorless';
  }
}

// --- Strategy tags (browse by strategy) ---
// EDHREC's tag system, read directly so we never hardcode an archetype taxonomy.
// Index: /pages/tags.json (popularity-ordered). Per-tag: /pages/tags/{slug}.json.

interface RawTagEntry {
  name?: string;
  sanitized?: string;
  url?: string;
  inclusion?: number;
  num_decks?: number;
}

interface RawTagsResponse {
  container?: { json_dict?: { cardlists?: Array<{ tag?: string; cardviews?: RawTagEntry[] }> } };
}

/** Slug from an EDHREC tag url ("/tags/aristocrats" -> "aristocrats"). */
function tagSlugFromUrl(url?: string): string {
  return (url || '').split('/').filter(Boolean).pop() || '';
}

/** Pure: parse the tags index page into popularity-ordered tags. */
export function parseTagsIndex(raw: RawTagsResponse): EDHRECTag[] {
  const lists = raw.container?.json_dict?.cardlists ?? [];
  const list = lists.find(l => l.tag === 'tagsbypopularitysort');
  const out: EDHRECTag[] = [];
  for (const v of list?.cardviews ?? []) {
    const slug = tagSlugFromUrl(v.url);
    if (!v.name || !slug) continue;
    out.push({ name: v.name, slug, numDecks: v.num_decks ?? v.inclusion ?? 0 });
  }
  return out;
}

let allTagsCache: EDHRECTag[] | null = null;

/** Fetch EDHREC's full strategy/tag list, popularity-ordered. [] on failure. Session-cached. */
export async function fetchAllTags(): Promise<EDHRECTag[]> {
  if (allTagsCache) return allTagsCache;
  try {
    const response = await edhrecFetch<RawTagsResponse>('/pages/tags.json');
    const tags = parseTagsIndex(response);
    allTagsCache = tags;
    return tags;
  } catch (error) {
    console.warn('[EDHREC] Failed to fetch tags index:', error);
    return [];
  }
}

interface RawTagCommanderEntry {
  name?: string;
  sanitized?: string;
  inclusion?: number;
  num_decks?: number;
}

interface RawTagPageResponse {
  container?: { json_dict?: { cardlists?: Array<{ tag?: string; cardviews?: RawTagCommanderEntry[] }> } };
}

/** Pure: parse a tag page into its top commanders (no color enrichment). Drops partner pairs. */
export function parseTagCommanders(raw: RawTagPageResponse): EDHRECTopCommander[] {
  const lists = raw.container?.json_dict?.cardlists ?? [];
  const list = lists.find(l => l.tag === 'topcommanders');
  const out: EDHRECTopCommander[] = [];
  let rank = 1;
  for (const v of list?.cardviews ?? []) {
    if (!v.name || v.name.includes('//')) continue;
    out.push({
      rank: rank++,
      name: v.name,
      sanitized: v.sanitized ?? '',
      colorIdentity: [],
      numDecks: v.num_decks ?? v.inclusion ?? 0,
    });
  }
  return out;
}

const tagCommandersCache = new Map<string, { data: EDHRECTopCommander[]; timestamp: number }>();

/**
 * Fetch the top commanders for an EDHREC strategy tag, optionally narrowed to a color slug
 * (produced by colorIdentityToSlug). Color identity is absent from tag payloads, so it's
 * enriched from Scryfall. Returns [] on failure. Cached per slug+colorSlug for CACHE_TTL.
 */
export async function fetchTagCommanders(slug: string, colorSlug?: string): Promise<EDHRECTopCommander[]> {
  const cacheKey = colorSlug ? `${slug}/${colorSlug}` : slug;
  const cached = tagCommandersCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;

  try {
    const endpoint = colorSlug
      ? `/pages/tags/${slug}/${colorSlug}.json`
      : `/pages/tags/${slug}.json`;
    const response = await edhrecFetch<RawTagPageResponse>(endpoint);
    let commanders = parseTagCommanders(response);

    // Tag payloads omit color identity — enrich from Scryfall (same pattern as fetchTopCommanders).
    if (commanders.length > 0) {
      try {
        const { getCardsByNames } = await import('@/services/scryfall/client');
        const cardMap = await getCardsByNames(commanders.map(c => c.name));
        commanders = commanders.map(c => ({
          ...c,
          colorIdentity: cardMap.get(c.name)?.color_identity ?? [],
        }));
      } catch {
        // Scryfall enrichment failed — show commanders without color pips.
      }
    }

    tagCommandersCache.set(cacheKey, { data: commanders, timestamp: Date.now() });
    return commanders;
  } catch (error) {
    console.warn(`[EDHREC] Failed to fetch tag commanders for "${slug}":`, error);
    return [];
  }
}

// --- Archetype tag-page card pools (archetype cross-reference) ---
// The same /pages/tags/{slug}[/{colorSlug}].json pages read by fetchTagCommanders also
// carry full cardlists in the exact commander-page shape. This fetches them as a card
// pool so the deck builder can cross-reference commander-theme data against the
// color-filtered archetype aggregate (e.g. golgari + pillow-fort).

export interface TagPageData {
  cardlists: EDHRECCommanderData['cardlists'];
  /** Deck count of the archetype population (max potential_decks across cardviews). */
  potentialDecks: number;
}

function maxPotentialDecks(response: RawEDHRECResponse): number {
  let max = 0;
  for (const list of response.container?.json_dict?.cardlists ?? []) {
    for (const v of list.cardviews ?? []) {
      if ((v.potential_decks ?? 0) > max) max = v.potential_decks ?? 0;
    }
  }
  return max;
}

const tagPageDataCache = new Map<string, { data: TagPageData | null; timestamp: number }>();

/**
 * Fetch the card pool of an EDHREC archetype tag page, color-filtered to the given
 * identity. Falls back to the unfiltered tag page if the color page doesn't exist
 * (this CDN 403s on missing pages). Returns null on total failure — the archetype
 * layer is always optional and must never block generation.
 */
export async function fetchTagPageData(
  tagSlug: string,
  colorIdentity: string[]
): Promise<TagPageData | null> {
  const colorSlug = colorIdentityToSlug(colorIdentity);
  const cacheKey = `tagpage-${tagSlug}/${colorSlug}`;
  const cached = tagPageDataCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;

  const endpoints = [
    `/pages/tags/${tagSlug}/${colorSlug}.json`,
    `/pages/tags/${tagSlug}.json`, // color page missing → whole-archetype fallback (off-color cards filtered downstream)
  ];
  for (const endpoint of endpoints) {
    try {
      const response = await edhrecFetch<RawEDHRECResponse>(endpoint);
      const data: TagPageData = {
        cardlists: parseCardlists(response),
        potentialDecks: maxPotentialDecks(response),
      };
      tagPageDataCache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch {
      console.log(`[EDHREC] No tag page at ${endpoint} (expected for unknown slugs)`);
    }
  }
  tagPageDataCache.set(cacheKey, { data: null, timestamp: Date.now() });
  return null;
}
