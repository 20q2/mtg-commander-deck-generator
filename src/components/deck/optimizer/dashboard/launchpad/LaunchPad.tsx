// src/components/deck/optimizer/dashboard/launchpad/LaunchPad.tsx
//
// The Overview's "What are we doing today?" — one question under the score ring. The path to 100,
// in the hero beside the ring, shows where the missing points are; the job chooser names the things
// a player comes here to do in their own words; the panel under it answers the picked job right
// here, with a door to the full tab.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { FlaskConical, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { pointsToHundred, projectSwaps } from '@/services/deckBuilder/planScore';
import { bracketLabelFor } from '@/services/deckBuilder/bracketEstimator';
import { formatPrice } from '@/services/deckBuilder/costAnalyzer';
import type { SubScoreKey } from '@/types';
import { useCostPlan } from '../../useCostPlan';
import { JOBS, JOB_BY_ID, jobForArea, pairSwaps, pointsForJob, type JobId } from './jobs';
import { PathTo100, WELL_TUNED_AT } from './PathTo100';
import { UpgradesPreview } from './UpgradesPreview';
import { NewCardsPreview, useNewCards } from './NewCardsPreview';
import { ManaPreview, MANA_META } from './ManaPreview';
import { CheaperPreview, SHOWN_CHEAPER, mostSavings } from './CheaperPreview';
import { cheaperSwaps, gameChangerPressure, useGameChangerNames } from './cheaperSwaps';
import { BalancePreview } from './BalancePreview';
import { PowerPreview } from './PowerPreview';
import { pickPanelArt } from './panelArt';
import { CardMenuHost } from './cardMenu';
import type { RingWiring } from './ScoreRing';
import type { LaunchChange, LaunchPadDeps } from './types';

const SHOWN_PAIRS = 3;
const OUT_MS = 140;
const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * The panel's height as a number to animate to. Content swaps and late-loading previews would
 * otherwise snap the panel to a new height in one frame.
 */
function useMeasuredHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setHeight(el.getBoundingClientRect().height);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, height };
}

/** Cards the player kept, per deck — a saved list by id, anything else by its commander. */
function useKept(deckKey: string) {
  const storeKey = `mtg-overview-kept:${deckKey}`;
  const [kept, setKept] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(storeKey) ?? '[]') as string[]); } catch { return new Set(); }
  });
  const write = (next: Set<string>) => {
    setKept(next);
    try { localStorage.setItem(storeKey, JSON.stringify([...next])); } catch { /* storage unavailable */ }
  };
  return {
    kept,
    keep: (name: string) => write(new Set([...kept, name])),
    unkeep: (name: string) => { const next = new Set(kept); next.delete(name); write(next); },
  };
}

/** A tile's card art: pushed right and fading out before the label, brighter on hover and when picked.
 *  While a job is open the other tiles drop theirs, back to plain buttons until hovered. */
function TileArt({ url, selected, compact }: { url?: string; selected: boolean; compact: boolean }) {
  const [loaded, setLoaded] = useState<string | null>(null);
  if (!url) return null;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 right-0 -z-10 w-[78%] overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_70%)]"
    >
      <img
        key={url}
        src={url}
        alt=""
        decoding="async"
        onLoad={() => setLoaded(url)}
        className={cn(
          'h-full w-full object-cover object-[center_30%] transition-[opacity,transform] duration-500 ease-out motion-safe:group-hover:scale-[1.04]',
          loaded !== url ? 'opacity-0'
            : selected ? 'opacity-50'
              : compact ? 'opacity-0 group-hover:opacity-[0.3]'
                : 'opacity-[0.28] group-hover:opacity-[0.42]',
        )}
      />
    </span>
  );
}

/** The job left open on this deck earlier in the browser session, if any. */
function readOpenJob(key: string): JobId | null {
  try {
    const id = sessionStorage.getItem(key);
    return id && id in JOB_BY_ID ? (id as JobId) : null;
  } catch { return null; }
}

type Meta = { text: string; tone?: 'gain' | 'cash' | 'warn' } | 'loading' | null;
type BuiltByLaunchPad = 'gains' | 'pairs' | 'pairProjection' | 'kept' | 'keep' | 'unkeep' | 'isApplied' | 'apply' | 'undo';

