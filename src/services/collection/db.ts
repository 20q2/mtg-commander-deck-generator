import Dexie, { type Table } from 'dexie';

export interface Binder {
  id: string;
  name: string;
  order: number;
  createdAt: number;
}

export const DEFAULT_BINDER_ID = 'default';
export const ALL_BINDERS_ID = 'all';

export interface CollectionCard {
  binderId: string;   // FK into `binders`
  name: string;        // Canonical Scryfall card name
  quantity: number;
  addedAt: number;     // Date.now() timestamp
  // Card metadata (populated during import, backfilled via enrichCollection)
  typeLine?: string;
  colorIdentity?: string[];
  cmc?: number;
  manaCost?: string;
  rarity?: string;
  imageUrl?: string;
  edhrecRank?: number;
}

class CollectionDB extends Dexie {
  cards!: Table<CollectionCard, [string, string]>;
  binders!: Table<Binder, string>;

  constructor() {
    super('mtg-collection');
    this.version(1).stores({
      cards: 'name, addedAt',
    });
    // v2: same indexes, but CollectionCard now has optional metadata fields
    this.version(2).stores({
      cards: 'name, addedAt',
    });
    // v3: cards move to a compound [binderId+name] key so the same card name can hold
    // an independent quantity per binder. Dexie doesn't support changing a table's primary
    // key in place, so the old `cards` store (keyed by name) is dropped and replaced by a
    // new `cardEntries` store (keyed by [binderId+name]); existing rows are migrated into a
    // new default binder. The `cards` property is rebound below so the rest of the app can
    // keep referring to `db.cards` unchanged.
    this.version(3).stores({
      cards: null,
      cardEntries: '[binderId+name], binderId, name, addedAt',
      binders: 'id, order, createdAt',
    }).upgrade(async tx => {
      const oldCards = await tx.table('cards').toArray();
      const defaultBinder: Binder = {
        id: DEFAULT_BINDER_ID,
        name: 'My Collection',
        order: 0,
        createdAt: Date.now(),
      };
      await tx.table('binders').add(defaultBinder);
      const cardEntries = tx.table('cardEntries');
      for (const c of oldCards) {
        await cardEntries.add({ ...c, binderId: defaultBinder.id });
      }
    });

    this.cards = this.table('cardEntries');
  }
}

export const db = new CollectionDB();

export interface BulkImportCard {
  name: string;
  quantity: number;
  typeLine?: string;
  colorIdentity?: string[];
  cmc?: number;
  manaCost?: string;
  rarity?: string;
  imageUrl?: string;
  edhrecRank?: number;
}

/** Bulk upsert cards into one binder. Returns add/update counts. */
export async function bulkImport(
  binderId: string,
  cards: BulkImportCard[]
): Promise<{ added: number; updated: number }> {
  let added = 0;
  let updated = 0;

  await db.transaction('rw', db.cards, async () => {
    for (const card of cards) {
      const key: [string, string] = [binderId, card.name];
      const existing = await db.cards.get(key);
      if (existing) {
        await db.cards.update(key, {
          quantity: existing.quantity + card.quantity,
          addedAt: Date.now(),
          typeLine: card.typeLine ?? existing.typeLine,
          colorIdentity: card.colorIdentity ?? existing.colorIdentity,
          cmc: card.cmc ?? existing.cmc,
          manaCost: card.manaCost ?? existing.manaCost,
          rarity: card.rarity ?? existing.rarity,
          imageUrl: card.imageUrl ?? existing.imageUrl,
          edhrecRank: card.edhrecRank ?? existing.edhrecRank,
        });
        updated++;
      } else {
        await db.cards.add({
          binderId,
          name: card.name,
          quantity: card.quantity,
          addedAt: Date.now(),
          typeLine: card.typeLine,
          colorIdentity: card.colorIdentity,
          cmc: card.cmc,
          manaCost: card.manaCost,
          rarity: card.rarity,
          imageUrl: card.imageUrl,
          edhrecRank: card.edhrecRank,
        });
        added++;
      }
    }
  });

  return { added, updated };
}

/** Names (deduped across binders) that are missing metadata. */
export async function getCardsNeedingEnrichment(): Promise<string[]> {
  const all = await db.cards.toArray();
  const names = new Set<string>();
  for (const c of all) {
    if (!c.typeLine) names.add(c.name);
  }
  return [...names];
}

/** Update metadata for cards in bulk (used during enrichment). Applies to every
 *  binder that holds a card with this name, since metadata doesn't vary by binder. */
