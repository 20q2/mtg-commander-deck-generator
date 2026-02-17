import type {
  ScryfallCard,
  GeneratedDeck,
  DeckStats,
  DeckCategory,
  DeckComposition,
  Customization,
  Archetype,
  DeckFormat,
  ThemeResult,
  EDHRECCard,
  EDHRECCommanderData,
  EDHRECCommanderStats,
} from '@/types';
import { searchCards, getCardByName, getCardsByNames, prefetchBasicLands, getCachedCard } from '@/services/scryfall/client';
import { fetchCommanderData, fetchCommanderThemeData } from '@/services/edhrec/client';
import {
  calculateTypeTargets,
  calculateCurveTargets,
  hasCurveRoom,
} from './curveUtils';

interface GenerationContext {
  commander: ScryfallCard;
  partnerCommander: ScryfallCard | null;
  colorIdentity: string[];
  archetype: Archetype;
  customization: Customization;
  selectedThemes?: ThemeResult[];
  onProgress?: (message: string, percent: number) => void;
}

// Check if a card's color identity fits within the commander's color identity
function fitsColorIdentity(card: ScryfallCard, commanderColors: string[]): boolean {
  const cardColors = card.color_identity || [];
  // Every color in the card's identity must be in the commander's identity
  return cardColors.every(color => commanderColors.includes(color));
}

// Return type for calculateTargetCounts
interface TargetCountsResult {
  composition: DeckComposition;
  typeTargets: Record<string, number>;
  curveTargets: Record<number, number>;
}

// Calculate target counts for each category based on EDHREC stats or fallback defaults
function calculateTargetCounts(
  customization: Customization,
  edhrecStats?: EDHRECCommanderStats
): TargetCountsResult {
  const format = customization.deckFormat;

  // Use user's land count preference (allow manual overrides beyond slider range)
  const landCount = Math.max(0, customization.landCount);

  // Calculate total deck cards (commander is separate for 99, included for 40/60)
  const deckCards = format === 99 ? 99 : format - 1;
  const nonLandCards = deckCards - landCount;

  // If we have EDHREC stats, use percentage-based targets
  if (edhrecStats && edhrecStats.numDecks > 0) {
    const typeTargets = calculateTypeTargets(edhrecStats, nonLandCards);
    const curveTargets = calculateCurveTargets(edhrecStats.manaCurve, nonLandCards);

    // Composition is now just for tracking - actual selection uses typeTargets
    const composition: DeckComposition = {
      lands: landCount,
      creatures: typeTargets.creature || 0,
      // These will be populated during card categorization
      singleRemoval: 0,
      boardWipes: 0,
      ramp: 0,
      cardDraw: 0,
      synergy: 0,
      utility: typeTargets.planeswalker || 0,
    };

    return { composition, typeTargets, curveTargets };
  }

  // Fallback defaults for different formats
  const defaults: Record<DeckFormat, DeckComposition> = {
    99: {
      lands: landCount,
      ramp: 10,
      cardDraw: 10,
      singleRemoval: 8,
      boardWipes: 3,
      creatures: 25,
      synergy: 30,
      utility: 3,
    },
    60: {
      lands: 23,
      ramp: 4,
      cardDraw: 4,
      singleRemoval: 5,
      boardWipes: 2,
      creatures: 15,
      synergy: 6,
      utility: 0,
    },
    40: {
      lands: 16,
      ramp: 2,
      cardDraw: 2,
      singleRemoval: 3,
      boardWipes: 1,
      creatures: 11,
      synergy: 4,
      utility: 0,
    },
  };

  // Fallback type targets and curve targets
  const fallbackComposition = defaults[format];
  const fallbackTypeTargets: Record<string, number> = {
    creature: fallbackComposition.creatures,
    instant: fallbackComposition.singleRemoval + Math.floor(fallbackComposition.cardDraw / 2),
    sorcery: fallbackComposition.boardWipes + Math.floor(fallbackComposition.ramp / 2),
    artifact: Math.floor(fallbackComposition.ramp / 2) + Math.floor(fallbackComposition.synergy / 3),
    enchantment: Math.floor(fallbackComposition.cardDraw / 2) + Math.floor(fallbackComposition.synergy / 3),
    planeswalker: fallbackComposition.utility,
    battle: 0,
  };

  // Default balanced curve
  const fallbackCurveTargets: Record<number, number> = {
    0: Math.round(nonLandCards * 0.02),
    1: Math.round(nonLandCards * 0.12),
    2: Math.round(nonLandCards * 0.20),
    3: Math.round(nonLandCards * 0.25),
    4: Math.round(nonLandCards * 0.18),
    5: Math.round(nonLandCards * 0.12),
    6: Math.round(nonLandCards * 0.06),
    7: Math.round(nonLandCards * 0.05),
  };

  return {
    composition: fallbackComposition,
    typeTargets: fallbackTypeTargets,
    curveTargets: fallbackCurveTargets,
  };
}

// Pick cards from a pre-fetched card map (no API calls)
function pickFromPrefetched(
  edhrecCards: EDHRECCard[],
  cardMap: Map<string, ScryfallCard>,
  count: number,
  usedNames: Set<string>,
  colorIdentity: string[],
  bannedCards: Set<string> = new Set()
): ScryfallCard[] {
  const result: ScryfallCard[] = [];

  // Filter candidates
  const candidates = edhrecCards.filter(
    c => !usedNames.has(c.name) && !bannedCards.has(c.name)
  );

  // Process cards in order (by inclusion rate)
  for (const edhrecCard of candidates) {
    if (result.length >= count) break;

    const scryfallCard = cardMap.get(edhrecCard.name);
    if (!scryfallCard) continue;

    // Verify color identity matches commander's colors
    if (!fitsColorIdentity(scryfallCard, colorIdentity)) {
      continue;
    }

    result.push(scryfallCard);
    usedNames.add(edhrecCard.name);
  }

  return result;
}

// Check if a card is a high-priority theme synergy card
function isHighSynergyCard(card: EDHRECCard): boolean {
  // Card is from highsynergycards, topcards, newcards, or gamechangers lists
  if (card.isThemeSynergyCard) return true;
  // Or has a high synergy score (> 0.3)
  if ((card.synergy ?? 0) > 0.3) return true;
  return false;
}

