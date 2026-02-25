import type {
  ScryfallCard,
  GeneratedDeck,
  GapAnalysisCard,
  DetectedCombo,
  DeckStats,
  DeckCategory,
  DeckComposition,
  Customization,
  Archetype,
  DeckFormat,
  ThemeResult,
  EDHRECCard,
  EDHRECCombo,
  EDHRECCommanderData,
  EDHRECCommanderStats,
  MaxRarity,
} from '@/types';
import { searchCards, getCardByName, getCardsByNames, prefetchBasicLands, getCachedCard, getGameChangerNames, getCardPrice, getFrontFaceTypeLine, fetchMultiCopyCardNames } from '@/services/scryfall/client';
import { fetchCommanderData, fetchCommanderThemeData, fetchPartnerCommanderData, fetchPartnerThemeData, fetchAverageDeckMultiCopies, fetchCommanderCombos } from '@/services/edhrec/client';
import {
  calculateTypeTargets,
  calculateCurveTargets,
  hasCurveRoom,
} from './curveUtils';
import { getDeckFormatConfig } from '@/lib/constants/archetypes';

interface GenerationContext {
  commander: ScryfallCard;
  partnerCommander: ScryfallCard | null;
  colorIdentity: string[];
  archetype: Archetype;
  customization: Customization;
  selectedThemes?: ThemeResult[];
  collectionNames?: Set<string>;
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

  // Calculate total deck cards (commander is separate for 99, included for 40/60)
  const deckCards = format === 99 ? 99 : format - 1;

