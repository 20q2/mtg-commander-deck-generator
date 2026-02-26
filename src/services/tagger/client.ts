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
      const res = await fetch(TAG_REPO_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TaggerData = await res.json();
      cached = data;
      // Build Set lookups
      tagSets = {};
      for (const [tag, names] of Object.entries(data.tags)) {
        tagSets[tag] = new Set(names);
      }
      console.log(`[Tagger] Loaded ${Object.keys(data.tags).length} tags (generated ${data.generatedAt})`);
      return data;
    } catch (err) {
      console.warn('[Tagger] Failed to load tagger data, falling back to oracle text:', err);
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

/** Categorize a card by its tagger tags. Returns the best-fit deck role. */
export function getTaggerRole(cardName: string): 'ramp' | 'removal' | 'boardwipe' | 'cardDraw' | null {
  if (!tagSets) return null;
  // Check in priority order — boardwipe before removal (it's more specific)
  if (tagSets['boardwipe']?.has(cardName)) return 'boardwipe';
  if (tagSets['removal']?.has(cardName)) return 'removal';
  if (tagSets['ramp']?.has(cardName)) return 'ramp';
  if (tagSets['card-advantage']?.has(cardName)) return 'cardDraw';
  return null;
}
