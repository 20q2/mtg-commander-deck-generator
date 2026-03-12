import type {
  ScryfallCard,
  GeneratedDeck,
  GapAnalysisCard,
  DetectedCombo,
  DeckStats,
  DeckCategory,
  DeckComposition,
  Customization,
  DeckFormat,
  DeckDataSource,
  ThemeResult,
  EDHRECCard,
  EDHRECCombo,
  EDHRECCommanderData,
  EDHRECCommanderStats,
  MaxRarity,
  BracketLevel,
  BudgetOption,
  CollectionStrategy,
} from '@/types';
import { searchCards, getCardByName, getCardsByNames, prefetchBasicLands, getCachedCard, getGameChangerNames, getCardPrice, getFrontFaceTypeLine, fetchMultiCopyCardNames, parseSetFromQuery, upgradeCardPrintings } from '@/services/scryfall/client';
import { fetchCommanderData, fetchCommanderThemeData, fetchPartnerCommanderData, fetchPartnerThemeData, fetchAverageDeckMultiCopies, fetchCommanderCombos } from '@/services/edhrec/client';
import {
  calculateTypeTargets,
  calculateCurveTargets,
  hasCurveRoom,
} from './curveUtils';
import { loadTaggerData, hasTaggerData, getCardRole, getCardSubtype, hasMultipleRoles, getRampSubtype, getRemovalSubtype, getBoardwipeSubtype, getCardDrawSubtype, type RoleKey } from '@/services/tagger/client';
import { loadUserLists } from '@/hooks/useUserLists';

