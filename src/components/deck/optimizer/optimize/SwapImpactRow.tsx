import { isValidElement, useRef, type ReactNode } from 'react';
import { BarChart3, DollarSign, Gauge, Mountain, Scissors, Shield, TrendingUp, Zap } from 'lucide-react';
import { Portal as TooltipPortal } from '@radix-ui/react-tooltip';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { SwapImpact, RoleShift } from '@/services/deckBuilder/swapImpact';
import type { DetectedCombo } from '@/types';
import { BRACKET_HEX } from '../bracket/bracketViewModel';
import { BRACKET_LABELS } from '../constants';

// Version C of the impact-strip mock-ups ("Instruments", user pick 2026-10-27): the plan score on
// its 0–100 track, the bracket ladder, and each changed role against its minimum, all drawn to
// scale, then the remaining effects as one line. A lane only appears when the selection moves it.
// Colours are the Inspector's: lavender points, emerald money and met minimums, rose leaving,
// amber shortfalls, bracket hues for brackets. Rail icons name the tab each figure comes from.

/**
 * Tooltip content rendered at the document root. The strip clips its lanes and cells (that clipping
 * is what lets them animate open and shut), so a tooltip rendered in place is cut off at the
 * strip's edge. Same pattern and look as the Overview score ring's tips.
 */
function Tip({ children }: { children: ReactNode }) {
  return (
    <TooltipPortal>
      <TooltipContent
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        className="max-w-xs border border-border/70 bg-popover px-3 py-2 text-xs text-popover-foreground shadow-[0_8px_24px_-8px_rgb(0_0_0/0.6)]"
      >
        {children}
      </TooltipContent>
    </TooltipPortal>
  );
}

const LAVENDER = 'text-violet-300';

function LaneTitle({ icon: Icon, children }: { icon: typeof Shield; children: ReactNode }) {
  return (
    <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
    </h4>
  );
}

