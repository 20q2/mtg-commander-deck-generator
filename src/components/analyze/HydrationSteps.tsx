import { Check, Loader2 } from 'lucide-react';

export interface HydrationStepItem {
  id: string;
  label: string;
  /** x/y counter + progress bar, rendered only while this step is the active one. */
  count?: { fetched: number; total: number } | null;
}

interface HydrationStepsProps {
  steps: HydrationStepItem[];
  /** Index of the running step; everything before it renders as done. An index
   *  past the end marks every step done. */
  currentIdx: number;
  /** The flow is paused for input — the current step shows a pending dot, not a spinner. */
  idle?: boolean;
}

export function HydrationSteps({ steps, currentIdx, idle = false }: HydrationStepsProps) {
  return (
    <ol className="flex flex-col gap-2 text-sm text-left mt-1 min-w-[260px]">
      {steps.map((step, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx && !idle;
        // Counter only while the step is the running one — a stale "100/100"
        // under a later step reads as stuck.
        const showCount = active && !!step.count && step.count.total > 0;
        const pct = showCount ? Math.round((step.count!.fetched / step.count!.total) * 100) : 0;
        return (
          <li key={step.id} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2.5">
              <span className="h-5 w-5 flex items-center justify-center flex-shrink-0">
                {done ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : active ? (
                  <Loader2 className="h-4 w-4 text-violet-300 animate-spin" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                )}
              </span>
              <span className={
                done ? 'text-zinc-400 line-through decoration-emerald-500/40'
                : active ? 'text-zinc-100'
                : 'text-zinc-500'
              }>
                {step.label}
              </span>
              {showCount && (
                <span className="ml-auto pl-3 text-xs tabular-nums text-zinc-500">
                  {step.count!.fetched}/{step.count!.total} cards
                </span>
              )}
            </div>
            {showCount && (
              <div className="ml-[30px] h-1 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-violet-400/70 transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
