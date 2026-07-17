import {
  CURRENT_SCHEMA_VERSION,
  MigrationError,
  STORAGE_KEYS,
  migrateForward,
  type MigrationEnvelope,
  type MigrationData,
  type MigrationPreferences,
} from './schema';
import { db, bulkImport, DEFAULT_BINDER_ID } from '@/services/collection/db';
import type { UserCardList, BanList, AppliedList } from '@/types';
import type { CollectionCard } from '@/services/collection/db';

/** Backup files predate the binder concept — restored collections always land in the default binder. */
async function ensureDefaultBinderExists(): Promise<void> {
  const existing = await db.binders.get(DEFAULT_BINDER_ID);
  if (!existing) {
    await db.binders.add({ id: DEFAULT_BINDER_ID, name: 'My Collection', order: 0, createdAt: Date.now() });
  }
}

// ─── Parse + validate + migrate ─────────────────────────────────────────
export function parseAndMigrate(rawJson: string): MigrationEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new MigrationError("This file isn't valid JSON.");
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new MigrationError("This doesn't look like a ManaFoundry backup file.");
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.schemaVersion !== 'number' || typeof obj.data !== 'object' || obj.data === null) {
    throw new MigrationError("This doesn't look like a ManaFoundry backup file.");
  }

  if (obj.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new MigrationError(
      'This file is from a newer version of the site. Please refresh and try again.'
    );
  }

  const envelope: MigrationEnvelope = {
    schemaVersion: obj.schemaVersion,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
    sourceHost: typeof obj.sourceHost === 'string' ? obj.sourceHost : '',
    appVersion: typeof obj.appVersion === 'string' ? obj.appVersion : '',
    data: sanitizeData(obj.data as Record<string, unknown>),
  };

  return migrateForward(envelope);
}

// Strip anything that isn't shaped how we expect. Per spec: lenient parse —
// require irreplaceable fields, ignore unknowns, never partial-fail the import.
function sanitizeData(data: Record<string, unknown>): MigrationData {
  const out: MigrationData = {};

  if (Array.isArray(data.lists)) {
    const lists: UserCardList[] = [];
    for (const raw of data.lists) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      if (
        typeof r.id !== 'string' ||
        typeof r.name !== 'string' ||
        !Array.isArray(r.cards) ||
        !r.cards.every(c => typeof c === 'string')
      ) continue;
      const type = r.type === 'deck' ? 'deck' : 'list';
      // Pass through unknown fields too — preserves cached display fields
      // and future-proofs against lists with extra metadata.
      lists.push({ ...(r as any), type } as UserCardList);
    }
    if (lists.length > 0) out.lists = lists;
  }

  if (Array.isArray(data.collection)) {
    const collection: CollectionCard[] = [];
    for (const raw of data.collection) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      if (typeof r.name !== 'string' || typeof r.quantity !== 'number' || r.quantity < 1) continue;
      collection.push({
        binderId: DEFAULT_BINDER_ID,
        name: r.name,
        quantity: Math.floor(r.quantity),
        addedAt: typeof r.addedAt === 'number' ? r.addedAt : Date.now(),
        typeLine: typeof r.typeLine === 'string' ? r.typeLine : undefined,
        colorIdentity: Array.isArray(r.colorIdentity) && r.colorIdentity.every(c => typeof c === 'string')
          ? (r.colorIdentity as string[]) : undefined,
        cmc: typeof r.cmc === 'number' ? r.cmc : undefined,
        manaCost: typeof r.manaCost === 'string' ? r.manaCost : undefined,
        rarity: typeof r.rarity === 'string' ? r.rarity : undefined,
        imageUrl: typeof r.imageUrl === 'string' ? r.imageUrl : undefined,
        edhrecRank: typeof r.edhrecRank === 'number' ? r.edhrecRank : undefined,
      });
    }
    if (collection.length > 0) out.collection = collection;
  }

  if (data.preferences && typeof data.preferences === 'object') {
    const p = data.preferences as Record<string, unknown>;
    const prefs: Partial<MigrationPreferences> = {};

    if (Array.isArray(p.bannedCards) && p.bannedCards.every(x => typeof x === 'string'))
      prefs.bannedCards = p.bannedCards as string[];
    if (Array.isArray(p.mustIncludeCards) && p.mustIncludeCards.every(x => typeof x === 'string'))
      prefs.mustIncludeCards = p.mustIncludeCards as string[];
    if (typeof p.currency === 'string') prefs.currency = p.currency;
    if (Array.isArray(p.banLists))
      prefs.banLists = p.banLists.filter(isShapedBanList) as BanList[];
    if (Array.isArray(p.appliedIncludeLists))
      prefs.appliedIncludeLists = p.appliedIncludeLists.filter(isShapedAppliedList) as AppliedList[];
    if (Array.isArray(p.appliedExcludeLists))
      prefs.appliedExcludeLists = p.appliedExcludeLists.filter(isShapedAppliedList) as AppliedList[];
    if (typeof p.arenaOnly === 'boolean') prefs.arenaOnly = p.arenaOnly;
    if (typeof p.eaFeaturesEnabled === 'boolean') prefs.eaFeaturesEnabled = p.eaFeaturesEnabled;

    if (Object.keys(prefs).length > 0) out.preferences = prefs;
  }

  return out;
}

