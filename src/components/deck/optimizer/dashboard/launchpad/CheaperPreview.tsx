// src/components/deck/optimizer/dashboard/launchpad/CheaperPreview.tsx
//
// "Make it cheaper": the swaps worth making blind right here, and what the Cost Explorer holds past
// them. One layout whether or not there's a one-click swap, so the Explorer is a destination with
// real cards in it, not a footnote.
import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { getCardImageUrl } from '@/services/scryfall/client';
import { formatPrice, type CostPlan, type SwapRow as CostSwapRow, type SwapSuggestion } from '@/services/deckBuilder/costAnalyzer';
import { ArtChip, OpenTab, PreviewShell, PreviewSkeleton, Rows, SwapRow, useHeldRows } from './parts';
import type { LaunchPadDeps } from './types';
import type { CheaperSwap, GameChangerPressure } from './cheaperSwaps';

/** One-click swaps the panel shows. The tile's "Save $X" sums the same ones. */
export const SHOWN_CHEAPER = 3;
const TEASED = 3;
const NUMBER_WORDS = ['no', 'one', 'two', 'three'];

/** A swap waiting in the Cost Explorer. */
interface Ahead {
  row: CostSwapRow;
  suggestion: SwapSuggestion;
  savings: number;
}

/**
 * Everything the Cost Explorer offers past the rows shown here: one-click swaps past the first few,
 * then the looser channels. One stand-in per card, so the savings add up honestly.
 */
function aheadOf(plan: CostPlan | null, swaps: CheaperSwap[], shown: number): Ahead[] {
  if (!plan) return [];
  const rest = swaps.slice(shown).map(s => ({ row: s.row, suggestion: s.suggestion, savings: s.savings }));
  const taken = new Set(swaps.map(s => s.row.id));
  const looser = [...plan.similarRows, ...plan.roleRows]
    .filter(r => !taken.has(r.id))
    .map(r => ({ row: r, suggestion: r.suggestion, savings: r.savings }));
  return [...rest, ...looser].sort((a, b) => b.savings - a.savings);
}

/** Everything the panel and the Explorer together could take off: the tile's upper figure. */
export const mostSavings = (plan: CostPlan | null, swaps: CheaperSwap[]) =>
  aheadOf(plan, swaps, 0).reduce((s, a) => s + a.savings, 0);

/** What kind of stand-in it is, in a word or two. */
const kindOf = (a: Ahead) =>
  a.suggestion.source === 'role' ? 'Same role'
    : a.row.confidence === 'drop-in' ? 'Close match'
      : 'Similar';

