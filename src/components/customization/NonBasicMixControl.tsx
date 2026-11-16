import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Blend, Shuffle, SlidersHorizontal, Wrench } from 'lucide-react';
import { useStore } from '@/store';
import { LandGroupExamples } from './LandGroupExamples';
import { defaultLandMix, flexKind, resolveLandMix, type LandKind } from '@/services/deckBuilder/landMix';
import { recommendLandMix, recommendedMix } from '@/services/deckBuilder/landMixRecommendation';
import type { NonBasicLandMix } from '@/types';

interface Group { kind: LandKind; label: string; hint: string; fill: string; text: string; icon: ReactNode }

const GROUPS: Group[] = [
  { kind: 'fixing', label: 'Fixing', hint: 'Taps for two or more of your colors', fill: 'bg-sky-500/55', text: 'text-sky-300', icon: <Blend className="w-[1em] h-[1em]" strokeWidth={2.5} /> },
  { kind: 'utility', label: 'Utility', hint: 'Does more than tap for one mana', fill: 'bg-amber-500/50', text: 'text-amber-300', icon: <Wrench className="w-[1em] h-[1em]" strokeWidth={2.5} /> },
  { kind: 'mdfc', label: 'Spell lands', hint: 'MDFCs: a spell on the front, a land on the back', fill: 'bg-fuchsia-500/50', text: 'text-fuchsia-300', icon: <i className="ms ms-dfc-modal-face" /> },
  { kind: 'other', label: 'Fetch lands', hint: 'Plus lands that just tap for one mana', fill: 'bg-slate-500/55', text: 'text-slate-300', icon: <Shuffle className="w-[1em] h-[1em]" strokeWidth={2.5} /> },
];

function useCommanders() {
  const commander = useStore(s => s.commander);
  const partner = useStore(s => s.partnerCommander);
  const colors = [...new Set([...(commander?.color_identity ?? []), ...(partner?.color_identity ?? [])])];
  return { commander, partner, colors };
}

/** What this commander's EDHREC decks actually play, by group. Shared by the toggle and the panel. */
function useRecommendation() {
  const { commander, partner, colors } = useCommanders();
  return useQuery({
    queryKey: ['land-mix-rec', commander?.name, partner?.name ?? null],
    enabled: !!commander,
    staleTime: Infinity,
    retry: false,
    queryFn: () => recommendLandMix(commander!.name, partner?.name ?? null, colors),
  });
}

// The last mix the player tuned for this commander this session, so closing and reopening the
// panel keeps it. A different commander starts from its own recommendation instead.
let lastMix: { key: string; mix: NonBasicLandMix } | null = null;

function setMix(mix: NonBasicLandMix | null, key?: string) {
  if (mix && key) lastMix = { key, mix };
  useStore.setState(state => ({ customization: { ...state.customization, nonBasicLandMix: mix } }));
}

const keyOf = (c: { commander: { name: string } | null; partner: { name: string } | null }) =>
  `${c.commander?.name ?? ''}|${c.partner?.name ?? ''}`;

/** The icon beside the non-basic count that opens (and turns on) the split. */
export function NonBasicMixButton() {
  const total = useStore(s => s.customization.nonBasicLandCount);
  const on = useStore(s => !!s.customization.nonBasicLandMix);
  const cmd = useCommanders();
  const { data: rec } = useRecommendation();
  if (total <= 0) return null;

  const key = keyOf(cmd);
  const toggle = () => {
    if (on) return setMix(null);
    const start = lastMix?.key === key ? lastMix.mix : rec ? recommendedMix(rec, total) : defaultLandMix(total, cmd.colors.length);
    setMix(start, key);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-expanded={on}
      aria-label="Split non-basic lands by type"
      title={on ? 'Go back to letting us pick any non-basics' : 'Choose how many fixing, utility, spell and fetch lands you get'}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        on ? 'text-violet-300 hover:text-violet-200' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <SlidersHorizontal className="w-3.5 h-3.5" />
    </button>
  );
}

