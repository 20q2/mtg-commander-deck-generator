import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StackItem } from '@/components/playtest/opponentTypes';

/**
 * The board-side half of the stack panel: an arrow from the waiting spell to
 * everything it is pointed at, and a ring around each doomed card.
 *
 * This is the whole reason the stack is worth having. "Go for the Throat" in a
 * log line is a sentence you have to read and then go hunting for; an arrow
 * landing on your Llanowar Elves is a thing you have already understood.
 *
 * Portalled to <body> for the same reason the combat strip's arrow is: the
 * panel and the seats both use backdrop-blur, which makes them containing
 * blocks for fixed positioning, so an overlay rendered in place would be
 * trapped inside the panel instead of reaching your board.
 */

interface Rect { x: number; y: number; w: number; h: number }
interface Point { x: number; y: number }

function rectOf(el: Element | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

export function StackTargeting({
  item, anchor,
}: {
  item: StackItem;
  /** The stack card in the panel — where the arrows are drawn from. */
  anchor: HTMLElement | null;
}) {
  const [geom, setGeom] = useState<{ from: Point; targets: Rect[] } | null>(null);
  const ids = item.effect.destroy.join(',');

  // Measured on a frame loop rather than once on mount: your board moves while
  // the spell is waiting — that is the point of the window — and an arrow left
  // pointing at where a creature used to be is worse than no arrow at all.
  useEffect(() => {
    if (!anchor || item.effect.destroy.length === 0) {
      setGeom(null);
      return;
    }
    let raf = 0;
    let last = '';
    const tick = () => {
      const a = rectOf(anchor);
      const targets = item.effect.destroy
        .map(id => rectOf(document.querySelector(`[data-bf-card="${CSS.escape(id)}"]`)))
        .filter((r): r is Rect => r !== null);
      const next = a && targets.length > 0
        ? { from: { x: a.x, y: a.y + a.h / 2 }, targets }
        : null;
      // Only re-render when something actually moved. A setState every frame
      // for a static board would re-render the whole overlay 60 times a second
      // for no visible difference.
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setGeom(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anchor, ids, item.effect.destroy]);

  if (!geom) return null;

  return createPortal(
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 190 }} aria-hidden>
      <svg className="absolute inset-0 w-full h-full">
        {geom.targets.map((t, i) => (
          <Arrow key={i} from={geom.from} to={{ x: t.x + t.w / 2, y: t.y + t.h / 2 }} />
        ))}
      </svg>
      {geom.targets.map((t, i) => (
        <div
          key={i}
          className="absolute rounded-[6px] ring-2 ring-rose-400/90 shadow-[0_0_18px_rgba(244,63,94,0.55)] animate-pulse"
          style={{ left: t.x - 3, top: t.y - 3, width: t.w + 6, height: t.h + 6 }}
        />
      ))}
    </div>,
    document.body,
  );
}

/** One bowed arrow, head at the target. Same curve as the combat strip's. */
function Arrow({ from, to }: { from: Point; to: Point }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(70, len * 0.22);
  const cx = (from.x + to.x) / 2 - (dy / len) * bow;
  const cy = (from.y + to.y) / 2 + (dx / len) * bow;
  const angle = (Math.atan2(to.y - cy, to.x - cx) * 180) / Math.PI;
  const stroke = 'rgb(251 113 133)';

  return (
    <g>
      <path
        d={`M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`}
        fill="none"
        stroke={stroke}
        strokeWidth={3}
        strokeLinecap="round"
        opacity={0.9}
      />
      <circle cx={from.x} cy={from.y} r={4} fill={stroke} />
      <polygon
        points="0,-6 12,0 0,6"
        fill={stroke}
        transform={`translate(${to.x} ${to.y}) rotate(${angle})`}
      />
    </g>
  );
}