function ScoreLane({ from, to }: { from: number; to: number }) {
  const gain = to - from;
  const lo = Math.min(from, to);
  return (
    <div>
      <LaneTitle icon={TrendingUp}>Plan score</LaneTitle>
      <p className="flex items-baseline gap-1.5 leading-none">
        <span className={`text-[26px] font-bold ${gain >= 0 ? LAVENDER : 'text-amber-300'}`}>{to}</span>
        <span className={`text-[13px] font-semibold ${gain >= 0 ? LAVENDER : 'text-amber-300'}`}>
          {gain >= 0 ? '+' : '−'}{Math.abs(gain)}
        </span>
      </p>
      <div className="relative mt-3 h-1.5 rounded-full bg-muted/60" role="img" aria-label={`Plan score from ${from} to ${to} out of 100`}>
        <div className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/45" style={{ width: `${lo}%` }} />
        <div
          className={`absolute inset-y-0 rounded-r-full ${gain >= 0 ? 'bg-violet-300' : 'bg-amber-300/80'}`}
          style={{ left: `${lo}%`, width: `${Math.abs(gain)}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] text-muted-foreground">
        <span>0</span><span>from {from}</span><span>100</span>
      </div>
    </div>
  );
}

function BracketLane({ bracket, aim }: { bracket: NonNullable<SwapImpact['bracket']>; aim?: number | null }) {
  const inRange = (n: number, lo: number, hi: number) => n >= lo && n <= hi;
  const label = `${BRACKET_LABELS[bracket.to]}${bracket.toMax > bracket.to ? ` or ${BRACKET_LABELS[bracket.toMax]}` : ''}`;
  return (
    <div>
      <LaneTitle icon={Gauge}>Bracket</LaneTitle>
      <div className="grid grid-cols-5 gap-1" role="img" aria-label={`Plays like bracket ${bracket.from} now, ${label} after these swaps${aim ? `, aiming for ${aim}` : ''}`}>
        {[1, 2, 3, 4, 5].map(n => {
          const isTo = inRange(n, bracket.to, bracket.toMax);
          const isNow = inRange(n, bracket.from, bracket.fromMax);
          const hex = BRACKET_HEX[n];
          return (
            <div
              key={n}
              className="grid h-[30px] place-items-center rounded-[7px] bg-muted/50 text-[13px] font-bold tabular-nums text-muted-foreground"
              style={{
                ...(isTo ? { backgroundColor: `${hex}33`, color: hex } : {}),
                ...(isNow ? { boxShadow: `inset 0 0 0 1.5px ${hex}`, color: hex } : {}),
              }}
            >
              {n}
            </div>
          );
        })}
      </div>
      <div className="mt-1 grid grid-cols-5 gap-1 text-center text-[10px] text-muted-foreground">
        {[1, 2, 3, 4, 5].map(n => (
          <span key={n} className={n === aim ? 'font-semibold' : ''} style={n === aim ? { color: BRACKET_HEX[n] } : undefined}>
            {n === aim ? 'aim' : n === bracket.from ? 'now' : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

function RolesLane({ roles }: { roles: RoleShift[] }) {
  // One scale for every row, so bars compare across roles as well as against their minimums.
  const max = Math.max(...roles.flatMap(r => [r.from, r.to, r.target]), 1);
  const pct = (n: number) => `${(Math.max(0, n) / max) * 100}%`;
  return (
    <div>
      <LaneTitle icon={Shield}>Roles vs minimum</LaneTitle>
      <div className="flex flex-col gap-[7px]">
        {roles.map(r => {
          const meets = r.to >= r.target;
          const dropsBelow = r.from >= r.target && !meets;
          return (
            <div key={r.role} className="grid grid-cols-[minmax(0,6rem)_1fr_4.5rem] items-center gap-2.5 text-xs">
              <span className="truncate text-foreground/75">{r.label}</span>
              <span
                className="relative h-2 rounded-full bg-muted/60"
                role="img"
                aria-label={`${r.label}: ${r.from} to ${r.to}, minimum ${r.target}`}
              >
                <span
                  className={`absolute inset-y-0 left-0 rounded-full ${dropsBelow ? 'bg-amber-300/80' : meets && r.from < r.target ? 'bg-emerald-300' : 'bg-muted-foreground/70'}`}
                  style={{ width: pct(r.to) }}
                />
                <span className="absolute -inset-y-[3px] w-0.5 rounded-sm bg-foreground/70" style={{ left: pct(r.target) }} />
              </span>
              <span className="whitespace-nowrap text-right font-semibold tabular-nums">
                <span className="font-medium text-muted-foreground">{r.from} → </span>
                <span className={dropsBelow ? 'text-amber-300' : ''}>{r.to}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const comboName = (c: DetectedCombo) => c.cards.map(n => n.split(',')[0]).join(' + ');

/** "Sanguine Bond + Exquisite Blood", or the first one and a count, with the rest on hover. */
function ComboFact({ verb, combos, tone }: { verb: string; combos: DetectedCombo[]; tone: string }) {
  const body = (
    <span className="inline-flex items-center gap-1.5">
      <Zap className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      {verb} <b className={`font-semibold ${tone}`}>{comboName(combos[0])}</b>
      {combos.length > 1 && <span>and {combos.length - 1} more</span>}
    </span>
  );
  if (combos.length === 1) return body;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span className="cursor-default">{body}</span></TooltipTrigger>
      <Tip>
        {combos.map(c => <div key={c.comboId}>{comboName(c)}</div>)}
      </Tip>
    </Tooltip>
  );
}

const money = (n: number) => `$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The last non-null value seen — what a closing lane keeps showing while it animates shut. */
function useLast<T>(value: T | null | undefined): T | null {
  const last = useRef<T | null>(null);
  if (value != null) last.current = value;
  return value ?? last.current;
}

// One easing for every resize in the strip: fast start, long settle (exponential ease-out).
const RESIZE = 'duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none';

/**
 * Opens and closes vertically: a 0fr to 1fr grid row animates to the content's real height, which
 * height: auto can't. The child clips while the row is short.
 */
function Reveal({ open, className = '', children }: { open: boolean; className?: string; children: ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity,margin] ${RESIZE} ${open ? 'grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0'} ${className}`}
      aria-hidden={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

type LaneKey = 'score' | 'bracket' | 'roles';
const LANE_ORDER: LaneKey[] = ['score', 'bracket', 'roles'];

/**
 * What the checked swaps do to the deck, at a glance. Every lane stays mounted: one the selection
 * stops moving collapses (its flex-grow eases to 0 beside the others on desktop, its height eases
 * shut when they stack on a phone) while still showing its last figures, and one that starts moving
 * grows back in. The strip as a whole opens and closes the same way.
 */
export function SwapImpactRow({ impact, aim }: {
  /** Null with nothing checked — the strip closes. */
  impact: SwapImpact | null;
  /** The bracket the player is aiming at, when they have one. */
  aim?: number | null;
}) {
  const score = useLast(impact?.score);
  const bracket = useLast(impact?.bracket);
  const roles = useLast(impact && impact.roles.length > 0 ? impact.roles : null);
  const shown: Record<LaneKey, boolean> = {
    score: !!impact?.score,
    bracket: !!impact?.bracket,
    roles: !!impact && impact.roles.length > 0,
  };
  const anyLane = LANE_ORDER.some(k => shown[k]);

  const facts = impactFacts(impact, aim);
  const lastFacts = useLast(facts.length > 0 ? facts : null) ?? [];
  const open = anyLane || facts.length > 0;

  const laneNode = (key: LaneKey): ReactNode => {
    if (key === 'score') return score && <ScoreLane from={score.from} to={score.to} />;
    if (key === 'bracket') return bracket && <BracketLane bracket={bracket} aim={aim} />;
    return roles && <RolesLane roles={roles} />;
  };

  return (
    <TooltipProvider delayDuration={200}>
      {/* Full-bleed: the strip runs to the header's side edges and, open, down onto its bottom
          border, so every rule inside it meets another rule or an edge. Lines form one grid: the
          strip's top rule, hairlines between lanes running its full height, the rule over the facts
          row, and hairlines between facts. Nothing floats in padding. */}
      <Reveal open={open} className={`-mx-3 sm:-mx-4 ${open ? 'mt-3.5 -mb-3 sm:-mb-4' : 'mt-0 mb-0'}`}>
        <div className="border-t border-border/40" aria-label="What these swaps do">
          <Reveal open={anyLane}>
            {/* Lanes sit side by side, the roles lane taking the extra room its bars need. On a
                phone they stack, a full-width rule between each. */}
            <div className="flex flex-col sm:flex-row">
              {LANE_ORDER.map((key, i) => {
                const on = shown[key];
                const before = LANE_ORDER.slice(0, i).some(k => shown[k]);
                const grow = key === 'roles' ? 'sm:grow-[1.35]' : 'sm:grow';
                return (
                  <div
                    key={key}
                    aria-hidden={!on}
                    className={`grid min-w-0 overflow-hidden border-border/40 sm:basis-0 transition-[flex-grow,grid-template-rows,opacity,padding,border-width] ${RESIZE} ${
                      on ? `grid-rows-[1fr] px-3 py-3.5 opacity-100 sm:px-4 ${grow}` : 'pointer-events-none grid-rows-[0fr] px-0 py-0 opacity-0 sm:grow-0'
                    } ${on && before ? 'border-t sm:border-l sm:border-t-0' : 'border-0'}`}
                  >
                    {/* A floor on the content's width, so a closing lane clips instead of
                        reflowing its bars into a sliver. */}
                    <div className="min-h-0 sm:min-w-[10.5rem]">{laneNode(key)}</div>
                  </div>
                );
              })}
            </div>
          </Reveal>
          <Reveal open={facts.length > 0}>
            {/* One cell per fact, a hairline between neighbours. Each cell draws its own left and
                top rule and the row is pulled up and left by a pixel, so the outer edges hide under
                the strip's rules and a wrapped second line still gets a rule above it. */}
            <div className={`text-xs text-foreground/75 ${anyLane ? 'border-t border-border/40' : ''}`}>
              <div className="-ml-px -mt-px flex flex-wrap">
                {(facts.length > 0 ? facts : lastFacts).map((fact, k) => (
                  <div
                    key={isValidElement(fact) && fact.key != null ? fact.key : k}
                    className="flex grow items-center border-l border-t border-border/40 px-3 py-2.5 sm:px-4"
                  >
                    {fact}
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </Reveal>
    </TooltipProvider>
  );
}

/** The one-line effects under the lanes, each only when the selection moves it. */
function impactFacts(impact: SwapImpact | null, aim?: number | null): ReactNode[] {
  if (!impact) return [];
  const { bracket, combosCompleted, combosBroken, manaValue, lands, misfitsCleared, priceDelta } = impact;
  const lowering = aim != null && bracket != null && aim < bracket.from;
  const facts: ReactNode[] = [];
  if (combosCompleted.length > 0) facts.push(<ComboFact key="c+" verb="Completes" combos={combosCompleted} tone="text-emerald-300" />);
  if (combosBroken.length > 0) {
    facts.push(<ComboFact key="c-" verb="Breaks" combos={combosBroken} tone={lowering ? 'text-foreground' : 'text-amber-300'} />);
  }
  if (misfitsCleared.length > 0) {
    facts.push(
      <Tooltip key="misfits">
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-default items-center gap-1.5">
            <Scissors className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            Clears <b className="font-semibold text-foreground">{misfitsCleared.length} misfit{misfitsCleared.length === 1 ? '' : 's'}</b>
          </span>
        </TooltipTrigger>
        <Tip>{misfitsCleared.join(', ')}</Tip>
      </Tooltip>,
    );
  }
  if (lands) {
    const closer = Math.abs(lands.to - lands.target) < Math.abs(lands.from - lands.target);
    facts.push(
      <Tooltip key="lands">
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-default items-center gap-1.5">
            <Mountain className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            Lands <b className={`font-semibold tabular-nums ${closer ? 'text-foreground' : 'text-amber-300'}`}>{lands.from} → {lands.to}</b>
          </span>
        </TooltipTrigger>
        <Tip>The Mana tab suggests {lands.target}.</Tip>
      </Tooltip>,
    );
  }
  if (manaValue) {
    facts.push(
      <span key="mv" className="inline-flex items-center gap-1.5">
        <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        Avg mana value <b className="font-semibold tabular-nums text-foreground">{manaValue.from.toFixed(2)} → {manaValue.to.toFixed(2)}</b>
      </span>,
    );
  }
  if (priceDelta != null && Math.abs(priceDelta) >= 0.01) {
    facts.push(
      <span key="price" className="inline-flex items-center gap-1.5">
        <DollarSign className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        {/* The verb stays in the row's text colour; only the amount carries emerald (money). */}
        {priceDelta < 0 ? 'Saves' : 'Costs'}
        <b className={`font-semibold tabular-nums ${priceDelta < 0 ? 'text-emerald-300' : 'text-foreground'}`}>
          {money(priceDelta)}
        </b>
      </span>,
    );
  }
  return facts;
}
