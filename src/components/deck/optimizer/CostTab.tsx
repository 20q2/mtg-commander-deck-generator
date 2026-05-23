import { useMemo, useState, useCallback } from 'react';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import type { ScryfallCard } from '@/types';
import type { DeckAnalysis } from '@/services/deckBuilder/deckAnalyzer';
import {
  buildCostPlan, autoCheckToTarget, formatPrice,
  type Confidence, type CostPlan,
} from '@/services/deckBuilder/costAnalyzer';
import { useStore } from '@/store';
import { SwapRow } from './CostTab.SwapRow';

interface CostTabProps {
  commanderName: string;
  partnerCommanderName?: string;
  currentCards: ScryfallCard[];
  analysis: DeckAnalysis | null;
  sideboardNames: string[];
  maybeboardNames: string[];
  onPreviewCard: (name: string) => void;
  onApplyPlan?: (removeNames: string[], addNames: string[]) => void;
}

const ALL_CONFIDENCES: Confidence[] = ['drop-in', 'sidegrade', 'budget'];
const DEFAULT_ENABLED: Confidence[] = ['drop-in', 'sidegrade'];

export function CostTab({
  commanderName, partnerCommanderName, currentCards, analysis,
  sideboardNames, maybeboardNames, onPreviewCard, onApplyPlan,
}: CostTabProps) {
  const customization = useStore(s => s.customization);
  const currency = customization.currency;
  const mustIncludeCards = customization.mustIncludeCards;

  const plan: CostPlan | null = useMemo(() => {
    if (!analysis) return null;
    return buildCostPlan(currentCards, commanderName, partnerCommanderName, analysis, {
      mustIncludeNames: new Set(mustIncludeCards),
      excludeFromSuggestions: new Set([...sideboardNames, ...maybeboardNames]),
      currency,
    });
  }, [currentCards, commanderName, partnerCommanderName, analysis, mustIncludeCards, sideboardNames, maybeboardNames, currency]);

  const [enabled, setEnabled] = useState<Set<Confidence>>(new Set(DEFAULT_ENABLED));
  const [target, setTarget] = useState<number | null>(null);
  const [manuallyExcluded, setManuallyExcluded] = useState<Set<string>>(new Set());
  const [manuallyIncluded, setManuallyIncluded] = useState<Set<string>>(new Set());

  const allRows = useMemo(() => plan ? [...plan.spellRows, ...plan.landRows] : [], [plan]);

  const autoChecked = useMemo(() => {
    if (!plan || target == null) return new Set<string>();
    return autoCheckToTarget(allRows, plan.currentTotal, target, enabled, manuallyExcluded);
  }, [plan, target, allRows, enabled, manuallyExcluded]);

  const checked = useMemo(() => {
    const s = new Set(autoChecked);
    for (const id of manuallyIncluded) s.add(id);
    for (const id of manuallyExcluded) s.delete(id);
    return s;
  }, [autoChecked, manuallyIncluded, manuallyExcluded]);

  const projectedTotal = useMemo(() => {
    if (!plan) return 0;
    let t = plan.currentTotal;
    for (const row of allRows) if (checked.has(row.id)) t -= row.savings;
    return t;
  }, [plan, allRows, checked]);

  const toggleRow = useCallback((id: string) => {
    const isChecked = checked.has(id);
    if (isChecked) {
      setManuallyExcluded(prev => { const n = new Set(prev); n.add(id); return n; });
      setManuallyIncluded(prev => { const n = new Set(prev); n.delete(id); return n; });
    } else {
      setManuallyIncluded(prev => { const n = new Set(prev); n.add(id); return n; });
      setManuallyExcluded(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  }, [checked]);

  const toggleConfidence = useCallback((c: Confidence) => {
    setEnabled(prev => {
      const n = new Set(prev);
      if (n.has(c)) n.delete(c); else n.add(c);
      return n;
    });
  }, []);

  const applyPlan = useCallback(() => {
    if (!plan || !onApplyPlan) return;
    const removeNames: string[] = [];
    const addNames: string[] = [];
    for (const row of allRows) {
      if (!checked.has(row.id)) continue;
      removeNames.push(row.current.name);
      addNames.push(row.suggestion.name);
    }
    if (removeNames.length === 0) return;
    onApplyPlan(removeNames, addNames);
    setManuallyExcluded(new Set());
    setManuallyIncluded(new Set());
    setTarget(null);
  }, [plan, onApplyPlan, allRows, checked]);

  if (!analysis || !plan) {
    return <div className="p-6 text-sm text-zinc-400">Analyzing deck cost…</div>;
  }

  const sliderMin = Math.floor(plan.minTotal);
  const sliderMax = Math.max(Math.ceil(plan.currentTotal), sliderMin + 1);
  const sliderValue = target ?? plan.currentTotal;
  const hasAnyRows = plan.spellRows.length > 0 || plan.landRows.length > 0;
  const totalSavings = Math.max(0, plan.currentTotal - projectedTotal);

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-4 p-4">

        {/* ── Sticky budget controls (totals, slider, apply, filter chips) ── */}
        <div className="sticky top-0 z-20 -mx-8 -mt-8 mb-4 px-4 pt-4 pb-3 bg-background/80 backdrop-blur-md border-b border-border/40 flex flex-col gap-3">
        {/* ── Budget header ── */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-3">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-sm text-zinc-400">Current</span>
            <span className="text-xl font-semibold text-zinc-100 tabular-nums">{formatPrice(plan.currentTotal, currency)}</span>
            <span className="text-zinc-600">→</span>
            <span className="text-sm text-zinc-400">Projected</span>
            <span className="text-xl font-semibold text-violet-300 tabular-nums">{formatPrice(projectedTotal, currency)}</span>
            <span className="text-sm text-violet-300/70 tabular-nums">
              (save {formatPrice(totalSavings, currency)})
            </span>
          </div>

          {!hasAnyRows && (
            <div className="text-sm text-zinc-400">
              No cheaper alternatives found for any card in this deck.
            </div>
          )}

          {hasAnyRows && (
            <>
              <div className="flex items-center gap-3">
                <span className="text-xs text-zinc-500 tabular-nums w-16">{formatPrice(sliderMin, currency)}</span>
                <Slider
                  min={sliderMin}
                  max={sliderMax}
                  step={1}
                  value={sliderValue}
                  onChange={(v) => setTarget(v)}
                  className="flex-1"
                  aria-label="Budget target"
                />
                <span className="text-xs text-zinc-500 tabular-nums w-16 text-right">{formatPrice(sliderMax, currency)}</span>
              </div>

              {target != null && (
                <div className="text-xs text-zinc-400">
                  Target: <span className="text-zinc-200 font-medium tabular-nums">{formatPrice(target, currency)}</span>
                </div>
              )}

              {target != null && plan.currentTotal <= target && checked.size === 0 && (
                <div className="text-xs text-emerald-300/80">You're already at or under your target.</div>
              )}
            </>
          )}
        </section>

        {hasAnyRows && (
          <>
            {/* ── Filter chips + Apply button (same row) ── */}
            <section className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-zinc-500">Show:</span>
              {ALL_CONFIDENCES.map(c => {
                const on = enabled.has(c);
                const label = c === 'drop-in' ? 'Drop-in' : c === 'sidegrade' ? 'Sidegrade' : 'Budget pick';
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleConfidence(c)}
                    className={[
                      'px-2.5 py-1 rounded-full text-xs border transition-colors',
                      on
                        ? c === 'drop-in'  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : c === 'sidegrade' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        :                     'bg-rose-500/20 text-rose-300 border-rose-500/40'
                        : 'bg-zinc-900 text-zinc-500 border-zinc-700 hover:text-zinc-300',
                    ].join(' ')}
                  >
                    {label}
                  </button>
                );
              })}
              <Button
                onClick={applyPlan}
                disabled={checked.size === 0}
                className="btn-shimmer ml-auto"
              >
                Apply plan ({checked.size} swap{checked.size === 1 ? '' : 's'}, save {formatPrice(totalSavings, currency)})
              </Button>
            </section>
          </>
        )}
        </div>

        {hasAnyRows && (
          <>
            {/* ── Spells ── */}
            <Section title="Spells" count={plan.spellRows.length} emptyMsg="No cheaper spell alternatives found in role.">
              {plan.spellRows.filter(r => enabled.has(r.confidence)).map(row => (
                <SwapRow
                  key={row.id}
                  row={row}
                  checked={checked.has(row.id)}
                  onToggle={toggleRow}
                  onPreviewCurrent={onPreviewCard}
                  onPreviewSuggestion={onPreviewCard}
                  currency={currency}
                />
              ))}
            </Section>

            {/* ── Lands ── */}
            <Section title="Lands" count={plan.landRows.length} emptyMsg="No cheaper lands match your color identity.">
              {plan.landRows.filter(r => enabled.has(r.confidence)).map(row => (
                <SwapRow
                  key={row.id}
                  row={row}
                  checked={checked.has(row.id)}
                  onToggle={toggleRow}
                  onPreviewCurrent={onPreviewCard}
                  onPreviewSuggestion={onPreviewCard}
                  currency={currency}
                />
              ))}
            </Section>
          </>
        )}

        {/* ── Protected ── */}
        {plan.protected.length > 0 && (
          <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-medium text-zinc-300">Protected</h3>
              <Badge className="text-xs bg-zinc-800 text-zinc-400 border-zinc-700">{plan.protected.length}</Badge>
              <Tooltip>
                <TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-zinc-500" /></TooltipTrigger>
                <TooltipContent>These cards aren't offered as swap targets. Reasons include: your commander, must-include list, basic lands, or missing price data.</TooltipContent>
              </Tooltip>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(() => {
                const grouped = new Map<string, { reason: typeof plan.protected[number]['reason']; count: number }>();
                for (const p of plan.protected) {
                  const existing = grouped.get(p.name);
                  if (existing) existing.count += 1;
                  else grouped.set(p.name, { reason: p.reason, count: 1 });
                }
                return Array.from(grouped, ([name, { reason, count }]) => (
                  <Tooltip key={name}>
                    <TooltipTrigger asChild>
                      <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 cursor-default">
                        {name}{count > 1 ? ` ×${count}` : ''}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="capitalize">{reason.replace('-', ' ')}</TooltipContent>
                  </Tooltip>
                ));
              })()}
            </div>
          </section>
        )}
      </div>
    </TooltipProvider>
  );
}

function Section({
  title, count, emptyMsg, children,
}: { title: string; count: number; emptyMsg: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
      <h3 className="text-sm font-medium text-zinc-300 mb-2">
        {title} <span className="text-zinc-500 font-normal">({count} suggestion{count === 1 ? '' : 's'})</span>
      </h3>
      {count === 0 ? (
        <div className="text-xs text-zinc-500 italic">{emptyMsg}</div>
      ) : (
        <div className="flex flex-col gap-1.5">{children}</div>
      )}
    </section>
  );
}