function isShapedBanList(x: unknown): x is BanList {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return typeof r.id === 'string'
    && typeof r.name === 'string'
    && Array.isArray(r.cards)
    && r.cards.every(c => typeof c === 'string')
    && typeof r.isPreset === 'boolean'
    && typeof r.enabled === 'boolean';
}

function isShapedAppliedList(x: unknown): x is AppliedList {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return typeof r.listId === 'string' && typeof r.enabled === 'boolean';
}

// ─── Diff ───────────────────────────────────────────────────────────────
export type SectionStrategy = 'merge' | 'replace' | 'skip';

export interface ImportPlan {
  lists: SectionStrategy;
  collection: SectionStrategy;
  preferences: SectionStrategy;
}

export interface ImportDiff {
  fileCounts: { lists: number; collection: number; preferences: number };
  localCounts: { lists: number; collection: number; preferences: number };
  smartDefaults: ImportPlan;
}

export async function computeDiff(env: MigrationEnvelope): Promise<ImportDiff> {
  const fileCounts = {
    lists: env.data.lists?.length ?? 0,
    collection: env.data.collection?.length ?? 0,
    preferences: env.data.preferences ? Object.keys(env.data.preferences).length : 0,
  };

  // Local counts
  let localLists = 0;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.userLists);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) localLists = parsed.length;
    }
  } catch { /* count as 0 */ }

  const localCollection = await db.cards.count();

  let localPrefs = 0;
  for (const key of Object.values(STORAGE_KEYS)) {
    if (key === STORAGE_KEYS.userLists) continue; // counted as lists
    if (localStorage.getItem(key) !== null) localPrefs++;
  }

  const localCounts = { lists: localLists, collection: localCollection, preferences: localPrefs };

  const smartDefaults: ImportPlan = {
    lists: localCounts.lists === 0 ? 'replace' : 'merge',
    collection: localCounts.collection === 0 ? 'replace' : 'merge',
    preferences: localCounts.preferences === 0 ? 'replace' : 'merge',
  };

  return { fileCounts, localCounts, smartDefaults };
}

// ─── Apply ──────────────────────────────────────────────────────────────
export interface ImportSummary {
  listsImported: number;
  collectionCardsImported: number;
  preferencesApplied: number;
}

