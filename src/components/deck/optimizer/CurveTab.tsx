import { useState, useMemo, useCallback } from 'react';
import {
  ComposedChart, AreaChart as RechartsAreaChart,
  Line, Area, Bar, Cell,
  XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { ChevronDown, ChevronRight, X, Target, Crown, BookOpen, Sprout, Lightbulb, AlertTriangle, Swords, Mountain, Layers, ArrowUpDown, Scissors, Sparkles } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import type { CurvePhaseAnalysis, CurvePhase, CurveSlot, CurveBreakdown, ManaTrajectoryPoint, AnalyzedCard, RecommendedCard, ManaSourcesAnalysis, RoleBreakdown, GradeResult } from '@/services/deckBuilder/deckAnalyzer';
import { PACING_MULTIPLIERS } from '@/services/deckBuilder/deckAnalyzer';
import type { Pacing } from '@/services/deckBuilder/themeDetector';
import { getCachedCard } from '@/services/scryfall/client';
import { getCardRole } from '@/services/tagger/client';
import { PACING_LABELS, PHASE_META, tileGradeStyles, type CollapsibleGroup } from './constants';
import { AnalyzedCardRow, CollapsibleCardGroups, type CardAction, type CardRowMenuProps } from './shared';
import { SuggestionCardGrid, CutCardGrid } from './OverviewTab';
import { InfoTooltip } from '@/components/ui/info-tooltip';

// ═══════════════════════════════════════════════════════════════════════
// Curve Tab Components
// ═══════════════════════════════════════════════════════════════════════

const SUBTYPE_DISPLAY: Record<string, string> = {
  'mana-producer': 'Mana Dork',
  'mana-rock': 'Mana Rock',
  'cost-reducer': 'Cost Reducer',
  'ramp': 'Ramp',
  'counterspell': 'Counter',
  'bounce': 'Bounce',
  'spot-removal': 'Spot Removal',
  'removal': 'Removal',
  'bounce-wipe': 'Bounce Wipe',
  'boardwipe': 'Board Wipe',
  'tutor': 'Tutor',
  'wheel': 'Wheel',
  'cantrip': 'Cantrip',
  'card-draw': 'Card Draw',
  'card-advantage': 'Card Advantage',
};

const ROLE_SHORT_LABEL: Record<RoleGroupKey, string> = {
  ramp:        'RAMP',
  interaction: 'REMOVAL',
  cardDraw:    'DRAW',
  other:       'OTHER',
};

function getRoleGroupGrade(current: number, target: number): string {
  if (target === 0) return current > 0 ? 'A' : '-';
  if (current >= target) return 'A';
  const gap = target - current;
  const deficit = gap / target;
  // For small targets (≤5), a single card off shouldn't tank the grade
  if (gap <= 1) return deficit <= 0.20 ? 'A' : 'B';
  if (deficit <= 0.15) return 'B';
  if (deficit <= 0.35) return 'C';
  if (deficit <= 0.55) return 'D';
  return 'F';
}

export function CurveSummaryStrip({
  phases, activePhases, onPhaseClick, activeRoleGroups, onRoleGroupClick,
}: {
  phases: CurvePhaseAnalysis[];
  activePhases: Set<CurvePhase>;
  onPhaseClick: (phase: CurvePhase) => void;
  activeRoleGroups: Set<RoleGroupKey>;
  onRoleGroupClick: (group: RoleGroupKey) => void;
}) {
  const activePhase = phases.find(p => activePhases.has(p.phase));

  return (
    <div className="-mx-3 sm:-mx-4 border-t border-b border-border/30 bg-background/80 backdrop-blur-sm">
      {/* Phase tiles row */}
      <div className="grid grid-cols-3">
        {phases.map((phase, i) => {
          const meta = PHASE_META[phase.phase];
          const Icon = meta.icon;
          const isActive = activePhases.has(phase.phase);
          const gs = tileGradeStyles(phase.grade.letter);

          return (
            <button
              key={phase.phase}
              onClick={() => onPhaseClick(phase.phase)}
              className={`p-2.5 text-left w-full transition-all duration-200 outline-none ${
                i > 0 ? 'border-l border-l-border/30' : ''
              } ${isActive ? gs.bgColor : 'bg-black/20 hover:bg-black/30'}`}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <Icon className={`w-4 h-4 transition-colors duration-200 ${isActive ? gs.color : 'text-muted-foreground'}`} />
                <span className={`text-xs font-semibold uppercase tracking-wider truncate transition-colors duration-200 ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {phase.label}
                </span>
                <span className={`text-sm font-black ml-auto px-1.5 py-0.5 rounded transition-colors duration-200 ${gs.color} ${isActive ? gs.bgColor : 'bg-muted/30'}`}>
                  {phase.grade.letter}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className={`text-xl font-bold tabular-nums leading-none transition-opacity duration-200 ${gs.color} ${isActive ? '' : 'opacity-70'}`}>
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

      {/* Role filter row — collapses to height 0 when no phase is selected, slides in from top when one is. */}
      <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${activePhase ? 'grid-rows-[1fr] border-t border-border/30' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
      <div className="grid grid-cols-4">
        {ROLE_GROUP_ORDER.map((roleKey, ri) => {
          const prb = activePhase?.phaseRoleBreakdowns.find(r => r.roleGroup === roleKey);
          const grade = prb ? getRoleGroupGrade(prb.current, prb.target) : '-';
          const gradeGs = tileGradeStyles(grade);
          const roleMeta = ROLE_GROUP_META[roleKey];
          const isRoleActive = activeRoleGroups.has(roleKey);
          return (
            <button
              key={roleKey}
              onClick={() => onRoleGroupClick(roleKey)}
              className={`p-2 text-left transition-all duration-200 outline-none ${
                ri < 3 ? 'border-r border-border/30' : ''
              } ${isRoleActive ? `${gradeGs.bg} hover:bg-accent/40` : 'bg-black/20 hover:bg-black/30'}`}
            >
              <div className="flex items-center gap-1 mb-1 min-w-0">
                <roleMeta.icon className={`w-3 h-3 shrink-0 transition-colors duration-200 ${isRoleActive ? roleMeta.color : 'text-muted-foreground'}`} />
                <span className={`text-[9px] font-semibold uppercase tracking-wide leading-none truncate transition-colors duration-200 ${isRoleActive ? 'text-white' : 'text-muted-foreground'}`}>
                  {activePhase ? `${activePhase.label.split(' ')[0]} ` : ''}{ROLE_SHORT_LABEL[roleKey]}
                </span>
                <span className={`text-[10px] font-black ml-auto shrink-0 px-1 py-px rounded leading-none transition-colors duration-200 ${gradeGs.color} ${isRoleActive ? gradeGs.bgColor : 'bg-muted/30'}`}>
                  {grade}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-1">
                <span className={`text-base font-bold tabular-nums leading-none ${gradeGs.color}`}>
                  {prb?.current ?? 0}
                </span>
                <span className="text-[9px] text-muted-foreground tabular-nums leading-none">
                  {prb?.target ?? 0} suggested
                </span>
              </div>
            </button>
          );
        })}
      </div>
        </div>
      </div>
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
  const ramp = payload.find(p => p.dataKey === 'rampCount')?.value ?? 0;
  const interaction = payload.find(p => p.dataKey === 'interactionCount')?.value ?? 0;
  const cardDraw = payload.find(p => p.dataKey === 'cardDrawCount')?.value ?? 0;
  const other = payload.find(p => p.dataKey === 'otherCount')?.value ?? 0;
  const hasRoles = ramp + interaction + cardDraw + other > 0;
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
      {hasRoles && (
        <div className="mt-1 pt-1 border-t border-border/30 space-y-0.5">
          {ramp > 0        && <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-emerald-400/60 shrink-0" />Ramp: {ramp}</div>}
          {interaction > 0 && <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-red-400/60 shrink-0" />Removal: {interaction}</div>}
          {cardDraw > 0    && <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-sky-400/60 shrink-0" />Draw: {cardDraw}</div>}
          {other > 0       && <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-slate-400/50 shrink-0" />Other: {other}</div>}
        </div>
      )}
    </div>
  );
}

export function TrajectoryTooltip({ active, payload, label }: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: Array<{ dataKey: string; value: number; payload?: any }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  const total = row.totalExpectedMana ?? 0;
  const lands = row.expectedLands ?? 0;
  const ramp = total - lands;
  const tapPen = row.tapPenalty ?? 0;
  const ldp = row.landDropProbability ?? 0;
  const castable = row.castableCards ?? 0;
  const castPct = row.castablePct ?? 0;
  const unlocks = row.newUnlocks ?? 0;

  return (
    <div className="bg-popover border border-border rounded-md px-2.5 py-1.5 shadow-lg text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
      <div className="font-semibold text-foreground mb-1">{label}</div>
      <div className="flex items-center gap-1.5 text-sky-400">
        <span className="w-2.5 h-0.5 rounded-full bg-sky-500 shrink-0" />
        Total mana: {total.toFixed(1)}
      </div>
      <div className="flex items-center gap-1.5 text-emerald-400/70">
        <span className="w-2.5 h-0.5 rounded-full bg-emerald-500/50 shrink-0" />
        From lands: {lands.toFixed(1)}{tapPen > 0 ? ` (−${tapPen.toFixed(1)} tap)` : ''}
      </div>
      {ramp > 0 && (
        <div className="flex items-center gap-1.5 text-sky-400/60">
          <span className="w-2.5 h-0.5 rounded-full bg-sky-400/50 shrink-0" />
          From ramp: +{ramp.toFixed(1)}
        </div>
      )}
      {ldp > 0 && <div className="text-muted-foreground/60 mt-1 pt-1 border-t border-border/30 pl-4">Hit all drops: {Math.round(ldp * 100)}%</div>}
      {(castable > 0 || castPct > 0) && (
        <div className="flex items-center gap-1.5 text-purple-400/70">
          <span className="w-2.5 h-0.5 rounded-full bg-purple-500/40 shrink-0" />
          {castable} spells castable ({Math.round(castPct * 100)}%){unlocks > 0 ? ` · +${unlocks} new` : ''}
        </div>
      )}
    </div>
  );
}

export function ManaCurveLineChart({
  curveAnalysis, curveBreakdowns, pacing, activePhases, selectedCmc, onCmcClick, chartHeight = 140,
}: {
  curveAnalysis: CurveSlot[];
  curveBreakdowns?: CurveBreakdown[];
  pacing?: Pacing;
  activePhases?: Set<CurvePhase>;
  selectedCmc?: number | null;
  onCmcClick?: (cmc: number) => void;
  chartHeight?: number;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = useCallback((key: string) => {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  const show = (key: string) => !hidden.has(key);

  if (curveAnalysis.length === 0) return null;

  const multipliers = pacing ? PACING_MULTIPLIERS[pacing] : PACING_MULTIPLIERS.balanced;
  const hasPhaseFilter = activePhases != null && activePhases.size > 0;

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

  // Determine which CMCs belong to any active phase
  const cmcToPhase = (cmc: number): CurvePhase => cmc <= 2 ? 'early' : cmc <= 4 ? 'mid' : 'late';
  const isInPhase = (cmc: number) => {
    if (!hasPhaseFilter) return true;
    return activePhases!.has(cmcToPhase(cmc));
  };

  // Role counts per CMC from curveBreakdowns
  const roleByCmc = useMemo(() => {
    if (!curveBreakdowns) return null;
    const map: Record<number, { ramp: number; interaction: number; cardDraw: number; other: number }> = {};
    for (const b of curveBreakdowns) {
      let ramp = 0, interaction = 0, cardDraw = 0, other = 0;
      for (const ac of b.cards) {
        const role = ac.card.deckRole;
        if (role === 'ramp') ramp++;
        else if (role === 'removal' || role === 'boardwipe') interaction++;
        else if (role === 'cardDraw') cardDraw++;
        else other++;
      }
      map[b.cmc] = { ramp, interaction, cardDraw, other };
    }
    return map;
  }, [curveBreakdowns]);

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
    rampCount: roleByCmc?.[s.cmc]?.ramp ?? 0,
    interactionCount: roleByCmc?.[s.cmc]?.interaction ?? 0,
    cardDrawCount: roleByCmc?.[s.cmc]?.cardDraw ?? 0,
    otherCount: roleByCmc?.[s.cmc]?.other ?? 0,
  }));

  return (
    <div className="bg-background/70 pt-2 pb-0 flex flex-col -m-4">
      <div className="flex flex-col gap-0.5 mb-1 px-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mana Curve</span>
          <span className="text-[10px] ml-auto flex items-center gap-2 flex-wrap justify-end">
            {roleByCmc && (<>
              {([
                { key: 'ramp',        label: 'ramp',    cls: 'bg-emerald-400/50' },
                { key: 'interaction', label: 'removal', cls: 'bg-red-400/50' },
                { key: 'cardDraw',    label: 'draw',    cls: 'bg-sky-400/50' },
                { key: 'other',       label: 'other',   cls: 'bg-slate-400/40' },
              ] as const).map(item => (
                <button key={item.key} onClick={() => toggle(item.key)}
                  className={`flex items-center gap-1 transition-opacity ${show(item.key) ? 'opacity-100' : 'opacity-35'}`}>
                  <span className={`w-2.5 h-2.5 rounded-sm inline-block ${item.cls}`} />
                  <span className="text-muted-foreground/80">{item.label}</span>
                </button>
              ))}
              <span className="w-px h-3 bg-border/50" />
            </>)}
            <button onClick={() => toggle('target')}
              className={`flex items-center gap-1.5 transition-opacity ${show('target') ? 'opacity-100' : 'opacity-35'}`}>
              <span className="w-4 h-0 inline-block border-t-2 border-dashed border-amber-500/60" />
              <span className="text-muted-foreground/80">expected{pacing ? ` (${PACING_LABELS[pacing]})` : ''}</span>
            </button>
            <button onClick={() => toggle('current')}
              className={`flex items-center gap-1.5 transition-opacity ${show('current') ? 'opacity-100' : 'opacity-35'}`}>
              <span className="w-4 h-0.5 rounded bg-sky-500 inline-block" />
              <span className="text-muted-foreground/80">your deck</span>
            </button>
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={chartHeight} debounce={1} className="flex-1 min-h-[120px] [&_*:focus-visible]:outline-none [&_*:focus]:outline-none">
        <ComposedChart
          data={chartData}
          margin={{ top: 6, right: 0, bottom: 0, left: -20 }}
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tick={(props: any) => {
              const { x, y, payload } = props as { x: number; y: number; payload: { value: string; index: number } };
              const d = chartData[payload.index];
              const isSelected = selectedCmc != null && d?.cmc === selectedCmc;
              return (
                <text x={x} y={y + 10} textAnchor="middle" fontSize={isSelected ? 11 : 10}
                  fill={isSelected ? '#38bdf8' : 'hsl(220,13%,55%)'}
                  fillOpacity={isSelected ? 1 : 0.6}
                  fontWeight={isSelected ? 700 : 400}
                >{payload.value}</text>
              );
            }}
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


          {/* Role breakdown bars — stacked columns, per-cell dimming when a CMC is selected */}
          {roleByCmc && (<>
            {show('ramp') && <Bar dataKey="rampCount" stackId="roles" isAnimationActive={false}>
              {chartData.map((d, i) => <Cell key={i} fill={selectedCmc == null || d.cmc === selectedCmc ? 'rgba(52,211,153,0.45)' : 'rgba(52,211,153,0.10)'} />)}
            </Bar>}
            {show('interaction') && <Bar dataKey="interactionCount" stackId="roles" isAnimationActive={false}>
              {chartData.map((d, i) => <Cell key={i} fill={selectedCmc == null || d.cmc === selectedCmc ? 'rgba(248,113,113,0.40)' : 'rgba(248,113,113,0.09)'} />)}
            </Bar>}
            {show('cardDraw') && <Bar dataKey="cardDrawCount" stackId="roles" isAnimationActive={false}>
              {chartData.map((d, i) => <Cell key={i} fill={selectedCmc == null || d.cmc === selectedCmc ? 'rgba(56,189,248,0.40)' : 'rgba(56,189,248,0.09)'} />)}
            </Bar>}
            {show('other') && <Bar dataKey="otherCount" stackId="roles" isAnimationActive={false} radius={[2,2,0,0]}>
              {chartData.map((d, i) => <Cell key={i} fill={selectedCmc == null || d.cmc === selectedCmc ? 'rgba(148,163,184,0.30)' : 'rgba(148,163,184,0.07)'} />)}
            </Bar>}
          </>)}

          {/* Target line (dashed amber) */}
          {show('target') && <Line
            type="monotone"
            dataKey="target"
            stroke="rgba(245,158,11,0.6)"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            dot={(props: { cx?: number; cy?: number; index?: number }) => {
              const { cx = 0, cy = 0, index = 0 } = props;
              const d = chartData[index];
              const dimmed = selectedCmc != null && d?.cmc !== selectedCmc;
              return <circle key={`t-${index}`} cx={cx} cy={cy} r={2.5} fill={`rgba(245,158,11,${dimmed ? 0.12 : 0.6})`} />;
            }}
            isAnimationActive
            animationDuration={500}
          />}

          {/* Actual curve (solid sky) */}
          {show('current') && <Line
            type="monotone"
            dataKey="current"
            stroke="#0ea5e9"
            strokeWidth={2.5}
            dot={(props: { cx?: number; cy?: number; index?: number }) => {
              const { cx = 0, cy = 0, index = 0 } = props;
              const d = chartData[index];
              const isSelected = selectedCmc != null && d?.cmc === selectedCmc;
              const dimmed = selectedCmc != null && !isSelected;
              if (isSelected) {
                return (
                  <g key={`c-${index}`}>
                    <circle cx={cx} cy={cy} r={8} fill="rgba(56,189,248,0.15)" />
                    <circle cx={cx} cy={cy} r={5} fill="#38bdf8" stroke="#0ea5e9" strokeWidth={2} />
                  </g>
                );
              }
              return <circle key={`c-${index}`} cx={cx} cy={cy} r={dimmed ? 2.5 : 4} fill={dimmed ? 'rgba(56,189,248,0.15)' : '#38bdf8'} />;
            }}
            activeDot={{ r: 5, fill: '#38bdf8', stroke: '#0ea5e9', strokeWidth: 2 }}
            isAnimationActive
            animationDuration={500}
          />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

type WithinGroupSort = 'inclusion' | 'name' | 'cmc';

function sortWithinGroup(cards: AnalyzedCard[], mode: WithinGroupSort): AnalyzedCard[] {
  if (mode === 'name') return [...cards].sort((a, b) => a.card.name.localeCompare(b.card.name));
  if (mode === 'cmc') return [...cards].sort((a, b) => (a.card.cmc - b.card.cmc) || a.card.name.localeCompare(b.card.name));
  return [...cards].sort((a, b) => (b.inclusion ?? -1) - (a.inclusion ?? -1));
}

function WithinGroupSortToggle({ mode, onChange }: { mode: WithinGroupSort; onChange: (m: WithinGroupSort) => void }) {
  const opts: { key: WithinGroupSort; label: string }[] = [
    { key: 'inclusion', label: 'Inclusion' },
    { key: 'cmc', label: 'CMC' },
    { key: 'name', label: 'Name' },
  ];
  return (
    <div className="flex items-center gap-1">
      <ArrowUpDown className="w-3 h-3 text-muted-foreground/40" />
      <div className="flex items-center border border-border/50 rounded-md overflow-hidden">
        {opts.map((o, i) => (
          <span key={o.key} className="flex items-center">
            {i > 0 && <span className="w-px h-3 bg-border/50" />}
            <button
              onClick={() => onChange(o.key)}
              className={`text-[10px] px-2 py-0.5 transition-colors ${mode === o.key ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/50'}`}
            >{o.label}</button>
          </span>
        ))}
      </div>
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
  const [sortMode, setSortMode] = useState<WithinGroupSort>('inclusion');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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

  const groups = useMemo(() => {
    const buckets: Record<RoleGroupKey, AnalyzedCard[]> = {
      ramp: [], interaction: [], cardDraw: [], other: [],
    };
    for (const ac of bucket.cards) {
      const role = ac.card.deckRole;
      if (role === 'ramp') buckets.ramp.push(ac);
      else if (role === 'removal' || role === 'boardwipe') buckets.interaction.push(ac);
      else if (role === 'cardDraw') buckets.cardDraw.push(ac);
      else buckets.other.push(ac);
    }
    for (const key of ROLE_GROUP_ORDER) {
      buckets[key] = sortWithinGroup(buckets[key], sortMode);
    }
    return buckets;
  }, [bucket.cards, sortMode]);

  const toggleCollapse = useCallback((key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <div className="bg-card/60 border border-sky-500/20 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          CMC {selectedCmc === 7 ? '7+' : selectedCmc} — {bucket.cards.length} card{bucket.cards.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-2">
          <WithinGroupSortToggle mode={sortMode} onChange={setSortMode} />
          <button onClick={onClose} className="text-muted-foreground/80 hover:text-muted-foreground transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="space-y-2">
        {ROLE_GROUP_ORDER.map(key => {
          const cards = groups[key];
          if (cards.length === 0) return null;
          const meta = ROLE_GROUP_META[key];
          const Icon = meta.icon;
          const isCollapsed = collapsed.has(key);
          return (
            <div key={key} className="bg-card/40 border border-border/20 rounded-lg px-3 py-2">
              <button
                onClick={() => toggleCollapse(key)}
                className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
              >
                {isCollapsed
                  ? <ChevronRight className={`w-3.5 h-3.5 ${meta.color}`} />
                  : <ChevronDown className={`w-3.5 h-3.5 ${meta.color}`} />
                }
                <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                <span className={`text-xs font-semibold ${meta.color}`}>
                  {meta.label}
                </span>
                <span className="text-[11px] text-muted-foreground/80 tabular-nums">{cards.length}</span>
              </button>
              {!isCollapsed && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-3 gap-y-0 mt-1">
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
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Curve Flags — warn/bad callouts surfaced inline in the trajectory chart
// ═══════════════════════════════════════════════════════════════════════

export type CurveFlag = {
  key: string;
  icon: typeof Lightbulb;
  severity: 'warn' | 'bad';
  color: string;
  title: string;
  detail: string;
};


/** Returns only actionable warn/bad flags. Commander cast is handled separately as a chip. */
export function computeCurveFlags({
  curveAnalysis, curvePhases, manaSources, totalNonLand, drawCount, taplandCount = 0, landCount = 0,
}: {
  curveAnalysis: CurveSlot[];
  curvePhases: CurvePhaseAnalysis[];
  manaSources: ManaSourcesAnalysis;
  totalNonLand: number;
  drawCount: number;
  taplandCount?: number;
  landCount?: number;
}): CurveFlag[] {
  const result: CurveFlag[] = [];

  // 3-CMC choke point
  const slot3 = curveAnalysis.find(s => s.cmc === 3);
  if (slot3 && totalNonLand > 0) {
    const pct3 = Math.round((slot3.current / totalNonLand) * 100);
    if (pct3 > 25) {
      result.push({ key: '3cmc', icon: AlertTriangle, severity: 'bad', color: 'text-red-400',
        title: `3-CMC Congestion (${pct3}%)`,
        detail: `${slot3.current} cards compete for turn 3. Move some to 2 or 4 CMC to smooth your curve.` });
    } else if (pct3 > 20) {
      result.push({ key: '3cmc', icon: AlertTriangle, severity: 'warn', color: 'text-amber-400',
        title: `3-CMC Crowded (${pct3}%)`,
        detail: `${slot3.current} cards at 3 CMC. Consider shifting a few to 2 or 4 for better flow.` });
    }
  }

  // Dead CMC slots
  for (const cmc of [1, 2]) {
    const slot = curveAnalysis.find(s => s.cmc === cmc);
    if (slot && slot.current === 0) {
      result.push({ key: `dead${cmc}`, icon: AlertTriangle, severity: 'bad', color: 'text-red-400',
        title: `No ${cmc}-Drops`,
        detail: `You have nothing to play on turn ${cmc}. Add some cheap spells so you're not wasting early mana.` });
      break;
    }
  }

  // Ramp-to-draw ratio
  const totalRamp = manaSources.totalRamp;
  if (drawCount > 0 && totalRamp / drawCount > 2.5) {
    result.push({ key: 'ratio', icon: Sprout, severity: 'warn', color: 'text-amber-400',
      title: `Ramp-Heavy (${totalRamp}:${drawCount})`,
      detail: `${totalRamp} ramp vs ${drawCount} draw. You may flood with mana but run out of cards to play.` });
  } else if (totalRamp < 7 && totalNonLand > 50) {
    result.push({ key: 'lowramp', icon: Sprout, severity: 'bad', color: 'text-red-400',
      title: `Low Ramp (${totalRamp})`,
      detail: `Only ${totalRamp} ramp sources. You'll likely fall behind on mana each turn.` });
  }

  // Tapland tempo penalty
  if (taplandCount > 0 && landCount > 0) {
    const tapPct = Math.round((taplandCount / landCount) * 100);
    if (tapPct >= 50) {
      result.push({ key: 'taplands', icon: Mountain, severity: 'bad', color: 'text-red-400',
        title: `Taplands ${tapPct}%`,
        detail: `${taplandCount} of ${landCount} lands enter tapped. Severe tempo loss — you'll be a turn behind constantly.` });
    } else if (tapPct >= 30) {
      result.push({ key: 'taplands', icon: Mountain, severity: 'warn', color: 'text-amber-400',
        title: `Taplands ${tapPct}%`,
        detail: `${taplandCount} of ${landCount} lands enter tapped. Expect sluggish early turns.` });
    }
  }

  // Top-heavy curve
  const latePhase = curvePhases.find(p => p.phase === 'late');
  if (latePhase && totalNonLand > 0) {
    const latePct = Math.round((latePhase.current / totalNonLand) * 100);
    if (latePct > 40) {
      result.push({ key: 'shape', icon: Crown, severity: 'warn', color: 'text-amber-400',
        title: `Top-Heavy (${latePct}%)`,
        detail: `${latePct}% of spells cost 5+. You'll struggle to play anything meaningful in early turns.` });
    }
  }

  return result;
}


// ═══════════════════════════════════════════════════════════════════════
// Phase Card Display — cards in active phase grouped by role
// ═══════════════════════════════════════════════════════════════════════

export const ROLE_GROUP_ORDER = ['ramp', 'interaction', 'cardDraw', 'other'] as const;
export type RoleGroupKey = (typeof ROLE_GROUP_ORDER)[number];

export const ROLE_GROUP_META: Record<RoleGroupKey, { icon: typeof Sprout; label: string; color: string }> = {
  ramp:        { icon: Sprout,    label: 'Ramp',        color: 'text-emerald-400/80' },
  interaction: { icon: Swords,    label: 'Interaction',  color: 'text-red-400/80' },
  cardDraw:    { icon: BookOpen,  label: 'Card Draw',    color: 'text-sky-400/80' },
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
    ramp:        'Slower ramp, but should be making big mana at this stage',
    interaction: 'Mid-cost answers — harder to hold up and play threats',
    cardDraw:    'Engine pieces that sustain card flow',
    other:       'Core strategy cards and engine pieces',
  },
  late: {
    ramp:        'High-impact mana doublers and cost reducers that keep you ahead once the game opens up',
    interaction: 'Big answers like board wipes and exile effects for when things go sideways',
    cardDraw:    'Massive refills to reload your hand when you\'re running on fumes',
    other:       'Your haymakers — the cards that close out the game',
  },
};

/** One-line natural-language rollup for a phase based on its grade and role gaps. */
function buildPhaseRollup(phase: CurvePhaseAnalysis): string {
  const letter = phase.grade.letter;
  const phaseName =
    phase.phase === 'early' ? 'early game' :
    phase.phase === 'mid'   ? 'mid game'   : 'late game';

  const roleLabel = (rg: RoleGroupKey) =>
    rg === 'ramp'        ? 'ramp' :
    rg === 'interaction' ? 'interaction' :
    rg === 'cardDraw'    ? 'card draw' : 'threats and setup';

  const consequence = (rg: RoleGroupKey): string => {
    if (rg === 'ramp') {
      return phase.phase === 'early'
        ? 'so you may stumble onto your mana curve'
        : 'limiting your ability to power out big plays';
    }
    if (rg === 'interaction') return 'so opposing threats can slip through unchecked';
    if (rg === 'cardDraw') {
      return phase.phase === 'late'
        ? 'so you may run out of gas in long games'
        : 'so you may struggle to find your key pieces';
    }
    return 'leaving few proactive plays at this stage';
  };

  // Rank role gaps (positive = under target).
  const tracked = phase.phaseRoleBreakdowns
    .filter(b => b.target > 0)
    .map(b => ({ rg: b.roleGroup as RoleGroupKey, gap: b.target - b.current, current: b.current, target: b.target }));

  const deficits = tracked.filter(b => b.gap > 0).sort((a, b) => b.gap - a.gap);
  const onCurve = tracked.filter(b => b.gap <= 0);

  const joinLabels = (items: RoleGroupKey[]): string => {
    const labels = items.map(roleLabel);
    if (labels.length === 0) return 'this phase';
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
    return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
  };

  if (letter === 'A') {
    const strong = onCurve.slice(0, 2).map(b => b.rg);
    return strong.length
      ? `Strong ${phaseName} — well-covered on ${joinLabels(strong)}.`
      : `Strong ${phaseName} — consistently on curve.`;
  }
  if (letter === 'B') {
    const strong = onCurve.slice(0, 2).map(b => b.rg);
    if (deficits[0]) {
      return `Solid ${phaseName}, though a bit light on ${roleLabel(deficits[0].rg)}.`;
    }
    return strong.length
      ? `Solid ${phaseName}, with reliable ${joinLabels(strong)}.`
      : `Solid ${phaseName}.`;
  }
  if (letter === 'C') {
    if (deficits[0]) {
      return `Workable ${phaseName}, but light on ${roleLabel(deficits[0].rg)} — ${consequence(deficits[0].rg)}.`;
    }
    return `Workable ${phaseName}, though nothing here stands out.`;
  }
  // D / F
  if (deficits.length >= 2) {
    const worst = deficits.slice(0, 2).map(d => d.rg);
    return `Weak ${phaseName} — short on ${joinLabels(worst)}, ${consequence(deficits[0].rg)}.`;
  }
  if (deficits[0]) {
    return `Weak ${phaseName} — short on ${roleLabel(deficits[0].rg)}, ${consequence(deficits[0].rg)}.`;
  }
  return `Weak ${phaseName} — under-built across the board.`;
}

type CommanderCastChip = { key: string; label: string; turn: number; savedTurns: number; color: string; bgColor: string; tooltip: string };

function buildCommanderCastChips(
  trajectory: ManaTrajectoryPoint[],
  commanderCmc?: number,
  commanderName?: string,
  partnerCmc?: number,
  partnerName?: string,
): CommanderCastChip[] {
  if (!commanderCmc || !commanderName) return [];
  const fmt = (t: number) => Math.min(t, 12);
  const chips: CommanderCastChip[] = [];

  const castWith = findCastTurnExtended(trajectory, commanderCmc, true);
  const castWithout = findCastTurnExtended(trajectory, commanderCmc, false);
  const saved = castWithout - castWith;
  const color = turnColor(castWith);
  const bgColor = color.includes('emerald') ? 'bg-emerald-500/10' : color.includes('sky') ? 'bg-sky-500/10' : color.includes('amber') ? 'bg-amber-500/10' : 'bg-red-500/10';
  chips.push({
    key: 'cmdr',
    label: commanderName.split(',')[0],
    turn: fmt(castWith),
    savedTurns: saved,
    color, bgColor,
    tooltip: saved > 0
      ? `${commanderName} ready by turn ${fmt(castWith)}. Ramp saves ${saved} turn${saved > 1 ? 's' : ''} vs lands alone.`
      : `${commanderName} castable on turn ${fmt(castWith)} on curve.`,
  });

  if (partnerCmc != null && partnerName) {
    const pCast = findCastTurnExtended(trajectory, partnerCmc, true);
    const pSaved = findCastTurnExtended(trajectory, partnerCmc, false) - pCast;
    const pColor = turnColor(pCast);
    const pBgColor = pColor.includes('emerald') ? 'bg-emerald-500/10' : pColor.includes('sky') ? 'bg-sky-500/10' : pColor.includes('amber') ? 'bg-amber-500/10' : 'bg-red-500/10';
    chips.push({
      key: 'partner',
      label: partnerName.split(',')[0],
      turn: fmt(pCast),
      savedTurns: pSaved,
      color: pColor, bgColor: pBgColor,
      tooltip: pSaved > 0
        ? `${partnerName} ready by turn ${fmt(pCast)}. Ramp saves ${pSaved} turn${pSaved > 1 ? 's' : ''} vs lands alone.`
        : `${partnerName} castable on turn ${fmt(pCast)} on curve.`,
    });
  }

  return chips;
}

export function CommanderCastChips({
  trajectory, commanderCmc, commanderName, partnerCmc, partnerName,
}: {
  trajectory: ManaTrajectoryPoint[];
  commanderCmc?: number;
  commanderName?: string;
  partnerCmc?: number;
  partnerName?: string;
}) {
  const chips = useMemo(
    () => buildCommanderCastChips(trajectory, commanderCmc, commanderName, partnerCmc, partnerName),
    [trajectory, commanderCmc, commanderName, partnerCmc, partnerName],
  );
  if (chips.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {chips.map(chip => (
        <InfoTooltip key={chip.key} text={chip.tooltip}>
          <span
            className={`flex items-center gap-1 text-[10px] font-semibold ${chip.color} ${chip.bgColor} rounded-full px-2 py-0.5 cursor-default leading-none`}
          >
            <Target className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate max-w-[160px]">{chip.label}</span>
            <span>T{chip.turn}</span>
            {chip.savedTurns > 0 && <span className="opacity-60">−{chip.savedTurns}</span>}
          </span>
        </InfoTooltip>
      ))}
    </div>
  );
}

export function ManaTrajectorySparkline({
  trajectory, chartHeight = 140,
}: {
  trajectory: ManaTrajectoryPoint[];
  chartHeight?: number;
}) {
  if (trajectory.length === 0) return null;

  const hasCastData = trajectory.some(t => t.castableCards > 0);

  const chartData = trajectory.map(t => ({
    turnLabel: `T${t.turn}`,
    expectedLandsRaw: t.expectedLandsRaw,
    expectedLands: t.expectedLands,
    tapPenalty: t.tapPenalty,
    totalExpectedMana: t.totalExpectedMana,
    rampMana: t.expectedRampMana,
    landDropProbability: t.landDropProbability,
    castableCards: t.castableCards,
    castablePct: t.castablePct,
    newUnlocks: t.newUnlocks,
  }));

  // Find max ramp turn for annotation
  const maxRampIdx = trajectory.reduce((best, t, i) =>
    t.expectedRampMana > trajectory[best].expectedRampMana ? i : best, 0);
  const maxRampTurn = trajectory[maxRampIdx];

  // Takeaway stats — show observed values, not threshold inferences.
  const finalTurn = trajectory[trajectory.length - 1];
  const t4 = trajectory.find(t => t.turn === 4) ?? trajectory[Math.min(3, trajectory.length - 1)];
  const finalLandDropPct = Math.round(finalTurn.landDropProbability * 100);

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg p-3 flex flex-col">
      <div className="flex flex-col gap-0.5 mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mana Trajectory</span>
          <InfoTooltip text={`Expected mana per turn from lands + ramp.\n` +
            `\n` +
            `Blue — total mana (lands + ramp)\n` +
            `Green dashed — lands only\n` +
            `Gap between them = ramp impact.`} />
          <span className="text-[10px] text-muted-foreground/80 ml-auto flex items-center gap-3 flex-wrap justify-end">
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0 inline-block border-t border-dashed border-emerald-500/50" />
              lands
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 rounded bg-sky-500 inline-block" />
              + ramp
            </span>
          </span>
        </div>
        <div className="flex items-center gap-3 flex-wrap text-[10px] leading-snug">
          <span className="text-foreground/85">
            <span className="text-sky-300 font-semibold tabular-nums">{finalTurn.totalExpectedMana.toFixed(1)}</span>
            <span className="text-muted-foreground/70"> mana by T{finalTurn.turn}</span>
          </span>
          {hasCastData && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-foreground/85">
                <span className="text-purple-300 font-semibold tabular-nums">{Math.round(t4.castablePct * 100)}%</span>
                <span className="text-muted-foreground/70"> spells castable by T{t4.turn}</span>
              </span>
            </>
          )}
          <span className="text-muted-foreground/40">·</span>
          <span className="text-foreground/85">
            <span className="text-emerald-300 font-semibold tabular-nums">{finalLandDropPct}%</span>
            <span className="text-muted-foreground/70"> chance of all land drops</span>
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={chartHeight} debounce={1} className="flex-1 min-h-[120px]">
        <RechartsAreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="turnLabel"
            tick={{ fontSize: 10, fill: 'hsl(220,13%,55%)', fillOpacity: 0.7 }}
            axisLine={false}
            tickLine={false}
            padding={{ left: 8 }}
          />
          <YAxis
            width={24}
            tick={{ fontSize: 9, fill: 'hsl(220,13%,55%)', fillOpacity: 0.6 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => v.toFixed(0)}
            domain={[(dataMin: number) => Math.max(0, Math.floor(dataMin)), (dataMax: number) => Math.ceil(dataMax + 0.5)]}
            allowDecimals={false}
          />
          <Tooltip content={<TrajectoryTooltip />} cursor={false} />

          {/* Area fill under total mana */}
          <Area
            type="monotone"
            dataKey="totalExpectedMana"
            stroke="#0ea5e9"
            strokeWidth={2}
            fill="#0ea5e9"
            fillOpacity={0.22}
            dot={{ r: 3, fill: '#38bdf8', strokeWidth: 0 }}
            activeDot={{ r: 4, fill: '#38bdf8', stroke: '#0ea5e9', strokeWidth: 2 }}
            isAnimationActive
            animationDuration={500}
          />

          {/* Effective lands dashed line */}
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

      {/* Spell readiness strip — % of spells castable each turn. Decoupled
          from the mana chart since percentages and mana units don't share
          a Y axis sensibly. */}
      {hasCastData && (
        <div className="mt-3 pt-2 border-t border-border/30">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Spell Readiness</span>
            <InfoTooltip text="Percent of non-land spells in your deck that are castable with the expected mana on each turn." />
          </div>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${trajectory.length}, minmax(0, 1fr))` }}>
            {trajectory.map(t => {
              const pct = Math.round(t.castablePct * 100);
              const hue = Math.min(120, (pct / 100) * 120);
              return (
                <div key={t.turn} className="flex flex-col items-center gap-1 min-w-0">
                  <div className="w-full h-8 rounded bg-zinc-900/60 border border-border/30 overflow-hidden flex flex-col justify-end">
                    <div
                      className="w-full"
                      style={{ height: `${pct}%`, backgroundColor: `hsl(${hue}, 60%, 50%)`, opacity: 0.55 }}
                    />
                  </div>
                  <div className="text-[9px] text-muted-foreground/70 tabular-nums">T{t.turn}</div>
                  <div className="text-[10px] font-semibold tabular-nums" style={{ color: `hsl(${hue}, 70%, 65%)` }}>{pct}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function CurveFlagStrip({ flags }: { flags: CurveFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {flags.map(flag => {
        const Icon = flag.icon;
        const bg = flag.severity === 'bad' ? 'bg-red-500/10' : 'bg-amber-500/10';
        return (
          <InfoTooltip key={flag.key} text={flag.detail}>
            <span
              className={`flex items-center gap-1 text-[10px] font-medium ${flag.color} ${bg} rounded-full px-2 py-0.5 cursor-default`}
            >
              <Icon className="w-2.5 h-2.5 shrink-0" />
              {flag.title}
            </span>
          </InfoTooltip>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Curve Detail Panel — Two-Column Layout (replaces PhaseCardDisplay)
// ═══════════════════════════════════════════════════════════════════════

/** Left column: grouped card list using the shared CollapsibleCardGroups component. */
function PhaseRoleCardList({
  phases, activeRoleGroups, onPreview, onCardAction, menuProps,
}: {
  phases: CurvePhaseAnalysis[];
  activeRoleGroups: Set<RoleGroupKey>;
  onPreview: (name: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
}) {
  const groups = useMemo(() => {
    // Bucket cards by role group, deduped across phases
    const buckets: Record<RoleGroupKey, AnalyzedCard[]> = { ramp: [], interaction: [], cardDraw: [], other: [] };
    const seen = new Set<string>();
    for (const phase of phases) {
      for (const ac of phase.cards) {
        if (seen.has(ac.card.name)) continue;
        seen.add(ac.card.name);
        const role = ac.card.deckRole || getCardRole(ac.card.name);
        const key: RoleGroupKey =
          role === 'ramp' ? 'ramp' :
          (role === 'removal' || role === 'boardwipe') ? 'interaction' :
          role === 'cardDraw' ? 'cardDraw' :
          'other';
        buckets[key].push(ac);
      }
    }

    // Sub-group by subtype within each role group
    const getSubtypeLabel = (ac: AnalyzedCard, roleGroup: RoleGroupKey): string => {
      const c = ac.card;
      switch (roleGroup) {
        case 'ramp': return SUBTYPE_DISPLAY[c.rampSubtype ?? ''] ?? 'Ramp';
        case 'interaction': return SUBTYPE_DISPLAY[c.removalSubtype ?? c.boardwipeSubtype ?? ''] ?? (c.deckRole === 'boardwipe' ? 'Board Wipe' : 'Removal');
        case 'cardDraw': return SUBTYPE_DISPLAY[c.cardDrawSubtype ?? ''] ?? 'Card Draw';
        default: return 'Other';
      }
    };

    const result: CollapsibleGroup[] = [];
    for (const key of ROLE_GROUP_ORDER) {
      if (!(activeRoleGroups.size === 0 || activeRoleGroups.has(key)) || buckets[key].length === 0) continue;
      const cards = [...buckets[key]].sort((a, b) => a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name));

      if (key === 'other') {
        // "Other" has no meaningful subtypes — keep flat
        const meta = ROLE_GROUP_META[key];
        result.push({
          key,
          label: meta.label,
          count: cards.length,
          content: (
            <div className="space-y-0.5">
              {cards.map(ac => (
                <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showDetails hideChips hidePrice onCardAction={onCardAction} menuProps={menuProps} />
              ))}
            </div>
          ),
        });
      } else {
        // Sub-group by subtype
        const subtypeBuckets = new Map<string, AnalyzedCard[]>();
        for (const ac of cards) {
          const st = getSubtypeLabel(ac, key);
          if (!subtypeBuckets.has(st)) subtypeBuckets.set(st, []);
          subtypeBuckets.get(st)!.push(ac);
        }
        for (const [st, stCards] of subtypeBuckets) {
          result.push({
            key: `${key}:${st}`,
            label: st,
            count: stCards.length,
            content: (
              <div className="space-y-0.5">
                {stCards.map(ac => (
                  <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showDetails hideChips hidePrice onCardAction={onCardAction} menuProps={menuProps} />
                ))}
              </div>
            ),
          });
        }
      }
    }
    return result;
  }, [phases, activeRoleGroups, onPreview, onCardAction, menuProps]);

  const totalCount = groups.reduce((s, g) => s + g.count, 0);

  if (groups.length === 0) {
    return (
      <div className="bg-card/60 border border-border/30 rounded-lg p-4 text-center">
        <p className="text-[11px] text-muted-foreground/60 italic">No cards match the active role filters.</p>
      </div>
    );
  }

  return <CollapsibleCardGroups groups={groups} totalCount={totalCount} />;
}

function buildCurveSuggestions({
  phases, roleBreakdowns, activeRoleGroups, allRecommendations,
}: {
  phases: CurvePhaseAnalysis[];
  roleBreakdowns: RoleBreakdown[];
  activeRoleGroups: Set<RoleGroupKey>;
  allRecommendations?: RecommendedCard[];
}): RecommendedCard[] {
  const TARGET_COUNT = 18;

  const roleKeyMap: Record<RoleGroupKey, string[]> = {
    ramp:        ['ramp'],
    interaction: ['removal', 'boardwipe'],
    cardDraw:    ['cardDraw'],
    other:       [],
  };
  const knownRoles = new Set(['ramp', 'removal', 'boardwipe', 'cardDraw']);

  // Per-role-group deficit, summed across the active phases.
  const phaseDeficits: Record<RoleGroupKey, number> = { ramp: 0, interaction: 0, cardDraw: 0, other: 0 };
  for (const phase of phases) {
    for (const prb of phase.phaseRoleBreakdowns) {
      phaseDeficits[prb.roleGroup] += Math.max(0, prb.deficit);
    }
  }

  // CMC filter: skip entirely when no phase is active (phases array empty).
  // When a phase is active, restrict suggestions to its CMC band, as before.
  const cmcRanges = phases.map(p => p.cmcRange);
  const cmcFilterActive = cmcRanges.length > 0;
  const getCmc = (rec: RecommendedCard): number | undefined => {
    if (rec.cmc != null) return rec.cmc;
    const cached = getCachedCard(rec.name);
    if (cached?.cmc != null) {
      rec.cmc = cached.cmc;
      return cached.cmc;
    }
    return undefined;
  };
  const inRange = (rec: RecommendedCard): boolean => {
    if (!cmcFilterActive) return true;
    const cmc = getCmc(rec);
    if (cmc == null) return false;
    const c = Math.min(Math.floor(cmc), 7);
    return cmcRanges.some(([lo, hi]) => c >= lo && c <= hi);
  };

  // Pool builder per role group.
  const poolFor = (group: RoleGroupKey): RecommendedCard[] => {
    if (group === 'other') {
      return (allRecommendations ?? []).filter(r => !r.role || !knownRoles.has(r.role));
    }
    return roleBreakdowns
      .filter(rb => roleKeyMap[group].includes(rb.role))
      .flatMap(rb => rb.suggestedReplacements);
  };

  const autoMode = activeRoleGroups.size === 0;

  if (autoMode) {
    // Auto mode: deficit-weighted mix across all gap groups.
    const ALL_GROUPS: RoleGroupKey[] = ['ramp', 'interaction', 'cardDraw', 'other'];
    const gapGroups = ALL_GROUPS.filter(g => phaseDeficits[g] > 0);
    const totalDeficit = gapGroups.reduce((s, g) => s + phaseDeficits[g], 0);

    if (totalDeficit === 0) return [];

    // Initial proportional slot allocation, min 1 per gap group.
    const slots: Record<RoleGroupKey, number> = { ramp: 0, interaction: 0, cardDraw: 0, other: 0 };
    for (const g of gapGroups) {
      slots[g] = Math.max(1, Math.round((TARGET_COUNT * phaseDeficits[g]) / totalDeficit));
    }

    // Rebalance to exactly TARGET_COUNT.
    const sumSlots = () => gapGroups.reduce((s, g) => s + slots[g], 0);
    while (sumSlots() > TARGET_COUNT) {
      // Trim the group with the most slots (ties broken by smallest deficit).
      let best: RoleGroupKey | null = null;
      for (const g of gapGroups) {
        if (slots[g] <= 1) continue;
        if (!best
            || slots[g] > slots[best]
            || (slots[g] === slots[best] && phaseDeficits[g] < phaseDeficits[best])) {
          best = g;
        }
      }
      if (!best) break;
      slots[best]--;
    }
    while (sumSlots() < TARGET_COUNT) {
      // Grow the group with the largest deficit.
      let best: RoleGroupKey | null = null;
      for (const g of gapGroups) {
        if (!best || phaseDeficits[g] > phaseDeficits[best]) best = g;
      }
      if (!best) break;
      slots[best]++;
    }

    // Fill each group's quota from its pool, deduping across all groups.
    const seen = new Set<string>();
    const perGroupPicks: Record<RoleGroupKey, RecommendedCard[]> = {
      ramp: [], interaction: [], cardDraw: [], other: [],
    };
    // Process in deficit-descending order so larger deficits win dedupe conflicts.
    const orderedGaps = [...gapGroups].sort((a, b) => phaseDeficits[b] - phaseDeficits[a]);
    for (const g of orderedGaps) {
      const pool = poolFor(g)
        .filter(inRange)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      for (const rec of pool) {
        if (perGroupPicks[g].length >= slots[g]) break;
        if (seen.has(rec.name)) continue;
        seen.add(rec.name);
        perGroupPicks[g].push(rec);
      }
    }

    // Concatenate worst-deficit group first.
    const result: RecommendedCard[] = [];
    for (const g of orderedGaps) result.push(...perGroupPicks[g]);
    return result;
  }

  // Filtered mode (existing behavior): user picked at least one role group.
  const activeGroups = ROLE_GROUP_ORDER
    .filter(k => activeRoleGroups.has(k) && k !== 'other' && roleKeyMap[k].length > 0)
    .sort((a, b) => phaseDeficits[b] - phaseDeficits[a]);

  const seen = new Map<string, RecommendedCard>();

  for (const group of activeGroups) {
    const pool = poolFor(group);
    const filtered = pool.filter(inRange);
    for (const rec of filtered) {
      const existing = seen.get(rec.name);
      if (!existing || (rec.score ?? 0) > (existing.score ?? 0)) {
        seen.set(rec.name, rec);
      }
    }
  }

  if (activeRoleGroups.has('other') && allRecommendations) {
    const filtered = poolFor('other').filter(inRange);
    for (const rec of filtered) {
      if (!seen.has(rec.name)) seen.set(rec.name, rec);
    }
  }

  if (seen.size === 0) {
    for (const group of activeGroups) {
      const pool = poolFor(group);
      for (const rec of pool) {
        if (!seen.has(rec.name) && inRange(rec)) seen.set(rec.name, rec);
      }
    }
  }

  const result = Array.from(seen.values());
  result.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return result.slice(0, TARGET_COUNT);
}

// Map a deck card's deckRole to the phase role group it counts toward.
function curveRoleGroupOf(role: string | undefined): RoleGroupKey {
  if (role === 'ramp') return 'ramp';
  if (role === 'removal' || role === 'boardwipe') return 'interaction';
  if (role === 'cardDraw') return 'cardDraw';
  return 'other';
}

function buildCurveCuts({
  phases, activeRoleGroups,
}: {
  phases: CurvePhaseAnalysis[];
  activeRoleGroups: Set<RoleGroupKey>;
}): AnalyzedCard[] {
  const ALL_GROUPS: RoleGroupKey[] = ['ramp', 'interaction', 'cardDraw', 'other'];

  // Excess per role group, summed across active phases.
  const phaseExcesses: Record<RoleGroupKey, number> = {
    ramp: 0, interaction: 0, cardDraw: 0, other: 0,
  };
  for (const phase of phases) {
    for (const prb of phase.phaseRoleBreakdowns) {
      phaseExcesses[prb.roleGroup] += Math.max(0, prb.current - prb.target);
    }
  }

  const autoMode = activeRoleGroups.size === 0;
  const candidateGroups = ALL_GROUPS.filter(g => {
    if (phaseExcesses[g] <= 0) return false;
    if (!autoMode && !activeRoleGroups.has(g)) return false;
    return true;
  });

  const totalExcess = candidateGroups.reduce((s, g) => s + phaseExcesses[g], 0);
  if (totalExcess === 0) return [];

  // Cap total cuts at min(18, totalExcess) — never suggest more cuts than there is actual surplus.
  const TARGET = Math.min(18, totalExcess);

  // Proportional slot allocation, min 1 per group, rebalanced to exactly TARGET.
  const slots: Record<RoleGroupKey, number> = {
    ramp: 0, interaction: 0, cardDraw: 0, other: 0,
  };
  for (const g of candidateGroups) {
    slots[g] = Math.max(1, Math.round((TARGET * phaseExcesses[g]) / totalExcess));
  }
  const sumSlots = () => candidateGroups.reduce((s, g) => s + slots[g], 0);
  while (sumSlots() > TARGET) {
    let best: RoleGroupKey | null = null;
    for (const g of candidateGroups) {
      if (slots[g] <= 1) continue;
      if (!best
          || slots[g] > slots[best]
          || (slots[g] === slots[best] && phaseExcesses[g] < phaseExcesses[best])) {
        best = g;
      }
    }
    if (!best) break;
    slots[best]--;
  }
  while (sumSlots() < TARGET) {
    let best: RoleGroupKey | null = null;
    for (const g of candidateGroups) {
      if (!best || phaseExcesses[g] > phaseExcesses[best]) best = g;
    }
    if (!best) break;
    slots[best]++;
  }

  // Build the candidate pool per group: all deck cards across active phases
  // whose role group matches, sorted by score ASC (lowest = best cut).
  const cutScore = (ac: AnalyzedCard): number => ac.score ?? ac.inclusion ?? 0;

  const poolFor = (group: RoleGroupKey): AnalyzedCard[] => {
    const pool: AnalyzedCard[] = [];
    const seen = new Set<string>();
    for (const phase of phases) {
      for (const ac of phase.cards) {
        if (curveRoleGroupOf(ac.card.deckRole) !== group) continue;
        if (seen.has(ac.card.name)) continue;
        seen.add(ac.card.name);
        pool.push(ac);
      }
    }
    pool.sort((a, b) => cutScore(a) - cutScore(b));
    return pool;
  };

  // Fill each group's quota, deduping across groups (lowest-score wins).
  const taken = new Set<string>();
  const perGroup: Record<RoleGroupKey, AnalyzedCard[]> = {
    ramp: [], interaction: [], cardDraw: [], other: [],
  };
  const orderedExcess = [...candidateGroups].sort(
    (a, b) => phaseExcesses[b] - phaseExcesses[a]
  );
  for (const g of orderedExcess) {
    const pool = poolFor(g);
    for (const ac of pool) {
      if (perGroup[g].length >= slots[g]) break;
      if (taken.has(ac.card.name)) continue;
      taken.add(ac.card.name);
      perGroup[g].push(ac);
    }
  }

  const result: AnalyzedCard[] = [];
  for (const g of orderedExcess) result.push(...perGroup[g]);
  return result;
}

function sumCurveExcess(
  phases: CurvePhaseAnalysis[],
  activeRoleGroups: Set<RoleGroupKey>,
): number {
  let total = 0;
  for (const phase of phases) {
    for (const prb of phase.phaseRoleBreakdowns) {
      if (activeRoleGroups.size === 0 || activeRoleGroups.has(prb.roleGroup)) {
        total += Math.max(0, prb.current - prb.target);
      }
    }
  }
  return total;
}

/** Right column: suggestion card grid — matches Roles/Lands tab format. */
function CurveSuggestionPanel({
  phases, roleBreakdowns, activeRoleGroups, addedCards, onAdd, onPreview, onCardAction, menuProps, allRecommendations,
}: {
  phases: CurvePhaseAnalysis[];
  roleBreakdowns: RoleBreakdown[];
  activeRoleGroups: Set<RoleGroupKey>;
  addedCards: Set<string>;
  onAdd: (name: string) => void;
  onPreview: (name: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
  allRecommendations?: RecommendedCard[];
}) {
  const suggestions = useMemo(() =>
    buildCurveSuggestions({ phases, roleBreakdowns, activeRoleGroups, allRecommendations }),
    [phases, roleBreakdowns, activeRoleGroups, allRecommendations]
  );

  const cuts = useMemo(() =>
    buildCurveCuts({ phases, activeRoleGroups }),
    [phases, activeRoleGroups]
  );

  const totalDeficit = useMemo(() => {
    let d = 0;
    for (const phase of phases) {
      for (const prb of phase.phaseRoleBreakdowns) {
        if (activeRoleGroups.size === 0 || activeRoleGroups.has(prb.roleGroup)) {
          d += Math.max(0, prb.deficit);
        }
      }
    }
    return d;
  }, [phases, activeRoleGroups]);

  const totalExcess = useMemo(() =>
    sumCurveExcess(phases, activeRoleGroups),
    [phases, activeRoleGroups]
  );

  // Initial tab: pick whichever side has more impact on the grade.
  // Sticky for the session — flipping it stays flipped.
  const [showCuts, setShowCuts] = useState(
    () => cuts.length > 0 && totalExcess > totalDeficit
  );

  const [removedCards, setRemovedCards] = useState<Set<string>>(new Set());

  const isAuto = activeRoleGroups.size === 0;
  const cutsPrefix = isAuto ? 'Top ' : '';
  const sugPrefix = cutsPrefix;
  const phaseLabel = phases.length === 1 ? `${phases[0].label} ` : '';

  const suggestionsTitle = <>{phaseLabel}{sugPrefix}Suggestions ({suggestions.length})</>;
  const cutsTitle = <>Recommended {phaseLabel}{cutsPrefix}Cuts ({cuts.length})</>;

  const handleCutAll = useCallback(() => {
    for (const ac of cuts) {
      if (removedCards.has(ac.card.name)) continue;
      onCardAction?.(ac.card, { type: 'remove' });
    }
    setRemovedCards(prev => {
      const next = new Set(prev);
      for (const ac of cuts) next.add(ac.card.name);
      return next;
    });
  }, [cuts, removedCards, onCardAction]);

  const bothAvailable = cuts.length > 0 && suggestions.length > 0;

  // Empty case — nothing to suggest or cut.
  if (cuts.length === 0 && suggestions.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 rounded-lg border border-border/20 bg-card/40">
        <p className="text-xs text-muted-foreground/60 text-center px-4">
          {totalDeficit === 0 && totalExcess === 0
            ? 'Role coverage looks solid for the selected filters.'
            : 'No suggestions or cuts available for the active filters.'}
        </p>
      </div>
    );
  }

  // Effective view — if only one side has data, force that side regardless of toggle.
  const effectiveShowCuts = bothAvailable ? showCuts : cuts.length > 0;

  return (
    <div>
      {bothAvailable && (
        <div className="mb-2 px-0.5">
          <div className="flex items-center gap-2">
            {effectiveShowCuts && (
              <span className="text-xs text-red-400/60">{totalExcess} over target</span>
            )}
            <div className="flex items-center border border-border/50 rounded-md overflow-hidden ml-auto">
              <button
                onClick={() => setShowCuts(true)}
                className={`flex items-center gap-1 text-[10px] px-2 py-0.5 transition-colors ${effectiveShowCuts ? 'bg-red-500/15 text-red-400 font-medium' : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/50'}`}
              >
                <Scissors className="w-2.5 h-2.5" />
                Cuts ({cuts.length})
              </button>
              <div className="w-px h-3 bg-border/50" />
              <button
                onClick={() => setShowCuts(false)}
                className={`flex items-center gap-1 text-[10px] px-2 py-0.5 transition-colors ${!effectiveShowCuts ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/50'}`}
              >
                <Sparkles className="w-2.5 h-2.5" />
                Suggestions ({suggestions.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {effectiveShowCuts ? (
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-2 mb-3">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-red-400/80">
              {cutsTitle}
            </p>
            <button
              onClick={handleCutAll}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded border border-red-500/30 text-red-400/80 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Scissors className="w-2.5 h-2.5" />
              Cut all
            </button>
          </div>
          <CutCardGrid
            cards={cuts}
            onRemove={(card) => {
              onCardAction?.(card, { type: 'remove' });
              setRemovedCards(prev => new Set([...prev, card.name]));
            }}
            onPreview={onPreview}
            removedCards={removedCards}
            excess={cuts.length}
            onCardAction={onCardAction}
            menuProps={menuProps}
            sortMode="score"
          />
        </div>
      ) : (
        <SuggestionCardGrid
          title={suggestionsTitle}
          cards={suggestions}
          onAdd={onAdd}
          onPreview={onPreview}
          addedCards={addedCards}
          deficit={totalDeficit}
          onCardAction={onCardAction}
          menuProps={menuProps}
        />
      )}
    </div>
  );
}

/** Small helper card shown above the deck list — explains the active phase/role context. */
function CurvePhaseHelperCard({
  phases, activeRoleGroups,
}: {
  phases: CurvePhaseAnalysis[];
  activeRoleGroups: Set<RoleGroupKey>;
}) {
  if (phases.length === 0) return null;
  const phase = phases[0];
  const phaseLabel = phase.label.split(' ')[0];

  // If exactly one role group is selected, show that role's context. Otherwise
  // show every role's context for the active phase as a compact list.
  const singleRole = activeRoleGroups.size === 1 ? Array.from(activeRoleGroups)[0] : null;

  // Resolve grade: per-role when a single role is active, otherwise the phase's overall grade.
  let grade: string;
  if (singleRole) {
    const prb = phase.phaseRoleBreakdowns.find(r => r.roleGroup === singleRole);
    grade = prb ? getRoleGroupGrade(prb.current, prb.target) : phase.grade.letter;
  } else {
    grade = phase.grade.letter;
  }
  const gs = tileGradeStyles(grade);

  return (
    <div className="mb-3 -mx-3 sm:-mx-4 -mt-3 px-3 sm:px-4 pt-3 pb-3 border-b border-border/30">
      <div className={`border rounded-lg p-2.5 ${gs.border} ${gs.bg}`}>
        <div className="flex items-center gap-3">
          <div className={`flex items-center justify-center w-12 h-12 rounded-lg ${gs.bgColor} shrink-0`}>
            <span className={`text-2xl font-black leading-none ${gs.color}`}>{grade}</span>
          </div>
          <div className="flex-1 min-w-0">
            {singleRole ? (() => {
              const meta = ROLE_GROUP_META[singleRole];
              return (
                <p className="text-xs text-foreground/85 leading-snug">
                  <span className="font-semibold">{phaseLabel} {meta.label}</span>
                  <span className="text-muted-foreground/70"> — {PHASE_ROLE_CONTEXT[phase.phase][singleRole]}</span>
                </p>
              );
            })() : (
              <p className="text-xs text-foreground/85 leading-snug">
                {buildPhaseRollup(phase)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Tip card shown when no phase is selected — surfaces the overall tempo grade. */
export function CurveOverallGradeTip({
  grade, phases,
}: {
  grade: GradeResult;
  phases: CurvePhaseAnalysis[];
}) {
  const gs = tileGradeStyles(grade.letter);
  return (
    <div className={`border rounded-lg p-4 ${gs.border} ${gs.bg}`}>
      <div className="flex items-center gap-4">
        <div className={`flex items-center justify-center w-16 h-16 rounded-lg ${gs.bgColor} shrink-0`}>
          <span className={`text-3xl font-black leading-none ${gs.color}`}>{grade.letter}</span>
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Overall Tempo</p>
          <p className="text-sm text-foreground/85 leading-snug">{grade.message}</p>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70 pt-0.5">
            {phases.map(p => {
              const pgs = tileGradeStyles(p.grade.letter);
              return (
                <span key={p.phase} className="flex items-center gap-1">
                  <span className="text-muted-foreground/60">{p.label.split(' ')[0]}</span>
                  <span className={`font-bold ${pgs.color}`}>{p.grade.letter}</span>
                </span>
              );
            })}
            <span className="ml-auto italic text-muted-foreground/50">Select a phase to drill in</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Two-column panel: left = grouped deck card list, right = suggestions grid. */
export function CurveDetailPanel({
  phases, roleBreakdowns, activeRoleGroups,
  addedCards, onAdd, onPreview, onCardAction, menuProps, allRecommendations,
}: {
  phases: CurvePhaseAnalysis[];
  roleBreakdowns: RoleBreakdown[];
  activeRoleGroups: Set<RoleGroupKey>;
  addedCards: Set<string>;
  onAdd: (name: string) => void;
  onPreview: (name: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
  allRecommendations?: RecommendedCard[];
}) {
  const showSuggestions = true;
  const aurora = auroraForCurveContext(phases, activeRoleGroups);
  return (
    <div
      className="-mx-3 sm:-mx-4 -mb-3 sm:-mb-4 bg-black/15 px-3 sm:px-4 py-3 transition-[background-image] duration-500"
      style={{ marginTop: 0, ...(aurora ? { backgroundImage: aurora } : {}) }}
    >
      <div className={`${showSuggestions ? 'flex flex-col md:flex-row md:items-stretch gap-4' : ''}`}>
        {/* Left column: grouped card list */}
        <div className={showSuggestions ? 'md:w-[30%] shrink-0' : 'w-full'}>
          <CurvePhaseHelperCard phases={phases} activeRoleGroups={activeRoleGroups} />
          <PhaseRoleCardList
            phases={phases}
            activeRoleGroups={activeRoleGroups}
            onPreview={onPreview}
            onCardAction={onCardAction}
            menuProps={menuProps}
          />
        </div>

        {/* Vertical divider */}
        {showSuggestions && (
          <div className="hidden md:block w-px bg-border/30 shrink-0 -my-3" />
        )}

        {/* Right column: suggestions grid */}
        {showSuggestions && (
          <div className="flex-1 min-w-0">
            <CurveSuggestionPanel
              phases={phases}
              roleBreakdowns={roleBreakdowns}
              activeRoleGroups={activeRoleGroups}
              addedCards={addedCards}
              onAdd={onAdd}
              onPreview={onPreview}
              onCardAction={onCardAction}
              menuProps={menuProps}
              allRecommendations={allRecommendations}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Aurora gradient tinted by active role group (if one is selected) or by phase identity.
function auroraForCurveContext(
  phases: CurvePhaseAnalysis[],
  activeRoleGroups: Set<RoleGroupKey>,
): string | undefined {
  if (phases.length === 0) return undefined;

  const roleRgb: Record<RoleGroupKey, string> = {
    ramp:        '16,185,129',  // emerald
    interaction: '244,63,94',   // rose
    cardDraw:    '14,165,233',  // sky
    other:       '148,163,184', // slate
  };
  const phaseRgb: Record<CurvePhase, string> = {
    early: '14,165,233',   // sky
    mid:   '245,158,11',   // amber
    late:  '168,85,247',   // violet
  };

  let rgb: string | undefined;
  if (activeRoleGroups.size === 1) {
    const role = Array.from(activeRoleGroups)[0];
    rgb = roleRgb[role];
  } else {
    rgb = phaseRgb[phases[0].phase];
  }
  if (!rgb) return undefined;
  return `radial-gradient(ellipse 80% 60% at 15% 0%, rgba(${rgb},0.05), transparent 60%), radial-gradient(ellipse 70% 55% at 90% 100%, rgba(${rgb},0.035), transparent 60%)`;
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
  if (!useRamp) {
    // Baseline: 1 land per turn (intuitive expectation — without ramp, a 5 CMC card comes down T5)
    return Math.min(Math.ceil(cmc), maxTurn + 1);
  }
  for (let t = 1; t <= maxTurn; t++) {
    if (getManaAtTurn(trajectory, t, true) >= cmc) return t;
  }
  return maxTurn + 1; // beyond our range
}

function turnColor(turn: number): string {
  if (turn <= 3) return 'text-emerald-400';
  if (turn <= 5) return 'text-sky-400';
  if (turn <= 7) return 'text-amber-400';
  return 'text-red-400';
}

