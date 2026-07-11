import { useEffect } from 'react';
import { History } from 'lucide-react';
import type { BrewMoment } from '@/services/brew/engine';

/**
 * "Previously, on your brew…" — resuming a ?b= session replays the last couple of moments as a
 * one-beat cliffhanger card before the current screen, so a returning player lands back in their
 * story instead of a cold screen. Tap to skip; auto-dismisses; reduced-motion shortens the hold.
 */

const HOLD_MS = 3200;
const HOLD_REDUCED_MS = 1600;

export function BrewPreviously({ moments, onDone }: { moments: BrewMoment[]; onDone: () => void }) {
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t = window.setTimeout(onDone, reduce ? HOLD_REDUCED_MS : HOLD_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-md p-4 animate-brew-view-in cursor-pointer"
      onClick={onDone}
      title="Tap to continue"
    >
      <div className="text-center max-w-md">
        <div className="flex items-center justify-center gap-2 mb-3 text-muted-foreground/70">
          <History className="w-4 h-4" />
          <span className="text-[11px] uppercase tracking-[0.32em] whitespace-nowrap">Previously, on your brew</span>
        </div>
        <ul className="space-y-1.5">
          {moments.map((m, i) => (
            <li key={i} className="font-flavor text-[15px] italic text-foreground/90">
              {m.label}
              {m.detail && <span className="text-muted-foreground"> — {m.detail}</span>}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[11px] uppercase tracking-[0.2em] text-muted-foreground/60">The story continues…</p>
      </div>
    </div>
  );
}
