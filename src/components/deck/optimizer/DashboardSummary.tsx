// src/components/deck/optimizer/DashboardSummary.tsx
import { useState } from 'react';
import { HeroScore } from './dashboard/HeroScore';
import { SubScoreTile } from './dashboard/SubScoreTile';
import { ConditionalWarnings } from './dashboard/ConditionalWarnings';
import { StrategyDrillIn } from './dashboard/StrategyDrillIn';
import { StandoutCards } from './dashboard/StandoutCards';
import { DeckShape } from './dashboard/DeckShape';
import { CombosPanel } from './dashboard/CombosPanel';
import type {
  ScryfallCard, EDHRECCommanderData, DashboardWarning, SubScoreKey, DetectedCombo,
} from '@/types';
import type { DeckAnalysis } from '@/services/deckBuilder/deckAnalyzer';
import type { ThemeMembership } from '@/components/analyze/themeMembership';
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
  primaryThemeData?: EDHRECCommanderData | null;
  planName?: string | null;
  sampleSize?: number | null;
  warnings: DashboardWarning[];
  adjustContent?: ReactNode;
  onNavigate: (tab: TabKey) => void;
  onSaveAsDeck?: () => void;
  onOpenInDeckView?: () => void;
  // New panel props
  cardSynergyMap?: Record<string, number>;
  roleCounts?: Record<string, number>;
  roleTargets?: Record<string, number>;
  edhrecAvgCmc?: number | null;
  detectedCombos?: DetectedCombo[];
  deckTarget?: number;
  onPreview?: (cardName: string) => void;
}

const SUBSCORE_META: Record<SubScoreKey, {
  label: string;
  navigateTo: TabKey | null; // null = inline expand (Strategy)
  explainer: { sources: string; method: string };
}> = {
  strategy: {
    label: 'Strategy',
    navigateTo: null,
    explainer: {
      sources: 'EDHREC theme bucket + active theme membership',
      method: 'Weighted composite of theme density (60%) and top-60 overlap (40%)',
    },
  },
  roles: {
    label: 'Roles',
    navigateTo: 'roles',
    explainer: {
      sources: 'Oracle tags + EDHREC commander averages',
      method: 'Per-role current vs target, weighted by criticality',
    },
  },
  tempo: {
    label: 'Tempo',
    navigateTo: 'curve',
    explainer: {
      sources: 'Deck CMC distribution vs EDHREC commander curve',
      method: 'Phase-level deviation; early-game weighted heavier',
    },
  },
  cardFit: {
    label: 'Card Fit',
    navigateTo: 'cardFit',
    explainer: {
      sources: 'EDHREC inclusion + synergy + oracle tags + theme bucket',
      method: 'Penalty for low-fit cards in deck and high-value cards missing',
    },
  },
};

export function DashboardSummary(props: DashboardSummaryProps) {
  const {
    commander, partnerCommander, colorIdentity, sourceLabel,
    analysis, cards, themeMembership, primaryThemeData, planName,
    sampleSize, warnings, adjustContent, onNavigate,
    onSaveAsDeck, onOpenInDeckView,
    cardSynergyMap, roleCounts, roleTargets, edhrecAvgCmc,
    detectedCombos, deckTarget, onPreview,
  } = props;
  const [strategyOpen, setStrategyOpen] = useState(false);

  if (!analysis.planScore) {
    return (
      <div className="text-sm text-muted-foreground p-6">Plan score not yet computed.</div>
    );
  }
  const planScore = analysis.planScore;

  return (
    <div className="space-y-4">
      <HeroScore
        planScore={planScore}
        commander={commander}
        partnerCommander={partnerCommander}
        colorIdentity={colorIdentity}
        sourceLabel={sourceLabel}
        planName={planName}
        adjustContent={adjustContent}
        onSaveAsDeck={onSaveAsDeck}
        onOpenInDeckView={onOpenInDeckView}
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {(Object.keys(SUBSCORE_META) as SubScoreKey[]).map(key => {
          const meta = SUBSCORE_META[key];
          return (
            <SubScoreTile
              key={key}
              label={meta.label}
              subscore={planScore.subscores[key]}
              explainer={meta.explainer}
              onClick={() => {
                if (meta.navigateTo) onNavigate(meta.navigateTo);
                else setStrategyOpen(v => !v);
              }}
            />
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
      <ConditionalWarnings warnings={warnings} onNavigate={onNavigate} />
      {onPreview && (
        <StandoutCards
          cards={cards}
          cardSynergyMap={cardSynergyMap}
          commanderName={commander.name}
          sampleSize={sampleSize}
          onPreview={onPreview}
        />
      )}
      {roleCounts && roleTargets && deckTarget != null && (
        <DeckShape
          cards={cards}
          deckTarget={deckTarget}
          roleCounts={roleCounts}
          roleTargets={roleTargets}
          edhrecAvgCmc={edhrecAvgCmc}
          commanderName={commander.name}
          sampleSize={sampleSize}
        />
      )}
      {detectedCombos && detectedCombos.length > 0 && (
        <CombosPanel detectedCombos={detectedCombos} />
      )}
    </div>
  );
}
