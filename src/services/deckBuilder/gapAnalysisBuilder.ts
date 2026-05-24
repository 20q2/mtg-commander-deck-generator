// src/services/deckBuilder/gapAnalysisBuilder.ts
import type {
  GapAnalysisCard,
  EDHRECCommanderData,
  EDHRECCard,
} from '@/types';
import { getCardsByNames, getCardPrice } from '../scryfall/client';
import { getCardRole } from '../tagger/client';
import { ROLE_LABELS } from './roleTargets';

const TOP_N_GAP_CANDIDATES = 40;

export interface BuildGapAnalysisInputs {
  edhrecData: EDHRECCommanderData;
  /** Set of card names already in the deck (including commander; DFC front-face names should also be included). */
  deckCardNames: Set<string>;
  /** Optional banned names to exclude from gap suggestions. */
  bannedNames?: Set<string>;
  /** Currency for price lookup. */
  currency?: 'USD' | 'EUR';
  /** Optional collection name set for marking isOwned. */
  collectionNames?: Set<string>;
}

export async function buildGapAnalysis(inputs: BuildGapAnalysisInputs): Promise<GapAnalysisCard[]> {
  const { edhrecData, deckCardNames, bannedNames, currency = 'USD', collectionNames } = inputs;

  const candidates = edhrecData.cardlists.allNonLand
    .filter((c: EDHRECCard) => !deckCardNames.has(c.name) && !(bannedNames?.has(c.name) ?? false))
    .sort((a: EDHRECCard, b: EDHRECCard) => (b.inclusion ?? 0) - (a.inclusion ?? 0))
    .slice(0, TOP_N_GAP_CANDIDATES);

  if (candidates.length === 0) return [];

  const scryMap = await getCardsByNames(candidates.map((c: EDHRECCard) => c.name));

  return candidates
    .map((c: EDHRECCard) => {
      const scry = scryMap.get(c.name);
      const role = getCardRole(c.name) || undefined;
      return {
        name: c.name,
        price: scry ? getCardPrice(scry, currency) : null,
        inclusion: c.inclusion,
        synergy: c.synergy ?? 0,
        typeLine: scry?.type_line ?? '',
        cmc: scry?.cmc,
        imageUrl: scry?.image_uris?.small,
        isOwned: collectionNames?.has(c.name) ?? undefined,
        role,
        roleLabel: role ? ROLE_LABELS[role] : undefined,
      } as GapAnalysisCard;
    })
    .filter((g: GapAnalysisCard) => g.price !== null);
}
