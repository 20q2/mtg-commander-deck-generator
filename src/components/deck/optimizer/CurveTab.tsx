import { useState, useMemo, useCallback } from 'react';
import {
  ComposedChart, AreaChart as RechartsAreaChart,
  Line, Area, Bar,
  XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ReferenceArea,
  ResponsiveContainer,
} from 'recharts';
import { ChevronDown, ChevronRight, X, Zap, Target, Crown, Sparkles, Sprout, Lightbulb, AlertTriangle, Swords, Mountain, Check, Dices, Shuffle, Layers } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import type { CurvePhaseAnalysis, CurvePhase, CurveSlot, CurveBreakdown, ManaTrajectoryPoint, AnalyzedCard, RecommendedCard, ManaSourcesAnalysis } from '@/services/deckBuilder/deckAnalyzer';
import { PACING_MULTIPLIERS, computeLandDropProbabilities, computeHandStats } from '@/services/deckBuilder/deckAnalyzer';
import type { Pacing } from '@/services/deckBuilder/themeDetector';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { PACING_LABELS, PHASE_META, tileGradeStyles } from './constants';
import { AnalyzedCardRow, type CardAction, type CardRowMenuProps } from './shared';
import { SuggestionCardGrid } from './OverviewTab';
import { useStore } from '@/store';
import { ManaCost } from '@/components/ui/mtg-icons';
import { InfoTooltip } from '@/components/ui/info-tooltip';

// ═══════════════════════════════════════════════════════════════════════
// Curve Tab Components
// ═══════════════════════════════════════════════════════════════════════

