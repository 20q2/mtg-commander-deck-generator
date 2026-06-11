import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import type { ScryfallCard, DetectedCombo } from '@/types';
import type { DeckAnalysis, OptimizeSwaps } from '@/services/deckBuilder/deckAnalyzer';
import { getSwapCandidatesForCard } from '@/services/deckBuilder/cardSwap';
import { useStore } from '@/store';
import { ComboDisplay } from '@/components/deck/ComboDisplay';
import { OptimizePlanHeader, type OptimizeView } from './OptimizePlanHeader';
import { OptimizeColumn } from './OptimizeColumn';
import { OptimizeDrilldown } from './OptimizeDrilldown';
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
  /** Direct deck mutators for the combos panel (Inspector context — no regen). */
  onAddCards?: (names: string[], destination: 'deck' | 'sideboard' | 'maybeboard') => void;
  onRemoveCards?: (names: string[]) => void;
  /**
   * When a user follows a dashboard suggestion into this tab, the suggested
   * card is pre-checked on the matching side. Cleared via `onPreSelectConsumed`
   * after it is applied so it doesn't re-apply on tab switches.
   *
   * If `comboId` is set, the tab also switches to the Combos sub-view and
   * scrolls to the matching combo — used by the "complete this combo"
   * suggestion so users land on the combo breakdown, not the swap columns.
   */
  preSelect?: { cardName: string; side: 'add' | 'remove'; comboId?: string } | null;
  onPreSelectConsumed?: () => void;
  /** Shared swap list lifted to DeckOptimizer so dashboard + optimize tab stay in sync. */
  baseSwaps?: OptimizeSwaps;
}

export function OptimizeTabContent({
  analysis, currentCards, commanderName, partnerCommanderName,
  cardInclusionMap, mustIncludeNames, bannedNames,
  onApply, onPreviewCard,
  onFocusedMisfitChange,
  onAddCards, onRemoveCards,
  preSelect, onPreSelectConsumed,
  baseSwaps,
}: OptimizeTabContentProps) {
  // Subscribe to store directly so we get a stable reference for the combos
  // array (Zustand returns the same slice instance until it actually changes).
  const deck = useStore(s => s.generatedDeck);
  const detectedCombos = deck?.detectedCombos ?? EMPTY_COMBOS;

  const [activeRemoveName, setActiveRemoveName] = useState<string | null>(null);
  const [activeAddName, setActiveAddName] = useState<string | null>(null);
  const [, setHighlightedComboId] = useState<string | null>(null);
  const [view, setView] = useState<OptimizeView>('swaps');

  const plan = useOptimizePlan({
    analysis, currentCards, cardInclusionMap,
    commanderName, partnerCommanderName,
    mustIncludeNames, bannedNames, detectedCombos,
    onApply,
    highlightRemovals: view === 'swaps',
    baseSwaps,
  });
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
  const hasSelections = plan.checkedRemovals.length > 0 || plan.checkedAdditions.length > 0;

  // Apply a pre-selection from a dashboard suggestion. If the suggested card
  // isn't present in the current optimize list (e.g. due to capping), skip
  // gracefully — the user will still land on the tab. When the suggestion
  // carries a comboId, also open the Combos sub-view and flash that combo so
  // the user sees the combo breakdown instead of the default swap columns.
  useEffect(() => {
    if (!preSelect) return;
    const list = preSelect.side === 'add' ? plan.additions : plan.removals;
    const exists = list.some(c => c.name === preSelect.cardName);
    if (exists) {
      if (preSelect.side === 'add') plan.selectAdditionGroup([preSelect.cardName]);
      else plan.selectRemovalGroup([preSelect.cardName]);
    }
    if (preSelect.comboId) {
      flashCombo(preSelect.comboId);
    }
    onPreSelectConsumed?.();
  }, [preSelect, onPreSelectConsumed, plan.additions, plan.removals, plan.selectAdditionGroup, plan.selectRemovalGroup, flashCombo]);

  return (
    <div className="space-y-3 sm:space-y-4 px-3 sm:px-4 pb-3 sm:pb-4 pt-0">
      <OptimizePlanHeader
        totals={plan.totals}
        applying={plan.applying}
        hasSwaps={hasSwaps}
        hasSelections={hasSelections}
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
                onPreviewCard={onPreviewCard}
                onViewCombo={flashCombo}
              />
            )}
          />
        </div>
      )}

      {view === 'combos' && (
        <div ref={footerRef}>
          <ComboDisplay
            combos={detectedCombos}
            onAddToDeck={onAddCards ? (names) => onAddCards(names, 'deck') : undefined}
            onRemoveFromDeck={onRemoveCards}
            forceExpanded
          />
        </div>
      )}
    </div>
  );
}
