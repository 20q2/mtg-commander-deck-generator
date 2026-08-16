import type { DeckHistoryEntry } from '@/types';

// Deck edit history, persisted per deck so leaving a list and coming back
// doesn't lose the trail of what you changed. Keyed by the user list's id —
// commander name is too coarse, since two lists can share a commander.
//
// Generated decks are deliberately excluded: they have no stable id and are
// ephemeral by design, so their history stays in memory only.

const STORAGE_KEY = 'mtg-deck-history-v1';

/** Matches the in-memory cap the store already applied. */
export const MAX_ENTRIES_PER_DECK = 50;

/** Bounds total storage — oldest-touched decks are evicted first. */
const MAX_DECKS = 25;

type HistoryMap = Record<string, DeckHistoryEntry[]>;

function isEntry(value: unknown): value is DeckHistoryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Partial<DeckHistoryEntry>;
  return typeof e.id === 'string'
    && typeof e.action === 'string'
    && typeof e.cardName === 'string'
    && typeof e.timestamp === 'number';
}

/**
 * Reads the whole map, discarding anything that doesn't match the current
 * shape. A malformed blob costs a user their history, not a crash on boot.
 */
function readMap(): HistoryMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

    const out: HistoryMap = {};
    for (const [deckId, entries] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(entries)) continue;
      const valid = entries.filter(isEntry);
      if (valid.length > 0) out[deckId] = valid;
    }
    return out;
  } catch {
    return {};
  }
}

function newestTimestamp(entries: DeckHistoryEntry[]): number {
  return entries.reduce((max, e) => (e.timestamp > max ? e.timestamp : max), 0);
}

function writeMap(map: HistoryMap): void {
  try {
    const deckIds = Object.keys(map);
    let pruned = map;

    if (deckIds.length > MAX_DECKS) {
      const keep = deckIds
        .sort((a, b) => newestTimestamp(map[b]) - newestTimestamp(map[a]))
        .slice(0, MAX_DECKS);
      pruned = Object.fromEntries(keep.map(id => [id, map[id]]));
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
  } catch {
    // Quota exceeded or storage unavailable (private mode) — history is a
    // convenience, so degrade to in-memory rather than surfacing an error.
  }
}

export function loadHistoryFor(deckId: string): DeckHistoryEntry[] {
  return readMap()[deckId] ?? [];
}

export function saveHistoryFor(deckId: string, entries: DeckHistoryEntry[]): void {
  const map = readMap();
  if (entries.length === 0) {
    if (!(deckId in map)) return;
    delete map[deckId];
  } else {
    map[deckId] = entries.slice(0, MAX_ENTRIES_PER_DECK);
  }
  writeMap(map);
}

export function dropHistoryFor(deckId: string): void {
  const map = readMap();
  if (!(deckId in map)) return;
  delete map[deckId];
  writeMap(map);
}
