import type { ScryfallCard } from '@/types';
import type { RecommendedCard, DeckAnalysis } from './deckAnalyzer';
import { isAnyLand, BASIC_LAND_NAMES, getCardPrice } from '@/services/scryfall/client';

export type Confidence = 'drop-in' | 'sidegrade' | 'budget';

/** Where a swap suggestion came from. 'similar' = EDHREC functional similarity
 *  (trustworthy). 'role' = cheapest card sharing the same deck role (looser). */
export type SwapSource = 'similar' | 'role';

export interface SwapSuggestion {
  name: string;
  price: number;
  inclusion: number;
  cmc?: number;
  source: SwapSource;
  /** Resolved (cheapest-printing) card image URL, if known. */
  imageUrl?: string;
  /** Front-face type line, for quick functional comparison. */
  typeLine?: string;
  /** Mana cost string (e.g. "{2}{B}{B}"), for symbol display. */
  manaCost?: string;
  /** Functional similarity to the card being replaced, 0..1 (similar swaps only). */
  similarity?: number;
  /** The exact (cheapest-printing) card this row prices — so the preview matches. */
  card?: ScryfallCard;
}

/** A priced, color-resolved candidate alternative for a single deck card. */
export interface CandidateCard {
  name: string;
  price: number;
  inclusion: number;
  cmc?: number;
  colorIdentity: string[];
  imageUrl?: string;
  typeLine?: string;
  manaCost?: string;
  /** Functional similarity to the card being replaced, 0..1. */
  similarity?: number;
  /** The exact (cheapest-printing) Scryfall card backing this candidate. */
  card?: ScryfallCard;
}

export interface SwapRow {
  id: string;
  current: ScryfallCard;
  currentPrice: number;
  currentInclusion: number;
  suggestion: SwapSuggestion;
  savings: number;
  confidence: Confidence;
  category: 'spell' | 'land';
  /** Other valid cheaper candidates (incl. the chosen one), cheapest first. */
  alternatives: SwapSuggestion[];
}

/** Max candidate alternatives surfaced per row in the UI. */
export const MAX_ALTERNATIVES = 12;

export interface CostPlan {
  currentTotal: number;
  minTotal: number;
  /** Trustworthy swaps from EDHREC similar-card data. */
  similarRows: SwapRow[];
  /** Looser swaps from the role pool (lands + spells with no similar match). */
  roleRows: SwapRow[];
  protected: { name: string; reason: 'commander' | 'must-include' | 'basic-land' | 'no-price' }[];
}

export interface BuildCostPlanOptions {
  mustIncludeNames: Set<string>;
  excludeFromSuggestions: Set<string>;
  currency: 'USD' | 'EUR';
  /** Commander color identity — candidates outside it are filtered out. */
  deckColorIdentity: string[];
  /** Card name → priced similar candidates (EDHREC similarity order). */
  similarCandidates: Map<string, CandidateCard[]>;
  /** Only these deck cards are offered a swap (the priciest N). */
  scopeNames: Set<string>;
}

/** A candidate is castable only if every color in its identity is in the deck's. */
function withinColorIdentity(cardCI: string[], deckCI: string[]): boolean {
  const deck = new Set(deckCI.map(c => c.toUpperCase()));
  return cardCI.every(c => deck.has(c.toUpperCase()));
}

const CURRENCY_PREFIX: Record<'USD' | 'EUR', string> = { USD: '$', EUR: '€' };

export function formatPrice(amount: number, currency: 'USD' | 'EUR' = 'USD'): string {
  return `${CURRENCY_PREFIX[currency]}${amount.toFixed(2)}`;
}

