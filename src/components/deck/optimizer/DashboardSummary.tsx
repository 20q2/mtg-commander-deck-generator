// src/components/deck/optimizer/DashboardSummary.tsx
import { HeroScore } from './dashboard/HeroScore';
import { ThemePrompt } from './dashboard/ThemePrompt';
import { LaunchPad } from './dashboard/launchpad/LaunchPad';
import type { LaunchPadWiring } from './dashboard/launchpad/types';
import type { RingWiring } from './dashboard/launchpad/ScoreRing';
import type { ScryfallCard } from '@/types';
import type { DeckAnalysis, OptimizeSwaps } from '@/services/deckBuilder/deckAnalyzer';
import type { BracketEstimation } from '@/services/deckBuilder/bracketEstimator';
import type { ThemeMembership } from '@/components/analyze/themeMembership';
import type { ThemeMatchResult } from '@/services/deckBuilder/themeDetector';
import type { TabKey } from './constants';
import type { ReactNode } from 'react';

export interface DashboardSummaryProps {
  commander: ScryfallCard;
  partnerCommander?: ScryfallCard;
  colorIdentity?: string[];
  sourceLabel: string;
  analysis: DeckAnalysis;
  cards: ScryfallCard[];
  themeMembership: ThemeMembership | null;
  planName?: string | null;
  sampleSize?: number | null;
  /** Bracket estimate from the store — drives the headline and the power-level job. */
  bracketEstimation?: BracketEstimation;
  adjustContent?: ReactNode;
  onNavigate: (tab: TabKey, opts?: { cardName: string; side: 'add' | 'remove'; pairs?: { out: string; in: string }[] }) => void;
  onOpenInDeckView?: () => void;
  deckTarget?: number;
  /** Card Fit's cut and add columns — the launch pad pairs swaps from exactly these. */
  baseSwaps?: OptimizeSwaps | null;
  /** True when the deck has no theme declared — surfaces the theme prompt above everything else. */
  needsTheme?: boolean;
  /** Best candidate the detector found while falling short of declaring it. */
  closestTheme?: ThemeMatchResult | null;
  /** Apply one theme as the primary, from the prompt's one-click path. */
  onApplyTheme?: (slug: string) => void;
  /** What the launch pad needs from DeckOptimizer beyond the above. */
  launchPad: LaunchPadWiring;
}

/**
 * The Inspector's Overview: the score ring, then one question — what are we doing today? — whose
 * answers open the right tool. The tabs hold the depth; this page is the launch pad.
 */
export function DashboardSummary(props: DashboardSummaryProps) {
  const {
    commander, partnerCommander, colorIdentity, sourceLabel,
    analysis, cards, themeMembership, planName,
    sampleSize, bracketEstimation, adjustContent, onNavigate,
    onOpenInDeckView, deckTarget, baseSwaps,
    needsTheme, closestTheme, onApplyTheme, launchPad,
  } = props;

  if (!analysis.planScore) {
    return (
      <div className="text-sm text-muted-foreground p-6">Plan score not yet computed.</div>
    );
  }
  const planScore = analysis.planScore;
  const deckExcess = deckTarget != null ? cards.length - deckTarget : 0;

  // The hero renders inside the launch pad: its ring draws the path to 100, which follows the open job.
  const header = (ring: RingWiring, path: ReactNode) => (
    <>
      <HeroScore
        ring={ring}
        path={path}
        planScore={planScore}
        commander={commander}
        partnerCommander={partnerCommander}
        colorIdentity={colorIdentity}
        sourceLabel={sourceLabel}
        planName={planName}
        secondaryPlanName={themeMembership?.themes?.[1]?.name ?? null}
        bracketEstimation={bracketEstimation}
        sampleSize={sampleSize}
        onNavigateToBracket={() => onNavigate('bracket')}
        adjustContent={adjustContent}
        onOpenInDeckView={onOpenInDeckView}
      />
      {/* A deck with no declared theme can't score Strategy at all; the one-click fix comes first. */}
      {needsTheme && onApplyTheme && (
        <ThemePrompt closest={closestTheme} onApply={onApplyTheme} adjustContent={adjustContent} />
      )}
    </>
  );

  return (
    // No h-full: in a fixed-height column the hero (overflow-hidden) would shrink to fit and clip its ring.
    <div className="flex flex-col gap-5 sm:gap-4">
      <LaunchPad
        {...launchPad}
        renderHeader={header}
        planScore={planScore}
        analysis={analysis}
        cards={cards}
        commander={commander}
        partnerCommander={partnerCommander}
        colorIdentity={launchPad.colorIdentity ?? colorIdentity}
        baseSwaps={baseSwaps ?? null}
        deckExcess={deckExcess}
        deckTarget={deckTarget}
        bracketEstimation={bracketEstimation}
        sampleSize={sampleSize}
        reasonCtx={{
          // "The Mycotyrant" would read "most The Mycotyrant decks"; the article goes.
          commanderShort: commander.name.split(',')[0].trim().replace(/^the\s+/i, ''),
          roleBreakdowns: analysis.roleBreakdowns,
          curvePhases: analysis.curvePhases,
          targetsBracket: analysis.targetsBracket,
          judgedBracket: analysis.bracket,
        }}
        onNavigate={onNavigate}
      />
    </div>
  );
}
