import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Hand as HandIcon, Heart, Layers, Skull, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOpponentStore } from '@/store/opponentStore';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings, type StackMode } from '@/store/playtestSettingsStore';
import { StackTargeting } from '@/components/playtest/StackTargeting';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { useMagnifyHover } from '@/components/playtest/hooks/useMagnifyHover';
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

/**
 * The three settings, in the order the button cycles them: least interruption
 * to most. Each one answers the same question — how much of a bot's turn stops
 * and waits for you — so they live in one table rather than as scattered
 * conditionals.
 */
const MODES: {
  key: StackMode;
  label: string;
  /** Sentence in the idle panel, after "Label — ". */
  blurb: string;
  /** Tooltip sentence on the button. */
  hint: string;
  chip: string;
  accent: string;
}[] = [
  {
    key: 'auto',
    label: 'Pass',
    blurb: 'each one shows for a beat and then resolves itself. Their turn never stops, so there is no window to counter anything.',
    hint: 'Auto-passing — spells show for a beat, then resolve themselves.',
    chip: 'border-border/50 text-muted-foreground/70 hover:text-foreground',
    accent: 'text-foreground/80',
  },
  {
    key: 'targeted',
    label: 'Targeting Me',
    blurb: 'anything they point at you pauses here until you answer. Tap lands, cast what you need, then Resolve it or Counter it yourself.',
    hint: "Holding priority — a bot's turn pauses on anything aimed at you.",
    chip: 'border-rose-400/50 bg-rose-500/15 text-rose-200',
    accent: 'text-rose-200',
  },
  {
    key: 'everything',
    label: 'Hold all',
    blurb: 'every spell they cast pauses here, even the ones that never touch your board — so a counterspell can answer their ramp, not just their removal. Land drops still run at speed.',
    hint: 'Holding priority on EVERY spell they cast, not just the ones aimed at you.',
    chip: 'border-violet-400/60 bg-violet-500/20 text-violet-100',
    accent: 'text-violet-200',
  },
];

function artOf(card: ScryfallCard | undefined): string | null {
  if (!card) return null;
  return card.image_uris?.art_crop ?? card.card_faces?.[0]?.image_uris?.art_crop ?? null;
}