const GRAB_PX = 14; // how close to a handle a press has to land to pick it up
const ZERO_SLICE_PX = 22; // width an empty group keeps on the bar (the grips cover ~7px of it)

/** The draggable split track, shown under the non-basic slider while the split is on. */
export function NonBasicMixPanel() {
  const total = useStore(s => s.customization.nonBasicLandCount);
  const stored = useStore(s => s.customization.nonBasicLandMix ?? null);
  const cmd = useCommanders();
  const { colors } = cmd;
  const { data: rec } = useRecommendation();
  const wrapRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: number } | null>(null);

  const [trackWidth, setTrackWidth] = useState(0);

  const open = !!stored && total > 0;
  // A collapsed panel keeps its markup for the animation; inert takes it out of tab order and the
  // accessibility tree so the hidden handles aren't announced.
  useEffect(() => { if (wrapRef.current) wrapRef.current.inert = !open; }, [open]);
  // Segment labels shrink to fit: icon + count when there's room, count alone when narrow.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTrackWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A mono deck has nothing that fixes: Fixing is hidden and fetch lands take what's left.
  const flex = flexKind(colors);
  const groups = flex === 'fixing' ? GROUPS : GROUPS.filter(g => g.kind !== 'fixing');
  const resolved = resolveLandMix(stored ?? lastMix?.mix ?? { mdfc: 0, utility: 0, other: 0 }, total);
  if (flex === 'other') { resolved.other += resolved.fixing; resolved.fixing = 0; }
  const counts = groups.map(g => resolved[g.kind]);
  // Handle i sits between group i and group i+1, measured in slots from the left edge.
  const bounds = counts.slice(0, -1).map((_, i) => counts.slice(0, i + 1).reduce((s, v) => s + v, 0));
  const last = bounds.length - 1;
  // An empty group keeps a slim slice of its own so it stays visible and grabbable; the other
  // groups share what's left of the track. Handles are placed in pixels to match.
  const zeros = counts.filter(c => c === 0).length;
  const zeroSlice = Math.min(ZERO_SLICE_PX, trackWidth / Math.max(1, groups.length * 2));
  const spread = Math.max(0, trackWidth - zeros * zeroSlice);
  const zerosThrough = (i: number) => counts.slice(0, i + 1).filter(c => c === 0).length;
  const handlePx = (i: number) => (total > 0 ? (bounds[i] / total) * spread : 0) + zerosThrough(i) * zeroSlice;

  const recMix = rec ? recommendedMix(rec, total) : null;
  const isRecommended = !!recMix && recMix.mdfc === resolved.mdfc && recMix.utility === resolved.utility
    && recMix.other === resolved.other;
  const deckSource = cmd.partner ? 'decks with this pair' : `${cmd.commander?.name.split(',')[0]} decks`;

  const commit = (next: number[]) => {
    const by: Record<LandKind, number> = { fixing: 0, mdfc: 0, utility: 0, other: 0 };
    groups.forEach((g, j) => { by[g.kind] = next[j]; });
    setMix({ mdfc: by.mdfc, utility: by.utility, other: by.other, total }, keyOf(cmd));
  };

  const moveHandle = (i: number, to: number) => {
    const lo = i === 0 ? 0 : bounds[i - 1];
    const hi = i === last ? total : bounds[i + 1];
    const v = Math.max(lo, Math.min(hi, to));
    if (v === bounds[i]) return;
    const next = [...counts];
    next[i] = v - lo;
    next[i + 1] = hi - v;
    commit(next);
  };

  const trackX = (clientX: number) => clientX - trackRef.current!.getBoundingClientRect().left;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (total <= 0 || bounds.length === 0) return;
    const x = trackX(e.clientX);
    const nearest = bounds.reduce((best, _, i) => Math.abs(handlePx(i) - x) < Math.abs(handlePx(best) - x) ? i : best, 0);
    // Only a press on (or right beside) a handle starts a drag — a stray click on the track
    // must never rewrite the split.
    if (Math.abs(handlePx(nearest) - x) > GRAB_PX) return;
    drag.current = { handle: nearest };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || spread <= 0) return;
    // Undo the empty slices left of this handle, then map pixels back to slots.
    const v = Math.round(((trackX(e.clientX) - zerosThrough(d.handle) * zeroSlice) / spread) * total);
    moveHandle(d.handle, v);
  };

  const endDrag = () => { drag.current = null; };

  const onHandleKey = (i: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    const lo = i === 0 ? 0 : bounds[i - 1];
    const hi = i === last ? total : bounds[i + 1];
    const to =
      e.key === 'ArrowRight' || e.key === 'ArrowUp' ? bounds[i] + 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? bounds[i] - 1
      : e.key === 'Home' ? lo
      : e.key === 'End' ? hi
      : null;
    if (to === null) return;
    e.preventDefault();
    moveHandle(i, to);
  };

  return (
    <div
      ref={wrapRef}
      className="grid transition-[grid-template-rows,opacity] duration-300 ease-in-out"
      style={{ gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0 }}
    >
      <div className="overflow-hidden min-h-0">
        <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-3 space-y-3">
          {recMix && rec && (
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                {rec.numDecks > 0 ? `Recommended from ${rec.numDecks.toLocaleString()} ${deckSource}` : 'Recommended from EDHREC decks'}
              </span>
              <button
                type="button"
                onClick={() => setMix(recMix, keyOf(cmd))}
                aria-pressed={isRecommended}
                className={`shrink-0 text-xs px-2 py-0.5 rounded-full border transition-colors ${
                  isRecommended
                    ? 'bg-primary/20 border-primary/50 text-violet-200 font-medium'
                    : 'bg-muted border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                Recommended
              </button>
            </div>
          )}

          <div
            className="relative py-1 cursor-default select-none touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div ref={trackRef} className="relative flex h-6 rounded-full bg-secondary overflow-hidden ring-1 ring-inset ring-white/5">
              {groups.map((g, i) => {
                if (counts[i] <= 0) {
                  return <div key={g.kind} className={`${g.fill} h-full`} style={{ flex: `0 0 ${zeroSlice}px` }} aria-hidden />;
                }
                const px = total > 0 ? (counts[i] / total) * spread : 0;
                return (
                  <div
                    key={g.kind}
                    className={`${g.fill} h-full flex items-center justify-center gap-1 text-[11px] font-semibold tabular-nums text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.45)]`}
                    style={{ flex: `${counts[i]} 1 0`, minWidth: 0 }}
                    aria-hidden
                  >
                    {px >= 44 && <span className="flex items-center text-[12px] opacity-90">{g.icon}</span>}
                    {px >= 14 && <span>{counts[i]}</span>}
                  </div>
                );
              })}
            </div>
            {bounds.map((b, i) => (
              <div
                key={i}
                role="slider"
                tabIndex={0}
                aria-label={`Between ${groups[i].label} and ${groups[i + 1].label}`}
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={b}
                aria-valuetext={`${groups[i].label} ${counts[i]}, ${groups[i + 1].label} ${counts[i + 1]}`}
                onKeyDown={onHandleKey(i)}
                className="group absolute top-1/2 h-8 w-6 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full cursor-ew-resize focus-visible:outline-none"
                style={{ left: `${handlePx(i)}px` }}
              >
                <span className="h-7 w-[7px] rounded-full bg-white border-2 border-primary shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-transform group-hover:scale-y-110 group-active:scale-y-110 group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-1 group-focus-visible:ring-offset-background" />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {groups.map(g => (
              <div key={g.kind} className="flex items-start gap-2 min-w-0">
                <span className={`mt-px flex w-3.5 shrink-0 justify-center text-[12px] ${g.text}`}>{g.icon}</span>
                <div className="min-w-0">
                  <div className="text-xs">
                    <LandGroupExamples kind={g.kind} label={g.label} colors={colors}>
                      <span className="font-medium text-foreground underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 hover:decoration-foreground">{g.label}</span>
                    </LandGroupExamples>
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-snug">{g.hint}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
