import { useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, bulkImport, removeCard, updateQuantity, clearCollection, getCardsNeedingEnrichment, bulkUpdateMetadata } from '@/services/collection/db';
import { getCardsByNames, getCardImageUrl } from '@/services/scryfall/client';
import type { CollectionCard } from '@/services/collection/db';

export function useCollection() {
  const cards = useLiveQuery(() => db.cards.orderBy('addedAt').reverse().toArray());
  const count = useLiveQuery(() => db.cards.count());
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState('');

  // Count cards missing metadata
  const needsEnrichment = useLiveQuery(async () => {
    const all = await db.cards.toArray();
    return all.filter(c => !c.typeLine).length;
  });

  const enrichCollection = useCallback(async () => {
    setIsEnriching(true);
    try {
      const names = await getCardsNeedingEnrichment();
      if (names.length === 0) return;

      setEnrichProgress(`Fetching data for ${names.length} cards...`);

      const cardMap = await getCardsByNames(names, (fetched, total) => {
        setEnrichProgress(`Fetching card data... ${fetched}/${total}`);
      });

      const updates = [];
      for (const [name, card] of cardMap) {
        updates.push({
          name,
          typeLine: card.type_line,
          colorIdentity: card.color_identity,
          cmc: card.cmc,
          manaCost: card.mana_cost,
          rarity: card.rarity,
          imageUrl: getCardImageUrl(card, 'small'),
        });
      }

      if (updates.length > 0) {
        setEnrichProgress(`Saving metadata for ${updates.length} cards...`);
        await bulkUpdateMetadata(updates);
      }
    } catch (error) {
      console.error('Enrichment failed:', error);
    } finally {
      setIsEnriching(false);
      setEnrichProgress('');
    }
  }, []);

  return {
    cards: cards ?? [] as CollectionCard[],
    count: count ?? 0,
    isLoading: cards === undefined,
    needsEnrichment: needsEnrichment ?? 0,
    isEnriching,
    enrichProgress,
    enrichCollection,
    bulkImport,
    removeCard,
    updateQuantity,
    clearCollection,
  };
}
