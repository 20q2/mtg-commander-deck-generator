import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Swords, Waves, Hourglass, ArrowRight, Wrench, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { GauntletTrial, TrialVerdict } from '@/services/brew/gauntlet';

/**
 * The Gauntlet overlay — the run's climax, between the deck being built and the recap. The three
 * trials reveal one at a time (a short dramatic beat each; tap anywhere to reveal all instantly,
 * reduced-motion shows everything at once). Never a fail state: shaky verdicts point at the
 * Inspector — the one-click-fix bridge — and the run always proceeds to its story.
 */

const TRIAL_ICON: Record<GauntletTrial['id'], LucideIcon> = {
  boardwipe: Waves,
  archenemy: Swords,
  longgame: Hourglass,
};

const VERDICT_STYLE: Record<TrialVerdict, { label: string; chip: string }> = {
  strong: { label: 'Strong', chip: 'border-emerald-400/60 bg-emerald-500/12 text-emerald-200' },
  pass: { label: 'Holds', chip: 'border-border/70 bg-card/60 text-foreground/80' },
  shaky: { label: 'Shaky', chip: 'border-amber-400/60 bg-amber-500/12 text-amber-200' },
};

const REVEAL_STEP_MS = 700;

export function BrewGauntlet({ trials, onContinue, onInspector }: {
  trials: GauntletTrial[];
  onContinue: () => void;
  onInspector: () => void;
}) {
  // How many trials are face-up. Reduced-motion (or a tap) reveals everything at once.
  const [revealed, setRevealed] = useState(() =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? trials.length : 1);
  useEffect(() => {
    if (revealed >= trials.length) return;
    const t = window.setTimeout(() => setRevealed(r => r + 1), REVEAL_STEP_MS);
    return () => window.clearTimeout(t);
  }, [revealed, trials.length]);
  const allShown = revealed >= trials.length;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/85 backdrop-blur-md p-4 animate-brew-view-in"
      onClick={() => setRevealed(trials.length)}
    >
      <div className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl border border-border/60 bg-card/80 backdrop-blur-xl shadow-[0_24px_80px_-20px_rgba(0,0,0,0.8)] p-6 sm:p-8">
        <span className="mx-auto mb-3 grid place-items-center w-12 h-12 rounded-full border-2 border-amber-300/60 bg-amber-500/12 text-amber-200 shadow-[0_0_28px_hsl(38_92%_50%/0.35)]">
          <ShieldCheck className="w-6 h-6" />
        </span>
        <div className="flex items-center justify-center gap-3 mb-1 text-muted-foreground/70">
          <span className="h-px w-10 bg-gradient-to-r from-transparent to-border" />
          <span className="text-[10px] uppercase tracking-[0.32em] whitespace-nowrap">The Gauntlet</span>
          <span className="h-px w-10 bg-gradient-to-l from-transparent to-border" />
        </div>
        <p className="text-center font-flavor text-[15px] italic text-muted-foreground mb-6">
          Your deck is built. Now it faces the table.
        </p>

        <ol className="space-y-3 mb-7">
          {trials.map((t, i) => {
            const Icon = TRIAL_ICON[t.id];
            const v = VERDICT_STYLE[t.verdict];
            if (i >= revealed) {
              // Face-down trial — a quiet placeholder holding the space until its beat lands.
              return (
                <li key={t.id} className="rounded-xl border border-border/40 bg-card/30 px-4 py-3.5 opacity-50">
                  <span className="font-display text-sm font-semibold text-muted-foreground/60">…</span>
                </li>
              );
            }
            return (
              <li key={t.id} className="rounded-xl border border-border/60 bg-card/50 px-4 py-3.5 animate-brew-view-in">
                <div className="flex items-center gap-3">
                  <span className="grid place-items-center w-9 h-9 shrink-0 rounded-full border border-border/70 bg-card/70 text-foreground/80">
                    <Icon className="w-4 h-4" strokeWidth={1.75} />
                  </span>
                  <span className="flex-1 min-w-0 text-left">
                    <span className="font-display text-sm font-semibold text-foreground">{t.title}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{t.question}</span>
                  </span>
                  <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${v.chip}`}>
                    {v.label}
                  </span>
                </div>
                <p className="mt-2 font-flavor text-[13px] italic text-muted-foreground leading-snug text-left">{t.flavor}</p>
                {/* The honest lineage — the real numbers behind the verdict, always shown. */}
                <p className="mt-1 text-[11px] tabular-nums text-muted-foreground/70 text-left">{t.statLine}</p>
                {t.verdict === 'shaky' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onInspector(); }}
                    className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-amber-200/90 hover:text-amber-100 underline underline-offset-2 decoration-amber-300/40"
                  >
                    <Wrench className="w-3.5 h-3.5" /> Shore this up in the Inspector
                  </button>
                )}
              </li>
            );
          })}
        </ol>

        <div className={`text-center transition-opacity duration-300 ${allShown ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <Button size="lg" className="btn-shimmer" onClick={(e) => { e.stopPropagation(); onContinue(); }}>
            See your story <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
