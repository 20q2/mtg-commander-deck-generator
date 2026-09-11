import { useMemo, useState } from 'react';
import { Check, Hand as HandIcon, Heart, Layers, Skull, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOpponentStore } from '@/store/opponentStore';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { StackTargeting } from '@/components/playtest/StackTargeting';
import type { StackItem, StackKind } from '@/components/playtest/opponentTypes';
import type { ScryfallCard } from '@/types';

/**
 * The bottom half of the side panel: what the bots have aimed at you and not
 * yet resolved.
 *
 * A bot casting removal used to be a log line and a creature that was suddenly
 * gone. Here the spell stops, shows its face, points at what it is killing, and
 * waits — the one window in this playtest where a bot asks you a question
 * instead of telling you what already happened.
 *
 * "Respond" needs no machinery of its own: while an item waits your board is
 * fully live, so tapping lands and dropping a counterspell into your graveyard
 * are the ordinary moves they always were. The panel only decides whether the
 * effect lands.
 */

const KIND_LABEL: Record<StackKind, string> = {
  spell: 'casts',
  trigger: 'triggers',
  ability: 'activates',
  combo: 'goes off',
};

function artOf(card: ScryfallCard | undefined): string | null {
  if (!card) return null;
  return card.image_uris?.art_crop ?? card.card_faces?.[0]?.image_uris?.art_crop ?? null;
}