export function StackPanel() {
  const stack = useOpponentStore(s => s.stack);
  const resolveTop = useOpponentStore(s => s.resolveStackTop);
  const counterTop = useOpponentStore(s => s.counterStackTop);
  const mode = usePlaytestSettings(s => s.stackMode);
  const setMode = usePlaytestSettings(s => s.setStackMode);
  const next = MODES[(MODES.findIndex(m => m.key === mode) + 1) % MODES.length];
  const current = MODES.find(m => m.key === mode) ?? MODES[1];

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
      // Its top edge lines up with the hand's, so the strip reads as two rows
      // rather than a column with a gap in it. The hand publishes its own
      // height (see Hand.tsx) because nothing else can know it — it changes
      // with card size, with the sort row, and with whether you are holding
      // anything. A floor rather than a fixed height: when something is
      // actually waiting the panel still grows upward into the log.
      style={{ minHeight: 'var(--playtest-hand-h, 0px)' }}
    >
      <div className="px-2 py-1.5 flex items-center gap-1.5 border-b border-border/40">
        <Layers className={`w-3.5 h-3.5 ${busy ? 'text-rose-300' : 'text-muted-foreground/70'}`} />
        <span className={`text-[11px] font-semibold ${busy ? 'text-rose-100' : 'text-muted-foreground'}`}>
          Stack{busy ? ` · ${items.length}` : ''}
        </span>
        {/* One button cycling three settings rather than three buttons: the
            strip is 224px wide and this is a preference, not a decision you
            make mid-turn. The tooltip names what clicking does next. */}
        <button
          onClick={() => setMode(next.key)}
          title={`${current.hint} Click for ${next.label}.`}
          aria-label={`Stack mode: ${current.label}`}
          className={`ml-auto shrink-0 whitespace-nowrap text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors ${current.chip}`}
        >
          {current.label}
        </button>
      </div>

      {!busy ? (
        // The idle panel is the only place the two modes can be explained,
        // because it is the only time this panel is on screen and not urgent.
        // Keyed on the mode rather than describing both: you are choosing
        // whether a bot's turn STOPS for you, and the useful sentence is the
        // one about the setting you are actually playing under.
        <div className="px-3 py-2 text-[10px] text-muted-foreground/70 leading-snug space-y-1.5">
          <p className="italic">Nothing waiting. Spells the bots aim at you stop here first.</p>
          <p>
            <span className={`font-semibold ${current.accent}`}>{current.label}</span>
            {' — '}{current.blurb}
          </p>
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
          before you have read a word of it. Then hover it for the rules text,
          because knowing what hit you is not the same as knowing what it
          does, and that is the question this panel is asking. */}
      <PreviewOnHover
        card={item.card}
        title={item.card ? `${item.card.name} — point at it to read it` : undefined}
        className="relative h-14 bg-black/60"
      >
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
      </PreviewOnHover>

      <div className="px-2 py-1.5 space-y-1.5">
        <div className={`text-[10px] leading-snug ${fizzles ? 'text-muted-foreground/70 line-through' : 'text-foreground/90'}`}>
          {item.label}
        </div>

        {targets.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {targets.map(t => {
              const tArt = artOf(t.card);
              return (
                <PreviewOnHover
                  key={t.instanceId}
                  card={t.card}
                  title={`${t.card.name} — yours, and what this is aimed at`}
                  scope="own"
                  className="w-9 h-7 rounded-[3px] overflow-hidden ring-1 ring-rose-400/60 bg-black/50 shrink-0"
                >
                  {tArt ? (
                    <img src={tArt} alt="" className="w-full h-full object-cover" draggable={false} loading="lazy" />
                  ) : (
                    <span className="text-[7px] text-muted-foreground px-0.5 truncate block">{t.card.name}</span>
                  )}
                </PreviewOnHover>
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
              title={
                item.arrived?.length
                  // Only the `everything` mode makes items like this — see
                  // counterStackTop, which takes the body back off the board.
                  ? 'You answered it — the spell is countered and goes to their graveyard'
                  : 'You answered it — the effect is thrown away'
              }
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

/**
 * Anything in this panel that is an art crop rather than a card face, made
 * hoverable: the spell's own face, and each of your permanents it is pointing
 * at.
 *
 * Behind the magnify setting like every other preview on the table. It used to
 * be exempt, on the argument that a 56px art crop carries no rules text and so
 * "hold Ctrl" would leave the spell you are being asked to answer unreadable —
 * but the tile already prints the spell's name over its art and says what it
 * does in words underneath, and each target thumb names itself in a tooltip.
 * The preview is the rules text, which is the same thing it is everywhere
 * else, so it answers to the same choice.
 *
 * Scope is per card, not per panel: the spell is theirs, the permanents it is
 * pointing at are yours. With the bots' side on `follow` that is one setting
 * anyway.
 *
 * `side="right"` because the panel is pinned to the right edge of the window:
 * the preview finds no room there and flips to the left, clear of the tile it
 * came from.
 */
function PreviewOnHover({ card, title, className, scope = 'opponent', children }: {
  card?: ScryfallCard;
  title?: string;
  className?: string;
  /** Whose card this is, which decides which preview setting answers for it. */
  scope?: 'own' | 'opponent';
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const magnified = useMagnifyHover(hovered, scope);
  return (
    <div
      ref={ref}
      title={title}
      className={`${className ?? ''}${card ? ' cursor-zoom-in' : ''}`}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHovered(true); }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHovered(false); }}
    >
      {children}
      {card && magnified && <MagnifiedPreview card={card} anchorRef={ref} side="right" />}
    </div>
  );
}
