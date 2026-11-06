import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * A defeated bot's cards blowing away as dust.
 *
 * Every card image on the seat is cut into a grid of tiles, each tile showing
 * its own patch of the card's art, and the tiles drift off up and to the right
 * and fade. The delays come from a single wave front sweeping left to right
 * across the whole seat rather than from card order, so a board comes apart
 * the way one image would: the left edge goes first and the wind carries on
 * through it, cards and lands and piles alike.
 *
 * Purely a layer on top. The seat hides its real images the moment it is
 * defeated, and these tiles start exactly where those images were, so the
 * swap cannot be seen. Nothing here touches the game state — reviving the
 * bot brings the board back as it was.
 *
 * Drawn on one canvas rather than as a div per tile. A board's worth of dust
 * is a couple of thousand pieces; as elements that was a half-second stall to
 * mount them and a compositor layer each to move them, which dropped the
 * animation to a stutter. The canvas paints straight from the seat's own
 * <img> elements, which are hidden but still loaded — drawing a cross-origin
 * image is allowed, only reading the pixels back is not, and nothing here does.
 */

export interface DustPiece {
  img: HTMLImageElement;
  /** Centre of the image on screen. */
  cx: number;
  cy: number;
  /** Layout size, before any rotation. */
  w: number;
  h: number;
  /** 90 for a tapped card, which the seat draws with `rotate-90`. */
  rot: 0 | 90;
}

/** How long the wave takes to cross the seat. */
const WAVE_MS = 1100;
/** Random spread on each tile's start, so the front is ragged rather than a ruler line. */
const JITTER_MS = 320;
const MIN_DUR_MS = 850;
const MAX_DUR_MS = 1350;
/**
 * The most tiles a whole seat may spawn. A big board spends it on more,
 * coarser cards; a small one gets finer dust.
 */
const TILE_BUDGET = 2400;

/** Total time the layer needs before it can be taken down. */
export const DUST_TOTAL_MS = WAVE_MS + JITTER_MS + MAX_DUR_MS + 100;

/** Reads the card images under `root` matching `selector` off the DOM, ready to be dusted. */
export function captureDust(root: HTMLElement, selector = 'img'): DustPiece[] {
  const pieces: DustPiece[] = [];
  root.querySelectorAll<HTMLImageElement>(selector).forEach(img => {
    // An image still loading has nothing to draw.
    if (!img.complete || img.naturalWidth === 0) return;
    const r = img.getBoundingClientRect();
    const w = img.offsetWidth;
    const h = img.offsetHeight;
    if (w < 2 || h < 2) return;
    // A tapped card's box on screen is its layout box turned on its side.
    const turned = Math.abs(w - h) > 2 && Math.abs(r.width - h) < 2 && Math.abs(r.height - w) < 2;
    pieces.push({
      img,
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      w, h,
      rot: turned ? 90 : 0,
    });
  });
  return pieces;
}

interface Tile {
  piece: DustPiece;
  /** Source rectangle, in the image's own pixels. */
  sx: number; sy: number; sw: number; sh: number;
  /** Destination size, and the tile's centre relative to the card's centre, in the card's frame. */
  w: number; h: number; lx: number; ly: number;
  /** Drift on screen, spin, and timing. */
  dx: number; dy: number; spin: number; delay: number; dur: number;
}

function cutTiles(pieces: DustPiece[]): Tile[] {
  if (pieces.length === 0) return [];
  const left = Math.min(...pieces.map(p => p.cx - Math.max(p.w, p.h) / 2));
  const right = Math.max(...pieces.map(p => p.cx + Math.max(p.w, p.h) / 2));
  const span = Math.max(1, right - left);
  const cols = Math.max(3, Math.min(10, Math.round(Math.sqrt(TILE_BUDGET / (pieces.length * 1.4)))));
  const tiles: Tile[] = [];
  for (const p of pieces) {
    const rows = Math.max(3, Math.round(cols * p.h / p.w));
    const tw = p.w / cols;
    const th = p.h / rows;
    const kx = p.img.naturalWidth / p.w;
    const ky = p.img.naturalHeight / p.h;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lx = (c + 0.5) * tw - p.w / 2;
        const ly = (r + 0.5) * th - p.h / 2;
        // Where this tile sits on screen, for its place in the wave. A tapped
        // card turns its frame a quarter clockwise, the way rotate-90 does.
        const sx = p.rot === 90 ? p.cx - ly : p.cx + lx;
        tiles.push({
          piece: p,
          sx: c * tw * kx, sy: r * th * ky, sw: tw * kx, sh: th * ky,
          // A hair oversized so neighbouring tiles overlap and no seam of
          // table shows through the card before the wave reaches it.
          w: tw + 0.6, h: th + 0.6, lx, ly,
          dx: 30 + Math.random() * 70,
          dy: -(10 + Math.random() * 55),
          spin: (Math.random() - 0.5) * 2.4,
          delay: ((sx - left) / span) * WAVE_MS + Math.random() * JITTER_MS,
          dur: MIN_DUR_MS + Math.random() * (MAX_DUR_MS - MIN_DUR_MS),
        });
      }
    }
  }
  return tiles;
}

/** Slow to lift, then carried off — the same curve as an ease-in. */
const easeIn = (t: number) => t * t * t;

export function SeatDust({ pieces, onDone }: { pieces: DustPiece[]; onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Layout effect, and the first frame drawn before it returns: the seat hid
  // its images in this same commit, so the dust has to be on screen in the
  // same paint or the board blinks out for a frame before it blows away.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) { onDone(); return; }
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);

    const tiles = cutTiles(pieces);
    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = now - start;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const tile of tiles) {
        const k = Math.min(1, Math.max(0, (t - tile.delay) / tile.dur));
        if (k >= 1) continue;
        const e = easeIn(k);
        const p = tile.piece;
        // Into the card's frame (turned, for a tapped card), to the tile's own
        // centre, then out along its drift, which is in screen terms.
        ctx.setTransform(dpr, 0, 0, dpr, (p.cx + tile.dx * e) * dpr, (p.cy + tile.dy * e) * dpr);
        if (p.rot) ctx.rotate(Math.PI / 2);
        ctx.translate(tile.lx, tile.ly);
        ctx.rotate(tile.spin * e);
        const s = 1 - 0.65 * e;
        ctx.scale(s, s);
        ctx.globalAlpha = k < 0.25 ? 1 - 0.4 * k : 0.9 * (1 - (k - 0.25) / 0.75);
        ctx.drawImage(p.img, tile.sx, tile.sy, tile.sw, tile.sh, -tile.w / 2, -tile.h / 2, tile.w, tile.h);
      }
      if (t < DUST_TOTAL_MS) raf = requestAnimationFrame(frame);
      else onDone();
    };
    frame(start);
    return () => cancelAnimationFrame(raf);
  }, [pieces, onDone]);

  return createPortal(
    <canvas
      ref={canvasRef}
      aria-hidden
      className="fixed inset-0 pointer-events-none"
      style={{ width: '100vw', height: '100vh', zIndex: 9996 }}
    />,
    document.body,
  );
}
