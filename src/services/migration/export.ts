import { db } from '@/services/collection/db';
import {
  CURRENT_SCHEMA_VERSION,
  STORAGE_KEYS,
  type MigrationEnvelope,
  type MigrationPreferences,
} from './schema';
import type { UserCardList, BanList, AppliedList } from '@/types';
import type { CollectionCard } from '@/services/collection/db';

// ─── Helpers ────────────────────────────────────────────────────────────
function readJson<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return undefined;
  }
}

function readString(key: string): string | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : raw;
  } catch {
    return undefined;
  }
}

function readBool(key: string): boolean | undefined {
  const raw = readString(key);
  if (raw === undefined) return undefined;
  return raw === 'true';
}

// ─── Public API ─────────────────────────────────────────────────────────
export async function buildExportEnvelope(): Promise<MigrationEnvelope> {
  // Lists
  const lists = readJson<UserCardList[]>(STORAGE_KEYS.userLists);

  // Collection
  const collection: CollectionCard[] = await db.cards.toArray();

  // Preferences — only include keys actually present in localStorage.
  // Use a typed partial so absent keys are simply omitted.
  const preferences: Partial<MigrationPreferences> = {};

  const bannedCards = readJson<string[]>(STORAGE_KEYS.bannedCards);
  if (Array.isArray(bannedCards)) preferences.bannedCards = bannedCards;

  const mustIncludeCards = readJson<string[]>(STORAGE_KEYS.mustIncludeCards);
  if (Array.isArray(mustIncludeCards)) preferences.mustIncludeCards = mustIncludeCards;

  const currency = readString(STORAGE_KEYS.currency);
  if (currency !== undefined) preferences.currency = currency;

  const banLists = readJson<BanList[]>(STORAGE_KEYS.banLists);
  if (Array.isArray(banLists)) preferences.banLists = banLists;

  const appliedIncludeLists = readJson<AppliedList[]>(STORAGE_KEYS.appliedIncludeLists);
  if (Array.isArray(appliedIncludeLists)) preferences.appliedIncludeLists = appliedIncludeLists;

  const appliedExcludeLists = readJson<AppliedList[]>(STORAGE_KEYS.appliedExcludeLists);
  if (Array.isArray(appliedExcludeLists)) preferences.appliedExcludeLists = appliedExcludeLists;

  const arenaOnly = readBool(STORAGE_KEYS.arenaOnly);
  if (arenaOnly !== undefined) preferences.arenaOnly = arenaOnly;

  const eaFeaturesEnabled = readBool(STORAGE_KEYS.eaFeaturesEnabled);
  if (eaFeaturesEnabled !== undefined) preferences.eaFeaturesEnabled = eaFeaturesEnabled;

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sourceHost: typeof window !== 'undefined' ? window.location.hostname : 'unknown',
    appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown',
    data: {
      lists: lists && lists.length > 0 ? lists : undefined,
      collection: collection.length > 0 ? collection : undefined,
      preferences: Object.keys(preferences).length > 0 ? preferences : undefined,
    },
  };
}

export async function hasAnythingToExport(): Promise<boolean> {
  const env = await buildExportEnvelope();
  return !!(env.data.lists || env.data.collection || env.data.preferences);
}

export async function downloadBackup(): Promise<void> {
  const envelope = await buildExportEnvelope();
  const json = JSON.stringify(envelope, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const a = document.createElement('a');
  a.href = url;
  a.download = `manafoundry-backup-${today}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Defer revoke so the browser has time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
