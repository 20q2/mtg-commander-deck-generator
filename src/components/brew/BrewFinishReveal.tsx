import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { getCardImageUrl } from '@/services/scryfall/client';
import type { ScryfallCard } from '@/types';

/**
 * The finish reveal: every land the generator chose for your mix flies in from all sides and slots
 * into the deck pile while the count ticks up to the full deck size — a quick, satisfying "the rest
 * of the cards are filling in" beat before the recap. Purely presentational; when the flight ends it
 * calls onDone. Reduced motion skips straight to the final count.
 */
const STAGGER = 42;   // ms between each land launching
const FLIGHT = 540;   // ms each land spends in the air
const TAIL = 360;     // ms to linger on the final count before handing off
const MAX_FLYERS = 46; // safety cap on animated nodes (count still ticks the full amount)

function easeOut(p: number): number {
  return 1 - Math.pow(1 - p, 3);
}

export function BrewFinishReveal({
  commander, lands, startCount, total, onDone,
}: { commander: ScryfallCard; lands: ScryfallCard[]; startCount: number; total: number; onDone: () => void }) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [count, setCount] = useState(startCount);
  const flyers = lands.slice(0, MAX_FLYERS);
  const duration = flyers.length * STAGGER + FLIGHT;
  const doneRef = useRef(false);

  useEffect(() => {
    const finish = () => { if (!doneRef.current) { doneRef.current = true; onDone(); } };
    if (reduceMotion || flyers.length === 0) {
      setCount(total);
      const t = window.setTimeout(finish, 250);
      return () => window.clearTimeout(t);
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      setCount(Math.round(startCount + (total - startCount) * easeOut(p)));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setCount(total);
    };
    raf = requestAnimationFrame(tick);
    const done = window.setTimeout(finish, duration + TAIL);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(done); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-background/88 backdrop-blur-md p-4 animate-brew-view-in">
      {/* The running count. */}
      <div className="absolute top-[14vh] left-1/2 -translate-x-1/2 text-center">
        <div className="font-display text-5xl sm:text-6xl font-bold tabular-nums text-foreground drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)]">
          <span style={{ color: 'hsl(40 92% 62%)' }}>{count}</span>
          <span className="text-foreground/40"> / {total}</span>
        </div>
        <div className="mt-1 text-[11px] uppercase tracking-[0.3em] text-muted-foreground">assembling the deck</div>
      </div>

      {/* The deck pile (commander as its face) — the lands slot into it. */}
      <div className="relative grid place-items-center" style={{ width: 300, height: 300 }}>
        <div
          className="relative w-[132px] rounded-[4.8%] ring-1 ring-[hsl(40_92%_62%_/_0.5)] shadow-[0_10px_40px_rgba(0,0,0,0.6),0_0_40px_-8px_hsl(40_92%_62%_/_0.5)]"
          style={{ animation: reduceMotion ? undefined : 'brewPilePulse 900ms ease-in-out infinite' }}
        >
          <img src={getCardImageUrl(commander, 'normal')} alt={commander.name} className="block w-full h-auto rounded-[4.8%]" />
        </div>

        {/* Every land flies in from around the pile and merges into it. */}
        {!reduceMotion && flyers.map((c, i) => {
          const ang = i * 137.5 * (Math.PI / 180);        // golden-angle spray → even coverage
          const rad = 150 + (i % 5) * 30;
          const sx = Math.cos(ang) * rad;
          const sy = Math.sin(ang) * rad;
          const sr = (i % 2 ? 1 : -1) * (8 + (i % 4) * 5);
          return (
            <img
              key={`${c.name}-${i}`}
              src={getCardImageUrl(c, 'small')}
              alt=""
              aria-hidden="true"
              className="brew-land-fly absolute left-1/2 top-1/2 w-[72px] rounded-[4.8%] shadow-[0_6px_18px_rgba(0,0,0,0.55)]"
              style={{
                ['--sx' as string]: `${sx}px`,
                ['--sy' as string]: `${sy}px`,
                ['--sr' as string]: `${sr}deg`,
                animationDelay: `${i * STAGGER}ms`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