// Calculate a priority score for EDHREC cards
// High synergy cards (from theme) should be prioritized over generic high-inclusion cards
function calculateCardPriority(card: EDHRECCard): number {
  const synergy = card.synergy ?? 0;
  const inclusion = card.inclusion;

  // Cards from theme synergy lists (highsynergycards, topcards, etc.) get top priority
  if (card.isThemeSynergyCard) {
    // Theme synergy cards get a big boost: 100 + synergy bonus + inclusion
    // This ensures they're prioritized over regular high-inclusion cards
    return 100 + (synergy * 50) + inclusion;
  }

  // If synergy score is high (> 0.3), boost the card
  if (synergy > 0.3) {
    return (synergy * 100) + inclusion;
  }

  // For low/no synergy cards, just use inclusion
  return inclusion;
}

// Pick cards with curve awareness from pre-fetched map (no API calls)
// Prioritizes high-synergy theme cards over generic high-inclusion cards
function pickFromPrefetchedWithCurve(
  edhrecCards: EDHRECCard[],
  cardMap: Map<string, ScryfallCard>,
  count: number,
  usedNames: Set<string>,
  colorIdentity: string[],
  curveTargets: Record<number, number>,
  currentCurveCounts: Record<number, number>,
  bannedCards: Set<string> = new Set(),
  expectedType?: string
): ScryfallCard[] {
  const result: ScryfallCard[] = [];

  // Filter and sort ALL candidates by priority (synergy-aware)
  const allCandidates = edhrecCards
    .filter(c => !usedNames.has(c.name) && !bannedCards.has(c.name))
    .sort((a, b) => calculateCardPriority(b) - calculateCardPriority(a));

  // Separate into high-synergy cards (any type) and regular cards
  const highSynergyCards = allCandidates.filter(c => isHighSynergyCard(c));
  const regularTypedCards = allCandidates.filter(c => c.primary_type !== 'Unknown' && !isHighSynergyCard(c));
  const regularUnknownCards = allCandidates.filter(c => c.primary_type === 'Unknown' && !isHighSynergyCard(c));

  // Log high synergy card info for debugging
  if (highSynergyCards.length > 0 && expectedType) {
    console.log(`[DeckGen] ${expectedType}: Found ${highSynergyCards.length} high-synergy cards:`,
      highSynergyCards.slice(0, 5).map(c => `${c.name} (synergy=${c.synergy}, isTheme=${c.isThemeSynergyCard})`));
  }

  const processCards = (candidates: EDHRECCard[], requireTypeCheckForUnknown: boolean): void => {
    for (const edhrecCard of candidates) {
      if (result.length >= count) break;

      const scryfallCard = cardMap.get(edhrecCard.name);
      if (!scryfallCard) continue;

      // Type check for Unknown cards (need to verify they match expected type via Scryfall)
      // Cards already categorized by EDHREC (primary_type !== 'Unknown') skip this check
      if (requireTypeCheckForUnknown && edhrecCard.primary_type === 'Unknown' && expectedType) {
        if (!matchesExpectedType(scryfallCard.type_line, expectedType)) {
          continue;
        }
      }

      // Verify color identity
      if (!fitsColorIdentity(scryfallCard, colorIdentity)) {
        continue;
      }

      // Curve enforcement - but high synergy cards get more leniency
      const cmc = Math.min(Math.floor(scryfallCard.cmc), 7);
      if (!hasCurveRoom(cmc, curveTargets, currentCurveCounts)) {
        // High synergy cards or high inclusion (> 40%) can break curve
        if (!isHighSynergyCard(edhrecCard) && edhrecCard.inclusion < 40) {
          continue;
        }
      }

      result.push(scryfallCard);
      usedNames.add(edhrecCard.name);
      currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
    }
  };

  // Phase 1: Process HIGH SYNERGY cards first (these are the theme cards!)
  // Need type check since high-synergy Unknown cards should match expected type
  processCards(highSynergyCards, true);

  // Phase 2: Process regular typed cards (pre-categorized by EDHREC)
  if (result.length < count) {
    processCards(regularTypedCards, false);
  }

  // Phase 3: Process remaining Unknown cards if still needed
  if (result.length < count && regularUnknownCards.length > 0) {
    processCards(regularUnknownCards, true);
  }

  return result;
}

// Merge type-specific cards with allNonLand cards (which includes topcards, highsynergycards, etc.)
// This ensures cards from generic EDHREC lists get considered for each type slot
// IMPORTANT: Sort by priority so high-synergy cards come first, not last!
function mergeWithAllNonLand(
  typeSpecificCards: EDHRECCard[],
  allNonLand: EDHRECCard[]
): EDHRECCard[] {
  const seenNames = new Set(typeSpecificCards.map(c => c.name));
  const additionalCards = allNonLand.filter(c =>
    c.primary_type === 'Unknown' && !seenNames.has(c.name)
  );
  // Merge and sort by priority - high synergy cards should come FIRST
  const merged = [...typeSpecificCards, ...additionalCards];
  return merged.sort((a, b) => calculateCardPriority(b) - calculateCardPriority(a));
}

// Check if a card's type_line matches the expected type
function matchesExpectedType(typeLine: string, expectedType: string): boolean {
  const normalizedType = expectedType.toLowerCase();
  const normalizedTypeLine = typeLine.toLowerCase();

  // Handle the main card types
  if (normalizedType === 'creature') return normalizedTypeLine.includes('creature');
  if (normalizedType === 'instant') return normalizedTypeLine.includes('instant');
  if (normalizedType === 'sorcery') return normalizedTypeLine.includes('sorcery');
  if (normalizedType === 'artifact') return normalizedTypeLine.includes('artifact') && !normalizedTypeLine.includes('creature');
  if (normalizedType === 'enchantment') return normalizedTypeLine.includes('enchantment') && !normalizedTypeLine.includes('creature');
  if (normalizedType === 'planeswalker') return normalizedTypeLine.includes('planeswalker');
  if (normalizedType === 'land') return normalizedTypeLine.includes('land');

  return false;
}

