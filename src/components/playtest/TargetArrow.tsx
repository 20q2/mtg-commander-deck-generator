import { createPortal } from 'react-dom';

/**
 * The targeting arrows the table draws between two things that are pointed at
 * each other: a blocker slot aimed down at one of your creatures, and one of
 * your creatures aimed up at a seat's attack zone.
 *
 * Always portalled to <body>. It has to escape the seat: the seat uses
 * backdrop-blur, which makes it a containing block for fixed positioning, so an
 * arrow rendered in place would be trapped inside the seat instead of reaching
 * your board.
 */

export interface Point { x: number; y: number }

/** Green is blocking — you answering their attack. */
export const ARROW_BLOCK = 'rgb(52 211 153)';
/** Red is attacking — you aiming at a seat. Matches the strip's own red. */
export const ARROW_ATTACK = 'rgb(244 63 94)';

/**
 * Bow the curve out sideways so a near-vertical drag still reads as an arc
 * rather than a straight line lying on top of itself — and so two attackers
 * pointing at the same seat don't draw the same stroke twice.
 */
function arc(from: Point, to: Point) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(60, len * 0.25);
  const cx = (from.x + to.x) / 2 - (dy / len) * bow;
  const cy = (from.y + to.y) / 2 + (dx / len) * bow;
  return {
    d: `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`,
    // The head points along the tangent at the tip, which is the line from the
    // control point to the end of the curve.
    angle: (Math.atan2(to.y - cy, to.x - cx) * 180) / Math.PI,
  };
}

/** One arrow, as bare SVG. Goes inside an `ArrowLayer`. */
export function ArrowMark({
  from, to, color, width = 4, opacity = 0.95, head = 14,
}: {
  from: Point;
  to: Point;
  color: string;
  width?: number;
  opacity?: number;
  /** Length of the arrowhead, so a thin standing arrow gets a smaller tip. */
  head?: number;
}) {
  const { d, angle } = arc(from, to);
  const half = head / 2;
  return (
    <g opacity={opacity}>
      <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" />
      <circle cx={from.x} cy={from.y} r={width + 1} fill={color} />
      <polygon
        points={`0,${-half} ${head},0 0,${half}`}
        fill={color}
        transform={`translate(${to.x} ${to.y}) rotate(${angle})`}
      />
    </g>
  );
}

/** The full-viewport surface the marks are drawn on. */
export function ArrowLayer({ children, zIndex = 200 }: { children: React.ReactNode; zIndex?: number }) {
  return createPortal(
    <svg
      aria-hidden
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex, width: '100vw', height: '100vh' }}
    >
      {children}
    </svg>,
    document.body,
  );
}

/** A single live arrow — the one you're dragging right now. */
export function TargetArrow({ from, to, color = ARROW_BLOCK }: { from: Point; to: Point; color?: string }) {
  return (
    <ArrowLayer>
      <ArrowMark from={from} to={to} color={color} />
    </ArrowLayer>
  );
}
