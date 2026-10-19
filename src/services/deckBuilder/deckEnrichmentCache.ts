import Dexie, { type Table } from 'dexie';
import type { SerializedEnrichment } from '@/types';

const TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const MAX_ENTRIES = 50;

/**
 * Payload shape version. Bump whenever a build starts depending on a field that
 * older cached payloads don't carry — rows at a different version are treated as
 * misses and rebuilt from scratch.
 *
 * Without this, a cache row written by an older build hydrates into a new build
 * that silently reads the missing field as absent: combo slot templates came
 * back unchecked and combo `href`s came back undefined (stranding "Show details"
 * on its error fallback), with no TTL short enough to rescue it — the entries
 * live 14 days. A schema stamp makes those self-heal on the next load instead of
 * needing the user to clear site data.
 *
 * 2 — combos carry `templates`/`templateFits` (unnamed slots) and `href`.
 */
export const ENRICHMENT_SCHEMA_VERSION = 2;

export interface DeckEnrichmentCacheRow {
  listId: string;
  /** Payload shape this row was written at; absent on pre-versioning rows. */
  schemaVersion?: number;
  commanderName: string | null;
  partnerName: string | null;
  contentHash: string;
  cachedAt: number;
  lastAccessed: number;
  payload: SerializedEnrichment;
}

class DeckEnrichmentCacheDB extends Dexie {
  rows!: Table<DeckEnrichmentCacheRow, string>;

  constructor() {
    super('mtg-deck-enrichment-cache');
    this.version(1).stores({
      rows: 'listId, lastAccessed, cachedAt',
    });
  }
}

const db = new DeckEnrichmentCacheDB();

export function computeContentHash(mainboard: string[]): string {
  const sorted = [...mainboard].sort().join('|');
  let h = 2166136261;
  for (let i = 0; i < sorted.length; i++) {
    h ^= sorted.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export async function readEnrichmentCache(listId: string): Promise<DeckEnrichmentCacheRow | null> {
  try {
    const row = await db.rows.get(listId);
    return row ?? null;
  } catch (e) {
    console.warn('[deckEnrichmentCache] read failed:', e);
    return null;
  }
}

export async function writeEnrichmentCache(row: DeckEnrichmentCacheRow): Promise<void> {
  try {
    await db.rows.put(row);
    await pruneEnrichmentCache(MAX_ENTRIES);
  } catch (e) {
    console.warn('[deckEnrichmentCache] write failed:', e);
  }
}

export async function deleteEnrichmentCache(listId: string): Promise<void> {
  try {
    await db.rows.delete(listId);
  } catch (e) {
    console.warn('[deckEnrichmentCache] delete failed:', e);
  }
}

export async function touchEnrichmentCache(listId: string): Promise<void> {
  try {
    await db.rows.update(listId, { lastAccessed: Date.now() });
  } catch (e) {
    console.warn('[deckEnrichmentCache] touch failed:', e);
  }
}

export async function pruneEnrichmentCache(maxEntries: number = MAX_ENTRIES): Promise<void> {
  try {
    const count = await db.rows.count();
    if (count <= maxEntries) return;
    const toDelete = await db.rows
      .orderBy('lastAccessed')
      .limit(count - maxEntries)
      .primaryKeys();
    if (toDelete.length > 0) await db.rows.bulkDelete(toDelete);
  } catch (e) {
    console.warn('[deckEnrichmentCache] prune failed:', e);
  }
}

export function isCacheFresh(row: DeckEnrichmentCacheRow): boolean {
  return Date.now() - row.cachedAt < TTL_MS;
}

/** False for rows written by a build with a different payload shape. */
export function cacheMatchesSchema(row: DeckEnrichmentCacheRow): boolean {
  return row.schemaVersion === ENRICHMENT_SCHEMA_VERSION;
}

export function cacheMatchesCommander(
  row: DeckEnrichmentCacheRow,
  commanderName: string | undefined,
  partnerName: string | undefined,
): boolean {
  return row.commanderName === (commanderName ?? null)
    && row.partnerName === (partnerName ?? null);
}

// True when the cached payload was built from the same mainboard as `mainboard`.
// Guards against hydrating stale categories after the card list changed elsewhere
// (e.g. edited in another tab) — otherwise cards absent from the stale payload get
// mislabeled as failed Scryfall lookups.
export function cacheMatchesContent(
  row: DeckEnrichmentCacheRow,
  mainboard: string[],
): boolean {
  return row.contentHash === computeContentHash(mainboard);
}
