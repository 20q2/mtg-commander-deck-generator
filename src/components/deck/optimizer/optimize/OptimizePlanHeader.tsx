import { Sparkles, Check, Settings2, Minus, Plus, Mountain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { OptimizePlanTotals } from './useOptimizePlan';

export interface OptimizePlanHeaderProps {
  totals: OptimizePlanTotals;
  applying: boolean;
  hasSwaps: boolean;
  hasUnchecked: boolean;
  onApply: () => void;
  onReset: () => void;
  /** Land target popover wiring (pass-through from existing handlers). */
  landSettings?: {
    deckSize: number;
    autoSuggestion: number;
    userLandTarget: number | null;
    onLandTargetChange: (target: number | null) => void;
  };
}

export function OptimizePlanHeader({
  totals, applying, hasSwaps, hasUnchecked, onApply, onReset, landSettings,
}: OptimizePlanHeaderProps) {
  const { totalChanges, removeCount, addCount, priceDelta, scoreDelta, projectedSize, targetSize, overBy } = totals;

  if (!hasSwaps) {
    return (
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-4 px-3 sm:px-4 py-4 mb-3 border-b border-border/30 bg-gradient-to-b from-violet-950/30 via-background/95 to-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-sm text-emerald-400/80">
          <Check className="w-4 h-4" />
          <span className="font-medium">Looking good — no swaps recommended.</span>
          {landSettings && <LandSettingsPopover {...landSettings} className="ml-auto" />}
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

          {landSettings && <LandSettingsPopover {...landSettings} />}
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

function LandSettingsPopover({
  deckSize, autoSuggestion, userLandTarget, onLandTargetChange, className,
}: {
  deckSize: number;
  autoSuggestion: number;
  userLandTarget: number | null;
  onLandTargetChange: (target: number | null) => void;
  className?: string;
}) {
  const current = userLandTarget ?? autoSuggestion;
  const min = Math.floor(deckSize * 0.25);
  const max = Math.floor(deckSize * 0.50);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className={className} aria-label="Plan settings">
          <Settings2 className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Mountain className="w-3.5 h-3.5 text-muted-foreground/70" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Land target</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => { if (current > min) onLandTargetChange(current - 1); }}
            >
              <Minus className="w-3 h-3" />
            </Button>
            <span className={`text-base font-bold tabular-nums w-8 text-center ${userLandTarget != null ? 'text-sky-400' : 'text-foreground'}`}>
              {current}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => { if (current < max) onLandTargetChange(current + 1); }}
            >
              <Plus className="w-3 h-3" />
            </Button>
            {userLandTarget != null && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onLandTargetChange(null)}
                className="text-[10px] text-muted-foreground/60"
              >
                Reset
              </Button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground/60">
            Auto-detected: {autoSuggestion}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
