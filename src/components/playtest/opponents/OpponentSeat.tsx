import { useEffect, useMemo, useRef, useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import {
  BookOpen, Crown, GripHorizontal, Heart, Skull, Sparkles, Swords, Trash2, X, type LucideIcon,
} from 'lucide-react';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { useOpponentStore } from '@/store/opponentStore';
import { getCardImageUrl, getFrontFaceTypeLine } from '@/services/scryfall/client';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { useMagnifyKey } from '@/hooks/useMagnifyKey';
import { OpponentCardMenu, type OpponentMenuTarget } from '@/components/playtest/opponents/OpponentCardMenu';
import { CombatStrip } from '@/components/playtest/opponents/CombatStrip';
import type { Opponent, OpponentPermanent } from '@/components/playtest/opponentTypes';
import type { ScryfallCard } from '@/types';

/**
 * One opponent, seated across the table. Everything they own is always on
 * screen — creatures, other permanents, lands, hand and zones. A bot playing a
 * land or a mana rock is still a bot doing something, and a collapsed seat
 * that hid it made their turns read as nothing happening.
 *
 * The cost is vertical space, so the layout is dense rather than partial:
 * lands share their row with the hand fan and the zone piles, and card sizes
 * step down by row so the creature row — the one you actually scan — stays
 * the biggest thing here.
 *
 * The seat is an overlay, never a reflow: battlefield cards are stored at
 * absolute x/y and the canvas is overflow-hidden, so a canvas that shortened
 * to make room would clip the cards near the top and silently invalidate the
 * coordinates the player built their board around.
 */
export function OpponentSeat({
  opponent, width, onGrab, onResetPosition, placed = false,
  onResizeGrab, onResetSize, sized = false,
}: {
  opponent: Opponent;
  width: number;
  /** Pointer-down on the seat's name — starts a move. */
  onGrab?: (e: React.PointerEvent<HTMLElement>) => void;
  /** Double-click the name — back to the auto row. */
  onResetPosition?: () => void;
  /** True once this seat has been dragged off the row. */
  placed?: boolean;
  /** Pointer-down on the corner grip — starts a resize. */
  onResizeGrab?: (e: React.PointerEvent<HTMLElement>) => void;
  /** Double-click the grip — back to the auto width. */
  onResetSize?: () => void;
  /** True once this seat has been resized by hand. */
  sized?: boolean;
}) {
  const adjustLife = useOpponentStore(s => s.adjustLife);
  const remove = useOpponentStore(s => s.remove);
  const setResistance = useOpponentStore(s => s.setResistance);
  const openModal = usePlaytestStore(s => s.openModal);
  const running = useOpponentStore(s => s.running);
  const combat = useOpponentStore(s => s.combat);
  const playerCombat = useOpponentStore(s => s.playerCombat);

  const inCombat = combat?.opponentId === opponent.id || !!playerCombat?.perOpponent[opponent.id];

  // Donating a permanent still targets the seat's BOARD. Attacking targets the
  // strip. Two regions, so the gestures never collide.
  const { setNodeRef, isOver } = useDroppable({
    id: `opponent:${opponent.id}`,
    data: { kind: 'opponentLane', opponentId: opponent.id },
  });

  const rows = useMemo(() => splitRows(opponent.battlefield), [opponent.battlefield]);

  /**
   * Combat is the one moment the rest of the board stops mattering. While this
   * seat is fighting, its rows and zones shrink so the strip can show the
   * creatures actually in the fight at a size you can read. Nothing is hidden
   * — everything they own is still on screen, just smaller for a beat.
   */
  const scale = inCombat ? COMBAT_SHRINK : 1;
  const zoneWidth = Math.round(Math.max(14, Math.min(38, width * 0.10 * scale)));

  return (
    <div
      data-seat
      data-float-id={`opp-lane-${opponent.id}`}
      className={`relative rounded-lg border bg-background/80 backdrop-blur-sm p-1.5 transition-colors ${
        placed ? 'shadow-2xl ring-1 ring-black/30' : 'shadow-lg'
      } ${
        isOver ? 'border-violet-400/70 bg-violet-500/10'
        : inCombat ? 'border-violet-400/70'
        : running ? 'border-violet-400/40'
        : 'border-border/50'
      } ${
        // Out of the game, but still on the table: dimmed rather than removed,
        // so you can see the board that beat them and still take their stuff.
        opponent.life <= 0 ? 'opacity-50 saturate-50' : ''
      }`}
      style={{ width }}
    >
      <SeatHeader
        opponent={opponent}
        onAdjustLife={adjustLife}
        onSetResistance={setResistance}
        onRemove={remove}
        onGrab={onGrab}
        onResetPosition={onResetPosition}
        placed={placed}
      />

      {/* Creatures and other permanents. Both always shown — a bot casting a
          Signet is a bot doing something, and hiding it made their turns read
          as nothing happening. */}
      <div ref={setNodeRef} className="mt-1 space-y-1">
        {opponent.battlefield.length === 0 ? (
          // A drop target you can see, rather than a sentence explaining one.
          <div
            className={`h-[38px] rounded-md border border-dashed transition-colors ${
              isOver ? 'border-violet-400/70 bg-violet-500/10' : 'border-border/50'
            }`}
            aria-label="Drop a permanent here to give it to this opponent"
          />
        ) : (
          UPPER_ROWS.map(row => {
            const cards = rows[row.key];
            if (cards.length === 0) return null;
            return (
              <div key={row.key} className="flex items-end gap-1 flex-wrap" title={row.label}>
                {cards.map(p => (
                  <OpponentPermanentCard
                    key={p.instanceId}
                    opponentId={opponent.id}
                    permanent={p}
                    width={rowWidth(width, row.scale * scale)}
                  />
                ))}
              </div>
            );
          })
        )}
      </div>

      {/* Bottom row: lands on the left, then hand and the zone piles grouped
          right. Sharing one row keeps the seat short enough to live over the
          canvas while still showing every land they've played. Mirrors your
          own hand row, with Exile half-width and hanging from the top. */}
      <div className="mt-1 flex items-end gap-1">
        <div className="flex items-end gap-1 flex-wrap min-w-0" title="Lands">
          {rows.lands.map(p => (
            <OpponentPermanentCard
              key={p.instanceId}
              opponentId={opponent.id}
              permanent={p}
              width={rowWidth(width, LAND_SCALE * scale)}
            />
          ))}
        </div>
        <div className="ml-auto flex items-end gap-1 shrink-0">
          {/* Their commander, face up. Who you are playing against is the single
              most useful fact about a seat, and it was the one zone the seat
              never showed. Face up because it is public information. */}
          <ZonePile
            label="Command" count={opponent.command.length} width={zoneWidth}
            top={opponent.command[opponent.command.length - 1]}
            hint={opponent.command.length > 0 ? 'Their commander' : 'Commander is on the battlefield'}
            Icon={Crown} tint="bg-purple-500/10 border-purple-400/30"
          />
          <HandFan count={opponent.hand.length} width={zoneWidth} />
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

      <CombatStrip opponentId={opponent.id} />

      {/* Resize handle on the right edge. Width is the only lever a seat needs
          — height follows the board, and every card inside is sized as a
          fraction of the width, so dragging this scales the whole table rather
          than just stretching it.

          Deliberately the edge and not a bottom-right corner grip: the combat
          strip puts its Resolve button in that corner, and a grip there would
          swallow the click that ends combat. */}
      <div
        onPointerDown={onResizeGrab}
        onDoubleClick={sized ? onResetSize : undefined}
        title={
          sized
            ? `Drag to resize ${opponent.name}'s table · double-click for the automatic width`
            : `Drag to resize ${opponent.name}'s table`
        }
        className="absolute top-0 right-0 h-full w-1.5 translate-x-1/2 cursor-col-resize touch-none hover:bg-violet-400/50 active:bg-violet-400/70 transition-colors"
      />
    </div>
  );
}

/**
 * Who they are, their life, whether they fight back, and the way out — all on
 * one row. The data-float-id on the life pill is load-bearing: floatDelta
 * targets it by that exact id.
 */
function SeatHeader({
  opponent, onAdjustLife, onSetResistance, onRemove, onGrab, onResetPosition, placed,
}: {
  opponent: Opponent;
  onAdjustLife: (id: string, delta: number) => void;
  onSetResistance: (id: string, resistance: boolean) => void;
  onRemove: (id: string) => void;
  onGrab?: (e: React.PointerEvent<HTMLElement>) => void;
  onResetPosition?: () => void;
  placed?: boolean;
}) {
  const tiny = 'px-1 rounded bg-accent/40 hover:bg-accent text-[10px] font-medium leading-4';
  return (
    <div className="flex items-center gap-1">
      {/* The name doubles as the seat's move handle. Everything else in this
          row is a button, so the drag can't steal a click that mattered.

          The grip says so out loud — the same GripHorizontal a FloatingDialog
          puts in its title bar, because it means the same thing here. */}
      <span
        onPointerDown={onGrab}
        onDoubleClick={placed ? onResetPosition : undefined}
        className="group/grip flex items-center gap-1 flex-1 min-w-0 cursor-grab active:cursor-grabbing select-none touch-none"
        title={
          placed
            ? `${opponent.name} · drag to move · double-click to send it back to the top`
            : `${opponent.name} · drag to move this seat anywhere on the table`
        }
      >
        <GripHorizontal
          aria-hidden
          className="w-3 h-3 shrink-0 opacity-50 group-hover/grip:opacity-100 transition-opacity"
        />
        <span className="text-[11px] font-semibold truncate">{opponent.name}</span>
      </span>

      <button onClick={() => onAdjustLife(opponent.id, -1)} className={tiny} title="−1 life">−</button>
      <span
        data-float-id={`opp-life-${opponent.id}`}
        className={`inline-flex items-center gap-0.5 px-1 rounded border font-bold text-[11px] leading-4 tabular-nums ${
          opponent.life <= 0
            ? 'bg-muted/40 border-border/60 text-muted-foreground line-through'
            : 'bg-rose-500/15 border-rose-400/40 text-rose-300'
        }`}
        title={opponent.life <= 0 ? `${opponent.name} is defeated` : `${opponent.name}'s life`}
      >
        <Heart className="w-2.5 h-2.5 fill-rose-400/40" />
        {opponent.life}
      </span>
      <button onClick={() => onAdjustLife(opponent.id, 1)} className={tiny} title="+1 life">+</button>

      {/* Icon-only: the colour already carries the state. */}
      <button
        onClick={() => onSetResistance(opponent.id, !opponent.resistance)}
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
        onClick={() => onRemove(opponent.id)}
        className="shrink-0 text-muted-foreground/70 hover:text-red-400 transition-colors"
        title={`Remove ${opponent.name}`}
      >
        <X className="w-3 h-3" />
      </button>
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
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const ctrlHeld = useMagnifyKey();
  const previewMode = usePlaytestSettings(s => s.opponentPreview);
  // A pile is ~38px wide; the face-up ones are unreadable at that size. Same
  // magnify rules as a card on their board, so Ctrl-hover works everywhere.
  const showPreview = !!top && (
    previewMode === 'off'   ? false
  : previewMode === 'hover' ? hovered
  :                           ctrlHeld && hovered
  );
  return (
    <div
      ref={boxRef}
      className="relative shrink-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
    <Tag
      onClick={onClick && !empty ? onClick : undefined}
      title={`${label} · ${count}${hint ? ` · ${hint}` : ''}`}
      className={`relative block shrink-0 rounded-[3px] border overflow-hidden ${tint} ${
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
    {showPreview && top && <MagnifiedPreview card={top} anchorRef={boxRef} />}
    </div>
  );
}

type RowKey = 'creatures' | 'others' | 'lands';

/**
 * The two rows that get their own line: creatures in front, other permanents
 * behind them — the way a player lays out their own side of the table. Lands
 * are the third row but share their line with the hand and zones, so they're
 * kept separate below.
 *
 * Widths are a fraction of the seat so cards grow with it, and they step down
 * by row: a pile of basics shouldn't dominate the seat, and the row you
 * actually scan — what can attack me — should read largest.
 */
const UPPER_ROWS: { key: Exclude<RowKey, 'lands'>; label: string; scale: number }[] = [
  { key: 'creatures', label: 'Creatures',        scale: 0.19 },
  { key: 'others',    label: 'Other permanents', scale: 0.14 },
];

/** Lands are smallest — they share a row with the hand fan and the zone piles. */
const LAND_SCALE = 0.10;

/**
 * How far the board shrinks while this seat is in combat. The strip's cards
 * roughly double at the same moment, so the seat as a whole stays about the
 * same height while the attention moves to the fight.
 */
const COMBAT_SHRINK = 0.6;

/** Seat width → card width for a row, clamped so it stays legible and sane. */
function rowWidth(seatWidth: number, scale: number): number {
  return Math.round(Math.max(14, Math.min(84, seatWidth * scale)));
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
      data-float-id={permanent.instanceId}
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
