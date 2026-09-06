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
 */

interface Box { x: number; y: number; width: number }

interface Flight {
  id: string;
  card: ScryfallCard;
  from: Box;
  to: Box;
  /** Staggered so a seven-card discard reads as a sequence, not a blur. */
  delay: number;
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

/**
 * Where a zone pile is right now. Measured rather than assumed, so resizing
 * the piles — or moving them, as the mobile layout does — needs no change
 * here: the flight just lands wherever the pile happens to be, at whatever
 * size it happens to be.
 */
export function captureZoneBox(zone: string): Box | null {
  const el = document.querySelector<HTMLElement>(`[data-pile="${zone}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width };
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
      .filter((f): f is Omit<Flight, 'id'> => f !== null),
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
  const ref = useRef<HTMLImageElement | null>(null);
  const land = useCardFlights(s => s.land);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { from, to } = flight;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    // Scale is derived from the two measured widths, so the card arrives
    // exactly the size of the pile whatever that size happens to be.
    const scale = from.width > 0 ? to.width / from.width : 1;
    // The dip: bow the path perpendicular to the direction of travel so the
    // card swings out and settles rather than sliding along a ruled line.
    const len = Math.hypot(dx, dy) || 1;
    const bow = Math.min(90, len * 0.22);
    const midX = dx / 2 - (dy / len) * bow;
    const midY = dy / 2 + (dx / len) * bow;

    const animation = el.animate(
      [
        { transform: 'translate3d(0,0,0) scale(1) rotate(0deg)', opacity: 1, offset: 0 },
        {
          transform: `translate3d(${midX}px, ${midY}px, 0) scale(${(1 + scale) / 2}) rotate(-8deg)`,
          opacity: 1,
          offset: 0.55,
        },
        {
          transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scale}) rotate(0deg)`,
          opacity: 0.85,
          offset: 1,
        },
      ],
      {
        duration: FLIGHT_MS,
        delay: flight.delay,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        fill: 'both',
      },
    );
    animation.onfinish = () => land(flight.id);
    // A cancel still has to clear the flight, or a card stays frozen mid-air.
    animation.oncancel = () => land(flight.id);
    return () => animation.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <img
      ref={ref}
      src={getCardImageUrl(flight.card, 'normal')}
      alt=""
      draggable={false}
      className="absolute rounded-[5px] shadow-2xl"
      style={{
        left: flight.from.x,
        top: flight.from.y,
        width: flight.from.width,
        // Scaling toward the pile's top-left keeps the card's corner on the
        // pile's corner, so it lands in the box rather than centred over it.
        transformOrigin: 'top left',
      }}
    />
  );
}