export async function bulkUpdateMetadata(
  updates: Array<{ name: string; typeLine: string; colorIdentity: string[]; cmc: number; manaCost?: string; rarity: string; imageUrl?: string; edhrecRank?: number }>
): Promise<number> {
  let count = 0;
  await db.transaction('rw', db.cards, async () => {
    for (const u of updates) {
      const rows = await db.cards.where('name').equals(u.name).toArray();
      for (const row of rows) {
        await db.cards.update([row.binderId, row.name], {
          typeLine: u.typeLine,
          colorIdentity: u.colorIdentity,
          cmc: u.cmc,
          manaCost: u.manaCost,
          rarity: u.rarity,
          imageUrl: u.imageUrl,
          edhrecRank: u.edhrecRank,
        });
        count++;
      }
    }
  });
  return count;
}

export async function removeCard(binderId: string, name: string): Promise<void> {
  await db.cards.delete([binderId, name]);
}

export async function updateQuantity(binderId: string, name: string, quantity: number): Promise<void> {
  if (quantity <= 0) {
    await db.cards.delete([binderId, name]);
  } else {
    await db.cards.update([binderId, name], { quantity });
  }
}

/** Clears every card from one binder (the binder itself is not deleted). */
export async function clearBinder(binderId: string): Promise<void> {
  await db.cards.where('binderId').equals(binderId).delete();
}

export async function getCollectionSize(binderId?: string): Promise<number> {
  if (binderId) return db.cards.where('binderId').equals(binderId).count();
  return db.cards.count();
}

/** Returns a Set<string> of owned card names, optionally scoped to a subset of binders
 *  (undefined/omitted = every binder). For double-faced cards (e.g. "Kessig Naturalist //
 *  Lord of the Ulvenwald"), the set includes both the full name and the front-face name so
 *  that EDHREC's front-face-only names match correctly. */
export async function getCollectionNameSet(binderIds?: string[]): Promise<Set<string>> {
  const allCards = binderIds
    ? await db.cards.where('binderId').anyOf(binderIds).toArray()
    : await db.cards.toArray();
  const names = new Set<string>();
  for (const c of allCards) {
    names.add(c.name);
    if (c.name.includes(' // ')) {
      names.add(c.name.split(' // ')[0]);
    }
  }
  return names;
}

export async function getCardsForBinder(binderId: string): Promise<CollectionCard[]> {
  const cards = await db.cards.where('binderId').equals(binderId).toArray();
  return cards.sort((a, b) => b.addedAt - a.addedAt);
}

/** Merges cards by name (summing quantities) across the given binders, or every binder if
 *  omitted, for "All" / multi-binder views. */
export async function getCardsMerged(binderIds?: string[]): Promise<CollectionCard[]> {
  const all = binderIds ? await db.cards.where('binderId').anyOf(binderIds).toArray() : await db.cards.toArray();
  const byName = new Map<string, CollectionCard>();
  for (const c of all) {
    const existing = byName.get(c.name);
    if (existing) {
      existing.quantity += c.quantity;
      existing.addedAt = Math.max(existing.addedAt, c.addedAt);
    } else {
      byName.set(c.name, { ...c, binderId: ALL_BINDERS_ID });
    }
  }
  return [...byName.values()].sort((a, b) => b.addedAt - a.addedAt);
}

/** Merges every binder's cards by name (summing quantities) for the "All" view. */
export async function getAllCardsMerged(): Promise<CollectionCard[]> {
  return getCardsMerged();
}

// --- Binder CRUD ---

export async function getBinders(): Promise<Binder[]> {
  return db.binders.orderBy('order').toArray();
}

export async function createBinder(name: string): Promise<Binder> {
  const existing = await db.binders.toArray();
  const maxOrder = existing.reduce((m, b) => Math.max(m, b.order), -1);
  const binder: Binder = {
    id: crypto.randomUUID(),
    name,
    order: maxOrder + 1,
    createdAt: Date.now(),
  };
  await db.binders.add(binder);
  return binder;
}

export async function renameBinder(id: string, name: string): Promise<void> {
  await db.binders.update(id, { name });
}

/** Deletes a binder and every card inside it. */
export async function deleteBinder(id: string): Promise<void> {
  await db.transaction('rw', db.binders, db.cards, async () => {
    await db.cards.where('binderId').equals(id).delete();
    await db.binders.delete(id);
  });
}
