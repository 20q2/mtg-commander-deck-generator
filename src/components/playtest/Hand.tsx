import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { getCardImageUrl, getCardBackFaceUrl, getFrontFaceTypeLine } from '@/services/scryfall/client';
import { PlaytestCardMenu, type CardMenuTarget } from '@/components/playtest/PlaytestCardMenu';
import { PlaytestActionsBar, ZoneActions, HandActionsButton } from '@/components/playtest/PlaytestActionsBar';
import { PlaytestPile, PILES } from '@/components/playtest/PlaytestPile';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { useMagnifyHover } from '@/components/playtest/hooks/useMagnifyHover';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { SortMode } from '@/components/playtest/types';
import type { ScryfallCard } from '@/types';

export function Hand() {
  const hand = usePlaytestStore(s => s.zones.hand);
  const moveCard = usePlaytestStore(s => s.moveCard);
  const setHoveredHandIndex = usePlaytestStore(s => s.setHoveredHandIndex);
  const flippedHandIds = usePlaytestStore(s => s.flippedHandIds);
  const [sort, setSort] = useState<SortMode>('none');
  // Conditionally RENDER the hand-row piles (not just CSS-hide) so they
  // don't share dnd-kit IDs with the mobile floating piles on the battlefield.
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [menu, setMenu] = useState<CardMenuTarget | null>(null);
  const [hoveredFanIndex, setHoveredFanIndex] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [rowWidth, setRowWidth] = useState(0);

  useEffect(() => {
    if (!rowRef.current) return;
    const el = rowRef.current;
    const update = () => setRowWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const display = sortedHand(hand, sort);
  const overlap = computeOverlap(display.length, rowWidth);
  const { flip, flight, flightLanded, endFlight } = useHandMotion(hand, sort);

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: 'hand',
    data: { kind: 'pile', zone: 'hand' },
  });

  // Each hand card is its own droppable, so sweeping over the fan hands the drop
  // to a `hand-slot` and the container's own `isOver` goes false. Both mean "this
  // is going into your hand", so the indicator watches for either — otherwise it
  // blinks off the moment you pass over a card.
  const { over } = useDndContext();
  const overHand = isOver || over?.data.current?.kind === 'hand-slot';

  const playToBattlefield = (handIndex: number) => {
    moveCard({
      source: { kind: 'zone', zone: 'hand', index: handIndex },
      target: { kind: 'battlefield', x: 50, y: 0, arrived: true },
    });
  };

  return (
    <div
      ref={setDropRef}
      className="border-t border-border/50 bg-card/30 px-2 sm:px-4 py-2 sm:py-3 flex flex-col"
    >
      {/* Toolbar row mirrors the hand row's three-column layout below so the
          action buttons center over the hand fan, not over the whole bar. The
          hairline under it separates the controls from the cards they act on.
          Negative margins cancel the wrapper's padding so the row's buttons sit
          flush against the top edge and the hairline, and the hairline itself
          runs the full width of the bar instead of stopping at the padding.
          No right padding either, so Next Turn ends on the bar's right edge.

          This hairline doubles as the hand's drop indicator: a card dragged over
          the hand lights it up. Ringing the whole container instead drew the
          highlight ABOVE the controls, which read as "drop on the toolbar". */}
      <div
        className={`relative flex items-center gap-2 mb-2 -mt-2 sm:-mt-3 -mx-2 sm:-mx-4 pl-2 sm:pl-4 border-b transition-colors duration-150 ${
          overHand ? 'border-primary' : 'border-border/40'
        }`}
      >
        {/* The bloom rides its own hairline element rather than a box-shadow on
            the row — a shadow on the row haloes the whole button strip, when the
            only thing that should light up is the line. */}
        {overHand && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-primary shadow-[0_0_8px_1px_hsl(var(--primary)/0.75)]"
          />
        )}
        {/* On a phone the label is all this column keeps: the sort select and
            the Hand actions button both fold into the toolbar's one Actions
            menu, which is the only control the phone row has room for. */}
        <div className="shrink-0 flex items-center gap-2">
          <span className="text-[10px] uppercase opacity-60 shrink-0">Hand · {hand.length}</span>
          {isDesktop && (
            <>
              <select
                value={sort}
                onChange={e => setSort(e.target.value as SortMode)}
                className="text-[10px] uppercase opacity-60 bg-transparent border border-border/50 rounded-none px-1 py-0.5 shrink-0 min-w-0"
                title="Sort hand"
              >
                <option value="none">None</option>
                <option value="cmc">CMC</option>
                <option value="type">Type</option>
              </select>
              <HandActionsButton />
            </>
          )}
        </div>
        <div className="flex-1 flex justify-center min-w-0">
          <PlaytestActionsBar sort={sort} onSortChange={setSort} />
        </div>
        {/* Right column: pure spacer, sized to the pile columns below so the
            actions bar in the middle stays centred on the table rather than
            on the row. Combat and Next Turn used to live here; they're chips
            on the table now (<TurnChips />), beside Untap. */}
        {isDesktop && (
          <div className="flex items-center gap-2 shrink-0" aria-hidden>
            <div className="shrink-0" style={{ width: 'clamp(80px, 11vw, 130px)' }} />
            <div className="shrink-0" style={{ width: 'clamp(190px, 25vw, 300px)' }} />
          </div>
        )}
      </div>
      {/* The min-height holds the row open on mobile, where no piles are
          rendered and an empty hand would collapse it. On desktop the piles
          are always there, so the row is content-sized instead — otherwise a
          narrow desktop window pads the row past the tallest column and the
          zone buttons drift down off the hairline they're aligned to. */}
      <div className="flex items-end gap-1 sm:gap-2 min-h-[140px] sm:min-h-[160px] md:min-h-0">
        {/* Desktop: Command pile on the left. Mobile: zones float on the battlefield. */}
        {isDesktop && (
          <div className="shrink-0" style={{ width: 'clamp(80px, 11vw, 130px)' }}>
            <PlaytestPile spec={PILES[0]} />
          </div>
        )}
        <div ref={rowRef} className="flex-1 flex justify-center min-w-0">
          <div className="flex items-end">
            {display.map(({ card, originalIndex }, i) => (
              <HandCard
                key={`${card.id}-${originalIndex}`}
                card={card}
                indexInHand={originalIndex}
                fanIndex={i}
                overlap={overlap}
                flippedOver={flippedHandIds.includes(card.id)}
                flipFrom={flip?.get(occurrenceKey(display, i)) ?? null}
                inFlight={flight?.index === originalIndex}
                hoveredFanIndex={hoveredFanIndex}
                onHoverChange={(h) => {
                  setHoveredFanIndex(prev => h ? i : (prev === i ? null : prev));
                  // Publish to the store too, so the Del hotkey knows which hand
                  // card is under the cursor. Uses the real hand index, not the
                  // fan position, because the row can be sorted.
                  setHoveredHandIndex(h ? originalIndex : null);
                }}
                onClickPlay={() => playToBattlefield(originalIndex)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ kind: 'hand', handIndex: originalIndex, card, x: e.clientX, y: e.clientY });
                }}
              />
            ))}
          </div>
        </div>
        {/* Desktop: Library / Graveyard / Exile on the right. Exile is half the
            width of the other two and hangs from the top — it's the zone you
            touch least, so it shouldn't claim a full card's worth of the row.

            Their widths are the command pile's minus 20px, which is what makes
            the action buttons sit flush with the hairline above them: these
            columns are bottom-aligned and carry a 24px button plus a 4px gap
            that the command column doesn't, and a 5:7 pile spends 1.4px of
            height per px of width — so 28px of button stack is exactly 20px of
            width. Exile stays half of that. */}
        {isDesktop && (
          <div className="flex items-end gap-2 shrink-0">
            {/* Deck actions ride on top of the library — draw, scry, mill and
                search all act on the deck, so the pile is both the target and
                the control. The other piles hang from the bottom of the row, so
                this column is bottom-aligned too and the buttons stack above. */}
            <div className="flex flex-col gap-1" style={{ width: 'clamp(60px, calc(11vw - 20px), 110px)' }}>
              <ZoneActions zone="library" className="w-full" />
              <PlaytestPile spec={PILES[1]} />
            </div>
            <div className="flex flex-col gap-1" style={{ width: 'clamp(60px, calc(11vw - 20px), 110px)' }}>
              <ZoneActions zone="graveyard" className="w-full" />
              <PlaytestPile spec={PILES[2]} />
            </div>
            <div className="self-start flex flex-col gap-1" style={{ width: 'clamp(30px, calc(5.5vw - 10px), 55px)' }}>
              <ZoneActions zone="exile" className="w-full" compact />
              <PlaytestPile spec={PILES[3]} />
            </div>
          </div>
        )}
      </div>
      <PlaytestCardMenu target={menu} onClose={() => setMenu(null)} />
      {flight && <HandFlight flight={flight} landed={flightLanded} onDone={endFlight} />}
    </div>
  );
}

