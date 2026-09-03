import { useEffect, useMemo, useRef, useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import {
  BookOpen, Bot, ChevronLeft, Heart, Play, Plus,
  Skull, Sparkles, Swords, Trash2, X, type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { useOpponentStore, MAX_OPPONENTS } from '@/store/opponentStore';
import { getCardImageUrl, getFrontFaceTypeLine } from '@/services/scryfall/client';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { useMagnifyKey } from '@/hooks/useMagnifyKey';
import { OpponentCardMenu, type OpponentMenuTarget } from '@/components/playtest/opponents/OpponentCardMenu';
import type { Opponent, OpponentPermanent } from '@/components/playtest/opponentTypes';
import type { ScryfallCard } from '@/types';

/**
 * The opponent column, beside the table rather than across the top. With nobody
 * seated it collapses to a narrow rail so it costs almost nothing, and the rail
 * is still the entry point — the discovery moment lives in the play area.
 */
const WIDTH_KEY = 'playtest-opponent-column-width';
const MIN_WIDTH = 150;
const MAX_WIDTH = 460;

export function OpponentStrip() {
  const opponents = useOpponentStore(s => s.opponents);
  const runAllTurns = useOpponentStore(s => s.runAllTurns);
  const openModal = usePlaytestStore(s => s.openModal);
  const autoTurns = usePlaytestSettings(s => s.opponentAutoTurns);
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(stored) && stored >= MIN_WIDTH ? Math.min(stored, MAX_WIDTH) : 208;
  });

  // Drag the right edge to resize. Pointer capture rather than window listeners
  // so a fast drag that outruns the handle doesn't drop the gesture.
  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const startX = e.clientX;
    const startWidth = width;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + (ev.clientX - startX)));
      setWidth(next);
    };
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      try { el.releasePointerCapture(ev.pointerId); } catch { /* noop */ }
      // Read off the element rather than closing over stale state.
      const final = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + (ev.clientX - startX)));
      localStorage.setItem(WIDTH_KEY, String(final));
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  // Empty, or deliberately collapsed → a rail just wide enough to get back.
  if (opponents.length === 0 || collapsed) {
    return (
      <div className="hidden md:flex shrink-0 w-9 border-r border-border/50 bg-card/30 flex-col items-center gap-2 py-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() => (opponents.length === 0 ? openModal({ kind: 'opponents' }) : setCollapsed(false))}
          title={opponents.length === 0 ? 'Play against bots' : 'Show opponents'}
        >
          <Bot className="w-4 h-4 text-violet-300/80" />
        </Button>
        {opponents.length === 0 ? (
          <span
            className="text-[10px] uppercase tracking-wider text-muted-foreground/60 select-none"
            style={{ writingMode: 'vertical-rl' }}
          >
            Play against bots
          </span>
        ) : (
          <>
            <span className="text-[10px] font-bold tabular-nums text-violet-200">{opponents.length}</span>
            <span
              className="text-[10px] uppercase tracking-wider text-muted-foreground/60 select-none"
              style={{ writingMode: 'vertical-rl' }}
            >
              {opponents.map(o => `${o.name} ${o.life}`).join(' · ')}
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      className="hidden md:flex shrink-0 relative border-r border-border/50 bg-card/30 flex-col min-h-0"
      style={{ width }}
    >
      {/* Resize handle on the right edge. */}
      <div
        onPointerDown={onResizeStart}
        onDoubleClick={() => { setWidth(208); localStorage.setItem(WIDTH_KEY, '208'); }}
        title="Drag to resize · double-click to reset"
        className="absolute top-0 right-0 h-full w-1.5 translate-x-1/2 z-20 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
      />
      <div className="px-2 py-1 flex items-center gap-1.5 border-b border-border/40">
        <Bot className="w-3.5 h-3.5 text-violet-300/80 shrink-0" />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 flex-1">
          Opponents · {opponents.length}
        </span>
        {/* With auto-turns off, Next Turn no longer moves the table, so this is
            the only way for the bots to act. */}
        {!autoTurns && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[10px]"
            onClick={() => runAllTurns()}
            title="Run every bot's turn now (auto-turns are off in Settings → Bots)"
          >
            <Play className="w-3 h-3 mr-1" />Turn
          </Button>
        )}
        {opponents.length < MAX_OPPONENTS && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => openModal({ kind: 'opponents' })}
            title="Seat another opponent"
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={() => setCollapsed(true)}
          title="Collapse opponents"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 p-2">
        {opponents.map(o => <OpponentLane key={o.id} opponent={o} columnWidth={width} />)}
      </div>
    </div>
  );
}

function OpponentLane({ opponent, columnWidth }: { opponent: Opponent; columnWidth: number }) {
  const adjustLife = useOpponentStore(s => s.adjustLife);
  const remove = useOpponentStore(s => s.remove);
  const setResistance = useOpponentStore(s => s.setResistance);
  const openModal = usePlaytestStore(s => s.openModal);
  const running = useOpponentStore(s => s.running);
  const tiny = 'px-1 rounded bg-accent/40 hover:bg-accent text-[10px] font-medium leading-4';

  // Drop target for donating one of your permanents to this bot.
  const { setNodeRef, isOver } = useDroppable({
    id: `opponent:${opponent.id}`,
    data: { kind: 'opponentLane', opponentId: opponent.id },
  });

  const rows = useMemo(() => splitRows(opponent.battlefield), [opponent.battlefield]);
  // Zone piles track the column too, but stay smaller than the land row.
  const zoneWidth = Math.round(Math.max(20, Math.min(44, columnWidth * 0.12)));

  return (
    <div
      ref={setNodeRef}
      className={`shrink-0 rounded-lg border bg-background/30 p-1.5 transition-colors ${
        isOver ? 'border-violet-400/70 bg-violet-500/10'
        : running ? 'border-violet-400/40'
        : 'border-border/40'
      }`}
    >
      {/* One header row: who they are, their life, whether they fight back, and
          the way out. Everything that was stacked below now lives here. */}
      <div className="flex items-center gap-1">
        <span className="text-[11px] font-semibold truncate flex-1 min-w-0">{opponent.name}</span>

        <button onClick={() => adjustLife(opponent.id, -1)} className={tiny} title="−1 life">−</button>
        <span
          className="inline-flex items-center gap-0.5 px-1 rounded bg-rose-500/15 border border-rose-400/40 text-rose-300 font-bold text-[11px] leading-4 tabular-nums"
          title={`${opponent.name}'s life`}
        >
          <Heart className="w-2.5 h-2.5 fill-rose-400/40" />
          {opponent.life}
        </span>
        <button onClick={() => adjustLife(opponent.id, 1)} className={tiny} title="+1 life">+</button>

        {/* Icon-only: the label wouldn't fit beside life in a narrow column, and
            the colour already carries the state. */}
        <button
          onClick={() => setResistance(opponent.id, !opponent.resistance)}
          title={
            opponent.resistance
              ? 'Resisting — casts removal and sweepers at your board. Click for a passive dummy.'
              : 'Passive — only develops and attacks. Click to let it fight back.'
          }
          aria-label={opponent.resistance ? 'Resisting' : 'Passive'}
          aria-pressed={opponent.resistance}
          className={`shrink-0 inline-flex items-center justify-center w-5 h-4 rounded border transition-colors ${
            opponent.resistance
              ? 'border-violet-400/50 bg-violet-500/15 text-violet-200'
              : 'border-border/50 bg-transparent text-muted-foreground/50'
          }`}
        >
          <Swords className="w-2.5 h-2.5" />
        </button>

        <button
          onClick={() => remove(opponent.id)}
          className="shrink-0 text-muted-foreground/70 hover:text-red-400 transition-colors"
          title={`Remove ${opponent.name}`}
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Mirrors your own hand row: hand on the left, then Library / Graveyard /
          Exile grouped right, with Exile half-width and hanging from the top. */}
      <div className="mt-1.5 flex items-end gap-1">
        <HandFan count={opponent.hand.length} width={zoneWidth} />
        <div className="ml-auto flex items-end gap-1">
          <ZonePile
            label="Library" count={opponent.library.length} width={zoneWidth}
            hint={opponent.decked ? 'Library is empty' : 'Cards left in library'}
            warn={opponent.decked}
            Icon={BookOpen} tint="bg-blue-500/10 border-blue-400/30"
          />
          <ZonePile
            label="Graveyard" count={opponent.graveyard.length} width={zoneWidth}
            top={opponent.graveyard[opponent.graveyard.length - 1]}
            hint="Click to view their graveyard"
            onClick={() => openModal({ kind: 'opponentZone', opponentId: opponent.id, zone: 'graveyard' })}
            Icon={Trash2} tint="bg-zinc-500/15 border-zinc-400/30"
          />
          <div className="self-start">
            <ZonePile
              label="Exile" count={opponent.exile.length}
              width={Math.max(14, Math.round(zoneWidth * 0.5))}
              top={opponent.exile[opponent.exile.length - 1]}
              hint="Click to view their exile"
              onClick={() => openModal({ kind: 'opponentZone', opponentId: opponent.id, zone: 'exile' })}
              Icon={Sparkles} tint="bg-amber-500/10 border-amber-400/30"
            />
          </div>
        </div>
      </div>

      <div className="mt-1 space-y-1 min-h-[52px]">
        {opponent.battlefield.length === 0 ? (
          // A drop target you can see, rather than a sentence explaining one.
          <div
            className={`h-[44px] rounded-md border border-dashed transition-colors ${
              isOver ? 'border-violet-400/70 bg-violet-500/10' : 'border-border/50'
            }`}
            aria-label="Drop a permanent here to give it to this opponent"
          />
        ) : (
          ROW_ORDER.map(row => {
            const cards = rows[row.key];
            if (cards.length === 0) return null;
            return (
              <div key={row.key} className="flex items-end gap-1 flex-wrap" title={row.label}>
                {cards.map(p => (
                  <OpponentPermanentCard
                    key={p.instanceId}
                    opponentId={opponent.id}
                    permanent={p}
                    width={rowWidth(columnWidth, row.scale)}
                  />
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const HAND_FAN_MAX = 6;

/**
 * Their hand, drawn the way yours is — overlapping cards in a row — except face
 * down. A fan reads as "a hand" at a glance where a single pile reads as another
 * zone, and the width tracks how many they're actually holding.
 */
function HandFan({ count, width }: { count: number; width: number }) {
  if (count === 0) {
    return (
      <div
        title="Hand · empty"
        className="shrink-0 rounded-[3px] border border-dashed border-border/40 opacity-50"
        style={{ width, aspectRatio: '5 / 7' }}
      />
    );
  }
  const shown = Math.min(count, HAND_FAN_MAX);
  // Each card after the first reveals a sliver, so the fan grows with the hand
  // without running away with the row.
  const step = Math.max(4, Math.round(width * 0.34));
  return (
    <div
      className="shrink-0 flex items-end"
      title={`Hand · ${count} card${count === 1 ? '' : 's'}, hidden as they would be`}
    >
      <div className="relative flex items-end">
        {Array.from({ length: shown }).map((_, i) => (
          <img
            key={i}
            src={`${import.meta.env.BASE_URL}card-back.png`}
            alt=""
            aria-hidden
            draggable={false}
            className="rounded-[2px] border border-border/50 shadow-sm"
            style={{ width, marginLeft: i === 0 ? 0 : -(width - step), zIndex: i }}
          />
        ))}
      </div>
      <span className="ml-0.5 text-[9px] font-bold tabular-nums text-muted-foreground/80">{count}</span>
    </div>
  );
}

/**
 * One of a bot's zones, drawn as a pile. Hand and library show a card back —
 * their contents are hidden, and a back with a count says that better than the
 * word "hand" and a number. Graveyard and exile show their top card, so you can
 * see what just died without opening anything.
 */
function ZonePile({
  label, count, width, hint, top, onClick, warn, Icon, tint,
}: {
  label: string;
  count: number;
  width: number;
  hint: string;
  top?: ScryfallCard;
  onClick?: () => void;
  warn?: boolean;
  Icon: LucideIcon;
  /** Border and background tint, matching our own pile for the same zone. */
  tint: string;
}) {
  const empty = count === 0;
  const Tag = onClick && !empty ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick && !empty ? onClick : undefined}
      title={`${label} · ${count}${hint ? ` · ${hint}` : ''}`}
      className={`relative shrink-0 rounded-[3px] border overflow-hidden ${tint} ${
        empty ? 'opacity-60' : ''
      } ${onClick && !empty ? 'cursor-pointer hover:brightness-125' : ''}`}
      style={{ width, aspectRatio: '5 / 7' }}
    >
      {top ? (
        <img
          src={getCardImageUrl(top, 'small')}
          alt={label}
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />
      ) : !empty ? (
        <img
          src={`${import.meta.env.BASE_URL}card-back.png`}
          alt={label}
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />
      ) : null}
      {/* The symbol rides on top even when there's a card, so the zones stay
          tellable apart at this size — four card backs in a row otherwise look
          identical. */}
      <Icon
        className="absolute top-0 left-0 w-2.5 h-2.5 m-px opacity-90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]"
        aria-hidden
      />
      <span
        className={`absolute inset-x-0 bottom-0 text-[9px] font-bold leading-3 text-center tabular-nums ${
          warn ? 'bg-amber-500/80 text-black' : 'bg-black/70 text-white'
        }`}
      >
        {count}
      </span>
    </Tag>
  );
}

type RowKey = 'creatures' | 'others' | 'lands';

/**
 * Board rows, rendered top to bottom in this order: creatures in front, other
 * permanents in the middle, lands on the bottom — the way a player lays out
 * their own side of the table.
 *
 * Widths are a fraction of the column so cards grow when you widen it, and they
 * step down by row: a pile of basics shouldn't dominate the lane, and the row
 * you actually scan — what can attack me — should read largest.
 */
const ROW_ORDER: { key: RowKey; label: string; scale: number }[] = [
  { key: 'creatures', label: 'Creatures',        scale: 0.20 },
  { key: 'others',    label: 'Other permanents', scale: 0.16 },
  { key: 'lands',     label: 'Lands',            scale: 0.13 },
];

/** Column width → card width for a row, clamped so it stays legible and sane. */
function rowWidth(columnWidth: number, scale: number): number {
  return Math.round(Math.max(20, Math.min(84, columnWidth * scale)));
}

/**
 * Split a board into rows. Creature is checked before land so a creature-land
 * lands in the row you'd scan for attackers rather than hiding among the mana.
 */
function splitRows(battlefield: OpponentPermanent[]): Record<RowKey, OpponentPermanent[]> {
  const out: Record<RowKey, OpponentPermanent[]> = { creatures: [], others: [], lands: [] };
  for (const p of battlefield) {
    const type = getFrontFaceTypeLine(p.card).toLowerCase();
    if (type.includes('creature')) out.creatures.push(p);
    else if (type.includes('land')) out.lands.push(p);
    else out.others.push(p);
  }
  return out;
}

function OpponentPermanentCard({
  opponentId, permanent, width,
}: {
  opponentId: string;
  permanent: OpponentPermanent;
  width: number;
}) {
  const togglePermanentTap = useOpponentStore(s => s.togglePermanentTap);
  const permanentToZone = useOpponentStore(s => s.permanentToZone);
  const [hovered, setHovered] = useState(false);
  const [menu, setMenu] = useState<OpponentMenuTarget | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const ctrlHeld = useMagnifyKey();
  const previewMode = usePlaytestSettings(s => s.opponentPreview);
  const animations = usePlaytestSettings(s => s.animations);
  const showPreview =
    previewMode === 'off'   ? false
  : previewMode === 'hover' ? hovered
  :                           ctrlHeld && hovered;
  const counters = Object.entries(permanent.counters).filter(([, v]) => v > 0);

  // Theft: drag this down onto your battlefield to take it.
  const drag = useDraggable({
    id: `opp:${opponentId}:${permanent.instanceId}`,
    data: {
      opponentSource: { opponentId, instanceId: permanent.instanceId },
      card: permanent.card,
    },
  });
  const dragMoved = useRef(false);
  useEffect(() => {
    if (drag.isDragging) dragMoved.current = true;
    else {
      const id = setTimeout(() => { dragMoved.current = false; }, 50);
      return () => clearTimeout(id);
    }
  }, [drag.isDragging]);

  return (
    <div
      ref={boxRef}
      // Keyed by instanceId upstream, so this runs once when the card arrives —
      // it drops onto their board rather than blinking into existence.
      className={`relative shrink-0 ${drag.isDragging ? 'opacity-30' : ''} ${
        animations ? 'animate-deal-in-from-top' : ''
      }`}
      style={{ width }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ opponentId, permanent, x: e.clientX, y: e.clientY });
      }}
    >
      <img
        ref={drag.setNodeRef as unknown as React.Ref<HTMLImageElement>}
        {...drag.attributes}
        {...drag.listeners}
        src={getCardImageUrl(permanent.card, 'small')}
        alt={permanent.card.name}
        title={`${permanent.card.name}${permanent.tapped ? ' (tapped)' : ''} · click to tap · right-click for options · hold Ctrl to magnify · drag onto your battlefield to steal`}
        onClick={() => { if (!dragMoved.current) togglePermanentTap(opponentId, permanent.instanceId); }}
        draggable={false}
        className={`w-full rounded-[3px] shadow cursor-grab touch-none transition-transform duration-200 ${
          permanent.tapped ? 'rotate-90' : ''
        } ${permanent.summoningSick ? 'ring-1 ring-amber-300/50' : ''}`}
      />

      {counters.length > 0 && (
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap justify-center gap-0.5 pointer-events-none">
          {counters.map(([type, n]) => (
            <span
              key={type}
              className={`px-1 rounded-full text-[9px] font-bold leading-4 tabular-nums shadow ring-1 ring-white/30 ${
                type === '+1/+1' ? 'bg-emerald-500/90 text-white'
                : type === '-1/-1' ? 'bg-red-500/90 text-white'
                : 'bg-zinc-600/90 text-white'
              }`}
            >
              {type === '+1/+1' ? `+${n}` : type === '-1/-1' ? `−${n}` : n}
            </span>
          ))}
        </div>
      )}

      {hovered && (
        <button
          onClick={() => permanentToZone(opponentId, permanent.instanceId, 'graveyard')}
          title={`Destroy ${permanent.card.name}`}
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-600 text-white flex items-center justify-center shadow ring-1 ring-black/40"
        >
          <Skull className="w-2.5 h-2.5" />
        </button>
      )}

      {showPreview && !drag.isDragging && (
        <MagnifiedPreview card={permanent.card} anchorRef={boxRef} />
      )}
      <OpponentCardMenu target={menu} onClose={() => setMenu(null)} />
    </div>
  );
}
