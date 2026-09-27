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
   *  back through the remaining three sides — see PLACEMENT_ORDER — and, among
   *  the sides with room, prefers the one covering least of what's marked
   *  AVOID_SELECTOR. */
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

/**
 * Regions a preview should cover as little of as possible, marked in the DOM
 * rather than passed down.
 *
 * The thing worth not covering is the playtest's bot seats, and the previews
 * that would cover them are raised from all over the table — your hand, your
 * battlefield, the stack, another seat. Threading a list of rects through every
 * one of those would be a prop chain per caller for a fact that is really about
 * the page, so the seats publish it instead: `data-preview-avoid="<weight>"`.
 * Anything without the attribute is invisible to this, so the non-playtest
 * callers (deck views, SpellChroma) behave exactly as before.
 *
 * The weight is what covering that region costs, so a seat swinging at you
 * outranks one that is just sitting there — see OpponentSeat for the scale.
 */
const AVOID_SELECTOR = '[data-preview-avoid]';

/**
 * How much of the preview's area has to come clear before another side beats
 * the preferred one. Without it a pixel of overlap either way would decide
 * placement, and the preview would flip sides between two near-identical cards.
 */
const OCCLUSION_EPSILON = 0.03;

interface Rect { left: number; top: number; right: number; bottom: number }

const intersection = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)));

export interface AvoidRegion { rect: Rect; weight: number }

interface PlacementInput {
  /** The element being magnified, in viewport coordinates. */
  anchor: Rect;
  viewport: { width: number; height: number };
  preview: { width: number; height: number };
  side: 'top' | 'right';
  avoid: AvoidRegion[];
}

/**
 * Which side of the anchor the preview goes on, and where that puts it.
 *
 * Pure and exported so the geometry can be checked directly — the effect below
 * only reads the rects out of the DOM and hands them over.
 */
export function choosePlacement({ anchor: r, viewport, preview, side, avoid }: PlacementInput):
  { placement: Placement; left: number; top: number } {
  const { width: pw, height: ph } = preview;
  const maxLeft = viewport.width - pw - VIEWPORT_PAD;
  const maxTop = viewport.height - ph - VIEWPORT_PAD;
  // The cross axis is centred on the anchor and clamped to the viewport.
  // Clamping there only ever slides the preview ALONG the anchor's edge,
  // so it can't slide it back over the anchor.
  const centredLeft = clamp(r.left + (r.right - r.left) / 2 - pw / 2, VIEWPORT_PAD, maxLeft);
  const centredTop = clamp(r.top + (r.bottom - r.top) / 2 - ph / 2, VIEWPORT_PAD, maxTop);

  /** Where a placement puts the preview, and how much room that side has. */
  const box = (p: Placement) => {
    switch (p) {
      case 'top':    return { left: centredLeft, top: r.top - ph - GAP, room: r.top - VIEWPORT_PAD };
      case 'bottom': return { left: centredLeft, top: r.bottom + GAP, room: viewport.height - VIEWPORT_PAD - r.bottom };
      case 'right':  return { left: r.right + GAP, top: centredTop, room: viewport.width - VIEWPORT_PAD - r.right };
      case 'left':   return { left: r.left - pw - GAP, top: centredTop, room: r.left - VIEWPORT_PAD };
    }
  };
  const needs = (p: Placement) => (p === 'top' || p === 'bottom' ? ph : pw) + GAP;

  /** Where a placement actually lands, after the viewport clamp. */
  const placed = (p: Placement): Rect => {
    const b = box(p);
    const left = clamp(b.left, VIEWPORT_PAD, maxLeft);
    const top = clamp(b.top, VIEWPORT_PAD, maxTop);
    return { left, top, right: left + pw, bottom: top + ph };
  };

  /**
   * Weighted share of the preview that lands on something worth not covering.
   * Measured against the preview's own area rather than each region's, so a
   * small seat and a large one cost the same per pixel hidden and the number
   * stays comparable between the four sides.
   */
  const previewArea = pw * ph;
  const occlusion = (p: Placement) =>
    avoid.reduce((sum, a) => sum + a.weight * intersection(placed(p), a.rect), 0) / previewArea;

  const order = PLACEMENT_ORDER[side];
  // Sides that clear the card completely, in preference order.
  const fits = order.filter(p => box(p).room >= needs(p));
  const placement = fits.length > 0
    // Among those, the one that buries the least — but only if it is
    // meaningfully clearer, so the preferred side keeps ties and the usual
    // case (nothing to avoid, every cost 0) is unchanged.
    ? fits.reduce((best, p) => (occlusion(p) < occlusion(best) - OCCLUSION_EPSILON ? p : best), fits[0])
    // Nothing fits: take the roomiest side. The card can end up partly
    // covered here, but only in a window too small to hold the preview
    // beside it at all — at which point there is nowhere left to go.
    : order.reduce((best, p) => (box(p).room > box(best).room ? p : best), order[0]);

  const { left, top } = placed(placement);
  return { placement, left, top };
}

/** Every region on the page currently asking not to be covered. */
function readAvoidRegions(): AvoidRegion[] {
  return Array.from(document.querySelectorAll<HTMLElement>(AVOID_SELECTOR))
    .map(node => ({ rect: node.getBoundingClientRect(), weight: Number(node.dataset.previewAvoid) || 1 }))
    .filter(a => a.rect.right > a.rect.left && a.rect.bottom > a.rect.top);
}

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
      const { left, top } = choosePlacement({
        anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        preview: { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT },
        side,
        avoid: readAvoidRegions(),
      });
      setPos({ left, top });
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