/**
 * A card's identity for animation purposes: its printing plus which copy of
 * that printing it is, counting along the row.
 *
 * It cannot be the object reference — the library builder hands out one
 * ScryfallCard per name, so two Forests in hand are literally the same object.
 * It does not need to be stronger than this either: two copies of the same
 * card are interchangeable, so if the match picks the "wrong" Forest the
 * result is identical on screen.
 */
function occurrenceKey(display: { card: ScryfallCard }[], i: number): string {
  let n = 0;
  for (let j = 0; j < i; j++) if (display[j].card.id === display[i].card.id) n++;
  return `${display[i].card.id}#${n}`;
}

interface FlipOffset { dx: number; dy: number }

/** The card in mid-air after a drop, on its way from the cursor to its slot. */
interface Flight {
  /** Hand index of the card being flown — the real one stays hidden until it lands. */
  index: number;
  card: ScryfallCard;
  from: { x: number; y: number };
  to: { x: number; y: number };
  width: number;
}

/** Long enough to read as a settle, short enough not to be in the way. */
const FLIGHT_MS = 260;

interface HandMotion {
  flip: Map<string, FlipOffset> | null;
  flight: Flight | null;
  flightLanded: boolean;
  endFlight: () => void;
}

/**
 * Motion for the hand row after it changes.
 *
 * Two separate jobs, because the card you dropped and the cards it displaced
 * need opposite treatments:
 *
 * - Every other card FLIPs. Measure where it ended up, pin it back where it
 *   was for one paint, release it. It slides from its old slot to its new one.
 *
 * - The dropped card *flies*. It never occupied its old slot while you were
 *   dragging it, so sliding in from there would read as going backwards before
 *   going forwards. It has to come from the cursor. And it cannot be the real
 *   element doing it: a reorder changes React keys, so that element unmounts
 *   and remounts at its destination, and there is nothing continuous left to
 *   animate. So a copy flies, fixed to the viewport and immune to the row's
 *   layout, while the real card waits hidden underneath it.
 */
