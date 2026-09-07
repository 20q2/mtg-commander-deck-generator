import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Play, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { useOpponentStore, MAX_OPPONENTS } from '@/store/opponentStore';
import { OpponentSeat } from '@/components/playtest/opponents/OpponentSeat';

/** Never let one seated opponent sprawl across the whole table. */
const MAX_SEAT_WIDTH = 460;
const MIN_SEAT_WIDTH = 190;
/** Leave room for the log panel and the ＋ / Turn controls on the right. */
const USABLE_FRACTION = 0.62;

/** Seat placements and sizes survive a reload; they're layout, not game state. */
const POSITIONS_KEY = 'playtest-seat-positions-v2';
const WIDTHS_KEY = 'playtest-seat-widths-v2';
const SIZES_KEY = 'playtest-seat-sizes-v2';

/**
 * A hand-set size can go well past the automatic ceiling — the whole point of
 * resizing a seat is to make one opponent big enough to actually read.
 */
const RESIZE_MIN_W = 160;
const RESIZE_MAX_W = 900;
/** Tall enough to still show a header and a combat strip. */
const RESIZE_MIN_H = 110;
const RESIZE_MAX_H = 900;

/** Which handle you grabbed. */
export type ResizeAxis = 'x' | 'y' | 'both';

/**
 * Keyed by opponent id, so a placement belongs to the seat you actually dragged.
 *
 * This used to be keyed by seat index, which meant removing a middle bot slid
 * every seat after it down an index and into somebody else's coordinates — your
 * whole layout rearranged itself because you dismissed one opponent. The cost of
 * the change is that seating a fresh deck no longer inherits the freed slot's
 * position; it starts in the auto row, which is the far less surprising of the
 * two behaviours. The `-v2` keys above orphan the old index-keyed entries rather
 * than reading them as ids.
 */
type SeatPositions = Record<string, { x: number; y: number }>;
/**
 * Either axis may be unset, meaning "whatever the content wants". They are
 * independent because they do different jobs: width is the zoom, since every
 * card in the seat is a fraction of it, while height decides how much table
 * the seat may occupy before its board starts scrolling.
 */
export type SeatSize = { w?: number; h?: number };
type SeatSizes = Record<string, SeatSize>;

function loadJson<T>(key: string): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

const loadPositions = () => loadJson<SeatPositions>(POSITIONS_KEY);
/**
 * Sizes used to be a bare width per seat. Read the old key forward so an
 * existing layout survives gaining a second axis.
 */