export function StackPanel() {
  const stack = useOpponentStore(s => s.stack);
  const resolveTop = useOpponentStore(s => s.resolveStackTop);
  const counterTop = useOpponentStore(s => s.counterStackTop);
  const hold = usePlaytestSettings(s => s.stackHold);
  const setHold = usePlaytestSettings(s => s.setStackHold);

  // Newest first: a stack resolves last-on-first-off, so the item you are being
  // asked about is the one at the top of the list.
  const items = useMemo(() => [...stack].reverse(), [stack]);
  const busy = items.length > 0;

  return (
    <section
      className={`border-t flex flex-col min-h-0 transition-colors ${
        busy
          ? 'basis-1/2 flex-1 border-rose-400/40 bg-rose-950/25'
          : 'basis-auto shrink-0 border-border/50'
      }`}
    >
      <div className="px-2 py-1.5 flex items-center gap-1.5 border-b border-border/40">
        <Layers className={`w-3.5 h-3.5 ${busy ? 'text-rose-300' : 'text-muted-foreground/70'}`} />
        <span className={`text-[11px] font-semibold ${busy ? 'text-rose-100' : 'text-muted-foreground'}`}>
          Stack{busy ? ` · ${items.length}` : ''}
        </span>
        <button
          onClick={() => setHold(!hold)}
          title={
            hold
              ? 'Holding priority — spells wait for you to answer them'
              : 'Auto-passing — spells show for a beat, then resolve themselves'
          }
          className={`ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors ${
            hold
              ? 'border-rose-400/50 bg-rose-500/15 text-rose-200'
              : 'border-border/50 text-muted-foreground/70 hover:text-foreground'
          }`}
        >
          {hold ? 'Hold' : 'Auto'}
        </button>
      </div>

      {!busy ? (
        <div className="px-3 py-2 text-[10px] text-muted-foreground/70 italic leading-snug">
          Nothing waiting. Spells the bots aim at you stop here first.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
          {items.map((item, i) => (
            <StackCard
              key={item.id}
              item={item}
              active={i === 0}
              onResolve={resolveTop}
              onCounter={counterTop}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function StackCard({
  item, active, onResolve, onCounter,
}: {
  item: StackItem;
  /** The one that resolves next — only it gets the buttons and the arrows. */
  active: boolean;
  onResolve: () => void;
  onCounter: () => void;
}) {
  const battlefield = usePlaytestStore(s => s.battlefield);
  // A callback ref rather than useRef: the arrow overlay has to re-measure when
  // the node arrives, and a ref object mutating does not re-render.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  // Targets are read off the live board, so answering by killing the target
  // flips this to a fizzle while the spell is still sitting there.
  const targets = useMemo(
    () => item.effect.destroy
      .map(id => battlefield.find(b => b.instanceId === id))
      .filter((b): b is NonNullable<typeof b> => !!b),
    [item.effect.destroy, battlefield],
  );
  const fizzles = item.effect.destroy.length > 0 && targets.length === 0;
  const art = artOf(item.card);

  return (
    <div
      ref={setAnchor}
      className={`rounded-md overflow-hidden border transition-all ${
        active
          ? 'border-rose-400/60 bg-rose-950/40 shadow-[0_2px_10px_rgba(0,0,0,0.5)]'
          : 'border-border/50 bg-card/50 opacity-60'
      }`}
    >
      {/* The face. Art first, name over it — you should know what hit you
          before you have read a word of it. */}
      <div className="relative h-14 bg-black/60">
        {art && (
          <img src={art} alt="" className="w-full h-full object-cover" draggable={false} loading="lazy" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 px-1.5 pb-1">
          <div className="text-[10px] font-semibold text-foreground leading-tight truncate">
            {item.name}
          </div>
          <div className="text-[9px] text-rose-200/70 leading-tight truncate">
            {item.opponentName} {KIND_LABEL[item.kind]}
          </div>
        </div>
      </div>

      <div className="px-2 py-1.5 space-y-1.5">
        <div className={`text-[10px] leading-snug ${fizzles ? 'text-muted-foreground/70 line-through' : 'text-foreground/90'}`}>
          {item.label}
        </div>

        {targets.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {targets.map(t => {
              const tArt = artOf(t.card);
              return (
                <div
                  key={t.instanceId}
                  className="w-9 h-7 rounded-[3px] overflow-hidden ring-1 ring-rose-400/60 bg-black/50 shrink-0"
                  title={t.card.name}
                >
                  {tArt ? (
                    <img src={tArt} alt="" className="w-full h-full object-cover" draggable={false} loading="lazy" />
                  ) : (
                    <span className="text-[7px] text-muted-foreground px-0.5 truncate block">{t.card.name}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* The effects with no card to point at, as icons rather than another
            sentence — this panel is meant to be read at a glance. */}
        {(item.effect.lifeLoss > 0 || item.effect.discard > 0 || item.effect.lethal) && (
          <div className="flex items-center gap-2 text-[9px] text-rose-200/90">
            {item.effect.lifeLoss > 0 && (
              <span className="flex items-center gap-0.5"><Heart className="w-2.5 h-2.5" />−{item.effect.lifeLoss}</span>
            )}
            {item.effect.discard > 0 && (
              <span className="flex items-center gap-0.5"><HandIcon className="w-2.5 h-2.5" />−{item.effect.discard}</span>
            )}
            {item.effect.lethal && (
              <span className="flex items-center gap-0.5 text-rose-300 font-semibold"><Skull className="w-2.5 h-2.5" />Lethal</span>
            )}
          </div>
        )}

        {fizzles && (
          <div className="text-[9px] text-emerald-300/90 leading-snug">
            No legal target left — it fizzles.
          </div>
        )}

        {active && (
          <div className="flex gap-1 pt-0.5">
            <Button
              size="sm"
              className="h-6 flex-1 text-[10px] gap-1 [&_svg]:size-3 bg-rose-600/80 hover:bg-rose-600 text-white"
              onClick={onResolve}
            >
              <Check />{fizzles ? 'Fizzle' : 'Resolve'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 flex-1 text-[10px] gap-1 [&_svg]:size-3"
              title="You answered it — the effect is thrown away"
              onClick={onCounter}
            >
              <X />Counter
            </Button>
          </div>
        )}
      </div>

      {active && <StackTargeting item={item} anchor={anchor} />}
    </div>
  );
}
