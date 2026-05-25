import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ScryfallCard, DetectedCombo } from '@/types';
import {
  computeOptimizeSwaps,
  type DeckAnalysis,
  type OptimizeCard,
} from '@/services/deckBuilder/deckAnalyzer';
import { getCardPrice, getCachedCard, getCardsByNames } from '@/services/scryfall/client';

export interface UseOptimizePlanOptions {
  analysis: DeckAnalysis;
  currentCards: ScryfallCard[];
  cardInclusionMap?: Record<string, number>;
  commanderName: string;
  partnerCommanderName?: string;
  mustIncludeNames: Set<string>;
  bannedNames: Set<string>;
  detectedCombos?: DetectedCombo[];
  onApply: (removals: string[], additions: string[]) => void | Promise<void>;
}

export interface OptimizePlanTotals {
  removeCount: number;
  addCount: number;
  totalChanges: number;
  priceDelta: number | null; // null when no price data is available for any selected card
  scoreDelta: number;        // sum of inclusion(adds) − sum of inclusion(cuts)
  projectedSize: number;
  targetSize: number;
  overBy: number;
}

function resolvePrice(card: OptimizeCard): string | undefined {
  if (card.price) return card.price;
  const cached = getCachedCard(card.name);
  if (cached) return getCardPrice(cached) || undefined;
  return undefined;
}

export function useOptimizePlan(opts: UseOptimizePlanOptions) {
  const {
    analysis, currentCards, cardInclusionMap,
    commanderName, partnerCommanderName,
    mustIncludeNames, bannedNames, detectedCombos,
    onApply,
  } = opts;

  const [extraAdditions, setExtraAdditions] = useState<OptimizeCard[]>([]);
  const [uncheckedRemovals, setUncheckedRemovals] = useState<Set<string>>(new Set());
  const [uncheckedAdditions, setUncheckedAdditions] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  const baseSwaps = useMemo(
    () => computeOptimizeSwaps({
      analysis, currentCards, cardInclusionMap,
      commanderName, partnerCommanderName,
      mustIncludeNames, bannedNames, detectedCombos,
    }),
    [analysis, currentCards, cardInclusionMap, commanderName, partnerCommanderName, mustIncludeNames, bannedNames, detectedCombos],
  );

  const additions = useMemo(() => {
    if (extraAdditions.length === 0) return baseSwaps.additions;
    const existingNames = new Set(baseSwaps.additions.map(c => c.name));
    const novel = extraAdditions.filter(c => !existingNames.has(c.name));
    return [...baseSwaps.additions, ...novel];
  }, [baseSwaps.additions, extraAdditions]);

  const removals = baseSwaps.removals;

  const checkedRemovals = useMemo(
    () => removals.filter(c => !uncheckedRemovals.has(c.name)),
    [removals, uncheckedRemovals],
  );
  const checkedAdditions = useMemo(
    () => additions.filter(c => !uncheckedAdditions.has(c.name)),
    [additions, uncheckedAdditions],
  );

  const totals = useMemo<OptimizePlanTotals>(() => {
    const targetSize = analysis.manaBase.deckSize;
    const projectedSize = currentCards.length - checkedRemovals.length + checkedAdditions.length;
    let removedPrice = 0, addedPrice = 0;
    let hasAnyPrice = false;
    for (const c of checkedRemovals) {
      const p = resolvePrice(c);
      if (p) { removedPrice += parseFloat(p); hasAnyPrice = true; }
    }
    for (const c of checkedAdditions) {
      const p = resolvePrice(c);
      if (p) { addedPrice += parseFloat(p); hasAnyPrice = true; }
    }
    const removedScore = checkedRemovals.reduce((s, c) => s + (c.inclusion ?? 0), 0);
    const addedScore = checkedAdditions.reduce((s, c) => s + (c.inclusion ?? 0), 0);
    return {
      removeCount: checkedRemovals.length,
      addCount: checkedAdditions.length,
      totalChanges: checkedRemovals.length + checkedAdditions.length,
      priceDelta: hasAnyPrice ? addedPrice - removedPrice : null,
      scoreDelta: Math.round(addedScore - removedScore),
      projectedSize,
      targetSize,
      overBy: Math.max(0, projectedSize - targetSize),
    };
  }, [analysis, currentCards.length, checkedRemovals, checkedAdditions]);

  const toggleRemoval = useCallback((name: string) => {
    setUncheckedRemovals(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleAddition = useCallback((name: string) => {
    setUncheckedAdditions(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const selectAllRemovals = useCallback(() => setUncheckedRemovals(new Set()), []);
  const deselectAllRemovals = useCallback(() => {
    setUncheckedRemovals(new Set(removals.map(c => c.name)));
  }, [removals]);
  const selectAllAdditions = useCallback(() => setUncheckedAdditions(new Set()), []);
  const deselectAllAdditions = useCallback(() => {
    setUncheckedAdditions(new Set(additions.map(c => c.name)));
  }, [additions]);

  const resetSelections = useCallback(() => {
    setUncheckedRemovals(new Set());
    setUncheckedAdditions(new Set());
  }, []);

  const addExtraCandidate = useCallback((card: OptimizeCard) => {
    setExtraAdditions(prev => {
      if (prev.some(c => c.name === card.name)) return prev;
      return [...prev, card];
    });
    setUncheckedAdditions(prev => {
      if (!prev.has(card.name)) return prev;
      const next = new Set(prev);
      next.delete(card.name);
      return next;
    });
  }, []);

  const apply = useCallback(async () => {
    if (totals.totalChanges === 0 || applying) return;
    setApplying(true);
    const rems = checkedRemovals.map(c => c.name);
    const adds = checkedAdditions.map(c => c.name);
    if (adds.length > 0) await getCardsByNames(adds);
    await onApply(rems, adds);
    setExtraAdditions([]);
    setUncheckedRemovals(new Set());
    setUncheckedAdditions(new Set());
    setTimeout(() => setApplying(false), 600);
  }, [totals.totalChanges, applying, checkedRemovals, checkedAdditions, onApply]);

  useEffect(() => {
    document.dispatchEvent(new CustomEvent('deck-optimizer-removals', {
      detail: { names: checkedRemovals.map(c => c.name) },
    }));
  }, [checkedRemovals]);

  useEffect(() => {
    return () => {
      document.dispatchEvent(new CustomEvent('deck-optimizer-removals', {
        detail: { names: [] },
      }));
    };
  }, []);

  return {
    removals,
    additions,
    uncheckedRemovals,
    uncheckedAdditions,
    checkedRemovals,
    checkedAdditions,
    totals,
    applying,
    toggleRemoval,
    toggleAddition,
    selectAllRemovals,
    deselectAllRemovals,
    selectAllAdditions,
    deselectAllAdditions,
    resetSelections,
    addExtraCandidate,
    apply,
  };
}
