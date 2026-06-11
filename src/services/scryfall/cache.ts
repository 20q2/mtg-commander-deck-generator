// src/services/scryfall/cache.ts
import Dexie, { type Table } from 'dexie';
import type { ScryfallCard } from '@/types';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CachedCard {
  name: string;
  card: ScryfallCard;
  cachedAt: number;
}

class ScryfallCacheDB extends Dexie {
  cards!: Table<CachedCard, string>;
  constructor() {
    super('manafoundry-scryfall-cache');
    this.version(1).stores({ cards: '&name, cachedAt' });
  }
}

let db: ScryfallCacheDB | null = null;
let initFailed = false;

function getDB(): ScryfallCacheDB | null {
  if (initFailed) return null;
  if (db) return db;
  try {
    db = new ScryfallCacheDB();
    return db;
  } catch (err) {
    initFailed = true;
    console.warn('[Scryfall] Persistent cache unavailable; using in-memory only', err);
    return null;
  }
}

/** Return the cached card if present and not expired, else null. Never throws. */
export async function readPersisted(name: string): Promise<ScryfallCard | null> {
  const conn = getDB();
  if (!conn) return null;
  try {
    const row = await conn.cards.get(name);
    if (!row) return null;
    if (Date.now() - row.cachedAt > TTL_MS) return null;
    return row.card;
  } catch {
    return null;
  }
}

/** Bulk-read up to N names; returns a Map of fresh (non-expired) entries only. Never throws. */
export async function readPersistedMany(names: string[]): Promise<Map<string, ScryfallCard>> {
  const result = new Map<string, ScryfallCard>();
  const conn = getDB();
  if (!conn || names.length === 0) return result;
  try {
    const rows = await conn.cards.bulkGet(names);
    const now = Date.now();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row && now - row.cachedAt <= TTL_MS) {
        result.set(names[i], row.card);
      }
    }
  } catch {
    /* swallow — return whatever we collected */
  }
  return result;
}

let quotaWarned = false;
/** Upsert a card under its name. Never throws. Logs once on quota errors. */
export async function writePersisted(name: string, card: ScryfallCard): Promise<void> {
  const conn = getDB();
  if (!conn) return;
  try {
    await conn.cards.put({ name, card, cachedAt: Date.now() });
  } catch (err) {
    if (!quotaWarned) {
      console.warn('[Scryfall] Persistent cache write failed (quota or DB error)', err);
      quotaWarned = true;
    }
  }
}

/** Bulk-write entries. Never throws. */
export async function writePersistedMany(entries: Array<{ name: string; card: ScryfallCard }>): Promise<void> {
  const conn = getDB();
  if (!conn || entries.length === 0) return;
  try {
    const now = Date.now();
    await conn.cards.bulkPut(entries.map(e => ({ name: e.name, card: e.card, cachedAt: now })));
  } catch (err) {
    if (!quotaWarned) {
      console.warn('[Scryfall] Persistent cache bulk write failed (quota or DB error)', err);
      quotaWarned = true;
    }
  }
}