interface GenerationContext {
  commander: ScryfallCard;
  partnerCommander: ScryfallCard | null;
  colorIdentity: string[];
  customization: Customization;
  selectedThemes?: ThemeResult[];
  collectionNames?: Set<string>;
  optimizeDeckCards?: string[];
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

// Apply user's advanced target overrides (curve percentages, type percentages)
function applyAdvancedOverrides(
  customization: Customization,
  typeTargets: Record<string, number>,
  curveTargets: Record<number, number>,
  nonLandCards: number
): void {
  const adv = customization.advancedTargets;

  if (adv?.curvePercentages) {
    const pcts = adv.curvePercentages;
    const total = Object.values(pcts).reduce((s, v) => s + v, 0) || 100;
    let allocated = 0;
    const cmcKeys = Object.keys(pcts).map(Number).sort((a, b) => a - b);
    for (const cmc of cmcKeys) {
      curveTargets[cmc] = Math.round((pcts[cmc] / total) * nonLandCards);
      allocated += curveTargets[cmc];
    }
    const diff = nonLandCards - allocated;
    if (diff !== 0) {
      const largest = cmcKeys.reduce((m, c) => (curveTargets[c] > curveTargets[m]) ? c : m, cmcKeys[0]);
      curveTargets[largest] += diff;
    }
  }

  if (adv?.typePercentages) {
    const pcts = adv.typePercentages;
    const total = Object.values(pcts).reduce((s, v) => s + v, 0) || 100;
    let allocated = 0;
    for (const type of Object.keys(pcts)) {
      typeTargets[type] = Math.round((pcts[type] / total) * nonLandCards);
      allocated += typeTargets[type];
    }
    const diff = nonLandCards - allocated;
    if (diff !== 0) {
      typeTargets.creature = (typeTargets.creature ?? 0) + diff;
    }
  }
}

// Calculate target counts for each category based on EDHREC stats or fallback defaults
function calculateTargetCounts(
  customization: Customization,
  edhrecStats?: EDHRECCommanderStats,
  hasPartner?: boolean
): TargetCountsResult {
  const format = customization.deckFormat;

  // Calculate total deck cards — account for partner commanders taking an extra slot
  const commanderCount = hasPartner ? 2 : 1;
  const deckCards = format === 99 ? (100 - commanderCount) : (format - commanderCount);

  // Respect the user's land count — clamp only to sane absolute bounds
  const landCount = Math.min(Math.max(1, customization.landCount), deckCards - 1);
  const nonLandCards = deckCards - landCount;

  // If we have EDHREC stats, use percentage-based targets
  if (edhrecStats && edhrecStats.numDecks > 0) {
    const typeTargets = calculateTypeTargets(edhrecStats, nonLandCards);
    const curveTargets = calculateCurveTargets(edhrecStats.manaCurve, nonLandCards);

    // Composition is now just for tracking - actual selection uses typeTargets
    const composition: DeckComposition = {
      lands: landCount,
      creatures: typeTargets.creature ?? 0,
      // These will be populated during card categorization
      singleRemoval: 0,
      boardWipes: 0,
      ramp: 0,
      cardDraw: 0,
      synergy: 0,
      utility: typeTargets.planeswalker ?? 0,
    };

    // Apply advanced target overrides if set
    applyAdvancedOverrides(customization, typeTargets, curveTargets, nonLandCards);

    return { composition, typeTargets, curveTargets };
  }

  // Fallback defaults for different formats (no usable EDHREC stats)
  console.warn('[DeckGen] FALLBACK: No EDHREC stats (numDecks=0 or missing) — using fallback type/curve targets');
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
      lands: landCount,
      ramp: 4,
      cardDraw: 4,
      singleRemoval: 5,
      boardWipes: 2,
      creatures: 15,
      synergy: 6,
      utility: 0,
    },
    40: {
      lands: landCount,
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
  // Fallback type targets — distribute nonLandCards across types using rough proportions
  // These MUST sum to nonLandCards; previous approach double-counted functional roles
  const rawTypeWeights = {
    creature: 0.40,
    instant: 0.15,
    sorcery: 0.12,
    artifact: 0.14,
    enchantment: 0.12,
    planeswalker: 0.04,
    battle: 0,
  };
  const fallbackTypeTargets: Record<string, number> = {};
  let fallbackAllocated = 0;
  for (const [type, weight] of Object.entries(rawTypeWeights)) {
    const target = Math.round(nonLandCards * weight);
    fallbackTypeTargets[type] = target;
    fallbackAllocated += target;
  }
  // Fix rounding — adjust creatures to hit exact total
  const fallbackDiff = nonLandCards - fallbackAllocated;
  if (fallbackDiff !== 0) {
    fallbackTypeTargets.creature = (fallbackTypeTargets.creature || 0) + fallbackDiff;
  }

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

  // Apply advanced target overrides if set
  applyAdvancedOverrides(customization, fallbackTypeTargets, fallbackCurveTargets, nonLandCards);

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

// Check if a card is not available on MTG Arena (for Arena-only mode)
function notOnArena(card: ScryfallCard, arenaOnly: boolean): boolean {
  if (!arenaOnly) return false;
  return !card.games?.includes('arena');
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
  gameChangerNames: Set<string> = new Set(),
  arenaOnly: boolean = false,
  collectionStrategy: CollectionStrategy = 'full',
  collectionOwnedPercent: number = 100
): ScryfallCard[] {
  const result: ScryfallCard[] = [];

  // Filter and sort candidates (with combo boost if provided)
  const candidates = edhrecCards
    .filter(c => !usedNames.has(c.name) && !bannedCards.has(c.name))
    .sort((a, b) =>
      (calculateCardPriority(b) + (comboPriorityBoost?.get(b.name) ?? 0)) -
      (calculateCardPriority(a) + (comboPriorityBoost?.get(a.name) ?? 0))
    );

  // Shared validation for a single candidate
  const tryPick = (edhrecCard: EDHRECCard): boolean => {
    const isGC = gameChangerNames.has(edhrecCard.name);
    if (isGC && gameChangerCount.value >= maxGameChangers) return false;

    const scryfallCard = cardMap.get(edhrecCard.name);
    if (!scryfallCard) return false;
    if (!fitsColorIdentity(scryfallCard, colorIdentity)) return false;

    const effectiveCap = budgetTracker?.getEffectiveCap(maxCardPrice) ?? maxCardPrice;
    if (exceedsMaxPrice(scryfallCard, effectiveCap, currency)) return false;
    if (exceedsMaxRarity(scryfallCard, maxRarity)) return false;
    if (exceedsCmcCap(scryfallCard, maxCmc)) return false;
    if (notOnArena(scryfallCard, arenaOnly)) return false;

    if (isGC) {
      scryfallCard.isGameChanger = true;
      gameChangerCount.value++;
    }
    result.push(scryfallCard);
    usedNames.add(edhrecCard.name);
    if (scryfallCard.name !== edhrecCard.name) usedNames.add(scryfallCard.name);
    budgetTracker?.deductCard(scryfallCard);
    return true;
  };

  if (collectionNames && collectionStrategy === 'partial') {
    // Two-phase picking: respect owned percentage target
    const ownedTarget = Math.round(count * collectionOwnedPercent / 100);
    const unownedTarget = count - ownedTarget;

    const ownedCandidates = candidates.filter(c => collectionNames.has(c.name));
    const unownedCandidates = candidates.filter(c => !collectionNames.has(c.name));

    // Phase 1: Pick from owned cards up to ownedTarget
    let ownedPicked = 0;
    for (const card of ownedCandidates) {
      if (ownedPicked >= ownedTarget || result.length >= count) break;
      if (tryPick(card)) ownedPicked++;
    }

    // Phase 2: Pick from unowned cards up to unownedTarget
    let unownedPicked = 0;
    for (const card of unownedCandidates) {
      if (unownedPicked >= unownedTarget || result.length >= count) break;
      if (tryPick(card)) unownedPicked++;
    }

    // Phase 3: If either phase fell short, fill from the other pool
    if (result.length < count) {
      for (const card of ownedCandidates) {
        if (result.length >= count) break;
        if (usedNames.has(card.name)) continue;
        tryPick(card);
      }
    }
    if (result.length < count) {
      for (const card of unownedCandidates) {
        if (result.length >= count) break;
        if (usedNames.has(card.name)) continue;
        tryPick(card);
      }
    }
  } else {
    // Full mode or no collection: simple linear pick
    for (const edhrecCard of candidates) {
      if (result.length >= count) break;
      if (collectionStrategy === 'full' && notInCollection(edhrecCard.name, collectionNames)) continue;
      tryPick(edhrecCard);
    }
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
  gameChangerNames: Set<string> = new Set(),
  arenaOnly: boolean = false,
  strictCurve: boolean = false,
  collectionStrategy: CollectionStrategy = 'full',
  collectionOwnedPercent: number = 100
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

  // Partial mode: track ownership quotas across all phases
  const isPartialMode = collectionNames && collectionStrategy === 'partial';
  const ownedTarget = isPartialMode ? Math.round(count * collectionOwnedPercent / 100) : count;
  const unownedTarget = isPartialMode ? count - ownedTarget : count;
  let ownedPicked = 0;
  let unownedPicked = 0;
  let enforceQuotas = true; // Relaxed in fill pass

  const processCards = (candidates: EDHRECCard[], requireTypeCheckForUnknown: boolean): void => {
    for (const edhrecCard of candidates) {
      if (result.length >= count) break;

      const isGC = gameChangerNames.has(edhrecCard.name);

      // Skip game changers that exceed the limit
      if (isGC && gameChangerCount.value >= maxGameChangers) continue;

      // Collection filtering
      if (collectionStrategy === 'full' && notInCollection(edhrecCard.name, collectionNames)) continue;
      if (isPartialMode && enforceQuotas) {
        const isOwned = collectionNames!.has(edhrecCard.name);
        if (isOwned && ownedPicked >= ownedTarget) continue;
        if (!isOwned && unownedPicked >= unownedTarget) continue;
      }

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

      // Arena-only check
      if (notOnArena(scryfallCard, arenaOnly)) {
        continue;
      }

      // Curve enforcement - but high synergy cards get more leniency
      const cmc = Math.min(Math.floor(scryfallCard.cmc), 7);
      if (!hasCurveRoom(cmc, curveTargets, currentCurveCounts)) {
        if (strictCurve) {
          // User explicitly set curve targets — respect them strictly
          continue;
        }
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
      if (scryfallCard.name !== edhrecCard.name) usedNames.add(scryfallCard.name);
      currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      budgetTracker?.deductCard(scryfallCard);

      // Track ownership for quota enforcement
      if (isPartialMode) {
        if (collectionNames!.has(edhrecCard.name)) ownedPicked++;
        else unownedPicked++;
      }
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

  // Phase 4: If quotas left slots unfilled, relax and fill from any remaining candidates
  if (isPartialMode && result.length < count) {
    enforceQuotas = false;
    processCards(highSynergyCards, true);
    if (result.length < count) processCards(regularTypedCards, false);
    if (result.length < count) processCards(regularUnknownCards, true);
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
  if (normalizedType === 'artifact') return normalizedTypeLine.includes('artifact') && !normalizedTypeLine.includes('creature') && !normalizedTypeLine.includes('land');
  if (normalizedType === 'enchantment') return normalizedTypeLine.includes('enchantment') && !normalizedTypeLine.includes('creature') && !normalizedTypeLine.includes('land');
  if (normalizedType === 'planeswalker') return normalizedTypeLine.includes('planeswalker');
  if (normalizedType === 'battle') return normalizedTypeLine.includes('battle');
  if (normalizedType === 'land') return normalizedTypeLine.includes('land');

  return false;
}

const ROLE_TO_CATEGORY: Record<RoleKey, DeckCategory> = {
  ramp: 'ramp',
  removal: 'singleRemoval',
  boardwipe: 'boardWipes',
  cardDraw: 'cardDraw',
};

// Categorize cards by functional role using Scryfall tagger data.
// Cards without a tagger role go to the given fallback category (typically 'synergy').
function categorizeCards(
  cards: ScryfallCard[],
  categories: Record<DeckCategory, ScryfallCard[]>,
  fallback: DeckCategory = 'synergy'
): void {
  for (const card of cards) {
    const role = getCardRole(card.name);
    categories[role ? ROLE_TO_CATEGORY[role] : fallback].push(card);
  }
}

// Stamp all role subtypes on a card based on its deckRole
function stampRoleSubtypes(card: ScryfallCard): void {
  card.multiRole = hasMultipleRoles(card.name);
  switch (card.deckRole) {
    case 'ramp': card.rampSubtype = getRampSubtype(card.name) ?? undefined; break;
    case 'removal': card.removalSubtype = getRemovalSubtype(card.name) ?? undefined; break;
    case 'boardwipe': card.boardwipeSubtype = getBoardwipeSubtype(card.name) ?? undefined; break;
    case 'cardDraw': card.cardDrawSubtype = getCardDrawSubtype(card.name) ?? undefined; break;
  }
}

/** Map a ScryfallCard to a type-based swap bucket key, or null for lands. */
function getPrimaryTypeKey(card: ScryfallCard): string | null {
  const t = getFrontFaceTypeLine(card).toLowerCase();
  if (t.includes('land')) return null;
  if (t.includes('creature')) return 'type:creature';
  if (t.includes('instant')) return 'type:instant';
  if (t.includes('sorcery')) return 'type:sorcery';
  if (t.includes('artifact')) return 'type:artifact';
  if (t.includes('enchantment')) return 'type:enchantment';
  if (t.includes('planeswalker')) return 'type:planeswalker';
  return null;
}

// Collect swap candidates from pools — eligible cards that weren't selected, grouped by role or card type
function collectSwapCandidates(
  pools: EDHRECCard[][],
  cardMap: Map<string, ScryfallCard>,
  usedNames: Set<string>,
  colorIdentity: string[],
  bannedCards: Set<string>,
  maxCardPrice: number | null,
  maxRarity: MaxRarity,
  maxCmc: number | null,
  collectionNames: Set<string> | undefined,
  currency: 'USD' | 'EUR',
  arenaOnly: boolean,
  collectionStrategy: CollectionStrategy = 'full',
  limitPerBucket: number = 15,
): Record<string, ScryfallCard[]> {
  const result: Record<string, ScryfallCard[]> = {
    ramp: [], removal: [], boardwipe: [], cardDraw: [],
    'type:creature': [], 'type:instant': [], 'type:sorcery': [],
    'type:artifact': [], 'type:enchantment': [], 'type:planeswalker': [],
  };
  const seen = new Set<string>();

  for (const pool of pools) {
    for (const edhrecCard of pool) {
      if (usedNames.has(edhrecCard.name) || bannedCards.has(edhrecCard.name)) continue;
      if (seen.has(edhrecCard.name)) continue;
      if (collectionStrategy === 'full' && notInCollection(edhrecCard.name, collectionNames)) continue;

      const scryfallCard = cardMap.get(edhrecCard.name);
      if (!scryfallCard) continue;

      // Determine bucket: role-based if tagged, otherwise type-based
      const role = getCardRole(scryfallCard.name);
      const bucket = role ?? getPrimaryTypeKey(scryfallCard);
      if (!bucket) continue;
      if ((result[bucket]?.length ?? 0) >= limitPerBucket) continue;

      if (!fitsColorIdentity(scryfallCard, colorIdentity)) continue;
      if (exceedsMaxPrice(scryfallCard, maxCardPrice, currency)) continue;
      if (exceedsMaxRarity(scryfallCard, maxRarity)) continue;
      if (exceedsCmcCap(scryfallCard, maxCmc)) continue;
      if (notOnArena(scryfallCard, arenaOnly)) continue;

      if (role) {
        scryfallCard.deckRole = role;
        stampRoleSubtypes(scryfallCard);
      }
      result[bucket].push(scryfallCard);
      seen.add(edhrecCard.name);
    }
  }

  return result;
}

// Role targets by deck size — used by balanced roles mode
function getRoleTargets(format: DeckFormat): Record<RoleKey, number> {
  if (format >= 99) return { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 };
  if (format >= 60) return { ramp: 4, removal: 5, boardwipe: 2, cardDraw: 4 };
  if (format >= 40) return { ramp: 2, removal: 3, boardwipe: 1, cardDraw: 2 };
  // Scale proportionally from 99-card baseline
  const ratio = format / 99;
  return {
    ramp: Math.max(1, Math.round(10 * ratio)),
    removal: Math.max(1, Math.round(8 * ratio)),
    boardwipe: Math.max(0, Math.round(3 * ratio)),
    cardDraw: Math.max(1, Math.round(10 * ratio)),
  };
}

// Compute role-deficit boost map for balanced roles mode
// Subtypes per role for diversity calculations
const ROLE_SUBTYPES: Record<string, string[]> = {
  ramp: ['mana-producer', 'mana-rock', 'cost-reducer', 'ramp'],
  removal: ['counterspell', 'bounce', 'spot-removal', 'removal'],
  boardwipe: ['bounce-wipe', 'boardwipe'],
  cardDraw: ['tutor', 'wheel', 'cantrip', 'card-draw', 'card-advantage'],
};

function computeRoleBoosts(
  cardRoleMap: Map<string, RoleKey>,
  roleTargets: Record<RoleKey, number>,
  currentRoleCounts: Record<RoleKey, number>,
  baseBoosts?: Map<string, number>,
  cardCmcMap?: Map<string, number>,
  cardSubtypeMap?: Map<string, string>,
  currentSubtypeCounts?: Record<string, number>,
  strictRoles: boolean = false
): Map<string, number> {
  const boosts = new Map<string, number>(baseBoosts ?? []);

  // Pre-compute peer average counts per role for subtype diversity
  const peerAverages: Record<string, number> = {};
  if (cardSubtypeMap && currentSubtypeCounts) {
    for (const [role, subtypes] of Object.entries(ROLE_SUBTYPES)) {
      const total = subtypes.reduce((sum, st) => sum + (currentSubtypeCounts[st] ?? 0), 0);
      peerAverages[role] = subtypes.length > 0 ? total / subtypes.length : 0;
    }
  }

  for (const [name, role] of cardRoleMap) {
    const target = roleTargets[role];
    const current = currentRoleCounts[role] ?? 0;

    // When user explicitly set role targets, penalize roles that are at or over target
    if (strictRoles) {
      if (target <= 0) {
        // Target is 0 — strongly penalize cards with this role
        boosts.set(name, (boosts.get(name) ?? 0) - 100);
        continue;
      }
      if (current >= target) {
        // Already met target — penalize further cards with this role
        const surplus = current - target;
        boosts.set(name, (boosts.get(name) ?? 0) - 50 - (surplus * 15));
        continue;
      }
    } else {
      if (target <= 0) continue;
    }

    const deficit = Math.max(0, target - current);
    if (deficit > 0) {
      // Stronger boost when user explicitly set targets (up to 120 vs 75)
      const maxBoost = strictRoles ? 120 : 75;
      const roleBoost = (deficit / target) * maxBoost;
      // Early ramp bonus: prefer low-CMC mana producers for reliable early acceleration
      let earlyRampMultiplier = 1.0;
      if (role === 'ramp' && cardCmcMap) {
        const cmc = cardCmcMap.get(name);
        if (cmc !== undefined) {
          if (cmc <= 1) earlyRampMultiplier = 2.0;       // Sol Ring, Birds of Paradise, Llanowar Elves
          else if (cmc <= 2) earlyRampMultiplier = 1.5;   // Arcane Signet, Fellwar Stone
          else if (cmc <= 3) earlyRampMultiplier = 1.2;   // Cultivate, Kodama's Reach
        }
      }
      // Subtype diversity: penalize over-represented subtypes, bonus for unrepresented ones
      let diversityMultiplier = 1.0;
      if (cardSubtypeMap && currentSubtypeCounts) {
        const subtype = cardSubtypeMap.get(name);
        if (subtype) {
          const subtypeCount = currentSubtypeCounts[subtype] ?? 0;
          const avg = peerAverages[role] ?? 0;
          const excess = subtypeCount - avg;
          if (excess > 1) {
            // Gradually reduce boost: 0.9x at +2, 0.8x at +3, floor at 0.4x
            diversityMultiplier = Math.max(0.4, 1.0 - (excess - 1) * 0.1);
          } else if (subtypeCount === 0) {
            // Encourage picking the first of each subtype
            diversityMultiplier = 1.25;
          }
        }
      }
      boosts.set(name, (boosts.get(name) ?? 0) + roleBoost * earlyRampMultiplier * diversityMultiplier);
    }
  }
  return boosts;
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
  currency: 'USD' | 'EUR' = 'USD',
  arenaOnly: boolean = false,
  scryfallQuery: string = '',
  collectionStrategy: CollectionStrategy = 'full'
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
  // Restrict to Arena-available cards
  if (arenaOnly) {
    fullQuery += ` game:arena`;
  }
  // Append user's additional Scryfall filters
  if (scryfallQuery.trim()) {
    fullQuery += ` ${scryfallQuery.trim()}`;
  }

  try {
    const response = await searchCards(fullQuery, colorIdentity, { order: 'edhrec' });
    const result: ScryfallCard[] = [];

    for (const card of response.data) {
      if (result.length >= count) break;
      if (usedNames.has(card.name)) continue; // Commander format is always singleton
      if (bannedCards.has(card.name)) continue; // Skip banned cards
      if (collectionStrategy === 'full' && notInCollection(card.name, collectionNames)) continue;
      const effectiveCap = budgetTracker?.getEffectiveCap(maxCardPrice) ?? maxCardPrice;
      if (exceedsMaxPrice(card, effectiveCap, currency)) continue;
      if (exceedsMaxRarity(card, maxRarity)) continue;
      if (exceedsCmcCap(card, maxCmc)) continue;
      if (notOnArena(card, arenaOnly)) continue;

      result.push(card);
      usedNames.add(card.name);
      // Also mark front-face name for DFCs so EDHREC-sourced checks match
      if (card.name.includes(' // ')) usedNames.add(card.name.split(' // ')[0]);
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
  currency: 'USD' | 'EUR' = 'USD',
  arenaOnly: boolean = false,
  scryfallQuery: string = '',
  preferredSet?: string,
  collectionStrategy: CollectionStrategy = 'full',
  collectionOwnedPercent: number = 100
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

    const landCardMap = await getCardsByNames(landNamesToFetch, undefined, preferredSet);
    if (preferredSet) {
      for (const [name, card] of landCardMap) {
        if (card.set !== preferredSet) landCardMap.delete(name);
      }
    }
    await upgradeCardPrintings(landCardMap, scryfallQuery, true);
    const nonBasics = pickFromPrefetched(nonBasicEdhrecLands, landCardMap, nonBasicTarget, usedNames, colorIdentity, bannedCards, maxCardPrice, Infinity, { value: 0 }, maxRarity, maxCmc, budgetTracker, collectionNames, undefined, currency, new Set(), arenaOnly, collectionStrategy, collectionOwnedPercent);
    lands.push(...nonBasics);
    console.log(`[DeckGen] Got ${nonBasics.length} non-basic lands:`, nonBasics.map(l => l.name));
  }

  // If we didn't get enough from EDHREC, search Scryfall for more
  if (lands.length < nonBasicTarget) {
    onProgress?.('Exploring uncharted territories...', 87);
    const query = colorIdentity.length > 0
      ? `t:land (${colorIdentity.map((c) => `o:{${c}}`).join(' OR ')}) -t:basic`
      : `t:land id:c -t:basic`;
    const moreLands = await fillWithScryfall(query, colorIdentity, nonBasicTarget - lands.length, usedNames, bannedCards, maxCardPrice, maxRarity, maxCmc, budgetTracker, collectionNames, currency, arenaOnly, scryfallQuery, collectionStrategy);
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
export function calculateStats(categories: Record<DeckCategory, ScryfallCard[]>): DeckStats {
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

// ---- Fast regeneration cache ----
// Caches EDHREC + Scryfall data from the first generation so regenerations
// (ban a card, add a must-include, tweak settings) can skip the fetch phase entirely.
interface GenerationCache {
  edhrecData: EDHRECCommanderData;
  baseData: EDHRECCommanderData | null;
  cardMap: Map<string, ScryfallCard>;
  themeOverlapCounts: Map<string, number>;
  combos: EDHRECCombo[];
  gameChangerNames: Set<string>;
  dataSource: DeckDataSource;
  representativeStats: EDHRECCommanderStats;
  // Cache keys — ALL must match for a cache hit
  commanderName: string;
  partnerName: string | null;
  themeSlugs: string[];
  bracketLevel: BracketLevel | undefined;
  budgetOption: BudgetOption | undefined;
}

let generationCache: GenerationCache | null = null;

function buildCacheKey(context: GenerationContext) {
  const { commander, partnerCommander, customization } = context;
  const selectedThemesWithSlugs = context.selectedThemes?.filter(
    t => t.isSelected && t.source === 'edhrec' && t.slug
  ) || [];
  return {
    commanderName: commander.name,
    partnerName: partnerCommander?.name ?? null,
    themeSlugs: selectedThemesWithSlugs.map(t => t.slug!).sort(),
    bracketLevel: (customization.bracketLevel !== 'all' ? customization.bracketLevel : undefined) as BracketLevel | undefined,
    budgetOption: (customization.budgetOption !== 'any' ? customization.budgetOption : undefined) as BudgetOption | undefined,
  };
}

function isCacheValid(context: GenerationContext): boolean {
  if (!generationCache) return false;
  const key = buildCacheKey(context);
  return (
    generationCache.commanderName === key.commanderName &&
    generationCache.partnerName === key.partnerName &&
    generationCache.bracketLevel === key.bracketLevel &&
    generationCache.budgetOption === key.budgetOption &&
    generationCache.themeSlugs.length === key.themeSlugs.length &&
    generationCache.themeSlugs.every((s, i) => s === key.themeSlugs[i])
  );
}

export function clearGenerationCache(): void {
  generationCache = null;
  console.log('[DeckGen] Generation cache cleared');
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

  // Helper: mark a card name as used, including front-face name for DFCs
  // EDHREC uses front-face-only names while Scryfall uses "Front // Back"
  function markUsed(name: string) {
    usedNames.add(name);
    if (name.includes(' // ')) {
      usedNames.add(name.split(' // ')[0]);
    }
  }
  const bannedCards = new Set(customization.bannedCards || []);
  // Merge enabled ban lists into the banned set
  for (const list of customization.banLists || []) {
    if (list.enabled) list.cards.forEach(c => bannedCards.add(c));
  }
  // Merge applied exclude user lists
  const userLists = loadUserLists();
  for (const ref of customization.appliedExcludeLists || []) {
    if (ref.enabled) {
      const list = userLists.find(l => l.id === ref.listId);
      if (list) list.cards.forEach(c => bannedCards.add(c));
    }
  }
  // Merge temporary banned cards
  const tempBanned = customization.tempBannedCards ?? [];
  if (tempBanned.length > 0) {
    console.log(`[DeckGen] Temp banned cards:`, tempBanned);
    tempBanned.forEach(c => bannedCards.add(c));
  }
  const maxCardPrice = customization.maxCardPrice ?? null;
  const budgetOption = customization.budgetOption !== 'any' ? customization.budgetOption : undefined;
  const bracketLevel = customization.bracketLevel !== 'all' ? customization.bracketLevel : undefined;
  const maxRarity = customization.maxRarity ?? null;
  const maxCmc = customization.tinyLeaders ? 3 : null;
  const arenaOnly = !!customization.arenaOnly;
  const scryfallQuery = customization.scryfallQuery ?? '';
  const preferredSet = parseSetFromQuery(scryfallQuery);
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
  const collectionStrategy: CollectionStrategy = customization.collectionStrategy ?? 'full';
  const collectionOwnedPercent = customization.collectionOwnedPercent ?? 75;
  if (context.collectionNames) {
    console.log(`[DeckGen] Collection mode (${collectionStrategy}${collectionStrategy === 'partial' ? `, ${collectionOwnedPercent}%` : ''}): ${collectionStrategy === 'full' ? 'restricting to' : 'prioritizing'} ${context.collectionNames.size} owned cards`);
  }

  // Add commander(s) to used names
  markUsed(commander.name);
  if (partnerCommander) {
    markUsed(partnerCommander.name);
  }

  // --- Phase A: Data Acquisition (skippable via generation cache) ---
  const usingCache = isCacheValid(context);
  let gameChangerNames: Set<string> = new Set();
  let combos: EDHRECCombo[] = [];
  let edhrecData: EDHRECCommanderData | null = null;
  let dataSource: DeckDataSource = 'scryfall';
  let baseData: EDHRECCommanderData | null = null;
  let themeOverlapCounts = new Map<string, number>();
  const selectedThemesWithSlugs = context.selectedThemes?.filter(
    t => t.isSelected && t.source === 'edhrec' && t.slug
  ) || [];

  if (usingCache) {
    console.log('[DeckGen] FAST PATH: Reusing cached EDHREC + Scryfall data');
    onProgress?.('Reshuffling with cached data...', 5);
    gameChangerNames = generationCache!.gameChangerNames;
    combos = generationCache!.combos;
    edhrecData = generationCache!.edhrecData;
    dataSource = generationCache!.dataSource;
    baseData = generationCache!.baseData;
    themeOverlapCounts = generationCache!.themeOverlapCounts;
    await loadTaggerData();
    onProgress?.('Card pools loaded from cache...', 12);
  } else {
    // FULL PATH: Pre-fetch basic lands, game changer list, combo data, and tagger data in parallel
    onProgress?.('Shuffling the library...', 5);
    const [, fetchedGCNames, fetchedCombos] = await Promise.all([
      prefetchBasicLands(),
      getGameChangerNames(),
      fetchCommanderCombos(commander.name).catch(() => [] as EDHRECCombo[]),
      loadTaggerData(),
    ]);
    gameChangerNames = fetchedGCNames;
    combos = fetchedCombos;
    onProgress?.('Divining card roles from the aether...', 7);
    console.log(`[DeckGen] Fetched ${combos.length} combos from EDHREC`);
    console.log(`[DeckGen] Tagger data: ${hasTaggerData() ? 'loaded' : 'unavailable (role detection disabled)'}`);
  }

  // Build combo priority boost map + combo membership index for dynamic boosting
  const comboCountSetting = customization.comboCount ?? 0;
  const staticComboBoosts = new Map<string, number>();
  const comboCardNames = new Set<string>();
  const comboCards = new Map<string, Set<string>>(); // comboId -> card names
  if (comboCountSetting > 0 && combos.length > 0) {
    // Scale combo attempts by deck size (baseline: 99 cards → 1→2, 2→4, 3→7)
    const sizeScale = Math.max(0.5, format / 99);
    const comboSliceCount = Math.max(1, Math.round(comboCountSetting * 2.33 * sizeScale));
    const combosToAttempt = combos.slice(0, comboSliceCount);
    const staticBoost = 75 * comboCountSetting; // 1→75, 2→150, 3→225
    for (const combo of combosToAttempt) {
      const cardSet = new Set(combo.cards.map(c => c.name));
      comboCards.set(combo.comboId, cardSet);
      for (const card of combo.cards) {
        comboCardNames.add(card.name);
        const existing = staticComboBoosts.get(card.name) ?? 0;
        staticComboBoosts.set(card.name, existing + staticBoost);
      }
    }
    console.log(`[DeckGen] Combo priority boost applied to ${staticComboBoosts.size} unique cards from top ${combosToAttempt.length} combos (static boost: ${staticBoost}pts)`);
  }

  // Dynamic combo boosts: recalculates each phase to boost remaining pieces of partially-assembled combos
  const getComboBoosts = (): Map<string, number> => {
    const boosts = new Map(staticComboBoosts);
    if (comboCountSetting <= 0 || comboCards.size === 0) return boosts;
    for (const [, cardSet] of comboCards) {
      const totalPieces = cardSet.size;
      if (totalPieces <= 1) continue;
      let selectedCount = 0;
      for (const name of cardSet) {
        if (usedNames.has(name)) selectedCount++;
      }
      if (selectedCount === 0) continue;
      // completionFraction uses totalPieces-1 so 2-of-3 = 1.0 (max urgency for last piece)
      const completionFraction = selectedCount / (totalPieces - 1);
      const dynamicBoost = 50 * comboCountSetting * completionFraction;
      for (const name of cardSet) {
        if (usedNames.has(name)) continue;
        boosts.set(name, (boosts.get(name) ?? 0) + dynamicBoost);
      }
    }
    return boosts;
  };
  // getComboBoosts() is called at each type phase to include dynamic boosts

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

  // Balanced roles tracking — declared at outer scope so return statement can access them
  let roleTargets: Record<RoleKey, number> | null = null;
  const currentRoleCounts: Record<RoleKey, number> = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
  const currentSubtypeCounts: Record<string, number> = {};
  let swapCandidates: Record<string, ScryfallCard[]> | undefined;

  // Process must-include cards FIRST — they get priority over all other selections
  // Track where each must-include came from (first source wins)
  const mustIncludeNames: string[] = [];
  const mustIncludeSources = new Map<string, 'user' | 'deck' | 'combo'>();

  function addMustInclude(name: string, source: 'user' | 'deck' | 'combo') {
    if (!bannedCards.has(name) && !usedNames.has(name) && !mustIncludeNames.includes(name)) {
      mustIncludeNames.push(name);
      mustIncludeSources.set(name, source);
    }
  }

  // Persistent user must-includes
  for (const name of customization.mustIncludeCards || []) {
    addMustInclude(name, 'user');
  }
  // Applied include user lists
  for (const ref of customization.appliedIncludeLists || []) {
    if (ref.enabled) {
      const list = userLists.find(l => l.id === ref.listId);
      if (list) {
        for (const name of list.cards) {
          addMustInclude(name, 'user');
        }
      }
    }
  }
  // Optimization deck cards (from build-from-deck flow)
  if (context.optimizeDeckCards && context.optimizeDeckCards.length > 0) {
    for (const name of context.optimizeDeckCards) {
      addMustInclude(name, 'deck');
    }
  }
  // Temporary must-include cards (from combo panel)
  const tempIncludes = customization.tempMustIncludeCards ?? [];
  if (tempIncludes.length > 0) {
    console.log(`[DeckGen] Temp must-include cards:`, tempIncludes);
    for (const name of tempIncludes) {
      addMustInclude(name, 'combo');
    }
  }

  if (mustIncludeNames.length > 0) {
    onProgress?.('Adding your must-include cards...', 3);
    console.log(`[DeckGen] Processing ${mustIncludeNames.length} must-include cards:`, mustIncludeNames);

    const mustIncludeMap = await getCardsByNames(mustIncludeNames, undefined, preferredSet);
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

      markUsed(card.name);
      card.isMustInclude = true;
      card.mustIncludeSource = mustIncludeSources.get(name) ?? 'user';
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
        categorizeCards([card], categories);
        const cmc = Math.min(Math.floor(card.cmc), 7);
        currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      } else if (typeLine.includes('sorcery')) {
        categorizeCards([card], categories);
        const cmc = Math.min(Math.floor(card.cmc), 7);
        currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      } else if (typeLine.includes('artifact')) {
        categorizeCards([card], categories);
        const cmc = Math.min(Math.floor(card.cmc), 7);
        currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      } else if (typeLine.includes('enchantment')) {
        categorizeCards([card], categories);
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

  // Try to fetch EDHREC data (works for all formats) — skip on cache hit
  if (!usingCache && selectedThemesWithSlugs.length > 0) {
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

      const [themeDataResults, fetchedBaseData] = await Promise.all([
        Promise.all(themeDataPromises),
        baseDataPromise,
      ]);
      baseData = fetchedBaseData;

      // Merge cardlists from all themes
      const merged = mergeThemeCardlists(themeDataResults);
      const mergedCardlists = merged.cardlists;
      themeOverlapCounts = merged.themeOverlapCounts;

      // Use the first theme's stats as representative, but if the theme endpoint
      // lacks type distribution data (numDecks=0), fetch base commander stats instead
      let representativeStats = themeDataResults[0].stats;
      if (!representativeStats.numDecks || representativeStats.numDecks === 0) {
        console.warn('[DeckGen] FALLBACK: Theme endpoint lacks stats (numDecks=0), fetching base commander stats');
        try {
          const baseStatsData = partnerCommander
            ? await fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption, bracketLevel)
            : await fetchCommanderData(commander.name, budgetOption, bracketLevel);
          representativeStats = baseStatsData.stats;
          console.log('[DeckGen] FALLBACK: Got stats from base commander+bracket');
        } catch {
          // Try without bracket if bracket-specific base also fails
          if (bracketLevel) {
            console.warn('[DeckGen] FALLBACK: Base commander+bracket stats failed, trying without bracket');
            try {
              const fallbackData = partnerCommander
                ? await fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption)
                : await fetchCommanderData(commander.name, budgetOption);
              representativeStats = fallbackData.stats;
              console.log('[DeckGen] FALLBACK: Got stats from base commander (no bracket)');
            } catch {
              console.warn('[DeckGen] FALLBACK: All stats fetches failed — will use fallback type targets');
            }
          } else {
            console.warn('[DeckGen] FALLBACK: Base commander stats fetch failed — will use fallback type targets');
          }
        }
      }

      edhrecData = {
        themes: [],
        stats: representativeStats,
        cardlists: mergedCardlists,
        similarCommanders: [],
      };

      dataSource = bracketLevel ? 'theme+bracket' : 'theme';
      const themeNames = selectedThemesWithSlugs.map(t => t.name).join(', ');
      onProgress?.(`The oracle speaks of ${themeNames}...`, 12);
    } catch (error) {
      console.warn('[DeckGen] FALLBACK: Theme-specific EDHREC fetch failed, trying base commander+bracket:', error);
      // Fall back to base commander data (with bracket)
      try {
        edhrecData = partnerCommander
          ? await fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption, bracketLevel)
          : await fetchCommanderData(commander.name, budgetOption, bracketLevel);
        dataSource = bracketLevel ? 'base+bracket' : 'base';
        console.log('[DeckGen] FALLBACK: Using base commander data (with bracket)');
        onProgress?.('Consulting ancient scrolls...', 12);
      } catch {
        // Fall back to base commander without bracket
        if (bracketLevel) {
          console.warn('[DeckGen] FALLBACK: Base commander+bracket also failed, trying without bracket');
          try {
            edhrecData = partnerCommander
              ? await fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption)
              : await fetchCommanderData(commander.name, budgetOption);
            dataSource = 'base';
            console.log('[DeckGen] FALLBACK: Using base commander data (no bracket)');
            onProgress?.('Consulting ancient scrolls...', 12);
          } catch {
            console.warn('[DeckGen] FALLBACK: All EDHREC fetches failed — will use Scryfall-only generation');
            onProgress?.('The oracle is silent... searching the multiverse...', 12);
          }
        } else {
          console.warn('[DeckGen] FALLBACK: Base commander fetch failed — will use Scryfall-only generation');
          onProgress?.('The oracle is silent... searching the multiverse...', 12);
        }
      }
    }
  } else if (!usingCache) {
    // No themes selected - use base commander data (top recommended cards)
    onProgress?.('Consulting the wisdom of EDHREC...', 8);
    try {
      edhrecData = partnerCommander
        ? await fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption, bracketLevel)
        : await fetchCommanderData(commander.name, budgetOption, bracketLevel);
      dataSource = bracketLevel ? 'base+bracket' : 'base';
      onProgress?.('Ancient knowledge acquired!', 12);
    } catch (error) {
      console.warn('[DeckGen] FALLBACK: Base commander+bracket fetch failed:', error);
      if (bracketLevel) {
        try {
          edhrecData = partnerCommander
            ? await fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption)
            : await fetchCommanderData(commander.name, budgetOption);
          dataSource = 'base';
          console.log('[DeckGen] FALLBACK: Using base commander data (no bracket)');
          onProgress?.('Ancient knowledge acquired!', 12);
        } catch {
          console.warn('[DeckGen] FALLBACK: All EDHREC fetches failed — will use Scryfall-only generation');
          onProgress?.('The oracle is silent... searching the multiverse...', 12);
        }
      } else {
        console.warn('[DeckGen] FALLBACK: Base commander fetch failed — will use Scryfall-only generation');
        onProgress?.('The oracle is silent... searching the multiverse...', 12);
      }
    }
  }

  // Build hyper focus boost map if enabled (runs with cached or fresh data)
  if (edhrecData && customization.hyperFocus && selectedThemesWithSlugs.length >= 1) {
    const baseCardNames = new Set<string>();
    if (baseData) {
      for (const list of Object.values(baseData.cardlists)) {
        for (const card of list) {
          baseCardNames.add(card.name);
        }
      }
    }

    const allThemeCards = [
      ...edhrecData.cardlists.creatures,
      ...edhrecData.cardlists.instants,
      ...edhrecData.cardlists.sorceries,
      ...edhrecData.cardlists.artifacts,
      ...edhrecData.cardlists.enchantments,
      ...edhrecData.cardlists.planeswalkers,
    ];

    if (selectedThemesWithSlugs.length === 1) {
      let boosted = 0, penalized = 0;
      for (const card of allThemeCards) {
        const synergy = card.synergy ?? 0;
        const inBase = baseCardNames.has(card.name);

        if (!inBase && synergy >= 0.1) {
          staticComboBoosts.set(card.name, (staticComboBoosts.get(card.name) ?? 0) + 1000);
          boosted++;
        } else if (!inBase) {
          staticComboBoosts.set(card.name, (staticComboBoosts.get(card.name) ?? 0) + 500);
          boosted++;
        } else if (inBase && synergy >= 0.3) {
          staticComboBoosts.set(card.name, (staticComboBoosts.get(card.name) ?? 0) + 200);
          boosted++;
        } else if (inBase && synergy < 0.1) {
          staticComboBoosts.set(card.name, (staticComboBoosts.get(card.name) ?? 0) - 500);
          penalized++;
        }
      }
      console.log(`[DeckGen] Hyper Focus (single theme, base pool: ${baseCardNames.size} cards): boosted ${boosted}, penalized ${penalized}`);
    } else {
      const numThemes = selectedThemesWithSlugs.length;
      for (const [name, count] of themeOverlapCounts) {
        const inBase = baseCardNames.has(name);
        let boost = 0;
        if (count === 1 && !inBase) {
          boost = 1000;
        } else if (count === 1) {
          boost = 300;
        } else if (count >= numThemes || inBase) {
          boost = -500;
        } else {
          boost = -200 * (count - 1);
        }
        staticComboBoosts.set(name, (staticComboBoosts.get(name) ?? 0) + boost);
      }
      console.log(`[DeckGen] Hyper Focus (${numThemes} themes, base pool: ${baseCardNames.size} cards): adjusted ${themeOverlapCounts.size} cards`);
    }
  }

  // Populate generation cache after successful EDHREC fetch
  if (!usingCache && edhrecData) {
    const key = buildCacheKey(context);
    generationCache = {
      edhrecData,
      baseData,
      cardMap: new Map(), // Will be populated after Scryfall batch fetch
      themeOverlapCounts,
      combos,
      gameChangerNames,
      dataSource,
      representativeStats: edhrecData.stats,
      ...key,
    };
    console.log('[DeckGen] Generation cache populated for fast regeneration');
  }

  // Calculate target counts with type and curve targets
  const { composition: targets, typeTargets, curveTargets } = calculateTargetCounts(
    customization,
    edhrecData?.stats,
    !!partnerCommander
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
      if (typeLine.includes('land')) {
        categories.lands.push(...copies);
      } else if (typeLine.includes('creature')) {
        categories.creatures.push(...copies);
      } else if (typeLine.includes('instant')) {
        categorizeCards(copies, categories);
      } else if (typeLine.includes('sorcery')) {
        categorizeCards(copies, categories);
      } else if (typeLine.includes('artifact')) {
        categorizeCards(copies, categories);
      } else if (typeLine.includes('enchantment')) {
        categorizeCards(copies, categories);
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
      markUsed(card.name);
    }
  }
  // ---- End multi-copy pipeline ----

  // Count non-land cards already added (must-includes + multi-copy) by card type
  // so we can reduce type targets and avoid overfilling the deck
  const preFilledTypeCounts: Record<string, number> = {};
  for (const card of Object.values(categories).flat()) {
    const typeLine = getFrontFaceTypeLine(card).toLowerCase();
    if (typeLine.includes('land')) continue; // lands handled separately
    const type = typeLine.includes('creature') ? 'creature'
      : typeLine.includes('instant') ? 'instant'
      : typeLine.includes('sorcery') ? 'sorcery'
      : typeLine.includes('artifact') ? 'artifact'
      : typeLine.includes('enchantment') ? 'enchantment'
      : typeLine.includes('planeswalker') ? 'planeswalker'
      : null;
    if (type) {
      preFilledTypeCounts[type] = (preFilledTypeCounts[type] ?? 0) + 1;
    }
  }
  if (Object.keys(preFilledTypeCounts).length > 0) {
    console.log('[DeckGen] Pre-filled type counts (must-include + multi-copy):', preFilledTypeCounts);
  }

  // If we have EDHREC data, use it as the primary source with CMC-aware selection
  if (edhrecData && edhrecData.cardlists.allNonLand.length > 0) {
    const { cardlists } = edhrecData;

    // Build all pools first — subtract pre-filled cards from targets
    // Use ?? instead of || so that 0 targets (from advanced overrides) are respected
    const originalCreatureTarget = typeTargets.creature ?? targets.creatures;
    const creatureTarget = Math.max(0, originalCreatureTarget - (preFilledTypeCounts.creature ?? 0));
    const creaturePool = mergeWithAllNonLand(cardlists.creatures, cardlists.allNonLand);
    const instantTarget = Math.max(0, (typeTargets.instant ?? 0) - (preFilledTypeCounts.instant ?? 0));
    const instantPool = mergeWithAllNonLand(cardlists.instants, cardlists.allNonLand);
    const sorceryTarget = Math.max(0, (typeTargets.sorcery ?? 0) - (preFilledTypeCounts.sorcery ?? 0));
    const sorceryPool = mergeWithAllNonLand(cardlists.sorceries, cardlists.allNonLand);
    const artifactTarget = Math.max(0, (typeTargets.artifact ?? 0) - (preFilledTypeCounts.artifact ?? 0));
    const artifactPool = mergeWithAllNonLand(cardlists.artifacts, cardlists.allNonLand);
    const enchantmentTarget = Math.max(0, (typeTargets.enchantment ?? 0) - (preFilledTypeCounts.enchantment ?? 0));
    const enchantmentPool = mergeWithAllNonLand(cardlists.enchantments, cardlists.allNonLand);
    const planeswalkerTarget = Math.max(0, (typeTargets.planeswalker ?? 0) - (preFilledTypeCounts.planeswalker ?? 0));
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
      for (const card of typedCards.slice(0, Math.max(target * 3 + 15, 35))) {
        allCardNames.add(card.name);
      }

      // Then add high synergy Unknown cards (need type check via Scryfall later)
      const highSynergyUnknown = candidates.filter(c => c.primary_type === 'Unknown' && isHighSynergyCard(c));
      for (const card of highSynergyUnknown.slice(0, Math.max(target * 2 + 15, 30))) {
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
    }, preferredSet);
    // Post-filter: remove cards that don't match the scryfallQuery filter
    if (preferredSet) {
      for (const [name, card] of cardMap) {
        if (card.set !== preferredSet) cardMap.delete(name);
      }
    }
    await upgradeCardPrintings(cardMap, scryfallQuery, true);
    console.log(`[DeckGen] Batch fetch returned ${cardMap.size} cards (after filtering)`);

    // Update generation cache with the cardMap (not used on fast path currently,
    // but kept for potential future use)
    if (generationCache) {
      generationCache.cardMap = cardMap;
    }

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
        if (typeLine.includes('land')) continue; // Lands are handled separately
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

    // ---- Balanced Roles: pre-compute role map and seed counts ----
    if (customization.advancedTargets?.roleTargets) {
      // Advanced override always takes precedence
      roleTargets = customization.advancedTargets.roleTargets as Record<RoleKey, number>;
    } else {
      roleTargets = customization.balancedRoles ? getRoleTargets(format) : null;
    }
    const cardRoleMap = new Map<string, RoleKey>();
    const cardCmcMap = new Map<string, number>();
    const cardSubtypeMap = new Map<string, string>();

    if (roleTargets) {
      // Pre-compute roles and CMC for all candidates in all pools
      const allPools = [creaturePool, instantPool, sorceryPool, artifactPool, enchantmentPool, planeswalkerPool];
      for (const pool of allPools) {
        for (const edhrecCard of pool) {
          if (cardRoleMap.has(edhrecCard.name)) continue;
          const scryfallCard = cardMap.get(edhrecCard.name);
          if (!scryfallCard) continue;
          const role = getCardRole(scryfallCard.name);
          if (role) {
            cardRoleMap.set(edhrecCard.name, role);
            cardCmcMap.set(edhrecCard.name, scryfallCard.cmc);
            const subtype = getCardSubtype(scryfallCard.name);
            if (subtype) cardSubtypeMap.set(edhrecCard.name, subtype);
            // Also store under full Scryfall name for DFCs (e.g. "A // B")
            if (scryfallCard.name !== edhrecCard.name) {
              cardRoleMap.set(scryfallCard.name, role);
              cardCmcMap.set(scryfallCard.name, scryfallCard.cmc);
              if (subtype) cardSubtypeMap.set(scryfallCard.name, subtype);
            }
          }
        }
      }

      // Seed counts from pre-filled cards (must-includes + multi-copy) and stamp roles
      for (const card of Object.values(categories).flat()) {
        const role = getCardRole(card.name);
        if (role) {
          currentRoleCounts[role]++; card.deckRole = role; stampRoleSubtypes(card);
          const subtype = cardSubtypeMap.get(card.name) ?? getCardSubtype(card.name);
          if (subtype) currentSubtypeCounts[subtype] = (currentSubtypeCounts[subtype] ?? 0) + 1;
        }
      }

      console.log(`[DeckGen] Balanced Roles: ${cardRoleMap.size} candidates mapped, targets:`, roleTargets);
      console.log(`[DeckGen] Balanced Roles: pre-filled counts:`, { ...currentRoleCounts });
    }
    // ---- End balanced roles setup ----

    // When the user has explicitly set curve/role targets, enforce them strictly
    const strictCurve = !!customization.advancedTargets?.curvePercentages;
    const strictRoles = !!customization.advancedTargets?.roleTargets;

    // Now process each type synchronously using the pre-fetched cards
    // 1. Creatures
    console.log(`[DeckGen] Creatures: need ${creatureTarget}, pool has ${creaturePool.length} cards`);
    onProgress?.('Summoning creatures from the aether...', 35);
    const creatureBoosts = roleTargets ? computeRoleBoosts(cardRoleMap, roleTargets, currentRoleCounts, getComboBoosts(), cardCmcMap, cardSubtypeMap, currentSubtypeCounts, strictRoles) : getComboBoosts();
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
      creatureBoosts,
      currency,
      gameChangerNames,
      arenaOnly,
      strictCurve,
      collectionStrategy,
      collectionOwnedPercent
    );
    categories.creatures.push(...creatures);
    for (const card of creatures) { const role = cardRoleMap.get(card.name); if (role) { currentRoleCounts[role]++; card.deckRole = role; stampRoleSubtypes(card); const st = cardSubtypeMap.get(card.name); if (st) currentSubtypeCounts[st] = (currentSubtypeCounts[st] ?? 0) + 1; } }
    console.log(`[DeckGen] Creatures: got ${creatures.length} from EDHREC`);

    // Fill remaining creatures from Scryfall if needed (use original target since categories include must-includes)
    if (categories.creatures.length < originalCreatureTarget) {
      const needed = originalCreatureTarget - categories.creatures.length;
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
        currency,
        arenaOnly,
        scryfallQuery,
        collectionStrategy
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
    const instantBoosts = roleTargets ? computeRoleBoosts(cardRoleMap, roleTargets, currentRoleCounts, getComboBoosts(), cardCmcMap, cardSubtypeMap, currentSubtypeCounts, strictRoles) : getComboBoosts();
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
      instantBoosts,
      currency,
      gameChangerNames,
      arenaOnly,
      strictCurve,
      collectionStrategy,
      collectionOwnedPercent
    );
    console.log(`[DeckGen] Instants: got ${instants.length} from EDHREC`);
    categorizeCards(instants, categories);
    for (const card of instants) { const role = cardRoleMap.get(card.name); if (role) { currentRoleCounts[role]++; card.deckRole = role; stampRoleSubtypes(card); const st = cardSubtypeMap.get(card.name); if (st) currentSubtypeCounts[st] = (currentSubtypeCounts[st] ?? 0) + 1; } }

    // 3. Sorceries
    console.log(`[DeckGen] Sorceries: need ${sorceryTarget}, pool has ${sorceryPool.length} cards`);
    onProgress?.('Channeling sorcerous power...', 55);
    const sorceryBoosts = roleTargets ? computeRoleBoosts(cardRoleMap, roleTargets, currentRoleCounts, getComboBoosts(), cardCmcMap, cardSubtypeMap, currentSubtypeCounts, strictRoles) : getComboBoosts();
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
      sorceryBoosts,
      currency,
      gameChangerNames,
      arenaOnly,
      strictCurve,
      collectionStrategy,
      collectionOwnedPercent
    );
    console.log(`[DeckGen] Sorceries: got ${sorceries.length} from EDHREC`);
    categorizeCards(sorceries, categories);
    for (const card of sorceries) { const role = cardRoleMap.get(card.name); if (role) { currentRoleCounts[role]++; card.deckRole = role; stampRoleSubtypes(card); const st = cardSubtypeMap.get(card.name); if (st) currentSubtypeCounts[st] = (currentSubtypeCounts[st] ?? 0) + 1; } }

    // 4. Artifacts
    console.log(`[DeckGen] Artifacts: need ${artifactTarget}, pool has ${artifactPool.length} cards`);
    onProgress?.('Forging powerful artifacts...', 62);
    const artifactBoosts = roleTargets ? computeRoleBoosts(cardRoleMap, roleTargets, currentRoleCounts, getComboBoosts(), cardCmcMap, cardSubtypeMap, currentSubtypeCounts, strictRoles) : getComboBoosts();
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
      artifactBoosts,
      currency,
      gameChangerNames,
      arenaOnly,
      strictCurve,
      collectionStrategy,
      collectionOwnedPercent
    );
    console.log(`[DeckGen] Artifacts: got ${artifacts.length} from EDHREC`);
    categorizeCards(artifacts, categories);
    for (const card of artifacts) { const role = cardRoleMap.get(card.name); if (role) { currentRoleCounts[role]++; card.deckRole = role; stampRoleSubtypes(card); const st = cardSubtypeMap.get(card.name); if (st) currentSubtypeCounts[st] = (currentSubtypeCounts[st] ?? 0) + 1; } }

    // 5. Enchantments
    console.log(`[DeckGen] Enchantments: need ${enchantmentTarget}, pool has ${enchantmentPool.length} cards`);
    onProgress?.('Weaving magical enchantments...', 68);
    const enchantmentBoosts = roleTargets ? computeRoleBoosts(cardRoleMap, roleTargets, currentRoleCounts, getComboBoosts(), cardCmcMap, cardSubtypeMap, currentSubtypeCounts, strictRoles) : getComboBoosts();
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
      enchantmentBoosts,
      currency,
      gameChangerNames,
      arenaOnly,
      strictCurve,
      collectionStrategy,
      collectionOwnedPercent
    );
    console.log(`[DeckGen] Enchantments: got ${enchantments.length} from EDHREC`);
    categorizeCards(enchantments, categories);
    for (const card of enchantments) { const role = cardRoleMap.get(card.name); if (role) { currentRoleCounts[role]++; card.deckRole = role; stampRoleSubtypes(card); const st = cardSubtypeMap.get(card.name); if (st) currentSubtypeCounts[st] = (currentSubtypeCounts[st] ?? 0) + 1; } }

    // 6. Planeswalkers
    console.log(`[DeckGen] Planeswalkers: need ${planeswalkerTarget}, pool has ${planeswalkerPool.length} cards`);
    if (planeswalkerPool.length > 0 && planeswalkerTarget > 0) {
      onProgress?.('Calling upon planeswalker allies...', 72);
      const planeswalkerBoosts = roleTargets ? computeRoleBoosts(cardRoleMap, roleTargets, currentRoleCounts, getComboBoosts(), cardCmcMap, cardSubtypeMap, currentSubtypeCounts, strictRoles) : getComboBoosts();
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
        planeswalkerBoosts,
        currency,
        gameChangerNames,
        arenaOnly,
        strictCurve,
        collectionStrategy,
        collectionOwnedPercent
      );
      console.log(`[DeckGen] Planeswalkers: got ${planeswalkers.length} from EDHREC`);
      categories.utility.push(...planeswalkers);
      for (const card of planeswalkers) { const role = cardRoleMap.get(card.name); if (role) { currentRoleCounts[role]++; card.deckRole = role; stampRoleSubtypes(card); const st = cardSubtypeMap.get(card.name); if (st) currentSubtypeCounts[st] = (currentSubtypeCounts[st] ?? 0) + 1; } }
    }

