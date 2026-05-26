import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import type { ScryfallCard, DetectedCombo } from '@/types';
import type { DeckAnalysis } from '@/services/deckBuilder/deckAnalyzer';
import { getSwapCandidatesForCard } from '@/services/deckBuilder/cardSwap';
import { useStore } from '@/store';
import { OptimizePlanHeader, type OptimizeView } from './OptimizePlanHeader';
import { OptimizeColumn } from './OptimizeColumn';
import { OptimizeDrilldown } from './OptimizeDrilldown';
import { OptimizeComboFooter } from './OptimizeComboFooter';
import { useOptimizePlan } from './useOptimizePlan';

// Module-level constant so optional-prop fallbacks don't allocate fresh arrays
// each render (which would invalidate downstream useMemo deps).
const EMPTY_COMBOS: DetectedCombo[] = [];

export interface OptimizeTabContentProps {
  analysis: DeckAnalysis;
  currentCards: ScryfallCard[];
  commanderName: string;
  partnerCommanderName?: string;
  cardInclusionMap?: Record<string, number>;
  mustIncludeNames: Set<string>;
  bannedNames: Set<string>;
  onApply: (removals: string[], additions: string[]) => void | Promise<void>;
  onPreviewCard: (name: string) => void;
  /** Fired when the user opens the drill-down for a cut card. Enables deck-view highlight. */
  onFocusedMisfitChange?: (name: string | null) => void;
}

export function OptimizeTabContent({
  analysis, currentCards, commanderName, partnerCommanderName,
  cardInclusionMap, mustIncludeNames, bannedNames,
  onApply, onPreviewCard,
  onFocusedMisfitChange,
}: OptimizeTabContentProps) {
  // Subscribe to store directly so we get a stable reference for the combos
  // array (Zustand returns the same slice instance until it actually changes).
  const deck = useStore(s => s.generatedDeck);
  const detectedCombos = deck?.detectedCombos ?? EMPTY_COMBOS;

  const plan = useOptimizePlan({
    analysis, currentCards, cardInclusionMap,
    commanderName, partnerCommanderName,
    mustIncludeNames, bannedNames, detectedCombos,
    onApply,
  });

  const [activeRemoveName, setActiveRemoveName] = useState<string | null>(null);
  const [activeAddName, setActiveAddName] = useState<string | null>(null);
  const [highlightedComboId, setHighlightedComboId] = useState<string | null>(null);
  const [view, setView] = useState<OptimizeView>('swaps');
  const highlightTimerRef = useRef<number | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);

  const handleToggleRemove = useCallback((name: string) => {
    setActiveRemoveName(curr => (curr === name ? null : name));
  }, []);
  const handleToggleAdd = useCallback((name: string) => {
    setActiveAddName(curr => (curr === name ? null : name));
  }, []);

  useEffect(() => {
    onFocusedMisfitChange?.(activeRemoveName);
    return () => onFocusedMisfitChange?.(null);
  }, [activeRemoveName, onFocusedMisfitChange]);

  const candidatesForActiveRemove = useMemo<ScryfallCard[] | undefined>(() => {
    if (!activeRemoveName || !deck) return undefined;
    const card = currentCards.find(c => c.name === activeRemoveName);
    if (!card) return undefined;
    return getSwapCandidatesForCard(deck, card).slice(0, 6);
  }, [activeRemoveName, deck, currentCards]);

  const comboForActiveAdd = useMemo<DetectedCombo | undefined>(() => {
    if (!activeAddName || !detectedCombos) return undefined;
    return detectedCombos.find(c => c.missingCards.length === 1 && c.missingCards[0] === activeAddName);
  }, [activeAddName, detectedCombos]);

  const addColumnNames = useMemo(() => new Set(plan.additions.map(c => c.name)), [plan.additions]);

  const flashCombo = useCallback((comboId: string) => {
    setView('combos');
    setHighlightedComboId(comboId);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => setHighlightedComboId(null), 1500);
    // Defer scroll to the next frame so the combos panel has rendered.
    requestAnimationFrame(() => {
      const el = footerRef.current?.querySelector<HTMLElement>(`[data-combo-id="${comboId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  useEffect(() => () => {
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
  }, []);

  const hasSwaps = plan.removals.length > 0 || plan.additions.length > 0;
  const hasUnchecked = plan.uncheckedRemovals.size > 0 || plan.uncheckedAdditions.size > 0;

  return (
    <div className="space-y-3 sm:space-y-4 px-3 sm:px-4 pb-3 sm:pb-4 pt-0">
      <OptimizePlanHeader
        totals={plan.totals}
        applying={plan.applying}
        hasSwaps={hasSwaps}
        hasUnchecked={hasUnchecked}
        onApply={plan.apply}
        onReset={plan.resetSelections}
        view={view}
        onViewChange={setView}
        comboCount={detectedCombos.length}
      />

      {hasSwaps && view === 'swaps' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
          <OptimizeColumn
            side="remove"
            cards={plan.removals}
            uncheckedNames={plan.uncheckedRemovals}
            activeName={activeRemoveName}
            totalCount={plan.removals.length}
            onTileClick={handleToggleRemove}
            onToggleChecked={plan.toggleRemoval}
            onSelectAll={plan.selectAllRemovals}
            onDeselectAll={plan.deselectAllRemovals}
            onSelectGroup={plan.selectRemovalGroup}
            onDeselectGroup={plan.deselectRemovalGroup}
            renderDrilldown={(card) => (
              <OptimizeDrilldown
                card={card}
                side="remove"
                checked={!plan.uncheckedRemovals.has(card.name)}
                synergy={deck?.cardSynergyMap?.[card.name]}
                candidates={candidatesForActiveRemove}
                onToggle={plan.toggleRemoval}
                onClose={() => setActiveRemoveName(null)}
                onPreviewCard={onPreviewCard}
              />
            )}
          />

          <OptimizeColumn
            side="add"
            cards={plan.additions}
            uncheckedNames={plan.uncheckedAdditions}
            activeName={activeAddName}
            totalCount={plan.additions.length}
            onTileClick={handleToggleAdd}
            onToggleChecked={plan.toggleAddition}
            onSelectAll={plan.selectAllAdditions}
            onDeselectAll={plan.deselectAllAdditions}
            onSelectGroup={plan.selectAdditionGroup}
            onDeselectGroup={plan.deselectAdditionGroup}
            renderDrilldown={(card) => (
              <OptimizeDrilldown
                card={card}
                side="add"
                checked={!plan.uncheckedAdditions.has(card.name)}
                synergy={deck?.cardSynergyMap?.[card.name]}
                combo={comboForActiveAdd}
                onToggle={plan.toggleAddition}
                onClose={() => setActiveAddName(null)}
                onViewCombo={flashCombo}
              />
            )}
          />
        </div>
      )}

      {view === 'combos' && (
        <div ref={footerRef}>
          <OptimizeComboFooter
            combos={detectedCombos}
            bannedNames={bannedNames}
            addColumnNames={addColumnNames}
            uncheckedAdditions={plan.uncheckedAdditions}
            onToggleAdd={plan.toggleAddition}
            onAddExtraCandidate={plan.addExtraCandidate}
            highlightedComboId={highlightedComboId}
          />
        </div>
      )}
    </div>
  );
}
