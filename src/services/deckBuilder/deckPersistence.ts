import Dexie, { type Table } from 'dexie';
import type { GeneratedDeck, DeckHistoryEntry } from '@/types';

export interface SavedDeckRow {
  id: string;
  commanderName: string;
  updatedAt: number;
  createdAt: number;
  deck: GeneratedDeck;
  history: DeckHistoryEntry[];
}

class DeckPersistenceDB extends Dexie {
  decks!: Table<SavedDeckRow, string>;

  constructor() {
    super('mtg-deck-persistence');
    this.version(1).stores({
      decks: 'id, updatedAt',
    });
  }
}

export const deckDB = new DeckPersistenceDB();

const ACTIVE_DECK_ID_KEY = 'mtg-deck-builder-active-deck-id';

/** The saved-deck row id the app is currently auto-saving to/restoring from. */
export function loadActiveDeckId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_DECK_ID_KEY);
  } catch {
    return null;
  }
}

export function saveActiveDeckId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_DECK_ID_KEY, id);
    else localStorage.removeItem(ACTIVE_DECK_ID_KEY);
  } catch (e) {
    console.warn('Failed to persist active deck id:', e);
  }
}

/** Fire-and-forget upsert of the active deck's snapshot (deck + change log). */
export async function saveDeckSnapshot(
  id: string,
  commanderName: string,
  deck: GeneratedDeck,
  history: DeckHistoryEntry[],
): Promise<void> {
  try {
    const existing = await deckDB.decks.get(id);
    const now = Date.now();
    await deckDB.decks.put({
      id,
      commanderName,
      deck,
      history,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  } catch (e) {
    console.warn('Failed to save deck snapshot:', e);
  }
}

export async function loadDeckSnapshot(id: string): Promise<SavedDeckRow | undefined> {
  try {
    return await deckDB.decks.get(id);
  } catch (e) {
    console.warn('Failed to load deck snapshot:', e);
    return undefined;
  }
}

export async function deleteDeckSnapshot(id: string): Promise<void> {
  try {
    await deckDB.decks.delete(id);
  } catch (e) {
    console.warn('Failed to delete deck snapshot:', e);
  }
}
