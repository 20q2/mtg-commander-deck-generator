import { useState, useMemo, useCallback } from 'react';
import {
  ComposedChart, AreaChart as RechartsAreaChart,
  Line, Area, Bar, Cell,
  XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { ChevronDown, ChevronRight, X, Zap, Target, Crown, Sparkles, Sprout, Lightbulb, AlertTriangle, Swords, Mountain, Dices, Shuffle, Layers, ArrowUpDown } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import type { CurvePhaseAnalysis, CurvePhase, CurveSlot, CurveBreakdown, ManaTrajectoryPoint, AnalyzedCard, RecommendedCard, ManaSourcesAnalysis, RoleBreakdown } from '@/services/deckBuilder/deckAnalyzer';
import { PACING_MULTIPLIERS, computeHandStats } from '@/services/deckBuilder/deckAnalyzer';
import type { Pacing } from '@/services/deckBuilder/themeDetector';
import { getFrontFaceTypeLine, getCachedCard } from '@/services/scryfall/client';
import { PACING_LABELS, PHASE_META, tileGradeStyles } from './constants';
import { AnalyzedCardRow, CollapsibleCardGroups, type CardAction, type CardRowMenuProps } from './shared';
import { SuggestionCardGrid } from './OverviewTab';
import { useStore } from '@/store';
import { ManaCost } from '@/components/ui/mtg-icons';
import { InfoTooltip } from '@/components/ui/info-tooltip';

// ═══════════════════════════════════════════════════════════════════════
// Curve Tab Components
// ═══════════════════════════════════════════════════════════════════════

const ROLE_SHORT_LABEL: Record<RoleGroupKey, string> = {
  ramp:        'RAMP',
  interaction: 'REMOVAL',
  cardDraw:    'DRAW',
  other:       'OTHER',
};

function getRoleGroupGrade(current: number, target: number): string {
  if (target === 0) return current > 0 ? 'A' : '-';
  if (current >= target) return 'A';
  const deficit = (target - current) / target;
  if (deficit <= 0.15) return 'B';
  if (deficit <= 0.30) return 'C';
  if (deficit <= 0.50) return 'D';
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
    <div className="-mx-3 sm:-mx-4 border-t border-b border-border/30">
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

      {/* Role filter row — 4 buttons, grades + counts from the active phase */}
      <div className="grid grid-cols-4 border-t border-border/30">
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
              <div className="flex items-center gap-1 mb-1">
                <roleMeta.icon className={`w-3 h-3 shrink-0 transition-colors duration-200 ${isRoleActive ? roleMeta.color : 'text-muted-foreground'}`} />
                <span className={`text-[9px] font-semibold uppercase tracking-wide leading-none transition-colors duration-200 ${isRoleActive ? 'text-white' : 'text-muted-foreground'}`}>
                  {activePhase ? `${activePhase.label.split(' ')[0]} ` : ''}{ROLE_SHORT_LABEL[roleKey]}
                </span>
                <span className={`text-[10px] font-black ml-auto px-1 py-px rounded transition-colors duration-200 ${gradeGs.color} ${isRoleActive ? gradeGs.bgColor : 'bg-muted/30'}`}>
                  {grade}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-1 mb-1">
                <span className={`text-base font-bold tabular-nums leading-none ${gradeGs.color}`}>
                  {prb?.current ?? 0}
                </span>
                <span className="text-[9px] text-muted-foreground tabular-nums leading-none">
                  {prb?.target ?? 0} suggested
                </span>
              </div>
              {activePhase && (
                <p className="text-[9px] text-muted-foreground/70 leading-snug">
                  {PHASE_ROLE_CONTEXT[activePhase.phase][roleKey]}
                </p>
              )}
            </button>
          );
        })}
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
    <div className="bg-card/60 border border-border/30 rounded-lg p-3 flex flex-col">
      <div className="flex flex-col gap-0.5 mb-1">
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
        <span className="text-[10px] text-muted-foreground/80 leading-snug">
          Card count at each mana cost vs. the expected distribution for your commander{pacing && pacing !== 'balanced' ? ` (${PACING_LABELS[pacing]} tempo)` : ''}{onCmcClick ? ' · Click a mana value to see cards' : ''}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={chartHeight} debounce={1} className="flex-1 min-h-[120px] [&_*:focus-visible]:outline-none [&_*:focus]:outline-none">
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

