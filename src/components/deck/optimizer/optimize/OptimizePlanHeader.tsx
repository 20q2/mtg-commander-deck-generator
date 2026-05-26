import { Sparkles, Check, ArrowRightLeft, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { OptimizePlanTotals } from './useOptimizePlan';

export type OptimizeView = 'swaps' | 'combos';

export interface OptimizePlanHeaderProps {
  totals: OptimizePlanTotals;
  applying: boolean;
  hasSwaps: boolean;
  hasUnchecked: boolean;
  onApply: () => void;
  onReset: () => void;
  view: OptimizeView;
  onViewChange: (next: OptimizeView) => void;
  comboCount: number;
}

interface ToggleOption {
  key: OptimizeView;
  label: string;
  count: number;
  Icon: typeof ArrowRightLeft;
  activeClass: string;
}

export function OptimizePlanHeader({
  totals, applying, hasSwaps, hasUnchecked, onApply, onReset,
  view, onViewChange, comboCount,
}: OptimizePlanHeaderProps) {
  const { totalChanges, removeCount, addCount, priceDelta, scoreDelta, projectedSize, targetSize, overBy } = totals;

  const toggleOptions: ToggleOption[] = [
    { key: 'swaps',  label: 'Swaps',  count: totalChanges, Icon: ArrowRightLeft, activeClass: 'bg-violet-500/15 text-violet-300 border-violet-500/40' },
    { key: 'combos', label: 'Combos', count: comboCount,   Icon: Zap,            activeClass: 'bg-violet-500/15 text-violet-300 border-violet-500/40' },
  ];

  if (!hasSwaps) {
    return (
      <div className="sticky top-0 z-20 -mx-3 sm:-mx-4 px-3 sm:px-4 py-4 mb-6 sm:mb-8 border-b-2 border-border/60 shadow-lg shadow-black/40 bg-gradient-to-b from-violet-900/25 via-background/95 to-background backdrop-blur-lg">
        <div className="flex items-center gap-2 text-sm text-emerald-400/80">
          <Check className="w-4 h-4" />
          <span className="font-medium">Looking good — no swaps recommended.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-20 -mx-3 sm:-mx-4 px-3 sm:px-4 py-3 sm:py-4 mb-6 sm:mb-8 border-b-2 border-border/60 shadow-lg shadow-black/40 bg-gradient-to-b from-violet-900/25 via-background/95 to-background backdrop-blur-lg">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base sm:text-lg font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-300" />
            Tune your deck
          </h3>
          <p className="text-[11px] sm:text-xs text-foreground/70 mt-0.5">
            We found {totalChanges > 0 ? `${totalChanges} swap${totalChanges !== 1 ? 's' : ''}` : 'a set of suggestions'} that look like upgrades.
          </p>
        </div>

        <Button
          type="button"
          onClick={onApply}
          disabled={totalChanges === 0 || applying}
          className="btn-shimmer px-4 py-2 text-sm font-semibold gap-2 self-start sm:self-auto"
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
      </div>

      <div className="mt-2 flex items-center flex-wrap gap-1.5 text-[10px] font-semibold tabular-nums">
        <span className="px-1.5 py-0.5 rounded-md bg-muted/30 text-foreground/80 border border-border/40">
          {removeCount} cut · {addCount} add
        </span>
        <span
          className={`px-1.5 py-0.5 rounded-md ${
            overBy > 0
              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/25'
              : 'bg-muted/30 text-foreground/80 border border-border/40'
          }`}
        >
          → {projectedSize}/{targetSize} cards{overBy > 0 ? ` (over by ${overBy})` : ''}
        </span>

        <div className="hidden sm:flex items-center gap-1.5">
          {priceDelta != null && (
            <span className={`px-1.5 py-0.5 rounded-md ${
              priceDelta < 0
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'
                : priceDelta > 0
                ? 'bg-red-500/15 text-red-300 border border-red-500/25'
                : 'bg-muted/30 text-foreground/70 border border-border/30'
            }`}>
              {priceDelta > 0 ? '+' : priceDelta < 0 ? '−' : ''}${Math.abs(priceDelta).toFixed(2)}
            </span>
          )}
          {scoreDelta !== 0 && (
            <span className={`px-1.5 py-0.5 rounded-md ${
              scoreDelta > 0
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'
                : 'bg-red-500/15 text-red-300 border border-red-500/25'
            }`}>
              {scoreDelta > 0 ? '+' : ''}{scoreDelta} score
            </span>
          )}
        </div>

        {hasUnchecked && (
          <button
            type="button"
            onClick={onReset}
            className="text-[10px] font-normal text-foreground/70 hover:text-foreground transition-colors"
          >
            Reset selections
          </button>
        )}
        {totalChanges === 0 && (
          <span className="text-[10px] font-normal text-foreground/70">Select cards to enable changes</span>
        )}

        <div
          role="tablist"
          aria-label="Tune view"
          className="ml-auto flex items-center gap-1 p-0.5 rounded-lg bg-background/40 border border-border/40"
        >
          {toggleOptions.map(opt => {
            const isActive = view === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onViewChange(opt.key)}
                className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md border transition-colors ${
                  isActive
                    ? opt.activeClass
                    : 'bg-transparent text-foreground/70 border-transparent hover:bg-white/5 hover:text-foreground'
                }`}
              >
                <opt.Icon className="w-3 h-3" />
                <span>{opt.label}</span>
                <span className={`tabular-nums text-[10px] font-bold ${isActive ? '' : 'text-foreground/60'}`}>
                  {opt.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