    // Log balanced roles result
    if (roleTargets) {
      console.log(`[DeckGen] Balanced Roles: final counts:`, { ...currentRoleCounts }, 'vs targets:', roleTargets);
    }

    // 7. Lands from EDHREC
    onProgress?.('Surveying the mana base...', 78);
    // Preserve must-include lands added earlier
    const mustIncludeLands = categories.lands.filter(c => c.isMustInclude);
    const adjustedLandTarget = Math.max(0, targets.lands - mustIncludeLands.length);
    // Must-include lands are almost always non-basic — subtract them from the non-basic budget
    // so the remaining slots respect the user's basic/non-basic split
    const mustIncludeNonBasicCount = mustIncludeLands.filter(
      c => !getFrontFaceTypeLine(c).toLowerCase().includes('basic')
    ).length;
    const remainingNonBasicBudget = Math.max(0, customization.nonBasicLandCount - mustIncludeNonBasicCount);
    const nonbasicTarget = Math.min(remainingNonBasicBudget, adjustedLandTarget);
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
        currency,
        arenaOnly,
        scryfallQuery,
        preferredSet,
        collectionStrategy,
        collectionOwnedPercent
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

    // Collect swap candidates from leftover pool cards (role-based + type-based)
    swapCandidates = collectSwapCandidates(
      [creaturePool, instantPool, sorceryPool, artifactPool, enchantmentPool, planeswalkerPool],
      cardMap,
      usedNames,
      colorIdentity,
      bannedCards,
      maxCardPrice,
      maxRarity,
      maxCmc,
      context.collectionNames,
      currency,
      arenaOnly,
      collectionStrategy,
    );
    console.log(`[DeckGen] Swap candidates: ${Object.entries(swapCandidates).filter(([, v]) => v.length > 0).map(([k, v]) => `${k}=${v.length}`).join(', ')}`);

  } else {
    // Fallback to Scryfall-based generation (no EDHREC data available)
    console.warn('[DeckGen] FALLBACK: No EDHREC data — using Scryfall-only generation with fallback type targets');
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
      currency,
      arenaOnly,
      scryfallQuery,
      collectionStrategy
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
      currency,
      arenaOnly,
      scryfallQuery,
      collectionStrategy
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
      currency,
      arenaOnly,
      scryfallQuery,
      collectionStrategy
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
      currency,
      arenaOnly,
      scryfallQuery,
      collectionStrategy
    );

    // Use typeTargets for remaining slots to get a balanced type distribution
    const scryfallCreatureTarget = Math.max(0, (typeTargets.creature ?? 0) - (preFilledTypeCounts.creature ?? 0) - categories.creatures.length);
    onProgress?.('Recruiting an army...', 60);
    const scryfallCreatures = await fillWithScryfall(
      't:creature',
      colorIdentity,
      scryfallCreatureTarget,
      usedNames,
      bannedCards,
      maxCardPrice,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      currency,
      arenaOnly,
      scryfallQuery,
      collectionStrategy
    );
    categories.creatures.push(...scryfallCreatures);

    const scryfallArtifactTarget = Math.max(0, (typeTargets.artifact ?? 0) - (preFilledTypeCounts.artifact ?? 0));
    onProgress?.('Forging artifacts...', 65);
    const scryfallArtifacts = await fillWithScryfall(
      't:artifact -t:creature',
      colorIdentity,
      scryfallArtifactTarget,
      usedNames,
      bannedCards,
      maxCardPrice,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      currency,
      arenaOnly,
      scryfallQuery,
      collectionStrategy
    );
    categorizeCards(scryfallArtifacts, categories);

    const scryfallEnchantmentTarget = Math.max(0, (typeTargets.enchantment ?? 0) - (preFilledTypeCounts.enchantment ?? 0));
    onProgress?.('Weaving enchantments...', 70);
    const scryfallEnchantments = await fillWithScryfall(
      't:enchantment -t:creature',
      colorIdentity,
      scryfallEnchantmentTarget,
      usedNames,
      bannedCards,
      maxCardPrice,
      maxRarity,
      maxCmc,
      budgetTracker,
      context.collectionNames,
      currency,
      arenaOnly,
      scryfallQuery,
      collectionStrategy
    );
    categorizeCards(scryfallEnchantments, categories);

    const scryfallInstantTarget = Math.max(0, (typeTargets.instant ?? 0) - (preFilledTypeCounts.instant ?? 0) - categories.singleRemoval.length - categories.boardWipes.length);
    if (scryfallInstantTarget > 0) {
      onProgress?.('Preparing instants...', 72);
      const scryfallInstants = await fillWithScryfall(
        't:instant',
        colorIdentity,
        scryfallInstantTarget,
        usedNames,
        bannedCards,
        maxCardPrice,
        maxRarity,
        maxCmc,
        budgetTracker,
        context.collectionNames,
        currency,
        arenaOnly,
        scryfallQuery,
        collectionStrategy
      );
      categorizeCards(scryfallInstants, categories);
    }

    const scryfallSorceryTarget = Math.max(0, (typeTargets.sorcery ?? 0) - (preFilledTypeCounts.sorcery ?? 0));
    if (scryfallSorceryTarget > 0) {
      onProgress?.('Channeling sorceries...', 74);
      const scryfallSorceries = await fillWithScryfall(
        't:sorcery',
        colorIdentity,
        scryfallSorceryTarget,
        usedNames,
        bannedCards,
        maxCardPrice,
        maxRarity,
        maxCmc,
        budgetTracker,
        context.collectionNames,
        currency,
        arenaOnly,
        scryfallQuery,
        collectionStrategy
      );
      categorizeCards(scryfallSorceries, categories);
    }

    onProgress?.('Surveying the mana base...', 80);
    // Preserve must-include lands added earlier
    const fallbackMustIncludeLands = categories.lands.filter(c => c.isMustInclude);
    const fallbackAdjustedLandTarget = Math.max(0, targets.lands - fallbackMustIncludeLands.length);
    // Subtract must-include non-basics from the non-basic budget (same logic as EDHREC path)
    const fallbackMustIncludeNonBasicCount = fallbackMustIncludeLands.filter(
      c => !getFrontFaceTypeLine(c).toLowerCase().includes('basic')
    ).length;
    const fallbackRemainingNonBasicBudget = Math.max(0, customization.nonBasicLandCount - fallbackMustIncludeNonBasicCount);
    const fallbackNonbasicTarget = Math.min(fallbackRemainingNonBasicBudget, fallbackAdjustedLandTarget);
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
        currency,
        arenaOnly,
        scryfallQuery,
        preferredSet,
        collectionStrategy,
        collectionOwnedPercent
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
    // Respect type distribution targets when filling
    if (edhrecData && edhrecData.cardlists.allNonLand.length > 0) {
      const remainingEdhrecCards = edhrecData.cardlists.allNonLand
        .filter(c => !usedNames.has(c.name) && !bannedCards.has(c.name))
        .sort((a, b) => b.inclusion - a.inclusion);

      console.log(`[DeckGen] Found ${remainingEdhrecCards.length} remaining EDHREC cards to fill shortage`);

      const namesToFetch = remainingEdhrecCards.slice(0, shortage * 3).map(c => c.name);
      const fillCardMap = await getCardsByNames(namesToFetch, undefined, preferredSet);
      if (preferredSet) {
        for (const [name, card] of fillCardMap) {
          if (card.set !== preferredSet) fillCardMap.delete(name);
        }
      }
      await upgradeCardPrintings(fillCardMap, scryfallQuery, true);

      // Calculate current type counts to prioritize types with the largest deficit
      const currentTypeCounts: Record<string, number> = {};
      for (const card of Object.values(categories).flat()) {
        const tl = getFrontFaceTypeLine(card).toLowerCase();
        if (tl.includes('land')) continue;
        const t = tl.includes('creature') ? 'creature'
          : tl.includes('instant') ? 'instant'
          : tl.includes('sorcery') ? 'sorcery'
          : tl.includes('artifact') ? 'artifact'
          : tl.includes('enchantment') ? 'enchantment'
          : tl.includes('planeswalker') ? 'planeswalker'
          : null;
        if (t) currentTypeCounts[t] = (currentTypeCounts[t] ?? 0) + 1;
      }

      // Determine which types still need cards
      const typeNeed: Record<string, number> = {};
      for (const type of ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker']) {
        typeNeed[type] = Math.max(0, (typeTargets[type] ?? 0) - (currentTypeCounts[type] ?? 0));
      }
      const totalTypeNeed = Object.values(typeNeed).reduce((s, v) => s + v, 0);

      let filled = 0;
      for (const edhrecCard of remainingEdhrecCards) {
        if (filled >= shortage) break;

        const scryfallCard = fillCardMap.get(edhrecCard.name);
        if (!scryfallCard) continue;

        if (!fitsColorIdentity(scryfallCard, colorIdentity)) continue;
        if (collectionStrategy === 'full' && notInCollection(edhrecCard.name, context.collectionNames)) continue;
        if (exceedsMaxPrice(scryfallCard, shortagePriceCap, currency)) continue;
        if (exceedsMaxRarity(scryfallCard, maxRarity)) continue;
        if (exceedsCmcCap(scryfallCard, maxCmc)) continue;

        // If advanced type overrides are active, prioritize cards that fill type deficits
        if (customization.advancedTargets?.typePercentages && totalTypeNeed > 0) {
          const tl = getFrontFaceTypeLine(scryfallCard).toLowerCase();
          const cardType = tl.includes('creature') ? 'creature'
            : tl.includes('instant') ? 'instant'
            : tl.includes('sorcery') ? 'sorcery'
            : tl.includes('artifact') ? 'artifact'
            : tl.includes('enchantment') ? 'enchantment'
            : tl.includes('planeswalker') ? 'planeswalker'
            : null;
          // Skip cards of types the user set to 0 (or already at target)
          if (cardType && typeNeed[cardType] <= 0) continue;
          // Track the fill
          if (cardType && typeNeed[cardType] > 0) typeNeed[cardType]--;
        }

        categories.synergy.push(scryfallCard);
        usedNames.add(edhrecCard.name);
        if (scryfallCard.name !== edhrecCard.name) usedNames.add(scryfallCard.name);
        filled++;
      }

      // If we still have shortage after type-respecting fill, do a second pass without type filter
      if (filled < shortage) {
        for (const edhrecCard of remainingEdhrecCards) {
          if (filled >= shortage) break;
          if (usedNames.has(edhrecCard.name)) continue;

          const scryfallCard = fillCardMap.get(edhrecCard.name);
          if (!scryfallCard) continue;

          if (!fitsColorIdentity(scryfallCard, colorIdentity)) continue;
          if (collectionStrategy === 'full' && notInCollection(edhrecCard.name, context.collectionNames)) continue;
          if (exceedsMaxPrice(scryfallCard, shortagePriceCap, currency)) continue;
          if (exceedsMaxRarity(scryfallCard, maxRarity)) continue;
          if (exceedsCmcCap(scryfallCard, maxCmc)) continue;

          categories.synergy.push(scryfallCard);
          usedNames.add(edhrecCard.name);
          if (scryfallCard.name !== edhrecCard.name) usedNames.add(scryfallCard.name);
          filled++;
        }
      }

      console.log(`[DeckGen] Filled ${filled} cards from remaining EDHREC suggestions`);
    }

    // If still short after EDHREC, use Scryfall — fill by type to stay balanced
    currentCount = countAllCards();
    if (currentCount < targetDeckSize) {
      const stillNeeded = targetDeckSize - currentCount;
      console.log(`[DeckGen] Still need ${stillNeeded} more cards, using Scryfall fallback`);

      // Calculate current type counts to figure out which types are most under-target
      const currentTypeCounts: Record<string, number> = {};
      for (const card of Object.values(categories).flat()) {
        const tl = getFrontFaceTypeLine(card).toLowerCase();
        if (tl.includes('land')) continue;
        const t = tl.includes('creature') ? 'creature'
          : tl.includes('instant') ? 'instant'
          : tl.includes('sorcery') ? 'sorcery'
          : tl.includes('artifact') ? 'artifact'
          : tl.includes('enchantment') ? 'enchantment'
          : null;
        if (t) currentTypeCounts[t] = (currentTypeCounts[t] ?? 0) + 1;
      }

      // Build a list of (type, deficit) sorted by largest deficit first
      const typeDeficits: { type: string; query: string; deficit: number }[] = [
        { type: 'creature', query: 't:creature', deficit: (typeTargets.creature ?? 0) - (currentTypeCounts.creature ?? 0) },
        { type: 'instant', query: 't:instant', deficit: (typeTargets.instant ?? 0) - (currentTypeCounts.instant ?? 0) },
        { type: 'sorcery', query: 't:sorcery', deficit: (typeTargets.sorcery ?? 0) - (currentTypeCounts.sorcery ?? 0) },
        { type: 'artifact', query: 't:artifact -t:creature', deficit: (typeTargets.artifact ?? 0) - (currentTypeCounts.artifact ?? 0) },
        { type: 'enchantment', query: 't:enchantment -t:creature', deficit: (typeTargets.enchantment ?? 0) - (currentTypeCounts.enchantment ?? 0) },
      ].filter(d => d.deficit > 0).sort((a, b) => b.deficit - a.deficit);

      console.log('[DeckGen] Shortfall type deficits:', typeDeficits.map(d => `${d.type}: ${d.deficit}`).join(', ') || 'none');

      let filled = 0;
      for (const { type, query, deficit } of typeDeficits) {
        if (filled >= stillNeeded) break;
        const toFill = Math.min(deficit, stillNeeded - filled);
        const cards = await fillWithScryfall(
          query, colorIdentity, toFill, usedNames, bannedCards,
          shortagePriceCap, maxRarity, maxCmc, null,
          context.collectionNames, currency, arenaOnly, scryfallQuery,
          collectionStrategy
        );
        if (type === 'creature') categories.creatures.push(...cards);
        else if (type === 'instant') categorizeCards(cards, categories);
        else if (type === 'sorcery') categorizeCards(cards, categories);
        else if (type === 'artifact') categorizeCards(cards, categories);
        else if (type === 'enchantment') categorizeCards(cards, categories);
        filled += cards.length;
      }

      // If still short after typed fills, use generic query as absolute last resort
      if (filled < stillNeeded) {
        const remaining = stillNeeded - filled;
        console.warn(`[DeckGen] FALLBACK: Typed shortfall fills not enough (got ${filled}/${stillNeeded}), using generic query for ${remaining} remaining`);
        const moreCards = await fillWithScryfall(
          '(t:artifact OR t:enchantment OR t:creature)',
          colorIdentity, remaining, usedNames, bannedCards,
          shortagePriceCap, maxRarity, maxCmc, null,
          context.collectionNames, currency, arenaOnly, scryfallQuery,
          collectionStrategy
        );
        categories.synergy.push(...moreCards);
        filled += moreCards.length;
      }

      console.log(`[DeckGen] Filled ${filled} cards from Scryfall shortfall`);
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
    const allDeckCardNames = new Set<string>();
    for (const c of Object.values(categories).flat()) {
      allDeckCardNames.add(c.name);
      // DFCs: also add front-face name so EDHREC's front-face-only names match
      if (c.name.includes(' // ')) allDeckCardNames.add(c.name.split(' // ')[0]);
    }

    const gapCandidates = edhrecData.cardlists.allNonLand
      .filter(c =>
        !allDeckCardNames.has(c.name) &&
        !bannedCards.has(c.name)
      )
      .sort((a, b) => calculateCardPriority(b) - calculateCardPriority(a))
      .slice(0, 40);

    if (gapCandidates.length > 0) {
      const gapCardMap = await getCardsByNames(gapCandidates.map(c => c.name), undefined, preferredSet);

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
            isOwned: context.collectionNames!.has(c.name),
          };
        })
        .filter(c => c.price !== null);

      console.log(`[DeckGen] Gap analysis: ${gapAnalysis.length} cards suggested (${gapAnalysis.filter(c => c.isOwned).length} owned)`);
    }
  }

  // Detect combos present in the generated deck
  let detectedCombos: DetectedCombo[] | undefined;
  if (combos.length > 0) {
    const allDeckNames = new Set<string>();
    // Include commander(s) — they're part of the deck but not in categories
    if (commander) {
      allDeckNames.add(commander.name);
      if (commander.name.includes(' // ')) allDeckNames.add(commander.name.split(' // ')[0]);
    }
    if (partnerCommander) {
      allDeckNames.add(partnerCommander.name);
      if (partnerCommander.name.includes(' // ')) allDeckNames.add(partnerCommander.name.split(' // ')[0]);
    }
    for (const c of Object.values(categories).flat()) {
      allDeckNames.add(c.name);
      if (c.name.includes(' // ')) allDeckNames.add(c.name.split(' // ')[0]);
    }

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
      .filter(dc => dc.isComplete || dc.missingCards.length <= 2);

    // Deduplicate combos with identical card sets (keep higher deck count)
    {
      const seen = new Map<string, number>();
      detectedCombos = detectedCombos.filter((combo, idx) => {
        const key = [...combo.cards].sort().join('|');
        const existing = seen.get(key);
        if (existing !== undefined) {
          // Keep the one with higher deck count
          if (combo.deckCount > detectedCombos![existing].deckCount) {
            detectedCombos![existing] = combo;
          }
          return false;
        }
        seen.set(key, idx);
        return true;
      });
    }

    // Float commander combos to the top within each completeness group
    const commanderNames = new Set<string>();
    if (commander) {
      commanderNames.add(commander.name);
      if (commander.name.includes(' // ')) commanderNames.add(commander.name.split(' // ')[0]);
    }
    if (partnerCommander) {
      commanderNames.add(partnerCommander.name);
      if (partnerCommander.name.includes(' // ')) commanderNames.add(partnerCommander.name.split(' // ')[0]);
    }
    detectedCombos.sort((a, b) => {
      if (a.isComplete !== b.isComplete) return a.isComplete ? -1 : 1;
      const aHasCommander = a.cards.some(n => commanderNames.has(n));
      const bHasCommander = b.cards.some(n => commanderNames.has(n));
      if (aHasCommander !== bHasCommander) return aHasCommander ? -1 : 1;
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
    filterShortfall: scryfallQuery && !context.collectionNames && basicLandFillCount > 0 ? basicLandFillCount : undefined,
    typeTargets,
    dataSource,
    roleCounts: roleTargets ? { ...currentRoleCounts } : undefined,
    roleTargets: roleTargets ? { ...roleTargets } : undefined,
    ...roleTargets ? (() => {
      const rampSub: Record<string, number> = { 'mana-producer': 0, 'mana-rock': 0, 'cost-reducer': 0, ramp: 0 };
      const removalSub: Record<string, number> = { counterspell: 0, bounce: 0, 'spot-removal': 0, removal: 0 };
      const boardwipeSub: Record<string, number> = { 'bounce-wipe': 0, boardwipe: 0 };
      const cardDrawSub: Record<string, number> = { tutor: 0, wheel: 0, cantrip: 0, 'card-draw': 0, 'card-advantage': 0 };
      for (const cards of Object.values(categories)) {
        for (const card of cards) {
          if (card.rampSubtype) rampSub[card.rampSubtype] = (rampSub[card.rampSubtype] || 0) + 1;
          if (card.removalSubtype) removalSub[card.removalSubtype] = (removalSub[card.removalSubtype] || 0) + 1;
          if (card.boardwipeSubtype) boardwipeSub[card.boardwipeSubtype] = (boardwipeSub[card.boardwipeSubtype] || 0) + 1;
          if (card.cardDrawSubtype) cardDrawSub[card.cardDrawSubtype] = (cardDrawSub[card.cardDrawSubtype] || 0) + 1;
        }
      }
      return {
        rampSubtypeCounts: rampSub,
        removalSubtypeCounts: removalSub,
        boardwipeSubtypeCounts: boardwipeSub,
        cardDrawSubtypeCounts: cardDrawSub,
      };
    })() : {},
    swapCandidates,
  };
}
