import type { ReactNode } from 'react';
import { Sparkles, Check, ArrowRightLeft, ChevronDown, ListChecks, Wand2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { OptimizePlanTotals } from './useOptimizePlan';

export type OptimizeView = 'swaps' | 'combos';

// Card Fit is three bands: this compact bar on top with the impact strip under it, the columns (the
// only part that scrolls), and the plan dock along the bottom with a one-line note and the big button.

/** Flush to the panel's edges, the same glass as the columns a shade darker. */
const GLASS = 'shrink-0 bg-background/80 backdrop-blur-md px-3 sm:px-4';

interface ToggleOption {
  key: OptimizeView;
  label: string;
  count: number;
  Icon: typeof ArrowRightLeft;
}

export interface OptimizePlanHeaderProps {
  hasSwaps: boolean;
  /** Cards checked across both columns — the Swaps toggle's count. */
  totalChanges: number;
  view: OptimizeView;
  onViewChange: (next: OptimizeView) => void;
  comboCount: number;
  /** True when the user has selected any card to swap. */
  hasSelections: boolean;
  /** What the checked swaps do to the deck (SwapImpactRow) — under the row, bleeding to the edges. */
  impactRow?: ReactNode;
  /** The player folded the impact strip away. */
  impactHidden?: boolean;
  /** Present → a Hide/Show impact toggle shows while anything is checked. */
  onToggleImpact?: () => void;
}

/** One row: what this tab is, and the Swaps / Combos switch. The impact strip opens beneath it. */
export function OptimizePlanHeader({
  hasSwaps, totalChanges, view, onViewChange, comboCount,
  hasSelections, impactRow, impactHidden = false, onToggleImpact,
}: OptimizePlanHeaderProps) {
  if (!hasSwaps) {
    return (
      <div className={`${GLASS} border-b border-border/60 py-3`}>
        <div className="flex items-center gap-2 text-sm text-emerald-400/80">
          <Check className="w-4 h-4" />
          <span className="font-medium">Looking good — no swaps recommended.</span>
        </div>
      </div>
    );
  }

  const toggleOptions: ToggleOption[] = [
    { key: 'swaps',  label: 'Swaps',  count: totalChanges, Icon: ArrowRightLeft },
    { key: 'combos', label: 'Combos', count: comboCount,   Icon: Zap },
  ];
  const isCombosView = view === 'combos';

  return (
    // py-3 / sm:py-4 is the padding the impact strip bleeds over (its -mx and -mb), so it meets
    // the bar's edges and bottom rule.
    <div className={`${GLASS} overflow-hidden border-b border-border/60 py-3 sm:py-4`}>
    <div className="flex items-center gap-3">
      <h3 className="flex shrink-0 items-center gap-2 text-[15px] font-semibold">
        {/* The Card Fit rail tab's icon, so the bar reads as that tab. */}
        <Wand2 className="w-4 h-4 text-violet-300" aria-hidden="true" />
        {isCombosView ? 'Combos in your deck' : 'Tune your deck'}
      </h3>
      <span className="hidden min-w-0 truncate text-xs text-foreground/60 md:inline">
        {isCombosView
          ? `${comboCount} combo${comboCount !== 1 ? 's' : ''}, complete and nearly there.`
          : 'Swaps that look like upgrades for this deck.'}
      </span>

      {onToggleImpact && hasSelections && !isCombosView && (
        <button
          type="button"
          onClick={onToggleImpact}
          aria-expanded={!impactHidden}
          className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-xs text-foreground/70 hover:text-foreground transition-colors"
        >
          {impactHidden ? 'Show impact' : 'Hide impact'}
          <ChevronDown className={`w-3 h-3 transition-transform duration-200 motion-reduce:transition-none ${impactHidden ? '' : 'rotate-180'}`} aria-hidden="true" />
        </button>
      )}

      <div
        role="tablist"
        aria-label="Tune view"
        className={`${onToggleImpact && hasSelections && !isCombosView ? '' : 'ml-auto '}flex shrink-0 items-center gap-1 p-0.5 rounded-lg bg-background/40 border border-border/40`}
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
              className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-md border transition-colors ${
                isActive
                  ? 'bg-violet-500/15 text-violet-300 border-violet-500/40'
                  : 'bg-transparent text-foreground/70 border-transparent hover:bg-white/5 hover:text-foreground'
              }`}
            >
              <opt.Icon className="w-3.5 h-3.5" />
              <span>{opt.label}</span>
              <span className={`tabular-nums font-bold ${isActive ? '' : 'text-foreground/60'}`}>{opt.count}</span>
            </button>
          );
        })}
      </div>
    </div>
    {!isCombosView && impactRow}
    </div>
  );
}

export interface OptimizePlanDockProps {
  totals: OptimizePlanTotals;
  applying: boolean;
  /** True when the user has selected any card to swap. */
  hasSelections: boolean;
  onApply: () => void;
  onReset: () => void;
  /** Cards in the recommended plan: paired upgrades plus any size fix. */
  recommendedCount: number;
  /** True when the selection is exactly the recommended plan. */
  isRecommendedSelected: boolean;
  onSelectRecommended: () => void;
  /** Plan-score points the ticked swaps earn (the impact strip's figure), when known. */
  scoreGain?: number | null;
  /** Brings a column into view: the size note opens the side that settles it. */
  onShowSide?: (side: 'remove' | 'add') => void;
}

/**
 * Along the bottom of the tab, under the columns: what pressing Apply would do, and the button.
 * With nothing ticked the button takes the recommended swaps instead.
 */
export function OptimizePlanDock({
  totals, applying, hasSelections, onApply, onReset,
  recommendedCount, isRecommendedSelected, onSelectRecommended, scoreGain, onShowSide,
}: OptimizePlanDockProps) {
  const { totalChanges, removeCount, addCount, projectedSize, targetSize } = totals;
  const canRecommend = recommendedCount > 0;
  const big = 'h-9 px-4 text-sm font-semibold gap-2';
  const offBy = projectedSize - targetSize;
  const gain = scoreGain ?? 0;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

  // The size gap is a door to the column that closes it. Short is just an open slot, not a mistake;
  // over the limit is the one case worth amber, since the deck wouldn't be legal.
  const sizeDoor = offBy !== 0 && (
    <button
      type="button"
      onClick={() => onShowSide?.(offBy > 0 ? 'remove' : 'add')}
      className={`cursor-pointer rounded-sm underline decoration-dotted underline-offset-[3px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
        offBy > 0
          ? 'text-amber-300 decoration-amber-300/60 hover:text-amber-200'
          : 'text-foreground/85 decoration-muted-foreground/70 hover:text-foreground'
      }`}
    >
      {offBy > 0 ? `${offBy} over the limit` : plural(-offBy, 'open slot')}
    </button>
  );

  return (
    <div className={`${GLASS} border-t border-border/60 py-3`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {hasSelections ? (
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] text-foreground/70">
            <span>
              <span className="font-semibold text-red-400">{plural(removeCount, 'cut')}</span>
              {', '}
              <span className="font-semibold text-emerald-400">{plural(addCount, 'add')}</span>
            </span>
            <span aria-hidden="true" className="text-foreground/30">·</span>
            <span>
              Deck goes to <span className="font-semibold tabular-nums text-foreground/90">{projectedSize}/{targetSize}</span>
            </span>
            {sizeDoor && <><span aria-hidden="true" className="text-foreground/30">·</span>{sizeDoor}</>}
            {isRecommendedSelected && (
              <span className="inline-flex items-center gap-1 text-violet-300">
                <Check className="w-3 h-3" aria-hidden="true" /> Recommended
              </span>
            )}
          </p>
        ) : (
          <p className="text-[13px] text-foreground/70">
            {canRecommend ? 'Start from the recommended swaps, or tick your own.' : 'Tick cards to plan swaps.'}
          </p>
        )}

        <div className="ml-auto flex items-center gap-2">
          {hasSelections && (
            <Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={applying} className="h-9 text-xs text-foreground/70">
              Clear
            </Button>
          )}
          {hasSelections && canRecommend && !isRecommendedSelected && (
            <Button type="button" variant="outline" onClick={onSelectRecommended} disabled={applying} className="h-9 gap-1.5 px-3 text-xs font-semibold">
              <ListChecks className="w-3.5 h-3.5" /> Replace with recommended
            </Button>
          )}
          {!hasSelections && canRecommend ? (
            <Button type="button" onClick={onSelectRecommended} className={big}>
              <ListChecks className="w-4 h-4" /> Select recommended
            </Button>
          ) : (
            <Button type="button" onClick={onApply} disabled={totalChanges === 0 || applying} className={`btn-shimmer ${big}`}>
              {applying
                ? <><Check className="w-4 h-4" /> Applied!</>
                : <>
                    <Sparkles className="w-4 h-4" /> Apply {plural(totalChanges, 'change')}
                    {/* The reason to press it, on the button itself. */}
                    {gain !== 0 && (
                      <span className="rounded-full bg-white/15 px-1.5 py-px text-xs font-bold tabular-nums">
                        {gain > 0 ? '+' : '−'}{Math.abs(gain)} pts
                      </span>
                    )}
                  </>}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
