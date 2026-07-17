import { useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  bulkImport as dbBulkImport,
  removeCard as dbRemoveCard,
  updateQuantity as dbUpdateQuantity,
  clearBinder,
  getCardsForBinder,
  getAllCardsMerged,
  getCardsNeedingEnrichment,
  bulkUpdateMetadata,
  ALL_BINDERS_ID,
} from '@/services/collection/db';
import { getCardsByNames, getCardImageUrl } from '@/services/scryfall/client';
import type { CollectionCard, BulkImportCard } from '@/services/collection/db';

/**
 * @param binderId Scope: a specific binder id, or ALL_BINDERS_ID (default) to merge
 * every binder's cards by name with summed quantities.
 */
export function useCollection(binderId: string = ALL_BINDERS_ID) {
  const cards = useLiveQuery(
    () => binderId === ALL_BINDERS_ID ? getAllCardsMerged() : getCardsForBinder(binderId),
    [binderId]
  );
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState('');

  // Count cards missing metadata (global — metadata doesn't vary by binder)
  const needsEnrichment = useLiveQuery(async () => (await getCardsNeedingEnrichment()).length);

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
          edhrecRank: card.edhrec_rank,
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
    count: cards?.length ?? 0,
    isLoading: cards === undefined,
    needsEnrichment: needsEnrichment ?? 0,
    isEnriching,
    enrichProgress,
    enrichCollection,
    bulkImport: (cards: BulkImportCard[]) => dbBulkImport(binderId, cards),
    removeCard: (name: string) => dbRemoveCard(binderId, name),
    updateQuantity: (name: string, qty: number) => dbUpdateQuantity(binderId, name, qty),
    clearCollection: () => clearBinder(binderId),
  };
}
