// Builds a synthetic GeneratedDeck from a raw list of card names + commander.
// Mirrors the pattern used in ListDeckView's `buildAndSetDeck`.

import { getCardsByNames, getFrontFaceTypeLine } from '@/services/scryfall/client';
import { enrichDeckCards } from '@/services/deckBuilder/deckEnricher';
import { fetchCommanderCombos } from '@/services/edhrec/client';
import type { GeneratedDeck, DeckStats, DetectedCombo, ScryfallCard } from '@/types';

// Combo detection helper — inlined here (and duplicated in ListDeckView.tsx today).
// Extracting it to a shared module is out of scope for this feature; the function
// is small and self-contained.
function detectCombosInDeck(
  combos: { comboId: string; cards: { name: string; id: string }[]; results: string[]; deckCount: number; bracket: string }[],
  allCardNames: Set<string>,
  commanderCard: ScryfallCard | null,
  partnerCard: ScryfallCard | null,
): DetectedCombo[] | undefined {
  if (combos.length === 0) return undefined;

  const detected = combos
    .map(combo => {
      const comboCardNames = combo.cards.map(c => c.name);
      const missingCards = comboCardNames.filter(name => !allCardNames.has(name));
      return {
        comboId: combo.comboId,
        cards: comboCardNames,
        results: combo.results,
        isComplete: missingCards.length === 0,
        missingCards,
        deckCount: combo.deckCount,
        bracket: combo.bracket,
      };
    })
    .filter(dc => dc.isComplete || dc.missingCards.length <= 2);

  const commanderNames = new Set<string>();
  if (commanderCard) {
    commanderNames.add(commanderCard.name);
    if (commanderCard.name.includes(' // ')) commanderNames.add(commanderCard.name.split(' // ')[0]);
  }
  if (partnerCard) {
    commanderNames.add(partnerCard.name);
    if (partnerCard.name.includes(' // ')) commanderNames.add(partnerCard.name.split(' // ')[0]);
  }

  detected.sort((a, b) => {
    if (a.isComplete !== b.isComplete) return a.isComplete ? -1 : 1;
    const aHasCommander = a.cards.some(n => commanderNames.has(n));
    const bHasCommander = b.cards.some(n => commanderNames.has(n));
    if (aHasCommander !== bHasCommander) return aHasCommander ? -1 : 1;
    return b.deckCount - a.deckCount;
  });

  return detected.length > 0 ? detected : undefined;
}

export type HydrateStage = 'fetching-cards' | 'detecting-combos' | 'analyzing-roles' | 'done';

export interface HydrateDeckInput {
  cardNames: string[];
  commanderName?: string;
  partnerCommanderName?: string;
  deckSize?: number;
  onProgress?: (stage: HydrateStage) => void;
}

export interface HydrateDeckResult {
  deck: GeneratedDeck;
  colorIdentity: string[];
}

function computeStatsFromCards(allCards: ScryfallCard[]): DeckStats {
  const nonLandCards = allCards.filter(
    card => !getFrontFaceTypeLine(card).toLowerCase().includes('land'),
  );

  const manaCurve: Record<number, number> = {};
  nonLandCards.forEach(card => {
    const cmc = Math.min(Math.floor(card.cmc), 7);
    manaCurve[cmc] = (manaCurve[cmc] || 0) + 1;
  });

  const totalCmc = nonLandCards.reduce((sum, card) => sum + card.cmc, 0);
  const averageCmc = nonLandCards.length > 0 ? totalCmc / nonLandCards.length : 0;

  const colorDistribution: Record<string, number> = {};
  allCards.forEach(card => {
    const colors = card.colors || [];
    if (colors.length === 0) {
      colorDistribution['C'] = (colorDistribution['C'] || 0) + 1;
    } else {
      colors.forEach(color => {
        colorDistribution[color] = (colorDistribution[color] || 0) + 1;
      });
    }
  });

  const typeDistribution: Record<string, number> = { Planeswalker: 0 };
  allCards.forEach(card => {
    const typeLine = getFrontFaceTypeLine(card).toLowerCase();
    if (typeLine.includes('land')) typeDistribution['Land'] = (typeDistribution['Land'] || 0) + 1;
    else if (typeLine.includes('creature')) typeDistribution['Creature'] = (typeDistribution['Creature'] || 0) + 1;
    else if (typeLine.includes('instant')) typeDistribution['Instant'] = (typeDistribution['Instant'] || 0) + 1;
    else if (typeLine.includes('sorcery')) typeDistribution['Sorcery'] = (typeDistribution['Sorcery'] || 0) + 1;
    else if (typeLine.includes('artifact')) typeDistribution['Artifact'] = (typeDistribution['Artifact'] || 0) + 1;
    else if (typeLine.includes('enchantment')) typeDistribution['Enchantment'] = (typeDistribution['Enchantment'] || 0) + 1;
    else if (typeLine.includes('planeswalker')) typeDistribution['Planeswalker'] = (typeDistribution['Planeswalker'] || 0) + 1;
    else if (typeLine.includes('battle')) typeDistribution['Battle'] = (typeDistribution['Battle'] || 0) + 1;
  });

  return {
    totalCards: allCards.length,
    averageCmc: Math.round(averageCmc * 100) / 100,
    manaCurve,
    colorDistribution,
    typeDistribution,
  };
}

