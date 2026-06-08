import {
  CURRENT_SCHEMA_VERSION,
  MigrationError,
  migrateForward,
  type MigrationEnvelope,
  type MigrationData,
  type MigrationPreferences,
} from './schema';
import type { UserCardList, BanList, AppliedList } from '@/types';
import type { CollectionCard } from '@/services/collection/db';

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
