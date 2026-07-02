import Dexie, { type Table } from 'dexie';
import type { SerializedEnrichment } from '@/types';

const TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const MAX_ENTRIES = 50;

export interface DeckEnrichmentCacheRow {
  listId: string;
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