export function LaunchPad({ renderHeader, ...props }: Omit<LaunchPadDeps, BuiltByLaunchPad> & {
  /** The hero above the question. Rendered from here so the score ring and the path to 100 beside it
   *  can show the open job and the swaps on screen, which this component owns. */
  renderHeader?: (ring: RingWiring, path: ReactNode) => ReactNode;
}) {
  const gains = useMemo(() => pointsToHundred(props.planScore), [props.planScore]);
  const { kept, keep, unkeep } = useKept(props.newCards.listId ?? props.commanderName);

  // ── This visit's changes: what the strip lists and Undo all reverses. ──
  const [changes, setChanges] = useState<LaunchChange[]>([]);
  const { onApplySwap } = props;
  const apply = useCallback((c: LaunchChange) => {
    onApplySwap(c.removals, c.additions);
    setChanges(prev => [...prev.filter(x => x.id !== c.id), c]);
  }, [onApplySwap]);
  // The deck mutation stays outside the state updater: StrictMode runs updaters twice in dev, which
  // would reverse a swap and then reverse it back.
  const undo = useCallback((id: string) => {
    const c = changes.find(x => x.id === id);
    if (!c) return;
    onApplySwap(c.additions, c.removals);
    setChanges(prev => prev.filter(x => x.id !== id));
  }, [changes, onApplySwap]);
  const undoAll = () => {
    for (const c of [...changes].reverse()) onApplySwap(c.additions, c.removals);
    setChanges([]);
  };

  // ── The swaps the upgrades job shows, and where they'd take the score. ──
  const removals = useMemo(() => (props.baseSwaps?.removals ?? []).filter(r => !kept.has(r.name)), [props.baseSwaps, kept]);
  const pairs = useMemo(() => pairSwaps(removals, props.baseSwaps?.additions ?? [], SHOWN_PAIRS), [removals, props.baseSwaps]);
  const pairProjection = useMemo(
    () => projectSwaps(props.planScore, props.analysis.cardFitMisfits ?? props.analysis.misfits ?? [], props.analysis.cardFitGaps ?? props.analysis.gapAnalysis ?? [],
      pairs.map(p => ({ out: p.out.name, in: p.in.name })),
      props.analysis.strategyBasis ? { basis: props.analysis.strategyBasis, themeAdds: props.analysis.strategyThemeAdds ?? [] } : undefined),
    [props.planScore, props.analysis, pairs],
  );
  const reach = pairProjection.length ? Math.max(0, pairProjection[pairProjection.length - 1] - props.planScore.overall) : 0;

  const d: LaunchPadDeps = {
    ...props, gains, pairs, pairProjection, kept, keep, unkeep, apply, undo,
    isApplied: (id: string) => changes.some(c => c.id === id),
  };

  // Nothing is open on a first visit: the tiles' own lines say where the work is, and the player picks.
  // Coming back from another tab reopens whatever was open when they left.
  // `picked` moves the tile highlight at once; `job` is the panel on screen, which swaps once the old
  // one has slid out. The slide runs toward the picked tile's side of the grid.
  const jobKey = `mtg-overview-job:${props.newCards.listId ?? props.commanderName}`;
  const [job, setJob] = useState<JobId | null>(() => readOpenJob(jobKey));
  const [picked, setPicked] = useState<JobId | null>(job);
  // Another deck loaded under the same Overview: take up that deck's job instead of carrying this one.
  const [jobFor, setJobFor] = useState(jobKey);
  if (jobFor !== jobKey) {
    const restored = readOpenJob(jobKey);
    setJobFor(jobKey);
    setJob(restored);
    setPicked(restored);
  }
  useEffect(() => {
    try {
      if (picked) sessionStorage.setItem(jobKey, picked);
      else sessionStorage.removeItem(jobKey);
    } catch { /* storage unavailable */ }
  }, [jobKey, picked]);
  const [stage, setStage] = useState<'shown' | 'leaving' | 'entering'>('shown');
  const [dir, setDir] = useState(1);
  const swapTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(swapTimer.current), []);
  /** Opens a job, switches to it, or with null closes the panel. */
  const choose = (next: JobId | null) => {
    if (next === picked) return;
    const at = (id: JobId) => JOBS.findIndex(j => j.id === id);
    setDir(picked && next && at(next) < at(picked) ? -1 : 1);
    setPicked(next);
    window.clearTimeout(swapTimer.current);
    if (prefersReducedMotion()) { setJob(next); return; }
    if (!picked) {
      // Opening from closed: nothing to slide out.
      setJob(next);
      setStage('entering');
      requestAnimationFrame(() => requestAnimationFrame(() => setStage('shown')));
      return;
    }
    setStage('leaving');
    swapTimer.current = window.setTimeout(() => {
      setJob(next);
      setStage('entering');
      // Two frames: one to paint the entering offset, then release it so the transition runs.
      requestAnimationFrame(() => requestAnimationFrame(() => setStage('shown')));
    }, OUT_MS);
  };
  const contentMotion: CSSProperties =
    stage === 'leaving' ? { opacity: 0, transform: `translateX(${-dir * 14}px)`, transition: `opacity ${OUT_MS}ms ease-in, transform ${OUT_MS}ms ease-in` }
      : stage === 'entering' ? { opacity: 0, transform: `translateX(${dir * 14}px)`, transition: 'none' }
        : { opacity: 1, transform: 'none', transition: `opacity 260ms ${EASE}, transform 260ms ${EASE}` };

  // The panel glides between heights, and the page keeps room for the tallest one seen: a shorter
  // panel shrinking the page under the reader is what yanked the scroll position.
  const { ref: panelInner, height: panelHeight } = useMeasuredHeight();
  const [reserve, setReserve] = useState(0);
  useEffect(() => { if (panelHeight && panelHeight > reserve) setReserve(panelHeight); }, [panelHeight, reserve]);

  // Cost runs up front so its choice can say how much there is to save; new cards wait for a visit.
  const { plan, loading: costLoading } = useCostPlan({
    commanderName: d.commanderName,
    partnerCommanderName: d.partnerCommanderName,
    currentCards: d.cards,
    analysis: d.analysis,
    mustIncludeNames: d.mustIncludeNames,
    excludeFromSuggestions: d.excludeFromSuggestions,
    currency: d.currency,
  });
  // Aiming below the deck's Game Changers puts them first, which needs the list to vet stand-ins.
  const pressure = gameChangerPressure(d);
  const gameChangers = useGameChangerNames(!!pressure);
  const cheapLoading = costLoading || (!!pressure && !gameChangers);
  const pressureKey = pressure ? `${pressure.aim}:${[...pressure.names].join('|')}` : '';
  const cheap = useMemo(() => cheaperSwaps(plan, pressure, gameChangers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, pressureKey, gameChangers]);
  // New cards start loading when the pointer reaches the tile, so the panel is usually ready by
  // the click instead of arriving as a skeleton that grows.
  const [visitedNew, setVisitedNew] = useState(false);
  useEffect(() => { if (picked === 'new') setVisitedNew(true); }, [picked]);
  const newCards = useNewCards(d, visitedNew);

  // Well tuned, the tiles stop pricing their work in points: what's left is polish, not a race.
  const tuned = d.planScore.overall >= WELL_TUNED_AT;
  const pts = (n: number) => `+${n} pt${n === 1 ? '' : 's'}`;
  const meta = (id: JobId): Meta => {
    switch (id) {
      case 'upgrades': {
        if (d.deckExcess > 0) return { text: `Cut ${d.deckExcess}`, tone: 'warn' };
        if (d.deckExcess < 0) return { text: `Add ${-d.deckExcess}`, tone: 'warn' };
        if (!d.baseSwaps) return 'loading';
        // What the swaps on screen are worth, not the whole Card Fit column, which would promise
        // points those swaps can't deliver.
        if (reach > 0 && !tuned) return { text: `${pairs.length} ready · about ${pts(reach)}`, tone: 'gain' };
        return pairs.length > 0 ? { text: `${pairs.length} ready` } : null;
      }
      case 'balance': {
        const p = pointsForJob('balance', gains);
        const short = (d.analysis.roleBreakdowns ?? []).find(r => r.target > 0 && r.current < r.target);
        if (short) return { text: `${short.label} ${short.target - short.current} short${p > 0 && !tuned ? ` · ${pts(p)}` : ''}`, tone: 'warn' };
        if (p > 0) return tuned ? { text: 'Fine-tuning' } : { text: pts(p), tone: 'gain' };
        return { text: 'On target' };
      }
      case 'new':
        if (newCards.phase === 'loading') return 'loading';
        return newCards.phase === 'done' ? { text: `${newCards.details.length} new` } : null;
      case 'mana': {
        const v = d.analysis.manaBase?.verdict;
        return v ? { text: MANA_META[v] ?? v, tone: v === 'ok' ? undefined : 'warn' } : null;
      }
      case 'cheaper': {
        if (cheapLoading) return 'loading';
        // From what the one-click swaps take off to what taking every Explorer swap too would.
        const s = cheap.slice(0, SHOWN_CHEAPER).reduce((sum, x) => sum + x.savings, 0);
        const most = mostSavings(plan, cheap);
        const whole = (n: number) => formatPrice(Math.floor(n), d.currency).replace(/\.00$/, '');
        if (s > 0) return { text: Math.floor(most) > Math.floor(s) ? `Save ${whole(s)}–${whole(most)}` : `Save ${whole(s)}`, tone: 'cash' };
        if (most >= 1) return { text: `Save up to ${whole(most)}`, tone: 'cash' };
        // No one-click swap, but the deck still has a price worth knowing before opening it.
        return plan ? { text: `${whole(plan.currentTotal)} deck` } : null;
      }
      case 'power': {
        const est = d.bracketEstimation;
        if (!est) return null;
        const reads = bracketLabelFor(est.bracket, est.bracketMax);
        const basis = d.bracketAim?.basis;
        const aim = basis && basis.source !== 'estimated' ? basis.bracket : null;
        if (aim == null || (aim >= est.bracket && aim <= est.bracketMax)) return { text: reads };
        return { text: `${reads} · aiming for ${aim}`, tone: 'warn' };
      }
    }
  };

  // Each job's art is a card that job is about; the tile and its panel share it. Re-picked until the
  // job's own data has arrived, then held: a swap that reshuffles the lists shouldn't repaint the page.
  const artHeld = useRef<Partial<Record<JobId, string>>>({});
  const artReady: Record<JobId, boolean> = {
    upgrades: !!d.baseSwaps,
    mana: !!d.baseSwaps,
    new: newCards.phase === 'done' || newCards.phase === 'error',
    cheaper: !cheapLoading,
    balance: true,
    power: !!d.bracketEstimation,
  };
  const newNames = newCards.phase === 'done' ? newCards.details.map(x => x.name) : [];
  const artFor = (id: JobId) => {
    const held = artHeld.current[id];
    if (held) return held;
    const url = pickPanelArt(id, d, cheap.map(x => x.row.current.name), newNames);
    if (url && artReady[id]) artHeld.current[id] = url;
    return url;
  };
  const panelArt = job ? artFor(job) : undefined;

  const panel = (() => {
    switch (job) {
      case 'upgrades': return <UpgradesPreview d={d} />;
      case 'new': return <NewCardsPreview d={d} state={newCards} />;
      case 'mana': return <ManaPreview d={d} />;
      case 'cheaper': return <CheaperPreview d={d} plan={plan} swaps={cheap} pressure={pressure} loading={cheapLoading} />;
      case 'balance': return <BalancePreview d={d} />;
      case 'power': return <PowerPreview d={d} />;
      default: return null;
    }
  })();

  // The swaps' projection only means something while those swaps are on screen.
  const shownReach = picked === 'upgrades' && d.deckExcess === 0 ? reach : 0;
  // Like the tiles, a second click on an area whose job is open closes it.
  const selectArea = (a: SubScoreKey) => {
    const next = jobForArea(a);
    choose(next === picked ? null : next);
  };
  const activeAreas = picked ? JOB_BY_ID[picked].areas : [];
  const deckNames = useMemo(() => new Set(props.cards.map(c => c.name)), [props.cards]);
  const commanderNames = useMemo(
    () => new Set([props.commander.name, props.partnerCommander?.name].filter((n): n is string => !!n)),
    [props.commander, props.partnerCommander],
  );

  return (
    <CardMenuHost wiring={props.cardMenu} deckNames={deckNames} commanderNames={commanderNames}>
    {renderHeader?.(
      { gains, activeAreas, onSelectArea: selectArea },
      <PathTo100
        planScore={d.planScore}
        gains={gains}
        reach={shownReach}
        onSelectArea={selectArea}
        activeAreas={activeAreas}
        sampleSize={d.sampleSize}
        commanderShort={d.reasonCtx.commanderShort}
      />,
    )}
    <section aria-labelledby="launchpad-q" className="flex flex-col gap-2.5 sm:gap-3">
      <h2 id="launchpad-q" className="mt-1 text-lg sm:text-xl font-semibold tracking-tight text-foreground">
        What are we doing today?
      </h2>

      {/* Disclosure buttons, not tabs: a second click closes the panel, so none open is a state. */}
      <div role="group" aria-label="Pick a job" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2">
        {JOBS.map(j => {
          const selected = j.id === picked;
          const compact = picked !== null;
          const m = meta(j.id);
          return (
            <Button
              key={j.id}
              type="button"
              variant="outline"
              id={`launchpad-tab-${j.id}`}
              aria-expanded={selected}
              aria-controls="launchpad-panel"
              aria-busy={m === 'loading' || undefined}
              onClick={() => choose(selected ? null : j.id)}
              onPointerEnter={j.id === 'new' ? () => setVisitedNew(true) : undefined}
              className={cn(
                // One height for every tile, however many lines its label and meta take. The label sits
                // at the top and the meta at the bottom, with the job's card art filling the right side.
                // Once a job is open the tiles tuck down so the panel gets the room.
                'group relative isolate overflow-hidden h-auto whitespace-normal text-left font-medium flex-col items-start justify-between',
                'transition-[background-color,border-color,color,box-shadow,min-height,padding,gap,border-radius] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none',
                compact
                  ? 'min-h-[60px] gap-1 rounded-lg px-3 py-2 sm:px-3 sm:py-2'
                  : 'min-h-[84px] sm:min-h-[104px] gap-2 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3.5',
                selected
                  ? 'border-violet-400/55 bg-violet-500/15 text-foreground shadow-[0_8px_22px_-12px_hsl(262_83%_58%/0.9)] hover:bg-violet-500/20'
                  : 'border-border/60 bg-card/50 text-foreground/90 hover:border-border hover:bg-accent/40',
              )}
            >
              <TileArt url={artFor(j.id)} selected={selected} compact={compact} />
              <span className={cn(
                'flex items-start gap-2 font-semibold leading-snug [text-shadow:0_1px_3px_hsl(220_13%_6%/0.7)]',
                'transition-[font-size] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none',
                compact ? 'text-[13px] sm:text-sm' : 'text-[13px] sm:text-[15px]',
              )}>
                <j.Icon className={cn('mt-0.5 shrink-0 transition-colors', selected ? 'text-violet-300' : 'text-muted-foreground group-hover:text-foreground/80')} />
                <span>{j.label}</span>
              </span>
              {m === 'loading' ? (
                <span className="ml-6 my-0.5 h-3 w-20 rounded bg-muted/70 animate-pulse" aria-hidden="true" />
              ) : m && (
                <span className={cn(
                  'pl-6 text-xs tabular-nums [text-shadow:0_1px_3px_hsl(220_13%_6%/0.7)] transition-[font-size] duration-300 motion-reduce:transition-none',
                  !compact && 'sm:text-[13px]',
                  m.tone === 'gain' ? 'font-semibold text-violet-300'
                    : m.tone === 'cash' ? 'font-semibold text-emerald-400'
                      : m.tone === 'warn' ? 'font-semibold text-amber-300'
                        : 'text-muted-foreground',
                )}>
                  {m.text}
                </span>
              )}
            </Button>
          );
        })}
      </div>

      {/* Every change made here, in one place: the deck view shows the cards, this shows the trail. */}
      {changes.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-[12.5px]" aria-live="polite">
          <span className="font-semibold text-emerald-400">{changes.length} change{changes.length === 1 ? '' : 's'} this visit</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={changes.map(c => c.label).join('\n')}>
            {changes.map(c => c.label).join(' · ')}
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={undoAll} className="h-7 gap-1.5 px-2 text-xs text-foreground/85">
            <Undo2 className="w-3.5 h-3.5" /> Undo all
          </Button>
        </div>
      )}

      {/* The reserve only holds while a job is open; closing the panel gives the room back. */}
      <div style={{ minHeight: (job && reserve) || undefined }}>
        <div
          id="launchpad-panel"
          role="region"
          aria-labelledby={job ? `launchpad-tab-${job}` : undefined}
          className={cn('relative isolate overflow-hidden rounded-xl', job && 'border border-border/60 bg-card/60')}
          style={{
            // +2 for the border. Undefined until measured, so the first paint doesn't grow from 0.
            height: !job ? 0 : panelHeight != null ? panelHeight + 2 : undefined,
            transition: prefersReducedMotion() ? undefined : `height 320ms ${EASE}`,
          }}
        >
          {panelArt && (
            // Faint and pushed right, fading out before it reaches the text column.
            <div className="absolute inset-0 -z-10 pointer-events-none" style={{ opacity: contentMotion.opacity, transition: contentMotion.transition }} aria-hidden="true">
              <div
                className="absolute inset-0 bg-cover bg-center opacity-[0.16] [mask-image:linear-gradient(to_right,transparent_15%,black_75%)]"
                style={{ backgroundImage: `url(${panelArt})` }}
              />
            </div>
          )}
          <div ref={panelInner} className={cn(job && 'p-3.5 sm:p-5')} style={contentMotion}>
            {panel}
          </div>
        </div>
      </div>

      {/* On phones the hero drops its beta note so the jobs reach the first screen; it lives here. */}
      <p className="sm:hidden flex items-start gap-1.5 text-[11px] text-violet-300/70">
        <FlaskConical className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
        Inspector is still in early development. Suggestions may be off if your deck does something unique.
      </p>
    </section>
    </CardMenuHost>
  );
}