// Categorize instants by function (removal, card draw, or synergy)
function categorizeInstants(
  instants: ScryfallCard[],
  categories: Record<DeckCategory, ScryfallCard[]>
): void {
  for (const card of instants) {
    const text = card.oracle_text?.toLowerCase() || '';

    if (
      text.includes('destroy target') ||
      text.includes('exile target') ||
      text.includes('counter target') ||
      text.includes('return target') ||
      text.includes('deals') && text.includes('damage to')
    ) {
      categories.singleRemoval.push(card);
    } else if (text.includes('draw')) {
      categories.cardDraw.push(card);
    } else {
      categories.synergy.push(card);
    }
  }
}

// Categorize sorceries by function
function categorizeSorceries(
  sorceries: ScryfallCard[],
  categories: Record<DeckCategory, ScryfallCard[]>
): void {
  for (const card of sorceries) {
    const text = card.oracle_text?.toLowerCase() || '';

    if (
      text.includes('destroy all') ||
      text.includes('exile all') ||
      (text.includes('each creature') && text.includes('damage')) ||
      text.includes('all creatures get -')
    ) {
      categories.boardWipes.push(card);
    } else if (
      text.includes('search your library') && text.includes('land')
    ) {
      categories.ramp.push(card);
    } else if (text.includes('draw')) {
      categories.cardDraw.push(card);
    } else {
      categories.synergy.push(card);
    }
  }
}

// Categorize artifacts by function
function categorizeArtifacts(
  artifacts: ScryfallCard[],
  categories: Record<DeckCategory, ScryfallCard[]>
): void {
  for (const card of artifacts) {
    const text = card.oracle_text?.toLowerCase() || '';

    if (
      text.includes('add') &&
      (text.includes('mana') || text.match(/add \{[wubrgc]\}/i))
    ) {
      categories.ramp.push(card);
    } else if (text.includes('draw')) {
      categories.cardDraw.push(card);
    } else {
      categories.synergy.push(card);
    }
  }
}

// Categorize enchantments by function
function categorizeEnchantments(
  enchantments: ScryfallCard[],
  categories: Record<DeckCategory, ScryfallCard[]>
): void {
  for (const card of enchantments) {
    const text = card.oracle_text?.toLowerCase() || '';

    if (text.includes('draw')) {
      categories.cardDraw.push(card);
    } else if (
      text.includes('add') &&
      (text.includes('mana') || text.match(/add \{[wubrgc]\}/i))
    ) {
      categories.ramp.push(card);
    } else {
      categories.synergy.push(card);
    }
  }
}

// Fill remaining slots with Scryfall search (fallback)
async function fillWithScryfall(
  query: string,
  colorIdentity: string[],
  count: number,
  usedNames: Set<string>,
  bannedCards: Set<string> = new Set()
): Promise<ScryfallCard[]> {
  if (count <= 0) return [];

  try {
    const response = await searchCards(query, colorIdentity, { order: 'edhrec' });
    const result: ScryfallCard[] = [];

    for (const card of response.data) {
      if (result.length >= count) break;
      if (usedNames.has(card.name)) continue; // Commander format is always singleton
      if (bannedCards.has(card.name)) continue; // Skip banned cards

      result.push(card);
      usedNames.add(card.name);
    }

    return result;
  } catch (error) {
    console.error(`Scryfall fallback failed for query "${query}":`, error);
    return [];
  }
}

// Basic land names to filter out from EDHREC suggestions
const BASIC_LAND_NAMES = new Set([
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest',
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
  'Snow-Covered Mountain', 'Snow-Covered Forest',
  'Wastes',
]);

// Count color pips across all cards' mana costs
function countColorPips(cards: ScryfallCard[]): Record<string, number> {
  const pips: Record<string, number> = {};
  const pipPattern = /\{([WUBRG])\}/g;
  for (const card of cards) {
    const costs: string[] = [];
    if (card.mana_cost) costs.push(card.mana_cost);
    // Double-faced cards store mana cost on each face
    if (card.card_faces) {
      for (const face of card.card_faces) {
        if (face.mana_cost) costs.push(face.mana_cost);
      }
    }
    for (const cost of costs) {
      let match;
      while ((match = pipPattern.exec(cost)) !== null) {
        pips[match[1]] = (pips[match[1]] || 0) + 1;
      }
    }
  }
  return pips;
}

