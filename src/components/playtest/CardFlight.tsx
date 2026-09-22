import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { getCardImageUrl } from '@/services/scryfall/client';
import { makeInstanceId } from '@/components/playtest/utils';
import type { ScryfallCard } from '@/types';

/**
 * Cards travelling between zones under their own power.
 *
 * Some moves already explain themselves — you dragged the card, so you know
 * where it went. Bulk effects don't: a wheel empties seven cards out of your
 * hand at once, and without a flight they simply stop existing and the
 * graveyard count ticks up. This is for those.
 *
 * It carries the bots' motion too (see OpponentSeat): a draw is a card back
 * sliding out of their library, and a card cast from their hand is that back
 * arcing out over the table and turning face up as it lands on their board.
 * Same layer because the requirements are the same — measured boxes, and no
 * ancestor allowed to clip the arc — and a second one would be this one with
 * different constants.
 */

export interface Box { x: number; y: number; width: number }

interface Flight {
  id: string;
  /**
   * Absent on a face-down flight: what a bot draws is hidden information, and
   * a layer that needed the card in order to fly it would be holding the one
   * thing it must not show.
   */
  card?: ScryfallCard;
  from: Box;
  to: Box;
  /** Staggered so a seven-card discard reads as a sequence, not a blur. */
  delay: number;
  /** A card back the whole way. */
  faceDown?: boolean;
  /** Starts as a card back and turns over mid-arc, landing face up. */
  reveal?: boolean;
  /**
   * Widest the card gets at the apex, in px. Without it the card simply grows
   * from its source size to its destination size; with it the arc has a
   * flourish in the middle, which is what makes a card cast from a 20px pile
   * onto a 40px slot read as a card being PLAYED rather than a thumbnail
   * sliding between two thumbnails.
   */
  peakWidth?: number;
  /** Overrides the default flight time. */
  duration?: number;
  /** Overrides how far the arc bows out of the straight line. */
  bow?: number;
}

interface FlightState {
  flights: Flight[];
  launch: (flights: Omit<Flight, 'id'>[]) => void;
  land: (id: string) => void;
}

export const useCardFlights = create<FlightState>((set) => ({
  flights: [],
  launch: (incoming) => set(s => ({
    flights: [...s.flights, ...incoming.map(f => ({ ...f, id: makeInstanceId() }))],
  })),
  land: (id) => set(s => ({ flights: s.flights.filter(f => f.id !== id) })),
}));

/**
 * Snapshot where every card in the hand currently is, keyed by hand index.
 *
 * Has to be called *before* the discard, while the cards are still on screen —
 * afterwards there is nothing left to measure.
 */
export function captureHandBoxes(): Map<number, Box> {
  const out = new Map<number, Box>();
  for (const el of document.querySelectorAll<HTMLElement>('[data-hand-index]')) {
    const i = Number(el.dataset.handIndex);
    if (Number.isNaN(i)) continue;
    const r = el.getBoundingClientRect();
    out.set(i, { x: r.left, y: r.top, width: r.width });
  }
  return out;
}

/** The live box of an element, or null if it isn't on screen. */
export function boxOf(el: HTMLElement | null | undefined): Box | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0) return null;
  return { x: r.left, y: r.top, width: r.width };
}

/** The live box of the first element matching a selector. */
export function captureBox(selector: string): Box | null {
  return boxOf(document.querySelector<HTMLElement>(selector));
}

/**
 * Where a zone pile is right now. Measured rather than assumed, so resizing
 * the piles — or moving them, as the mobile layout does — needs no change
 * here: the flight just lands wherever the pile happens to be, at whatever
 * size it happens to be.
 */
export function captureZoneBox(zone: string): Box | null {
  return captureBox(`[data-pile="${zone}"]`);
}

const FLIGHT_MS = 420;
const STAGGER_MS = 45;

