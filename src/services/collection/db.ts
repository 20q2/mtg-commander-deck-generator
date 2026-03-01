import Dexie, { type Table } from 'dexie';

export interface CollectionCard {
  name: string;       // Primary key — canonical Scryfall card name
  quantity: number;
  addedAt: number;     // Date.now() timestamp
  // Card metadata (populated during import, backfilled via enrichCollection)
  typeLine?: string;
  colorIdentity?: string[];
  cmc?: number;
  manaCost?: string;
  rarity?: string;
  imageUrl?: string;
}

class CollectionDB extends Dexie {
  cards!: Table<CollectionCard, string>;

  constructor() {
    super('mtg-collection');
    this.version(1).stores({
      cards: 'name, addedAt',
    });
    // v2: same indexes, but CollectionCard now has optional metadata fields
    // Dexie doesn't need new indexes for these — they're just stored properties
    this.version(2).stores({
      cards: 'name, addedAt',
    });
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
}

/** Bulk upsert cards into the collection. Returns add/update counts. */
export async function bulkImport(
  cards: BulkImportCard[]
): Promise<{ added: number; updated: number }> {
  let added = 0;
  let updated = 0;

  await db.transaction('rw', db.cards, async () => {
    for (const card of cards) {
      const existing = await db.cards.get(card.name);
      if (existing) {
        await db.cards.update(card.name, {
          quantity: existing.quantity + card.quantity,
          addedAt: Date.now(),
          typeLine: card.typeLine ?? existing.typeLine,
          colorIdentity: card.colorIdentity ?? existing.colorIdentity,
          cmc: card.cmc ?? existing.cmc,
          manaCost: card.manaCost ?? existing.manaCost,
          rarity: card.rarity ?? existing.rarity,
          imageUrl: card.imageUrl ?? existing.imageUrl,
        });
        updated++;
      } else {
        await db.cards.add({
          name: card.name,
          quantity: card.quantity,
          addedAt: Date.now(),
          typeLine: card.typeLine,
          colorIdentity: card.colorIdentity,
          cmc: card.cmc,
          manaCost: card.manaCost,
          rarity: card.rarity,
          imageUrl: card.imageUrl,
        });
        added++;
      }
    }
  });

  return { added, updated };
}

/** Enrich existing cards that are missing metadata by fetching from Scryfall. */
export async function getCardsNeedingEnrichment(): Promise<string[]> {
  const all = await db.cards.toArray();
  return all.filter(c => !c.typeLine).map(c => c.name);
}

/** Update metadata for cards in bulk (used during enrichment). */
export async function bulkUpdateMetadata(
  updates: Array<{ name: string; typeLine: string; colorIdentity: string[]; cmc: number; manaCost?: string; rarity: string; imageUrl?: string }>
): Promise<number> {
  let count = 0;
  await db.transaction('rw', db.cards, async () => {
    for (const u of updates) {
      await db.cards.update(u.name, {
        typeLine: u.typeLine,
        colorIdentity: u.colorIdentity,
        cmc: u.cmc,
        manaCost: u.manaCost,
        rarity: u.rarity,
        imageUrl: u.imageUrl,
      });
      count++;
    }
  });
  return count;
}

export async function removeCard(name: string): Promise<void> {
  await db.cards.delete(name);
}

export async function updateQuantity(name: string, quantity: number): Promise<void> {
  if (quantity <= 0) {
    await db.cards.delete(name);
  } else {
    await db.cards.update(name, { quantity });
  }
}

export async function clearCollection(): Promise<void> {
  await db.cards.clear();
}

export async function getCollectionSize(): Promise<number> {
  return db.cards.count();
}

/** Returns a Set<string> of all owned card names — used by the deck generator.
 *  For double-faced cards (e.g. "Kessig Naturalist // Lord of the Ulvenwald"),
 *  the set includes both the full name and the front-face name so that
 *  EDHREC's front-face-only names match correctly. */
export async function getCollectionNameSet(): Promise<Set<string>> {
  const allCards = await db.cards.toArray();
  const names = new Set<string>();
  for (const c of allCards) {
    names.add(c.name);
    if (c.name.includes(' // ')) {
      names.add(c.name.split(' // ')[0]);
    }
  }
  return names;
}

export async function getAllCards(): Promise<CollectionCard[]> {
  return db.cards.orderBy('addedAt').reverse().toArray();
}