// Generate lands from EDHREC data + basics
async function generateLands(
  edhrecLands: EDHRECCard[],
  colorIdentity: string[],
  count: number,
  usedNames: Set<string>,
  basicCount: number,
  format: DeckFormat,
  nonLandCards: ScryfallCard[],
  onProgress?: (message: string, percent: number) => void,
  bannedCards: Set<string> = new Set()
): Promise<ScryfallCard[]> {
  const lands: ScryfallCard[] = [];

  // Filter out basic lands from EDHREC suggestions - we add those separately
  const nonBasicEdhrecLands = edhrecLands.filter(
    land => !BASIC_LAND_NAMES.has(land.name)
  );

  console.log('[DeckGen] generateLands:', {
    totalEdhrecLands: edhrecLands.length,
    nonBasicEdhrecLands: nonBasicEdhrecLands.length,
    basicTarget: basicCount,
    totalTarget: count,
  });

  // First, get non-basic lands from EDHREC
  const nonBasicTarget = count - basicCount;

  if (nonBasicTarget > 0 && nonBasicEdhrecLands.length > 0) {
    onProgress?.('Discovering exotic lands...', 82);
    console.log(`[DeckGen] Picking ${nonBasicTarget} non-basic lands from ${nonBasicEdhrecLands.length} EDHREC suggestions`);

    // Batch fetch candidate lands
    const landNamesToFetch = nonBasicEdhrecLands
      .filter(c => !usedNames.has(c.name) && !bannedCards.has(c.name))
      .slice(0, nonBasicTarget * 2)  // Fetch more than needed to account for filtering
      .map(c => c.name);

    const landCardMap = await getCardsByNames(landNamesToFetch);
    const nonBasics = pickFromPrefetched(nonBasicEdhrecLands, landCardMap, nonBasicTarget, usedNames, colorIdentity, bannedCards);
    lands.push(...nonBasics);
    console.log(`[DeckGen] Got ${nonBasics.length} non-basic lands:`, nonBasics.map(l => l.name));
  }

  // If we didn't get enough from EDHREC, search Scryfall for more
  if (lands.length < nonBasicTarget) {
    onProgress?.('Exploring uncharted territories...', 87);
    const query = colorIdentity.length > 0
      ? `t:land (${colorIdentity.map((c) => `o:{${c}}`).join(' OR ')}) -t:basic`
      : `t:land id:c -t:basic`;
    const moreLands = await fillWithScryfall(query, colorIdentity, nonBasicTarget - lands.length, usedNames, bannedCards);
    lands.push(...moreLands);
  }

  // Add Command Tower for multicolor Commander decks (unless banned)
  if (format === 99 && colorIdentity.length >= 2 && !usedNames.has('Command Tower') && !bannedCards.has('Command Tower')) {
    try {
      const commandTower = await getCardByName('Command Tower', true);
      lands.push(commandTower);
      usedNames.add('Command Tower');
    } catch {
      // Ignore if not found
    }
  }

  // Fill remaining with basic lands (use cached cards for efficiency)
  const basicsNeeded = Math.max(0, count - lands.length);
  const basicTypes: Record<string, string> = {
    W: 'Plains',
    U: 'Island',
    B: 'Swamp',
    R: 'Mountain',
    G: 'Forest',
  };

  const colorsWithBasics = colorIdentity.filter((c) => basicTypes[c]);

  if (colorsWithBasics.length > 0 && basicsNeeded > 0) {
    onProgress?.('Claiming territories...', 92);

    // Distribute basics proportional to mana pips in the deck
    const pipCounts = countColorPips(nonLandCards);
    const totalPips = colorsWithBasics.reduce((sum, c) => sum + (pipCounts[c] || 0), 0);

    // Calculate proportional counts (fall back to even split if no pips found)
    const landsPerColor: Record<string, number> = {};
    if (totalPips > 0) {
      let assigned = 0;
      for (let i = 0; i < colorsWithBasics.length; i++) {
        const color = colorsWithBasics[i];
        if (i === colorsWithBasics.length - 1) {
          // Last color gets the remainder to ensure exact total
          landsPerColor[color] = basicsNeeded - assigned;
        } else {
          const proportion = (pipCounts[color] || 0) / totalPips;
          landsPerColor[color] = Math.round(basicsNeeded * proportion);
          assigned += landsPerColor[color];
        }
      }
    } else {
      // No pips found — fall back to even split
      const perColor = Math.floor(basicsNeeded / colorsWithBasics.length);
      const remainder = basicsNeeded % colorsWithBasics.length;
      for (let i = 0; i < colorsWithBasics.length; i++) {
        landsPerColor[colorsWithBasics[i]] = perColor + (i < remainder ? 1 : 0);
      }
    }

    console.log('[DeckGen] Basic land distribution by pips:', { pipCounts, landsPerColor });

    for (const color of colorsWithBasics) {
      const basicName = basicTypes[color];
      const countForColor = landsPerColor[color];

      // Try to get cached basic land first (prefetched at start of deck generation)
      let basicCard = getCachedCard(basicName);
      if (!basicCard) {
        try {
          basicCard = await getCardByName(basicName, true);
        } catch {
          continue; // Skip if can't fetch
        }
      }

      // Add multiple copies with unique IDs
      for (let j = 0; j < countForColor; j++) {
        lands.push({ ...basicCard, id: `${basicCard.id}-${j}-${color}` });
      }
    }
  } else if (colorsWithBasics.length === 0 && basicsNeeded > 0) {
    // Colorless deck — use Wastes as the basic land
    onProgress?.('Claiming wastelands...', 92);
    let wastesCard = getCachedCard('Wastes');
    if (!wastesCard) {
      try {
        wastesCard = await getCardByName('Wastes', true);
      } catch {
        // Skip if can't fetch
      }
    }
    if (wastesCard) {
      for (let j = 0; j < basicsNeeded; j++) {
        lands.push({ ...wastesCard, id: `${wastesCard.id}-${j}-C` });
      }
    }
  }

  return lands.slice(0, count);
}

// Calculate deck statistics
function calculateStats(categories: Record<DeckCategory, ScryfallCard[]>): DeckStats {
  const allCards = Object.values(categories).flat();
  const nonLandCards = allCards.filter(
    (card) => !card.type_line?.toLowerCase().includes('land')
  );

  // Mana curve
  const manaCurve: Record<number, number> = {};
  nonLandCards.forEach((card) => {
    const cmc = Math.min(Math.floor(card.cmc), 7); // Cap at 7+
    manaCurve[cmc] = (manaCurve[cmc] || 0) + 1;
  });

  // Average CMC
  const totalCmc = nonLandCards.reduce((sum, card) => sum + card.cmc, 0);
  const averageCmc = nonLandCards.length > 0 ? totalCmc / nonLandCards.length : 0;

  // Color distribution
  const colorDistribution: Record<string, number> = {};
  allCards.forEach((card) => {
    const colors = card.colors || [];
    if (colors.length === 0) {
      colorDistribution['C'] = (colorDistribution['C'] || 0) + 1;
    } else {
      colors.forEach((color) => {
        colorDistribution[color] = (colorDistribution[color] || 0) + 1;
      });
    }
  });

  // Type distribution
  const typeDistribution: Record<string, number> = {};
  allCards.forEach((card) => {
    const typeLine = card.type_line?.toLowerCase() || '';
    if (typeLine.includes('creature')) typeDistribution['Creature'] = (typeDistribution['Creature'] || 0) + 1;
    else if (typeLine.includes('instant')) typeDistribution['Instant'] = (typeDistribution['Instant'] || 0) + 1;
    else if (typeLine.includes('sorcery')) typeDistribution['Sorcery'] = (typeDistribution['Sorcery'] || 0) + 1;
    else if (typeLine.includes('artifact')) typeDistribution['Artifact'] = (typeDistribution['Artifact'] || 0) + 1;
    else if (typeLine.includes('enchantment')) typeDistribution['Enchantment'] = (typeDistribution['Enchantment'] || 0) + 1;
    else if (typeLine.includes('land')) typeDistribution['Land'] = (typeDistribution['Land'] || 0) + 1;
    else if (typeLine.includes('planeswalker')) typeDistribution['Planeswalker'] = (typeDistribution['Planeswalker'] || 0) + 1;
  });

  return {
    totalCards: allCards.length,
    averageCmc: Math.round(averageCmc * 100) / 100,
    manaCurve,
    colorDistribution,
    typeDistribution,
  };
}

