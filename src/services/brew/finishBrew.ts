import type { GeneratedDeck } from '@/types';
import { generateDeck } from '@/services/deckBuilder/deckGenerator';
import type { BrewContext, BrewState } from './engine';

/**
 * Finish a brew: feed every brewed pick to generateDeck as a must-include, so the
 * existing generator fills the remaining slots (incl. the mana base) around them.
 */
export async function finishBrew(
  ctx: BrewContext,
  state: BrewState,
  onProgress?: (message: string, percent: number) => void,
): Promise<GeneratedDeck> {
  const brewedNames = state.picks.map(p => p.name);
  const customization = {
    ...ctx.customization,
    mustIncludeCards: Array.from(new Set([...(ctx.customization.mustIncludeCards ?? []), ...brewedNames])),
    tempMustIncludeCards: [],
  };
  let collectionNames: Set<string> | undefined;
  if (customization.collectionMode) {
    const { getCollectionNameSet } = await import('@/services/collection/db');
    collectionNames = await getCollectionNameSet();
  }
  const deck = await generateDeck({
    commander: ctx.commander,
    partnerCommander: ctx.partnerCommander,
    colorIdentity: ctx.colorIdentity,
    customization,
    collectionNames,
    onProgress,
  });
  deck.builtFromCollection = !!customization.collectionMode;
  return deck;
}
