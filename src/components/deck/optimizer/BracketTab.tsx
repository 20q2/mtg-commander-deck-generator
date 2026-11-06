import { useMemo } from 'react';
import { Gauge } from 'lucide-react';
import { useStore } from '@/store';
import type { EDHRECCommanderData, IntendedBracket, ScryfallCard } from '@/types';
import type { BracketBasis, BracketBlend } from '@/services/deckBuilder/bracketBlend';
import { buildBracketViewModel } from './bracket/bracketViewModel';
import { buildBracketGap } from './bracket/bracketGap';
import { overBracketGroups } from '@/services/deckBuilder/overBracket';
import { BracketAimSection } from './bracket/BracketAimSection';
import { RefinedVerdictView } from './bracket/RefinedVerdictView';
import { climbSuggestions } from './bracket/climbSuggestions';

export function BracketTabContent({
  onPreview,
  bracketBasis,
  bracketBlend,
  commanderName,
  deckNames,
  onAimChange,
  aimRefreshing = false,
  onOpenOverBracketSwaps,
  edhrecPage,
  deckCards,
}: {
  onPreview: (name: string) => void;
  /** What the deck is aimed at. An estimated basis is the reading itself, so it has no gap. */
  bracketBasis?: BracketBasis | null;
  bracketBlend?: BracketBlend | null;
  commanderName: string;
  deckNames: Set<string>;
  /** Absent → no aim control (the section still shows the reading). */
  onAimChange?: (bracket: IntendedBracket | null) => void;
  aimRefreshing?: boolean;
  /** Opens Card Fit on the "Above your bracket" swaps. Absent → no button. */
  onOpenOverBracketSwaps?: () => void;
  /** The commander's all-brackets EDHREC page: where the tuning rows' suggestions come from. */
  edhrecPage?: EDHRECCommanderData | null;
  deckCards?: ScryfallCard[];
}) {
  const bracketEstimation = useStore(s => s.generatedDeck?.bracketEstimation);
  const detectedCombos = useStore(s => s.generatedDeck?.detectedCombos);

  const vm = useMemo(
    () => (bracketEstimation ? buildBracketViewModel(bracketEstimation, detectedCombos) : null),
    [bracketEstimation, detectedCombos],
  );
  const aim = bracketBasis && bracketBasis.source !== 'estimated' ? bracketBasis.bracket : null;
  // "Bracket 2 Mycotyrant decks", not "Bracket 2 The Mycotyrant decks" — same trim as the Overview.
  const commanderShort = commanderName.split(',')[0].trim().replace(/^the\s+/i, '');
  const gap = useMemo(
    () => (vm && aim && bracketEstimation
      ? buildBracketGap(vm, aim, bracketBlend ?? null, deckNames, overBracketGroups(bracketEstimation, detectedCombos, aim))
      : null),
    [vm, aim, bracketBlend, deckNames, bracketEstimation, detectedCombos],
  );

  // Suggestions point up a bracket, so they stay away when there's no bracket above, or when the deck
  // already plays above where the player is aiming: that deck needs the way down, which the aim
  // section gives.
  const climbing = vm != null && vm.bumpTarget !== null && !(aim != null && aim < vm.bracket);
  const climb = useMemo(
    () => (climbing ? climbSuggestions(edhrecPage ?? null, deckNames, deckCards ?? [], commanderShort) : null),
    [climbing, edhrecPage, deckNames, deckCards, commanderShort],
  );

  if (!vm) {
    // Carries its own inset — the tab runs this one flush (see DeckOptimizer's
    // tab-content padding), and an empty-state card wants a margin around it.
    return (
      <div className="m-3 sm:m-4 bg-card/60 border border-border/30 rounded-lg p-6 text-center">
        <Gauge className="w-6 h-6 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">Generate a deck to see bracket analysis</p>
      </div>
    );
  }

  return (
    <RefinedVerdictView
      vm={vm}
      onPreview={onPreview}
      aim={aim}
      aimIsSet={bracketBasis?.source === 'set'}
      aimRefreshing={aimRefreshing}
      onAimChange={onAimChange}
      climb={climb}
      breakdown={bracketEstimation?.breakdown}
      aimSection={onAimChange && (
        <BracketAimSection
          vm={vm}
          basis={bracketBasis ?? null}
          gap={gap}
          commanderName={commanderShort}
          onPreview={onPreview}
          onOpenSwaps={onOpenOverBracketSwaps}
        />
      )}
    />
  );
}