// Merge cardlists from multiple theme results
function mergeThemeCardlists(
  themeDataResults: EDHRECCommanderData[]
): EDHRECCommanderData['cardlists'] {
  // Merge all cards, keeping the best version for duplicates
  // Prioritize: highest synergy first, then highest inclusion
  const mergeCards = (
    cards: EDHRECCard[][],
  ): EDHRECCard[] => {
    const cardMap = new Map<string, EDHRECCard>();

    for (const cardList of cards) {
      for (const card of cardList) {
        const existing = cardMap.get(card.name);
        if (!existing) {
          cardMap.set(card.name, card);
        } else {
          // Keep the card with better synergy, or if tied, better inclusion
          const existingSynergy = existing.synergy ?? 0;
          const newSynergy = card.synergy ?? 0;

          if (newSynergy > existingSynergy ||
              (newSynergy === existingSynergy && card.inclusion > existing.inclusion)) {
            cardMap.set(card.name, card);
          }
        }
      }
    }

    // Sort by priority (synergy-aware)
    return Array.from(cardMap.values()).sort((a, b) => calculateCardPriority(b) - calculateCardPriority(a));
  };

  return {
    creatures: mergeCards(themeDataResults.map(r => r.cardlists.creatures)),
    instants: mergeCards(themeDataResults.map(r => r.cardlists.instants)),
    sorceries: mergeCards(themeDataResults.map(r => r.cardlists.sorceries)),
    artifacts: mergeCards(themeDataResults.map(r => r.cardlists.artifacts)),
    enchantments: mergeCards(themeDataResults.map(r => r.cardlists.enchantments)),
    planeswalkers: mergeCards(themeDataResults.map(r => r.cardlists.planeswalkers)),
    lands: mergeCards(themeDataResults.map(r => r.cardlists.lands)),
    allNonLand: mergeCards(themeDataResults.map(r => r.cardlists.allNonLand)),
  };
}