export function parsePrice(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const DROP_IN_INCLUSION_BAND = 15;
const SIDEGRADE_INCLUSION_BAND = 35;
const DROP_IN_CMC_BAND = 1;

export function classifyConfidence(
  currentInclusion: number,
  currentCmc: number | undefined,
  suggestion: SwapSuggestion,
): Confidence {
  const inclusionDelta = currentInclusion - suggestion.inclusion;
  const cmcDelta = currentCmc != null && suggestion.cmc != null
    ? Math.abs(currentCmc - suggestion.cmc)
    : Infinity;

  if (
    cmcDelta <= DROP_IN_CMC_BAND &&
    inclusionDelta <= DROP_IN_INCLUSION_BAND &&
    suggestion.inclusion > 0
  ) {
    return 'drop-in';
  }
  if (inclusionDelta <= SIDEGRADE_INCLUSION_BAND && suggestion.inclusion > 0) {
    return 'sidegrade';
  }
  return 'budget';
}

/**
 * EDHREC-similar swaps are functionally similar by construction, so we don't
 * gate them on inclusion % (which is usually unknown for arbitrary similar
 * cards). Closeness in mana cost is the only confidence signal: same-ish CMC
 * reads as a drop-in, otherwise a sidegrade. Never a budget pick.
 */
export function classifySimilar(currentCmc: number | undefined, suggestion: SwapSuggestion): Confidence {
  const cmcDelta = currentCmc != null && suggestion.cmc != null
    ? Math.abs(currentCmc - suggestion.cmc)
    : Infinity;
  return cmcDelta <= DROP_IN_CMC_BAND ? 'drop-in' : 'sidegrade';
}

/** All role-pool cards cheaper than the current card, cheapest first (the looser channel). */
export function collectRoleSuggestions(
  pool: RecommendedCard[],
  currentPrice: number,
  excludeNames: Set<string>,
): SwapSuggestion[] {
  const out: SwapSuggestion[] = [];
  for (const cand of pool) {
    if (excludeNames.has(cand.name)) continue;
    const price = parsePrice(cand.price);
    if (price == null || price >= currentPrice) continue;
    out.push({ name: cand.name, price, inclusion: cand.inclusion ?? 0, cmc: cand.cmc, source: 'role' });
  }
  return out.sort((a, b) => a.price - b.price);
}

/**
 * All EDHREC-similar cards cheaper than the current card, within the deck's
 * color identity and not excluded — cheapest first. These are functionally
 * similar swaps (the trustworthy channel).
 */
export function collectSimilarSuggestions(
  candidates: CandidateCard[],
  currentPrice: number,
  excludeNames: Set<string>,
  deckColorIdentity: string[],
): SwapSuggestion[] {
  const out: SwapSuggestion[] = [];
  for (const cand of candidates) {
    if (excludeNames.has(cand.name)) continue;
    if (!withinColorIdentity(cand.colorIdentity, deckColorIdentity)) continue;
    if (cand.price >= currentPrice) continue;
    out.push({
      name: cand.name,
      price: cand.price,
      inclusion: cand.inclusion,
      cmc: cand.cmc,
      source: 'similar',
      imageUrl: cand.imageUrl,
      typeLine: cand.typeLine,
      manaCost: cand.manaCost,
      similarity: cand.similarity,
      card: cand.card,
    });
  }
  // Most similar first (so the default pick is the best match); price breaks
  // near-ties — similarity bucketed to 0.01 so a marginally-better match never
  // wins over a much cheaper, near-identical card.
  return out.sort((a, b) => {
    const sa = Math.round((a.similarity ?? 0) * 100);
    const sb = Math.round((b.similarity ?? 0) * 100);
    return sb !== sa ? sb - sa : a.price - b.price;
  });
}

/** Assemble a swap row for a chosen suggestion — recomputes savings + confidence. */
export function buildSwapRow(
  current: ScryfallCard,
  currentPrice: number,
  currentInclusion: number,
  suggestion: SwapSuggestion,
  alternatives: SwapSuggestion[],
): SwapRow {
  const confidence = suggestion.source === 'similar'
    ? classifySimilar(current.cmc, suggestion)
    : classifyConfidence(currentInclusion, current.cmc, suggestion);
  return {
    id: current.name,
    current,
    currentPrice,
    currentInclusion,
    suggestion,
    savings: currentPrice - suggestion.price,
    confidence,
    category: isAnyLand(current) ? 'land' : 'spell',
    alternatives,
  };
}

const CONFIDENCE_RANK: Record<Confidence, number> = {
  'drop-in': 0,
  sidegrade: 1,
  budget: 2,
};


export function buildCostPlan(
  cards: ScryfallCard[],
  commanderName: string,
  partnerCommanderName: string | undefined,
  analysis: DeckAnalysis,
  opts: BuildCostPlanOptions,
): CostPlan {
  const byRole = new Map<string, RecommendedCard[]>();
  const landPool: RecommendedCard[] = [];
  for (const rec of analysis.recommendations) {
    const isLand = (rec.primaryType ?? '').includes('Land');
    if (isLand) landPool.push(rec);
    const key = rec.role ?? `type:${(rec.primaryType ?? 'other').toLowerCase()}`;
    if (!byRole.has(key)) byRole.set(key, []);
    byRole.get(key)!.push(rec);
  }

  const inDeckNames = new Set(cards.map(c => c.name));

  const similarRows: SwapRow[] = [];
  const roleRows: SwapRow[] = [];
  const protectedList: CostPlan['protected'] = [];

  let currentTotal = 0;

  for (const card of cards) {
    const priceRaw = getCardPrice(card, opts.currency);
    const price = parsePrice(priceRaw);
    if (price != null) currentTotal += price;

    if (card.name === commanderName) {
      protectedList.push({ name: card.name, reason: 'commander' });
      continue;
    }
    if (partnerCommanderName && card.name === partnerCommanderName) {
      protectedList.push({ name: card.name, reason: 'commander' });
      continue;
    }
    if (opts.mustIncludeNames.has(card.name)) {
      protectedList.push({ name: card.name, reason: 'must-include' });
      continue;
    }
    if (BASIC_LAND_NAMES.has(card.name)) {
      protectedList.push({ name: card.name, reason: 'basic-land' });
      continue;
    }
    if (price == null) {
      protectedList.push({ name: card.name, reason: 'no-price' });
      continue;
    }

    // Only the priciest N cards (resolved by the caller) are offered swaps.
    if (!opts.scopeNames.has(card.name)) continue;

    const exclude = new Set<string>([
      card.name,
      // The commander (+ partner) live outside `cards`, so they aren't in
      // inDeckNames — exclude them explicitly or EDHREC "similar" data can
      // surface our own commander as a swap target (which can't be played).
      commanderName,
      ...(partnerCommanderName ? [partnerCommanderName] : []),
      ...inDeckNames,
      ...opts.excludeFromSuggestions,
    ]);
    const isLand = isAnyLand(card);

    // Spells try the trustworthy EDHREC-similar channel first; lands and any
    // spell with no similar match fall back to the looser role pool.
    let alternatives: SwapSuggestion[] = [];
    if (!isLand) {
      alternatives = collectSimilarSuggestions(
        opts.similarCandidates.get(card.name) ?? [],
        price,
        exclude,
        opts.deckColorIdentity,
      );
    }
    if (alternatives.length === 0) {
      const pool = isLand
        ? landPool
        : (card.deckRole ? (byRole.get(card.deckRole) ?? []) : []);
      alternatives = collectRoleSuggestions(pool, price, exclude);
    }
    if (alternatives.length === 0) continue;

    alternatives = alternatives.slice(0, MAX_ALTERNATIVES);
    const currentInclusion = analysis.recommendations.find(r => r.name === card.name)?.inclusion ?? 0;
    // Default pick = cheapest; the user can choose another in the UI.
    const row = buildSwapRow(card, price, currentInclusion, alternatives[0], alternatives);

    if (row.suggestion.source === 'similar') similarRows.push(row);
    else roleRows.push(row);
  }

  const allSavings = [...similarRows, ...roleRows].reduce((s, r) => s + r.savings, 0);
  const minTotal = Math.max(0, currentTotal - allSavings);

  const sortRows = (rs: SwapRow[]) => rs.sort((a, b) => {
    const c = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
    return c !== 0 ? c : b.savings - a.savings;
  });
  sortRows(similarRows);
  sortRows(roleRows);

  return { currentTotal, minTotal, similarRows, roleRows, protected: protectedList };
}
