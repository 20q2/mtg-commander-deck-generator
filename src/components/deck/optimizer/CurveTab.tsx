import { useState, useMemo } from 'react';
import {
  ComposedChart, AreaChart as RechartsAreaChart,
  Line, Area, Bar,
  XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ReferenceArea,
  ResponsiveContainer,
} from 'recharts';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import type { CurvePhaseAnalysis, CurvePhase, CurveSlot, ManaTrajectoryPoint, AnalyzedCard, RecommendedCard } from '@/services/deckBuilder/deckAnalyzer';
import { PACING_MULTIPLIERS } from '@/services/deckBuilder/deckAnalyzer';
import type { Pacing } from '@/services/deckBuilder/themeDetector';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { PACING_LABELS, PHASE_META, tileGradeStyles } from './constants';
import type { UserCardList } from './constants';
import { AnalyzedCardRow, type CardAction } from './shared';
import { SuggestionCardGrid } from './OverviewTab';

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
    <div className="-mx-3 sm:-mx-4 -mt-3 sm:-mt-4 grid grid-cols-2 sm:grid-cols-3 border-b border-border/30">
      {phases.map((phase, i) => {
        const meta = PHASE_META[phase.phase];
        const Icon = meta.icon;
        const isActive = activePhase === phase.phase;
        const gs = tileGradeStyles(phase.grade.letter);
        const pct = phase.target > 0 ? Math.min(100, (phase.current / phase.target) * 100) : 100;

        let sub: string;
        if (phase.phase === 'early') {
          sub = `${phase.rampInPhase} ramp · ${phase.interactionInPhase} interaction`;
        } else if (phase.phase === 'mid') {
          sub = `${phase.pctOfDeck}% of spells`;
        } else {
          sub = phase.cards.length > 0 ? `avg ${phase.avgCmc.toFixed(1)} CMC` : 'no high-cost cards';
        }

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
  curveAnalysis, pacing, activePhase,
}: {
  curveAnalysis: CurveSlot[];
  pacing?: Pacing;
  activePhase?: CurvePhase | null;
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
          <span className="text-[10px] text-muted-foreground/50 ml-auto flex items-center gap-3">
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
        <span className="text-[10px] text-muted-foreground/40 leading-snug">
          Card count at each mana cost vs. the expected distribution for your commander{pacing && pacing !== 'balanced' ? ` (${PACING_LABELS[pacing]} tempo)` : ''}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <ComposedChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
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
          <span className="text-[10px] text-muted-foreground/50 ml-auto flex items-center gap-3">
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
        <span className="text-[10px] text-muted-foreground/40 leading-snug">
          Estimated mana available each turn based on your lands and ramp spells
        </span>
      </div>
      <ResponsiveContainer width="100%" height={80}>
        <RechartsAreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
          <XAxis
            dataKey="turnLabel"
            tick={{ fontSize: 10, fill: 'hsl(220,13%,55%)', fillOpacity: 0.6 }}
            axisLine={false}
            tickLine={false}
          />
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
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
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
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
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
            <p className="text-xs text-muted-foreground/40 italic px-1">No cards in this range.</p>
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
