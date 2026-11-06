// src/components/deck/optimizer/dashboard/launchpad/UpgradesPreview.tsx
//
// "Find upgrades": which cards are the weakest fit, and what to play instead. Pairs come from Card
// Fit's own columns, so this and the tab always agree.
import { useMemo, type ReactNode } from 'react';
import { Check, ChevronRight, Minus, Plus, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { OptimizeCard } from '@/services/deckBuilder/deckAnalyzer';
import { projectSwaps } from '@/services/deckBuilder/planScore';
import { useStore } from '@/store';
import { addReason, cutReason, type SwapPair } from './jobs';
import { CardThumb, OpenTab, PreviewShell, Rows, SwapRow, useHeldRows } from './parts';
import type { LaunchPadDeps } from './types';
import { CombosDoor, combosCompletedBy } from './doors';

const SHOWN = 3;
const pairId = (p: SwapPair) => `swap:${p.out.name}→${p.in.name}`;

/** One-sided row for a deck at the wrong size: just a cut, or just an add. */
function SingleRow({ card, why, kind, done, onApply, onUndo, onPreview }: {
  card: OptimizeCard;
  why: ReactNode;
  kind: 'cut' | 'add';
  done: boolean;
  onApply: () => void;
  onUndo: () => void;
  onPreview: (name: string) => void;
}) {
  const Icon = kind === 'cut' ? Minus : Plus;
  return (
    <div className={`flex items-center gap-2.5 rounded-md px-1.5 py-2.5 transition-colors ${done ? 'bg-emerald-500/[0.07]' : ''}`}>
      <CardThumb name={card.name} src={card.imageUrl} onPreview={onPreview} />
      <div className="min-w-0 flex-1 flex flex-col">
        <span className={`text-[13px] font-semibold truncate ${kind === 'cut' ? 'text-rose-300' : 'text-violet-200'} ${done && kind === 'cut' ? 'line-through opacity-60' : ''}`}>
          {card.name}
        </span>
        <span className="text-[11.5px] leading-snug text-muted-foreground">{why}</span>
      </div>
      {done ? (
        <Button type="button" size="sm" variant="outline" onClick={onUndo}
          className="gap-1.5 border-emerald-500/40 bg-transparent text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300">
          <Undo2 className="w-3.5 h-3.5" /> Undo
        </Button>
      ) : (
        <Button type="button" size="sm" variant={kind === 'cut' ? 'outline' : 'default'} onClick={onApply} className="gap-1.5">
          <Icon className="w-3.5 h-3.5" /> {kind === 'cut' ? 'Cut' : 'Add'}
        </Button>
      )}
    </div>
  );
}

/** "Kept: Fireball ×" — the player's own holds, each one undoable. */
function KeptLine({ d }: { d: LaunchPadDeps }) {
  if (d.kept.size === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span>Kept:</span>
      {[...d.kept].map(name => (
        <Button key={name} type="button" variant="outline" size="sm" onClick={() => d.unkeep(name)}
          title={`Suggest ${name} again`}
          className="h-6 gap-1 rounded-full border-border/50 bg-transparent px-2 text-xs font-normal text-foreground/85">
          {name.split(',')[0]} <X className="w-3 h-3 text-muted-foreground" />
        </Button>
      ))}
    </div>
  );
}

export function UpgradesPreview({ d }: { d: LaunchPadDeps }) {
  const removals = (d.baseSwaps?.removals ?? []).filter(r => !d.kept.has(r.name));
  const additions = d.baseSwaps?.additions ?? [];
  const held = useHeldRows<SwapPair>(d.pairs);
  // A held row whose cut the player just kept leaves the list (unless it was already swapped).
  const pairs = { ...held, rows: held.rows.filter(p => !d.kept.has(p.out.name) || d.isApplied(pairId(p))) };
  const over = d.deckExcess > 0;
  // The combos a combo-enabler add would finish, so its "Completes N combos" opens them.
  const detectedCombos = useStore(s => s.generatedDeck?.detectedCombos);
  const addWhy = (c: OptimizeCard, replacing?: OptimizeCard): ReactNode => {
    const finishes = c.reasonCategory === 'combo-enabler' ? combosCompletedBy(c.name, detectedCombos) : [];
    if (finishes.length === 0) return addReason(c, d.reasonCtx, replacing);
    return (
      <>
        <CombosDoor name={c.name} combos={finishes} onPreview={d.onPreviewCard} />
        {c.inclusion != null && ` · in ${Math.round(c.inclusion)}% of ${d.reasonCtx.commanderShort} decks`}
      </>
    );
  };
  const under = d.deckExcess < 0;
  const singles = useHeldRows<OptimizeCard>(
    (over ? removals : under ? additions : []).slice(0, Math.min(SHOWN, Math.abs(d.deckExcess) || SHOWN)),
  );

  // Per-row points, projected over the rows still to do, in the order shown. The chip states what
  // these rows are worth — not the whole Card Fit column, which is how "+10" once sat over a +6.
  const todo = pairs.rows.filter(p => !d.isApplied(pairId(p)));
  const rowGain = useMemo(() => {
    const proj = projectSwaps(
      d.planScore, d.analysis.cardFitMisfits ?? d.analysis.misfits ?? [], d.analysis.cardFitGaps ?? d.analysis.gapAnalysis ?? [],
      todo.map(p => ({ out: p.out.name, in: p.in.name })),
      d.analysis.strategyBasis ? { basis: d.analysis.strategyBasis, themeAdds: d.analysis.strategyThemeAdds ?? [] } : undefined,
    );
    const gains = new Map<string, number>();
    todo.forEach((p, i) => gains.set(pairId(p), proj[i] - (i === 0 ? d.planScore.overall : proj[i - 1])));
    return gains;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.planScore, d.analysis, todo.map(pairId).join('|')]);
  const todoPoints = todo.reduce((s, p) => s + Math.max(0, rowGain.get(pairId(p)) ?? 0), 0);

  const footNote = `${removals.length} cut${removals.length === 1 ? '' : 's'} and ${additions.length} add${additions.length === 1 ? '' : 's'} lined up in Card Fit`;
  const openCardFit = (shown: SwapPair[]) => d.onNavigate('optimize', shown[0]
    ? { cardName: shown[0].out.name, side: 'remove', pairs: shown.map(p => ({ out: p.out.name, in: p.in.name })) }
    : undefined);

  // ── Wrong size: get to the target first; a swap would leave the count where it is. ──
  if (over || under) {
    const n = Math.abs(d.deckExcess);
    const kind = over ? 'cut' : 'add';
    return (
      <PreviewShell tab="optimize"
        title={over ? `You're ${n} card${n === 1 ? '' : 's'} over ${d.deckTarget}` : `You're ${n} card${n === 1 ? '' : 's'} short of ${d.deckTarget}`}
        sub={over ? 'Card Fit\'s weakest picks.' : 'Card Fit\'s strongest picks for the open slots.'}
        footNote={footNote}
        actions={<OpenTab tab="optimize" label="Card Fit" onClick={() => d.onNavigate('optimize', singles.rows[0] ? { cardName: singles.rows[0].name, side: over ? 'remove' : 'add' } : undefined)} />}
      >
        <Rows>{singles.rows.map(c => {
          const id = `${kind}:${c.name}`;
          return (
            <SingleRow
              key={c.name}
              card={c}
              kind={kind}
              why={over ? cutReason(c, d.reasonCtx) : addWhy(c)}
              done={d.isApplied(id)}
              onApply={() => { singles.hold(); d.apply({ id, label: `${over ? 'Cut' : 'Add'} ${c.name}`, removals: over ? [c.name] : [], additions: over ? [] : [c.name] }); }}
              onUndo={() => d.undo(id)}
              onPreview={d.onPreviewCard}
            />
          );
        })}</Rows>
      </PreviewShell>
    );
  }

  // ── At size, nothing to cut: say so, and show the best cards the deck doesn't run. ──
  if (pairs.rows.length === 0) {
    return (
      <PreviewShell tab="optimize"
        title="Every card pulls its weight"
        sub={additions.length > 0
          ? 'Card Fit has nothing to cut. The strongest cards you don\'t run:'
          : 'Card Fit has nothing to cut or add.'}
        footNote={footNote}
        actions={<OpenTab tab="optimize" label="Card Fit" onClick={() => openCardFit([])} />}
      >
        {additions.length > 0 && (
          <Rows>
            {additions.slice(0, SHOWN).map(a => (
              <div key={a.name} className="flex items-center gap-2.5 px-1.5 py-2.5">
                <CardThumb name={a.name} src={a.imageUrl} onPreview={d.onPreviewCard} />
                <div className="min-w-0 flex flex-col">
                  <span className="text-[13px] font-semibold text-violet-200 truncate">{a.name}</span>
                  <span className="text-[11.5px] leading-snug text-muted-foreground">{addWhy(a)}</span>
                </div>
              </div>
            ))}
          </Rows>
        )}
        <KeptLine d={d} />
      </PreviewShell>
    );
  }

  const n = pairs.rows.length;
  const allDone = todo.length === 0;
  // Swaps for the aim lead whenever there are any; they are a different ask from "weakest fits".
  const forAim = pairs.rows.some(p => p.out.reasonCategory === 'over-bracket') ? d.reasonCtx.judgedBracket : undefined;
  // The live list already reflects the swaps made, so whatever it holds now is the next batch.
  const nextBatch = d.pairs.filter(p => !pairs.rows.some(r => pairId(r) === pairId(p)));
  const swapAll = () => {
    pairs.hold();
    for (const p of todo) d.apply({ id: pairId(p), label: `${p.out.name} → ${p.in.name}`, removals: [p.out.name], additions: [p.in.name] });
  };

  return (
    <PreviewShell tab="optimize"
      title={allDone
        ? <span className="inline-flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" />Done. Your deck is at {d.planScore.overall}.</span>
        : forAim ? `Bring it down to Bracket ${forAim}`
        : n === 1 ? 'Your weakest fit' : `Your ${n} weakest fits`}
      sub={allDone
        ? 'Undo any swap below, or load the next ones.'
        : forAim ? `Swap what holds it above Bracket ${forAim} for what Bracket ${forAim} decks play.`
        : 'The cards that fit this deck least, and what to play instead.'}
      aside={!allDone && todoPoints > 0 && (
        <span className="inline-flex items-center rounded-full bg-violet-500/20 px-2.5 py-0.5 text-xs font-bold tabular-nums text-violet-200 whitespace-nowrap"
          title="Projected from Card Fit's own formula: the cards leaving stop counting against you, the cards arriving stop counting as missing.">
          about +{todoPoints} for {todo.length === 1 ? 'this one' : `these ${todo.length}`}
        </span>
      )}
      footNote={footNote}
      actions={<>
        {allDone && nextBatch.length > 0 && (
          <Button type="button" size="sm" variant="outline" onClick={pairs.release} className="gap-1">
            Show the next {Math.min(SHOWN, nextBatch.length)} <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        )}
        {todo.length > 1 && (
          <Button type="button" size="sm" variant="outline" onClick={swapAll}>Swap all {todo.length}</Button>
        )}
        <OpenTab tab="optimize" label="Card Fit" onClick={() => openCardFit(todo)} />
      </>}
    >
      <Rows>{pairs.rows.map(p => {
        const id = pairId(p);
        return (
          <SwapRow
            key={id}
            out={{ name: p.out.name, img: p.out.imageUrl, why: cutReason(p.out, d.reasonCtx) }}
            into={{ name: p.in.name, img: p.in.imageUrl, why: addWhy(p.in, p.out) }}
            done={d.isApplied(id)}
            gain={rowGain.get(id)}
            onApply={() => { pairs.hold(); d.apply({ id, label: `${p.out.name} → ${p.in.name}`, removals: [p.out.name], additions: [p.in.name] }); }}
            onUndo={() => d.undo(id)}
            // With nothing swapped yet, let the list refill so a kept card's slot goes to the next pick.
            onKeep={() => { d.keep(p.out.name); if (!pairs.rows.some(r => d.isApplied(pairId(r)))) held.release(); }}
            onPreview={d.onPreviewCard}
          />
        );
      })}</Rows>
      <KeptLine d={d} />
    </PreviewShell>
  );
}

