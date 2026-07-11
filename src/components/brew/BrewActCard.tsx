import { useEffect } from 'react';
import type { BrewAct } from '@/services/brew/engine';

/**
 * The act interstitial — a 2–3s title card when the run crosses a phase boundary, so the packs
 * changing character at 30%/85% fill reads as story structure instead of arbitrary. Built from
 * real state (the spark line cites the deck's actual leaning). Tap to skip; auto-dismisses;
 * reduced-motion keeps the info but shortens the hold. Pure presentation — acts change nothing.
 */

const HOLD_MS = 2600;
const HOLD_REDUCED_MS = 1400;

export function BrewActCard({ act, leaning, picks, onDone }: {
  act: BrewAct;
  leaning: string[];
  picks: number;
  onDone: () => void;
}) {
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t = window.setTimeout(onDone, reduce ? HOLD_REDUCED_MS : HOLD_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The boundary line cites what actually happened — honest state, not stock copy.
  const subtitle = act.act === 2
    ? leaning.length > 0
      ? `Act I complete — your deck found its spark: ${leaning.join(' · ')}`
      : 'Act I complete — your deck is finding its own path'
    : `The engine is built — ${picks} cards drafted. Time to close.`;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-md p-4 animate-brew-view-in cursor-pointer"
      onClick={onDone}
      title="Tap to continue"
    >
      <div className="text-center">
        <div className="flex items-center justify-center gap-3 mb-3 text-muted-foreground/70">
          <span className="h-px w-14 bg-gradient-to-r from-transparent to-border" />
          <span className="text-[11px] uppercase tracking-[0.4em] whitespace-nowrap">{act.numeral}</span>
          <span className="h-px w-14 bg-gradient-to-l from-transparent to-border" />
        </div>
        <h2 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight mb-3">{act.title}</h2>
        <p className="font-flavor text-[15px] italic text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}