/** The Cost Explorer as somewhere to go: how many swaps, what they're worth, and the biggest few. */
function ExplorerCta({ d, ahead, more, fmt, lead }: {
  d: LaunchPadDeps;
  ahead: Ahead[];
  more: number;
  fmt: (n: number) => string;
  /** No one-click swap above, so this is the panel's main act. */
  lead: boolean;
}) {
  const teased = ahead.slice(0, TEASED);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-emerald-500/40 bg-background/85 px-3.5 py-3.5">
      <div className="min-w-0">
        <p className="mb-1 text-[12px] font-medium text-muted-foreground">In the Cost Explorer</p>
        <p className="text-[14px] font-semibold text-foreground text-balance">
          {ahead.length} {lead ? '' : 'more '}swap{ahead.length === 1 ? '' : 's'}, up to{' '}
          <span className="tabular-nums text-emerald-400">{fmt(more)}</span> off
        </p>
        <p className="mt-1 max-w-prose text-[12.5px] leading-snug text-muted-foreground">
          Cheaper cards in the same role, and similar cards your commander's decks play less often.
          Each shows how often it's played here, and you pick which to take.
        </p>
      </div>

      <ul className="flex flex-col divide-y divide-border/40 text-[12.5px]">
        {teased.map(a => (
          <li key={a.row.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 py-2 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
            <span className="min-w-0"><ArtChip name={a.row.current.name} card={a.row.current} onPreview={d.onPreviewCard} /></span>
            <ArrowRight className="hidden w-3.5 h-3.5 text-muted-foreground sm:block" aria-hidden="true" />
            <span className="col-span-2 row-start-2 flex min-w-0 items-center gap-1.5 sm:col-span-1 sm:row-start-auto">
              <ArrowRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground sm:hidden" aria-hidden="true" />
              <span className="min-w-0"><ArtChip name={a.suggestion.name} card={a.suggestion.card} onPreview={d.onPreviewCard} tone="add" /></span>
              <span className="shrink-0 rounded border border-border/60 px-1.5 text-[11px] text-muted-foreground">{kindOf(a)}</span>
            </span>
            <span className="col-start-2 row-start-1 text-right tabular-nums text-muted-foreground sm:col-start-auto sm:row-start-auto">
              saves <span className="font-semibold text-emerald-400">{fmt(a.savings)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CheaperPreview({ d, plan, swaps, pressure, loading }: {
  d: LaunchPadDeps;
  plan: CostPlan | null;
  swaps: CheaperSwap[];
  pressure: GameChangerPressure | null;
  loading: boolean;
}) {
  const live = useMemo(() => swaps.slice(0, SHOWN_CHEAPER), [swaps]);
  const rows = useHeldRows<CheaperSwap>(live);
  const ahead = useMemo(() => aheadOf(plan, swaps, SHOWN_CHEAPER), [plan, swaps]);
  const fmt = (n: number) => formatPrice(n, d.currency);
  const go = () => d.onNavigate('cost');

  if (loading && !plan) return <PreviewSkeleton label="Pricing every card and its cheaper stand-ins…" />;
  if (!plan || (rows.rows.length === 0 && ahead.length === 0)) {
    return (
      <PreviewShell tab="cost"
        title="Already lean"
        sub="Nothing in this deck has a cheaper card that fills the same role."
        actions={<OpenTab tab="cost" label="Cost Explorer" onClick={go} />}
      />
    );
  }

  const here = rows.rows.reduce((s, r) => s + r.savings, 0);
  const more = ahead.reduce((s, a) => s + a.savings, 0);
  const n = rows.rows.length;
  const aimFirst = pressure && rows.rows.some(s => s.forAim);

  return (
    <PreviewShell tab="cost"
      title={n > 0
        ? <>Save <span className="text-emerald-400 tabular-nums">{fmt(here)}</span> in {n === 1 ? 'one swap' : `${NUMBER_WORDS[n] ?? n} swaps`}</>
        : <>Up to <span className="text-emerald-400 tabular-nums">{fmt(more)}</span> off in the Cost Explorer</>}
      sub={aimFirst
        ? `Bracket ${pressure.aim} allows ${NUMBER_WORDS[pressure.allowed]} Game Changer${pressure.allowed === 1 ? '' : 's'}, so those come out first.`
        : n > 0
          ? "Close matches your commander's decks already play, ready to swap here."
          : "Nothing here is a close enough match to swap blind, so each pick is yours to weigh up."}
      actions={<OpenTab tab="cost" label="Cost Explorer" onClick={go} />}
    >
      {n > 0 && (
        <div className="rounded-lg border border-border/60 bg-background/80 px-2 py-1">
          <p className="px-1.5 pb-0.5 pt-2 text-[12px] font-medium text-muted-foreground">Quick swap{n === 1 ? '' : 's'}</p>
          <Rows>{rows.rows.map(s => {
            const r = s.row;
            const id = `cost:${r.id}`;
            const mana = s.manaDelta != null && Math.abs(s.manaDelta) > 1
              ? `${Math.abs(s.manaDelta)} mana ${s.manaDelta > 0 ? 'more' : 'less'}`
              : null;
            return (
              <SwapRow
                key={r.id}
                out={{
                  name: r.current.name,
                  img: getCardImageUrl(r.current, 'small'),
                  why: (
                    <span className="tabular-nums">
                      {fmt(r.currentPrice)}
                      {s.forAim && <>{' · '}<span className="font-medium text-amber-300">Game Changer</span></>}
                    </span>
                  ),
                }}
                into={{
                  name: s.suggestion.name,
                  img: s.suggestion.imageUrl,
                  why: (
                    <span className="tabular-nums">
                      {fmt(s.suggestion.price)} · saves <span className="font-semibold text-emerald-400">{fmt(s.savings)}</span>
                      {' · '}<span className="text-foreground/80">in {Math.round(s.suggestion.inclusion)}% of decks</span>
                      {mana && <>{' · '}<span className="text-amber-300">{mana}</span></>}
                    </span>
                  ),
                }}
                done={d.isApplied(id)}
                onApply={() => { rows.hold(); d.apply({ id, label: `${r.current.name} → ${s.suggestion.name}`, removals: [r.current.name], additions: [s.suggestion.name] }); }}
                onUndo={() => d.undo(id)}
                onPreview={d.onPreviewCard}
              />
            );
          })}</Rows>
        </div>
      )}

      {ahead.length > 0 && <ExplorerCta d={d} ahead={ahead} more={more} fmt={fmt} lead={n === 0} />}
    </PreviewShell>
  );
}
