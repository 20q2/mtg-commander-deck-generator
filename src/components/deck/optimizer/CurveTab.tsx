import { useState, useMemo, useCallback } from 'react';
import {
  ComposedChart, AreaChart as RechartsAreaChart,
  Line, Area, Bar,
  XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ReferenceArea,
  ResponsiveContainer,
} from 'recharts';
import { ChevronDown, ChevronRight, Zap, Target, Crown, Sparkles, Dices, Sprout, Shuffle } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import type { CurvePhaseAnalysis, CurvePhase, CurveSlot, ManaTrajectoryPoint, AnalyzedCard, RecommendedCard } from '@/services/deckBuilder/deckAnalyzer';
import { PACING_MULTIPLIERS, computeHandStats } from '@/services/deckBuilder/deckAnalyzer';
import type { Pacing } from '@/services/deckBuilder/themeDetector';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { PACING_LABELS, PHASE_META, tileGradeStyles } from './constants';
import type { UserCardList } from './constants';
import { AnalyzedCardRow, type CardAction } from './shared';
import { SuggestionCardGrid } from './OverviewTab';
import { useStore } from '@/store';
import { ManaCost } from '@/components/ui/mtg-icons';

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

// ═══════════════════════════════════════════════════════════════════════
// Commander Castability
// ═══════════════════════════════════════════════════════════════════════

function getCardArtUrl(card: ScryfallCard): string | undefined {
  return card.image_uris?.art_crop ?? card.card_faces?.[0]?.image_uris?.art_crop;
}

function getCardImageUrl(card: ScryfallCard): string | undefined {
  return card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small;
}

function findCastTurn(
  trajectory: ManaTrajectoryPoint[],
  cmc: number,
  useRamp: boolean,
): number | null {
  for (const t of trajectory) {
    const mana = useRamp ? t.totalExpectedMana : t.expectedLands;
    if (mana >= cmc) return t.turn;
  }
  return null; // can't cast within 7 turns
}

