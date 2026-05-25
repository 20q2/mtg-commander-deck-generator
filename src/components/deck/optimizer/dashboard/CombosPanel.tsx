// src/components/deck/optimizer/dashboard/CombosPanel.tsx
import type { DetectedCombo } from '@/types';

export interface CombosPanelProps {
  detectedCombos: DetectedCombo[];
}

const MAX_SHOWN = 3;

export function CombosPanel({ detectedCombos }: CombosPanelProps) {
  if (!detectedCombos || detectedCombos.length === 0) return null;

  const shown = detectedCombos.slice(0, MAX_SHOWN);
  const remaining = detectedCombos.length - shown.length;

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/60">
        Combos in this deck
      </p>
      <div className="flex flex-col gap-1.5">
        {shown.map(combo => {
          const resultLabel = combo.results.slice(0, 2).join(' + ') || combo.comboId;
          const isComplete = combo.isComplete;
          const missingCount = combo.missingCards.length;

          return (
            <div
              key={combo.comboId}
              className="flex flex-col sm:flex-row sm:items-center gap-1.5 rounded-md bg-muted/40 border border-border/30 px-3 py-2.5"
            >
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-xs font-medium text-foreground/80 truncate" title={resultLabel}>
                  {resultLabel}
                </p>
                <p className="text-[10px] text-muted-foreground/60 truncate">
                  {combo.cards.join(', ')}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isComplete ? (
                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                    Complete
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/25">
                    Missing {missingCount}
                  </span>
                )}
                {combo.deckCount > 0 && (
                  <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap">
                    {combo.deckCount.toLocaleString()} decks
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {remaining > 0 && (
          <p className="text-[11px] text-muted-foreground/60 pl-1">
            +{remaining} more combo{remaining !== 1 ? 's' : ''}
          </p>
        )}
      </div>
    </div>
  );
}