export function CurveSummaryStrip({
  phases, activePhase, onPhaseClick,
}: {
  phases: CurvePhaseAnalysis[];
  activePhase: CurvePhase | null;
  onPhaseClick: (phase: CurvePhase) => void;
}) {
  return (
    <div className="-mx-3 sm:-mx-4 grid grid-cols-2 sm:grid-cols-3 border-t border-b border-border/30">
      {phases.map((phase, i) => {
        const meta = PHASE_META[phase.phase];
        const Icon = meta.icon;
        const isActive = activePhase === phase.phase;
        const gs = tileGradeStyles(phase.grade.letter);

        return (
          <button
            key={phase.phase}
            onClick={() => onPhaseClick(phase.phase)}
            className={`p-2.5 text-left transition-all hover:bg-card/80 ${
              i > 0 ? 'border-l border-l-border/30' : ''
            } ${i >= 2 ? '' : 'border-b border-b-border/30 sm:border-b-0'} ${
              isActive ? gs.bg : ''
            }`}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <Icon className={`w-4 h-4 ${isActive ? gs.color : 'text-muted-foreground'}`} />
              <span className={`text-xs font-semibold uppercase tracking-wider truncate ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                {phase.label}
              </span>
              <span className={`text-sm font-black ml-auto px-1.5 py-0.5 rounded ${gs.color} ${gs.bgColor}`}>
                {phase.grade.letter}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className={`text-xl font-bold tabular-nums leading-none ${gs.color}`}>
                {phase.current}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {phase.target} suggested
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ── Recharts custom renderers ── */

export function CurveTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const current = payload.find(p => p.dataKey === 'current')?.value ?? 0;
  const target = payload.find(p => p.dataKey === 'target')?.value ?? 0;
  const delta = current - target;
  return (
    <div className="bg-popover border border-border rounded-md px-2.5 py-1.5 shadow-lg text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
      <div className="font-semibold text-foreground mb-1">CMC {label}</div>
      <div className="text-sky-400">Your deck: {current}</div>
      <div className="text-amber-500/80">Expected: {target}</div>
      {delta !== 0 && (
        <div className={`mt-0.5 font-semibold ${delta > 0 ? 'text-amber-400' : 'text-red-400'}`}>
          {delta > 0 ? `+${delta} over` : `${delta} under`}
        </div>
      )}
    </div>
  );
}

export function DeltaBarShape(props: {
  x?: number; y?: number; width?: number; height?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
}) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  if (!payload || payload.delta === 0 || height === 0) return null;
  return (
    <rect
      x={x} y={y} width={width} height={height} rx={3}
      fill={payload.isOverTarget ? 'rgba(251,191,36,0.2)' : 'rgba(248,113,113,0.2)'}
    />
  );
}

export function TrajectoryTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.find(p => p.dataKey === 'totalExpectedMana')?.value ?? 0;
  const lands = payload.find(p => p.dataKey === 'expectedLands')?.value ?? 0;
  const ramp = total - lands;
  return (
    <div className="bg-popover border border-border rounded-md px-2.5 py-1.5 shadow-lg text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
      <div className="font-semibold text-foreground mb-1">{label}</div>
      <div className="text-sky-400">Total mana: {total.toFixed(1)}</div>
      <div className="text-emerald-400/70">From lands: {lands.toFixed(1)}</div>
      {ramp > 0 && <div className="text-sky-400/60">From ramp: +{ramp.toFixed(1)}</div>}
    </div>
  );
}

// Phase → CMC label ranges for ReferenceArea highlighting
const PHASE_CMC_RANGE: Record<CurvePhase, [string, string]> = {
  early: ['0', '2'],
  mid:   ['3', '4'],
  late:  ['5', '7+'],
};

const PHASE_HIGHLIGHT: Record<CurvePhase, string> = {
  early: 'rgba(56,189,248,0.08)',
  mid:   'rgba(245,158,11,0.08)',
  late:  'rgba(168,85,247,0.08)',
};

export function ManaCurveLineChart({
  curveAnalysis, pacing, activePhase, selectedCmc, onCmcClick,
}: {
  curveAnalysis: CurveSlot[];
  pacing?: Pacing;
  activePhase?: CurvePhase | null;
  selectedCmc?: number | null;
  onCmcClick?: (cmc: number) => void;
}) {
  if (curveAnalysis.length === 0) return null;

  const multipliers = pacing ? PACING_MULTIPLIERS[pacing] : PACING_MULTIPLIERS.balanced;

  // Build per-CMC adjusted targets
  const slots = curveAnalysis.map(s => {
    const phase = s.cmc <= 2 ? 'early' : s.cmc <= 4 ? 'mid' : 'late';
    const adjustedTarget = Math.round(s.target * multipliers[phase]);
    return { cmc: s.cmc, current: s.current, target: adjustedTarget };
  });

  // Normalize adjusted targets to sum to same total as raw targets
  const rawTotal = curveAnalysis.reduce((sum, s) => sum + s.target, 0);
  const adjTotal = slots.reduce((sum, s) => sum + s.target, 0);
  if (adjTotal > 0 && adjTotal !== rawTotal) {
    const scale = rawTotal / adjTotal;
    for (const s of slots) s.target = Math.round(s.target * scale);
    const drift = rawTotal - slots.reduce((sum, s) => sum + s.target, 0);
    if (drift !== 0) {
      const largest = slots.reduce((m, s) => s.target > m.target ? s : m, slots[0]);
      largest.target += drift;
    }
  }

  // Determine which CMCs belong to the active phase
  const isInPhase = (cmc: number) => {
    if (!activePhase) return true;
    if (activePhase === 'early') return cmc <= 2;
    if (activePhase === 'mid') return cmc >= 3 && cmc <= 4;
    return cmc >= 5;
  };

  const chartData = slots.map(s => ({
    cmcLabel: s.cmc === 7 ? '7+' : String(s.cmc),
    cmc: s.cmc,
    current: s.current,
    target: s.target,
    delta: s.current - s.target,
    deltaBase: Math.min(s.current, s.target),
    deltaHeight: Math.abs(s.current - s.target),
    isOverTarget: s.current > s.target,
    inPhase: isInPhase(s.cmc),
  }));

  const phaseRange = activePhase ? PHASE_CMC_RANGE[activePhase] : null;

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg p-3">
      <div className="flex flex-col gap-0.5 mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mana Curve</span>
          <span className="text-[10px] text-muted-foreground/80 ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0 inline-block border-t-2 border-dashed border-amber-500/60" />
              expected
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 rounded bg-sky-500 inline-block" />
              your deck
            </span>
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/80 leading-snug">
          Card count at each mana cost vs. the expected distribution for your commander{pacing && pacing !== 'balanced' ? ` (${PACING_LABELS[pacing]} tempo)` : ''}{onCmcClick ? ' · Click a mana value to see cards' : ''}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <ComposedChart
          data={chartData}
          margin={{ top: 6, right: 8, bottom: 0, left: -12 }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onClick={onCmcClick ? (e: any) => {
            const idx = e?.activeTooltipIndex;
            if (idx != null && chartData[idx]) onCmcClick(chartData[idx].cmc);
          } : undefined}
          style={onCmcClick ? { cursor: 'pointer' } : undefined}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,13%,20%)" strokeOpacity={0.3} vertical={false} />
          <XAxis
            dataKey="cmcLabel"
            tick={{ fontSize: 10, fill: 'hsl(220,13%,55%)', fillOpacity: 0.6 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 9, fill: 'hsl(220,13%,55%)', fillOpacity: 0.4 }}
            axisLine={false}
            tickLine={false}
            width={28}
            allowDecimals={false}
          />
          <Tooltip content={<CurveTooltip />} cursor={false} />

          {/* Phase highlight band */}
          {activePhase && phaseRange && (
            <ReferenceArea
              x1={phaseRange[0]}
              x2={phaseRange[1]}
              fill={PHASE_HIGHLIGHT[activePhase]}
              fillOpacity={1}
              strokeOpacity={0}
            />
          )}

          {/* Delta bars (stacked: invisible base + visible delta) */}
          <Bar dataKey="deltaBase" stackId="delta" fill="transparent" isAnimationActive={false} barSize={16} />
          <Bar dataKey="deltaHeight" stackId="delta" shape={<DeltaBarShape />} isAnimationActive animationDuration={400} barSize={16} />

          {/* Area fill under actual */}
          <Area type="monotone" dataKey="current" stroke="none" fill="#0ea5e9" fillOpacity={activePhase ? 0.04 : 0.08} isAnimationActive animationDuration={500} />

          {/* Target line (dashed amber) — dim dots outside active phase */}
          <Line
            type="monotone"
            dataKey="target"
            stroke={activePhase ? 'rgba(245,158,11,0.3)' : 'rgba(245,158,11,0.6)'}
            strokeWidth={1.5}
            strokeDasharray="6 4"
            dot={(props: { cx?: number; cy?: number; index?: number }) => {
              const { cx = 0, cy = 0, index = 0 } = props;
              const d = chartData[index];
              const active = d?.inPhase ?? true;
              return <circle key={`t-${index}`} cx={cx} cy={cy} r={2.5} fill={`rgba(245,158,11,${active ? 0.6 : 0.15})`} />;
            }}
            isAnimationActive
            animationDuration={500}
          />

          {/* Actual curve (solid sky) — enlarge + brighten dots in active phase */}
          <Line
            type="monotone"
            dataKey="current"
            stroke={activePhase ? 'rgba(14,165,233,0.4)' : '#0ea5e9'}
            strokeWidth={2.5}
            dot={(props: { cx?: number; cy?: number; index?: number }) => {
              const { cx = 0, cy = 0, index = 0 } = props;
              const d = chartData[index];
              const active = d?.inPhase ?? true;
              const isSelected = selectedCmc != null && d?.cmc === selectedCmc;
              if (isSelected) {
                return (
                  <g key={`c-${index}`}>
                    <circle cx={cx} cy={cy} r={8} fill="rgba(56,189,248,0.15)" />
                    <circle cx={cx} cy={cy} r={5} fill="#38bdf8" stroke="#0ea5e9" strokeWidth={2} />
                  </g>
                );
              }
              return <circle key={`c-${index}`} cx={cx} cy={cy} r={active ? 4 : 3} fill={active ? '#38bdf8' : 'rgba(56,189,248,0.2)'} />;
            }}
            activeDot={{ r: 5, fill: '#38bdf8', stroke: '#0ea5e9', strokeWidth: 2 }}
            isAnimationActive
            animationDuration={500}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CmcCardList({
  curveBreakdowns, selectedCmc, onPreview, onClose, onCardAction, menuProps,
}: {
  curveBreakdowns: CurveBreakdown[];
  selectedCmc: number;
  onPreview: (name: string) => void;
  onClose: () => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
}) {
  const bucket = curveBreakdowns.find(b => b.cmc === selectedCmc);
  if (!bucket || bucket.cards.length === 0) {
    return (
      <div className="bg-card/60 border border-border/30 rounded-lg p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            CMC {selectedCmc === 7 ? '7+' : selectedCmc} — No cards
          </span>
          <button onClick={onClose} className="text-muted-foreground/80 hover:text-muted-foreground transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground/80 italic">No non-land cards at this mana value.</p>
      </div>
    );
  }

  // Group by type
  const typeGroups = new Map<string, AnalyzedCard[]>();
  for (const ac of bucket.cards) {
    const tl = getFrontFaceTypeLine(ac.card).toLowerCase();
    let type = 'other';
    if (tl.includes('creature')) type = 'Creature';
    else if (tl.includes('instant')) type = 'Instant';
    else if (tl.includes('sorcery')) type = 'Sorcery';
    else if (tl.includes('artifact')) type = 'Artifact';
    else if (tl.includes('enchantment')) type = 'Enchantment';
    else if (tl.includes('planeswalker')) type = 'Planeswalker';
    else if (tl.includes('battle')) type = 'Battle';
    const arr = typeGroups.get(type) || [];
    arr.push(ac);
    typeGroups.set(type, arr);
  }
  const sortedGroups = [...typeGroups.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <div className="bg-card/60 border border-sky-500/20 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          CMC {selectedCmc === 7 ? '7+' : selectedCmc} — {bucket.cards.length} card{bucket.cards.length !== 1 ? 's' : ''}
        </span>
        <button onClick={onClose} className="text-muted-foreground/80 hover:text-muted-foreground transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-3 gap-y-0.5">
        {sortedGroups.map(([type, cards]) => (
          <div key={type}>
            <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-0.5 mt-1 first:mt-0">
              {type} ({cards.length})
            </p>
            {cards.map(ac => (
              <AnalyzedCardRow
                key={ac.card.name}
                ac={ac}
                onPreview={onPreview}
                showDetails
                onCardAction={onCardAction}
                menuProps={menuProps}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Curve Insights — actionable callouts about curve health
// ═══════════════════════════════════════════════════════════════════════

interface Insight {
  key: string;
  icon: typeof Lightbulb;
  color: string;
  text: string;
}

export function CurveInsights({
  curveAnalysis, curvePhases, manaSources, manaTrajectory,
  commanderCmc, partnerCmc, commanderName, partnerName,
  totalNonLand, drawCount,
}: {
  curveAnalysis: CurveSlot[];
  curvePhases: CurvePhaseAnalysis[];
  manaSources: ManaSourcesAnalysis;
  manaTrajectory: ManaTrajectoryPoint[];
  commanderCmc: number;
  partnerCmc?: number;
  commanderName: string;
  partnerName?: string;
  totalNonLand: number;
  drawCount: number;
}) {
  const insights = useMemo(() => {
    const result: Insight[] = [];

    // 1. Commander cast turn
    const castWith = findCastTurnExtended(manaTrajectory, commanderCmc, true);
    const castWithout = findCastTurnExtended(manaTrajectory, commanderCmc, false);
    const saved = castWithout - castWith;
    const fmt = (t: number) => t > 12 ? '12+' : String(t);
    let cmdrText = `${commanderName} online T${fmt(castWith)}`;
    if (saved > 0) cmdrText += ` (ramp saves ${saved} turn${saved > 1 ? 's' : ''})`;
    result.push({ key: 'cmdr', icon: Target, color: turnColor(castWith), text: cmdrText });

    if (partnerCmc != null && partnerName) {
      const pCast = findCastTurnExtended(manaTrajectory, partnerCmc, true);
      const pSaved = findCastTurnExtended(manaTrajectory, partnerCmc, false) - pCast;
      let pText = `${partnerName} online T${fmt(pCast)}`;
      if (pSaved > 0) pText += ` (ramp saves ${pSaved} turn${pSaved > 1 ? 's' : ''})`;
      result.push({ key: 'partner', icon: Target, color: turnColor(pCast), text: pText });
    }

    // 2. 3-CMC choke point
    const slot3 = curveAnalysis.find(s => s.cmc === 3);
    if (slot3 && totalNonLand > 0) {
      const pct3 = Math.round((slot3.current / totalNonLand) * 100);
      if (pct3 > 20) {
        result.push({ key: '3cmc', icon: AlertTriangle, color: 'text-red-400',
          text: `${slot3.current} cards at 3 CMC (${pct3}%) — heavy congestion, shift some to 2 or 4` });
      } else if (pct3 > 15) {
        result.push({ key: '3cmc', icon: AlertTriangle, color: 'text-amber-400',
          text: `${slot3.current} cards at 3 CMC (${pct3}%) — consider shifting some to 2 or 4` });
      }
    }

    // 3. Dead CMC slots (0, 1, 2)
    for (const cmc of [1, 2]) {
      const slot = curveAnalysis.find(s => s.cmc === cmc);
      if (slot && slot.current === 0) {
        result.push({ key: `dead${cmc}`, icon: AlertTriangle, color: 'text-red-400',
          text: `No ${cmc}-drops — you'll have nothing to do on turn ${cmc}` });
        break; // only show one dead-turn warning
      }
    }

    // 4. Ramp-to-draw ratio
    const totalRamp = manaSources.totalRamp;
    if (drawCount > 0 && totalRamp / drawCount > 2.5) {
      result.push({ key: 'ratio', icon: Sprout, color: 'text-amber-400',
        text: `${totalRamp} ramp / ${drawCount} draw — risk flooding with mana and no cards` });
    } else if (totalRamp < 7 && totalNonLand > 50) {
      result.push({ key: 'lowramp', icon: Sprout, color: 'text-red-400',
        text: `Only ${totalRamp} ramp — likely to fall behind on mana` });
    }

    // 5. Curve shape
    const latePhase = curvePhases.find(p => p.phase === 'late');
    const earlyPhase = curvePhases.find(p => p.phase === 'early');
    if (latePhase && totalNonLand > 0) {
      const latePct = Math.round((latePhase.current / totalNonLand) * 100);
      if (latePct > 40) {
        result.push({ key: 'shape', icon: Crown, color: 'text-amber-400',
          text: `Top-heavy — ${latePct}% of spells cost 5+, expect slow early turns` });
      }
    }
    if (earlyPhase && totalNonLand > 0) {
      const earlyPct = Math.round((earlyPhase.current / totalNonLand) * 100);
      if (earlyPct > 55) {
        result.push({ key: 'shape', icon: Zap, color: 'text-sky-400',
          text: `Very low curve — ${earlyPct}% at CMC 0-2, may run out of gas without draw` });
      }
    }

    return result;
  }, [curveAnalysis, curvePhases, manaSources, manaTrajectory, commanderCmc, partnerCmc, commanderName, partnerName, totalNonLand, drawCount]);

  if (insights.length === 0) return null;

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Lightbulb className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Curve Insights</span>
        <InfoTooltip text="Flags common curve problems: when your commander comes online, CMC congestion at 3, dead early turns, ramp-to-draw imbalance, and top-heavy builds." />
      </div>
      <div className="space-y-1">
        {insights.map(ins => {
          const Icon = ins.icon;
          return (
            <div key={ins.key} className="flex items-start gap-2">
              <Icon className={`w-3.5 h-3.5 ${ins.color} mt-0.5 flex-shrink-0`} />
              <span className={`text-xs ${ins.color} leading-snug`}>{ins.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Interaction Timing — CMC distribution of removal/boardwipes
// ═══════════════════════════════════════════════════════════════════════

export function InteractionTiming({
  currentCards,
}: {
  currentCards: ScryfallCard[];
}) {
  const { cheap, mid, expensive, total, cheapPct } = useMemo(() => {
    const cards = currentCards.filter(c => {
      const tl = getFrontFaceTypeLine(c).toLowerCase();
      if (tl.includes('land')) return false;
      return c.deckRole === 'removal' || c.deckRole === 'boardwipe';
    });
    const ch = cards.filter(c => c.cmc <= 2).length;
    const md = cards.filter(c => c.cmc >= 3 && c.cmc <= 4).length;
    const ex = cards.filter(c => c.cmc >= 5).length;
    const tot = cards.length;
    return { cheap: ch, mid: md, expensive: ex, total: tot, cheapPct: tot > 0 ? Math.round((ch / tot) * 100) : 0 };
  }, [currentCards]);

  const assessment = cheapPct >= 50
    ? { color: 'text-emerald-400/80', dot: 'bg-emerald-500', label: 'Most interaction is cheap enough to hold up' }
    : cheapPct >= 30
    ? { color: 'text-amber-400/80', dot: 'bg-amber-500', label: 'You can respond, but it\'s tight on mana' }
    : { color: 'text-red-400/80', dot: 'bg-red-500', label: 'Most interaction costs 3+ — hard to develop and respond' };

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Swords className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Interaction Timing</span>
        <InfoTooltip text="Cheap removal (CMC 0-2) lets you develop your board and hold up answers in the same turn. Expensive interaction forces you to choose one or the other." />
        <span className="ml-auto text-[10px] text-muted-foreground/80">{total} cards</span>
      </div>

      {total === 0 ? (
        <div className="flex items-center gap-1.5 mt-1">
          <AlertTriangle className="w-3 h-3 text-amber-400/70" />
          <span className="text-xs text-amber-400/80">No interaction cards — your deck can't respond to threats</span>
        </div>
      ) : (
        <>
          {/* Stacked bar */}
          <div className="flex h-2 rounded-full overflow-hidden mt-2">
            {cheap > 0 && <div className="bg-emerald-500/70" style={{ width: `${(cheap / total) * 100}%` }} />}
            {mid > 0 && <div className="bg-amber-500/70" style={{ width: `${(mid / total) * 100}%` }} />}
            {expensive > 0 && <div className="bg-red-500/60" style={{ width: `${(expensive / total) * 100}%` }} />}
          </div>

          {/* Tier counts */}
          <div className="flex justify-between text-[10px] text-muted-foreground/80 mt-1.5">
            <span><span className="text-emerald-400/70 font-semibold">{cheap}</span> CMC 0-2</span>
            <span><span className="text-amber-400/70 font-semibold">{mid}</span> CMC 3-4</span>
            <span><span className="text-red-400/70 font-semibold">{expensive}</span> CMC 5+</span>
          </div>

          {/* Assessment */}
          <div className="flex items-center gap-1.5 mt-2">
            <div className={`w-1.5 h-1.5 rounded-full ${assessment.dot}`} />
            <span className={`text-[11px] ${assessment.color}`}>{cheapPct}% cheap — {assessment.label}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Ramp Health — CMC tier breakdown + warnings
// ═══════════════════════════════════════════════════════════════════════

export function RampHealth({
  rampCards, manaSources, drawCount,
}: {
  rampCards: AnalyzedCard[];
  manaSources: ManaSourcesAnalysis;
  drawCount: number;
}) {
  const { tier01, tier2, tier3, tier4plus, total, warnings } = useMemo(() => {
    const t01 = rampCards.filter(c => c.card.cmc <= 1).length;
    const t2 = rampCards.filter(c => c.card.cmc === 2).length;
    const t3 = rampCards.filter(c => c.card.cmc === 3).length;
    const t4 = rampCards.filter(c => c.card.cmc >= 4).length;
    const tot = rampCards.length;

    const w: { icon: typeof AlertTriangle; color: string; text: string }[] = [];

    // Ramp-to-draw ratio
    if (drawCount > 0 && tot / drawCount > 2.5) {
      w.push({ icon: AlertTriangle, color: 'text-amber-400', text: `${tot} ramp / ${drawCount} draw — risk flooding with mana and no cards` });
    } else if (drawCount > 0 && tot / drawCount < 0.7) {
      w.push({ icon: AlertTriangle, color: 'text-amber-400', text: `${tot} ramp / ${drawCount} draw — heavy on draw, light on acceleration` });
    }

    // Late-game ramp
    if (t4 >= 3) {
      w.push({ icon: AlertTriangle, color: 'text-amber-400', text: `${t4} ramp at CMC 4+ — these are dead draws late game` });
    }

    // Low early ramp
    if (t01 + t2 < 3 && tot >= 7) {
      w.push({ icon: AlertTriangle, color: 'text-amber-400', text: `Only ${t01 + t2} ramp at CMC ≤2 — slow to accelerate` });
    }

    return { tier01: t01, tier2: t2, tier3: t3, tier4plus: t4, total: tot, warnings: w };
  }, [rampCards, drawCount]);

  const gs = tileGradeStyles(manaSources.grade);

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Sprout className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ramp Health</span>
        <InfoTooltip text="Ramp at CMC 1-2 accelerates you the most. CMC 4+ ramp is often too slow to matter. A healthy ratio is roughly 1 ramp for every 1 draw source." />
        <span className={`ml-auto text-[10px] font-bold ${gs.color}`}>{manaSources.grade}</span>
      </div>

      {total === 0 ? (
        <div className="flex items-center gap-1.5 mt-1">
          <AlertTriangle className="w-3 h-3 text-red-400/70" />
          <span className="text-xs text-red-400/80">No ramp cards — you'll fall behind on mana every game</span>
        </div>
      ) : (
        <>
          {/* Stacked bar */}
          <div className="flex h-2 rounded-full overflow-hidden mt-2">
            {tier01 > 0 && <div className="bg-emerald-500/80" style={{ width: `${(tier01 / total) * 100}%` }} title={`CMC 0-1: ${tier01}`} />}
            {tier2 > 0 && <div className="bg-emerald-400/60" style={{ width: `${(tier2 / total) * 100}%` }} title={`CMC 2: ${tier2}`} />}
            {tier3 > 0 && <div className="bg-amber-500/60" style={{ width: `${(tier3 / total) * 100}%` }} title={`CMC 3: ${tier3}`} />}
            {tier4plus > 0 && <div className="bg-red-500/50" style={{ width: `${(tier4plus / total) * 100}%` }} title={`CMC 4+: ${tier4plus}`} />}
          </div>

          {/* Tier counts */}
          <div className="flex justify-between text-[10px] text-muted-foreground/80 mt-1.5">
            <span><span className="text-emerald-400/80 font-semibold">{tier01}</span> CMC 0-1</span>
            <span><span className="text-emerald-400/60 font-semibold">{tier2}</span> CMC 2</span>
            <span><span className="text-amber-400/60 font-semibold">{tier3}</span> CMC 3</span>
            <span><span className="text-red-400/60 font-semibold">{tier4plus}</span> CMC 4+</span>
          </div>

          {/* Warnings or success */}
          <div className="mt-2 space-y-0.5">
            {warnings.length > 0 ? warnings.map((w, i) => {
              const WIcon = w.icon;
              return (
                <div key={i} className="flex items-start gap-1.5">
                  <WIcon className={`w-3 h-3 ${w.color} mt-0.5 flex-shrink-0`} />
                  <span className={`text-[11px] ${w.color}`}>{w.text}</span>
                </div>
              );
            }) : (
              <div className="flex items-center gap-1.5">
                <Check className="w-3 h-3 text-emerald-400/70" />
                <span className="text-[11px] text-emerald-400/80">{manaSources.message}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Land Drop Probability — P(making all land drops) by turn
// ═══════════════════════════════════════════════════════════════════════

function landDropBarColor(prob: number): string {
  if (prob >= 0.90) return 'bg-emerald-500/70';
  if (prob >= 0.75) return 'bg-amber-500/70';
  return 'bg-red-500/70';
}

export function LandDropCurve({
  deckSize, landCount,
}: {
  deckSize: number;
  landCount: number;
}) {
  const probs = useMemo(() => computeLandDropProbabilities(deckSize, landCount), [deckSize, landCount]);

  const reliableTurn = probs.reduce((last, p) => p.probability >= 0.75 ? p.turn : last, 0);
  const summary = reliableTurn >= 6
    ? 'Excellent land consistency through the mid-game'
    : reliableTurn >= 4
    ? `Reliable through ${reliableTurn} drops, then starts to dip`
    : reliableTurn >= 2
    ? `Only reliable through ${reliableTurn} drops — consider more lands`
    : 'Likely to miss land drops early — needs more lands';

  const summaryColor = reliableTurn >= 5 ? 'text-emerald-400/70' : reliableTurn >= 3 ? 'text-amber-400/70' : 'text-red-400/70';

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Mountain className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Land Drops</span>
        <InfoTooltip text="Probability of making every land drop through each turn, based on hypergeometric math. Green (90%+) is reliable, amber (75-90%) gets risky, red (<75%) means you'll often miss." />
        <span className="ml-auto text-[10px] text-muted-foreground/80">{landCount} lands</span>
      </div>

      {/* 7 vertical bars */}
      <div className="flex items-end gap-1 h-12 mt-2">
        {probs.map(p => (
          <div key={p.turn} className="flex-1 flex flex-col items-center gap-0.5 h-full">
            <div className="w-full flex-1 bg-muted-foreground/8 rounded-sm overflow-hidden flex items-end">
              <div
                className={`w-full ${landDropBarColor(p.probability)} rounded-sm transition-all`}
                style={{ height: `${p.probability * 100}%` }}
                title={`Turn ${p.turn}: ${Math.round(p.probability * 100)}%`}
              />
            </div>
            <span className="text-[8px] text-muted-foreground/80 tabular-nums">T{p.turn}</span>
          </div>
        ))}
      </div>

      {/* Percentage labels for key turns */}
      <div className="flex justify-between mt-1 text-[9px] tabular-nums text-muted-foreground/80">
        <span>{Math.round((probs[0]?.probability ?? 0) * 100)}%</span>
        <span>{Math.round((probs[2]?.probability ?? 0) * 100)}%</span>
        <span>{Math.round((probs[4]?.probability ?? 0) * 100)}%</span>
        <span>{Math.round((probs[6]?.probability ?? 0) * 100)}%</span>
      </div>

      {/* Summary */}
      <p className={`text-[10px] mt-1.5 ${summaryColor}`}>{summary}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Phase Card Display — cards in active phase grouped by role
// ═══════════════════════════════════════════════════════════════════════

const ROLE_GROUP_ORDER = ['ramp', 'interaction', 'cardDraw', 'other'] as const;
type RoleGroupKey = (typeof ROLE_GROUP_ORDER)[number];

const ROLE_GROUP_META: Record<RoleGroupKey, { icon: typeof Sprout; label: string; color: string }> = {
  ramp:        { icon: Sprout,    label: 'Ramp',        color: 'text-emerald-400/80' },
  interaction: { icon: Swords,    label: 'Interaction',  color: 'text-red-400/80' },
  cardDraw:    { icon: Sparkles,  label: 'Card Draw',    color: 'text-sky-400/80' },
  other:       { icon: Layers,    label: 'Other',        color: 'text-muted-foreground' },
};

const PHASE_ROLE_CONTEXT: Record<CurvePhase, Record<RoleGroupKey, string>> = {
  early: {
    ramp:        'Accelerates you into mid-game',
    interaction: 'Cheap answers you can hold up while developing',
    cardDraw:    'Filters early hands, keeps options open',
    other:       'Setup pieces and early threats',
  },
  mid: {
    ramp:        'Ramp at 3+ is slower but still adds mana',
    interaction: 'Mid-cost answers — harder to hold up and play threats',
    cardDraw:    'Engine pieces that sustain card flow',
    other:       'Core strategy cards and engine pieces',
  },
  late: {
    ramp:        'Late-game ramp rarely worth the slot',
    interaction: 'Expensive removal — often board wipes',
    cardDraw:    'Big refill effects for the late game',
    other:       'Payoffs, finishers, and top-end threats',
  },
};

export function PhaseCardDisplay({
  phase, onPreview, onCardAction, menuProps,
}: {
  phase: CurvePhaseAnalysis;
  onPreview: (name: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
}) {
  const groups = useMemo(() => {
    const buckets: Record<RoleGroupKey, AnalyzedCard[]> = {
      ramp: [], interaction: [], cardDraw: [], other: [],
    };
    for (const ac of phase.cards) {
      const role = ac.card.deckRole;
      if (role === 'ramp') buckets.ramp.push(ac);
      else if (role === 'removal' || role === 'boardwipe') buckets.interaction.push(ac);
      else if (role === 'cardDraw') buckets.cardDraw.push(ac);
      else buckets.other.push(ac);
    }
    // Sort each by inclusion desc
    for (const key of ROLE_GROUP_ORDER) {
      buckets[key].sort((a, b) => (b.inclusion ?? -1) - (a.inclusion ?? -1));
    }
    return buckets;
  }, [phase.cards]);

  const phaseMeta = PHASE_META[phase.phase];
  const PhaseIcon = phaseMeta.icon;

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2.5">
        <PhaseIcon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {phase.label}
        </span>
        <span className="text-[10px] text-muted-foreground/80">
          {phase.current} card{phase.current !== 1 ? 's' : ''} · CMC {phase.cmcRange[0]}-{phase.cmcRange[1] === 7 ? '7+' : phase.cmcRange[1]}
        </span>
        <InfoTooltip text={`Cards in the ${phase.label.toLowerCase()} range (CMC ${phase.cmcRange[0]}-${phase.cmcRange[1] === 7 ? '7+' : phase.cmcRange[1]}), grouped by their role in your deck. Target is ${phase.target} cards for this phase.`} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ROLE_GROUP_ORDER.map(key => {
          const cards = groups[key];
          if (cards.length === 0) return null;
          const meta = ROLE_GROUP_META[key];
          const Icon = meta.icon;
          const context = PHASE_ROLE_CONTEXT[phase.phase][key];
          return (
            <div key={key}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <Icon className={`w-3 h-3 ${meta.color}`} />
                <span className={`text-[11px] font-semibold ${meta.color}`}>
                  {meta.label}
                </span>
                <span className="text-[10px] text-muted-foreground/80 tabular-nums">{cards.length}</span>
              </div>
              <p className="text-[10px] text-muted-foreground/80 mb-1 leading-snug">{context}</p>
              <div className="space-y-0">
                {cards.map(ac => (
                  <AnalyzedCardRow
                    key={ac.card.name}
                    ac={ac}
                    onPreview={onPreview}
                    showDetails
                    onCardAction={onCardAction}
                    menuProps={menuProps}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ManaTrajectorySparkline({ trajectory }: { trajectory: ManaTrajectoryPoint[] }) {
  if (trajectory.length === 0) return null;

  const chartData = trajectory.map(t => ({
    turnLabel: `T${t.turn}`,
    expectedLands: t.expectedLands,
    totalExpectedMana: t.totalExpectedMana,
    rampMana: t.expectedRampMana,
  }));

  // Find max ramp turn for annotation
  const maxRampIdx = trajectory.reduce((best, t, i) =>
    t.expectedRampMana > trajectory[best].expectedRampMana ? i : best, 0);
  const maxRampTurn = trajectory[maxRampIdx];

  return (
    <div>
      <div className="flex flex-col gap-0.5 mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mana Trajectory</span>
          <span className="text-[10px] text-muted-foreground/80 ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0 inline-block border-t border-dashed border-emerald-500/50" />
              lands only
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 rounded bg-sky-500 inline-block" />
              lands + ramp
            </span>
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/80 leading-snug">
          Estimated mana available each turn based on your lands and ramp spells
        </span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <RechartsAreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
          <XAxis
            dataKey="turnLabel"
            tick={{ fontSize: 10, fill: 'hsl(220,13%,55%)', fillOpacity: 0.6 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide domain={[0, 'auto']} />
          <Tooltip content={<TrajectoryTooltip />} cursor={false} />

          {/* Area fill under total mana */}
          <Area
            type="monotone"
            dataKey="totalExpectedMana"
            stroke="#0ea5e9"
            strokeWidth={2}
            fill="#0ea5e9"
            fillOpacity={0.1}
            dot={{ r: 3, fill: '#38bdf8', strokeWidth: 0 }}
            activeDot={{ r: 4, fill: '#38bdf8', stroke: '#0ea5e9', strokeWidth: 2 }}
            isAnimationActive
            animationDuration={500}
          />

          {/* Lands-only dashed line */}
          <Line
            type="monotone"
            dataKey="expectedLands"
            stroke="rgba(16,185,129,0.5)"
            strokeWidth={1.2}
            strokeDasharray="4 3"
            dot={{ r: 2, fill: 'rgba(16,185,129,0.5)', strokeWidth: 0 }}
            isAnimationActive
            animationDuration={500}
          />

          {/* Ramp annotation at peak turn */}
          {maxRampTurn.expectedRampMana > 0 && (
            <ReferenceLine
              x={`T${maxRampTurn.turn}`}
              stroke="none"
              label={{
                value: `+${maxRampTurn.expectedRampMana.toFixed(1)} ramp`,
                position: 'insideTopRight',
                fontSize: 9,
                fill: 'rgba(56,189,248,0.5)',
              }}
            />
          )}
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CurveTypeGroup({
  type, cards, onPreview, onCardAction, menuProps,
}: {
  type: string;
  cards: AnalyzedCard[];
  onPreview: (name: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(p => !p)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/20 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
        <span className="text-sm font-bold capitalize">{type}</span>
        <span className="text-xs font-bold tabular-nums text-muted-foreground">{cards.length}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-0.5">
          {cards.map(ac => (
            <AnalyzedCardRow
              key={ac.card.name}
              ac={ac}
              onPreview={onPreview}
              showDetails
              onCardAction={onCardAction}
              menuProps={menuProps}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function CurvePhaseDetail({
  phase, recommendations, onPreview, onAdd, addedCards, onCardAction, menuProps,
}: {
  phase: CurvePhaseAnalysis;
  recommendations: RecommendedCard[];
  onPreview: (name: string) => void;
  onAdd: (name: string) => void;
  addedCards: Set<string>;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
}) {
  const deltaWord = phase.delta > 0 ? `${phase.delta} above` : phase.delta < 0 ? `${Math.abs(phase.delta)} below` : 'right on';
  const summary = `You have ${phase.current} ${phase.label.toLowerCase()} plays (${deltaWord} target of ${phase.target}).${
    phase.phase === 'early' && phase.rampInPhase > 0 ? ` Your ${phase.rampInPhase} ramp pieces at CMC ≤2 accelerate you into mid-game.` :
    phase.phase === 'mid' ? ` These make up ${phase.pctOfDeck}% of your spells — the core of your deck.` :
    phase.phase === 'late' && phase.current > 0 ? ` Average CMC of ${phase.avgCmc.toFixed(1)} in this range.` : ''
  }`;

  // CMC-filtered recommendations for this phase
  const [lo, hi] = phase.cmcRange;
  const filteredRecs = recommendations.filter(r => {
    const cmc = Math.min(Math.floor(r.cmc ?? 0), 7);
    return cmc >= lo && cmc <= hi;
  });
  const phaseRecs = (filteredRecs.length >= 3 ? filteredRecs : recommendations).slice(0, 15);
  const hasSuggestions = phase.delta < 0 && phaseRecs.length > 0;

  // Group cards by type for collapsible sections
  const typeGroups = useMemo(() => {
    const groups = new Map<string, AnalyzedCard[]>();
    for (const ac of phase.cards) {
      const tl = getFrontFaceTypeLine(ac.card).toLowerCase();
      let type = 'other';
      if (tl.includes('creature')) type = 'creature';
      else if (tl.includes('instant')) type = 'instant';
      else if (tl.includes('sorcery')) type = 'sorcery';
      else if (tl.includes('artifact')) type = 'artifact';
      else if (tl.includes('enchantment')) type = 'enchantment';
      else if (tl.includes('planeswalker')) type = 'planeswalker';
      else if (tl.includes('battle')) type = 'battle';
      const arr = groups.get(type) || [];
      arr.push(ac);
      groups.set(type, arr);
    }
    // Sort by count descending
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [phase.cards]);

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="bg-card/60 border border-border/30 rounded-lg p-3">
        <p className="text-xs text-muted-foreground leading-relaxed">{summary}</p>
      </div>

      {/* Card list + suggestions */}
      <div className={`flex flex-col ${hasSuggestions ? 'lg:flex-row' : ''} gap-3`}>
        <div className={hasSuggestions ? 'lg:w-[35%]' : 'w-full'}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
            In Your Deck ({phase.cards.length})
          </p>
          {phase.cards.length === 0 ? (
            <p className="text-xs text-muted-foreground/80 italic px-1">No cards in this range.</p>
          ) : (
            <div className="space-y-1.5">
              {typeGroups.map(([type, cards]) => (
                <CurveTypeGroup
                  key={type}
                  type={type}
                  cards={cards}
                  onPreview={onPreview}
                  onCardAction={onCardAction}
                  menuProps={menuProps}
                />
              ))}
            </div>
          )}
        </div>

        {hasSuggestions && (
          <div className="lg:w-[65%] lg:border-l lg:border-border/20 lg:pl-3">
            <SuggestionCardGrid
              title={<>Suggested {phase.label} Additions ({phaseRecs.length})</>}
              cards={phaseRecs}
              onAdd={onAdd}
              onPreview={onPreview}
              addedCards={addedCards}
              deficit={Math.abs(phase.delta)}
              onCardAction={onCardAction}
              menuProps={menuProps}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Commander Castability
// ═══════════════════════════════════════════════════════════════════════

function getCardArtUrl(card: ScryfallCard): string | undefined {
  return card.image_uris?.art_crop ?? card.card_faces?.[0]?.image_uris?.art_crop;
}

function getCardImageUrl(card: ScryfallCard): string | undefined {
  return card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small;
}

/** Extrapolate mana beyond the trajectory's last turn. After T7, roughly +1 land/turn, ramp tapers. */
function getManaAtTurn(trajectory: ManaTrajectoryPoint[], turn: number, useRamp: boolean): number {
  if (turn <= trajectory.length) {
    const t = trajectory[turn - 1];
    return useRamp ? t.totalExpectedMana : t.expectedLands;
  }
  // Extrapolate: last known point + ~1 mana per extra turn (land drops)
  const last = trajectory[trajectory.length - 1];
  const extra = turn - trajectory.length;
  const base = useRamp ? last.totalExpectedMana : last.expectedLands;
  return base + extra * 0.95; // slightly less than 1 to account for missed drops
}

function findCastTurnExtended(
  trajectory: ManaTrajectoryPoint[],
  cmc: number,
  useRamp: boolean,
  maxTurn = 12,
): number {
  for (let t = 1; t <= maxTurn; t++) {
    if (getManaAtTurn(trajectory, t, useRamp) >= cmc) return t;
  }
  return maxTurn + 1; // beyond our range
}

function turnColor(turn: number): string {
  if (turn <= 3) return 'text-emerald-400';
  if (turn <= 5) return 'text-sky-400';
  if (turn <= 7) return 'text-amber-400';
  return 'text-red-400';
}

function turnBarGradient(turn: number): string {
  if (turn <= 3) return 'from-emerald-500/70 to-emerald-500/30';
  if (turn <= 5) return 'from-sky-500/70 to-sky-500/30';
  if (turn <= 7) return 'from-amber-500/70 to-amber-500/30';
  return 'from-red-500/70 to-red-500/30';
}

function castTip(turn: number, cmc: number): string {
  if (turn <= 2) return 'Lightning fast — online before most opponents';
  if (turn <= 3) return 'Great tempo — comes down with interaction backup';
  if (turn <= 4) return 'Solid timing — on curve for midrange';
  if (turn <= 5) return 'Standard for 5+ CMC commanders';
  if (turn <= 7) return 'Slow — prioritize ramp in your opening hand';
  if (cmc >= 8) return 'Very expensive — needs heavy ramp commitment';
  return 'Late — mulligan aggressively for ramp';
}

function CommanderCastCard({
  card, trajectory, rampCount,
}: {
  card: ScryfallCard;
  trajectory: ManaTrajectoryPoint[];
  rampCount: number;
}) {
  const cmc = card.cmc;
  const castWithRamp = findCastTurnExtended(trajectory, cmc, true);
  const castNoRamp = findCastTurnExtended(trajectory, cmc, false);
  const recast2 = findCastTurnExtended(trajectory, cmc + 2, true);
  const artUrl = getCardArtUrl(card);
  const turnsGained = castNoRamp - castWithRamp;
  const maxTurn = 12;
  const rampPct = Math.min((castWithRamp / maxTurn) * 100, 100);
  const noRampPct = Math.min((castNoRamp / maxTurn) * 100, 100);
  const fmt = (t: number) => t > maxTurn ? `${maxTurn}+` : String(t);

  return (
    <div className="space-y-2.5">
      {/* Commander identity + hero turn */}
      <div className="flex items-center gap-2.5">
        {artUrl && (
          <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 border border-border/40">
            <img src={artUrl} alt={card.name} className="w-full h-full object-cover scale-150" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-foreground truncate">{card.name}</span>
            {card.mana_cost && <ManaCost cost={card.mana_cost} className="text-[10px]" />}
          </div>
          <p className="text-[10px] text-muted-foreground/80 mt-0.5 leading-tight">{castTip(castWithRamp, cmc)}</p>
        </div>
        <div className="text-right flex-shrink-0 pl-2">
          <div className={`text-xl font-bold tabular-nums leading-none ${turnColor(castWithRamp)}`}>
            T{fmt(castWithRamp)}
          </div>
        </div>
      </div>

      {/* Dual gauge bars: with ramp vs without */}
      <div className="space-y-1.5">
        {/* With ramp */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground/80 w-16 text-right">With ramp</span>
          <div className="flex-1 h-2 bg-muted-foreground/8 rounded-full overflow-hidden relative">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${turnBarGradient(castWithRamp)} transition-all`}
              style={{ width: `${rampPct}%` }}
            />
          </div>
          <span className={`text-[10px] font-bold tabular-nums w-6 text-right ${turnColor(castWithRamp)}`}>T{fmt(castWithRamp)}</span>
        </div>
        {/* Without ramp */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground/80 w-16 text-right">Lands only</span>
          <div className="flex-1 h-2 bg-muted-foreground/8 rounded-full overflow-hidden relative">
            <div
              className="h-full rounded-full bg-muted-foreground/20 transition-all"
              style={{ width: `${noRampPct}%` }}
            />
          </div>
          <span className="text-[10px] font-semibold tabular-nums w-6 text-right text-muted-foreground/80">T{fmt(castNoRamp)}</span>
        </div>
      </div>

      {/* Ramp impact + recast */}
      <div className="flex items-center gap-3 text-[10px]">
        {turnsGained > 0 && (
          <span className="text-emerald-400/80 font-medium">
            Ramp saves {turnsGained} turn{turnsGained > 1 ? 's' : ''}
          </span>
        )}
        {recast2 <= maxTurn && (
          <span className="text-muted-foreground/80">
            Recast (tax +2): T{recast2}
          </span>
        )}
      </div>
    </div>
  );
}

export function CommanderCastability({
  manaTrajectory, rampCount,
}: {
  manaTrajectory: ManaTrajectoryPoint[];
  rampCount: number;
}) {
  const commander = useStore(s => s.commander);
  const partner = useStore(s => s.partnerCommander);

  if (!commander || manaTrajectory.length === 0) return null;

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-3">
        <Target className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Commander Castability</span>
        <span className="ml-auto text-[10px] text-muted-foreground/80">{rampCount} ramp</span>
      </div>
      <div className={`${partner ? 'space-y-5' : ''}`}>
        <CommanderCastCard card={commander} trajectory={manaTrajectory} rampCount={rampCount} />
        {partner && (
          <>
            <div className="border-t border-border/20" />
            <CommanderCastCard card={partner} trajectory={manaTrajectory} rampCount={rampCount} />
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Tempo Timeline
// ═══════════════════════════════════════════════════════════════════════

const TURN_WINDOWS = [
  { label: 'Turns 1-2', range: [1, 2] as const, icon: Zap, phase: 'Setup' as const, desc: 'Deploy ramp and early interaction' },
  { label: 'Turns 3-4', range: [3, 4] as const, icon: Target, phase: 'Engine' as const, desc: 'Commander + core strategy comes online' },
  { label: 'Turns 5-6', range: [5, 6] as const, icon: Crown, phase: 'Value' as const, desc: 'Payoffs and board advantage' },
  { label: 'Turn 7+', range: [7, 7] as const, icon: Sparkles, phase: 'Endgame' as const, desc: 'Finishers and top-end threats' },
];

const WINDOW_COLORS = [
  'text-sky-400',
  'text-amber-400',
  'text-purple-400',
  'text-rose-400',
];

export function TempoTimeline({
  currentCards, manaTrajectory, commanderCmc, partnerCmc, cardInclusionMap,
}: {
  currentCards: ScryfallCard[];
  manaTrajectory: ManaTrajectoryPoint[];
  commanderCmc: number;
  partnerCmc?: number;
  cardInclusionMap?: Record<string, number>;
}) {
  if (manaTrajectory.length === 0) return null;

  const nonLandCards = useMemo(() =>
    currentCards.filter(c => !getFrontFaceTypeLine(c).toLowerCase().includes('land')),
    [currentCards]
  );

  // Group cards by the first turn window where they become castable
  const windowData = useMemo(() => {
    const alreadyCastable = new Set<string>();

    return TURN_WINDOWS.map((w, wi) => {
      // Mana available at end of this window
      const endTurn = Math.min(w.range[1], manaTrajectory.length);
      const manaAtStart = manaTrajectory[Math.max(0, w.range[0] - 1)]?.totalExpectedMana ?? 0;
      const manaAtEnd = manaTrajectory[Math.min(endTurn - 1, manaTrajectory.length - 1)]?.totalExpectedMana ?? 0;

      // Cards that unlock in this window (castable now but not in previous window)
      const prevMana = wi === 0 ? 0 : manaTrajectory[Math.min(TURN_WINDOWS[wi - 1].range[1] - 1, manaTrajectory.length - 1)]?.totalExpectedMana ?? 0;

      const newCards = nonLandCards.filter(c => {
        if (alreadyCastable.has(c.name)) return false;
        if (c.cmc <= manaAtEnd) {
          alreadyCastable.add(c.name);
          return c.cmc > prevMana || wi === 0; // truly new this window
        }
        return false;
      });

      // Also count cards already castable from previous windows
      const totalCastable = nonLandCards.filter(c => c.cmc <= manaAtEnd).length;

      // Pick key cards: prioritize by role, then inclusion %
      const keyCards = [...newCards]
        .sort((a, b) => {
          // Commander always first
          if (a.cmc === commanderCmc && !b.deckRole) return -1;
          if (b.cmc === commanderCmc && !a.deckRole) return 1;
          // Role cards next
          const aRole = a.deckRole ? 1 : 0;
          const bRole = b.deckRole ? 1 : 0;
          if (aRole !== bRole) return bRole - aRole;
          // Then by inclusion
          const aInc = cardInclusionMap?.[a.name] ?? 0;
          const bInc = cardInclusionMap?.[b.name] ?? 0;
          return bInc - aInc;
        })
        .slice(0, 5);

      // Commander castable in this window?
      const commanderCastable = commanderCmc > prevMana && commanderCmc <= manaAtEnd;
      const partnerCastable = partnerCmc != null && partnerCmc > prevMana && partnerCmc <= manaAtEnd;

      return {
        ...w,
        manaAtStart,
        manaAtEnd,
        newCards: newCards.length,
        totalCastable,
        keyCards,
        commanderCastable,
        partnerCastable,
      };
    });
  }, [nonLandCards, manaTrajectory, commanderCmc, partnerCmc, cardInclusionMap]);

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-3">
        <Sprout className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tempo Timeline</span>
      </div>
      <div className="space-y-0">
        {windowData.map((w, i) => {
          const color = WINDOW_COLORS[i];
          return (
            <div key={i} className="flex gap-3">
              {/* Vertical timeline line + dot */}
              <div className="flex flex-col items-center w-5 flex-shrink-0">
                <div className={`w-2 h-2 rounded-full mt-1.5 ${color} bg-current`} />
                {i < windowData.length - 1 && <div className="w-px flex-1 bg-border/30 my-0.5" />}
              </div>
              {/* Content */}
              <div className="flex-1 min-w-0 pb-3">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-xs font-semibold ${color}`}>{w.label}</span>
                  <span className="text-[10px] text-muted-foreground/80">{w.manaAtStart.toFixed(1)}-{w.manaAtEnd.toFixed(1)} mana</span>
                  <span className="text-[10px] text-muted-foreground/80">
                    {i === 0 ? `${w.newCards} castable` : `+${w.newCards} unlock`}
                  </span>
                  {w.commanderCastable && (
                    <span className="text-[10px] font-semibold text-amber-400/80 flex items-center gap-0.5">
                      <Target className="w-2.5 h-2.5" /> Commander
                    </span>
                  )}
                  {w.partnerCastable && (
                    <span className="text-[10px] font-semibold text-amber-400/80 flex items-center gap-0.5">
                      <Target className="w-2.5 h-2.5" /> Partner
                    </span>
                  )}
                </div>
                {w.keyCards.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {w.keyCards.map(c => (
                      <span
                        key={c.name}
                        className={`text-[10px] px-1.5 py-0.5 rounded border ${
                          c.deckRole === 'ramp' ? 'border-emerald-500/30 text-emerald-400/80' :
                          c.deckRole === 'removal' || c.deckRole === 'boardwipe' ? 'border-red-400/30 text-red-400/80' :
                          c.deckRole === 'cardDraw' ? 'border-sky-400/30 text-sky-400/80' :
                          'border-border/40 text-muted-foreground/70'
                        }`}
                      >
                        {c.name}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground/80 mt-0.5">{w.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════
// Hand Simulation
// ═══════════════════════════════════════════════════════════════════════

function classifyCard(card: ScryfallCard): string {
  const tl = getFrontFaceTypeLine(card).toLowerCase();
  if (tl.includes('land')) return 'land';
  if (card.deckRole === 'ramp') return 'ramp';
  if (card.deckRole === 'removal' || card.deckRole === 'boardwipe') return 'interaction';
  if (card.deckRole === 'cardDraw') return 'draw';
  return 'other';
}

const CLASS_COLORS: Record<string, string> = {
  land: 'border-amber-500/40 text-amber-400/80',
  ramp: 'border-emerald-500/40 text-emerald-400/80',
  interaction: 'border-red-400/40 text-red-400/80',
  draw: 'border-sky-400/40 text-sky-400/80',
  other: 'border-border/40 text-muted-foreground/70',
};

const CLASS_LABELS: Record<string, string> = {
  land: 'Land',
  ramp: 'Ramp',
  interaction: 'Interaction',
  draw: 'Draw',
  other: 'Spell',
};

export function HandSimulation({
  currentCards, deckSize, landCount, rampCount, removalCount,
}: {
  currentCards: ScryfallCard[];
  deckSize: number;
  landCount: number;
  rampCount: number;
  removalCount: number;
}) {
  const [sampleHand, setSampleHand] = useState<ScryfallCard[] | null>(null);
  const [mulliganCount, setMulliganCount] = useState(0);

  const earlyPlayCount = useMemo(() =>
    currentCards.filter(c => {
      const tl = getFrontFaceTypeLine(c).toLowerCase();
      return !tl.includes('land') && c.cmc <= 2;
    }).length,
    [currentCards]
  );

  const lowCmcCount = useMemo(() =>
    currentCards.filter(c => {
      const tl = getFrontFaceTypeLine(c).toLowerCase();
      return !tl.includes('land') && c.cmc <= 3;
    }).length,
    [currentCards]
  );

  const stats = useMemo(() =>
    computeHandStats(deckSize, landCount, rampCount, removalCount, earlyPlayCount, lowCmcCount),
    [deckSize, landCount, rampCount, removalCount, earlyPlayCount, lowCmcCount]
  );

  const drawHand = useCallback((mulligan = false) => {
    if (currentCards.length < 7) return;
    const newMullCount = mulligan ? mulliganCount + 1 : 0;
    const handSize = Math.max(7 - newMullCount, 1);
    // Fisher-Yates shuffle
    const indices = currentCards.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const hand = indices.slice(0, handSize).map(i => currentCards[i]);
    hand.sort((a, b) => {
      const aLand = getFrontFaceTypeLine(a).toLowerCase().includes('land') ? 0 : 1;
      const bLand = getFrontFaceTypeLine(b).toLowerCase().includes('land') ? 0 : 1;
      if (aLand !== bLand) return aLand - bLand;
      return a.cmc - b.cmc;
    });
    setSampleHand(hand);
    setMulliganCount(newMullCount);
  }, [currentCards, mulliganCount]);

  // Analyze sample hand keepability
  const handVerdict = useMemo(() => {
    if (!sampleHand) return null;
    const lands = sampleHand.filter(c => getFrontFaceTypeLine(c).toLowerCase().includes('land'));
    const nonLand = sampleHand.filter(c => !getFrontFaceTypeLine(c).toLowerCase().includes('land'));
    const earlyPlays = nonLand.filter(c => c.cmc <= 3);
    const rampCards = nonLand.filter(c => c.deckRole === 'ramp');

    const lc = lands.length;
    const hasEarlyPlay = earlyPlays.length > 0;
    const keep = lc >= 2 && lc <= 4 && hasEarlyPlay;

    let reason = '';
    if (lc < 2) reason = `Only ${lc} land${lc === 1 ? '' : 's'} — likely mana screwed`;
    else if (lc > 4) reason = `${lc} lands — heavy on mana, light on action`;
    else if (!hasEarlyPlay) reason = `No plays under CMC 4 — slow start`;
    else {
      const parts: string[] = [`${lc} lands`];
      if (rampCards.length > 0) parts.push(`${rampCards.length} ramp`);
      parts.push(`${earlyPlays.length} early play${earlyPlays.length > 1 ? 's' : ''}`);
      reason = parts.join(', ');
    }

    return { keep, reason };
  }, [sampleHand]);

  const keepPct = Math.round(stats.keepableRate * 100);
  const screwPct = Math.round(stats.manaScrew * 100);
  const floodPct = Math.round(stats.manaFlood * 100);

  // Composition bar data
  const compBars = [
    { label: 'Lands', value: stats.expectedLands, max: 7, color: 'bg-amber-500', textColor: 'text-amber-400/80' },
    { label: 'Ramp', value: stats.expectedRamp, max: 7, color: 'bg-emerald-500', textColor: 'text-emerald-400/80' },
    { label: 'Interaction', value: stats.expectedRemoval, max: 7, color: 'bg-red-500', textColor: 'text-red-400/80' },
    { label: 'Early plays', value: stats.expectedEarlyPlays, max: 7, color: 'bg-sky-500', textColor: 'text-sky-400/80' },
  ];

  // Risk color — gentler thresholds (screw ≤10% ok, flood ≤20% normal for 37+ lands)
  const riskColor = (pct: number, isFlood = false) => {
    const warnAt = isFlood ? 20 : 12;
    const dangerAt = isFlood ? 30 : 20;
    if (pct >= dangerAt) return { dot: 'bg-red-500', text: 'text-red-400' };
    if (pct >= warnAt) return { dot: 'bg-amber-500', text: 'text-amber-400' };
    return { dot: 'bg-emerald-500', text: 'text-emerald-400/80' };
  };

  const screwStyle = riskColor(screwPct);
  const floodStyle = riskColor(floodPct, true);

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg p-3 flex flex-col">
      <div className="flex items-center gap-1.5 mb-3">
        <Dices className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Opening Hand</span>
        <span className={`ml-auto text-sm font-bold tabular-nums ${
          keepPct >= 75 ? 'text-emerald-400' : keepPct >= 60 ? 'text-amber-400' : 'text-red-400'
        }`}>
          {keepPct}%
        </span>
        <span className="text-[10px] text-muted-foreground/80">keepable</span>
      </div>

      {/* Composition bars */}
      <div className="space-y-1 mb-2.5">
        {compBars.map(b => (
          <div key={b.label} className="flex items-center gap-2">
            <span className="text-[9px] text-muted-foreground/80 w-14 text-right">{b.label}</span>
            <div className="flex-1 h-1.5 bg-muted-foreground/8 rounded-full overflow-hidden">
              <div
                className={`h-full ${b.color} rounded-full transition-all`}
                style={{ width: `${(b.value / b.max) * 100}%`, opacity: 0.6 }}
              />
            </div>
            <span className={`text-[10px] font-semibold tabular-nums w-5 ${b.textColor}`}>{b.value}</span>
          </div>
        ))}
      </div>

      {/* Risk indicators */}
      <div className="flex items-center gap-3 text-[10px]">
        <div className="flex items-center gap-1">
          <div className={`w-1.5 h-1.5 rounded-full ${screwStyle.dot}`} />
          <span className="text-muted-foreground/80">Screw</span>
          <span className={`font-semibold tabular-nums ${screwStyle.text}`}>{screwPct}%</span>
        </div>
        <div className="flex items-center gap-1">
          <div className={`w-1.5 h-1.5 rounded-full ${floodStyle.dot}`} />
          <span className="text-muted-foreground/80">Flood</span>
          <span className={`font-semibold tabular-nums ${floodStyle.text}`}>{floodPct}%</span>
        </div>
      </div>

      {/* Spacer to push draw section down for consistent height with castability */}
      <div className="flex-1" />

      {/* Sample hand display */}
      {sampleHand && (
        <div className="mt-3">
          <div className="flex gap-1 flex-wrap mb-1.5">
            {sampleHand.map((card, i) => {
              const imgUrl = getCardImageUrl(card);
              const cls = classifyCard(card);
              return (
                <div key={`${card.name}-${i}`} className="flex flex-col items-center">
                  {imgUrl ? (
                    <div className={`w-[56px] h-[78px] rounded overflow-hidden border-2 ${CLASS_COLORS[cls].split(' ')[0]}`}>
                      <img src={imgUrl} alt={card.name} className="w-full h-full object-cover" loading="lazy" />
                    </div>
                  ) : (
                    <div className={`w-[56px] h-[78px] rounded border-2 flex items-center justify-center text-[7px] text-center px-0.5 ${CLASS_COLORS[cls]}`}>
                      {card.name}
                    </div>
                  )}
                  <span className={`text-[7px] mt-0.5 ${CLASS_COLORS[cls].split(' ')[1]}`}>{CLASS_LABELS[cls]}</span>
                </div>
              );
            })}
          </div>

          {/* Verdict */}
          {handVerdict && (
            <div className={`text-[11px] flex items-center gap-1.5 mb-2 ${handVerdict.keep ? 'text-emerald-400' : 'text-red-400'}`}>
              <span className="font-semibold">{handVerdict.keep ? 'Keep' : 'Mulligan'}</span>
              <span className="text-[10px] text-muted-foreground/80">— {handVerdict.reason}</span>
            </div>
          )}
        </div>
      )}

      {/* Draw / Mulligan buttons — always at bottom */}
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={() => drawHand(false)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <Shuffle className="w-3 h-3" />
          {sampleHand ? 'New Hand' : 'Draw Hand'}
        </button>
        {sampleHand && mulliganCount < 5 && (
          <button
            onClick={() => drawHand(true)}
            className="px-3 py-1.5 text-xs rounded-lg border border-amber-500/30 hover:bg-amber-500/10 text-amber-400/70 hover:text-amber-400 transition-colors"
          >
            Mulligan to {7 - mulliganCount - 1}
          </button>
        )}
        {mulliganCount > 0 && (
          <span className="text-[10px] text-muted-foreground/80 ml-auto">Mull #{mulliganCount}</span>
        )}
      </div>
    </div>
  );
}
