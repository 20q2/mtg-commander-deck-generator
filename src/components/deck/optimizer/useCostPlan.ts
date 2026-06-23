import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScryfallCard } from '@/types';
import type { DeckAnalysis } from '@/services/deckBuilder/deckAnalyzer';
import {
  buildCostPlan, parsePrice,
  type CandidateCard, type CostPlan,
} from '@/services/deckBuilder/costAnalyzer';
import {
  getCardPrice, getCardImageUrl, getCheapestPrintings, isAnyLand, BASIC_LAND_NAMES,
} from '@/services/scryfall/client';
import { fetchSimilarCards } from '@/services/edhrec/client';
import { scoreSimilarity } from '@/services/deckBuilder/cardSimilarity';

export interface UseCostPlanOptions {
  commanderName: string;
  partnerCommanderName?: string;
  currentCards: ScryfallCard[];
  analysis: DeckAnalysis | null;
  mustIncludeNames: Set<string>;
  excludeFromSuggestions: Set<string>;
  currency: 'USD' | 'EUR';
}

/** Only the priciest N non-protected cards are worth optimizing. */
const TOP_N = 20;
/** Cards below this aren't worth a swap suggestion. */
const PRICE_FLOOR = 1;
/** Cap similar candidates considered per card (bounds the Scryfall price fetch). */
const MAX_SIMILAR_PER_CARD = 12;

/** Deck color identity: commander (+ partner). Falls back to the union of all cards. */
function resolveDeckColorIdentity(
  cards: ScryfallCard[],
  commanderName: string,
  partnerCommanderName?: string,
): string[] {
  const ci = new Set<string>();
  for (const c of cards) {
    if (c.name === commanderName || (partnerCommanderName && c.name === partnerCommanderName)) {
      for (const color of c.color_identity ?? []) ci.add(color.toUpperCase());
    }
  }
  if (ci.size === 0) {
    for (const c of cards) for (const color of c.color_identity ?? []) ci.add(color.toUpperCase());
  }
  return [...ci];
}

interface CostPlanInputs {
  scopeNames: Set<string>;
  /** In-scope, non-land card names that should be looked up for similar cards. */
  spellNamesToFetch: string[];
  deckColorIdentity: string[];
}

/** Pure: decide which cards are in scope (priciest N) and which need a similar lookup. */
function resolveInputs(
  cards: ScryfallCard[],
  commanderName: string,
  partnerCommanderName: string | undefined,
  opts: { mustIncludeNames: Set<string>; currency: 'USD' | 'EUR' },
): CostPlanInputs {
  const eligible: { name: string; price: number; isLand: boolean }[] = [];
  for (const card of cards) {
    if (card.name === commanderName) continue;
    if (partnerCommanderName && card.name === partnerCommanderName) continue;
    if (opts.mustIncludeNames.has(card.name)) continue;
    if (BASIC_LAND_NAMES.has(card.name)) continue;
    const price = parsePrice(getCardPrice(card, opts.currency));
    if (price == null || price < PRICE_FLOOR) continue;
    eligible.push({ name: card.name, price, isLand: isAnyLand(card) });
  }
  eligible.sort((a, b) => b.price - a.price);
  const scoped = eligible.slice(0, TOP_N);
  return {
    scopeNames: new Set(scoped.map(c => c.name)),
    spellNamesToFetch: scoped.filter(c => !c.isLand).map(c => c.name),
    deckColorIdentity: resolveDeckColorIdentity(cards, commanderName, partnerCommanderName),
  };
}

export function useCostPlan(opts: UseCostPlanOptions): { plan: CostPlan | null; loading: boolean } {
  const {
    commanderName, partnerCommanderName, currentCards, analysis,
    mustIncludeNames, excludeFromSuggestions, currency,
  } = opts;

  const [plan, setPlan] = useState<CostPlan | null>(null);
  const [loading, setLoading] = useState(false);

  // Re-run when the deck contents, options, OR the analysis content the plan reads actually change.
  // buildCostPlan derives inclusion deltas / role+type buckets / confidence from analysis.recommendations,
  // and that object is replaced (new identity) on async theme-merge & pacing overrides without any card
  // name changing — so the signature must reflect those fields, not just `!!analysis`, or the plan goes
  // stale. (This useMemo only recomputes when `analysis` identity changes, so the join is cheap.)
  const depKey = useMemo(() => JSON.stringify({
    names: currentCards.map(c => c.name).sort(),
    commanderName, partnerCommanderName, currency,
    must: [...mustIncludeNames].sort(),
    excl: [...excludeFromSuggestions].sort(),
    recs: analysis
      ? analysis.recommendations.map(r => `${r.name}:${r.inclusion}:${r.role ?? ''}:${r.primaryType ?? ''}`).join('|')
      : null,
  }), [currentCards, commanderName, partnerCommanderName, currency, mustIncludeNames, excludeFromSuggestions, analysis]);

  const runIdRef = useRef(0);

  useEffect(() => {
    if (!analysis) { setPlan(null); setLoading(false); return; }
    const runId = ++runIdRef.current;
    setLoading(true);

    (async () => {
      const { scopeNames, spellNamesToFetch, deckColorIdentity } =
        resolveInputs(currentCards, commanderName, partnerCommanderName, { mustIncludeNames, currency });

      // 1. Similar-card names per in-scope spell (EDHREC, cached 14 days).
      const similarNames = await Promise.all(
        spellNamesToFetch.map(name =>
          fetchSimilarCards(name).then(list => ({ name, similar: list.slice(0, MAX_SIMILAR_PER_CARD) })))
      );
      if (runId !== runIdRef.current) return;

      // 2. Price every distinct candidate at its cheapest printing.
      const candidateNames = new Set<string>();
      for (const { similar } of similarNames) for (const n of similar) candidateNames.add(n);
      const priced = candidateNames.size > 0
        ? await getCheapestPrintings([...candidateNames])
        : new Map<string, ScryfallCard>();
      if (runId !== runIdRef.current) return;

      // 3. Build priced, color-resolved candidate lists keyed by source card,
      //    scoring each candidate's functional similarity to the card it'd replace.
      const inclusionByName = new Map(analysis.recommendations.map(r => [r.name, r.inclusion]));
      const cardByName = new Map(currentCards.map(c => [c.name, c]));
      const similarCandidates = new Map<string, CandidateCard[]>();
      for (const { name, similar } of similarNames) {
        const currentCard = cardByName.get(name);
        const cands: CandidateCard[] = [];
        for (let i = 0; i < similar.length; i++) {
          const card = priced.get(similar[i]);
          if (!card) continue;
          const price = parsePrice(getCardPrice(card, currency));
          if (price == null) continue;
          cands.push({
            name: similar[i],
            price,
            inclusion: inclusionByName.get(similar[i]) ?? 0,
            cmc: card.cmc,
            colorIdentity: card.color_identity ?? [],
            imageUrl: getCardImageUrl(card, 'normal') ?? undefined,
            typeLine: card.type_line,
            manaCost: card.mana_cost,
            similarity: currentCard ? scoreSimilarity(currentCard, card, i, similar.length) : 0,
            card,
          });
        }
        similarCandidates.set(name, cands);
      }

      const built = buildCostPlan(currentCards, commanderName, partnerCommanderName, analysis, {
        mustIncludeNames,
        excludeFromSuggestions,
        currency,
        deckColorIdentity,
        similarCandidates,
        scopeNames,
      });
      if (runId !== runIdRef.current) return;
      setPlan(built);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);

  return { plan, loading };
}