export async function applyMigration(
  env: MigrationEnvelope,
  plan: ImportPlan,
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    listsImported: 0,
    collectionCardsImported: 0,
    preferencesApplied: 0,
  };

  // ── Lists ────────────────────────────────────────────────────────────
  if (plan.lists !== 'skip' && env.data.lists && env.data.lists.length > 0) {
    const existing = readLocalLists();
    let next: UserCardList[];
    if (plan.lists === 'replace') {
      next = env.data.lists;
    } else {
      // merge: rename incoming IDs that collide with existing
      const existingIds = new Set(existing.map(l => l.id));
      const rebadged = env.data.lists.map(l => {
        if (!existingIds.has(l.id)) return l;
        let candidate = `imported-${l.id}`;
        let n = 2;
        while (existingIds.has(candidate)) {
          candidate = `imported-${l.id}-${n++}`;
        }
        existingIds.add(candidate);
        return { ...l, id: candidate };
      });
      next = [...existing, ...rebadged];
    }
    localStorage.setItem(STORAGE_KEYS.userLists, JSON.stringify(next));
    summary.listsImported = env.data.lists.length;
  }

  // ── Collection ───────────────────────────────────────────────────────
  // Backup files predate the binder concept, so restored cards always land in the
  // default binder — 'replace' clears every binder (a full-app restore), 'merge' only
  // touches the default binder's rows.
  if (plan.collection !== 'skip' && env.data.collection && env.data.collection.length > 0) {
    await ensureDefaultBinderExists();
    if (plan.collection === 'replace') {
      await db.cards.clear();
      // Use bulkImport so metadata gets written via the same path the
      // collection importer uses. bulkImport sums into existing rows, but
      // we just cleared, so each becomes a clean add.
      await bulkImport(DEFAULT_BINDER_ID, env.data.collection.map(c => ({
        name: c.name,
        quantity: c.quantity,
        typeLine: c.typeLine,
        colorIdentity: c.colorIdentity,
        cmc: c.cmc,
        manaCost: c.manaCost,
        rarity: c.rarity,
        imageUrl: c.imageUrl,
        edhrecRank: c.edhrecRank,
      })));
    } else {
      // merge: max(existing.qty, incoming.qty); metadata fields keep
      // existing-if-defined, otherwise take incoming.
      await db.transaction('rw', db.cards, async () => {
        for (const c of env.data.collection!) {
          const key: [string, string] = [DEFAULT_BINDER_ID, c.name];
          const existing = await db.cards.get(key);
          if (!existing) {
            await db.cards.add({
              binderId: DEFAULT_BINDER_ID,
              name: c.name,
              quantity: c.quantity,
              addedAt: c.addedAt ?? Date.now(),
              typeLine: c.typeLine,
              colorIdentity: c.colorIdentity,
              cmc: c.cmc,
              manaCost: c.manaCost,
              rarity: c.rarity,
              imageUrl: c.imageUrl,
              edhrecRank: c.edhrecRank,
            });
          } else {
            await db.cards.update(key, {
              quantity: Math.max(existing.quantity, c.quantity),
              typeLine: existing.typeLine ?? c.typeLine,
              colorIdentity: existing.colorIdentity ?? c.colorIdentity,
              cmc: existing.cmc ?? c.cmc,
              manaCost: existing.manaCost ?? c.manaCost,
              rarity: existing.rarity ?? c.rarity,
              imageUrl: existing.imageUrl ?? c.imageUrl,
              edhrecRank: existing.edhrecRank ?? c.edhrecRank,
            });
          }
        }
      });
    }
    summary.collectionCardsImported = env.data.collection.length;
  }

  // ── Preferences ──────────────────────────────────────────────────────
  if (plan.preferences !== 'skip' && env.data.preferences) {
    const p = env.data.preferences;
    let applied = 0;

    if (plan.preferences === 'replace') {
      // Clear in-scope preference keys, then write file values for keys present.
      for (const key of Object.values(STORAGE_KEYS)) {
        if (key === STORAGE_KEYS.userLists) continue; // lists handled above
        localStorage.removeItem(key);
      }
      if (p.bannedCards) { localStorage.setItem(STORAGE_KEYS.bannedCards, JSON.stringify(p.bannedCards)); applied++; }
      if (p.mustIncludeCards) { localStorage.setItem(STORAGE_KEYS.mustIncludeCards, JSON.stringify(p.mustIncludeCards)); applied++; }
      if (p.currency !== undefined) { localStorage.setItem(STORAGE_KEYS.currency, p.currency); applied++; }
      if (p.banLists) { localStorage.setItem(STORAGE_KEYS.banLists, JSON.stringify(p.banLists)); applied++; }
      if (p.appliedIncludeLists) { localStorage.setItem(STORAGE_KEYS.appliedIncludeLists, JSON.stringify(p.appliedIncludeLists)); applied++; }
      if (p.appliedExcludeLists) { localStorage.setItem(STORAGE_KEYS.appliedExcludeLists, JSON.stringify(p.appliedExcludeLists)); applied++; }
      if (p.arenaOnly !== undefined) { localStorage.setItem(STORAGE_KEYS.arenaOnly, String(p.arenaOnly)); applied++; }
      if (p.eaFeaturesEnabled !== undefined) { localStorage.setItem(STORAGE_KEYS.eaFeaturesEnabled, String(p.eaFeaturesEnabled)); applied++; }
    } else {
      // merge
      if (p.bannedCards) { applied += mergeStringArray(STORAGE_KEYS.bannedCards, p.bannedCards) ? 1 : 0; }
      if (p.mustIncludeCards) { applied += mergeStringArray(STORAGE_KEYS.mustIncludeCards, p.mustIncludeCards) ? 1 : 0; }
      if (p.currency !== undefined) {
        // scalar: only write if not already set; file does NOT overwrite local scalar on merge
        if (localStorage.getItem(STORAGE_KEYS.currency) === null) {
          localStorage.setItem(STORAGE_KEYS.currency, p.currency);
        }
        applied++;
      }
      if (p.banLists) { applied += mergeObjectArray(STORAGE_KEYS.banLists, p.banLists, l => l.id) ? 1 : 0; }
      if (p.appliedIncludeLists) {
        applied += mergeObjectArray(STORAGE_KEYS.appliedIncludeLists, p.appliedIncludeLists, l => l.listId) ? 1 : 0;
      }
      if (p.appliedExcludeLists) {
        applied += mergeObjectArray(STORAGE_KEYS.appliedExcludeLists, p.appliedExcludeLists, l => l.listId) ? 1 : 0;
      }
      if (p.arenaOnly !== undefined) {
        if (localStorage.getItem(STORAGE_KEYS.arenaOnly) === null) {
          localStorage.setItem(STORAGE_KEYS.arenaOnly, String(p.arenaOnly));
        }
        applied++;
      }
      if (p.eaFeaturesEnabled !== undefined) {
        if (localStorage.getItem(STORAGE_KEYS.eaFeaturesEnabled) === null) {
          localStorage.setItem(STORAGE_KEYS.eaFeaturesEnabled, String(p.eaFeaturesEnabled));
        }
        applied++;
      }
    }

    summary.preferencesApplied = applied;
  }

  return summary;
}

// ─── Local helpers ──────────────────────────────────────────────────────
function readLocalLists(): UserCardList[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.userLists);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mergeStringArray(key: string, incoming: string[]): boolean {
  try {
    const raw = localStorage.getItem(key);
    const existing: string[] = raw ? JSON.parse(raw) : [];
    const merged = Array.from(new Set([...(Array.isArray(existing) ? existing : []), ...incoming]));
    localStorage.setItem(key, JSON.stringify(merged));
    return true;
  } catch {
    return false;
  }
}

function mergeObjectArray<T>(key: string, incoming: T[], idOf: (item: T) => string): boolean {
  try {
    const raw = localStorage.getItem(key);
    const existing: T[] = raw ? JSON.parse(raw) : [];
    const arr = Array.isArray(existing) ? existing : [];
    const existingIds = new Set(arr.map(idOf));
    const toAdd = incoming.filter(i => !existingIds.has(idOf(i)));
    localStorage.setItem(key, JSON.stringify([...arr, ...toAdd]));
    return true;
  } catch {
    return false;
  }
}
