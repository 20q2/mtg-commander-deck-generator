import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { getCardImageUrl } from '@/services/scryfall/client';
import type { ScryfallCard } from '@/types';

interface Props {
  card: ScryfallCard;
  anchorRef: RefObject<HTMLElement | null>;
  faceDown?: boolean;
  /** Preferred placement. 'top' (default) floats above the anchor; 'right'
   *  floats beside it (used by the deck list/table/cards views). Both flip to
   *  the opposite side and clamp to the viewport when there isn't room. */
  side?: 'top' | 'right';
  /** Preview width in px (height derives from the card aspect). Defaults to 340. */
  width?: number;
  /** Stacking order. Defaults to 200; lower it (e.g. below a popover's z-50)
   *  when the preview should sit under another overlay. */
  z?: number;
}

const DEFAULT_WIDTH = 340;
const ASPECT = 1.396;
const GAP = 12;
const VIEWPORT_PAD = 8;

export function MagnifiedPreview({ card, anchorRef, faceDown, side = 'top', width = DEFAULT_WIDTH, z = 200 }: Props) {
  const PREVIEW_WIDTH = width;
  const PREVIEW_HEIGHT = Math.round(width * ASPECT);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useLayoutEffect(() => {
    const compute = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left: number;
      let top: number;
      if (side === 'right') {
        // Beside the anchor, vertically centered on it; flip to the left if it
        // would run off the right edge, then clamp both axes to the viewport.
        left = r.right + GAP;
        if (left + PREVIEW_WIDTH > vw - VIEWPORT_PAD) left = r.left - PREVIEW_WIDTH - GAP;
        left = Math.max(VIEWPORT_PAD, Math.min(left, vw - PREVIEW_WIDTH - VIEWPORT_PAD));
        top = r.top + r.height / 2 - PREVIEW_HEIGHT / 2;
        top = Math.max(VIEWPORT_PAD, Math.min(top, vh - PREVIEW_HEIGHT - VIEWPORT_PAD));
      } else {
        top = r.top - PREVIEW_HEIGHT - GAP;
        if (top < VIEWPORT_PAD) top = r.bottom + GAP;
        if (top + PREVIEW_HEIGHT > vh - VIEWPORT_PAD) {
          top = Math.max(VIEWPORT_PAD, vh - PREVIEW_HEIGHT - VIEWPORT_PAD);
        }
        left = r.left + r.width / 2 - PREVIEW_WIDTH / 2;
        left = Math.max(VIEWPORT_PAD, Math.min(left, vw - PREVIEW_WIDTH - VIEWPORT_PAD));
      }
      setPos({ left, top });
    };
    compute();
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [anchorRef, side, PREVIEW_WIDTH, PREVIEW_HEIGHT]);

  if (!pos) return null;
  const src = faceDown ? `${import.meta.env.BASE_URL}card-back.png` : getCardImageUrl(card, 'large');

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
