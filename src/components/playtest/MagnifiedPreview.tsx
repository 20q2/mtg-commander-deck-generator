import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { getCardImageUrl, getCardBackFaceUrl } from '@/services/scryfall/client';
import { CARD_ASPECT } from '@/components/playtest/types';
import type { ScryfallCard } from '@/types';

interface Props {
  card: ScryfallCard;
  anchorRef: RefObject<HTMLElement | null>;
  faceDown?: boolean;
  /** Preferred placement. 'top' (default) floats above the anchor; 'right'
   *  floats beside it (used by the deck list/table/cards views). Either falls
   *  back through the remaining three sides until one has room — see
   *  PLACEMENT_ORDER. */
  side?: 'top' | 'right';
  /** Preview width in px (height derives from the card aspect). Defaults to 340. */
  width?: number;
  /** Stacking order. Defaults to 200 — under the playtest context menus at
   *  z-210. Lower it (e.g. below a popover's z-50) when the preview should sit
   *  under another overlay. */
  z?: number;
}

const DEFAULT_WIDTH = 340;
const GAP = 12;
const VIEWPORT_PAD = 8;

type Placement = 'top' | 'bottom' | 'right' | 'left';

/**
 * Where to try, in order, for each preferred side.
 *
 * The point of all four is that the preview must never sit on top of the card
 * it is magnifying — you lose the thing you were pointing at, and on the hand
 * row, where there is room for neither above nor below, that is exactly what
 * used to happen: the vertical clamp parked a 475px preview over the card.
 * Beside is always the answer in that case, so both axes are candidates and
 * the preferred side only decides which gets asked first.
 */
const PLACEMENT_ORDER: Record<'top' | 'right', Placement[]> = {
  top:   ['top', 'bottom', 'right', 'left'],
  right: ['right', 'left', 'top', 'bottom'],
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)));

export function MagnifiedPreview({ card, anchorRef, faceDown, side = 'top', width = DEFAULT_WIDTH, z = 200 }: Props) {
  const PREVIEW_WIDTH = width;
  const PREVIEW_HEIGHT = Math.round(width * CARD_ASPECT);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useLayoutEffect(() => {
    const compute = () => {
      const el = anchorRef.current;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const maxLeft = vw - PREVIEW_WIDTH - VIEWPORT_PAD;
      const maxTop = vh - PREVIEW_HEIGHT - VIEWPORT_PAD;
      // The cross axis is centred on the anchor and clamped to the viewport.
      // Clamping there only ever slides the preview ALONG the anchor's edge,
      // so it can't slide it back over the anchor.
      const centredLeft = clamp(r.left + r.width / 2 - PREVIEW_WIDTH / 2, VIEWPORT_PAD, maxLeft);
      const centredTop = clamp(r.top + r.height / 2 - PREVIEW_HEIGHT / 2, VIEWPORT_PAD, maxTop);

      /** Where a placement puts the preview, and how much room that side has. */
      const box = (p: Placement) => {
        switch (p) {
          case 'top':    return { left: centredLeft, top: r.top - PREVIEW_HEIGHT - GAP, room: r.top - VIEWPORT_PAD };
          case 'bottom': return { left: centredLeft, top: r.bottom + GAP, room: vh - VIEWPORT_PAD - r.bottom };
          case 'right':  return { left: r.right + GAP, top: centredTop, room: vw - VIEWPORT_PAD - r.right };
          case 'left':   return { left: r.left - PREVIEW_WIDTH - GAP, top: centredTop, room: r.left - VIEWPORT_PAD };
        }
      };
      const needs = (p: Placement) =>
        (p === 'top' || p === 'bottom' ? PREVIEW_HEIGHT : PREVIEW_WIDTH) + GAP;

      const order = PLACEMENT_ORDER[side];
      // First side that clears the card completely wins.
      const chosen =
        order.find(p => box(p).room >= needs(p))
        // Nothing fits: take the roomiest side. The card can end up partly
        // covered here, but only in a window too small to hold the preview
        // beside it at all — at which point there is nowhere left to go.
        ?? order.reduce((best, p) => (box(p).room > box(best).room ? p : best), order[0]);

      const { left, top } = box(chosen);
      setPos({
        left: clamp(left, VIEWPORT_PAD, maxLeft),
        top: clamp(top, VIEWPORT_PAD, maxTop),
      });
      return true;
    };

    /*
     * The anchor is not reliably attached on the commit that mounts this
     * preview. Its owners compose the anchor ref with an inline callback (drag
     * ref + drop ref + local ref, rebuilt every render), and React detaches and
     * reattaches a ref whose function identity changed — while a child's layout
     * effect runs BEFORE the parent host element's ref goes back on. So the
     * first compute can read null, and since nothing recomputes until a scroll
     * or a resize, the preview then renders nothing for as long as it is open.
     *
     * One frame later the commit is finished and the ref is back, so a retry is
     * all it takes. Kept as a fallback rather than the normal path so the usual
     * case still positions before the first paint.
     *
     * StrictMode masked this the whole time: in dev it runs every effect twice,
     * and the second pass always found the anchor — the previews only ever
     * failed in production builds.
     */
    let raf = 0;
    if (!compute()) raf = requestAnimationFrame(() => { compute(); });

    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [anchorRef, side, PREVIEW_WIDTH, PREVIEW_HEIGHT]);

  if (!pos) return null;
  // Turned over, a double-faced card shows its other face — matching the tile
  // this preview is anchored to. Everything else shows the card back.
  const src = faceDown
    ? (getCardBackFaceUrl(card, 'large') ?? `${import.meta.env.BASE_URL}card-back.png`)
    : getCardImageUrl(card, 'large');

  return createPortal(
    <div
      className="fixed pointer-events-none"
      style={{
        zIndex: z,
        left: pos.left,
        top: pos.top,
        width: PREVIEW_WIDTH,
        opacity: shown ? 1 : 0,
        transform: shown ? 'scale(1)' : 'scale(0.92)',
        transformOrigin: 'center',
        transition: 'opacity 100ms ease-out, transform 100ms ease-out',
      }}
    >
      <img
        src={src}
        alt={card.name}
        className="w-full rounded-[12px] shadow-2xl ring-1 ring-black/40"
        draggable={false}
      />
    </div>,
    document.body,
  );
}