function useHandMotion(hand: ScryfallCard[], sort: SortMode): HandMotion {
  const previous = useRef<Map<string, number>>(new Map());
  const [flip, setFlip] = useState<Map<string, FlipOffset> | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [flightLanded, setFlightLanded] = useState(false);

  useLayoutEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-hand-index]'));
    const landing = usePlaytestStore.getState().handLanding;
    const seen = new Map<string, number>();
    const next = new Map<string, number>();
    const moves = new Map<string, FlipOffset>();
    let landingEl: HTMLElement | null = null;

    for (const el of els) {
      const id = el.dataset.cardId ?? '';
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      const key = `${id}#${n}`;
      // Layout position, not a bounding rect — a rect folds in whatever
      // transform is mid-flight, so each FLIP would compound the last.
      const left = el.offsetLeft;
      next.set(key, left);

      if (landing && Number(el.dataset.handIndex) === landing.index) {
        landingEl = el;
        continue; // the flight covers this one
      }
      const prev = previous.current.get(key);
      if (prev !== undefined && prev !== left) moves.set(key, { dx: prev - left, dy: 0 });
    }

    previous.current = next;
    if (landing) usePlaytestStore.getState().setHandLanding(null);
    // Positions are still recorded with animations off, so switching them back
    // on mid-game doesn't lurch off a stale baseline.
    if (!usePlaytestSettings.getState().animations) return;

    if (landing && landingEl) {
      const card = hand[landing.index];
      const r = landingEl.getBoundingClientRect();
      if (card) {
        setFlight({
          index: landing.index,
          card,
          from: { x: landing.x, y: landing.y },
          to: { x: r.left, y: r.top },
          width: r.width,
        });
        setFlightLanded(false);
      }
    }

    if (moves.size === 0) return;
    setFlip(moves);
    // Two frames: the first paints the cards back at their old spots with the
    // transition suppressed, the second releases them. Collapsing this into
    // one frame batches both styles into a single paint and nothing moves.
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setFlip(null));
    });
    return () => cancelAnimationFrame(raf);
  }, [hand, sort]);

  // Same two-frame dance for the flight: paint it at the cursor first, then
  // hand it a destination.
  useEffect(() => {
    if (!flight || flightLanded) return;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setFlightLanded(true));
    });
    return () => cancelAnimationFrame(raf);
  }, [flight, flightLanded]);

  // transitionend is the normal exit; the timer is the safety net for a tab
  // that was backgrounded mid-flight and never fired one.
  useEffect(() => {
    if (!flight || !flightLanded) return;
    const t = setTimeout(() => setFlight(null), FLIGHT_MS + 120);
    return () => clearTimeout(t);
  }, [flight, flightLanded]);

  return { flip, flight, flightLanded, endFlight: () => setFlight(null) };
}

