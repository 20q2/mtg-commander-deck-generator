import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScryfallCard, DetectedCombo } from '@/types';
import {
  computeOptimizeSwaps,
  type DeckAnalysis,
  type OptimizeCard,
  type OptimizeSwaps,
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
  /** When false, the removal-highlight event broadcasts an empty list so the
   *  play area on the right doesn't show red rings while the user is on a
   *  non-swap view (e.g. the combos panel). */
  highlightRemovals?: boolean;
  /**
   * Pre-computed swaps, shared across the dashboard's NextBestMove and the
   * optimize tab. Pass this when the caller wants both surfaces to read from
   * the same source. If omitted, the hook computes its own (legacy fallback).
   */
  baseSwaps?: OptimizeSwaps;
  /** When true, the additions list is limited to cards in `collectionNames`. */
  collectionOnly?: boolean;
  /** Owned-card names — required for `collectionOnly` to filter anything. */
  collectionNames?: Set<string>;
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
    onApply, highlightRemovals = true,
    baseSwaps: sharedSwaps,
    collectionOnly = false, collectionNames,
  } = opts;

  const [extraAdditions, setExtraAdditions] = useState<OptimizeCard[]>([]);
  // Track which cards the user has explicitly opted INTO. Default is nothing
  // selected — the optimize page asks the user to actively pick changes.
  const [checkedRemovalNames, setCheckedRemovalNames] = useState<Set<string>>(new Set());
  const [checkedAdditionNames, setCheckedAdditionNames] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  // Prefer the swaps computed by the caller (DeckOptimizer) so the dashboard
  // and optimize tab share identical data. Fall back to computing locally when
  // no shared list is provided.
  const localSwaps = useMemo(
    () => sharedSwaps ?? computeOptimizeSwaps({
      analysis, currentCards, cardInclusionMap,
      commanderName, partnerCommanderName,
      mustIncludeNames, bannedNames, detectedCombos,
    }),
    [sharedSwaps, analysis, currentCards, cardInclusionMap, commanderName, partnerCommanderName, mustIncludeNames, bannedNames, detectedCombos],
  );
  const baseSwaps = localSwaps;

  const additions = useMemo(() => {
    // "In collection" limits the suggested adds to cards the user owns. It never
    // touches extras — those are cards the user explicitly opted into.
    const suggested = collectionOnly && collectionNames
      ? baseSwaps.additions.filter(c => collectionNames.has(c.name))
      : baseSwaps.additions;
    if (extraAdditions.length === 0) return suggested;
    const existingNames = new Set(suggested.map(c => c.name));
    const novel = extraAdditions.filter(c => !existingNames.has(c.name));
    return [...suggested, ...novel];
  }, [baseSwaps.additions, extraAdditions, collectionOnly, collectionNames]);

  const removals = baseSwaps.removals;

  const checkedRemovals = useMemo(
    () => removals.filter(c => checkedRemovalNames.has(c.name)),
    [removals, checkedRemovalNames],
  );
  const checkedAdditions = useMemo(
    () => additions.filter(c => checkedAdditionNames.has(c.name)),
    [additions, checkedAdditionNames],
  );
  // Expose unchecked sets for the existing UI surface (OptimizeColumn uses
  // `uncheckedNames` to render unchecked state). Derived from the current
  // list + checked sets.
  const uncheckedRemovals = useMemo(() => {
    const s = new Set<string>();
    for (const c of removals) if (!checkedRemovalNames.has(c.name)) s.add(c.name);
    return s;
  }, [removals, checkedRemovalNames]);
  const uncheckedAdditions = useMemo(() => {
    const s = new Set<string>();
    for (const c of additions) if (!checkedAdditionNames.has(c.name)) s.add(c.name);
    return s;
  }, [additions, checkedAdditionNames]);

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
    setCheckedRemovalNames(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleAddition = useCallback((name: string) => {
    setCheckedAdditionNames(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const selectAllRemovals = useCallback(() => {
    setCheckedRemovalNames(new Set(removals.map(c => c.name)));
  }, [removals]);
  const deselectAllRemovals = useCallback(() => setCheckedRemovalNames(new Set()), []);
  const selectAllAdditions = useCallback(() => {
    setCheckedAdditionNames(new Set(additions.map(c => c.name)));
  }, [additions]);
  const deselectAllAdditions = useCallback(() => setCheckedAdditionNames(new Set()), []);

  // Bulk select/deselect of a specific subset of names — used by per-group
  // select/deselect buttons.
  const selectRemovalGroup = useCallback((names: string[]) => {
    setCheckedRemovalNames(prev => {
      const next = new Set(prev);
      for (const n of names) next.add(n);
      return next;
    });
  }, []);
  const deselectRemovalGroup = useCallback((names: string[]) => {
    setCheckedRemovalNames(prev => {
      const next = new Set(prev);
      for (const n of names) next.delete(n);
      return next;
    });
  }, []);
  const selectAdditionGroup = useCallback((names: string[]) => {
    setCheckedAdditionNames(prev => {
      const next = new Set(prev);
      for (const n of names) next.add(n);
      return next;
    });
  }, []);
  const deselectAdditionGroup = useCallback((names: string[]) => {
    setCheckedAdditionNames(prev => {
      const next = new Set(prev);
      for (const n of names) next.delete(n);
      return next;
    });
  }, []);

  // Reset = clear all selections (return to the default "nothing selected" state).
  const resetSelections = useCallback(() => {
    setCheckedRemovalNames(new Set());
    setCheckedAdditionNames(new Set());
  }, []);

  const addExtraCandidate = useCallback((card: OptimizeCard) => {
    setExtraAdditions(prev => {
      if (prev.some(c => c.name === card.name)) return prev;
      return [...prev, card];
    });
    setCheckedAdditionNames(prev => {
      if (prev.has(card.name)) return prev;
      const next = new Set(prev);
      next.add(card.name);
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
    setCheckedRemovalNames(new Set());
    setCheckedAdditionNames(new Set());
    setTimeout(() => setApplying(false), 600);
  }, [totals.totalChanges, applying, checkedRemovals, checkedAdditions, onApply]);

  // Only dispatch the highlight event when the actual set of removed names
  // changes — comparing by joined string avoids the rerender loop that
  // happens when listeners setState on every reference change.
  const lastDispatchedKeyRef = useRef<string>('');
  useEffect(() => {
    const names = highlightRemovals ? checkedRemovals.map(c => c.name) : [];
    const key = names.join('\0');
    if (key === lastDispatchedKeyRef.current) return;
    lastDispatchedKeyRef.current = key;
    document.dispatchEvent(new CustomEvent('deck-optimizer-removals', {
      detail: { names },
    }));
  }, [checkedRemovals, highlightRemovals]);

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
    selectRemovalGroup,
    deselectRemovalGroup,
    selectAdditionGroup,
    deselectAdditionGroup,
    resetSelections,
    addExtraCandidate,
    apply,
  };
}
