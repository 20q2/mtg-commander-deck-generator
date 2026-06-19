import { fetchCommanderData, fetchCommandersWithinColors } from '@/services/edhrec/client';
import type { CollectionCard } from '@/services/collection/db';
import type { EDHRECTopCommander } from '@/types';

export interface CommanderReadiness {
  commanderName: string;
  /** Number of EDHREC staples for this commander that the player owns. */
  ownedCount: number;
  /** Total staples considered (top N nonland + a slice of lands). */
  totalCount: number;
  /** ownedCount / totalCount as a percentage 0-100. */
  percent: number;
  /** Cards in the staple pool that the player owns (canonical Scryfall names). */
  ownedNames: string[];
}

/** How many top non-land staples to count toward readiness. */
const TOP_NONLAND = 80;
/** How many top lands to count toward readiness (most decks reuse the same staple lands). */
const TOP_LANDS = 20;

const readinessCache = new Map<string, CommanderReadiness>();

/**
 * Build a lookup set of canonical names from the collection.
 * EDHREC and Scryfall both use the front-face name as the canonical form,
 * which matches what we store in CollectionCard.name.
 */
function buildOwnedNameSet(collection: CollectionCard[]): Set<string> {
  const set = new Set<string>();
  for (const card of collection) {
    set.add(card.name);
  }
  return set;
}

/**
 * Compute readiness for a single commander.
 *
 * Strategy: fetch the commander's EDHREC top-card lists, take the top N non-land
 * staples and the top M lands, then count how many of those the player owns.
 * Caches per session (independent of the EDHREC 5-min cache so re-renders are instant).
 */
export async function computeCommanderReadiness(
  commanderName: string,
  collection: CollectionCard[],
): Promise<CommanderReadiness> {
  const cacheKey = `${commanderName}::${collection.length}`;
  const cached = readinessCache.get(cacheKey);
  if (cached) return cached;

  const owned = buildOwnedNameSet(collection);

  try {
    const data = await fetchCommanderData(commanderName);
    const topNonLand = data.cardlists.allNonLand.slice(0, TOP_NONLAND);
    const topLands = data.cardlists.lands.slice(0, TOP_LANDS);
    const pool = [...topNonLand, ...topLands];

    const ownedNames: string[] = [];
    for (const staple of pool) {
      if (owned.has(staple.name)) ownedNames.push(staple.name);
    }

    const result: CommanderReadiness = {
      commanderName,
      ownedCount: ownedNames.length,
      totalCount: pool.length,
      percent: pool.length > 0 ? (ownedNames.length / pool.length) * 100 : 0,
      ownedNames,
    };
    readinessCache.set(cacheKey, result);
    return result;
  } catch {
    // EDHREC down, commander not in their database, etc. — neutral zero.
    const result: CommanderReadiness = {
      commanderName,
      ownedCount: 0,
      totalCount: 0,
      percent: 0,
      ownedNames: [],
    };
    return result;
  }
}

// --- Reverse suggestions: commanders the player does NOT own but has staples for ---

export interface CommanderSuggestion {
  /** The candidate commander (name + color identity), from EDHREC popularity data. */
  commander: EDHRECTopCommander;
  /** How many of this commander's staples the player already owns. */
  readiness: CommanderReadiness;
}

/** Only suggest commanders the player is at least this ready for (percent). */
const MIN_SUGGEST_PERCENT = 30;
/** How many popular candidates to actually score (caps EDHREC commander-page fetches). */
const DEFAULT_CANDIDATE_POOL = 24;
/** How many suggestions to return. */
const DEFAULT_RESULT_COUNT = 5;
/** Concurrency for scoring candidates. */
const SUGGEST_BATCH = 4;

const suggestionCache = new Map<string, CommanderSuggestion[]>();

/**
 * Suggest commanders the player does NOT own but already has the staples for.
 *
 * Strategy (the "live, color-gated" approach): take the most popular commanders
 * whose color identity the collection can support, drop the ones already owned,
 * score readiness for the top N most popular, and return the best matches above
 * a floor. Candidate gathering reuses cached EDHREC combo pages; scoring reuses
 * the per-commander readiness cache, so repeat calls are cheap.
 */
export async function suggestCommanders(
  collection: CollectionCard[],
  ownedCommanderNames: Set<string>,
  opts: { candidatePoolSize?: number; resultCount?: number; minPercent?: number } = {},
): Promise<CommanderSuggestion[]> {
  const {
    candidatePoolSize = DEFAULT_CANDIDATE_POOL,
    resultCount = DEFAULT_RESULT_COUNT,
    minPercent = MIN_SUGGEST_PERCENT,
  } = opts;

  // Colors the collection can support — gates which commanders are even plausible.
  const ownedColors = new Set<string>();
  for (const card of collection) {
    for (const c of card.colorIdentity ?? []) ownedColors.add(c);
  }
  if (ownedColors.size === 0) return [];

  const cacheKey = `${[...ownedColors].sort().join('')}::${collection.length}::${candidatePoolSize}::${resultCount}::${minPercent}`;
  const cached = suggestionCache.get(cacheKey);
  if (cached) return cached;

  let candidates: EDHRECTopCommander[];
  try {
    candidates = await fetchCommandersWithinColors([...ownedColors]);
  } catch {
    return [];
  }

  // Drop commanders already owned, then keep only the most popular candidates
  // to bound how many EDHREC commander pages we fetch.
  const pool = candidates
    .filter(c => !ownedCommanderNames.has(c.name))
    .slice(0, candidatePoolSize);

  // Score readiness with a small concurrency pool (reuses the readiness cache).
  const scored: CommanderSuggestion[] = [];
  const queue = [...pool];
  async function worker() {
    while (queue.length > 0) {
      const cmd = queue.shift();
      if (!cmd) return;
      const readiness = await computeCommanderReadiness(cmd.name, collection);
      if (readiness.totalCount > 0) scored.push({ commander: cmd, readiness });
    }
  }
  await Promise.all(Array.from({ length: SUGGEST_BATCH }, () => worker()));

  const result = scored
    .filter(s => s.readiness.percent >= minPercent)
    .sort((a, b) => b.readiness.percent - a.readiness.percent)
    .slice(0, resultCount);

  suggestionCache.set(cacheKey, result);
  return result;
}

/** Clear the readiness cache (e.g. when the collection changes meaningfully). */
export function clearReadinessCache(): void {
  readinessCache.clear();
  suggestionCache.clear();
}