  // Clamp land count to valid range for the format (safety net in case UI state is stale)
  const formatConfig = getDeckFormatConfig(format);
  const landCount = Math.min(
    Math.max(formatConfig.landRange[0], customization.landCount),
    formatConfig.landRange[1]
  );
  if (landCount !== customization.landCount) {
    console.warn(`[DeckGen] Clamped landCount from ${customization.landCount} to ${landCount} for ${format}-card format (range: ${formatConfig.landRange[0]}-${formatConfig.landRange[1]})`);
  }
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
  const knownDefaults: Record<number, DeckComposition> = {
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

  // Fallback type targets and curve targets — interpolate for custom sizes
  const fallbackComposition: DeckComposition = knownDefaults[format] ?? (() => {
    // Scale proportionally based on non-land card count
    const ratio = nonLandCards / 62; // 62 = 99 - 37 lands (Commander baseline)
    return {
      lands: landCount,
      ramp: Math.max(1, Math.round(10 * ratio)),
      cardDraw: Math.max(1, Math.round(10 * ratio)),
      singleRemoval: Math.max(1, Math.round(8 * ratio)),
      boardWipes: Math.max(0, Math.round(3 * ratio)),
      creatures: Math.max(2, Math.round(25 * ratio)),
      synergy: Math.max(1, Math.round(30 * ratio)),
      utility: Math.max(0, Math.round(3 * ratio)),
    };
  })();
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

// Check if a card exceeds the max price limit
// Cards with no price are treated as exceeding the limit when a budget is active
function exceedsMaxPrice(card: ScryfallCard, maxPrice: number | null, currency: 'USD' | 'EUR' = 'USD'): boolean {
  if (maxPrice === null) return false;
  const priceStr = getCardPrice(card, currency);
  if (!priceStr) return true; // No price data — skip when budget is set
  const price = parseFloat(priceStr);
  return isNaN(price) || price > maxPrice;
}

// Check if a card exceeds the max rarity limit
const RARITY_ORDER: Record<string, number> = { common: 0, uncommon: 1, rare: 2, mythic: 3 };

function exceedsMaxRarity(card: ScryfallCard, maxRarity: MaxRarity): boolean {
  if (maxRarity === null) return false;
  return (RARITY_ORDER[card.rarity] ?? 3) > RARITY_ORDER[maxRarity];
}

// Check if a card is NOT in the user's collection (for collection mode)
function notInCollection(cardName: string, collectionNames: Set<string> | undefined): boolean {
  if (!collectionNames) return false;
  return !collectionNames.has(cardName);
}

// Check if a non-land card exceeds the CMC cap (for Tiny Leaders)
function exceedsCmcCap(card: ScryfallCard, maxCmc: number | null): boolean {
  if (maxCmc === null) return false;
  // Lands are never filtered by CMC (use front face for MDFCs)
  if (getFrontFaceTypeLine(card).toLowerCase().includes('land')) return false;
  return card.cmc > maxCmc;
}

/**
 * Tracks total deck spending and dynamically adjusts per-card price cap.
 * Hard cap — deck total will not exceed the set budget.
 */
class BudgetTracker {
  remainingBudget: number;
  cardsRemaining: number;
  currency: 'USD' | 'EUR';

  constructor(totalBudget: number, totalCardsToSelect: number, currency: 'USD' | 'EUR' = 'USD') {
    this.remainingBudget = totalBudget;
    this.cardsRemaining = Math.max(1, totalCardsToSelect);
    this.currency = currency;
  }

  /**
   * Get the effective per-card price cap.
   * Uses two rules to prevent budget blowout:
   * 1. No single card can exceed 15% of remaining budget
   * 2. No single card can exceed 8x the per-card average
   * This spreads the budget across all slots — key cards can still cost
   * several times the average, but no single pick dominates.
   */
  getEffectiveCap(staticMax: number | null): number | null {
    if (this.cardsRemaining <= 0) return staticMax;
    const avg = this.remainingBudget / this.cardsRemaining;
    const dynamicCap = Math.min(
      this.remainingBudget * 0.15, // max 15% of remaining budget
      avg * 8                      // max 8x average per card
    );
    if (staticMax === null) return Math.max(0, dynamicCap);
    return Math.max(0, Math.min(staticMax, dynamicCap));
  }

  /** Deduct card price after adding it to the deck */
  deductCard(card: ScryfallCard): void {
    const priceStr = getCardPrice(card, this.currency);
    if (priceStr) {
      const price = parseFloat(priceStr);
      if (!isNaN(price)) {
        this.remainingBudget -= price;
      }
    }
    this.cardsRemaining = Math.max(0, this.cardsRemaining - 1);
  }

  /** Deduct cost of must-include cards upfront */
  deductMustIncludes(cards: ScryfallCard[]): void {
    for (const card of cards) {
      const priceStr = getCardPrice(card, this.currency);
      if (priceStr) {
        const price = parseFloat(priceStr);
        if (!isNaN(price)) {
          this.remainingBudget -= price;
        }
      }
      this.cardsRemaining = Math.max(0, this.cardsRemaining - 1);
    }
    const sym = this.currency === 'EUR' ? '€' : '$';
    console.log(`[BudgetTracker] After must-includes: ${sym}${this.remainingBudget.toFixed(2)} remaining for ${this.cardsRemaining} cards`);
  }
}

// Pick cards from a pre-fetched card map (no API calls)
function pickFromPrefetched(
  edhrecCards: EDHRECCard[],
  cardMap: Map<string, ScryfallCard>,
  count: number,
  usedNames: Set<string>,
  colorIdentity: string[],
  bannedCards: Set<string> = new Set(),
  maxCardPrice: number | null = null,
  maxGameChangers: number = Infinity,
  gameChangerCount: { value: number } = { value: 0 },
  maxRarity: MaxRarity = null,
  maxCmc: number | null = null,
  budgetTracker: BudgetTracker | null = null,
  collectionNames?: Set<string>,
  comboPriorityBoost?: Map<string, number>,
  currency: 'USD' | 'EUR' = 'USD',
  gameChangerNames: Set<string> = new Set()
): ScryfallCard[] {
  const result: ScryfallCard[] = [];

  // Filter and sort candidates (with combo boost if provided)
  const candidates = edhrecCards
    .filter(c => !usedNames.has(c.name) && !bannedCards.has(c.name))
    .sort((a, b) =>
      (calculateCardPriority(b) + (comboPriorityBoost?.get(b.name) ?? 0)) -
      (calculateCardPriority(a) + (comboPriorityBoost?.get(a.name) ?? 0))
    );

  for (const edhrecCard of candidates) {
    if (result.length >= count) break;

    const isGC = gameChangerNames.has(edhrecCard.name);

    // Skip game changers that exceed the limit
    if (isGC && gameChangerCount.value >= maxGameChangers) continue;

    // Skip cards not in the user's collection
    if (notInCollection(edhrecCard.name, collectionNames)) continue;

    const scryfallCard = cardMap.get(edhrecCard.name);
    if (!scryfallCard) continue;

    // Verify color identity matches commander's colors
    if (!fitsColorIdentity(scryfallCard, colorIdentity)) {
      continue;
    }

    const effectiveCap = budgetTracker?.getEffectiveCap(maxCardPrice) ?? maxCardPrice;
    if (exceedsMaxPrice(scryfallCard, effectiveCap, currency)) continue;
    if (exceedsMaxRarity(scryfallCard, maxRarity)) continue;
    if (exceedsCmcCap(scryfallCard, maxCmc)) continue;

    if (isGC) {
      scryfallCard.isGameChanger = true;
      gameChangerCount.value++;
    }
    result.push(scryfallCard);
    usedNames.add(edhrecCard.name);
    budgetTracker?.deductCard(scryfallCard);
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

  // New cards get a small relevancy boost to compensate for having fewer total decks,
  // but not enough to override established staples with high inclusion/synergy
  const newCardBoost = card.isNewCard ? 25 : 0;

  // If synergy score is high (> 0.3), boost the card
  if (synergy > 0.3) {
    return (synergy * 100) + inclusion + newCardBoost;
  }

  // For low/no synergy cards, just use inclusion
  return inclusion + newCardBoost;
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
  expectedType?: string,
  maxCardPrice: number | null = null,
  maxGameChangers: number = Infinity,
  gameChangerCount: { value: number } = { value: 0 },
  maxRarity: MaxRarity = null,
  maxCmc: number | null = null,
  budgetTracker: BudgetTracker | null = null,
  collectionNames?: Set<string>,
  comboPriorityBoost?: Map<string, number>,
  currency: 'USD' | 'EUR' = 'USD',
  gameChangerNames: Set<string> = new Set()
): ScryfallCard[] {
  const result: ScryfallCard[] = [];

  // Filter and sort ALL candidates by priority (synergy-aware + combo boost)
  const allCandidates = edhrecCards
    .filter(c => !usedNames.has(c.name) && !bannedCards.has(c.name))
    .sort((a, b) =>
      (calculateCardPriority(b) + (comboPriorityBoost?.get(b.name) ?? 0)) -
      (calculateCardPriority(a) + (comboPriorityBoost?.get(a.name) ?? 0))
    );

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

      const isGC = gameChangerNames.has(edhrecCard.name);

      // Skip game changers that exceed the limit
      if (isGC && gameChangerCount.value >= maxGameChangers) continue;

      // Skip cards not in the user's collection
      if (notInCollection(edhrecCard.name, collectionNames)) continue;

      const scryfallCard = cardMap.get(edhrecCard.name);
      if (!scryfallCard) continue;

      // Type check for Unknown cards (need to verify they match expected type via Scryfall)
      // Cards already categorized by EDHREC (primary_type !== 'Unknown') skip this check
      if (requireTypeCheckForUnknown && edhrecCard.primary_type === 'Unknown' && expectedType) {
        if (!matchesExpectedType(getFrontFaceTypeLine(scryfallCard), expectedType)) {
          continue;
        }
      }

      // Verify color identity
      if (!fitsColorIdentity(scryfallCard, colorIdentity)) {
        continue;
      }

      // Price limit check (uses dynamic cap if budget tracker is active)
      const effectiveCap = budgetTracker?.getEffectiveCap(maxCardPrice) ?? maxCardPrice;
      if (exceedsMaxPrice(scryfallCard, effectiveCap, currency)) {
        continue;
      }

      // Rarity limit check
      if (exceedsMaxRarity(scryfallCard, maxRarity)) {
        continue;
      }

      // CMC cap check (Tiny Leaders)
      if (exceedsCmcCap(scryfallCard, maxCmc)) {
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

      if (isGC) {
        scryfallCard.isGameChanger = true;
        gameChangerCount.value++;
      }
      result.push(scryfallCard);
      usedNames.add(edhrecCard.name);
      currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      budgetTracker?.deductCard(scryfallCard);
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
  bannedCards: Set<string> = new Set(),
  maxCardPrice: number | null = null,
  maxRarity: MaxRarity = null,
  maxCmc: number | null = null,
  budgetTracker: BudgetTracker | null = null,
  collectionNames?: Set<string>,
  currency: 'USD' | 'EUR' = 'USD'
): Promise<ScryfallCard[]> {
  if (count <= 0) return [];

  // Add rarity filter to Scryfall query if set
  let fullQuery = query;
  if (maxRarity) {
    fullQuery += ` r<=${maxRarity}`;
  }
  // Add CMC cap to Scryfall query (Tiny Leaders)
  if (maxCmc !== null) {
    fullQuery += ` cmc<=${maxCmc}`;
  }

  try {
    const response = await searchCards(fullQuery, colorIdentity, { order: 'edhrec' });
    const result: ScryfallCard[] = [];

    for (const card of response.data) {
      if (result.length >= count) break;
      if (usedNames.has(card.name)) continue; // Commander format is always singleton
      if (bannedCards.has(card.name)) continue; // Skip banned cards
      if (notInCollection(card.name, collectionNames)) continue;
      const effectiveCap = budgetTracker?.getEffectiveCap(maxCardPrice) ?? maxCardPrice;
      if (exceedsMaxPrice(card, effectiveCap, currency)) continue;
      if (exceedsMaxRarity(card, maxRarity)) continue;
      if (exceedsCmcCap(card, maxCmc)) continue;

      result.push(card);
      usedNames.add(card.name);
      budgetTracker?.deductCard(card);
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

// ============================================================
// Multi-copy card support ("A deck can have any number of...")
// ============================================================
const DEFAULT_MULTI_COPY_COUNT = 15; // Fallback when EDHREC average deck is unavailable

interface MultiCopyResult {
  card: ScryfallCard;
  copies: ScryfallCard[];
}

/**
 * Self-contained pipeline: detect "any number of copies" cards in the EDHREC cardlist,
 * fetch the recommended quantity from EDHREC's average deck, scale to deck size,
 * and return the copies to add. Returns empty array if no multi-copy cards found.
 *
 * Uses Scryfall oracle text search to dynamically detect multi-copy cards
 * rather than a hardcoded list, so new cards are automatically supported.
 */
async function resolveMultiCopyCards(
  edhrecCardNames: string[],
  commanderName: string,
  themeSlug: string | undefined,
  usedNames: Set<string>,
  deckSize: number,
  bannedCards: Set<string>,
  maxCardPrice: number | null,
  maxRarity: MaxRarity,
  currency: 'USD' | 'EUR' = 'USD',
): Promise<MultiCopyResult[]> {
  // Step 1: Fetch the set of all multi-copy cards from Scryfall (cached after first call)
  const multiCopyCards = await fetchMultiCopyCardNames();
  if (multiCopyCards.size === 0) return [];

  // Step 2: Check if any EDHREC card is a multi-copy card
  const matches = edhrecCardNames.filter(name => multiCopyCards.has(name) && !bannedCards.has(name));
  if (matches.length === 0) return [];

  console.log(`[DeckGen] Multi-copy cards detected in cardlist: ${matches.join(', ')}`);

  // Step 3: Fetch ALL quantities in one request (null = fetch failed entirely)
  const quantityMap = await fetchAverageDeckMultiCopies(commanderName, matches, themeSlug);
  const fetchFailed = quantityMap === null;

  const results: MultiCopyResult[] = [];

  for (const cardName of matches) {
    const maxCopies = multiCopyCards.get(cardName)!; // null = unlimited

    let quantity: number;
    if (fetchFailed) {
      // Endpoint unreachable — use a sensible fallback
      quantity = maxCopies ?? DEFAULT_MULTI_COPY_COUNT;
      console.log(`[DeckGen] Average deck unavailable, using fallback ${quantity} for "${cardName}"`);
    } else if (quantityMap.has(cardName)) {
      // Card found in average deck with >1 copies — use that count
      quantity = quantityMap.get(cardName)!;
    } else {
      // Fetch succeeded but card only has 1 copy in average deck — skip multi-copy
      console.log(`[DeckGen] "${cardName}" not multi-copy in average deck, skipping`);
      continue;
    }

    // Step 4: Scale to deck size (EDHREC data is based on 100-card decks)
    const scaledQuantity = Math.round(quantity * (deckSize / 100));
    let finalQuantity = Math.max(2, scaledQuantity); // Minimum 2 copies

    // Step 5: Respect maxCopies cap
    if (maxCopies !== null) {
      finalQuantity = Math.min(finalQuantity, maxCopies);
    }

    // Step 6: If already in deck as must-include, reduce count
    const existingCount = usedNames.has(cardName) ? 1 : 0;
    const copiesToAdd = finalQuantity - existingCount;
    if (copiesToAdd <= 0) {
      console.log(`[DeckGen] "${cardName}" already in deck, no extra copies needed`);
      continue;
    }

    // Step 7: Fetch the card from Scryfall
    try {
      const card = await getCardByName(cardName);
      if (!card) {
        console.warn(`[DeckGen] Could not find "${cardName}" on Scryfall, skipping multi-copy`);
        continue;
      }

      // Verify price/rarity constraints on the card itself
      if (exceedsMaxPrice(card, maxCardPrice, currency)) {
        console.log(`[DeckGen] "${cardName}" exceeds max card price, skipping multi-copy`);
        continue;
      }
      if (exceedsMaxRarity(card, maxRarity)) {
        console.log(`[DeckGen] "${cardName}" exceeds max rarity, skipping multi-copy`);
        continue;
      }

      // Step 8: Create copies with unique IDs
      const copies: ScryfallCard[] = [];
      for (let i = 0; i < copiesToAdd; i++) {
        copies.push({ ...card, id: `${card.id}-multi-${i}` });
      }

      console.log(`[DeckGen] Adding ${copiesToAdd} copies of "${cardName}" (scaled from ${quantity} in 100-card to ${finalQuantity} in ${deckSize}-card deck)`);
      results.push({ card, copies });
    } catch (error) {
      console.warn(`[DeckGen] Failed to fetch "${cardName}" for multi-copy:`, error);
    }
  }

  return results;
}

// Count color pips across all cards' mana costs (including hybrid mana)
function countColorPips(cards: ScryfallCard[]): Record<string, number> {
  const pips: Record<string, number> = {};
  // Match any mana symbol: {W}, {U/B}, {2/R}, {G/P}, etc.
  const symbolPattern = /\{([^}]+)\}/g;
  const colorLetters = new Set(['W', 'U', 'B', 'R', 'G']);
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
      while ((match = symbolPattern.exec(cost)) !== null) {
        // Extract every color letter from the symbol (handles hybrid like W/U, 2/R, G/P)
        for (const char of match[1]) {
          if (colorLetters.has(char)) {
            pips[char] = (pips[char] || 0) + 1;
          }
        }
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
  bannedCards: Set<string> = new Set(),
  maxCardPrice: number | null = null,
  maxRarity: MaxRarity = null,
  maxCmc: number | null = null,
  budgetTracker: BudgetTracker | null = null,
  collectionNames?: Set<string>,
  currency: 'USD' | 'EUR' = 'USD'
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
    const nonBasics = pickFromPrefetched(nonBasicEdhrecLands, landCardMap, nonBasicTarget, usedNames, colorIdentity, bannedCards, maxCardPrice, Infinity, { value: 0 }, maxRarity, maxCmc, budgetTracker, collectionNames, undefined, currency);
    lands.push(...nonBasics);
    console.log(`[DeckGen] Got ${nonBasics.length} non-basic lands:`, nonBasics.map(l => l.name));
  }

  // If we didn't get enough from EDHREC, search Scryfall for more
  if (lands.length < nonBasicTarget) {
    onProgress?.('Exploring uncharted territories...', 87);
    const query = colorIdentity.length > 0
      ? `t:land (${colorIdentity.map((c) => `o:{${c}}`).join(' OR ')}) -t:basic`
      : `t:land id:c -t:basic`;
    const moreLands = await fillWithScryfall(query, colorIdentity, nonBasicTarget - lands.length, usedNames, bannedCards, maxCardPrice, maxRarity, maxCmc, budgetTracker, collectionNames, currency);
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
    (card) => !getFrontFaceTypeLine(card).toLowerCase().includes('land')
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

  // Type distribution (use front face for MDFCs like "Instant // Land")
  const typeDistribution: Record<string, number> = {};
  allCards.forEach((card) => {
    const typeLine = getFrontFaceTypeLine(card).toLowerCase();
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
): { cardlists: EDHRECCommanderData['cardlists']; themeOverlapCounts: Map<string, number> } {
  // Track how many themes each card appears in (for hyper focus mode)
  const themeOverlapCounts = new Map<string, number>();

  // Merge all cards, keeping the best version for duplicates
  // Prioritize: highest synergy first, then highest inclusion
  const mergeCards = (
    cards: EDHRECCard[][],
  ): EDHRECCard[] => {
    const cardMap = new Map<string, EDHRECCard>();

    for (const cardList of cards) {
      // Track which cards we've seen in THIS theme's list to avoid double-counting
      const seenInThisList = new Set<string>();
      for (const card of cardList) {
        if (!seenInThisList.has(card.name)) {
          seenInThisList.add(card.name);
          themeOverlapCounts.set(card.name, (themeOverlapCounts.get(card.name) ?? 0) + 1);
        }

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

  const cardlists = {
    creatures: mergeCards(themeDataResults.map(r => r.cardlists.creatures)),
    instants: mergeCards(themeDataResults.map(r => r.cardlists.instants)),
    sorceries: mergeCards(themeDataResults.map(r => r.cardlists.sorceries)),
    artifacts: mergeCards(themeDataResults.map(r => r.cardlists.artifacts)),
    enchantments: mergeCards(themeDataResults.map(r => r.cardlists.enchantments)),
    planeswalkers: mergeCards(themeDataResults.map(r => r.cardlists.planeswalkers)),
    lands: mergeCards(themeDataResults.map(r => r.cardlists.lands)),
    allNonLand: mergeCards(themeDataResults.map(r => r.cardlists.allNonLand)),
  };

  return { cardlists, themeOverlapCounts };
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
  const maxCardPrice = customization.maxCardPrice ?? null;
  const budgetOption = customization.budgetOption !== 'any' ? customization.budgetOption : undefined;
  const bracketLevel = customization.bracketLevel !== 'all' ? customization.bracketLevel : undefined;
  const maxRarity = customization.maxRarity ?? null;
  const maxCmc = customization.tinyLeaders ? 3 : null;
  const maxGameChangers = customization.gameChangerLimit === 'none' ? 0
    : customization.gameChangerLimit === 'unlimited' ? Infinity
    : customization.gameChangerLimit;
  const gameChangerCount = { value: 0 };
  const deckBudget = customization.deckBudget ?? null;
  const currency = customization.currency ?? 'USD';
  console.log(`[DeckGen] Budget settings: deckBudget=${deckBudget}, maxCardPrice=${maxCardPrice}, budgetOption=${budgetOption}, currency=${currency}`);

  // Log banned cards if any
  if (bannedCards.size > 0) {
    console.log(`[DeckGen] Excluding ${bannedCards.size} banned cards:`, [...bannedCards]);
  }

  // Log collection mode
  if (context.collectionNames) {
    console.log(`[DeckGen] Collection mode: restricting to ${context.collectionNames.size} owned cards`);
  }

  // Add commander(s) to used names
  usedNames.add(commander.name);
  if (partnerCommander) {
    usedNames.add(partnerCommander.name);
  }

  // Pre-fetch basic lands, game changer list, and combo data in parallel
  onProgress?.('Shuffling the library...', 5);
  const comboCountSetting = customization.comboCount ?? 0;
  const [, gameChangerNames, combos] = await Promise.all([
    prefetchBasicLands(),
    getGameChangerNames(),
    fetchCommanderCombos(commander.name).catch(() => [] as EDHRECCombo[]),
  ]);
  console.log(`[DeckGen] Fetched ${combos.length} combos from EDHREC`);

  // Build combo priority boost map
  const comboPriorityBoost = new Map<string, number>();
  const comboCardNames = new Set<string>();
  if (comboCountSetting > 0 && combos.length > 0) {
    // Scale combo attempts by deck size (baseline: 99 cards → 1→3, 2→6)
    const sizeScale = Math.max(0.5, format / 99);
    const comboSliceCount = Math.max(1, Math.round(comboCountSetting * 3 * sizeScale));
    const combosToAttempt = combos.slice(0, comboSliceCount);
    for (const combo of combosToAttempt) {
      for (const card of combo.cards) {
        comboCardNames.add(card.name);
        const existing = comboPriorityBoost.get(card.name) ?? 0;
        // Boost needs to be large enough to override base priority (typically 50-200)
        const boost = 200 * (comboCountSetting / 2);
        comboPriorityBoost.set(card.name, existing + boost);
      }
    }
    console.log(`[DeckGen] Combo priority boost applied to ${comboPriorityBoost.size} unique cards from top ${combosToAttempt.length} combos`);
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

  // Track current curve distribution as we add cards (moved up for must-include cards)
  const currentCurveCounts: Record<number, number> = {};

  // Process must-include cards FIRST — they get priority over all other selections
  const mustIncludeNames = customization.mustIncludeCards?.filter(
    name => !bannedCards.has(name) && !usedNames.has(name)
  ) || [];

  if (mustIncludeNames.length > 0) {
    onProgress?.('Adding your must-include cards...', 3);
    console.log(`[DeckGen] Processing ${mustIncludeNames.length} must-include cards:`, mustIncludeNames);

    const mustIncludeMap = await getCardsByNames(mustIncludeNames);
    let addedCount = 0;

    for (const name of mustIncludeNames) {
      const card = mustIncludeMap.get(name);
      if (!card) {
        console.warn(`[DeckGen] Must-include card not found: "${name}"`);
        continue;
      }

      // Skip cards that don't fit the commander's color identity
      if (!fitsColorIdentity(card, colorIdentity)) {
        console.log(`[DeckGen] Must-include card "${name}" skipped (color identity mismatch)`);
        continue;
      }

      // Skip cards that exceed the max rarity limit
      if (exceedsMaxRarity(card, maxRarity)) {
        console.warn(`[DeckGen] Must-include card "${name}" skipped (rarity "${card.rarity}" exceeds max "${maxRarity}")`);
        continue;
      }

      // Skip non-land cards that exceed the CMC cap (Tiny Leaders)
      if (exceedsCmcCap(card, maxCmc)) {
        console.warn(`[DeckGen] Must-include card "${name}" skipped (CMC ${card.cmc} exceeds max ${maxCmc})`);
        continue;
      }

      usedNames.add(card.name);
      card.isMustInclude = true;
      addedCount++;

      // Categorize by front face type (handles MDFCs like "Instant // Land")
      const typeLine = getFrontFaceTypeLine(card).toLowerCase();
      if (typeLine.includes('land')) {
        categories.lands.push(card);
      } else if (typeLine.includes('creature')) {
        categories.creatures.push(card);
        const cmc = Math.min(Math.floor(card.cmc), 7);
        currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      } else if (typeLine.includes('instant')) {
        categorizeInstants([card], categories);
        const cmc = Math.min(Math.floor(card.cmc), 7);
        currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      } else if (typeLine.includes('sorcery')) {
        categorizeSorceries([card], categories);
        const cmc = Math.min(Math.floor(card.cmc), 7);
        currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      } else if (typeLine.includes('artifact')) {
        categorizeArtifacts([card], categories);
        const cmc = Math.min(Math.floor(card.cmc), 7);
        currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      } else if (typeLine.includes('enchantment')) {
        categorizeEnchantments([card], categories);
        const cmc = Math.min(Math.floor(card.cmc), 7);
        currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      } else if (typeLine.includes('planeswalker')) {
        categories.utility.push(card);
        const cmc = Math.min(Math.floor(card.cmc), 7);
        currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      } else {
        // Battle or other types
        categories.synergy.push(card);
        const cmc = Math.min(Math.floor(card.cmc), 7);
        currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      }
    }

    console.log(`[DeckGen] Added ${addedCount} must-include cards to deck`);

    // Cross-reference must-include cards with Scryfall game changer list
    const allAdded = Object.values(categories).flat();
    for (const card of allAdded) {
      if (card.isMustInclude && gameChangerNames.has(card.name)) {
        card.isGameChanger = true;
        gameChangerCount.value++;
      }
    }
    if (gameChangerCount.value > 0) {
      console.log(`[DeckGen] ${gameChangerCount.value} must-include card(s) are game changers`);
    }
  }

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
        partnerCommander
          ? fetchPartnerThemeData(commander.name, partnerCommander.name, theme.slug!, budgetOption, bracketLevel)
          : fetchCommanderThemeData(commander.name, theme.slug!, budgetOption, bracketLevel)
      );

      // If hyper focus is on, also fetch base commander data in parallel to compare
      const baseDataPromise = customization.hyperFocus
        ? (partnerCommander
            ? fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption, bracketLevel)
            : fetchCommanderData(commander.name, budgetOption, bracketLevel)
          ).catch(() => null)
        : Promise.resolve(null);

      const [themeDataResults, baseData] = await Promise.all([
        Promise.all(themeDataPromises),
        baseDataPromise,
      ]);

      // Merge cardlists from all themes
      const { cardlists: mergedCardlists, themeOverlapCounts } = mergeThemeCardlists(themeDataResults);

      // Build hyper focus boost map if enabled
      if (customization.hyperFocus && selectedThemesWithSlugs.length >= 1) {
        // Build a set of card names from the base (no-theme) commander pool
        // Cards in the base pool are "generic" — they show up regardless of theme
        const baseCardNames = new Set<string>();
        if (baseData) {
          for (const list of Object.values(baseData.cardlists)) {
            for (const card of list) {
              baseCardNames.add(card.name);
            }
          }
        }

        // Collect all theme cards
        const allThemeCards = [
          ...mergedCardlists.creatures,
          ...mergedCardlists.instants,
          ...mergedCardlists.sorceries,
          ...mergedCardlists.artifacts,
          ...mergedCardlists.enchantments,
          ...mergedCardlists.planeswalkers,
        ];

        if (selectedThemesWithSlugs.length === 1) {
          // Single theme: compare against base pool
          let boosted = 0, penalized = 0;
          for (const card of allThemeCards) {
            const synergy = card.synergy ?? 0;
            const inBase = baseCardNames.has(card.name);

            if (!inBase && synergy >= 0.1) {
              // NOT in base pool + has synergy — the dream cards, rocket them to the top
              comboPriorityBoost.set(card.name, (comboPriorityBoost.get(card.name) ?? 0) + 1000);
              boosted++;
            } else if (!inBase) {
              // Not in base pool but low synergy — still theme-exclusive, big boost
              comboPriorityBoost.set(card.name, (comboPriorityBoost.get(card.name) ?? 0) + 500);
              boosted++;
            } else if (inBase && synergy >= 0.3) {
              // In base pool but very high theme synergy — worth keeping
              comboPriorityBoost.set(card.name, (comboPriorityBoost.get(card.name) ?? 0) + 200);
              boosted++;
            } else if (inBase && synergy < 0.1) {
              // In base pool with low synergy — generic staple, nuke it
              comboPriorityBoost.set(card.name, (comboPriorityBoost.get(card.name) ?? 0) - 500);
              penalized++;
            }
          }
          console.log(`[DeckGen] Hyper Focus (single theme, base pool: ${baseCardNames.size} cards): boosted ${boosted}, penalized ${penalized}`);
        } else {
          // Multiple themes: use overlap counts + base pool comparison
          const numThemes = selectedThemesWithSlugs.length;
          for (const [name, count] of themeOverlapCounts) {
            const inBase = baseCardNames.has(name);
            let boost = 0;
            if (count === 1 && !inBase) {
              // Unique to one theme AND not in base — the gems
              boost = 1000;
            } else if (count === 1) {
              // Unique to one theme but in base — still good
              boost = 300;
            } else if (count >= numThemes || inBase) {
              // Appears in ALL themes or in base pool — nuke it
              boost = -500;
            } else {
              // Partial overlap — severe scaling penalty
              boost = -200 * (count - 1);
            }
            comboPriorityBoost.set(name, (comboPriorityBoost.get(name) ?? 0) + boost);
          }
          console.log(`[DeckGen] Hyper Focus (${numThemes} themes, base pool: ${baseCardNames.size} cards): adjusted ${themeOverlapCounts.size} cards`);
        }
      }

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
        edhrecData = partnerCommander
          ? await fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption, bracketLevel)
          : await fetchCommanderData(commander.name, budgetOption, bracketLevel);
        onProgress?.('Consulting ancient scrolls...', 12);
      } catch {
        onProgress?.('The oracle is silent... searching the multiverse...', 12);
      }
    }
  } else {
    // No themes selected - use base commander data (top recommended cards)
    onProgress?.('Consulting the wisdom of EDHREC...', 8);
    try {
      edhrecData = partnerCommander
        ? await fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption, bracketLevel)
        : await fetchCommanderData(commander.name, budgetOption, bracketLevel);
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

  // Compress curve targets for Tiny Leaders (CMC cap at 3)
  if (maxCmc !== null) {
    const totalNonLand = Object.values(curveTargets).reduce((s, v) => s + v, 0);
    // Redistribute all slots into 0..maxCmc buckets
    const compressed: Record<number, number> = {};
    for (let i = 0; i <= maxCmc; i++) compressed[i] = 0;
    // Keep existing counts for buckets within cap
    for (const [cmcStr, count] of Object.entries(curveTargets)) {
      const cmc = parseInt(cmcStr);
      if (cmc <= maxCmc) {
        compressed[cmc] = count;
      }
    }
    // Redistribute overflow into the capped buckets proportionally
    const kept = Object.values(compressed).reduce((s, v) => s + v, 0);
    const overflow = totalNonLand - kept;
    if (overflow > 0) {
      // Weight toward the top of the range (CMC 2-3 for Tiny Leaders)
      const weights: Record<number, number> = {};
      for (let i = 0; i <= maxCmc; i++) weights[i] = i === 0 ? 0.05 : i / maxCmc;
      const totalWeight = Object.values(weights).reduce((s, v) => s + v, 0);
      let distributed = 0;
      for (let i = 0; i <= maxCmc; i++) {
        const extra = Math.round(overflow * (weights[i] / totalWeight));
        compressed[i] += extra;
        distributed += extra;
      }
      // Fix rounding by adjusting the top bucket
      compressed[maxCmc] += overflow - distributed;
    }
    // Replace curve targets
    for (const key of Object.keys(curveTargets)) delete curveTargets[parseInt(key)];
    Object.assign(curveTargets, compressed);
    console.log('[DeckGen] Tiny Leaders: compressed curve targets to CMC <=', maxCmc, curveTargets);
  }

  // Debug: Log expected card counts
  const totalTypeTargets = Object.values(typeTargets).reduce((sum, v) => sum + v, 0);
  console.log('[DeckGen] Target type counts:', typeTargets);
  console.log('[DeckGen] Total non-land target:', totalTypeTargets, '(should be ~', format === 99 ? 99 - targets.lands : format - 1 - targets.lands, ')');
  console.log('[DeckGen] Target curve:', curveTargets);
  console.log('[DeckGen] Land target:', targets.lands);

  // Create budget tracker if deck budget is set
  const mustIncludeCards = Object.values(categories).flat();
  const nonLandSlotsTotal = totalTypeTargets - mustIncludeCards.filter(c => !getFrontFaceTypeLine(c).toLowerCase().includes('land')).length;
  const budgetTracker = deckBudget !== null
    ? new BudgetTracker(deckBudget, nonLandSlotsTotal + (customization.nonBasicLandCount ?? 15), currency)
    : null;

  // Deduct must-include costs from budget (commander cost is excluded from budget)
  if (budgetTracker && mustIncludeCards.length > 0) {
    budgetTracker.deductMustIncludes(mustIncludeCards);
  }

  // ---- Multi-copy card pipeline (self-contained, no impact if nothing found) ----
  if (edhrecData) {
    const allEdhrecNames = edhrecData.cardlists.allNonLand.map(c => c.name);
    const firstThemeSlug = selectedThemesWithSlugs.length > 0 ? selectedThemesWithSlugs[0].slug : undefined;
    const multiCopyResults = await resolveMultiCopyCards(
      allEdhrecNames,
      commander.name,
      firstThemeSlug,
      usedNames,
      format === 99 ? 100 : format, // EDHREC uses 100-card decks
      bannedCards,
      maxCardPrice,
      maxRarity,
      currency,
    );

    for (const { card, copies } of multiCopyResults) {
      // Categorize by front-face type (same pattern as must-includes)
      const typeLine = getFrontFaceTypeLine(card).toLowerCase();
      if (typeLine.includes('creature')) {
        categories.creatures.push(...copies);
      } else if (typeLine.includes('instant')) {
        categorizeInstants(copies, categories);
      } else if (typeLine.includes('sorcery')) {
        categorizeSorceries(copies, categories);
      } else if (typeLine.includes('artifact')) {
        categorizeArtifacts(copies, categories);
      } else if (typeLine.includes('enchantment')) {
        categorizeEnchantments(copies, categories);
      } else {
        categories.synergy.push(...copies);
      }

      // Update curve counts
      const cmc = Math.min(Math.floor(card.cmc), 7);
      currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + copies.length;

      // Deduct from budget
      if (budgetTracker) {
        for (const copy of copies) {
          budgetTracker.deductCard(copy);
        }
      }

      // Prevent normal selection from picking this card again
      usedNames.add(card.name);
    }
  }
  // ---- End multi-copy pipeline ----

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

    // Ensure combo piece cards are included in the batch fetch
    for (const name of comboCardNames) {
      allCardNames.add(name);
    }

    console.log(`[DeckGen] Batch fetching ${allCardNames.size} unique card names`);

    // SINGLE BATCH FETCH for all non-land cards
    onProgress?.('Summoning cards from Scryfall...', 25);
    const cardMap = await getCardsByNames([...allCardNames], (fetched, total) => {
      // Scale progress from 25% to 35% during the batch fetch
      const pct = 25 + Math.round((fetched / total) * 10);
      onProgress?.('Summoning cards from Scryfall...', pct);
    });
    console.log(`[DeckGen] Batch fetch returned ${cardMap.size} cards`);

    // Inject combo pieces into the correct type pools so they can actually be picked
    if (comboCardNames.size > 0) {
      const poolMap: Record<string, EDHRECCard[]> = {
        creature: creaturePool,
        instant: instantPool,
        sorcery: sorceryPool,
        artifact: artifactPool,
        enchantment: enchantmentPool,
        planeswalker: planeswalkerPool,
      };
      let injected = 0;
      for (const name of comboCardNames) {
        const scryfallCard = cardMap.get(name);
        if (!scryfallCard) continue;
        const typeLine = getFrontFaceTypeLine(scryfallCard).toLowerCase();
        for (const [type, pool] of Object.entries(poolMap)) {
          if (typeLine.includes(type) && !pool.some(c => c.name === name)) {
            pool.push({
              name,
              sanitized: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
              primary_type: type.charAt(0).toUpperCase() + type.slice(1),
              inclusion: 50,
              num_decks: 100,
              synergy: 0.5,
              isThemeSynergyCard: false,
              isGameChanger: false,
            });
            injected++;
          }
        }
      }
      if (injected > 0) {
        console.log(`[DeckGen] Injected ${injected} combo pieces into type pools`);
      }
    }

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
      'Creature',
      maxCardPrice,
      maxGameChangers,
      gameChangerCount,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      comboPriorityBoost,
      currency,
      gameChangerNames
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
        bannedCards,
        maxCardPrice,
        maxRarity,
        maxCmc,
        budgetTracker,
        context.collectionNames,
        currency
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
      'Instant',
      maxCardPrice,
      maxGameChangers,
      gameChangerCount,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      comboPriorityBoost,
      currency,
      gameChangerNames
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
      'Sorcery',
      maxCardPrice,
      maxGameChangers,
      gameChangerCount,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      comboPriorityBoost,
      currency,
      gameChangerNames
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
      'Artifact',
      maxCardPrice,
      maxGameChangers,
      gameChangerCount,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      comboPriorityBoost,
      currency,
      gameChangerNames
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
      'Enchantment',
      maxCardPrice,
      maxGameChangers,
      gameChangerCount,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      comboPriorityBoost,
      currency,
      gameChangerNames
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
        'Planeswalker',
        maxCardPrice,
        maxGameChangers,
        gameChangerCount,
        maxRarity,
        maxCmc,
        budgetTracker,
        context.collectionNames,
        comboPriorityBoost,
        currency,
        gameChangerNames
      );
      console.log(`[DeckGen] Planeswalkers: got ${planeswalkers.length} from EDHREC`);
      categories.utility.push(...planeswalkers);
    }

    // 7. Lands from EDHREC
    onProgress?.('Surveying the mana base...', 78);
    // Preserve must-include lands added earlier
    const mustIncludeLands = categories.lands.filter(c => c.isMustInclude);
    const adjustedLandTarget = Math.max(0, targets.lands - mustIncludeLands.length);
    // Use user's non-basic land preference from customization
    const nonbasicTarget = Math.min(customization.nonBasicLandCount, adjustedLandTarget);
    const basicCount = Math.max(0, adjustedLandTarget - nonbasicTarget);

    console.log('[DeckGen] Land targets (from user preference):', {
      totalLandTarget: targets.lands,
      mustIncludeLands: mustIncludeLands.length,
      adjustedLandTarget,
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
    categories.lands = [
      ...mustIncludeLands,
      ...await generateLands(
        cardlists.lands,
        colorIdentity,
        adjustedLandTarget,
        usedNames,
        basicCount,
        format,
        allNonLandCards,
        onProgress,
        bannedCards,
        maxCardPrice,
        maxRarity,
        maxCmc,
        budgetTracker,
        context.collectionNames,
        currency
      ),
    ];

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
      bannedCards,
      maxCardPrice,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      currency
    );

    onProgress?.('Seeking sources of knowledge...', 30);
    categories.cardDraw = await fillWithScryfall(
      'o:"draw" (t:instant OR t:sorcery OR t:enchantment)',
      colorIdentity,
      targets.cardDraw,
      usedNames,
      bannedCards,
      maxCardPrice,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      currency
    );

    onProgress?.('Arming with removal spells...', 40);
    categories.singleRemoval = await fillWithScryfall(
      '(o:"destroy target" OR o:"exile target") (t:instant OR t:sorcery)',
      colorIdentity,
      targets.singleRemoval,
      usedNames,
      bannedCards,
      maxCardPrice,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      currency
    );

    onProgress?.('Preparing mass destruction...', 50);
    categories.boardWipes = await fillWithScryfall(
      '(o:"destroy all" OR o:"exile all") (t:instant OR t:sorcery)',
      colorIdentity,
      targets.boardWipes,
      usedNames,
      bannedCards,
      maxCardPrice,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      currency
    );

    onProgress?.('Recruiting an army...', 60);
    categories.creatures = await fillWithScryfall(
      't:creature',
      colorIdentity,
      targets.creatures,
      usedNames,
      bannedCards,
      maxCardPrice,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      currency
    );

    onProgress?.('Finding synergistic pieces...', 70);
    categories.synergy = await fillWithScryfall(
      '(t:artifact OR t:enchantment)',
      colorIdentity,
      targets.synergy,
      usedNames,
      bannedCards,
      maxCardPrice,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      currency
    );

    onProgress?.('Surveying the mana base...', 80);
    // Preserve must-include lands added earlier
    const fallbackMustIncludeLands = categories.lands.filter(c => c.isMustInclude);
    const fallbackAdjustedLandTarget = Math.max(0, targets.lands - fallbackMustIncludeLands.length);
    // Use user's non-basic land preference
    const fallbackNonbasicTarget = Math.min(customization.nonBasicLandCount, fallbackAdjustedLandTarget);
    const fallbackBasicCount = Math.max(0, fallbackAdjustedLandTarget - fallbackNonbasicTarget);
    const fallbackNonLandCards = [
      ...categories.creatures,
      ...categories.ramp,
      ...categories.cardDraw,
      ...categories.singleRemoval,
      ...categories.boardWipes,
      ...categories.utility,
      ...categories.synergy,
    ];
    categories.lands = [
      ...fallbackMustIncludeLands,
      ...await generateLands(
        [],
        colorIdentity,
        fallbackAdjustedLandTarget,
        usedNames,
        fallbackBasicCount,
        format,
        fallbackNonLandCards,
        onProgress,
        bannedCards,
        maxCardPrice,
        maxRarity,
        maxCmc,
        budgetTracker,
        context.collectionNames,
        currency
      ),
    ];
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

  // Track how many basic lands are added as filler when collection is too small
  let basicLandFillCount = 0;

  // If we have too few cards, fill shortage — budget is best-effort here,
  // deck size and structure are non-negotiable
  currentCount = countAllCards();
  if (currentCount < targetDeckSize) {
    const shortage = targetDeckSize - currentCount;
    console.log(`[DeckGen] Deck shortage: need ${shortage} more cards (have ${currentCount}, need ${targetDeckSize})`);

    // For shortage fills: use a relaxed per-card cap derived from the budget
    // (5x the budget average) so we don't allow $84 cards in a $25 deck,
    // but still allow more flexibility than the strict budget tracker.
    // Falls back to the user's static maxCardPrice if no budget is set.
    const shortagePriceCap = deckBudget !== null
      ? Math.max(
          (deckBudget / Math.max(1, nonLandSlotsTotal + (customization.nonBasicLandCount ?? 15))) * 5,
          maxCardPrice ?? 0
        )
      : maxCardPrice;
    if (budgetTracker) {
      console.log(`[DeckGen] Budget exhausted — filling remaining slots with relaxed cap: $${shortagePriceCap?.toFixed(2) ?? 'none'}`);
    }

    // Try to fill with remaining EDHREC cards (relaxed budget cap)
    if (edhrecData && edhrecData.cardlists.allNonLand.length > 0) {
      const remainingEdhrecCards = edhrecData.cardlists.allNonLand
        .filter(c => !usedNames.has(c.name) && !bannedCards.has(c.name))
        .sort((a, b) => b.inclusion - a.inclusion);

      console.log(`[DeckGen] Found ${remainingEdhrecCards.length} remaining EDHREC cards to fill shortage`);

      const namesToFetch = remainingEdhrecCards.slice(0, shortage * 2).map(c => c.name);
      const fillCardMap = await getCardsByNames(namesToFetch);

      let filled = 0;
      for (const edhrecCard of remainingEdhrecCards) {
        if (filled >= shortage) break;

        const scryfallCard = fillCardMap.get(edhrecCard.name);
        if (!scryfallCard) continue;

        if (!fitsColorIdentity(scryfallCard, colorIdentity)) continue;
        if (notInCollection(edhrecCard.name, context.collectionNames)) continue;
        if (exceedsMaxPrice(scryfallCard, shortagePriceCap, currency)) continue;
        if (exceedsMaxRarity(scryfallCard, maxRarity)) continue;
        if (exceedsCmcCap(scryfallCard, maxCmc)) continue;

        categories.synergy.push(scryfallCard);
        usedNames.add(edhrecCard.name);
        filled++;
      }

      console.log(`[DeckGen] Filled ${filled} cards from remaining EDHREC suggestions`);
    }

    // If still short after EDHREC, use Scryfall (relaxed budget cap)
    currentCount = countAllCards();
    if (currentCount < targetDeckSize) {
      const stillNeeded = targetDeckSize - currentCount;
      console.log(`[DeckGen] Still need ${stillNeeded} more cards, using Scryfall fallback`);

      const moreSynergy = await fillWithScryfall(
        '(t:artifact OR t:enchantment OR t:creature)',
        colorIdentity,
        stillNeeded,
        usedNames,
        bannedCards,
        shortagePriceCap,
        maxRarity,
        maxCmc,
        null,
        context.collectionNames,
        currency
      );
      categories.synergy.push(...moreSynergy);
      console.log(`[DeckGen] Filled ${moreSynergy.length} cards from Scryfall`);
    }

    // If STILL short, add basic lands as absolute last resort
    currentCount = countAllCards();
    if (currentCount < targetDeckSize) {
      const remainingShortage = targetDeckSize - currentCount;
      basicLandFillCount = remainingShortage;
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

  // Log budget tracker summary
  if (budgetTracker) {
    const allDeckCards = Object.values(categories).flat();
    const totalSpent = allDeckCards.reduce((sum, c) => {
      const p = getCardPrice(c, currency);
      return sum + (p ? parseFloat(p) || 0 : 0);
    }, 0);
    const sym = currency === 'EUR' ? '€' : '$';
    console.log(`[BudgetTracker] Final: deck cards ${sym}${totalSpent.toFixed(2)} (budget: ${sym}${deckBudget}, excludes commander cost)`);
    console.log(`[BudgetTracker] Remaining: $${budgetTracker.remainingBudget.toFixed(2)}, cards left: ${budgetTracker.cardsRemaining}`);
  }

  // Calculate stats
  const stats = calculateStats(categories);

  // Get the theme names that were actually used
  const usedThemes = selectedThemesWithSlugs.length > 0
    ? selectedThemesWithSlugs.map(t => t.name)
    : undefined;

  // Gap analysis: find top unowned cards that would improve the deck
  let gapAnalysis: GapAnalysisCard[] | undefined;
  if (context.collectionNames && edhrecData) {
    const allDeckCardNames = new Set(Object.values(categories).flat().map(c => c.name));

    const gapCandidates = edhrecData.cardlists.allNonLand
      .filter(c =>
        !allDeckCardNames.has(c.name) &&
        !context.collectionNames!.has(c.name) &&
        !bannedCards.has(c.name)
      )
      .sort((a, b) => calculateCardPriority(b) - calculateCardPriority(a))
      .slice(0, 15);

    if (gapCandidates.length > 0) {
      const gapCardMap = await getCardsByNames(gapCandidates.map(c => c.name));

      gapAnalysis = gapCandidates
        .map(c => {
          const scryfall = gapCardMap.get(c.name);
          return {
            name: c.name,
            price: scryfall ? getCardPrice(scryfall, currency) : null,
            inclusion: c.inclusion,
            synergy: c.synergy ?? 0,
            typeLine: scryfall?.type_line ?? '',
            imageUrl: scryfall?.image_uris?.small,
          };
        })
        .filter(c => c.price !== null);

      console.log(`[DeckGen] Gap analysis: ${gapAnalysis.length} cards suggested for purchase`);
    }
  }

  // Detect combos present in the generated deck
  let detectedCombos: DetectedCombo[] | undefined;
  if (combos.length > 0) {
    const allDeckNames = new Set(Object.values(categories).flat().map(c => c.name));

    detectedCombos = combos
      .map(combo => {
        const comboCardNames = combo.cards.map(c => c.name);
        const missingCards = comboCardNames.filter(name => !allDeckNames.has(name));

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
      .filter(dc => dc.isComplete || dc.missingCards.length <= 2)
      .sort((a, b) => {
        if (a.isComplete !== b.isComplete) return a.isComplete ? -1 : 1;
        return b.deckCount - a.deckCount;
      });

    console.log(`[DeckGen] Detected ${detectedCombos.filter(c => c.isComplete).length} complete combos, ${detectedCombos.filter(c => !c.isComplete).length} near-misses`);

    if (detectedCombos.length === 0) detectedCombos = undefined;
  }

  return {
    commander,
    partnerCommander,
    categories,
    stats,
    usedThemes,
    gapAnalysis,
    detectedCombos,
    collectionShortfall: context.collectionNames && basicLandFillCount > 0 ? basicLandFillCount : undefined,
  };
}