function CommanderCastCard({
  card, trajectory,
}: {
  card: ScryfallCard;
  trajectory: ManaTrajectoryPoint[];
}) {
  const cmc = card.cmc;
  const castWithRamp = findCastTurn(trajectory, cmc, true);
  const castNoRamp = findCastTurn(trajectory, cmc, false);
  const recast2 = findCastTurn(trajectory, cmc + 2, true);
  const recast3 = findCastTurn(trajectory, cmc + 4, true);
  const artUrl = getCardArtUrl(card);
  const turnsGained = castNoRamp && castWithRamp ? castNoRamp - castWithRamp : 0;

  return (
    <div className="flex gap-3 items-start">
      {/* Art thumbnail */}
      {artUrl && (
        <div className="w-16 h-12 rounded-md overflow-hidden flex-shrink-0 border border-border/30">
          <img src={artUrl} alt={card.name} className="w-full h-full object-cover" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-foreground truncate">{card.name}</span>
          {card.mana_cost && <ManaCost cost={card.mana_cost} className="text-xs" />}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
          <span className="text-muted-foreground">
            With ramp: <span className={`font-semibold ${castWithRamp && castWithRamp <= 3 ? 'text-emerald-400' : castWithRamp && castWithRamp <= 5 ? 'text-sky-400' : 'text-amber-400'}`}>
              {castWithRamp ? `Turn ${castWithRamp}` : '8+'}
            </span>
          </span>
          <span className="text-muted-foreground">
            Without ramp: <span className="font-semibold text-muted-foreground/80">
              {castNoRamp ? `Turn ${castNoRamp}` : '8+'}
            </span>
          </span>
          {turnsGained > 0 && (
            <span className="text-emerald-400/70">({turnsGained} turn{turnsGained > 1 ? 's' : ''} faster)</span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] mt-0.5">
          <span className="text-muted-foreground/60">
            2nd cast: <span className="font-medium text-muted-foreground/80">{recast2 ? `Turn ${recast2}` : '8+'}</span>
          </span>
          <span className="text-muted-foreground/60">
            3rd cast: <span className="font-medium text-muted-foreground/80">{recast3 ? `Turn ${recast3}` : '8+'}</span>
          </span>
        </div>
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
      <div className="flex items-center gap-1.5 mb-2.5">
        <Target className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Commander Castability</span>
        <span className="ml-auto text-[10px] text-muted-foreground/50">{rampCount} ramp pieces</span>
      </div>
      <div className={`${partner ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : ''}`}>
        <CommanderCastCard card={commander} trajectory={manaTrajectory} />
        {partner && <CommanderCastCard card={partner} trajectory={manaTrajectory} />}
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
                  <span className="text-[10px] text-muted-foreground/50">{w.manaAtStart.toFixed(1)}-{w.manaAtEnd.toFixed(1)} mana</span>
                  <span className="text-[10px] text-muted-foreground/40">
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
                <p className="text-[10px] text-muted-foreground/40 mt-0.5">{w.desc}</p>
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

  // Include lands in the pool for drawing
  const allCards = useMemo(() => {
    // currentCards may or may not include lands depending on how it's passed
    // We need the full deck for drawing
    return currentCards;
  }, [currentCards]);

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

  const drawHand = useCallback(() => {
    if (allCards.length < 7) return;
    // Fisher-Yates shuffle on indices, pick first 7
    const indices = allCards.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const hand = indices.slice(0, 7).map(i => allCards[i]);
    // Sort: lands first, then by CMC
    hand.sort((a, b) => {
      const aLand = getFrontFaceTypeLine(a).toLowerCase().includes('land') ? 0 : 1;
      const bLand = getFrontFaceTypeLine(b).toLowerCase().includes('land') ? 0 : 1;
      if (aLand !== bLand) return aLand - bLand;
      return a.cmc - b.cmc;
    });
    setSampleHand(hand);
  }, [allCards]);

  // Analyze sample hand keepability
  const handVerdict = useMemo(() => {
    if (!sampleHand) return null;
    const lands = sampleHand.filter(c => getFrontFaceTypeLine(c).toLowerCase().includes('land'));
    const nonLand = sampleHand.filter(c => !getFrontFaceTypeLine(c).toLowerCase().includes('land'));
    const earlyPlays = nonLand.filter(c => c.cmc <= 3);
    const ramp = nonLand.filter(c => c.deckRole === 'ramp');

    const landCount = lands.length;
    const hasEarlyPlay = earlyPlays.length > 0;
    const keep = landCount >= 2 && landCount <= 4 && hasEarlyPlay;

    let reason = '';
    if (landCount < 2) reason = `Only ${landCount} land${landCount === 1 ? '' : 's'} — likely mana screwed`;
    else if (landCount > 4) reason = `${landCount} lands — heavy on mana, light on action`;
    else if (!hasEarlyPlay) reason = `No plays under CMC 4 — slow start`;
    else {
      const parts: string[] = [`${landCount} lands`];
      if (ramp.length > 0) parts.push(`${ramp.length} ramp`);
      if (earlyPlays.length > 0) parts.push(`${earlyPlays.length} early play${earlyPlays.length > 1 ? 's' : ''}`);
      reason = parts.join(', ');
    }

    return { keep, reason, landCount, earlyPlays: earlyPlays.length };
  }, [sampleHand]);

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Dices className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Opening Hand Analysis</span>
        <span className={`ml-auto text-xs font-bold tabular-nums ${
          stats.keepableRate >= 0.75 ? 'text-emerald-400' : stats.keepableRate >= 0.6 ? 'text-amber-400' : 'text-red-400'
        }`}>
          {Math.round(stats.keepableRate * 100)}% keepable
        </span>
      </div>

      {/* Expected composition */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-[11px]">
        <span className="text-muted-foreground">
          <span className="text-amber-400/80 font-semibold">{stats.expectedLands}</span> lands
        </span>
        <span className="text-muted-foreground">
          <span className="text-emerald-400/80 font-semibold">{stats.expectedRamp}</span> ramp
        </span>
        <span className="text-muted-foreground">
          <span className="text-red-400/80 font-semibold">{stats.expectedRemoval}</span> interaction
        </span>
        <span className="text-muted-foreground">
          <span className="text-sky-400/80 font-semibold">{stats.expectedEarlyPlays}</span> early plays
        </span>
      </div>

      {/* Draw button */}
      <button
        onClick={drawHand}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors mb-2"
      >
        <Shuffle className="w-3.5 h-3.5" />
        {sampleHand ? 'Draw Again' : 'Draw Sample Hand'}
      </button>

      {/* Sample hand display */}
      {sampleHand && (
        <div className="mt-2">
          <div className="flex gap-1.5 flex-wrap mb-2">
            {sampleHand.map((card, i) => {
              const imgUrl = getCardImageUrl(card);
              const cls = classifyCard(card);
              return (
                <div key={`${card.name}-${i}`} className="flex flex-col items-center gap-0.5">
                  {imgUrl ? (
                    <div className={`w-[68px] h-[95px] rounded overflow-hidden border-2 ${CLASS_COLORS[cls].split(' ')[0]}`}>
                      <img src={imgUrl} alt={card.name} className="w-full h-full object-cover" loading="lazy" />
                    </div>
                  ) : (
                    <div className={`w-[68px] h-[95px] rounded border-2 flex items-center justify-center text-[8px] text-center px-1 ${CLASS_COLORS[cls]}`}>
                      {card.name}
                    </div>
                  )}
                  <span className={`text-[8px] ${CLASS_COLORS[cls].split(' ')[1]}`}>{CLASS_LABELS[cls]}</span>
                </div>
              );
            })}
          </div>

          {/* Verdict */}
          {handVerdict && (
            <div className={`text-xs flex items-center gap-1.5 ${handVerdict.keep ? 'text-emerald-400' : 'text-red-400'}`}>
              <span className="font-semibold">{handVerdict.keep ? 'Keep' : 'Mulligan'}</span>
              <span className="text-[10px] text-muted-foreground/60">— {handVerdict.reason}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
