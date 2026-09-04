// src/services/scryfall/cache.ts
import Dexie, { type Table } from 'dexie';
import type { ScryfallCard } from '@/types';
import { isExtraPrinting } from './extras';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;         // 7 days (Scryfall cards)
const EDHREC_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days (EDHREC responses — matches the in-memory TTL)
// Oracle tags move only when Scryfall re-tags a card, which is rare and never urgent for a dev lab.
const ORACLE_TAG_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// Hard ceilings so the DB can't grow without bound. TTL keeps normal use far below these; the caps
// only bite for a heavy long-term user. Tunable. (EDHREC responses are bulkier, so fewer.)
const CARDS_MAX_ENTRIES = 6000;   // ScryfallCard objects (~8KB each)
const EDHREC_MAX_ENTRIES = 1500;  // raw EDHREC pages (~50-100KB each)

interface CachedCard {
  name: string;
  card: ScryfallCard;
  cachedAt: number;
}

// One raw EDHREC endpoint response, keyed by its path (e.g. "/pages/cards/sol-ring.json").
interface CachedResponse {
  endpoint: string;
  data: unknown;
  cachedAt: number;
}

// Every card name carrying one oracle tag, keyed by the search query (e.g. "otag:overrun").
interface CachedTagMembership {
  query: string;
  names: string[];
  cachedAt: number;
}

class ScryfallCacheDB extends Dexie {
  cards!: Table<CachedCard, string>;
  edhrecResponses!: Table<CachedResponse, string>;
  oracleTags!: Table<CachedTagMembership, string>;
  constructor() {
    super('manafoundry-scryfall-cache');
    this.version(1).stores({ cards: '&name, cachedAt' });
    // v2 was a parsed lift-pool store; v3 supersedes it with a generic EDHREC response cache keyed by
    // endpoint, so EVERY EDHREC fetch survives reloads. `liftPools: null` drops the old store.
    this.version(2).stores({ cards: '&name, cachedAt', liftPools: '&name, cachedAt' });
    this.version(3).stores({ cards: '&name, cachedAt', liftPools: null, edhrecResponses: '&endpoint, cachedAt' });
    // v4 clears the cards table once so entries cached before cheapest-printing reconciliation
    // (which may hold inflated foil/etched prices) are re-fetched and re-priced. edhrecResponses kept.
    this.version(4).stores({ cards: '&name, cachedAt', edhrecResponses: '&endpoint, cachedAt' })
      .upgrade(async tx => { await tx.table('cards').clear(); });
    // v5 adds oracle-tag membership. A full Finisher Lab sweep is ~20 paginated Scryfall requests
    // that only change when Scryfall re-tags a card, so paying it once per session was the single
    // largest source of dead time in the lab.
    this.version(5).stores({
      cards: '&name, cachedAt',
      edhrecResponses: '&endpoint, cachedAt',
      oracleTags: '&query, cachedAt',
    });
  }
}

let db: ScryfallCacheDB | null = null;
let initFailed = false;
let pruned = false;

function getDB(): ScryfallCacheDB | null {
  if (initFailed) return null;
  if (db) return db;
  try {
    db = new ScryfallCacheDB();
    // Reclaim space once per session: drop expired rows, then cap each table. Fire-and-forget.
    if (!pruned) { pruned = true; void pruneStale(db); }
    return db;
  } catch (err) {
    initFailed = true;
    console.warn('[Scryfall] Persistent cache unavailable; using in-memory only', err);
    return null;
  }
}

/**
 * Reclaim disk: delete entries past their TTL (reads already ignore them, so this only frees space),
 * then hard-cap each table to its newest N rows. Cheap — `cachedAt` is indexed. Best-effort; never throws.
 */
async function pruneStale(conn: ScryfallCacheDB): Promise<void> {
  try {
    const now = Date.now();
    await conn.cards.where('cachedAt').below(now - TTL_MS).delete();
    await conn.edhrecResponses.where('cachedAt').below(now - EDHREC_TTL_MS).delete();
    await conn.oracleTags.where('cachedAt').below(now - ORACLE_TAG_TTL_MS).delete();

    const cardCount = await conn.cards.count();
    if (cardCount > CARDS_MAX_ENTRIES) {
      const oldest = await conn.cards.orderBy('cachedAt').limit(cardCount - CARDS_MAX_ENTRIES).primaryKeys();
      await conn.cards.bulkDelete(oldest);
    }
    const respCount = await conn.edhrecResponses.count();
    if (respCount > EDHREC_MAX_ENTRIES) {
      const oldest = await conn.edhrecResponses.orderBy('cachedAt').limit(respCount - EDHREC_MAX_ENTRIES).primaryKeys();
      await conn.edhrecResponses.bulkDelete(oldest);
    }
  } catch {
    /* prune is best-effort — a failure here must never affect reads/writes */
  }
}

