// src/components/deck/optimizer/dashboard/SubScoreTile.tsx
import type { SubScore } from '@/types';
import { ArrowRight, Info } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

export interface SubScoreTileProps {
  label: string;
  subscore: SubScore;
  onClick?: () => void;
  /** Optional explanation of how this number is computed (for the info popover). */
  explainer?: { sources: string; method: string };
}

function colorForScore(value: number): string {
  if (value >= 75) return 'text-emerald-400';
  if (value >= 60) return 'text-violet-300';
  if (value >= 40) return 'text-amber-400';
  return 'text-rose-400';
}

export function SubScoreTile({ label, subscore, onClick, explainer }: SubScoreTileProps) {
  const color = colorForScore(subscore.value);
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative bg-card/40 border border-border/30 rounded-lg p-3 text-left hover:bg-accent/30 hover:border-border/60 transition-all w-full"
    >
      <div className="flex items-baseline gap-2 mb-1">
        <span className={`text-2xl font-black tabular-nums leading-none ${color}`}>
          {subscore.value}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {explainer && (
          <Popover>
            <PopoverTrigger asChild>
              <span
                role="button"
                tabIndex={0}
                onClick={e => e.stopPropagation()}
                className="ml-auto text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                aria-label={`How ${label} is computed`}
              >
                <Info className="w-3 h-3" />
              </span>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-72 p-3 text-[11px] space-y-1.5">
              <div className="font-semibold text-foreground">{label}</div>
              <div className="text-muted-foreground"><span className="font-medium">Sources:</span> {explainer.sources}</div>
              <div className="text-muted-foreground"><span className="font-medium">Method:</span> {explainer.method}</div>
            </PopoverContent>
          </Popover>
        )}
      </div>
      <p className="text-xs text-foreground/90 leading-snug">{subscore.surface}</p>
      <div className="mt-2 flex items-center justify-end text-[10px] text-muted-foreground/50 group-hover:text-muted-foreground/80 transition-colors">
        Drill in <ArrowRight className="w-2.5 h-2.5 ml-0.5" />
      </div>
    </button>
  );
}
