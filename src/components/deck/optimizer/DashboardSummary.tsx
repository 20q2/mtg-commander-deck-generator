// src/components/deck/optimizer/DashboardSummary.tsx
import { useState } from 'react';
import { HeroScore } from './dashboard/HeroScore';
import { SubScoreTile } from './dashboard/SubScoreTile';
import { StrategyDrillIn } from './dashboard/StrategyDrillIn';
import { NextBestMove } from './dashboard/NextBestMove';
import type {
  ScryfallCard, EDHRECCommanderData, DashboardWarning, SubScoreKey, DetectedCombo,
} from '@/types';
import type { DeckAnalysis, RoleBreakdown, CurvePhaseAnalysis } from '@/services/deckBuilder/deckAnalyzer';
import type { ThemeMembership } from '@/components/analyze/themeMembership';
import type { TabKey } from './constants';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Target, Shield, BarChart3, Wand2 } from 'lucide-react';
import { isAnyLand } from '@/services/scryfall/client';

export interface DashboardSummaryProps {
  commander: ScryfallCard;
  partnerCommander?: ScryfallCard;
  colorIdentity?: string[];
  sourceLabel: string;
  analysis: DeckAnalysis;
  cards: ScryfallCard[];
  themeMembership: ThemeMembership | null;
  primaryThemeData?: EDHRECCommanderData | null;
  planName?: string | null;
  sampleSize?: number | null;
  warnings: DashboardWarning[];
  adjustContent?: ReactNode;
  onNavigate: (tab: TabKey) => void;
  onSaveAsDeck?: () => void;
  onOpenInDeckView?: () => void;
  // Panel props
  cardSynergyMap?: Record<string, number>;
  detectedCombos?: DetectedCombo[];
  deckTarget?: number;
  roleBreakdowns?: RoleBreakdown[];
  curvePhases?: CurvePhaseAnalysis[];
}

const SUBSCORE_META: Record<SubScoreKey, {
  label: string;
  navigateTo: TabKey | null; // null = inline expand (Strategy)
  Icon: LucideIcon;
}> = {
  strategy: { label: 'Strategy', navigateTo: null, Icon: Target },
  roles: { label: 'Roles', navigateTo: 'roles', Icon: Shield },
  tempo: { label: 'Tempo', navigateTo: 'curve', Icon: BarChart3 },
  cardFit: { label: 'Card Fit', navigateTo: 'optimize', Icon: Wand2 },
};

export function DashboardSummary(props: DashboardSummaryProps) {
  const {
    commander, partnerCommander, colorIdentity, sourceLabel,
    analysis, cards, themeMembership, primaryThemeData, planName,
    sampleSize, adjustContent, onNavigate,
    onSaveAsDeck, onOpenInDeckView,
    cardSynergyMap,
    detectedCombos, deckTarget,
    roleBreakdowns, curvePhases,
  } = props;
  const [strategyOpen, setStrategyOpen] = useState(false);

  if (!analysis.planScore) {
    return (
      <div className="text-sm text-muted-foreground p-6">Plan score not yet computed.</div>
    );
  }
  const planScore = analysis.planScore;
  const misfits = analysis.misfits ?? [];
  const gapAnalysis = analysis.gapAnalysis ?? [];

  // ── Hint computations ────────────────────────────────────────────────
  const nonLandCards = cards.filter(c => !isAnyLand(c));

  // Strategy hint: top theme card by synergy
  const themeKey = (c: ScryfallCard) => c.name.toLowerCase();
  const inTheme = themeMembership
    ? nonLandCards.filter(c => themeMembership.byCard.has(themeKey(c)))
    : [];
  const topSynergy = inTheme
    .map(c => ({ name: c.name, syn: cardSynergyMap?.[c.name] ?? 0 }))
    .filter(x => x.syn > 0)
    .sort((a, b) => b.syn - a.syn)[0];
  const strategyHint = topSynergy ? `Top theme play: ${topSynergy.name}` : undefined;

  // Roles hint: weakest role by current/target ratio
  const weakestRoleEntry = (roleBreakdowns ?? []).reduce<{ rb: RoleBreakdown; r: number } | null>(
    (worst, rb) => {
      const r = rb.current / Math.max(1, rb.target);
      return !worst || r < worst.r ? { rb, r } : worst;
    },
    null
  );
  const rolesHint =
    weakestRoleEntry && weakestRoleEntry.r < 1
      ? `Weakest: ${weakestRoleEntry.rb.label} (${weakestRoleEntry.rb.current}/${weakestRoleEntry.rb.target})`
      : undefined;

  // Tempo hint: lightest curve phase by current/target ratio
  const weakestPhaseEntry = (curvePhases ?? []).reduce<{ p: CurvePhaseAnalysis; r: number } | null>(
    (worst, p) => {
      const r = p.current / Math.max(1, p.target);
      return !worst || r < worst.r ? { p, r } : worst;
    },
    null
  );
  const tempoHint =
    weakestPhaseEntry && weakestPhaseEntry.r < 1
      ? `Lightest: ${weakestPhaseEntry.p.phase} game (${weakestPhaseEntry.p.current} vs ${weakestPhaseEntry.p.target})`
      : undefined;

  // Card Fit hint: worst misfit or top gap
  const cardFitHint = misfits[0]
    ? `Worst fit: ${misfits[0].card.name}`
    : gapAnalysis[0]
    ? `Top miss: ${gapAnalysis[0].name}`
    : undefined;

  const hints: Record<SubScoreKey, string | undefined> = {
    strategy: strategyHint,
    roles: rolesHint,
    tempo: tempoHint,
    cardFit: cardFitHint,
  };

  const deckExcess = deckTarget != null ? cards.length - deckTarget : 0;

  return (
    <div className="flex flex-col gap-5 sm:gap-4 h-full">
      <HeroScore
        planScore={planScore}
        commander={commander}
        partnerCommander={partnerCommander}
        colorIdentity={colorIdentity}
        sourceLabel={sourceLabel}
        planName={planName}
        secondaryPlanName={themeMembership?.themes?.[1]?.name ?? null}
        adjustContent={adjustContent}
        onSaveAsDeck={onSaveAsDeck}
        onOpenInDeckView={onOpenInDeckView}
      />
      <NextBestMove
        planScore={planScore}
        misfits={misfits}
        gapAnalysis={gapAnalysis}
        roleBreakdowns={roleBreakdowns}
        curvePhases={curvePhases}
        detectedCombos={detectedCombos}
        deckExcess={deckExcess}
        commander={commander}
        onNavigate={onNavigate}
        manaVerdict={analysis.manaBase?.verdict}
        currentLands={analysis.manaBase?.currentLands}
        suggestedLands={analysis.manaBase?.adjustedSuggestion}
        limitedData={planScore.limitedData}
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 items-stretch">
        {(Object.keys(SUBSCORE_META) as SubScoreKey[]).map((key, i) => {
          const meta = SUBSCORE_META[key];
          return (
            <div key={key} className="cascade-in flex" style={{ '--cascade-i': i } as React.CSSProperties}>
              <SubScoreTile
                label={meta.label}
                subscore={planScore.subscores[key]}
                Icon={meta.Icon}
                hint={hints[key]}
                onClick={() => {
                  if (meta.navigateTo) onNavigate(meta.navigateTo);
                  else setStrategyOpen(v => !v);
                }}
              />
            </div>
          );
        })}
      </div>
      {strategyOpen && (
        <StrategyDrillIn
          cards={cards}
          themeMembership={themeMembership}
          primaryThemeData={primaryThemeData}
          planName={planName}
          sampleSize={sampleSize}
        />
      )}
    </div>
  );
}
