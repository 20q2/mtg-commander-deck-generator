const TAG_REPO_URL = import.meta.env.VITE_TAG_REPO_URL as string | undefined;

export interface TaggerData {
  generatedAt: string;
  tags: Record<string, string[]>;
}

// In-memory cache — lives for the entire session
let cached: TaggerData | null = null;
let fetchPromise: Promise<TaggerData | null> | null = null;

// Precomputed Set lookups for O(1) card-name checks
let tagSets: Record<string, Set<string>> | null = null;

/**
 * Fetch tagger data from S3 (or return cached).
 * Safe to call multiple times — deduplicates in-flight requests.
 */
export async function loadTaggerData(): Promise<TaggerData | null> {
  if (cached) return cached;
  if (fetchPromise) return fetchPromise;
  if (!TAG_REPO_URL) {
    console.warn('[Tagger] No VITE_TAG_REPO_URL configured, skipping tagger data');
    return null;
  }

  fetchPromise = (async () => {
    try {
      const res = await fetch(TAG_REPO_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TaggerData = await res.json();
      cached = data;
      // Build Set lookups
      tagSets = {};
      for (const [tag, names] of Object.entries(data.tags)) {
        tagSets[tag] = new Set(names);
      }
      const tagSummary = Object.entries(data.tags).map(([k, v]) => `${k}:${v.length}`).join(', ');
      console.log(`[Tagger] Loaded ${Object.keys(data.tags).length} tags (generated ${data.generatedAt}): ${tagSummary}`);
      return data;
    } catch (err) {
      console.warn('[Tagger] Failed to load tagger data — role detection will be unavailable:', err);
      return null;
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

/** Check if a card has a specific tagger tag. Returns false if tagger data isn't loaded. */
export function hasTag(cardName: string, tag: string): boolean {
  return tagSets?.[tag]?.has(cardName) ?? false;
}

/** Check if tagger data is available */
export function hasTaggerData(): boolean {
  return tagSets !== null;
}

/** Check if a land has meaningful non-mana abilities (Scryfall otag:utility-land). */
export function isUtilityLand(cardName: string): boolean {
  return tagSets?.['utility-land']?.has(cardName) ?? false;
}

/** Check if a land enters the battlefield tapped (Scryfall otag:tapland). */
export function isTapland(cardName: string): boolean {
  return tagSets?.['tapland']?.has(cardName) ?? false;
}

/** Check if a card denies mass land resources — Armageddon, Winter Orb, Blood Moon, etc. (Scryfall otag:mass-land-denial). */
export function isMassLandDenial(cardName: string): boolean {
  return tagSets?.['mass-land-denial']?.has(cardName) ?? false;
}

/** Check if a card grants extra turns — Time Warp, Expropriate, etc. (Scryfall otag:extra-turn). */
export function isExtraTurn(cardName: string): boolean {
  return tagSets?.['extra-turn']?.has(cardName) ?? false;
}

export type RoleKey = 'ramp' | 'removal' | 'boardwipe' | 'cardDraw' | 'protection';
export type RampSubtype = 'mana-producer' | 'mana-rock' | 'cost-reducer' | 'ramp';
export type RemovalSubtype = 'bounce' | 'spot-removal' | 'removal';
export type BoardwipeSubtype = 'bounce-wipe' | 'boardwipe';
export type CardDrawSubtype = 'tutor' | 'wheel' | 'cantrip' | 'card-draw' | 'card-advantage';
export type ProtectionSubtype = 'counterspell' | 'protection';

/**
 * The tagger tags that make a card count toward each role — the single source of truth for "what
 * counts as X" when crunching role numbers. Every subcategory tag is listed under its parent so the
 * parent always subsumes it: a `bounce` / `spot-removal` card is removal, a `mana-dork` / `mana-rock`
 * is ramp, a `counterspell` is protection, and so on. Add a new subcategory tag here and it counts
 * toward its parent everywhere at once. (Counterspell lives under protection, not removal — see the
 * exclusion in cardMatchesRole.)
 */
const ROLE_MEMBER_TAGS: Record<RoleKey, string[]> = {
  ramp: ['ramp', 'cost-reducer', 'mana-dork', 'mana-rock'],
  removal: ['removal', 'bounce', 'spot-removal'],
  boardwipe: ['boardwipe'],
  cardDraw: ['card-advantage', 'tutor', 'draw', 'wheel', 'cantrip'],
  protection: ['protection', 'counterspell'],
};

/** Check if a card matches a specific role (regardless of priority), subsuming all its subcategories. */
export function cardMatchesRole(cardName: string, role: RoleKey): boolean {
  const sets = tagSets;
  if (!sets) return false;
  // Counterspells are protection, not removal — keep them out of the removal bucket.
  if (role === 'removal' && sets['counterspell']?.has(cardName)) return false;
  return ROLE_MEMBER_TAGS[role].some(tag => sets[tag]?.has(cardName));
}

/** Categorize a card by its tagger tags. Returns the best-fit deck role, or null if no tag matches / data unavailable. */
export function getCardRole(cardName: string): RoleKey | null {
  if (!tagSets) return null;
  // Priority order: boardwipe (most specific) → counterspell-as-protection (beats removal/draw, e.g. a
  // counter-and-draw spell) → removal → ramp → cardDraw → protection (broad; only claims a card with
  // no other role, so it never reclassifies an existing ramp/removal/draw/wipe card).
  if (cardMatchesRole(cardName, 'boardwipe')) return 'boardwipe';
  if (tagSets['counterspell']?.has(cardName)) return 'protection';
  if (cardMatchesRole(cardName, 'removal')) return 'removal';
  if (cardMatchesRole(cardName, 'ramp')) return 'ramp';
  if (cardMatchesRole(cardName, 'cardDraw')) return 'cardDraw';
  if (cardMatchesRole(cardName, 'protection')) return 'protection';
  return null;
}

/**
 * A "true" tutor — one that searches up a specific card. Excludes basic-land fetch spells like
 * Harrow / Cultivate / Kodama's Reach, which Scryfall also tags `tutor` but which really just ramp
 * (they're already counted on the ramp axis). Labelling those as tutors reads as misleading.
 */
export function isTutor(cardName: string): boolean {
  return hasTag(cardName, 'tutor') && !cardMatchesRole(cardName, 'ramp');
}

/** Check if a card matches more than one role category (boardwipe + removal count together as interaction). */
export function hasMultipleRoles(cardName: string): boolean {
  if (!tagSets) return false;
  let count = 0;
  if (cardMatchesRole(cardName, 'boardwipe') || cardMatchesRole(cardName, 'removal')) count++;
  if (cardMatchesRole(cardName, 'ramp')) count++;
  if (cardMatchesRole(cardName, 'cardDraw')) count++;
  if (cardMatchesRole(cardName, 'protection')) count++;
  return count > 1;
}

/** Get ALL roles a card matches (not just the primary one). */
export function getAllCardRoles(cardName: string): RoleKey[] {
  if (!tagSets) return [];
  const roles: RoleKey[] = [];
  if (cardMatchesRole(cardName, 'boardwipe')) roles.push('boardwipe');
  if (cardMatchesRole(cardName, 'removal')) roles.push('removal');
  if (cardMatchesRole(cardName, 'ramp')) roles.push('ramp');
  if (cardMatchesRole(cardName, 'cardDraw')) roles.push('cardDraw');
  if (cardMatchesRole(cardName, 'protection')) roles.push('protection');
  return roles;
}

/** For cards with the 'ramp' role, return the specific subtype. */
export function getRampSubtype(cardName: string): RampSubtype | null {
  if (!tagSets) return null;
  if (tagSets['mana-dork']?.has(cardName)) return 'mana-producer';
  if (tagSets['mana-rock']?.has(cardName)) return 'mana-rock';
  if (tagSets['cost-reducer']?.has(cardName)) return 'cost-reducer';
  if (tagSets['ramp']?.has(cardName)) return 'ramp';
  return null;
}

/** For cards with the 'removal' role, return the specific subtype. */
export function getRemovalSubtype(cardName: string): RemovalSubtype | null {
  if (!tagSets) return null;
  if (tagSets['bounce']?.has(cardName)) return 'bounce';
  if (tagSets['spot-removal']?.has(cardName)) return 'spot-removal';
  if (tagSets['removal']?.has(cardName)) return 'removal';
  return null;
}

/** For cards with the 'boardwipe' role, return the specific subtype via cross-referencing. */
export function getBoardwipeSubtype(cardName: string): BoardwipeSubtype | null {
  if (!tagSets) return null;
  if (!tagSets['boardwipe']?.has(cardName)) return null;
  if (tagSets['bounce']?.has(cardName)) return 'bounce-wipe';
  return 'boardwipe';
}

/** For cards with the 'cardDraw' role, return the specific subtype. */
export function getCardDrawSubtype(cardName: string): CardDrawSubtype | null {
  if (!tagSets) return null;
  if (tagSets['tutor']?.has(cardName)) return 'tutor';
  if (tagSets['wheel']?.has(cardName)) return 'wheel';
  if (tagSets['cantrip']?.has(cardName)) return 'cantrip';
  if (tagSets['draw']?.has(cardName)) return 'card-draw';
  return 'card-advantage';
}

/** For cards with the 'protection' role, return the specific subtype. */
export function getProtectionSubtype(cardName: string): ProtectionSubtype | null {
  if (!tagSets) return null;
  if (tagSets['counterspell']?.has(cardName)) return 'counterspell';
  if (tagSets['protection']?.has(cardName)) return 'protection';
  return null;
}

/** Get the subtype of a card for its primary role (if any). */
export function getCardSubtype(cardName: string): string | null {
  const role = getCardRole(cardName);
  if (!role) return null;
  switch (role) {
    case 'ramp': return getRampSubtype(cardName);
    case 'removal': return getRemovalSubtype(cardName);
    case 'boardwipe': return getBoardwipeSubtype(cardName);
    case 'cardDraw': return getCardDrawSubtype(cardName);
    case 'protection': return getProtectionSubtype(cardName);
    default: return null;
  }
}
