import { Sparkles, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { OptimizePlanTotals } from './useOptimizePlan';

export interface OptimizePlanHeaderProps {
  totals: OptimizePlanTotals;
  applying: boolean;
  hasSwaps: boolean;
  hasUnchecked: boolean;
  onApply: () => void;
  onReset: () => void;
}

export function OptimizePlanHeader({
  totals, applying, hasSwaps, hasUnchecked, onApply, onReset,
}: OptimizePlanHeaderProps) {
  const { totalChanges, removeCount, addCount, priceDelta, scoreDelta, projectedSize, targetSize, overBy } = totals;

  if (!hasSwaps) {
    return (
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-4 px-3 sm:px-4 py-4 mb-3 border-b border-border/30 bg-gradient-to-b from-violet-950/30 via-background/95 to-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-sm text-emerald-400/80">
          <Check className="w-4 h-4" />
          <span className="font-medium">Looking good — no swaps recommended.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-10 -mx-3 sm:-mx-4 px-3 sm:px-4 py-3 sm:py-4 mb-3 border-b border-border/30 bg-gradient-to-b from-violet-950/30 via-background/95 to-background/80 backdrop-blur-sm">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-300" />
            Tune your deck
          </h3>
          <p className="text-[11px] sm:text-xs text-muted-foreground/70 mt-0.5">
            We found {totalChanges > 0 ? `${totalChanges} swap${totalChanges !== 1 ? 's' : ''}` : 'a set of suggestions'} that look like upgrades.
          </p>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <Button
            type="button"
            onClick={onApply}
            disabled={totalChanges === 0 || applying}
            className="btn-shimmer px-4 py-2 text-sm font-semibold gap-2"
          >
            {applying ? (
              <>
                <Check className="w-4 h-4" />
                Applied!
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Apply {totalChanges} Change{totalChanges !== 1 ? 's' : ''}
              </>
            )}
          </Button>

          <div className="hidden sm:flex items-center gap-2 text-[11px] tabular-nums">
            {priceDelta != null && (
              <span className={priceDelta > 0 ? 'text-red-400/80' : priceDelta < 0 ? 'text-emerald-400/80' : 'text-muted-foreground/60'}>
                {priceDelta > 0 ? '+' : priceDelta < 0 ? '−' : ''}${Math.abs(priceDelta).toFixed(2)}
              </span>
            )}
            {scoreDelta !== 0 && (
              <span className={scoreDelta > 0 ? 'text-emerald-400/80' : 'text-red-400/80'}>
                {scoreDelta > 0 ? '+' : ''}{scoreDelta} score
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground/60">
        <span>{removeCount} cut · {addCount} add</span>
        <span>→ {projectedSize}/{targetSize} cards{overBy > 0 ? ` (over by ${overBy})` : ''}</span>
        {hasUnchecked && (
          <button
            type="button"
            onClick={onReset}
            className="ml-auto text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            Reset selections
          </button>
        )}
        {totalChanges === 0 && (
          <span className="ml-auto text-muted-foreground/60">Select cards to enable changes</span>
        )}
      </div>
    </div>
  );
}