export function ManaTrajectorySparkline({
  trajectory, commanderCmc, commanderName, partnerCmc, partnerName, chartHeight = 140,
}: {
  trajectory: ManaTrajectoryPoint[];
  commanderCmc?: number;
  commanderName?: string;
  partnerCmc?: number;
  partnerName?: string;
  chartHeight?: number;
}) {
  if (trajectory.length === 0) return null;

  const hasTapPenalty = trajectory.some(t => t.tapPenalty > 0);
  const hasCastData = trajectory.some(t => t.castableCards > 0);

  // Commander cast-turn chips
  const commanderChips = useMemo(() => {
    if (!commanderCmc || !commanderName) return [];
    const fmt = (t: number) => Math.min(t, 12);
    const chips: Array<{ key: string; label: string; turn: number; savedTurns: number; color: string; bgColor: string; tooltip: string }> = [];

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
  }, [trajectory, commanderCmc, commanderName, partnerCmc, partnerName]);

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

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg p-3 flex flex-col">
      <div className="flex flex-col gap-0.5 mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mana Trajectory</span>
          <InfoTooltip text={`Expected mana per turn from lands + ramp.\n` +
            `\n` +
            `Green — lands only\n` +
            `Blue — total with ramp\n` +
            (hasTapPenalty ? `Amber — before tapland penalty\n` : '') +
            (hasCastData ? `Purple — % of spells castable\n` : '') +
            `\n` +
            `Steeper blue = faster acceleration.\n` +
            `Green-to-blue gap = ramp impact.`} />
          {commanderChips.length > 0 && (
            <div className="flex items-center gap-1.5 ml-1">
              {commanderChips.map(chip => (
                <InfoTooltip key={chip.key} text={chip.tooltip}>
                  <span
                    className={`flex items-center gap-1 text-[10px] font-semibold ${chip.color} ${chip.bgColor} rounded px-1.5 py-0.5 cursor-default leading-none`}
                  >
                    <Target className="w-2.5 h-2.5 shrink-0" />
                    <span className="hidden sm:inline truncate max-w-[80px]">{chip.label}</span>
                    <span>T{chip.turn}</span>
                    {chip.savedTurns > 0 && <span className="opacity-60">−{chip.savedTurns}</span>}
                  </span>
                </InfoTooltip>
              ))}
            </div>
          )}
          <span className="text-[10px] text-muted-foreground/80 ml-auto flex items-center gap-3 flex-wrap justify-end">
            {hasTapPenalty && (
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-0 inline-block border-t border-dotted border-amber-500/40" />
                pre-tap
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0 inline-block border-t border-dashed border-emerald-500/50" />
              lands
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 rounded bg-sky-500 inline-block" />
              + ramp
            </span>
            {hasCastData && (
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-0.5 rounded bg-purple-500/40 inline-block" />
                castable %
              </span>
            )}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/80 leading-snug">
          Expected mana per turn · hover for land drop odds, castable spells{hasTapPenalty ? ', tapland penalty' : ''}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={chartHeight} debounce={1} className="flex-1 min-h-[120px]">
        <RechartsAreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="turnLabel"
            tick={{ fontSize: 10, fill: 'hsl(220,13%,55%)', fillOpacity: 0.6 }}
            axisLine={false}
            tickLine={false}
            padding={{ left: 8 }}
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

          {/* Pre-tap-penalty lands line (only when taplands exist) */}
          {hasTapPenalty && (
            <Line
              type="monotone"
              dataKey="expectedLandsRaw"
              stroke="rgba(245,158,11,0.35)"
              strokeWidth={1}
              strokeDasharray="2 3"
              dot={false}
              isAnimationActive
              animationDuration={500}
            />
          )}

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

          {/* Castable % as subtle area on secondary axis (normalized to fit chart) */}
          {hasCastData && (
            <Area
              type="monotone"
              dataKey="castablePct"
              stroke="rgba(168,85,247,0.3)"
              strokeWidth={1}
              fill="rgba(168,85,247,0.06)"
              dot={false}
              yAxisId="right"
              isAnimationActive
              animationDuration={500}
            />
          )}
          {hasCastData && <YAxis yAxisId="right" hide domain={[0, 1]} />}

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
        const role = ac.card.deckRole;
        const key: RoleGroupKey =
          role === 'ramp' ? 'ramp' :
          (role === 'removal' || role === 'boardwipe') ? 'interaction' :
          role === 'cardDraw' ? 'cardDraw' :
          'other';
        buckets[key].push(ac);
      }
    }

    return ROLE_GROUP_ORDER
      .filter(key => (activeRoleGroups.size === 0 || activeRoleGroups.has(key)) && buckets[key].length > 0)
      .map(key => {
        const cards = [...buckets[key]].sort((a, b) => a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name));
        const meta = ROLE_GROUP_META[key];
        return {
          key,
          label: meta.label,
          count: cards.length,
          content: (
            <div className="space-y-0.5">
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
          ),
        };
      });
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
  const roleKeyMap: Record<RoleGroupKey, string[]> = {
    ramp:        ['ramp'],
    interaction: ['removal', 'boardwipe'],
    cardDraw:    ['cardDraw'],
    other:       [],
  };
  const knownRoles = new Set(['ramp', 'removal', 'boardwipe', 'cardDraw']);

  // Collect phase deficit per role group
  const phaseDeficits: Record<RoleGroupKey, number> = { ramp: 0, interaction: 0, cardDraw: 0, other: 0 };
  for (const phase of phases) {
    for (const prb of phase.phaseRoleBreakdowns) {
      phaseDeficits[prb.roleGroup] += Math.max(0, prb.deficit);
    }
  }

  // CMC ranges of selected phases (for filtering suggestions by CMC)
  const cmcRanges = phases.map(p => p.cmcRange);
  const getCmc = (rec: RecommendedCard): number | undefined => {
    if (rec.cmc != null) return rec.cmc;
    // Fallback: look up from Scryfall cache (populated during enrichment)
    const cached = getCachedCard(rec.name);
    if (cached?.cmc != null) {
      rec.cmc = cached.cmc; // memoize for future calls
      return cached.cmc;
    }
    return undefined;
  };
  const inRange = (rec: RecommendedCard) => {
    const cmc = getCmc(rec);
    if (cmc == null) return false;
    const c = Math.min(Math.floor(cmc), 7);
    return cmcRanges.some(([lo, hi]) => c >= lo && c <= hi);
  };

  // Gather suggestions, ordered by biggest deficit first
  const activeGroups = ROLE_GROUP_ORDER
    .filter(k => activeRoleGroups.has(k) && k !== 'other' && roleKeyMap[k].length > 0)
    .sort((a, b) => phaseDeficits[b] - phaseDeficits[a]);

  const seen = new Map<string, RecommendedCard>();

  for (const group of activeGroups) {
    const pool = roleBreakdowns
      .filter(rb => roleKeyMap[group].includes(rb.role))
      .flatMap(rb => rb.suggestedReplacements);

    const filtered = pool.filter(r => inRange(r));

    for (const rec of filtered) {
      const existing = seen.get(rec.name);
      if (!existing || (rec.score ?? 0) > (existing.score ?? 0)) {
        seen.set(rec.name, rec);
      }
    }
  }

  // "Other" group: cards without ramp/removal/boardwipe/cardDraw roles
  if (activeRoleGroups.has('other') && allRecommendations) {
    const otherPool = allRecommendations.filter(r => !r.role || !knownRoles.has(r.role));
    const filtered = otherPool.filter(r => inRange(r));
    for (const rec of filtered) {
      if (!seen.has(rec.name)) seen.set(rec.name, rec);
    }
  }

  // If nothing found with deficits, pull all (still respecting CMC range)
  if (seen.size === 0) {
    for (const group of activeGroups) {
      const pool = roleBreakdowns
        .filter(rb => roleKeyMap[group].includes(rb.role))
        .flatMap(rb => rb.suggestedReplacements);
      for (const rec of pool) {
        if (!seen.has(rec.name) && inRange(rec)) seen.set(rec.name, rec);
      }
    }
  }

  // Sort by relevance score (SuggestionCardGrid handles user-facing sort toggle)
  const result = Array.from(seen.values());
  result.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return result.slice(0, 18);
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

  const totalDeficit = useMemo(() => {
    let d = 0;
    for (const phase of phases) {
      for (const prb of phase.phaseRoleBreakdowns) {
        if (activeRoleGroups.has(prb.roleGroup)) d += Math.max(0, prb.deficit);
      }
    }
    return d;
  }, [phases, activeRoleGroups]);

  const title = phases.length === 1
    ? <>{phases[0].label} Suggestions ({suggestions.length})</>
    : <>Suggestions ({suggestions.length})</>;

  if (suggestions.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 rounded-lg border border-border/20 bg-card/40">
        <p className="text-xs text-muted-foreground/60 text-center px-4">
          {totalDeficit === 0
            ? 'Role coverage looks solid for the selected filters.'
            : 'No suggestions available for the active filters.'}
        </p>
      </div>
    );
  }

  return (
    <SuggestionCardGrid
      title={title}
      cards={suggestions}
      onAdd={onAdd}
      onPreview={onPreview}
      addedCards={addedCards}
      deficit={totalDeficit}
      onCardAction={onCardAction}
      menuProps={menuProps}
    />
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
  const showSuggestions = activeRoleGroups.size > 0;
  return (
    <div className={`${showSuggestions ? 'flex flex-col md:flex-row md:items-stretch gap-4' : ''}`}>
      {/* Left column: grouped card list */}
      <div className={showSuggestions ? 'md:w-[30%] shrink-0' : 'w-full'}>
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
  card, trajectory,
}: {
  card: ScryfallCard;
  trajectory: ManaTrajectoryPoint[];
  rampCount?: number;
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
  currentCards, deckSize, landCount, rampCount, removalCount, taplandCount = 0,
}: {
  currentCards: ScryfallCard[];
  deckSize: number;
  landCount: number;
  rampCount: number;
  taplandCount?: number;
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
    const tappedLands = lands.filter(c => c.isTapland).length;
    const hasEarlyPlay = earlyPlays.length > 0;
    const keep = lc >= 2 && lc <= 4 && hasEarlyPlay;

    let reason = '';
    if (lc < 2) reason = `Only ${lc} land${lc === 1 ? '' : 's'} — likely mana screwed`;
    else if (lc > 4) reason = `${lc} lands — heavy on mana, light on action`;
    else if (!hasEarlyPlay) reason = `No plays under CMC 4 — slow start`;
    else {
      const landStr = tappedLands > 0 ? `${lc} lands (${tappedLands} tapped)` : `${lc} lands`;
      const parts: string[] = [landStr];
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
  const expectedTaplands = taplandCount > 0 ? Math.round((7 * taplandCount / deckSize) * 10) / 10 : 0;
  const compBars = [
    { label: 'Lands', value: stats.expectedLands, max: 7, color: 'bg-amber-500', textColor: 'text-amber-400/80' },
    ...(taplandCount > 0 ? [{ label: 'Tapped', value: expectedTaplands, max: 7, color: 'bg-amber-700', textColor: 'text-amber-500/60' }] : []),
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
