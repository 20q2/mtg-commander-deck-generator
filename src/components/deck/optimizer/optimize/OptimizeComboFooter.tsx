import { useMemo, useState } from 'react';
import { ChevronDown, Check, AlertTriangle, Ban, Plus } from 'lucide-react';
import type { DetectedCombo } from '@/types';
import type { OptimizeCard } from '@/services/deckBuilder/deckAnalyzer';
import { scryfallImg } from '../constants';

export interface OptimizeComboFooterProps {
  combos: DetectedCombo[];
  bannedNames: Set<string>;
  /** Names currently in the Add column (checked or unchecked). Used to decide whether a "Pick" button
   *  just checks an existing tile vs. inserts an extra candidate. */
  addColumnNames: Set<string>;
  uncheckedAdditions: Set<string>;
  onToggleAdd: (name: string) => void;
  onAddExtraCandidate: (card: OptimizeCard) => void;
  /** Used to flash the matching tile in the Add column when "View combo" is clicked from a drill-down. */
  highlightedComboId?: string | null;
}

export function OptimizeComboFooter({
  combos, bannedNames, addColumnNames, uncheckedAdditions,
  onToggleAdd, onAddExtraCandidate, highlightedComboId,
}: OptimizeComboFooterProps) {
  const { complete, nearMisses, excluded } = useMemo(() => {
    const isBanned = (c: DetectedCombo) => c.cards.some(n => bannedNames.has(n.toLowerCase()));
    const sortByDeckCount = (a: DetectedCombo, b: DetectedCombo) => b.deckCount - a.deckCount;
    return {
      complete:   combos.filter(c =>  c.isComplete && !isBanned(c)).sort(sortByDeckCount),
      nearMisses: combos.filter(c => !c.isComplete && c.missingCards.length === 1 && !isBanned(c)).sort(sortByDeckCount),
      excluded:   combos.filter(isBanned),
    };
  }, [combos, bannedNames]);

  const hasContent = complete.length > 0 || nearMisses.length > 0;
  const [expanded, setExpanded] = useState(hasContent);
  const [showExcluded, setShowExcluded] = useState(false);

  if (combos.length === 0) return null;

  return (
    <section className="rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm mt-4">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 p-3 text-left"
      >
        <span className="text-sm font-semibold">🔗 Combos</span>
        <span className="text-[11px] text-muted-foreground/70">
          {complete.length} complete · {nearMisses.length} one card away
          {excluded.length > 0 ? ` · ${excluded.length} excluded` : ''}
        </span>
        <ChevronDown className={`w-4 h-4 ml-auto text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {complete.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400/80 mb-2">Complete</h4>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {complete.map(combo => (
                  <ComboCard
                    key={combo.comboId}
                    combo={combo}
                    tone="complete"
                    highlighted={highlightedComboId === combo.comboId}
                  />
                ))}
              </div>
            </div>
          )}

          {nearMisses.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-amber-400/80 mb-2">One card away</h4>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {nearMisses.map(combo => {
                  const missing = combo.missingCards[0];
                  const isPicked = addColumnNames.has(missing) && !uncheckedAdditions.has(missing);
                  return (
                    <ComboCard
                      key={combo.comboId}
                      combo={combo}
                      tone="near-miss"
                      highlighted={highlightedComboId === combo.comboId}
                      action={
                        <button
                          type="button"
                          onClick={() => {
                            if (addColumnNames.has(missing)) {
                              if (!isPicked) onToggleAdd(missing);
                            } else {
                              onAddExtraCandidate({
                                name: missing,
                                reason: `Completes the ${combo.cards.join(' + ')} combo`,
                                reasonCategory: 'from-combos',
                                inclusion: null,
                              });
                            }
                          }}
                          className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md transition-colors ${
                            isPicked
                              ? 'bg-emerald-500/20 text-emerald-300 cursor-default'
                              : 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                          }`}
                          disabled={isPicked}
                        >
                          {isPicked ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                          {isPicked ? 'Picked' : 'Pick this combo'}
                        </button>
                      }
                    />
                  );
                })}
              </div>
            </div>
          )}

          {excluded.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowExcluded(v => !v)}
                className="flex items-center gap-2 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
              >
                <ChevronDown className={`w-3 h-3 transition-transform ${showExcluded ? 'rotate-180' : ''}`} />
                Excluded ({excluded.length})
              </button>
              {showExcluded && (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                  {excluded.map(combo => (
                    <ComboCard key={combo.comboId} combo={combo} tone="excluded" highlighted={false} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

interface ComboCardProps {
  combo: DetectedCombo;
  tone: 'complete' | 'near-miss' | 'excluded';
  highlighted: boolean;
  action?: React.ReactNode;
}

function ComboCard({ combo, tone, highlighted, action }: ComboCardProps) {
  const toneCls =
    tone === 'complete'  ? 'border-emerald-500/30 bg-emerald-500/[0.04]' :
    tone === 'near-miss' ? 'border-amber-500/30 bg-amber-500/[0.04]' :
                           'border-red-500/30 bg-red-500/[0.04]';
  const Icon =
    tone === 'complete'  ? Check :
    tone === 'near-miss' ? AlertTriangle :
                           Ban;
  const iconCls =
    tone === 'complete'  ? 'text-emerald-400' :
    tone === 'near-miss' ? 'text-amber-400' :
                           'text-red-400';

  return (
    <div
      data-combo-id={combo.comboId}
      className={`rounded-lg border ${toneCls} p-2 transition-shadow ${highlighted ? 'ring-2 ring-violet-400/60' : ''}`}
    >
      <div className="flex items-center gap-1 mb-1.5">
        <Icon className={`w-3 h-3 ${iconCls}`} />
        <span className="text-[11px] font-medium truncate">{combo.cards.join(' + ')}</span>
      </div>
      <div className="flex gap-1 mb-1.5">
        {combo.cards.map(name => {
          const isMissing = combo.missingCards.includes(name);
          return (
            <img
              key={name}
              src={scryfallImg(name, 'small')}
              alt={name}
              className={`w-10 aspect-[5/7] rounded object-cover ${isMissing ? 'opacity-50 ring-1 ring-amber-500/60' : ''}`}
              loading="lazy"
            />
          );
        })}
      </div>
      <div className="text-[10px] text-muted-foreground/70">
        {combo.deckCount.toLocaleString()} decks · Bracket {combo.bracket}
      </div>
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}