function loadSizes(): SeatSizes {
  const current = loadJson<SeatSizes>(SIZES_KEY);
  if (Object.keys(current).length > 0) return current;
  const legacy = loadJson<Record<string, number>>(WIDTHS_KEY);
  return Object.fromEntries(Object.entries(legacy).map(([k, w]) => [k, { w }]));
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * The opponents, seated across the top of the table rather than stacked in a
 * column beside it. Absolutely positioned so the canvas never reflows —
 * battlefield cards are stored at absolute x/y and a shrinking canvas would
 * clip the ones near the top.
 *
 * Seats start in a centered row and can be dragged anywhere on the table by
 * their name. A seat you have moved is pinned at its own coordinates; one you
 * have not stays in the auto row, so you can rearrange the two you care about
 * and leave the rest alone. Double-click a name to send it back to the row.
 */
export function OpponentSeats() {
  const opponents = useOpponentStore(s => s.opponents);
  const runAllTurns = useOpponentStore(s => s.runAllTurns);
  const openModal = usePlaytestStore(s => s.openModal);
  const autoTurns = usePlaytestSettings(s => s.opponentAutoTurns);
  const viewportWidth = useViewportWidth();
  const bandRef = useSeatBandMeasure(opponents.length);
  const [positions, setPositions] = useState<SeatPositions>(loadPositions);
  const [sizes, setSizes] = useState<SeatSizes>(loadSizes);
  /**
   * The in-flight move, as an offset from wherever the seat already sits.
   *
   * It has to be an offset rather than a committed position: promoting a seat
   * out of the auto row into the placed layer mid-drag would unmount the very
   * element holding the pointer capture, and the gesture would die on the
   * first move. So the seat stays exactly where it is in the DOM and slides
   * under a transform, and only lands in the other layer on release.
   */
  const [drag, setDrag] = useState<{ seatId: string; dx: number; dy: number } | null>(null);

  const persist = useCallback((next: SeatPositions) => {
    setPositions(next);
    try { localStorage.setItem(POSITIONS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  }, []);

  const persistSizes = useCallback((next: SeatSizes) => {
    setSizes(next);
    try { localStorage.setItem(SIZES_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  }, []);

  const autoWidth = Math.max(
    MIN_SEAT_WIDTH,
    Math.min(MAX_SEAT_WIDTH, Math.round((viewportWidth * USABLE_FRACTION) / Math.max(1, opponents.length))),
  );
  const widthOf = (seatId: string) => sizes[seatId]?.w ?? autoWidth;
  const heightOf = (seatId: string) => sizes[seatId]?.h;

  /**
   * Drag a seat by its name. Pointer capture rather than window listeners so a
   * fast drag that outruns the handle cannot drop the gesture — the same
   * reason the old column's resize handle worked this way.
   */
  const startDrag = useCallback((seatId: string, e: React.PointerEvent<HTMLElement>) => {
    // Let the buttons in the header keep their clicks.
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.stopPropagation();

    const handle = e.currentTarget;
    const seatEl = handle.closest('[data-seat]') as HTMLElement | null;
    const canvas = handle.closest('[data-battlefield]') as HTMLElement | null;
    if (!seatEl || !canvas) return;

    const seatRect = seatEl.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    // Where the seat sits right now, whichever layer it's in.
    const baseX = seatRect.left - canvasRect.left;
    const baseY = seatRect.top - canvasRect.top;
    const startX = e.clientX;
    const startY = e.clientY;
    // Keep a seat on the table. The bottom clamp leaves the header reachable,
    // so a seat can never end up somewhere you cannot grab it back from.
    const maxX = Math.max(0, canvasRect.width - seatRect.width);
    const maxY = Math.max(0, canvasRect.height - 40);

    handle.setPointerCapture(e.pointerId);
    let landed = { x: Math.round(baseX), y: Math.round(baseY) };

    const onMove = (ev: PointerEvent) => {
      landed = {
        x: Math.round(clamp(baseX + ev.clientX - startX, 0, maxX)),
        y: Math.round(clamp(baseY + ev.clientY - startY, 0, maxY)),
      };
      setDrag({ seatId, dx: landed.x - baseX, dy: landed.y - baseY });
    };
    const onUp = (ev: PointerEvent) => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      try { handle.releasePointerCapture(ev.pointerId); } catch { /* already gone */ }
      setDrag(null);
      // Write through once at the end rather than on every frame.
      persist({ ...loadPositions(), [seatId]: landed });
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }, [persist]);

  /**
   * Resize a seat from an edge or the corner. Same pointer-capture shape as
   * the move, and live rather than deferred — the cards inside are sized off
   * the seat, so you need to see them change to know when to stop.
   *
   * The axes are tracked separately, so grabbing one edge leaves the other
   * exactly as you left it — including leaving it automatic.
   */
  const startResize = useCallback((seatId: string, axis: ResizeAxis, e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const seatEl = handle.closest('[data-seat]') as HTMLElement | null;
    if (!seatEl) return;
    const rect = seatEl.getBoundingClientRect();
    const startW = rect.width;
    const startH = rect.height;
    const startX = e.clientX;
    const startY = e.clientY;

    handle.setPointerCapture(e.pointerId);
    let landed: SeatSize = { ...(loadSizes()[seatId] ?? {}) };

    const onMove = (ev: PointerEvent) => {
      const next: SeatSize = { ...landed };
      if (axis === 'x' || axis === 'both') {
        next.w = Math.round(clamp(startW + (ev.clientX - startX), RESIZE_MIN_W, RESIZE_MAX_W));
      }
      if (axis === 'y' || axis === 'both') {
        next.h = Math.round(clamp(startH + (ev.clientY - startY), RESIZE_MIN_H, RESIZE_MAX_H));
      }
      landed = next;
      setSizes(prev => ({ ...prev, [seatId]: next }));
    };
    const onUp = (ev: PointerEvent) => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      try { handle.releasePointerCapture(ev.pointerId); } catch { /* already gone */ }
      persistSizes({ ...loadSizes(), [seatId]: landed });
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }, [persistSizes]);

  /** Double-clicking a handle releases only the axis that handle controls. */
  const resetSize = useCallback((seatId: string, axis: ResizeAxis) => {
    const all = loadSizes();
    const current = { ...(all[seatId] ?? {}) };
    if (axis === 'x' || axis === 'both') delete current.w;
    if (axis === 'y' || axis === 'both') delete current.h;
    const next = { ...all };
    if (current.w === undefined && current.h === undefined) delete next[seatId];
    else next[seatId] = current;
    persistSizes(next);
  }, [persistSizes]);

  const resetSeat = useCallback((seatId: string) => {
    const next = { ...loadPositions() };
    delete next[seatId];
    persist(next);
  }, [persist]);

  // Empty table: one chip. This is the discovery moment the old collapsed rail
  // carried, and it has to survive the move.
  if (opponents.length === 0) {
    return (
      <div className="hidden md:flex absolute top-2 inset-x-0 z-30 justify-center pointer-events-none">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => openModal({ kind: 'opponents' })}
          className="pointer-events-auto h-7 px-3 rounded-full border border-dashed border-border/60 bg-background/70 backdrop-blur-sm text-[11px] text-muted-foreground/80 hover:text-foreground"
        >
          <Bot className="w-3.5 h-3.5 mr-1.5 text-violet-300/80" />
          Play against bots
        </Button>
      </div>
    );
  }

  const seated = opponents.map(o => ({ o, pos: positions[o.id] }));
  const inRow = seated.filter(s => !s.pos);
  const placed = seated.filter(s => s.pos);

  /**
   * The live transform for a seat mid-move; nothing for every other seat.
   * Transform only — the wrappers own their own positioning, and overriding it
   * here would knock a placed seat off its left/top the moment you grabbed it.
   */
  const dragStyle = (seatId: string) =>
    drag?.seatId === seatId
      ? { transform: `translate(${drag.dx}px, ${drag.dy}px)`, zIndex: 1 }
      : undefined;

  return (
    <>
      {/* The auto row — and the only thing measured for seatBandHeight, since a
          seat dragged elsewhere should not push arriving cards down. */}
      <div
        ref={bandRef}
        className="hidden md:flex absolute top-1.5 inset-x-1.5 z-30 justify-center items-start gap-2 pointer-events-none"
      >
        {inRow.map(({ o }) => (
          <div key={o.id} className="relative pointer-events-auto" style={dragStyle(o.id)}>
            <OpponentSeat
              opponent={o}
              width={widthOf(o.id)}
              onGrab={e => startDrag(o.id, e)}
              onResetPosition={() => resetSeat(o.id)}
              height={heightOf(o.id)}
              onResizeGrab={(axis, e) => startResize(o.id, axis, e)}
              onResetSize={axis => resetSize(o.id, axis)}
              sized={sizes[o.id] ?? {}}
            />
          </div>
        ))}
      </div>

      {/* Seats you have moved. After the row in DOM order so they paint on top
          of it when the two overlap. */}
      {placed.length > 0 && (
        <div className="hidden md:block absolute inset-0 z-30 pointer-events-none">
          {placed.map(({ o, pos }) => (
            <div
              key={o.id}
              className="absolute pointer-events-auto"
              style={{ left: pos!.x, top: pos!.y, ...dragStyle(o.id) }}
            >
              <OpponentSeat
                opponent={o}
                width={widthOf(o.id)}
                onGrab={e => startDrag(o.id, e)}
                onResetPosition={() => resetSeat(o.id)}
                height={heightOf(o.id)}
                onResizeGrab={(axis, e) => startResize(o.id, axis, e)}
                onResetSize={axis => resetSize(o.id, axis)}
                sized={sizes[o.id] ?? {}}
                placed
              />
            </div>
          ))}
        </div>
      )}

      {/* Pinned top-right, independent of where the seats end up. */}
      <div className="hidden md:flex absolute top-1.5 right-1.5 z-30 flex-col gap-1">
        {/* With auto-turns off, Next Turn no longer moves the table, so this is
            the only way for the bots to act. */}
        {!autoTurns && (
          <Button
            size="sm" variant="ghost"
            className="h-6 px-1.5 text-[10px] bg-background/70 backdrop-blur-sm"
            onClick={() => runAllTurns()}
            title="Run every bot's turn now (auto-turns are off in Settings → Bots)"
          >
            <Play className="w-3 h-3 mr-1" />Turn
          </Button>
        )}
        {opponents.length < MAX_OPPONENTS && (
          <Button
            size="sm" variant="ghost"
            className="h-6 w-6 p-0 bg-background/70 backdrop-blur-sm"
            onClick={() => openModal({ kind: 'opponents' })}
            title="Seat another opponent"
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </>
  );
}

/**
 * Publish the auto row's rendered height so arriving cards can snap below it.
 * The seats are opaque and always on, so without this every creature you cast
 * would land underneath them and look like it had vanished.
 *
 * Only the row is measured. A seat dragged into the middle of the table is
 * somewhere you put it deliberately, and having it shove every future card
 * down the board would be worse than the occlusion.
 */
function useSeatBandMeasure(opponentCount: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const setSeatBandHeight = usePlaytestStore(s => s.setSeatBandHeight);

  useEffect(() => {
    if (opponentCount === 0) {
      setSeatBandHeight(0);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const update = () => setSeatBandHeight(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      setSeatBandHeight(0);
    };
  }, [opponentCount, setSeatBandHeight]);

  return ref;
}

/** Seat width tracks the window, so a resize has to re-render the row. */
function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}
