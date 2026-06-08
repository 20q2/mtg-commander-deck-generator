import type { UserCardList, BanList, AppliedList } from '@/types';
import type { CollectionCard } from '@/services/collection/db';

export const CURRENT_SCHEMA_VERSION = 1;

// ─── localStorage key registry ──────────────────────────────────────────
// Canonical list of keys included in migration files. Keep in sync with
// preference loaders in src/store/index.ts and src/App.tsx.
export const STORAGE_KEYS = {
  userLists: 'mtg-deck-builder-user-lists',
  bannedCards: 'mtg-deck-builder-banned-cards',
  mustIncludeCards: 'mtg-deck-builder-must-include-cards',
  currency: 'mtg-deck-builder-currency',
  banLists: 'mtg-deck-builder-ban-lists',
  appliedIncludeLists: 'mtg-deck-builder-applied-include-lists',
  appliedExcludeLists: 'mtg-deck-builder-applied-exclude-lists',
  arenaOnly: 'mtg-deck-builder-arena-only',
  eaFeaturesEnabled: 'ea-features-enabled',
} as const;

// ─── Envelope types ─────────────────────────────────────────────────────
export interface MigrationPreferences {
  bannedCards: string[];
  mustIncludeCards: string[];
  currency: string;
  banLists: BanList[];
  appliedIncludeLists: AppliedList[];
  appliedExcludeLists: AppliedList[];
  arenaOnly: boolean;
  eaFeaturesEnabled: boolean;
}

export interface MigrationData {
  lists?: UserCardList[];
  collection?: CollectionCard[];
  preferences?: Partial<MigrationPreferences>;
}

export interface MigrationEnvelope {
  schemaVersion: number;
  exportedAt: string;       // ISO 8601
  sourceHost: string;       // location.hostname at export time
  appVersion: string;       // __APP_VERSION__ at export time
  data: MigrationData;
}

// ─── Errors ─────────────────────────────────────────────────────────────
export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

// ─── Forward migrations ─────────────────────────────────────────────────
// When the schema needs a breaking change, bump CURRENT_SCHEMA_VERSION
// and add an entry here that transforms v(N) data into v(N+1) data.
// Pure functions only — no I/O, no side effects.
export const migrations: Record<number, (data: any) => any> = {};

export function migrateForward(envelope: MigrationEnvelope): MigrationEnvelope {
  let { data } = envelope;
  let version = envelope.schemaVersion;
  while (version < CURRENT_SCHEMA_VERSION) {
    const migrate = migrations[version];
    if (!migrate) {
      throw new MigrationError(
        `No migration registered from schema v${version} to v${version + 1}.`
      );
    }
    data = migrate(data);
    version++;
  }
  return { ...envelope, data, schemaVersion: version };
}