export async function hydrateDeckForAnalysis(input: HydrateDeckInput): Promise<HydrateDeckResult> {
  const { cardNames, commanderName, partnerCommanderName, onProgress } = input;
  onProgress?.('fetching-cards');
  const cardMap = await getCardsByNames(cardNames);
  const cards: ScryfallCard[] = [];
  for (const name of cardNames) {
    const c = cardMap.get(name);
    if (c) cards.push(c);
  }

  const commanderCard: ScryfallCard | null = commanderName ? cardMap.get(commanderName) ?? null : null;
  const partnerCard: ScryfallCard | null = partnerCommanderName ? cardMap.get(partnerCommanderName) ?? null : null;

  const commanderNames = new Set<string>();
  if (commanderCard) commanderNames.add(commanderCard.name);
  if (partnerCard) commanderNames.add(partnerCard.name);

  const deckCards = commanderNames.size > 0
    ? cards.filter(c => !commanderNames.has(c.name))
    : cards;

  const stats = computeStatsFromCards(deckCards);

  const allDeckNames = new Set<string>();
  if (commanderCard) {
    allDeckNames.add(commanderCard.name);
    if (commanderCard.name.includes(' // ')) allDeckNames.add(commanderCard.name.split(' // ')[0]);
  }
  if (partnerCard) {
    allDeckNames.add(partnerCard.name);
    if (partnerCard.name.includes(' // ')) allDeckNames.add(partnerCard.name.split(' // ')[0]);
  }
  for (const c of deckCards) {
    allDeckNames.add(c.name);
    if (c.name.includes(' // ')) allDeckNames.add(c.name.split(' // ')[0]);
  }

  let detectedCombos: DetectedCombo[] | undefined;
  if (commanderCard) {
    onProgress?.('detecting-combos');
    try {
      const combos = await fetchCommanderCombos(commanderCard.name);
      detectedCombos = detectCombosInDeck(combos, allDeckNames, commanderCard, partnerCard);
    } catch {
      // Combo fetch failed — not critical
    }
  }

  onProgress?.('analyzing-roles');
  const enrichResult = await enrichDeckCards(
    deckCards,
    input.deckSize ?? cardNames.length,
    detectedCombos,
    commanderCard?.name,
    partnerCard?.name,
  );

  const deck: GeneratedDeck = {
    commander: commanderCard,
    partnerCommander: partnerCard,
    categories: enrichResult.categories,
    stats,
    detectedCombos,
    roleCounts: enrichResult.roleCounts,
    roleTargets: enrichResult.roleTargets,
    rampSubtypeCounts: enrichResult.rampSubtypeCounts,
    removalSubtypeCounts: enrichResult.removalSubtypeCounts,
    boardwipeSubtypeCounts: enrichResult.boardwipeSubtypeCounts,
    cardDrawSubtypeCounts: enrichResult.cardDrawSubtypeCounts,
    bracketEstimation: enrichResult.bracketEstimation,
    gameChangerNames: enrichResult.gameChangerNames,
    cardInclusionMap: enrichResult.cardInclusionMap,
    cardSynergyMap: enrichResult.cardSynergyMap,
    cardRelevancyMap: enrichResult.cardRelevancyMap,
    deckScore: enrichResult.deckScore,
    gapAnalysis: enrichResult.gapAnalysis,
  };

  const allColors = new Set<string>();
  for (const card of cards) {
    for (const c of card.color_identity || []) allColors.add(c);
  }
  const colorIdentity = ['W', 'U', 'B', 'R', 'G'].filter(c => allColors.has(c));

  onProgress?.('done');
  return { deck, colorIdentity };
}
