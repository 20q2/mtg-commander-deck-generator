import { useLayoutEffect, useRef, useState } from 'react';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { useMediaQuery } from '@/hooks/useMediaQuery';

/**
 * A life total that rolls to its new value like an odometer reel instead of
 * snapping to it.
 *
 * The point is legibility of *change*: a bot drains you for 7 and the number
 * was already replaced by the time your eye got there. Spinning the digits
 * through the values in between makes the size of the hit readable from the
 * motion alone, before you've read either number.
 *
 * Each digit column is its own strip of the values it passes through, so a
 * 40 -> 37 hit spins the ones column down through 9 and 8 — a real borrow —
 * while the tens column clicks down a single notch. A strip only ever contains
 * the frames that particular column actually travels, which is why a +1 is a
 * single notch and a typed-in 40 -> 3 is a long spin: the duration is drawn
 * from the longest column's travel rather than being fixed.
 *
 * Direction comes from the DOM order of the frames, not from the sign of the
 * transform: losing life stacks them in reverse and ends at offset zero, so
 * the strip travels *down* and the new total enters from above. Gaining life
 * reads the other way round for free.
 */

// The column a number grows into (9 -> 10) or vacates (10 -> 9) has no digit on
// one side of the roll. It still needs a frame to travel from, and it has to
// occupy a full cell so the neighbouring columns don't slide sideways mid-roll.
const BLANK = '\u2007'; // figure space — exactly one tabular digit wide

interface Column {
  frames: string[];
  from: number;
  to: number;
}

interface Roll {
  id: number;
  columns: Column[];
  duration: number;
  width: number;
}

/**
 * The frames one column passes through. Digits walk one step at a time in the
 * direction of travel and wrap at the ends of 0-9, which is what produces the
 * borrow; anything else (a blank, a minus sign) can't be walked, so it's a
 * straight two-frame cut.
 */
function framePath(from: string, to: string, dir: 1 | -1): string[] {
  if (from === to) return [from];

  const a = from >= '0' && from <= '9' ? Number(from) : null;
  const b = to >= '0' && to <= '9' ? Number(to) : null;
  if (a === null || b === null) return [from, to];

  const path = [from];
  let d = a;
  for (let i = 0; i < 10; i++) {
    d = (d + dir + 10) % 10;
    path.push(String(d));
    if (d === b) break;
  }
  return path;
}

function buildRoll(prev: number, next: number, id: number): Roll {
  const dir: 1 | -1 = next < prev ? -1 : 1;
  const a = String(prev);
  const b = String(next);
  const width = Math.max(a.length, b.length);

  let travel = 0;
  const columns = Array.from({ length: width }, (_, i) => {
    const path = framePath(
      a.padStart(width, BLANK)[i],
      b.padStart(width, BLANK)[i],
      dir,
    );
    travel = Math.max(travel, path.length - 1);
    // Reversing for a loss is what sends the strip downward: the value we're
    // leaving sits at the bottom of the stack and we animate back up to zero.
    return dir < 0
      ? { frames: path.slice().reverse(), from: path.length - 1, to: 0 }
      : { frames: path, from: 0, to: path.length - 1 };
  });

  return { id, columns, width, duration: Math.min(640, 230 + travel * 60) };
}

export function RollingNumber({ value, className = '' }: { value: number; className?: string }) {
  const animations = usePlaytestSettings(s => s.animations);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const enabled = animations && !reduced;

  const [roll, setRoll] = useState<Roll | null>(null);
  const strips = useRef<(HTMLSpanElement | null)[]>([]);
  const overlay = useRef<HTMLSpanElement | null>(null);
  // The value the last roll was aimed at, which is what the next one starts
  // from — a hit landing mid-spin should carry on from where this one was
  // headed rather than from wherever the reel happens to be.
  const aimed = useRef(value);
  const seq = useRef(0);

  useLayoutEffect(() => {
    const prev = aimed.current;
    aimed.current = value;
    if (prev === value) return;
    if (!enabled) { setRoll(null); return; }
    setRoll(buildRoll(prev, value, ++seq.current));
  }, [value, enabled]);

  // Driven through the Web Animations API rather than a CSS transition because
  // the strips are freshly mounted: a transition needs a committed start frame
  // to animate away from, and there isn't one.
  //
  // `frame` is the height of one cell, and it's measured off the overlay rather
  // than assumed to be 1em. An em is not a line box, so a reel built out of 1em
  // cells made the pill change height for the length of every roll. The overlay
  // is pinned to the sizer, so its height is exactly the line box the number
  // sits in — whatever font-size and leading the call site is in — and reading
  // it after React commits but before the browser paints means the un-clipped
  // strip never reaches the screen.
  useLayoutEffect(() => {
    if (!roll) return;

    const box = overlay.current;
    const frame = box?.getBoundingClientRect().height ?? 0;
    // A collapsed or hidden seat measures zero; snap rather than animate to a
    // garbage offset.
    if (!box || !frame) { setRoll(null); return; }

    // One write, and the cells pick it up through `height: var(--reel-cell)` —
    // the height and the offsets that have to agree with it stay derived from
    // a single number.
    box.style.setProperty('--reel-cell', `${frame}px`);

    const running = roll.columns.map((col, i) => {
      const strip = strips.current[i];
      if (!strip) return null;
      strip.style.transform = `translateY(${-col.to * frame}px)`;
      if (col.from === col.to) return null;
      return strip.animate(
        [
          { transform: `translateY(${-col.from * frame}px)` },
          { transform: `translateY(${-col.to * frame}px)` },
        ],
        { duration: roll.duration, easing: 'cubic-bezier(0.22, 0.86, 0.26, 1)' },
      );
    });

    const done = setTimeout(() => setRoll(r => (r?.id === roll.id ? null : r)), roll.duration + 40);
    return () => {
      clearTimeout(done);
      running.forEach(a => a?.cancel());
    };
  }, [roll]);

  // The number itself always stays in the flow, and the reel is painted over
  // the top of it. Matching the two heights by arithmetic was the bug; this
  // way there is only ever one box, so there is nothing to keep in agreement.
  // While a roll is in flight the sizer is padded to the reel's column count,
  // so the overlay it defines is the right width too, and hidden with
  // `visibility` rather than swapped out — the layout it contributes is the
  // whole reason it's still there.
  return (
    <span
      className={`relative inline-block tabular-nums ${className}`}
      aria-label={String(value)}
    >
      <span className={roll ? 'invisible' : undefined}>
        {roll ? String(value).padStart(roll.width, BLANK) : value}
      </span>

      {roll && (
        <span ref={overlay} className="absolute inset-0 flex" aria-hidden>
          {roll.columns.map((col, i) => (
            <span key={i} className="flex-1 overflow-hidden">
              <span
                ref={el => { strips.current[i] = el; }}
                className="block"
                style={{ willChange: 'transform' }}
              >
                {col.frames.map((f, j) => (
                  <span key={j} className="block" style={{ height: 'var(--reel-cell)' }}>{f}</span>
                ))}
              </span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
