import type { ScryfallCard } from '@/types';
import type { RecommendedCard, DeckAnalysis } from './deckAnalyzer';
import { isAnyLand, BASIC_LAND_NAMES, getCardPrice } from '@/services/scryfall/client';

export type Confidence = 'drop-in' | 'sidegrade' | 'budget';

export interface SwapSuggestion {
  name: string;
  price: number;
  inclusion: number;
  cmc?: number;
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
}

export interface CostPlan {
  currentTotal: number;
  minTotal: number;
  spellRows: SwapRow[];
  landRows: SwapRow[];
  protected: { name: string; reason: 'commander' | 'must-include' | 'basic-land' | 'no-price' }[];
}

export interface BuildCostPlanOptions {
  mustIncludeNames: Set<string>;
  excludeFromSuggestions: Set<string>;
  currency: 'USD' | 'EUR';
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

export function pickCheapestAlternative(
  pool: RecommendedCard[],
  currentPrice: number,
  excludeNames: Set<string>,
): SwapSuggestion | null {
  let best: SwapSuggestion | null = null;
  for (const cand of pool) {
    if (excludeNames.has(cand.name)) continue;
    const price = parsePrice(cand.price);
    if (price == null) continue;
    if (price >= currentPrice) continue;
    if (best && price >= best.price) continue;
    best = {
      name: cand.name,
      price,
      inclusion: cand.inclusion ?? 0,
      cmc: cand.cmc,
    };
  }
  return best;
}

const CONFIDENCE_RANK: Record<Confidence, number> = {
  'drop-in': 0,
  sidegrade: 1,
  budget: 2,
};

export function autoCheckToTarget(
  rows: SwapRow[],
  currentTotal: number,
  target: number,
  enabledConfidences: Set<Confidence>,
  manuallyExcluded: Set<string>,
): Set<string> {
  const picked = new Set<string>();
  if (currentTotal <= target) return picked;

  const ordered = [...rows].sort((a, b) => {
    const c = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
    if (c !== 0) return c;
    return b.savings - a.savings;
  });

  let total = currentTotal;
  for (const row of ordered) {
    if (total <= target) break;
    if (!enabledConfidences.has(row.confidence)) continue;
    if (manuallyExcluded.has(row.id)) continue;
    picked.add(row.id);
    total -= row.savings;
  }
  return picked;
}

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

  const spellRows: SwapRow[] = [];
  const landRows: SwapRow[] = [];
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

    const exclude = new Set<string>([
      card.name,
      ...inDeckNames,
      ...opts.excludeFromSuggestions,
    ]);
    const isLand = isAnyLand(card);
    const pool = isLand
      ? landPool
      : (card.deckRole ? (byRole.get(card.deckRole) ?? []) : []);

    const suggestion = pickCheapestAlternative(pool, price, exclude);
    if (!suggestion) continue;

    const currentInclusion = analysis.recommendations.find(r => r.name === card.name)?.inclusion ?? 0;
    const confidence = classifyConfidence(currentInclusion, card.cmc, suggestion);

    const row: SwapRow = {
      id: card.name,
      current: card,
      currentPrice: price,
      currentInclusion,
      suggestion,
      savings: price - suggestion.price,
      confidence,
      category: isLand ? 'land' : 'spell',
    };
    if (isLand) landRows.push(row);
    else spellRows.push(row);
  }

  const allSavings = [...spellRows, ...landRows].reduce((s, r) => s + r.savings, 0);
  const minTotal = Math.max(0, currentTotal - allSavings);

  const sortRows = (rs: SwapRow[]) => rs.sort((a, b) => {
    const c = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
    return c !== 0 ? c : b.savings - a.savings;
  });
  sortRows(spellRows);
  sortRows(landRows);

  return { currentTotal, minTotal, spellRows, landRows, protected: protectedList };
}