/** Fly the given hand indices into a zone pile. No-op if the pile isn't on screen. */
export function flyHandToZone(indices: number[], zone: string, boxes: Map<number, Box>, cards: ScryfallCard[]) {
  const to = captureZoneBox(zone);
  if (!to || indices.length === 0) return;
  const launch = useCardFlights.getState().launch;
  launch(
    indices
      .map((handIndex, n) => {
        const from = boxes.get(handIndex);
        const card = cards[handIndex];
        if (!from || !card) return null;
        return { card, from, to, delay: n * STAGGER_MS };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null),
  );
}

/** Mounted once. Renders whatever is currently in the air. */
export function CardFlightLayer() {
  const flights = useCardFlights(s => s.flights);
  if (flights.length === 0) return null;
  return createPortal(
    <div aria-hidden className="fixed inset-0 pointer-events-none" style={{ zIndex: 9997 }}>
      {flights.map(f => <FlyingCard key={f.id} flight={f} />)}
    </div>,
    document.body,
  );
}

function FlyingCard({ flight }: { flight: Flight }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const flipRef = useRef<HTMLDivElement | null>(null);
  const land = useCardFlights(s => s.land);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { from, to } = flight;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    // Every size is a scale off the base width the element is laid out at,
    // which is the WIDEST the card will ever be. Laying it out small and
    // scaling up is the same geometry but rasterized at the small size, so a
    // card that quadruples on the way past the middle of the table arrives
    // having looked like a thumbnail stretched over a card.
    const base = Math.max(from.width, to.width, flight.peakWidth ?? 0) || 1;
    const start = from.width / base;
    const scale = to.width / base;
    const peak = (flight.peakWidth ?? (from.width + to.width) / 2) / base;
    // The dip: bow the path perpendicular to the direction of travel so the
    // card swings out and settles rather than sliding along a ruled line.
    const len = Math.hypot(dx, dy) || 1;
    const bow = flight.bow ?? Math.min(90, len * 0.22);
    const midX = dx / 2 - (dy / len) * bow;
    const midY = dy / 2 + (dx / len) * bow;
    const duration = flight.duration ?? FLIGHT_MS;
    // A card being turned over lands square. The tilt is for the ones being
    // thrown away, where it reads as the card spinning off.
    const tilt = flight.reveal ? 0 : -8;

    const animation = el.animate(
      [
        { transform: `translate3d(0,0,0) scale(${start}) rotate(0deg)`, opacity: 1, offset: 0 },
        {
          transform: `translate3d(${midX}px, ${midY}px, 0) scale(${peak}) rotate(${tilt}deg)`,
          opacity: 1,
          offset: 0.55,
        },
        {
          transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scale}) rotate(0deg)`,
          // A card being played lands solid — the real one takes over from it.
          // A card being thrown away fades, because nothing takes over.
          opacity: flight.reveal ? 1 : 0.85,
          offset: 1,
        },
      ],
      {
        duration,
        delay: flight.delay,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        fill: 'both',
      },
    );
    // The turn-over, on its own element so it composes with the arc instead of
    // fighting it for the transform. Held face-down through the first fifth so
    // the flip happens out over the table rather than on the pile.
    const flip = flight.reveal && flipRef.current
      ? flipRef.current.animate(
          [
            { transform: 'rotateY(180deg)', offset: 0 },
            { transform: 'rotateY(180deg)', offset: 0.2 },
            { transform: 'rotateY(0deg)', offset: 0.78 },
            { transform: 'rotateY(0deg)', offset: 1 },
          ],
          { duration, delay: flight.delay, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'both' },
        )
      : null;
    animation.onfinish = () => land(flight.id);
    // A cancel still has to clear the flight, or a card stays frozen mid-air.
    animation.oncancel = () => land(flight.id);
    return () => { animation.cancel(); flip?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const face = flight.card ? getCardImageUrl(flight.card, 'normal') : null;
  const showBack = flight.faceDown || flight.reveal;

  return (
    <div
      ref={ref}
      className="absolute"
      style={{
        left: flight.from.x,
        top: flight.from.y,
        // The base width, scaled down to the source size by the animation's
        // first keyframe. See the scale maths above.
        width: Math.max(flight.from.width, flight.to.width, flight.peakWidth ?? 0),
        // Scaling toward the pile's top-left keeps the card's corner on the
        // pile's corner, so it lands in the box rather than centred over it.
        transformOrigin: 'top left',
        perspective: 900,
      }}
    >
      <div
        ref={flipRef}
        className="relative"
        style={{
          transformStyle: 'preserve-3d',
          // The pre-animation state, so a revealed card never paints a frame
          // of its face before the flip has started.
          transform: showBack ? 'rotateY(180deg)' : undefined,
        }}
      >
        {face && (
          <img
            src={face}
            alt=""
            draggable={false}
            className="w-full rounded-[6px] shadow-2xl"
            style={{ backfaceVisibility: 'hidden' }}
          />
        )}
        {showBack && (
          <img
            src={`${import.meta.env.BASE_URL}card-back.png`}
            alt=""
            draggable={false}
            className={`w-full rounded-[6px] shadow-2xl ${face ? 'absolute inset-0 h-full' : ''}`}
            style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden' }}
          />
        )}
      </div>
    </div>
  );
}
