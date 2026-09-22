import { create } from 'zustand';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';

/**
 * A card that gets killed is cut in two where it stands.
 *
 * Death used to be a card simply not being there any more: a blocker trades, a
 * bot points a Murder at your commander, and the board is one card shorter with
 * nothing to tell you which card it was. The slash is the missing beat — the
 * same bill-line cut the brew Headliner uses to strike a card off the lineup
 * (--card-cut-top/-bottom in index.css), with the halves spinning apart as the
 * card drops into the graveyard.
 *
 * Nothing here is in the game's layout. The permanent leaves the battlefield
 * the instant it dies, exactly as before, and the slash plays over the gap.
 */

/** One slash's lifetime. Must match the animation duration in index.css. */
export const SLASH_MS = 620;

/** A sweeper reads as a sequence of kills rather than one indistinct mess. */
const STAGGER_MS = 55;
/** ...but a ten-card wipe must not take two seconds to finish landing. */
const MAX_STAGGER = 330;
/** Slashes launched within this of each other are one burst, and stagger. */
const BURST_GAP_MS = 120;

export interface Slash {
  id: string;
  /** Read off the live element, so a face-down card dies face-down. */
  src: string;
  /** Viewport box of the upright card — the layer renders fixed. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Whatever the card was turned to, so the cut lands on the card as seen. */
  rotation: number;
  delay: number;
}

interface State {
  slashes: Slash[];
}

export const useCardSlashes = create<State>(() => ({ slashes: [] }));

let seq = 0;
let lastAt = -Infinity;
let burst = 0;

/**
 * How far the card is turned on screen. The tap rotation lives on a different
 * element on your board (an inner wrapper) than on a bot's (the image itself),
 * so rather than know which, walk from the image out to the anchor and total up
 * whatever rotation lies on the way.
 */
function rotationOf(root: HTMLElement, img: HTMLElement): number {
  let deg = 0;
  for (let node: HTMLElement | null = img; node; node = node.parentElement) {
    const transform = getComputedStyle(node).transform;
    if (transform && transform !== 'none') {
      try {
        const m = new DOMMatrixReadOnly(transform);
        deg += (Math.atan2(m.b, m.a) * 180) / Math.PI;
      } catch {
        // An unparseable transform just means no rotation worth reading.
      }
    }
    if (node === root) break;
  }
  return Math.round(deg);
}

/**
 * Cut a card in two where it stands.
 *
 * Call it while the card is still on the board: the geometry and the art are
 * measured off the live element, and a moment later there is nothing left to
 * measure. A card that is not on screen — a bot's board on a narrow phone, a
 * permanent already gone — silently skips, the way a float does.
 */
export function slashCard(instanceId: string) {
  if (typeof document === 'undefined') return;
  if (!usePlaytestSettings.getState().animations) return;

  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(instanceId) : instanceId;
  const el = document.querySelector<HTMLElement>(`[data-float-id="${escaped}"]`);
  const img = el?.querySelector('img');
  if (!el || !img) return;

  // The image's own layout box, which is the card upright — `el` is the slot
  // it sits in, and on a bot's board that slot is the card's turned footprint
  // while it is tapped, so measuring it would hand the layer a transposed box.
  // getBoundingClientRect does include the rotation, but a rotation about the
  // centre leaves the centre where it is, so it still says where to draw.
  const box = img.getBoundingClientRect();
  const width = img.offsetWidth || box.width;
  const height = img.offsetHeight || box.height;
  if (width === 0 || height === 0) return;

  const now = performance.now();
  if (now - lastAt > BURST_GAP_MS) burst = 0;
  lastAt = now;
  const delay = Math.min(burst++ * STAGGER_MS, MAX_STAGGER);

  const id = `slash-${++seq}`;
  useCardSlashes.setState(s => ({
    slashes: [
      ...s.slashes,
      {
        id,
        // currentSrc is what the browser actually painted, so the overlay comes
        // up on an already-decoded image rather than blinking in.
        src: img.currentSrc || img.src,
        x: box.left + box.width / 2 - width / 2,
        y: box.top + box.height / 2 - height / 2,
        width,
        height,
        rotation: rotationOf(el, img),
        delay,
      },
    ],
  }));

  setTimeout(
    () => useCardSlashes.setState(s => ({ slashes: s.slashes.filter(x => x.id !== id) })),
    delay + SLASH_MS,
  );
}
