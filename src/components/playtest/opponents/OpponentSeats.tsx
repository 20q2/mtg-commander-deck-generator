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

/** Seat placements survive a reload; they're layout, not game state. */
const POSITIONS_KEY = 'playtest-seat-positions';

/** Keyed by seat index rather than opponent id, so re-seating keeps your layout. */
type SeatPositions = Record<number, { x: number; y: number }>;

function loadPositions(): SeatPositions {
  try {
    const raw = localStorage.getItem(POSITIONS_KEY);
    return raw ? (JSON.parse(raw) as SeatPositions) : {};
  } catch {
    return {};
  }
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
  /**
   * The in-flight move, as an offset from wherever the seat already sits.
   *
   * It has to be an offset rather than a committed position: promoting a seat
   * out of the auto row into the placed layer mid-drag would unmount the very
   * element holding the pointer capture, and the gesture would die on the
   * first move. So the seat stays exactly where it is in the DOM and slides
   * under a transform, and only lands in the other layer on release.
   */
  const [drag, setDrag] = useState<{ index: number; dx: number; dy: number } | null>(null);

  const persist = useCallback((next: SeatPositions) => {
    setPositions(next);
    try { localStorage.setItem(POSITIONS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  }, []);

  const width = Math.max(
    MIN_SEAT_WIDTH,
    Math.min(MAX_SEAT_WIDTH, Math.round((viewportWidth * USABLE_FRACTION) / Math.max(1, opponents.length))),
  );

  /**
   * Drag a seat by its name. Pointer capture rather than window listeners so a
   * fast drag that outruns the handle cannot drop the gesture — the same
   * reason the old column's resize handle worked this way.
   */
  const startDrag = useCallback((index: number, e: React.PointerEvent<HTMLElement>) => {
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
      setDrag({ index, dx: landed.x - baseX, dy: landed.y - baseY });
    };
    const onUp = (ev: PointerEvent) => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      try { handle.releasePointerCapture(ev.pointerId); } catch { /* already gone */ }
      setDrag(null);
      // Write through once at the end rather than on every frame.
      persist({ ...loadPositions(), [index]: landed });
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }, [persist]);

  const resetSeat = useCallback((index: number) => {
    const next = { ...loadPositions() };
    delete next[index];
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

  const seated = opponents.map((o, index) => ({ o, index, pos: positions[index] }));
  const inRow = seated.filter(s => !s.pos);
  const placed = seated.filter(s => s.pos);

  /**
   * The live transform for a seat mid-move; nothing for every other seat.
   * Transform only — the wrappers own their own positioning, and overriding it
   * here would knock a placed seat off its left/top the moment you grabbed it.
   */
  const dragStyle = (index: number) =>
    drag?.index === index
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
        {inRow.map(({ o, index }) => (
          <div key={o.id} className="relative pointer-events-auto" style={dragStyle(index)}>
            <OpponentSeat
              opponent={o}
              width={width}
              onGrab={e => startDrag(index, e)}
              onResetPosition={() => resetSeat(index)}
            />
          </div>
        ))}
      </div>

      {/* Seats you have moved. After the row in DOM order so they paint on top
          of it when the two overlap. */}
      {placed.length > 0 && (
        <div className="hidden md:block absolute inset-0 z-30 pointer-events-none">
          {placed.map(({ o, index, pos }) => (
            <div
              key={o.id}
              className="absolute pointer-events-auto"
              style={{ left: pos!.x, top: pos!.y, ...dragStyle(index) }}
            >
              <OpponentSeat
                opponent={o}
                width={width}
                onGrab={e => startDrag(index, e)}
                onResetPosition={() => resetSeat(index)}
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
