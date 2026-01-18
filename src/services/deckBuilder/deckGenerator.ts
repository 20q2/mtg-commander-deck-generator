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
import { searchCards, getCardByName } from '@/services/scryfall/client';
import { fetchCommanderData, fetchCommanderThemeData } from '@/services/edhrec/client';
import {
  DECK_FORMAT_CONFIGS,
} from '@/lib/constants/archetypes';
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
  onProgress?: (message: string) => void;
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
  const formatConfig = DECK_FORMAT_CONFIGS[format];

  // Use user's land count preference, but respect format's land range
  const landCount = Math.max(
    formatConfig.landRange[0],
    Math.min(formatConfig.landRange[1], customization.landCount)
  );

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

// Convert EDHREC card to Scryfall card by fetching from Scryfall
async function edhrecToScryfall(edhrecCard: EDHRECCard): Promise<ScryfallCard | null> {
  try {
    return await getCardByName(edhrecCard.name, true);
  } catch {
    console.warn(`Could not fetch card: ${edhrecCard.name}`);
    return null;
  }
}

// Pick cards from EDHREC list, converting to Scryfall cards
async function pickFromEDHREC(
  edhrecCards: EDHRECCard[],
  count: number,
  usedNames: Set<string>,
  colorIdentity: string[],
  onProgress?: (message: string) => void,
  bannedCards: Set<string> = new Set()
): Promise<ScryfallCard[]> {
  const result: ScryfallCard[] = [];

  for (const edhrecCard of edhrecCards) {
    if (result.length >= count) break;
    if (usedNames.has(edhrecCard.name)) continue;
    if (bannedCards.has(edhrecCard.name)) continue; // Skip banned cards

    onProgress?.(`Fetching ${edhrecCard.name}...`);
    const scryfallCard = await edhrecToScryfall(edhrecCard);

    if (scryfallCard) {
      // Verify color identity matches commander's colors
      if (!fitsColorIdentity(scryfallCard, colorIdentity)) {
        console.warn(`Skipping ${scryfallCard.name} - color identity ${scryfallCard.color_identity} doesn't fit ${colorIdentity}`);
        continue;
      }
      result.push(scryfallCard);
      usedNames.add(edhrecCard.name);
    }
  }

  return result;
}