// Main deck generation function
export async function generateDeck(context: GenerationContext): Promise<GeneratedDeck> {
  const {
    commander,
    partnerCommander,
    colorIdentity,
    customization,
    onProgress,
  } = context;

  const format = customization.deckFormat;
  const usedNames = new Set<string>();
  const bannedCards = new Set(customization.bannedCards || []);

  // Log banned cards if any
  if (bannedCards.size > 0) {
    console.log(`[DeckGen] Excluding ${bannedCards.size} banned cards:`, [...bannedCards]);
  }

  // Add commander(s) to used names
  usedNames.add(commander.name);
  if (partnerCommander) {
    usedNames.add(partnerCommander.name);
  }

  // Pre-fetch and cache basic lands for faster generation
  onProgress?.('Shuffling the library...', 5);
  await prefetchBasicLands();

  const categories: Record<DeckCategory, ScryfallCard[]> = {
    lands: [],
    ramp: [],
    cardDraw: [],
    singleRemoval: [],
    boardWipes: [],
    creatures: [],
    synergy: [],
    utility: [],
  };

  // Try to fetch EDHREC data (works for all formats)
  let edhrecData: EDHRECCommanderData | null = null;

  // Check for selected themes with slugs
  const selectedThemesWithSlugs = context.selectedThemes?.filter(
    t => t.isSelected && t.source === 'edhrec' && t.slug
  ) || [];

  if (selectedThemesWithSlugs.length > 0) {
    // Fetch theme-specific data for all selected themes
    onProgress?.('Seeking guidance from the oracle...', 8);
    try {
      const themeDataPromises = selectedThemesWithSlugs.map(theme =>
        fetchCommanderThemeData(commander.name, theme.slug!)
      );
      const themeDataResults = await Promise.all(themeDataPromises);

      // Merge cardlists from all themes
      const mergedCardlists = mergeThemeCardlists(themeDataResults);

      // Use the first theme's stats as representative
      edhrecData = {
        themes: [],
        stats: themeDataResults[0].stats,
        cardlists: mergedCardlists,
        similarCommanders: [],
      };

      const themeNames = selectedThemesWithSlugs.map(t => t.name).join(', ');
      onProgress?.(`The oracle speaks of ${themeNames}...`, 12);
    } catch (error) {
      console.warn('Failed to fetch theme-specific EDHREC data, trying base commander:', error);
      // Fall back to base commander data
      try {
        edhrecData = await fetchCommanderData(commander.name);
        onProgress?.('Consulting ancient scrolls...', 12);
      } catch {
        onProgress?.('The oracle is silent... searching the multiverse...', 12);
      }
    }
  } else {
    // No themes selected - use base commander data (top recommended cards)
    onProgress?.('Consulting the wisdom of EDHREC...', 8);
    try {
      edhrecData = await fetchCommanderData(commander.name);
      onProgress?.('Ancient knowledge acquired!', 12);
    } catch (error) {
      console.warn('Failed to fetch EDHREC data, falling back to Scryfall:', error);
      onProgress?.('The oracle is silent... searching the multiverse...', 12);
    }
  }

  // Calculate target counts with type and curve targets
  const { composition: targets, typeTargets, curveTargets } = calculateTargetCounts(
    customization,
    edhrecData?.stats
  );

  // Debug: Log expected card counts
  const totalTypeTargets = Object.values(typeTargets).reduce((sum, v) => sum + v, 0);
  console.log('[DeckGen] Target type counts:', typeTargets);
  console.log('[DeckGen] Total non-land target:', totalTypeTargets, '(should be ~', format === 99 ? 99 - targets.lands : format - 1 - targets.lands, ')');
  console.log('[DeckGen] Target curve:', curveTargets);
  console.log('[DeckGen] Land target:', targets.lands);

  // Track current curve distribution as we add cards
  const currentCurveCounts: Record<number, number> = {};

  // If we have EDHREC data, use it as the primary source with CMC-aware selection
  if (edhrecData && edhrecData.cardlists.allNonLand.length > 0) {
    const { cardlists } = edhrecData;

    // Build all pools first
    const creatureTarget = typeTargets.creature || targets.creatures;
    const creaturePool = mergeWithAllNonLand(cardlists.creatures, cardlists.allNonLand);
    const instantTarget = typeTargets.instant || 0;
    const instantPool = mergeWithAllNonLand(cardlists.instants, cardlists.allNonLand);
    const sorceryTarget = typeTargets.sorcery || 0;
    const sorceryPool = mergeWithAllNonLand(cardlists.sorceries, cardlists.allNonLand);
    const artifactTarget = typeTargets.artifact || 0;
    const artifactPool = mergeWithAllNonLand(cardlists.artifacts, cardlists.allNonLand);
    const enchantmentTarget = typeTargets.enchantment || 0;
    const enchantmentPool = mergeWithAllNonLand(cardlists.enchantments, cardlists.allNonLand);
    const planeswalkerTarget = typeTargets.planeswalker || 0;
    const planeswalkerPool = mergeWithAllNonLand(cardlists.planeswalkers, cardlists.allNonLand);

    // Collect ALL unique card names from all pools for a single batch fetch
    onProgress?.('Gathering cards from across the multiverse...', 18);
    const allCardNames = new Set<string>();

    // Helper to add names from a pool
    // IMPORTANT: Fetch ALL typed cards first (they're from EDHREC's type-specific lists),
    // then add high synergy Unknown cards. This ensures we actually have cards of the right type.
    const addPoolNames = (pool: EDHRECCard[], target: number) => {
      const candidates = pool.filter(c => !usedNames.has(c.name) && !bannedCards.has(c.name));

      // First, add ALL typed cards (these are confirmed to be the right type by EDHREC)
      const typedCards = candidates.filter(c => c.primary_type !== 'Unknown');
      for (const card of typedCards.slice(0, Math.max(target * 3, 20))) {
        allCardNames.add(card.name);
      }

      // Then add high synergy Unknown cards (need type check via Scryfall later)
      const highSynergyUnknown = candidates.filter(c => c.primary_type === 'Unknown' && isHighSynergyCard(c));
      for (const card of highSynergyUnknown.slice(0, Math.max(target * 2, 15))) {
        allCardNames.add(card.name);
      }
    };

    addPoolNames(creaturePool, creatureTarget);
    addPoolNames(instantPool, instantTarget);
    addPoolNames(sorceryPool, sorceryTarget);
    addPoolNames(artifactPool, artifactTarget);
    addPoolNames(enchantmentPool, enchantmentTarget);
    addPoolNames(planeswalkerPool, planeswalkerTarget);

    console.log(`[DeckGen] Batch fetching ${allCardNames.size} unique card names`);

    // SINGLE BATCH FETCH for all non-land cards
    onProgress?.('Summoning cards from Scryfall...', 25);
    const cardMap = await getCardsByNames([...allCardNames], (fetched, total) => {
      // Scale progress from 25% to 35% during the batch fetch
      const pct = 25 + Math.round((fetched / total) * 10);
      onProgress?.('Summoning cards from Scryfall...', pct);
    });
    console.log(`[DeckGen] Batch fetch returned ${cardMap.size} cards`);

    // Now process each type synchronously using the pre-fetched cards
    // 1. Creatures
    console.log(`[DeckGen] Creatures: need ${creatureTarget}, pool has ${creaturePool.length} cards`);
    onProgress?.('Summoning creatures from the aether...', 35);
    const creatures = pickFromPrefetchedWithCurve(
      creaturePool,
      cardMap,
      creatureTarget,
      usedNames,
      colorIdentity,
      curveTargets,
      currentCurveCounts,
      bannedCards,
      'Creature'
    );
    categories.creatures.push(...creatures);
    console.log(`[DeckGen] Creatures: got ${creatures.length} from EDHREC`);

    // Fill remaining creatures from Scryfall if needed
    if (categories.creatures.length < creatureTarget) {
      const needed = creatureTarget - categories.creatures.length;
      console.log(`[DeckGen] FALLBACK: Need ${needed} more creatures from Scryfall`);
      const moreCreatures = await fillWithScryfall(
        't:creature',
        colorIdentity,
        needed,
        usedNames,
        bannedCards
      );
      categories.creatures.push(...moreCreatures);
      console.log(`[DeckGen] FALLBACK: Got ${moreCreatures.length} creatures from Scryfall`);
      for (const card of moreCreatures) {
        const cmc = Math.min(Math.floor(card.cmc), 7);
        currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      }
    }

    // 2. Instants
    console.log(`[DeckGen] Instants: need ${instantTarget}, pool has ${instantPool.length} cards`);
    onProgress?.('Preparing instant-speed responses...', 45);
    const instants = pickFromPrefetchedWithCurve(
      instantPool,
      cardMap,
      instantTarget,
      usedNames,
      colorIdentity,
      curveTargets,
      currentCurveCounts,
      bannedCards,
      'Instant'
    );
    console.log(`[DeckGen] Instants: got ${instants.length} from EDHREC`);
    categorizeInstants(instants, categories);

    // 3. Sorceries
    console.log(`[DeckGen] Sorceries: need ${sorceryTarget}, pool has ${sorceryPool.length} cards`);
    onProgress?.('Channeling sorcerous power...', 55);
    const sorceries = pickFromPrefetchedWithCurve(
      sorceryPool,
      cardMap,
      sorceryTarget,
      usedNames,
      colorIdentity,
      curveTargets,
      currentCurveCounts,
      bannedCards,
      'Sorcery'
    );
    console.log(`[DeckGen] Sorceries: got ${sorceries.length} from EDHREC`);
    categorizeSorceries(sorceries, categories);

    // 4. Artifacts
    console.log(`[DeckGen] Artifacts: need ${artifactTarget}, pool has ${artifactPool.length} cards`);
    onProgress?.('Forging powerful artifacts...', 62);
    const artifacts = pickFromPrefetchedWithCurve(
      artifactPool,
      cardMap,
      artifactTarget,
      usedNames,
      colorIdentity,
      curveTargets,
      currentCurveCounts,
      bannedCards,
      'Artifact'
    );
    console.log(`[DeckGen] Artifacts: got ${artifacts.length} from EDHREC`);
    categorizeArtifacts(artifacts, categories);

    // 5. Enchantments
    console.log(`[DeckGen] Enchantments: need ${enchantmentTarget}, pool has ${enchantmentPool.length} cards`);
    onProgress?.('Weaving magical enchantments...', 68);
    const enchantments = pickFromPrefetchedWithCurve(
      enchantmentPool,
      cardMap,
      enchantmentTarget,
      usedNames,
      colorIdentity,
      curveTargets,
      currentCurveCounts,
      bannedCards,
      'Enchantment'
    );
    console.log(`[DeckGen] Enchantments: got ${enchantments.length} from EDHREC`);
    categorizeEnchantments(enchantments, categories);

    // 6. Planeswalkers
    console.log(`[DeckGen] Planeswalkers: need ${planeswalkerTarget}, pool has ${planeswalkerPool.length} cards`);
    if (planeswalkerPool.length > 0 && planeswalkerTarget > 0) {
      onProgress?.('Calling upon planeswalker allies...', 72);
      const planeswalkers = pickFromPrefetchedWithCurve(
        planeswalkerPool,
        cardMap,
        planeswalkerTarget,
        usedNames,
        colorIdentity,
        curveTargets,
        currentCurveCounts,
        bannedCards,
        'Planeswalker'
      );
      console.log(`[DeckGen] Planeswalkers: got ${planeswalkers.length} from EDHREC`);
      categories.utility.push(...planeswalkers);
    }

    // 7. Lands from EDHREC
    onProgress?.('Surveying the mana base...', 78);
    // Use user's non-basic land preference from customization
    const nonbasicTarget = Math.min(customization.nonBasicLandCount, targets.lands);
    const basicCount = Math.max(0, targets.lands - nonbasicTarget);

    console.log('[DeckGen] Land targets (from user preference):', {
      totalLandTarget: targets.lands,
      nonbasicTarget,
      basicTarget: basicCount,
      edhrecLandsAvailable: cardlists.lands.length,
    });

    if (cardlists.lands.length > 0) {
      console.log('[DeckGen] Sample EDHREC lands:', cardlists.lands.slice(0, 3).map(l => l.name));
    }

    const allNonLandCards = [
      ...categories.creatures,
      ...categories.ramp,
      ...categories.cardDraw,
      ...categories.singleRemoval,
      ...categories.boardWipes,
      ...categories.utility,
      ...categories.synergy,
    ];
    categories.lands = await generateLands(
      cardlists.lands,
      colorIdentity,
      targets.lands,
      usedNames,
      basicCount,
      format,
      allNonLandCards,
      onProgress,
      bannedCards
    );

    // Log category counts after EDHREC selection
    console.log('[DeckGen] After EDHREC selection - Category counts:', {
      creatures: categories.creatures.length,
      ramp: categories.ramp.length,
      cardDraw: categories.cardDraw.length,
      singleRemoval: categories.singleRemoval.length,
      boardWipes: categories.boardWipes.length,
      synergy: categories.synergy.length,
      utility: categories.utility.length,
      lands: categories.lands.length,
    });

  } else {
    // Fallback to Scryfall-based generation
    onProgress?.('Gathering mana accelerants...', 20);
    categories.ramp = await fillWithScryfall(
      '(t:artifact o:"add" OR o:"search your library" o:land t:sorcery cmc<=3)',
      colorIdentity,
      targets.ramp,
      usedNames,
      bannedCards
    );

    onProgress?.('Seeking sources of knowledge...', 30);
    categories.cardDraw = await fillWithScryfall(
      'o:"draw" (t:instant OR t:sorcery OR t:enchantment)',
      colorIdentity,
      targets.cardDraw,
      usedNames,
      bannedCards
    );

    onProgress?.('Arming with removal spells...', 40);
    categories.singleRemoval = await fillWithScryfall(
      '(o:"destroy target" OR o:"exile target") (t:instant OR t:sorcery)',
      colorIdentity,
      targets.singleRemoval,
      usedNames,
      bannedCards
    );

    onProgress?.('Preparing mass destruction...', 50);
    categories.boardWipes = await fillWithScryfall(
      '(o:"destroy all" OR o:"exile all") (t:instant OR t:sorcery)',
      colorIdentity,
      targets.boardWipes,
      usedNames,
      bannedCards
    );

    onProgress?.('Recruiting an army...', 60);
    categories.creatures = await fillWithScryfall(
      't:creature',
      colorIdentity,
      targets.creatures,
      usedNames,
      bannedCards
    );

    onProgress?.('Finding synergistic pieces...', 70);
    categories.synergy = await fillWithScryfall(
      '(t:artifact OR t:enchantment)',
      colorIdentity,
      targets.synergy,
      usedNames,
      bannedCards
    );

    onProgress?.('Surveying the mana base...', 80);
    // Use user's non-basic land preference
    const fallbackNonbasicTarget = Math.min(customization.nonBasicLandCount, targets.lands);
    const fallbackBasicCount = Math.max(0, targets.lands - fallbackNonbasicTarget);
    const fallbackNonLandCards = [
      ...categories.creatures,
      ...categories.ramp,
      ...categories.cardDraw,
      ...categories.singleRemoval,
      ...categories.boardWipes,
      ...categories.utility,
      ...categories.synergy,
    ];
    categories.lands = await generateLands(
      [],
      colorIdentity,
      targets.lands,
      usedNames,
      fallbackBasicCount,
      format,
      fallbackNonLandCards,
      onProgress,
      bannedCards
    );
  }

  // Calculate the target deck size (commander(s) are separate)
  // With partner, we need one fewer card since both commanders count toward the total
  const commanderCount = partnerCommander ? 2 : 1;
  const targetDeckSize = format === 99 ? (100 - commanderCount) : (format - commanderCount);

  // Helper to count all cards
  const countAllCards = () => Object.values(categories).flat().length;

  // If we have too many cards, trim from lowest priority categories
  // Priority order for trimming: utility first, then creatures, then synergy
  // Synergy cards are theme-specific and should be protected!
  const trimOrder: DeckCategory[] = ['utility', 'creatures', 'synergy', 'cardDraw', 'ramp', 'singleRemoval', 'boardWipes'];

  let currentCount = countAllCards();
  while (currentCount > targetDeckSize) {
    const excess = currentCount - targetDeckSize;
    let trimmed = false;

    for (const category of trimOrder) {
      if (categories[category].length > 0) {
        const toTrim = Math.min(excess, categories[category].length);
        categories[category] = categories[category].slice(0, categories[category].length - toTrim);
        trimmed = true;
        break;
      }
    }

    if (!trimmed) break; // Safety: no more cards to trim
    currentCount = countAllCards();
  }

  // If we have too few cards, fill shortage from EDHREC data (not Scryfall)
  currentCount = countAllCards();
  if (currentCount < targetDeckSize) {
    const shortage = targetDeckSize - currentCount;
    console.log(`[DeckGen] Deck shortage: need ${shortage} more cards (have ${currentCount}, need ${targetDeckSize})`);

    // Try to fill with remaining EDHREC cards (sorted by inclusion, less popular cards)
    if (edhrecData && edhrecData.cardlists.allNonLand.length > 0) {
      const remainingEdhrecCards = edhrecData.cardlists.allNonLand
        .filter(c => !usedNames.has(c.name) && !bannedCards.has(c.name))
        .sort((a, b) => b.inclusion - a.inclusion); // Still prioritize by inclusion

      console.log(`[DeckGen] Found ${remainingEdhrecCards.length} remaining EDHREC cards to fill shortage`);

      // Batch fetch these cards
      const namesToFetch = remainingEdhrecCards.slice(0, shortage * 2).map(c => c.name);
      const fillCardMap = await getCardsByNames(namesToFetch);

      let filled = 0;
      for (const edhrecCard of remainingEdhrecCards) {
        if (filled >= shortage) break;

        const scryfallCard = fillCardMap.get(edhrecCard.name);
        if (!scryfallCard) continue;

        // Verify color identity
        if (!fitsColorIdentity(scryfallCard, colorIdentity)) continue;

        categories.synergy.push(scryfallCard);
        usedNames.add(edhrecCard.name);
        filled++;
      }

      console.log(`[DeckGen] Filled ${filled} cards from remaining EDHREC suggestions`);
    }

    // If still short after EDHREC, use Scryfall as last resort
    currentCount = countAllCards();
    if (currentCount < targetDeckSize) {
      const stillNeeded = targetDeckSize - currentCount;
      console.log(`[DeckGen] Still need ${stillNeeded} more cards, using Scryfall fallback`);

      const moreSynergy = await fillWithScryfall(
        '(t:artifact OR t:enchantment OR t:creature)',
        colorIdentity,
        stillNeeded,
        usedNames,
        bannedCards
      );
      categories.synergy.push(...moreSynergy);
      console.log(`[DeckGen] Filled ${moreSynergy.length} cards from Scryfall`);
    }

    // If STILL short, add basic lands as absolute last resort
    currentCount = countAllCards();
    if (currentCount < targetDeckSize) {
      const remainingShortage = targetDeckSize - currentCount;
      console.log(`[DeckGen] Still need ${remainingShortage} more cards, adding basic lands`);

      const basicTypes: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
      const colorsWithBasics = colorIdentity.filter((c) => basicTypes[c]);

      if (colorsWithBasics.length > 0) {
        // Distribute proportional to mana pips
        const allNonLands = [
          ...categories.creatures, ...categories.ramp, ...categories.cardDraw,
          ...categories.singleRemoval, ...categories.boardWipes,
          ...categories.utility, ...categories.synergy,
        ];
        const pipCounts = countColorPips(allNonLands);
        const totalPips = colorsWithBasics.reduce((sum, c) => sum + (pipCounts[c] || 0), 0);

        const landsPerColor: Record<string, number> = {};
        if (totalPips > 0) {
          let assigned = 0;
          for (let i = 0; i < colorsWithBasics.length; i++) {
            const color = colorsWithBasics[i];
            if (i === colorsWithBasics.length - 1) {
              landsPerColor[color] = remainingShortage - assigned;
            } else {
              landsPerColor[color] = Math.round(remainingShortage * (pipCounts[color] || 0) / totalPips);
              assigned += landsPerColor[color];
            }
          }
        } else {
          const perColor = Math.floor(remainingShortage / colorsWithBasics.length);
          const remainder = remainingShortage % colorsWithBasics.length;
          for (let i = 0; i < colorsWithBasics.length; i++) {
            landsPerColor[colorsWithBasics[i]] = perColor + (i < remainder ? 1 : 0);
          }
        }

        for (const color of colorsWithBasics) {
          const basicName = basicTypes[color];
          const countForColor = landsPerColor[color];

          let basicCard = getCachedCard(basicName);
          if (!basicCard) {
            try {
              basicCard = await getCardByName(basicName, true);
            } catch {
              continue;
            }
          }

          for (let j = 0; j < countForColor; j++) {
            categories.lands.push({ ...basicCard, id: `${basicCard.id}-fill-${j}-${color}` });
          }
        }
      } else {
        // Colorless deck — use Wastes as the basic land
        let wastesCard = getCachedCard('Wastes');
        if (!wastesCard) {
          try {
            wastesCard = await getCardByName('Wastes', true);
          } catch {
            // Skip if can't fetch
          }
        }
        if (wastesCard) {
          for (let j = 0; j < remainingShortage; j++) {
            categories.lands.push({ ...wastesCard, id: `${wastesCard.id}-fill-${j}-C` });
          }
        }
      }
    }
  }

  // Final verification - log warning if still wrong
  const finalCount = countAllCards();
  if (finalCount !== targetDeckSize) {
    console.warn(`[DeckGen] Final deck size mismatch: got ${finalCount}, expected ${targetDeckSize}`);
  }

  // Calculate stats
  const stats = calculateStats(categories);

  // Get the theme names that were actually used
  const usedThemes = selectedThemesWithSlugs.length > 0
    ? selectedThemesWithSlugs.map(t => t.name)
    : undefined;

  return {
    commander,
    partnerCommander,
    categories,
    stats,
    usedThemes,
  };
}
