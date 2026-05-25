// src/components/deck/optimizer/dashboard/HeroScore.tsx
import type { PlanScore } from '@/types';

export interface HeroScoreProps {
  planScore: PlanScore;
}

export function HeroScore({ planScore }: HeroScoreProps) {
  const pct = Math.max(0, Math.min(100, planScore.overall));
  const ringStyle = {
    background: `conic-gradient(hsl(var(--primary)) 0% ${pct}%, hsl(var(--muted)) ${pct}% 100%)`,
  };

  return (
    <div className="relative flex flex-col sm:flex-row items-center gap-6 p-6 sm:p-8 rounded-xl border border-border/30 bg-card/40">
      <div
        className="absolute inset-0 -z-10 rounded-xl pointer-events-none"
        style={{
          background: 'radial-gradient(circle at top left, rgba(167,139,250,0.12), transparent 60%)',
        }}
        aria-hidden="true"
      />
      <div
        className="w-32 h-32 sm:w-40 sm:h-40 rounded-full flex items-center justify-center shrink-0"
        style={ringStyle}
        aria-label={`Plan score ${pct} out of 100`}
      >
        <div className="w-[78%] h-[78%] rounded-full bg-card flex flex-col items-center justify-center">
          <div className="text-4xl sm:text-5xl font-black tabular-nums leading-none">{pct}</div>
          <div className="mt-1.5 text-[10px] uppercase tracking-wider font-semibold text-violet-300/80">
            {planScore.bandLabel}
          </div>
        </div>
      </div>
      <div className="flex-1 min-w-0 text-center sm:text-left">
        <h2 className="text-lg sm:text-xl font-semibold leading-snug text-foreground">
          {planScore.headline}
        </h2>
        <p className="mt-2 text-xs text-muted-foreground/70">{planScore.byline}</p>
        {planScore.limitedData && (
          <p className="mt-1 text-[11px] text-amber-400/70">
            Limited data — some sub-scores excluded.
          </p>
        )}
      </div>
    </div>
  );
}