// Pick cards from EDHREC list with CMC-aware selection
// Since EDHREC cards don't have CMC, we:
// 1. Sort primarily by inclusion rate (EDHREC's main metric)
// 2. Fetch from Scryfall to get actual CMC
// 3. Use CMC for curve tracking and soft enforcement
async function pickFromEDHRECWithCurve(
  edhrecCards: EDHRECCard[],
  count: number,
  usedNames: Set<string>,
  colorIdentity: string[],
  curveTargets: Record<number, number>,
  currentCurveCounts: Record<number, number>,
  onProgress?: (message: string) => void,
  bannedCards: Set<string> = new Set()
): Promise<ScryfallCard[]> {
  const result: ScryfallCard[] = [];

  // Sort by inclusion rate (higher is better) - this is the primary EDHREC metric
  // Note: EDHREC cards don't have CMC, so we can't do curve-based pre-sorting
  const sortedCards = [...edhrecCards].sort((a, b) => b.inclusion - a.inclusion);

  for (const edhrecCard of sortedCards) {
    if (result.length >= count) break;
    if (usedNames.has(edhrecCard.name)) continue;
    if (bannedCards.has(edhrecCard.name)) continue; // Skip banned cards

    onProgress?.(`Fetching ${edhrecCard.name}...`);
    const scryfallCard = await edhrecToScryfall(edhrecCard);

    if (scryfallCard) {
      // Verify color identity matches commander's colors
      if (!fitsColorIdentity(scryfallCard, colorIdentity)) {
        console.warn(`Skipping ${scryfallCard.name} - color identity ${scryfallCard.color_identity} doesn't fit ${colorIdentity}`);
        continue;
      }

      // Use the actual CMC from Scryfall (EDHREC doesn't have it)
      const cmc = Math.min(Math.floor(scryfallCard.cmc), 7);

      // Soft curve enforcement: skip low-inclusion cards if bucket is very overfilled
      // High-inclusion cards (>40%) always get through regardless of curve
      if (!hasCurveRoom(cmc, curveTargets, currentCurveCounts)) {
        if (edhrecCard.inclusion < 40) {
          // Skip this card - curve is overfilled and it's not high-inclusion
          continue;
        }
      }

      result.push(scryfallCard);
      usedNames.add(edhrecCard.name);
      currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
    }
  }

  return result;
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
  singleton: boolean,
  bannedCards: Set<string> = new Set()
): Promise<ScryfallCard[]> {
  if (count <= 0) return [];

  try {
    const response = await searchCards(query, colorIdentity, { order: 'edhrec' });
    const result: ScryfallCard[] = [];

    for (const card of response.data) {
      if (result.length >= count) break;
      if (singleton && usedNames.has(card.name)) continue;
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

// Generate lands from EDHREC data + basics
async function generateLands(
  edhrecLands: EDHRECCard[],
  colorIdentity: string[],
  count: number,
  usedNames: Set<string>,
  basicCount: number,
  format: DeckFormat,
  onProgress?: (message: string) => void,
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
    onProgress?.('Fetching non-basic lands...');
    console.log(`[DeckGen] Picking ${nonBasicTarget} non-basic lands from ${nonBasicEdhrecLands.length} EDHREC suggestions`);
    const nonBasics = await pickFromEDHREC(nonBasicEdhrecLands, nonBasicTarget, usedNames, colorIdentity, onProgress, bannedCards);
    lands.push(...nonBasics);
    console.log(`[DeckGen] Got ${nonBasics.length} non-basic lands:`, nonBasics.map(l => l.name));
  }

  // If we didn't get enough from EDHREC, search Scryfall for more
  if (lands.length < nonBasicTarget) {
    onProgress?.('Finding additional lands...');
    const query = `t:land (${colorIdentity.map((c) => `o:{${c}}`).join(' OR ')}) -t:basic`;
    const moreLands = await fillWithScryfall(query, colorIdentity, nonBasicTarget - lands.length, usedNames, true, bannedCards);
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

  // Fill remaining with basic lands
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
    onProgress?.('Adding basic lands...');
    const perColor = Math.floor(basicsNeeded / colorsWithBasics.length);
    const remainder = basicsNeeded % colorsWithBasics.length;

    for (let i = 0; i < colorsWithBasics.length; i++) {
      const color = colorsWithBasics[i];
      const basicName = basicTypes[color];
      const countForColor = perColor + (i < remainder ? 1 : 0);

      for (let j = 0; j < countForColor; j++) {
        try {
          const basic = await getCardByName(basicName, true);
          // Create unique ID for each basic land instance
          lands.push({ ...basic, id: `${basic.id}-${j}-${color}` });
        } catch {
          // Skip if can't fetch
        }
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
  // Merge all cards, keeping highest inclusion rate for duplicates
  const mergeCards = (
    cards: EDHRECCard[][],
  ): EDHRECCard[] => {
    const cardMap = new Map<string, EDHRECCard>();

    for (const cardList of cards) {
      for (const card of cardList) {
        const existing = cardMap.get(card.name);
        if (!existing || card.inclusion > existing.inclusion) {
          cardMap.set(card.name, card);
        }
      }
    }

    return Array.from(cardMap.values()).sort((a, b) => b.inclusion - a.inclusion);
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
  const singleton = customization.singleton;
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
    onProgress?.(`Fetching ${selectedThemesWithSlugs.length} theme(s) from EDHREC...`);
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
      onProgress?.(`Using ${edhrecData.cardlists.allNonLand.length} cards from: ${themeNames}`);
    } catch (error) {
      console.warn('Failed to fetch theme-specific EDHREC data, trying base commander:', error);
      // Fall back to base commander data
      try {
        edhrecData = await fetchCommanderData(commander.name);
        onProgress?.(`Theme fetch failed, using ${edhrecData.cardlists.allNonLand.length} general cards`);
      } catch {
        onProgress?.('EDHREC unavailable, using Scryfall search...');
      }
    }
  } else {
    // No themes selected - use base commander data (top recommended cards)
    onProgress?.('Fetching top recommended cards from EDHREC...');
    try {
      edhrecData = await fetchCommanderData(commander.name);
      onProgress?.(`Found ${edhrecData.cardlists.allNonLand.length} popular cards from EDHREC`);
    } catch (error) {
      console.warn('Failed to fetch EDHREC data, falling back to Scryfall:', error);
      onProgress?.('EDHREC unavailable, using Scryfall search...');
    }
  }

  // Calculate target counts with type and curve targets
  const { composition: targets, typeTargets, curveTargets } = calculateTargetCounts(
    customization,
    edhrecData?.stats
  );

  // Debug: Log expected card counts
  console.log('[DeckGen] Target type counts:', typeTargets);
  console.log('[DeckGen] Target curve:', curveTargets);
  console.log('[DeckGen] Land target:', targets.lands);

  // Track current curve distribution as we add cards
  const currentCurveCounts: Record<number, number> = {};

  // If we have EDHREC data, use it as the primary source with CMC-aware selection
  if (edhrecData && edhrecData.cardlists.allNonLand.length > 0) {
    const { cardlists } = edhrecData;

    // 1. Creatures - use EDHREC type target count
    const creatureTarget = typeTargets.creature || targets.creatures;
    console.log(`[DeckGen] Creatures: need ${creatureTarget}, EDHREC has ${cardlists.creatures.length} available`);
    onProgress?.(`Selecting ${creatureTarget} creatures...`);
    const creatures = await pickFromEDHRECWithCurve(
      cardlists.creatures,
      creatureTarget,
      usedNames,
      colorIdentity,
      curveTargets,
      currentCurveCounts,
      onProgress,
      bannedCards
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
        singleton,
        bannedCards
      );
      categories.creatures.push(...moreCreatures);
      console.log(`[DeckGen] FALLBACK: Got ${moreCreatures.length} creatures from Scryfall`);
      // Update curve counts for Scryfall cards
      for (const card of moreCreatures) {
        const cmc = Math.min(Math.floor(card.cmc), 7);
        currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      }
    }

    // 2. Instants - use EDHREC type target count, then categorize by function
    const instantTarget = typeTargets.instant || 8;
    console.log(`[DeckGen] Instants: need ${instantTarget}, EDHREC has ${cardlists.instants.length} available`);
    onProgress?.(`Selecting ${instantTarget} instants...`);
    const instants = await pickFromEDHRECWithCurve(
      cardlists.instants,
      instantTarget,
      usedNames,
      colorIdentity,
      curveTargets,
      currentCurveCounts,
      onProgress,
      bannedCards
    );
    console.log(`[DeckGen] Instants: got ${instants.length} from EDHREC`);
    categorizeInstants(instants, categories);

    // 3. Sorceries - use EDHREC type target count, then categorize by function
    const sorceryTarget = typeTargets.sorcery || 8;
    console.log(`[DeckGen] Sorceries: need ${sorceryTarget}, EDHREC has ${cardlists.sorceries.length} available`);
    onProgress?.(`Selecting ${sorceryTarget} sorceries...`);
    const sorceries = await pickFromEDHRECWithCurve(
      cardlists.sorceries,
      sorceryTarget,
      usedNames,
      colorIdentity,
      curveTargets,
      currentCurveCounts,
      onProgress,
      bannedCards
    );
    console.log(`[DeckGen] Sorceries: got ${sorceries.length} from EDHREC`);
    categorizeSorceries(sorceries, categories);

    // 4. Artifacts - use EDHREC type target count, then categorize by function
    const artifactTarget = typeTargets.artifact || 7;
    console.log(`[DeckGen] Artifacts: need ${artifactTarget}, EDHREC has ${cardlists.artifacts.length} available`);
    onProgress?.(`Selecting ${artifactTarget} artifacts...`);
    const artifacts = await pickFromEDHRECWithCurve(
      cardlists.artifacts,
      artifactTarget,
      usedNames,
      colorIdentity,
      curveTargets,
      currentCurveCounts,
      onProgress,
      bannedCards
    );
    console.log(`[DeckGen] Artifacts: got ${artifacts.length} from EDHREC`);
    categorizeArtifacts(artifacts, categories);

    // 5. Enchantments - use EDHREC type target count, then categorize by function
    const enchantmentTarget = typeTargets.enchantment || 7;
    console.log(`[DeckGen] Enchantments: need ${enchantmentTarget}, EDHREC has ${cardlists.enchantments.length} available`);
    onProgress?.(`Selecting ${enchantmentTarget} enchantments...`);
    const enchantments = await pickFromEDHRECWithCurve(
      cardlists.enchantments,
      enchantmentTarget,
      usedNames,
      colorIdentity,
      curveTargets,
      currentCurveCounts,
      onProgress,
      bannedCards
    );
    console.log(`[DeckGen] Enchantments: got ${enchantments.length} from EDHREC`);
    categorizeEnchantments(enchantments, categories);

    // 6. Planeswalkers - use EDHREC type target count
    const planeswalkerTarget = typeTargets.planeswalker || 1;
    console.log(`[DeckGen] Planeswalkers: need ${planeswalkerTarget}, EDHREC has ${cardlists.planeswalkers.length} available`);
    if (cardlists.planeswalkers.length > 0 && planeswalkerTarget > 0) {
      onProgress?.(`Selecting ${planeswalkerTarget} planeswalkers...`);
      const planeswalkers = await pickFromEDHRECWithCurve(
        cardlists.planeswalkers,
        planeswalkerTarget,
        usedNames,
        colorIdentity,
        curveTargets,
        currentCurveCounts,
        onProgress,
        bannedCards
      );
      console.log(`[DeckGen] Planeswalkers: got ${planeswalkers.length} from EDHREC`);
      categories.utility.push(...planeswalkers);
    }

    // 7. Lands from EDHREC
    onProgress?.('Generating land base...');
    console.log('[DeckGen] Land stats from EDHREC:', {
      totalLandTarget: targets.lands,
      edhrecLandsAvailable: cardlists.lands.length,
      basicFromStats: edhrecData.stats.landDistribution.basic,
      nonbasicFromStats: edhrecData.stats.landDistribution.nonbasic,
    });

    // Calculate non-basic target: use EDHREC's nonbasic count as a guide
    // If EDHREC says average deck has X nonbasics, aim for that
    const nonbasicTarget = edhrecData.stats.landDistribution.nonbasic || 15;
    const basicCount = Math.max(0, targets.lands - nonbasicTarget);

    console.log('[DeckGen] Land targets:', {
      nonbasicTarget,
      basicTarget: basicCount,
    });

    if (cardlists.lands.length > 0) {
      console.log('[DeckGen] Sample EDHREC lands:', cardlists.lands.slice(0, 3).map(l => l.name));
    }

    categories.lands = await generateLands(
      cardlists.lands,
      colorIdentity,
      targets.lands,
      usedNames,
      basicCount,
      format,
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

    // Fill any missing functional categories from Scryfall if needed
    // Note: With type-based selection, these should be less needed
    const minRamp = 6; // Ensure minimum ramp
    const minCardDraw = 6; // Ensure minimum card draw
    const minRemoval = 5; // Ensure minimum removal

    if (categories.ramp.length < minRamp) {
      const needed = minRamp - categories.ramp.length;
      console.log(`[DeckGen] FALLBACK: Need ${needed} more ramp from Scryfall (have ${categories.ramp.length}, min ${minRamp})`);
      onProgress?.('Finding more ramp...');
      const moreRamp = await fillWithScryfall(
        '(t:artifact o:"add" o:mana) OR (o:"search your library" o:land t:sorcery)',
        colorIdentity,
        needed,
        usedNames,
        singleton,
        bannedCards
      );
      console.log(`[DeckGen] FALLBACK: Got ${moreRamp.length} ramp from Scryfall:`, moreRamp.map(c => c.name));
      categories.ramp.push(...moreRamp);
    }

    if (categories.cardDraw.length < minCardDraw) {
      const needed = minCardDraw - categories.cardDraw.length;
      console.log(`[DeckGen] FALLBACK: Need ${needed} more card draw from Scryfall (have ${categories.cardDraw.length}, min ${minCardDraw})`);
      onProgress?.('Finding more card draw...');
      const moreDraw = await fillWithScryfall(
        'o:"draw a card" (t:instant OR t:sorcery OR t:enchantment)',
        colorIdentity,
        needed,
        usedNames,
        singleton,
        bannedCards
      );
      console.log(`[DeckGen] FALLBACK: Got ${moreDraw.length} card draw from Scryfall:`, moreDraw.map(c => c.name));
      categories.cardDraw.push(...moreDraw);
    }

    if (categories.singleRemoval.length < minRemoval) {
      const needed = minRemoval - categories.singleRemoval.length;
      console.log(`[DeckGen] FALLBACK: Need ${needed} more removal from Scryfall (have ${categories.singleRemoval.length}, min ${minRemoval})`);
      onProgress?.('Finding more removal...');
      const moreRemoval = await fillWithScryfall(
        '(o:"destroy target" OR o:"exile target") (t:instant OR t:sorcery)',
        colorIdentity,
        needed,
        usedNames,
        singleton,
        bannedCards
      );
      console.log(`[DeckGen] FALLBACK: Got ${moreRemoval.length} removal from Scryfall:`, moreRemoval.map(c => c.name));
      categories.singleRemoval.push(...moreRemoval);
    }

    if (categories.boardWipes.length < targets.boardWipes) {
      const needed = targets.boardWipes - categories.boardWipes.length;
      console.log(`[DeckGen] FALLBACK: Need ${needed} more board wipes from Scryfall`);
      onProgress?.('Finding board wipes...');
      const moreWipes = await fillWithScryfall(
        '(o:"destroy all" OR o:"exile all") (t:instant OR t:sorcery)',
        colorIdentity,
        needed,
        usedNames,
        singleton,
        bannedCards
      );
      console.log(`[DeckGen] FALLBACK: Got ${moreWipes.length} board wipes from Scryfall:`, moreWipes.map(c => c.name));
      categories.boardWipes.push(...moreWipes);
    }

    if (categories.synergy.length < targets.synergy) {
      const needed = targets.synergy - categories.synergy.length;
      console.log(`[DeckGen] FALLBACK: Need ${needed} more synergy from Scryfall`);
      onProgress?.('Finding synergy cards...');
      const moreSynergy = await fillWithScryfall(
        '(t:artifact OR t:enchantment) -t:creature',
        colorIdentity,
        needed,
        usedNames,
        singleton,
        bannedCards
      );
      console.log(`[DeckGen] FALLBACK: Got ${moreSynergy.length} synergy from Scryfall:`, moreSynergy.map(c => c.name));
      categories.synergy.push(...moreSynergy);
    }

  } else {
    // Fallback to Scryfall-based generation
    onProgress?.('Searching for ramp cards...');
    categories.ramp = await fillWithScryfall(
      '(t:artifact o:"add" OR o:"search your library" o:land t:sorcery cmc<=3)',
      colorIdentity,
      targets.ramp,
      usedNames,
      singleton,
      bannedCards
    );

    onProgress?.('Searching for card draw...');
    categories.cardDraw = await fillWithScryfall(
      'o:"draw" (t:instant OR t:sorcery OR t:enchantment)',
      colorIdentity,
      targets.cardDraw,
      usedNames,
      singleton,
      bannedCards
    );

    onProgress?.('Searching for removal...');
    categories.singleRemoval = await fillWithScryfall(
      '(o:"destroy target" OR o:"exile target") (t:instant OR t:sorcery)',
      colorIdentity,
      targets.singleRemoval,
      usedNames,
      singleton,
      bannedCards
    );

    onProgress?.('Searching for board wipes...');
    categories.boardWipes = await fillWithScryfall(
      '(o:"destroy all" OR o:"exile all") (t:instant OR t:sorcery)',
      colorIdentity,
      targets.boardWipes,
      usedNames,
      singleton,
      bannedCards
    );

    onProgress?.('Searching for creatures...');
    categories.creatures = await fillWithScryfall(
      't:creature',
      colorIdentity,
      targets.creatures,
      usedNames,
      singleton,
      bannedCards
    );

    onProgress?.('Searching for synergy cards...');
    categories.synergy = await fillWithScryfall(
      '(t:artifact OR t:enchantment)',
      colorIdentity,
      targets.synergy,
      usedNames,
      singleton,
      bannedCards
    );

    onProgress?.('Generating land base...');
    categories.lands = await generateLands(
      [],
      colorIdentity,
      targets.lands,
      usedNames,
      Math.floor(targets.lands * 0.5),
      format,
      onProgress,
      bannedCards
    );
  }

  // Calculate the target deck size (commander is separate)
  const targetDeckSize = format === 99 ? 99 : format - 1;

  // Helper to count all cards
  const countAllCards = () => Object.values(categories).flat().length;

  // If we have too many cards, trim from lowest priority categories
  // Priority order for trimming: synergy, utility, creatures, then others
  const trimOrder: DeckCategory[] = ['synergy', 'utility', 'creatures', 'cardDraw', 'ramp', 'singleRemoval', 'boardWipes'];

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

  // If we have too few cards, add basic lands to fill
  currentCount = countAllCards();
  if (currentCount < targetDeckSize) {
    const shortage = targetDeckSize - currentCount;
    const basicTypes: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
    const colorsWithBasics = colorIdentity.filter((c) => basicTypes[c]);

    if (colorsWithBasics.length > 0) {
      const perColor = Math.floor(shortage / colorsWithBasics.length);
      const remainder = shortage % colorsWithBasics.length;

      for (let i = 0; i < colorsWithBasics.length; i++) {
        const color = colorsWithBasics[i];
        const basicName = basicTypes[color];
        const countForColor = perColor + (i < remainder ? 1 : 0);

        for (let j = 0; j < countForColor; j++) {
          try {
            const basic = await getCardByName(basicName, true);
            categories.lands.push({ ...basic, id: `${basic.id}-fill-${j}-${color}` });
          } catch {
            // Skip if can't fetch
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
