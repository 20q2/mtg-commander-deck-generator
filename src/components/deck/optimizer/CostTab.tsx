import { useMemo, useState, useCallback, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ScryfallCard } from '@/types';
import type { DeckAnalysis } from '@/services/deckBuilder/deckAnalyzer';
import {
  formatPrice, buildSwapRow,
  type SwapRow as SwapRowData,
} from '@/services/deckBuilder/costAnalyzer';
import { useStore } from '@/store';
import { SwapRow } from './CostTab.SwapRow';
import { useCostPlan } from './useCostPlan';

interface CostTabProps {
  commanderName: string;
  partnerCommanderName?: string;
  currentCards: ScryfallCard[];
  analysis: DeckAnalysis | null;
  sideboardNames: string[];
  maybeboardNames: string[];
  onPreviewCard: (name: string) => void;
  /** Preview an exact card object (cheapest printing) so the modal matches the row. */
  onPreviewCardObject?: (card: ScryfallCard) => void;
  onApplyPlan?: (removeNames: string[], addNames: string[]) => void;
}

export function CostTab({
  commanderName, partnerCommanderName, currentCards, analysis,
  sideboardNames, maybeboardNames, onPreviewCard, onPreviewCardObject, onApplyPlan,
}: CostTabProps) {
  const customization = useStore(s => s.customization);
  const currency = customization.currency;
  const mustIncludeCards = customization.mustIncludeCards;

  const mustIncludeNames = useMemo(() => new Set(mustIncludeCards), [mustIncludeCards]);
  const excludeFromSuggestions = useMemo(
    () => new Set([...sideboardNames, ...maybeboardNames]),
    [sideboardNames, maybeboardNames],
  );

  const { plan, loading } = useCostPlan({
    commanderName, partnerCommanderName, currentCards, analysis,
    mustIncludeNames, excludeFromSuggestions, currency,
  });

  const [checked, setChecked] = useState<Set<string>>(new Set());
  // Per-row override: deck card name → chosen alternative name (defaults to cheapest).
  const [chosen, setChosen] = useState<Map<string, string>>(new Map());
  // Deck-card names we just applied a swap for. Applying mutates the deck, which kicks off a
  // full async plan rebuild (EDHREC + Scryfall) that only replaces `plan` at the very end — so
  // without this the applied rows keep rendering stale until the rebuild lands and everything
  // jumps at once. Hiding them optimistically makes the swap feel instant; cleared when the
  // fresh plan arrives (the [plan] effect below).
  const [appliedNames, setAppliedNames] = useState<Set<string>>(new Set());

  // When the plan rebuilds (deck/currency/exclude change re-fetches new alternatives), drop stale
  // selections. Otherwise a `chosen` pick whose alternative no longer exists silently falls back to the
  // cheapest default in overrideRow while the row still looks selected — applyPlan would then swap in a
  // card the user never picked. Re-confirming after a plan change is the safe behavior.
  useEffect(() => {
    setChecked(new Set());
    setChosen(new Map());
    setAppliedNames(new Set());
  }, [plan]);

  // The plan is refreshing in the background (e.g. right after applying a swap): a plan is on
  // screen but a rebuild is in flight.
  const refreshing = loading && !!plan;

  // Apply the user's alternative pick to a row (recomputes savings/confidence).
  const overrideRow = useCallback((row: SwapRowData): SwapRowData => {
    const pick = chosen.get(row.id);
    if (!pick || pick === row.suggestion.name) return row;
    const alt = row.alternatives.find(a => a.name === pick);
    if (!alt) return row;
    return buildSwapRow(row.current, row.currentPrice, row.currentInclusion, alt, row.alternatives);
  }, [chosen]);

  const similarRows = useMemo(
    () => plan ? plan.similarRows.map(overrideRow).filter(r => !appliedNames.has(r.current.name)) : [],
    [plan, overrideRow, appliedNames],
  );
  const roleRows = useMemo(
    () => plan ? plan.roleRows.map(overrideRow).filter(r => !appliedNames.has(r.current.name)) : [],
    [plan, overrideRow, appliedNames],
  );
  const allRows = useMemo(() => [...similarRows, ...roleRows], [similarRows, roleRows]);
  const maxSavings = useMemo(() => allRows.reduce((m, r) => Math.max(m, r.savings), 0), [allRows]);

  const chooseAlternative = useCallback((id: string, name: string) => {
    setChosen(prev => { const n = new Map(prev); n.set(id, name); return n; });
  }, []);

  // Prefer previewing the exact card object we priced (cheapest printing), so the
  // modal's printing + price match this row; fall back to name lookup otherwise.
  const previewTarget = useCallback((name: string, card?: ScryfallCard) => {
    if (card && onPreviewCardObject) onPreviewCardObject(card);
    else onPreviewCard(name);
  }, [onPreviewCard, onPreviewCardObject]);

  const projectedTotal = useMemo(() => {
    if (!plan) return 0;
    let t = plan.currentTotal;
    for (const row of allRows) if (checked.has(row.id)) t -= row.savings;
    return t;
  }, [plan, allRows, checked]);

  // Total savings if every suggested swap were applied.
  const potentialSavings = useMemo(
    () => allRows.reduce((s, r) => s + r.savings, 0),
    [allRows],
  );

  const toggleRow = useCallback((id: string) => {
    setChecked(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);

  const applyPlan = useCallback(() => {
    if (!plan || !onApplyPlan) return;
    const removeNames: string[] = [];
    const addNames: string[] = [];
    const seen = new Set<string>();
    for (const row of allRows) {
      if (!checked.has(row.id)) continue;
      // Two checked rows can point at the same card via manual alternative
      // picks — singleton format, so skip the later row entirely (keep its
      // current card rather than shrink the deck).
      if (seen.has(row.suggestion.name)) continue;
      seen.add(row.suggestion.name);
      removeNames.push(row.current.name);
      addNames.push(row.suggestion.name);
    }
    if (removeNames.length === 0) return;
    onApplyPlan(removeNames, addNames);
    setChecked(new Set());
    setChosen(new Map());
    // Optimistically hide the rows we just swapped so they vanish immediately instead of
    // lingering with stale data until the background rebuild lands.
    setAppliedNames(new Set(removeNames));
  }, [plan, onApplyPlan, allRows, checked]);

  if (!analysis) {
    return <div className="p-6 text-sm text-zinc-400">Analyzing deck cost…</div>;
  }
  if (!plan) {
    return <div className="p-6 text-sm text-zinc-400">Finding cheaper similar cards…</div>;
  }

  // Drive the layout off the rows actually on screen (applied rows are filtered out), so the
  // apply UI and empty-state track what the user can see rather than the raw, pre-swap plan.
  const hasVisibleRows = similarRows.length > 0 || roleRows.length > 0;
  const totalSavings = Math.max(0, plan.currentTotal - projectedTotal);

  return (
    <TooltipProvider>
      {/* Full-bleed: the tab strips its gutter for this one, so the sections span
          the panel and carry their own inner padding. */}
      <div className="flex flex-col gap-4">

        {/* ── Sticky budget controls: the totals and the apply button, nothing else ──
            One container, no card inside it. The band's own background and bottom
            border are the frame; a bordered panel within them was a box in a box.
            Reaches the panel edges on its own now — it used negative margins to
            claw back out of the padding that used to sit outside it. */}
        <div className="sticky top-0 z-20 px-4 pt-4 pb-3 bg-background/80 backdrop-blur-md border-b border-border/40 flex items-center gap-4 flex-wrap">
          <div className="flex items-baseline gap-2 flex-shrink-0">
            <span className="text-sm text-zinc-400">Current</span>
            <span className="text-lg font-semibold text-zinc-100 tabular-nums">{formatPrice(plan.currentTotal, currency)}</span>
            <span className="text-zinc-600">→</span>
            <span className="text-lg font-semibold text-violet-300 tabular-nums">{formatPrice(projectedTotal, currency)}</span>
            <span className="text-xs text-violet-300/70 tabular-nums">(save {formatPrice(totalSavings, currency)})</span>
          </div>

          {refreshing && (
            <span className="flex items-center gap-1.5 text-xs text-zinc-500 flex-shrink-0">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating plan…
            </span>
          )}

          {hasVisibleRows ? (
            <Button
              onClick={applyPlan}
              disabled={checked.size === 0}
              className="btn-shimmer flex-shrink-0 ml-auto"
            >
              Apply plan ({checked.size} swap{checked.size === 1 ? '' : 's'}, save {formatPrice(totalSavings, currency)})
            </Button>
          ) : refreshing ? null : (
            <span className="text-sm text-zinc-400 ml-auto">No cheaper alternatives found for any card in this deck.</span>
          )}
        </div>

        {/* The plan's headline number, as a hint strip. It was competing with the
            totals and the button for the sticky row; it's context you read once,
            so it scrolls away with the list rather than holding space up top.
            Wears the band's own background and butts against it (`-mt-4` eats the
            column gap) so it reads as a second tier of the header, not a stray
            line of body copy. */}
        {hasVisibleRows && (
          <p className="-mb-4 -mt-4 px-4 py-1.5 bg-background/80 text-xs text-zinc-500">
            Apply every suggestion to save up to{' '}
            <span className="font-semibold text-emerald-300/90 tabular-nums">{formatPrice(potentialSavings, currency)}</span>
            {' '}across {allRows.length} card{allRows.length === 1 ? '' : 's'}.
          </p>
        )}

        {!hasVisibleRows && refreshing && (
          <div className="flex items-center gap-2 text-sm text-zinc-400 px-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Updating cost plan…
          </div>
        )}

        {hasVisibleRows && (
          <div className={`flex flex-col gap-4 transition-opacity ${refreshing ? 'opacity-50 pointer-events-none' : ''}`}>
            {/* ── Similar alternatives (trustworthy) ── */}
            <Section
              title="Similar alternatives"
              count={similarRows.length}
              subtitle="Cheaper cards EDHREC considers functionally similar."
              emptyMsg="No cheaper similar cards found for your priciest cards."
            >
              {similarRows.map(row => (
                <SwapRow
                  key={row.id}
                  row={row}
                  checked={checked.has(row.id)}
                  maxSavings={maxSavings}
                  onToggle={toggleRow}
                  onChoose={chooseAlternative}
                  onPreview={previewTarget}
                  currency={currency}
                />
              ))}
            </Section>

            {/* ── Budget swaps (looser, role-based) — only when present ── */}
            {roleRows.length > 0 && (
              <Section
                title="Budget swaps · looser matches"
                count={roleRows.length}
                subtitle="Cheapest cards sharing the same role or land slot — less precise."
                emptyMsg="No looser role-based swaps available."
              >
                {roleRows.map(row => (
                  <SwapRow
                    key={row.id}
                    row={row}
                    checked={checked.has(row.id)}
                    maxSavings={maxSavings}
                    onToggle={toggleRow}
                    onChoose={chooseAlternative}
                    onPreview={previewTarget}
                    currency={currency}
                  />
                ))}
              </Section>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function Section({
  title, count, emptyMsg, subtitle, children,
}: { title: string; count: number; emptyMsg: string; subtitle?: string; children: React.ReactNode }) {
  return (
    // A full-bleed band rather than a rounded card: the page has no gutter to
    // float a card in, and rounded corners against the panel edge read as a
    // mistake. `px-4` lines its content up with the sticky bar above.
    <section className="border-y border-zinc-800 bg-zinc-900/30 px-4 py-3">
      <h3 className="text-sm font-medium text-zinc-300 mb-0.5">
        {title} <span className="text-zinc-500 font-normal">({count} suggestion{count === 1 ? '' : 's'})</span>
      </h3>
      {subtitle && <p className="text-xs text-zinc-500 mb-2">{subtitle}</p>}
      {count === 0 ? (
        <div className="text-xs text-zinc-500 italic">{emptyMsg}</div>
      ) : (
        <div className="flex flex-col gap-1.5">{children}</div>
      )}
    </section>
  );
}