/**
 * The flying card. Fixed to the viewport and portalled to <body> so no
 * ancestor's overflow, stacking context or transform can clip it on the way
 * down into the row.
 */
function HandFlight({ flight, landed, onDone }: { flight: Flight; landed: boolean; onDone: () => void }) {
  const dx = flight.to.x - flight.from.x;
  const dy = flight.to.y - flight.from.y;
  return createPortal(
    <img
      src={getCardImageUrl(flight.card, 'normal')}
      alt=""
      aria-hidden
      draggable={false}
      onTransitionEnd={onDone}
      className="fixed pointer-events-none rounded-[6px] shadow-2xl"
      style={{
        left: flight.from.x,
        top: flight.from.y,
        width: flight.width,
        zIndex: 9998,
        // Starts carrying the drag's lift — slightly large, slightly raised —
        // and gives both up as it settles, so the card looks like it is being
        // set down rather than teleporting.
        transform: landed
          ? `translate3d(${dx}px, ${dy}px, 0) scale(1)`
          : 'translate3d(0, 0, 0) scale(1.05)',
        transition: landed
          ? `transform ${FLIGHT_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
          : 'none',
      }}
    />,
    document.body,
  );
}

// Compute card overlap so the hand row always fits within rowWidth. Mirrors the
// `width: clamp(80px, 11vw, 130px)` rule on HandCard — we estimate cardW the
// same way so overlap math reflects the rendered size. A negative return value
// means a gap (no overlap); the row keeps a max 2px gap until cards no longer
// fit, then overlap kicks in as needed.
const MIN_GAP_PX = 2;
function computeOverlap(total: number, rowWidth: number): number {
  if (total <= 1) return 0;
  const cardW = Math.max(80, Math.min(130, typeof window !== 'undefined' ? window.innerWidth * 0.11 : 110));
  if (rowWidth <= 0) return -MIN_GAP_PX;
  // Minimum overlap to fit all cards in the row: total*cardW - (N-1)*overlap = rowWidth.
  const required = Math.ceil((total * cardW - rowWidth) / (total - 1));
  const maxOverlap = Math.max(0, cardW - 12);
  // Floor at -MIN_GAP_PX so cards stay nearly touching even when there's lots
  // of room; raise to `required` when they would otherwise spill over.
  return Math.min(maxOverlap, Math.max(-MIN_GAP_PX, required));
}

function sortedHand(hand: ScryfallCard[], mode: SortMode) {
  const indexed = hand.map((card, originalIndex) => ({ card, originalIndex }));
  if (mode === 'cmc') indexed.sort((a, b) => a.card.cmc - b.card.cmc);
  else if (mode === 'type') indexed.sort((a, b) => getFrontFaceTypeLine(a.card).localeCompare(getFrontFaceTypeLine(b.card)));
  return indexed;
}

interface HandCardProps {
  card: ScryfallCard;
  indexInHand: number;
  fanIndex: number;
  overlap: number;
  hoveredFanIndex: number | null;
  /** Turned over with F: shows the back face (DFC) or the card back. */
  flippedOver: boolean;
  /**
   * Set for a single frame after the row changes: how far this card has to be
   * pushed back to where it just was, so releasing it animates the move.
   */
  flipFrom: { dx: number; dy: number } | null;
  /** A copy of this card is currently flying into the slot; wait underneath it. */
  inFlight: boolean;
  onHoverChange: (hovered: boolean) => void;
  onClickPlay: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function HandCard({ card, indexInHand, fanIndex, overlap, hoveredFanIndex, flippedOver, flipFrom, inFlight, onHoverChange, onClickPlay, onContextMenu }: HandCardProps) {
  const dragId = `hand:${indexInHand}:${card.id}`;
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: dragId,
    data: { source: { kind: 'zone', zone: 'hand', index: indexInHand } },
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `hand-slot:${indexInHand}`,
    data: { kind: 'hand-slot', index: indexInHand },
  });
  const localRef = useRef<HTMLDivElement | null>(null);
  const composedRef = (node: HTMLDivElement | null) => {
    setDragRef(node);
    setDropRef(node);
    localRef.current = node;
  };
  const [hovered, setHovered] = useState(false);
  const showPreview = useMagnifyHover(hovered) && !isDragging;
  // Where a dragged card would land, if one is over the hand right now.
  const dropFanPos = usePlaytestStore(s => s.handDropFanPos);

  // Deal-in: capture the lastDrawRange at MOUNT to detect cards that were
  // freshly drawn (vs ones that just remounted because their key shifted on
  // a reorder, or arrived from another zone). Only freshly drawn cards run
  // the deal-in keyframe; everything else snaps into place without growing.
  const animations = usePlaytestSettings(s => s.animations);
  const [drawRangeAtMount] = useState(() => usePlaytestStore.getState().lastDrawRange);
  const [returnRangeAtMount] = useState(() => usePlaytestStore.getState().lastReturnRange);
  // A card you dragged into the hand already has a copy flying into this slot
  // (see useHandMotion), and the real card is supposed to wait hidden under it.
  // It cannot also deal in: a keyframe's opacity outranks the inline
  // `opacity: 0` doing the hiding, so the card would be visible twice — once
  // dropping in from above, once flying from where you let go. The flight
  // wins; it starts from the cursor rather than from nowhere in particular.
  const [landingAtMount] = useState(() => usePlaytestStore.getState().handLanding);
  const flyingIn = landingAtMount?.index === indexInHand;
  const isFreshlyDrawn =
    animations &&
    !flyingIn &&
    indexInHand >= drawRangeAtMount.start &&
    indexInHand < drawRangeAtMount.end;
  const isFreshlyReturned =
    animations &&
    !flyingIn &&
    indexInHand >= returnRangeAtMount.start &&
    indexInHand < returnRangeAtMount.end;
  // Stagger: when multiple cards arrive in the same draw/return, offset each
  // card's animation by its position in the batch so they cascade in.
  const STAGGER_MS = 70;
  const staggerIdx = isFreshlyDrawn
    ? indexInHand - drawRangeAtMount.start
    : isFreshlyReturned
      ? indexInHand - returnRangeAtMount.start
      : 0;
  const animationDelayMs = staggerIdx * STAGGER_MS;
  const [dealing, setDealing] = useState(isFreshlyDrawn || isFreshlyReturned);
  useEffect(() => {
    if (!dealing) return;
    const t = setTimeout(() => setDealing(false), 380 + animationDelayMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Turning a card over in hand mirrors the battlefield's flip: a quick
  // rotateY with the displayed face swapping at the edge-on midpoint, so you
  // never see the new face rotating in from frame 0.
  const prevFlipped = useRef(flippedOver);
  const [flipping, setFlipping] = useState(false);
  const [displayFlipped, setDisplayFlipped] = useState(flippedOver);
  useEffect(() => {
    if (prevFlipped.current === flippedOver) return;
    prevFlipped.current = flippedOver;
    if (!animations) { setDisplayFlipped(flippedOver); return; }
    setFlipping(true);
    const swap = setTimeout(() => setDisplayFlipped(flippedOver), 175);
    const end  = setTimeout(() => setFlipping(false), 380);
    return () => { clearTimeout(swap); clearTimeout(end); };
  }, [flippedOver, animations]);
  // A double-faced card turned over shows its other face; anything else shows
  // the card back, the same rule the battlefield follows.
  const faceSrc = displayFlipped
    ? (getCardBackFaceUrl(card, 'normal') ?? `${import.meta.env.BASE_URL}card-back.png`)
    : getCardImageUrl(card, 'normal');

  const dragTransform = transform ? `translate3d(${transform.x}px, ${transform.y}px, 0) scale(1.05)` : undefined;

  /**
   * Parting: while a card is being dragged over the hand, the row opens a gap
   * where it would land. Cards on each side step away from the seam rather
   * than the whole row sliding right, so the fan stays centred and the gap
   * reads as the cards making room.
   */
  const parting = dropFanPos !== null && !isDragging && !dealing;
  const partPx = (() => {
    if (!parting) return 0;
    // Wide enough to be unmistakable, and wider still when the hand is tightly
    // overlapped and a small nudge would not show.
    const gap = Math.max(26, overlap * 0.9);
    return (fanIndex >= dropFanPos ? 1 : -1) * (gap / 2);
  })();

  // Hover-fan-spread: when a sibling is hovered, push neighbors away to make
  // room. The hovered card itself lifts and scales up slightly.
  //
  // Suppressed while parting — the pointer is busy carrying a card, so any
  // hover state left over from before the drag is stale, and two competing
  // displacements would just read as jitter.
  const isHovered = !parting && hoveredFanIndex === fanIndex;
  const spreadPx = (() => {
    if (parting || isDragging || dealing || hoveredFanIndex === null || isHovered) return 0;
    const dist = fanIndex - hoveredFanIndex;
    const direction = dist > 0 ? 1 : -1;
    // Spread scales with overlap so a tightly-squeezed hand pushes neighbors
    // away more aggressively — exposing the cards adjacent to the hovered one
    // even when overlap is large. Falls off ~30% per additional neighbor.
    const baseSpread = Math.max(18, overlap * 0.75);
    const falloff = baseSpread * 0.32;
    const magnitude = Math.max(0, Math.min(overlap, baseSpread - (Math.abs(dist) - 1) * falloff));
    return direction * magnitude;
  })();

  const restingTransform = (() => {
    const parts: string[] = [];
    if (partPx) parts.push(`translateX(${partPx}px)`);
    if (spreadPx) parts.push(`translateX(${spreadPx}px)`);
    if (isHovered) {
      parts.push('translateY(-14px)');
      parts.push('scale(1.06)');
    }
    return parts.join(' ') || undefined;
  })();

  // While dealing, let the CSS keyframe drive transform — don't set an inline
  // transform (it would override the keyframe). Drag still wins if it starts.
  //
  // The FLIP frame outranks all of it: for that one paint the card is pinned
  // back where it came from, and the frame after, this goes away and the
  // transition carries it home.
  const inlineTransform = flipFrom
    ? `translate3d(${flipFrom.dx}px, ${flipFrom.dy}px, 0)`
    : isDragging
      ? dragTransform
      : dealing
        ? undefined
        : restingTransform;
  const style: React.CSSProperties = {
    marginLeft: fanIndex === 0 ? 0 : `${-overlap}px`,
    transform: inlineTransform,
    // A landing card travels over its neighbours, not under them.
    zIndex: isDragging ? 50 : flipFrom ? 40 : isHovered ? 30 : fanIndex,
    transition: flipFrom || isDragging || dealing
      ? 'none'
      : 'transform 220ms cubic-bezier(0.2, 0.9, 0.25, 1)',
    width: 'clamp(80px, 11vw, 130px)',
    cursor: isDragging ? 'grabbing' : 'pointer',
    // Hidden rather than unmounted while its copy flies in: the slot has to
    // keep its width or the row would close up and reopen as the card lands.
    opacity: isDragging || inFlight ? 0 : 1,
    ...(dealing && animationDelayMs > 0 ? { animationDelay: `${animationDelayMs}ms` } : {}),
  };

  return (
    <div
      ref={composedRef}
      {...attributes}
      {...listeners}
      onClick={onClickPlay}
      onContextMenu={onContextMenu}
      // Only mouse-type pointers trigger the lift/spread animation — taps on
      // touch devices synthesize mouseenter, but we don't want a tap to lift
      // and shift neighbors while the user is just trying to play the card.
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') { setHovered(true); onHoverChange(true); } }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') { setHovered(false); onHoverChange(false); } }}
      title={`Click to play ${card.name} · right-click for more options`}
      data-hand-index={indexInHand}
      data-card-id={card.id}
      className={`relative shrink-0 rounded-[6px] select-none touch-none ${
        isOver && !isDragging ? 'ring-2 ring-primary' : ''
      } ${dealing && !isDragging ? (isFreshlyReturned ? 'animate-deal-in-from-top' : 'animate-deal-in') : ''}`}
      style={style}
    >
      <img
        src={faceSrc}
        alt={displayFlipped ? `${card.name} (turned over)` : card.name}
        className={`w-full rounded-[6px] shadow-md pointer-events-none ${flipping ? 'animate-bf-flip' : ''}`}
        loading="lazy"
        draggable={false}
      />
      {showPreview && <MagnifiedPreview card={card} anchorRef={localRef} faceDown={displayFlipped} />}
    </div>
  );
}