/**
 * Evict rows written before the extras guard existed. A token cached under its parent
 * card's name (every embalm/eternalize token is a name-identical copy) would otherwise
 * keep shadowing the real card for the full 7-day TTL, surviving reloads. Treating the
 * row as a miss AND deleting it lets the next fetch repair the entry. Best-effort.
 */
function evictExtra(conn: ScryfallCacheDB, name: string): void {
  void conn.cards.delete(name).catch(() => { /* best-effort */ });
}

/** Return the cached card if present and not expired, else null. Never throws. */
export async function readPersisted(name: string): Promise<ScryfallCard | null> {
  const conn = getDB();
  if (!conn) return null;
  try {
    const row = await conn.cards.get(name);
    if (!row) return null;
    if (Date.now() - row.cachedAt > TTL_MS) return null;
    if (isExtraPrinting(row.card)) { evictExtra(conn, name); return null; }
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
      if (!row || now - row.cachedAt > TTL_MS) continue;
      if (isExtraPrinting(row.card)) { evictExtra(conn, names[i]); continue; }
      result.set(names[i], row.card);
    }
  } catch {
    /* swallow — return whatever we collected */
  }
  return result;
}

let quotaWarned = false;
/** Upsert a card under its name. Extras are never stored — see `isExtraPrinting`. Never throws. */
export async function writePersisted(name: string, card: ScryfallCard): Promise<void> {
  const conn = getDB();
  if (!conn || isExtraPrinting(card)) return;
  try {
    await conn.cards.put({ name, card, cachedAt: Date.now() });
  } catch (err) {
    if (!quotaWarned) {
      console.warn('[Scryfall] Persistent cache write failed (quota or DB error)', err);
      quotaWarned = true;
    }
  }
}

/** Bulk-write entries. Extras are dropped — see `isExtraPrinting`. Never throws. */
export async function writePersistedMany(entries: Array<{ name: string; card: ScryfallCard }>): Promise<void> {
  const conn = getDB();
  const storable = entries.filter(e => !isExtraPrinting(e.card));
  if (!conn || storable.length === 0) return;
  try {
    const now = Date.now();
    await conn.cards.bulkPut(storable.map(e => ({ name: e.name, card: e.card, cachedAt: now })));
  } catch (err) {
    if (!quotaWarned) {
      console.warn('[Scryfall] Persistent cache bulk write failed (quota or DB error)', err);
      quotaWarned = true;
    }
  }
}

// --- EDHREC responses (raw JSON keyed by endpoint — persisted alongside the card cache) ---

/** Read a persisted EDHREC response by endpoint if present and not expired, else null. Never throws. */
export async function readPersistedResponse<T = unknown>(endpoint: string): Promise<T | null> {
  const conn = getDB();
  if (!conn) return null;
  try {
    const row = await conn.edhrecResponses.get(endpoint);
    if (!row) return null;
    if (Date.now() - row.cachedAt > EDHREC_TTL_MS) return null;
    return row.data as T;
  } catch {
    return null;
  }
}

/** Upsert a raw EDHREC response under its endpoint. Never throws. */
export async function writePersistedResponse(endpoint: string, data: unknown): Promise<void> {
  const conn = getDB();
  if (!conn) return;
  try {
    await conn.edhrecResponses.put({ endpoint, data, cachedAt: Date.now() });
  } catch (err) {
    if (!quotaWarned) {
      console.warn('[EDHREC] Persistent response write failed (quota or DB error)', err);
      quotaWarned = true;
    }
  }
}

// --- Oracle-tag membership (a fully paginated `otag:` sweep, keyed by query) ---

/** Card names carrying an oracle tag, if cached and unexpired. Never throws. */
export async function readPersistedOracleTag(query: string): Promise<Set<string> | null> {
  const conn = getDB();
  if (!conn) return null;
  try {
    const row = await conn.oracleTags.get(query);
    if (!row) return null;
    if (Date.now() - row.cachedAt > ORACLE_TAG_TTL_MS) return null;
    return new Set(row.names);
  } catch {
    return null;
  }
}

/**
 * Store a completed tag sweep. Empty results are NOT cached — an empty set is what both a typo'd
 * tag and a failed sweep look like, and persisting that would make a transient network failure
 * look like a permanently dead tag for a fortnight.
 */
export async function writePersistedOracleTag(query: string, names: Set<string>): Promise<void> {
  const conn = getDB();
  if (!conn || names.size === 0) return;
  try {
    await conn.oracleTags.put({ query, names: [...names], cachedAt: Date.now() });
  } catch (err) {
    if (!quotaWarned) {
      console.warn('[Scryfall] Oracle tag cache write failed (quota or DB error)', err);
      quotaWarned = true;
    }
  }
}
