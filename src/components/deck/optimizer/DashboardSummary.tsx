// src/components/deck/optimizer/DashboardSummary.tsx
import { useState } from 'react';
import { HeroScore } from './dashboard/HeroScore';
import { SubScoreTile } from './dashboard/SubScoreTile';
import { StrategyDrillIn } from './dashboard/StrategyDrillIn';
import { NextBestMove } from './dashboard/NextBestMove';
import type {
  ScryfallCard, EDHRECCommanderData, DashboardWarning, SubScoreKey, DetectedCombo,
} from '@/types';
import type { DeckAnalysis, RoleBreakdown, CurvePhaseAnalysis, OptimizeSwaps } from '@/services/deckBuilder/deckAnalyzer';
import type { ThemeMembership } from '@/components/analyze/themeMembership';
import type { TabKey } from './constants';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Target, Shield, BarChart3, Wand2 } from 'lucide-react';
import { isAnyLand } from '@/services/scryfall/client';
import { Radar, type RadarDatum } from '@/components/charts/Radar';
import { MiniCurve } from '@/components/charts/MiniCurve';
import { ROLE_AXES } from '@/components/brew/brewVisuals';

/** One Strategy-radar spoke: a theme, its 0-100 match score (the detector's
 *  composite — what drives the radar shape), and how many deck cards belong to it. */
export interface ThemeCoverage { slug: string; name: string; score: number; current: number; }

// Role → hue + glyph, reused from the brew radar so a role's spoke colour matches
// its badge everywhere (ramp green, removal red, wipes ember, draw azure).
const ROLE_AXIS_META = Object.fromEntries(ROLE_AXES.map(a => [a.key, { hue: a.hue, Icon: a.Icon }]));

// Roles scaled against each role's OWN target: a role that exactly meets target sits on the
// dashed reference ring (2/3 radius), over-built roles spike past it, deficits dip inside.
// This shows the deck's lean without letting naturally-small roles (e.g. board wipes, target
// ~3) collapse to the center the way "relative to the biggest role" did.
const ROLE_TARGET_RADIUS = 2 / 3; // where "target met" sits, leaving headroom to spike past it
function roleRadarData(rbs: RoleBreakdown[]): RadarDatum[] {
  return rbs.map(rb => {
    const meta = ROLE_AXIS_META[rb.role];
    const Icon = meta?.Icon;
    const ratio = rb.target > 0 ? rb.current / rb.target : (rb.current > 0 ? 1.5 : 0);
    return {
      key: rb.role, label: rb.label, current: rb.current, target: rb.target,
      fill: Math.max(0, Math.min(1, ratio * ROLE_TARGET_RADIUS)),
      ref: ROLE_TARGET_RADIUS,
      hue: meta?.hue ?? '262 84% 72%',
      glyph: Icon ? <Icon className="w-[13px] h-[13px]" strokeWidth={2} /> : null,
    };
  });
}

// Strategy spokes: theme names live in the hover `tip` (no visible label — 8 theme
// names would crowd the small chart). Fill is the detector's 0-100 match score on an
// absolute scale, so the deck's real themes spike and weak/off themes stay short —
// raw card-overlap was flat because theme lists overlap heavily (every spoke maxed).
function themeRadarData(coverage: ThemeCoverage[]): RadarDatum[] {
  return coverage.map(c => ({
    key: c.slug,
    // Short label under each spoke; full name + score on hover.
    label: c.name.length > 11 ? `${c.name.slice(0, 10)}…` : c.name,
    current: Math.round(c.score), target: 100,
    fill: Math.max(0, Math.min(1, c.score / 100)),
    hue: '262 84% 72%',
    glyph: null,
    tip: `${c.name} — ${Math.round(c.score)}/100 match · ${c.current} card${c.current === 1 ? '' : 's'}`,
  }));
}

// Collapse CMC 7+ into a single bar so the tile curve stays glanceable.
function bucketCurve(breakdowns: { cmc: number; current: number; target: number }[]) {
  const out: { cmc: number; current: number; target: number }[] = [];
  const plus = { cmc: 7, current: 0, target: 0 };
  for (const b of breakdowns) {
    if (b.cmc >= 7) { plus.current += b.current; plus.target += b.target; }
    else out.push({ cmc: b.cmc, current: b.current, target: b.target });
  }
  if (plus.current > 0 || plus.target > 0) out.push(plus);
  return out;
}

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
  onNavigate: (tab: TabKey, opts?: { cardName: string; side: 'add' | 'remove' }) => void;
  onSaveAsDeck?: () => void;
  onOpenInDeckView?: () => void;
  // Panel props
  cardSynergyMap?: Record<string, number>;
  detectedCombos?: DetectedCombo[];
  deckTarget?: number;
  roleBreakdowns?: RoleBreakdown[];
  curvePhases?: CurvePhaseAnalysis[];
  themeCoverage?: ThemeCoverage[];
  /** Shared swap list (also drives the optimize tab — same source as NextBestMove). */
  baseSwaps?: OptimizeSwaps | null;
  /** Cost + Lift bento shown in the next-steps slot when no real next steps remain. */
  bentoSlot?: ReactNode;
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
    roleBreakdowns, curvePhases, themeCoverage,
    baseSwaps, bentoSlot,
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

  // ── Tile visuals ──────────────────────────────────────────────────────
  const roleVisual = (roleBreakdowns && roleBreakdowns.length >= 3)
    ? <Radar data={roleRadarData(roleBreakdowns)} accent="262 84% 72%" glow={false} gradientId="ovwRole" scale={0.8} />
    : undefined;
  const themeVisual = (themeCoverage && themeCoverage.length >= 3)
    ? <Radar data={themeRadarData(themeCoverage.slice(0, 6))} accent="262 84% 72%" glow={false} gradientId="ovwTheme" scale={0.8} />
    : undefined;
  const curveData = analysis.curveBreakdowns ? bucketCurve(analysis.curveBreakdowns) : [];
  const tempoVisual = curveData.length > 0
    ? <MiniCurve curve={curveData} barHeight={64} variant="line" />
    : undefined;
  const visuals: Record<SubScoreKey, React.ReactNode> = {
    strategy: themeVisual,
    roles: roleVisual,
    tempo: tempoVisual,
    cardFit: undefined,
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
        baseSwaps={baseSwaps ?? null}
        fallback={bentoSlot}
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
                visual={visuals[key]}
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
