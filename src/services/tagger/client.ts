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

export type RoleKey = 'ramp' | 'removal' | 'boardwipe' | 'cardDraw';
export type RampSubtype = 'mana-producer' | 'mana-rock' | 'cost-reducer' | 'ramp';
export type RemovalSubtype = 'counterspell' | 'bounce' | 'spot-removal' | 'removal';
export type BoardwipeSubtype = 'bounce-wipe' | 'boardwipe';
export type CardDrawSubtype = 'tutor' | 'wheel' | 'cantrip' | 'card-draw' | 'card-advantage';

/** Categorize a card by its tagger tags. Returns the best-fit deck role, or null if no tag matches / data unavailable. */
export function getCardRole(cardName: string): RoleKey | null {
  if (!tagSets) return null;
  // Check in priority order — boardwipe before removal (it's more specific)
  if (tagSets['boardwipe']?.has(cardName)) return 'boardwipe';
  if (tagSets['removal']?.has(cardName)) return 'removal';
  if (tagSets['ramp']?.has(cardName) || tagSets['cost-reducer']?.has(cardName) || tagSets['mana-dork']?.has(cardName) || tagSets['mana-rock']?.has(cardName)) return 'ramp';
  if (tagSets['card-advantage']?.has(cardName) || tagSets['tutor']?.has(cardName) || tagSets['draw']?.has(cardName) || tagSets['wheel']?.has(cardName) || tagSets['looting']?.has(cardName) || tagSets['cantrip']?.has(cardName)) return 'cardDraw';
  return null;
}

/** Check if a card matches a specific role (regardless of priority). */
export function cardMatchesRole(cardName: string, role: RoleKey): boolean {
  if (!tagSets) return false;
  switch (role) {
    case 'boardwipe': return !!tagSets['boardwipe']?.has(cardName);
    case 'removal': return !!tagSets['removal']?.has(cardName);
    case 'ramp': return !!(tagSets['ramp']?.has(cardName) || tagSets['cost-reducer']?.has(cardName) || tagSets['mana-dork']?.has(cardName) || tagSets['mana-rock']?.has(cardName));
    case 'cardDraw': return !!(tagSets['card-advantage']?.has(cardName) || tagSets['tutor']?.has(cardName) || tagSets['draw']?.has(cardName) || tagSets['wheel']?.has(cardName) || tagSets['looting']?.has(cardName) || tagSets['cantrip']?.has(cardName));
    default: return false;
  }
}

/** Check if a card matches more than one role category. */
export function hasMultipleRoles(cardName: string): boolean {
  if (!tagSets) return false;
  let count = 0;
  if (tagSets['boardwipe']?.has(cardName) || tagSets['removal']?.has(cardName)) count++;
  if (tagSets['ramp']?.has(cardName) || tagSets['cost-reducer']?.has(cardName) || tagSets['mana-dork']?.has(cardName) || tagSets['mana-rock']?.has(cardName)) count++;
  if (tagSets['card-advantage']?.has(cardName) || tagSets['tutor']?.has(cardName) || tagSets['draw']?.has(cardName) || tagSets['wheel']?.has(cardName) || tagSets['looting']?.has(cardName) || tagSets['cantrip']?.has(cardName)) count++;
  return count > 1;
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
  if (tagSets['counterspell']?.has(cardName)) return 'counterspell';
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
