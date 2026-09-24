import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import {
  BookOpen, Crown, Gavel, GripHorizontal, Heart, Skull, Sparkles, Swords, Trash2, X, type LucideIcon,
} from 'lucide-react';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { useOpponentStore } from '@/store/opponentStore';
import { getCardImageUrl, getFrontFaceTypeLine } from '@/services/scryfall/client';
import { botPower, botToughness } from '@/services/playtest/opponents/stats';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { useMagnifyHover } from '@/components/playtest/hooks/useMagnifyHover';
import { boxOf, captureBox, useCardFlights } from '@/components/playtest/CardFlight';
import { OpponentCardMenu, type OpponentMenuTarget } from '@/components/playtest/opponents/OpponentCardMenu';
import { OpponentZoneMenu, type OpponentZoneMenuTarget, type OpponentMenuZone } from '@/components/playtest/opponents/OpponentZoneMenu';
import { OpponentChoiceMenu, type OpponentChoiceMenuTarget } from '@/components/playtest/opponents/OpponentChoiceMenu';
import { backgroundUrlForIdentity } from '@/services/spellchroma/colorBackground';
import { CombatStrip } from '@/components/playtest/opponents/CombatStrip';
import { BOT_COMBOS } from '@/services/playtest/opponents/botCombos';
import type { CastZone, Opponent, OpponentPermanent } from '@/components/playtest/opponentTypes';
import type { ResizeAxis, SeatSize } from '@/components/playtest/opponents/OpponentSeats';
import { CARD_ASPECT } from '@/components/playtest/types';
import type { ScryfallCard } from '@/types';

/**
 * One opponent, seated across the table. Everything they own is always on
 * screen — creatures, other permanents, lands, hand and zones. A bot playing a
 * land or a mana rock is still a bot doing something, and a collapsed seat
 * that hid it made their turns read as nothing happening.
 *
 * The cost is vertical space, so the layout is dense rather than partial:
 * lands get a line of their own that never wraps — they shrink to fit it
 * instead — and card sizes step down by row so the creature row, the one you
 * actually scan, stays the biggest thing here.
 *
 * The seat is an overlay, never a reflow: battlefield cards are stored at
 * absolute x/y and the canvas is overflow-hidden, so a canvas that shortened
 * to make room would clip the cards near the top and silently invalidate the
 * coordinates the player built their board around.
 */
export function OpponentSeat({
  opponent, width, onGrab, onResetPosition, placed = false,
  onResizeGrab, onResetSize, sized = {}, height,
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
  onResizeGrab?: (axis: ResizeAxis, e: React.PointerEvent<HTMLElement>) => void;
  /** Double-click the grip — back to the auto width. */
  onResetSize?: (axis: ResizeAxis) => void;
  /** Which axes have been set by hand, so each handle knows if it can reset. */
  sized?: SeatSize;
  /**
   * An explicit height, once one has been dragged. Unset means the seat is
   * as tall as its contents, which is the default.
   */
  height?: number;
}) {
  const adjustLife = useOpponentStore(s => s.adjustLife);
  const setLife = useOpponentStore(s => s.setLife);
  const remove = useOpponentStore(s => s.remove);
  const setResistance = useOpponentStore(s => s.setResistance);
  const setAggression = useOpponentStore(s => s.setAggression);
  const openModal = usePlaytestStore(s => s.openModal);

  /**
   * Which of this seat's zones has its menu open. One per seat rather than one
   * per pile: only one can be open at a time, and the piles are siblings.
   */
  const [zoneMenu, setZoneMenu] = useState<OpponentZoneMenuTarget | null>(null);

  /** Open while you are handing this seat a decision to make. */
  const [choiceMenu, setChoiceMenu] = useState<OpponentChoiceMenuTarget | null>(null);
  const openZoneMenu = (zone: OpponentMenuZone) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setZoneMenu({ opponentId: opponent.id, zone, x: e.clientX, y: e.clientY });
  };
  const animations = usePlaytestSettings(s => s.animations);
  const acting = useOpponentStore(s => s.actingId === opponent.id);
  // The beat just played, for the card-out-of-hand flight. Only this seat's.
  const beat = useOpponentStore(s => (s.lastBeat?.opponentId === opponent.id ? s.lastBeat : null));
  const playedIds = beat?.played ?? [];
  const combat = useOpponentStore(s => s.combat);
  const playerCombat = useOpponentStore(s => s.playerCombat);

  const inCombat = combat?.opponentId === opponent.id || !!playerCombat?.perOpponent[opponent.id];
  /**
   * THIS seat is the one swinging at you. Distinct from `inCombat`, which is
   * also true while you are attacking them — being attacked is the only one of
   * the two that is a question you have to answer, and with three seats on the
   * table the answer has to be findable without reading all three.
   */
  const attackingYou = combat?.opponentId === opponent.id;

  // Donating a permanent still targets the seat's BOARD. Attacking targets the
  // strip. Two regions, so the gestures never collide.
  const { setNodeRef, isOver } = useDroppable({
    id: `opponent:${opponent.id}`,
    data: { kind: 'opponentLane', opponentId: opponent.id },
  });

  const rows = useMemo(() => splitRows(opponent.battlefield), [opponent.battlefield]);

  /** Names of the permanents that are part of an armed combo — the ones worth killing right now. */
  const armedPieces = useMemo(() => new Set(
    BOT_COMBOS.filter(c => (opponent.armedCombos ?? []).includes(c.id)).flatMap(c => c.onBattlefield),
  ), [opponent.armedCombos]);
  const seatArt = useMemo(() => backgroundUrlForIdentity(opponent.colors), [opponent.colors]);

  /**
   * Combat is the one moment the rest of the board stops mattering — when
   * THEY are attacking YOU. Their attackers are in the strip, so the rows can
   * shrink to make room. Not the other way round: when you attack them, the
   * creatures in the rows ARE the blockers you are trying to read, and
   * shrinking them at that moment was the worst possible timing.
   */
  const scale = attackingYou ? COMBAT_SHRINK : 1;
  const zoneWidth = Math.round(Math.max(14, width * ZONE_WIDTH_FRACTION * scale));

  const landPiles = useMemo(() => pileUp(rows.lands), [rows.lands]);
  const landWidth = landWidthFor(width, landPiles, scale);

  return (
    <div
      data-seat
      data-float-id={`opp-lane-${opponent.id}`}
      className={`relative flex flex-col rounded-lg border bg-background/80 backdrop-blur-sm p-1.5 transition-colors ${
        placed ? 'shadow-2xl ring-1 ring-black/30' : 'shadow-lg'
      } ${
        isOver ? 'border-violet-400/70 bg-violet-500/10'
        : attackingYou ? 'border-rose-400/80'
        : inCombat ? 'border-violet-400/70'
        // Its turn: the border lifts towards white. Below the two combat
        // colours on purpose — a seat swinging at you is a question you have
        // to answer, and it keeps its rose while it acts.
        //
        // This replaces a faint violet that was keyed on `running`, i.e. on
        // "some bot is taking a turn", which lit all three seats at once and
        // so told you nothing about where to look.
        : acting ? 'border-white/70'
        : 'border-border/50'
      } ${
        // Out of the game, but still on the table: dimmed rather than removed,
        // so you can see the board that beat them and still take their stuff.
        opponent.life <= 0 ? 'opacity-50 saturate-50' : ''
      }`}
      style={{ width, height }}
    >
      {/* Their colours, as SpellChroma's art for that identity, sunk almost
          all the way out. Enough to tell three seats apart at a glance and to
          give each one a mood, not enough to compete with the cards on it.

          A layer rather than a background-image on the seat itself: the art
          files are opaque, so painting them into the seat's own background
          would cover bg-background/80 and cost the panel its translucency
          over the table. As a separate layer it can carry its own opacity
          and leave the glass underneath alone. */}
      <div
        aria-hidden
        className="absolute inset-0 z-0 rounded-lg overflow-hidden pointer-events-none"
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url("${seatArt}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: SEAT_ART_OPACITY,
          }}
        />
      </div>

      {/* The threat ring. A breathing rose halo around the whole seat, so with
          three bots up there the one asking you a question is the one that
          moves. A layer of its own rather than a `ring-` class on the seat:
          the seat already carries `ring-1 ring-black/30` when it has been
          dragged loose, and two ring utilities on one element is a coin toss
          over which wins. Transparent inside and pointer-events-none, so it
          neither tints the cards under it nor swallows a click. */}
      {attackingYou && (
        <div
          aria-hidden
          className={`absolute -inset-0.5 z-30 rounded-lg pointer-events-none border-2 border-rose-400/80 ${
            animations ? 'animate-threat-ring' : ''
          }`}
        />
      )}

      <SeatHeader
        opponent={opponent}
        onAdjustLife={adjustLife}
        onSetLife={setLife}
        onSetResistance={setResistance}
        onSetAggression={setAggression}
        onRemove={remove}
        onOpenChoices={e => setChoiceMenu({
          opponentId: opponent.id,
          x: e.currentTarget.getBoundingClientRect().left,
          y: e.currentTarget.getBoundingClientRect().bottom + 4,
        })}
        onGrab={onGrab}
        onResetPosition={onResetPosition}
        placed={placed}
      />

      <ArmedComboBanner ids={opponent.armedCombos ?? []} />

      {/* Creatures and other permanents. Both always shown — a bot casting a
          Signet is a bot doing something, and hiding it made their turns read
          as nothing happening.

          With an explicit height the board takes whatever is left over and
          scrolls inside it. Without one the seat is as tall as its board wants
          to be, so a developed board reads at a glance instead of hiding its
          back rows behind a scrollbar.

          The vh ceiling is a backstop for a pathological board — a goblin deck
          can hold sixty-eight permanents — not a working limit. It used to be
          38vh, which ordinary boards hit routinely. Three things make the room
          affordable: identical cards pile into one counted card, BOARD_ZOOM
          draws the wrapping rows smaller, and `setSeatBandHeight` walks any of
          the player's own cards that the grown band covers down to a free slot
          — so growing downwards no longer buries their battlefield.

          Either way the header, lands, zones and combat strip stay pinned —
          shortening a seat should cost you the least useful rows, not the life
          total or the fight. */}
      {/* Padded, then pulled back out by the same amount on every side.

          This element has to clip — it is the cap that stops a 64-permanent
          board growing down over your own battlefield — but three things are
          drawn deliberately OUTSIDE their card's box: the ×N pile badge at the
          top left, the destroy skull at the top right, and the edited/pumped
          P/T at the bottom right. All three hang 4px past the corner, so on the
          first row, the last card of a row, and the last row they were being
          sliced in half.

          Clipping happens at the padding box, so the fix is room INSIDE it: 6px
          of padding gives the overhang somewhere to live. The matching negative
          margins put the cards themselves back exactly where they were, which
          matters because the land row below has no padding and the two rows
          have to start on the same left edge. */}
      <div
        ref={setNodeRef}
        className={`relative z-10 -mt-0.5 -mx-1.5 -mb-1.5 p-1.5 space-y-1 overflow-y-auto overflow-x-hidden ${
          height ? 'flex-1 min-h-0' : 'max-h-[70vh]'
        }`}
      >
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
              // aria-label, not title: this element wraps the cards, and a
              // title on it pops a tooltip over whichever card you are
              // pointing at.
              <div key={row.key} className="flex items-end gap-1 flex-wrap" aria-label={row.label}>
                {pileUp(cards).map(pile => (
                  <OpponentPermanentCard
                    key={pile.key}
                    opponentId={opponent.id}
                    permanent={pile.top}
                    count={pile.count}
                    comboPiece={armedPieces.has(pile.top.card.name)}
                    width={rowWidth(width, row.scale * scale)}
                    castFrom={pile.ids.some(id => playedIds.includes(id)) ? (beat?.from ?? 'hand') : null}
                    beatTick={beat?.tick ?? 0}
                  />
                ))}
              </div>
            );
          })
        )}
      </div>

      {/* Lands, on a line of their own that never wraps.
          They used to share the bottom row with the hand fan and the zone
          piles, which left them a sliver of the seat to wrap inside: tap four
          of them and each one — turned ninety degrees, so wider than it is
          tall — took a line to itself and the mana was taller than the board
          it paid for. Given the full width and shrunk to fit it, a land row
          costs one line however many lands are on it. */}
      {landPiles.length > 0 && (
        <div
          // No overflow rule on purpose: an `overflow-x` scroller would clip
          // the y axis too, and the ×N pile badge and the destroy button both
          // hang a few pixels off the top of their card.
          className="relative z-10 mt-1 flex items-end gap-1 shrink-0"
          aria-label="Lands"
        >
          {landPiles.map(pile => (
            <OpponentPermanentCard
              key={pile.key}
              opponentId={opponent.id}
              permanent={pile.top}
              count={pile.count}
              comboPiece={armedPieces.has(pile.top.card.name)}
              width={landWidth}
              castFrom={pile.ids.some(id => playedIds.includes(id)) ? (beat?.from ?? 'hand') : null}
              beatTick={beat?.tick ?? 0}
            />
          ))}
        </div>
      )}

      {/* Bottom row: the commander at the left, everything else grouped right.
          Mirrors your own hand row, with Exile half-width and hanging from the
          top.

          The commander is split off from the other piles on purpose. The rest of
          the row is this seat's changing state — what it is holding, what it has
          left, what has died — and the commander is the one thing about a seat
          that does not change. Sitting apart it reads as a name plate rather
          than as a fourth pile to count, and the row's empty left end was doing
          nothing else. */}
      <div className="relative z-10 mt-1 flex items-end gap-1 shrink-0">
        {/* Their commander, face up. Who you are playing against is the single
            most useful fact about a seat, and it was the one zone the seat
            never showed. Face up because it is public information. */}
        <ZonePile
          label="Command" count={opponent.command.length} width={zoneWidth}
          anchorId={`command:${opponent.id}`}
          top={opponent.command[opponent.command.length - 1]}
          hint={opponent.command.length > 0 ? 'Their commander' : 'Commander is on the battlefield'}
          Icon={Crown} tint="bg-purple-500/10 border-purple-400/30"
        />
        <div className="ml-auto flex items-end gap-1 shrink-0">
          <HandFan
            opponentId={opponent.id} count={opponent.hand.length} width={zoneWidth}
            onContextMenu={openZoneMenu('hand')}
          />
          <ZonePile
            label="Library" count={opponent.library.length} width={zoneWidth}
            anchorId={`library:${opponent.id}`}
            hint={opponent.decked ? 'Library is empty' : 'Right-click to mill or shuffle'}
            onContextMenu={openZoneMenu('library')}
            warn={opponent.decked}
            Icon={BookOpen} tint="bg-blue-500/10 border-blue-400/30"
          />
          <ZonePile
            label="Graveyard" count={opponent.graveyard.length} width={zoneWidth}
            anchorId={`graveyard:${opponent.id}`}
            top={opponent.graveyard[opponent.graveyard.length - 1]}
            hint="Click to view · right-click for more"
            onClick={() => openModal({ kind: 'opponentZone', opponentId: opponent.id, zone: 'graveyard' })}
            onContextMenu={openZoneMenu('graveyard')}
            Icon={Trash2} tint="bg-zinc-500/15 border-zinc-400/30"
          />
          <div className="self-start">
            <ZonePile
              label="Exile" count={opponent.exile.length}
              width={Math.max(14, Math.round(zoneWidth * 0.5))}
              top={opponent.exile[opponent.exile.length - 1]}
              hint="Click to view their exile"
              onClick={() => openModal({ kind: 'opponentZone', opponentId: opponent.id, zone: 'exile' })}
              onContextMenu={openZoneMenu('exile')}
              Icon={Sparkles} tint="bg-amber-500/10 border-amber-400/30"
            />
          </div>
        </div>
      </div>

      {/* shrink-0 because the fight is the one row that must not be squashed:
          the board above it takes flex-1 and scrolls instead. */}
      <div className="relative z-10 shrink-0">
        <CombatStrip opponentId={opponent.id} seatWidth={width} seatHeight={height} />
      </div>

      <OpponentZoneMenu target={zoneMenu} onClose={() => setZoneMenu(null)} />
      <OpponentChoiceMenu target={choiceMenu} onClose={() => setChoiceMenu(null)} />

      {/* Three handles, because the axes do different jobs. Width is the zoom
          — every card in the seat is a fraction of it. Height decides how much
          table this seat may occupy before its board starts scrolling. The
          corner does both at once.

          All of them hang half outside the border on purpose: the combat strip
          puts its Resolve button in the bottom-right, and a handle sitting
          inside the seat would swallow the click that ends combat. */}
      <div
        onPointerDown={e => onResizeGrab?.('x', e)}
        onDoubleClick={sized.w !== undefined ? () => onResetSize?.('x') : undefined}
        title={`Drag to set ${opponent.name}'s width${sized.w !== undefined ? ' · double-click for automatic' : ''}`}
        className="absolute top-0 right-0 z-20 h-full w-1.5 translate-x-1/2 cursor-col-resize touch-none hover:bg-violet-400/50 active:bg-violet-400/70 transition-colors"
      />
      <div
        onPointerDown={e => onResizeGrab?.('y', e)}
        onDoubleClick={sized.h !== undefined ? () => onResetSize?.('y') : undefined}
        title={`Drag to set ${opponent.name}'s height${sized.h !== undefined ? ' · double-click for automatic' : ''}`}
        className="absolute bottom-0 left-0 z-20 w-full h-1.5 translate-y-1/2 cursor-row-resize touch-none hover:bg-violet-400/50 active:bg-violet-400/70 transition-colors"
      />
      <div
        onPointerDown={e => onResizeGrab?.('both', e)}
        onDoubleClick={
          sized.w !== undefined || sized.h !== undefined ? () => onResetSize?.('both') : undefined
        }
        title={`Drag to resize ${opponent.name}'s table · double-click for automatic`}
        className="absolute -bottom-2 -right-2 z-20 w-4 h-4 cursor-nwse-resize touch-none text-muted-foreground/60 hover:text-violet-300 transition-colors"
      >
        <svg viewBox="0 0 12 12" aria-hidden className="w-full h-full">
          <path d="M11 4v7H4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M11 8.5v2.5H8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

/**
 * Their life, worked the same way yours is: − / + step by one, right-clicking
 * either one steps by five, and clicking the number itself types a total in.
 *
 * A seat header has no room for the player toolbar's five-button cluster, so
 * the bigger step hides behind the right-click that the board already uses for
 * "same button, other direction" on loyalty and counters.
 *
 * The data-float-id lives on the wrapper rather than the pill because the pill
 * is swapped out for an input while you're typing, and floatDelta looks its
 * target up at the moment the damage lands.
 */
function SeatLife({
  opponent, onAdjustLife, onSetLife, tiny,
}: {
  opponent: Opponent;
  onAdjustLife: (id: string, delta: number) => void;
  onSetLife: (id: string, life: number) => void;
  tiny: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(opponent.life));

  // Right-click reaches here as a contextmenu event on the same handler; both
  // paths have to swallow it, or the seat's own menu opens underneath.
  const step = (sign: 1 | -1) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onAdjustLife(opponent.id, sign * (e.type === 'contextmenu' ? 5 : 1));
  };

  const dead = opponent.life <= 0;

  return (
    <>
      <button
        onClick={step(-1)}
        onContextMenu={step(-1)}
        className={tiny}
        title="−1 life · right-click for −5"
      >
        −
      </button>

      <span
        data-float-id={`opp-life-${opponent.id}`}
        className="inline-flex items-center"
      >
        {editing ? (
          <input
            autoFocus
            type="number"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => {
              setEditing(false);
              const n = parseInt(draft, 10);
              if (!isNaN(n)) onSetLife(opponent.id, n);
            }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            onPointerDown={e => e.stopPropagation()}
            className="w-12 h-7 md:h-4 bg-rose-500/15 border border-rose-400/40 rounded px-1 text-rose-200 font-bold text-center text-[11px] leading-4 tabular-nums outline-none select-text"
          />
        ) : (
          <button
            onClick={() => { setDraft(String(opponent.life)); setEditing(true); }}
            className={`inline-flex items-center gap-0.5 h-7 px-1.5 md:h-auto md:px-1 rounded border font-bold text-[11px] leading-4 tabular-nums transition-colors ${
              dead
                ? 'bg-muted/40 border-border/60 text-muted-foreground line-through'
                : 'bg-rose-500/15 border-rose-400/40 text-rose-300 hover:bg-rose-500/25'
            }`}
            title={
              dead
                ? `${opponent.name} is defeated · click to set their life`
                : `${opponent.name}'s life · click to set it`
            }
          >
            <Heart className="w-2.5 h-2.5 fill-rose-400/40" />
            {opponent.life}
          </button>
        )}
      </span>

      <button
        onClick={step(1)}
        onContextMenu={step(1)}
        className={tiny}
        title="+1 life · right-click for +5"
      >
        +
      </button>
    </>
  );
}

/**
 * Who they are, their life, whether they fight back, and the way out — all on
 * one row.
 */
function SeatHeader({
  opponent, onAdjustLife, onSetLife, onSetResistance, onSetAggression, onRemove, onOpenChoices,
  onGrab, onResetPosition, placed,
}: {
  opponent: Opponent;
  onAdjustLife: (id: string, delta: number) => void;
  onSetLife: (id: string, life: number) => void;
  onSetResistance: (id: string, resistance: boolean) => void;
  onSetAggression: (id: string, aggression: number) => void;
  onRemove: (id: string) => void;
  /** Opens the decision menu, anchored under the button that was clicked. */
  onOpenChoices: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onGrab?: (e: React.PointerEvent<HTMLElement>) => void;
  onResetPosition?: () => void;
  placed?: boolean;
}) {
  // Phones get a 28px tap target on every control in this row; md: pins each
  // one back to the exact box it has on desktop, which is as small as it is
  // because a seat header there is competing with the board underneath it.
  const tiny = 'inline-flex items-center justify-center h-7 min-w-[28px] px-1 rounded bg-accent/40 hover:bg-accent text-[10px] font-medium leading-4 md:h-4 md:min-w-0';
  return (
    <div className="relative z-10 flex flex-wrap md:flex-nowrap items-center gap-1 shrink-0">
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

      <ArmedComboBadge ids={opponent.armedCombos ?? []} />

      <SeatLife
        opponent={opponent}
        onAdjustLife={onAdjustLife}
        onSetLife={onSetLife}
        tiny={tiny}
      />

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
        className={`shrink-0 inline-flex items-center justify-center w-7 h-7 md:w-5 md:h-4 rounded border transition-colors ${
          opponent.resistance
            ? 'border-violet-400/50 bg-violet-500/15 text-violet-200'
            : 'border-border/50 bg-transparent text-muted-foreground/50'
        }`}
      >
        <Swords className="w-3.5 h-3.5 md:w-2.5 md:h-2.5" />
      </button>

      <AggressionDial
        value={opponent.aggression}
        onChange={next => onSetAggression(opponent.id, next)}
      />

      {/* The one control in this row that asks the bot something rather than
          setting what it is. Everything you cast that says "each player
          sacrifices" or "each opponent discards" is resolved from here. */}
      <button
        onClick={onOpenChoices}
        title={`Make ${opponent.name} choose — sacrifice, bounce or discard`}
        aria-label={`Hand ${opponent.name} a decision`}
        className="shrink-0 inline-flex items-center justify-center w-7 h-7 md:w-5 md:h-4 rounded border border-border/50 text-muted-foreground/70 hover:border-violet-400/50 hover:text-violet-200 transition-colors"
      >
        <Gavel className="w-3.5 h-3.5 md:w-2.5 md:h-2.5" />
      </button>

      <button
        onClick={() => onRemove(opponent.id)}
        className="shrink-0 inline-flex items-center justify-center w-7 h-7 md:w-auto md:h-auto text-muted-foreground/70 hover:text-red-400 transition-colors"
        title={`Remove ${opponent.name}`}
      >
        <X className="w-4 h-4 md:w-3 md:h-3" />
      </button>
    </div>
  );
}

/**
 * A live combo, said out loud on the seat.
 *
 * The whole reason a bot arms a combo one turn before firing it is so you get a
 * window to break it up — and a window you cannot see is not a window. This is
 * the loudest thing on the seat by design: it means you lose next turn unless
 * you do something about it, and it names the pieces so you know what to kill.
 */
function ArmedComboBadge({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  const combos = BOT_COMBOS.filter(c => ids.includes(c.id));
  if (combos.length === 0) return null;
  return (
    <span
      className="shrink-0 inline-flex items-center gap-0.5 px-1 rounded border border-rose-400/70 bg-rose-500/25 text-rose-100 text-[9px] font-bold uppercase tracking-wide animate-pulse"
      title={combos
        .map(c => `${c.name} — ${c.how} Fires on their next turn unless you break it up.`)
        .join(' / ')}
    >
      Combo
    </span>
  );
}

/**
 * The line, spelled out. The header chip only has room to shout; this says
 * WHICH combo and reminds you the answer is to kill a piece — and the pieces
 * themselves are ringed in the rows below (see `comboPiece`).
 */
function ArmedComboBanner({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  const combos = BOT_COMBOS.filter(c => ids.includes(c.id));
  if (combos.length === 0) return null;
  return (
    <div
      className="relative z-10 mt-1 px-1.5 py-0.5 rounded border border-rose-400/60 bg-rose-500/20 text-[10px] leading-tight text-rose-100 truncate"
      title={combos.map(c => c.how).join(' / ')}
    >
      {combos.map(c => c.name).join(' · ')} — goes off next turn. Kill a piece.
    </div>
  );
}

/**
 * The three settings of the aggression dial.
 *
 * It used to be a value nothing in the UI could set, and a switch rather than a
 * dial besides — only the 0.5 boundary changed anything, so 0 and 0.25 played
 * identically. It now feeds trade willingness in both directions of combat and
 * how much of its board a bot keeps home to block, so these all play
 * differently.
 */
const AGGRESSION_STEPS: { value: number; label: string; hint: string }[] = [
  { value: 0.15, label: 'Cautious', hint: 'Keeps blockers home and only takes trades it clearly wins.' },
  { value: 0.50, label: 'Measured', hint: 'Takes an even trade and keeps some defence back.' },
  { value: 0.85, label: 'Reckless', hint: 'Sends nearly everything and trades freely.' },
];

/** Phone height / desktop height for each of the dial's three bars. */
const BAR_HEIGHTS = ['h-[6px] md:h-[3px]', 'h-[12px] md:h-[6px]', 'h-[18px] md:h-[9px]'];

/**
 * Three bars, filled to the current setting. Deliberately not an icon: the
 * ones that would fit are all spoken for elsewhere in the app, and a filling
 * meter says "this is a dial with settings" better than any glyph would.
 */
function AggressionDial({
  value, onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  // Nearest step, so a value set outside this control still lands somewhere.
  let index = 0;
  for (let i = 1; i < AGGRESSION_STEPS.length; i++) {
    if (Math.abs(AGGRESSION_STEPS[i].value - value) < Math.abs(AGGRESSION_STEPS[index].value - value)) {
      index = i;
    }
  }
  const step = AGGRESSION_STEPS[index];
  const next = AGGRESSION_STEPS[(index + 1) % AGGRESSION_STEPS.length];

  return (
    <button
      onClick={() => onChange(next.value)}
      title={`${step.label} — ${step.hint} Click for ${next.label}.`}
      aria-label={`Aggression: ${step.label}`}
      className="shrink-0 inline-flex items-end justify-center gap-px w-7 h-7 px-1 pb-1 md:w-5 md:h-4 md:px-0.5 md:pb-0.5 rounded border border-border/50 hover:border-violet-400/50 transition-colors"
    >
      {AGGRESSION_STEPS.map((s, i) => (
        <span
          key={s.value}
          // Bars double on phones so the dial still reads as a meter inside a
          // tap-sized box; md: puts them back at the desktop 3/6/9.
          className={`w-1 rounded-sm transition-colors ${BAR_HEIGHTS[i]} ${
            i <= index
              ? index === 0 ? 'bg-sky-300' : index === 1 ? 'bg-violet-300' : 'bg-rose-300'
              : 'bg-border/60'
          }`}
        />
      ))}
    </button>
  );
}

const HAND_FAN_MAX = 6;

/**
 * How long a card takes to get out of a bot's hand and onto its board.
 *
 * Beats are 260ms apart and compress to 90ms on a busy turn, so this outlasts
 * its own beat on purpose: a card still turning over while the next one starts
 * is what a sequence of plays looks like, and shortening it to fit inside one
 * beat left no time for the flip to read.
 */
const PLAY_FLIGHT_MS = 460;

/** A draw is a shorter hop — library to hand is about a card's width. */
const DRAW_FLIGHT_MS = 300;

/**
 * Their hand, drawn the way yours is — overlapping cards in a row — except face
 * down. A fan reads as "a hand" at a glance where a single pile reads as another
 * zone, and the width tracks how many they're actually holding.
 *
 * Also the landing pad for their draws: `data-bot-hand` is what the draw hop
 * and the play flight measure, so both stay correct through a seat being
 * dragged, resized, or folded into the phone row.
 */
function HandFan({ opponentId, count, width, onContextMenu }: {
  opponentId: string;
  count: number;
  width: number;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const animations = usePlaytestSettings(s => s.animations);
  // Only this seat's beats, so the other seats' draws don't re-run the effect.
  const beat = useOpponentStore(s => (s.lastBeat?.opponentId === opponentId ? s.lastBeat : null));

  /**
   * The draw: a card back hops off their library into the fan.
   *
   * Keyed on the beat's tick rather than on the count, because the count also
   * changes when they discard or cast, and a hand shrinking is not a draw.
   */
  useEffect(() => {
    if (!animations || !beat || beat.drew === 0) return;
    const to = boxOf(ref.current);
    const from = captureBox(`[data-bot-zone="library:${opponentId}"]`);
    if (!to || !from) return;
    useCardFlights.getState().launch(
      // Capped: a bot that draws seven wants a flurry, not seven of them.
      // No card is passed — what they drew is hidden information, and the
      // flight renders a back.
      Array.from({ length: Math.min(beat.drew, 4) }, (_, i) => ({
        from,
        to,
        delay: i * 70,
        faceDown: true,
        duration: DRAW_FLIGHT_MS,
        peakWidth: Math.max(30, Math.round(to.width * 1.7)),
        bow: 16,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat?.tick]);

  if (count === 0) {
    return (
      <div
        ref={ref}
        data-bot-hand={opponentId}
        onContextMenu={onContextMenu}
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
      ref={ref}
      data-bot-hand={opponentId}
      onContextMenu={onContextMenu}
      className="shrink-0 flex items-end"
      title={`Hand · ${count} card${count === 1 ? '' : 's'}, hidden as they would be · right-click to make them discard`}
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
  label, count, width, hint, top, onClick, onContextMenu, warn, Icon, tint, anchorId,
}: {
  label: string;
  count: number;
  width: number;
  hint: string;
  /**
   * Marks this pile as a flight endpoint, as `data-bot-zone`. The library
   * needs one so far — it is where a draw comes from.
   */
  anchorId?: string;
  top?: ScryfallCard;
  onClick?: () => void;
  /** Right-click opens the zone menu. Unlike the click, it works when empty —
      milling an empty library is a no-op, but "shuffle" still isn't. */
  onContextMenu?: (e: React.MouseEvent) => void;
  warn?: boolean;
  Icon: LucideIcon;
  /** Border and background tint, matching our own pile for the same zone. */
  tint: string;
}) {
  const empty = count === 0;
  const Tag = onClick && !empty ? 'button' : 'div';
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  // A pile is ~38px wide; the face-up ones are unreadable at that size. Same
  // magnify rules as a card on their board, so the gesture works everywhere.
  const magnified = useMagnifyHover(hovered, 'opponent');
  const showPreview = !!top && magnified;
  return (
    <div
      ref={boxRef}
      data-bot-zone={anchorId}
      onContextMenu={onContextMenu}
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
/**
 * How much smaller the wrapping rows are drawn than the sizes below.
 *
 * Height is what this buys. A smaller card both takes fewer pixels of row and
 * fits more cards per line, so the rows it governs shrink faster than the
 * number suggests — which is what pays for the seat being allowed to grow to
 * its board instead of scrolling inside a cap.
 *
 * Only the wrapping rows are zoomed. The land row is already clamped to a
 * single line by `landWidthFor`, so shrinking it buys no height and only costs
 * legibility on the row that is hardest to read already.
 */
const BOARD_ZOOM = 0.75;

const UPPER_ROWS: { key: Exclude<RowKey, 'lands'>; label: string; scale: number }[] = [
  { key: 'creatures', label: 'Creatures',        scale: 0.19 * BOARD_ZOOM },
  { key: 'others',    label: 'Other permanents', scale: 0.14 * BOARD_ZOOM },
];

/**
 * How much of the identity art shows through. Deliberately low: this is a
 * tint that tells you who you are looking at, not a picture.
 */
const SEAT_ART_OPACITY = 0.16;

/** Lands are smallest — a land row is there to be counted, not read. */
const LAND_SCALE = 0.10;

/** The seat's own padding (`p-1.5`), and the gap between cards in a row (`gap-1`). */
const SEAT_PADDING = 12;
const ROW_GAP = 4;

/**
 * How far the board shrinks while this seat is in combat. The strip's cards
 * roughly double at the same moment, so the seat as a whole stays about the
 * same height while the attention moves to the fight.
 */
const COMBAT_SHRINK = 0.6;

/**
 * How wide a zone pile is, as a fraction of the seat's width.
 *
 * It sets the HEIGHT of the whole bottom row, not just the width of the piles:
 * they are card-shaped, so the row is always 1.4 of this. Everything in the row
 * is a pile you glance at rather than read — the count badge and the zone symbol
 * are what you are actually looking for, and both stay legible well below this —
 * so the row can afford to be short and hand the space to the board above it.
 */
export const ZONE_WIDTH_FRACTION = 0.075;

/**
 * Seat width → card width for a row.
 *
 * Only a floor, no ceiling. There used to be an 84px cap, which meant that
 * past a certain seat width the cards stopped growing and resizing the seat
 * just added blank space around them — the opposite of what dragging a seat
 * wider is for. The whole point is that the seat is a zoom control.
 */
function rowWidth(seatWidth: number, scale: number): number {
  return Math.round(Math.max(14, seatWidth * scale));
}

/**
 * Land width that keeps every land on one line.
 *
 * The normal row width, until that would overflow the seat — then as wide as
 * the lands can be and still fit side by side. Wrapping is the thing being
 * bought out of here: a land row that wraps grows the seat downwards over the
 * player's own battlefield, and it does it precisely when the bot is doing the
 * least interesting thing it can do.
 *
 * A tapped land is turned ninety degrees, so it spends its own height on
 * width — `CARD_ASPECT` units of the row instead of one.
 */
function landWidthFor(seatWidth: number, piles: PermanentPile[], scale: number): number {
  const max = rowWidth(seatWidth, LAND_SCALE * scale);
  if (piles.length === 0) return max;
  const units = piles.reduce((n, p) => n + (p.top.tapped ? CARD_ASPECT : 1), 0);
  const avail = seatWidth - SEAT_PADDING - ROW_GAP * (piles.length - 1);
  return Math.round(Math.max(14, Math.min(max, avail / units)));
}

/**
 * Below this a group renders as separate cards. Two identical signets read
 * better as two cards than as a pile of two; forty-four goblins do not.
 */
const PILE_AT = 3;

/** A run of interchangeable permanents, drawn as one card with a count. */
export interface PermanentPile {
  key: string;
  /** The one that gets drawn, and the one a click acts on. */
  top: OpponentPermanent;
  count: number;
  /**
   * Every permanent in the pile. The seat needs it to answer "did any card in
   * this pile just come out of their hand" — a pile is one element for three
   * or more identical cards, so the one that just arrived may not be `top`.
   */
  ids: string[];
}

/**
 * Collapse interchangeable permanents into counted piles.
 *
 * A goblin deck attacks with a median of fifty-two creatures and can hold
 * sixty-eight permanents. Drawn one card each, that board overflowed its seat
 * and painted straight down over the player's own battlefield. Identical tokens
 * share a Scryfall id, so they collapse to a single pile almost for free.
 *
 * The key includes tapped state, sickness and counters, so a pile never lies
 * about the cards inside it: half a tapped goblin army splits into two piles
 * rather than pretending to be one.
 */
function pileUp(cards: OpponentPermanent[]): PermanentPile[] {
  const groups = new Map<string, OpponentPermanent[]>();
  for (const p of cards) {
    const counters = Object.entries(p.counters)
      .filter(([, v]) => v > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([t, v]) => `${t}=${v}`)
      .join(',');
    const key = `${p.card.id}|${p.tapped ? 't' : ''}|${p.summoningSick ? 's' : ''}|${counters}`;
    const hit = groups.get(key);
    if (hit) hit.push(p);
    else groups.set(key, [p]);
  }

  const out: PermanentPile[] = [];
  for (const [key, members] of groups) {
    // A small group stays as individual cards, so an ordinary board is
    // untouched by any of this.
    if (members.length < PILE_AT) {
      for (const p of members) out.push({ key: p.instanceId, top: p, count: 1, ids: [p.instanceId] });
      continue;
    }
    out.push({ key, top: members[0], count: members.length, ids: members.map(p => p.instanceId) });
  }
  return out;
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
  opponentId, permanent, width, count = 1, comboPiece = false,
  castFrom = null, beatTick = 0,
}: {
  opponentId: string;
  permanent: OpponentPermanent;
  width: number;
  /** Part of an armed combo — ringed so the piece to kill is obvious. */
  comboPiece?: boolean;
  /**
   * How many interchangeable copies this card stands for. Above one it draws as
   * a pile with a count, and every action on it — tap, steal, destroy — applies
   * to the one on top.
   */
  count?: number;
  /**
   * This card (or, for a pile, one of the cards in it) was just cast out of
   * the seat's hand — so it flies in from the hand fan instead of dealing in
   * from the top.
   */
  /**
   * Set when this card was just cast, to the zone it was cast OUT of. Null on
   * everything else — a token, a land, a permanent that was already there.
   */
  castFrom?: CastZone | null;
  /** The beat that `castFrom` belongs to, so the flight fires once. */
  beatTick?: number;
}) {
  const togglePermanentTap = useOpponentStore(s => s.togglePermanentTap);
  const permanentToZone = useOpponentStore(s => s.permanentToZone);
  /**
   * This creature is out front in the combat strip right now.
   *
   * It stays in the row as a faded ghost rather than vanishing: the row keeps
   * its shape, the flight has something to leave from, and the empty square
   * says where the creature came back to once combat is over. Also the only
   * way a pile of identical attackers reads honestly — the strip shows the
   * pile once, and the board shows the square it left.
   */
  const attacking = useOpponentStore(s =>
    s.combat?.opponentId === opponentId
    && s.combat.attackers.some(a => a.instanceId === permanent.instanceId),
  );
  const [hovered, setHovered] = useState(false);
  const [menu, setMenu] = useState<OpponentMenuTarget | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const showPreview = useMagnifyHover(hovered, 'opponent');
  const animations = usePlaytestSettings(s => s.animations);
  const counters = Object.entries(permanent.counters).filter(([, v]) => v > 0);
  // A P/T pill appears for the two things that make a creature's size something
  // other than what is printed on it: a rewrite, and an until-end-of-turn pump.
  // Worth computing only then — read through botPower/botToughness so counters
  // and anthems are in the number too, not just the edit's or the pump's own
  // values. A string keeps the selector's equality cheap.
  const restatedPT = useOpponentStore(s => {
    if (!permanent.edit && !permanent.tempBoost) return null;
    const opp = s.opponents.find(o => o.id === opponentId);
    if (!opp) return null;
    return `${botPower(permanent, opp.battlefield, opp.graveyard)}/${botToughness(permanent, opp.battlefield, opp.graveyard)}`;
  });
  /*
   * Which of the two it is, when a creature is both. The edit wins the colour,
   * matching `resolvePT` on your own side of the table: being Frogified is the
   * louder fact about a creature than being a point bigger this turn.
   *
   * Amber for a rewrite, emerald for a pump — emerald because that is already
   * what a +1/+1 counter wears below, and "temporarily bigger" and
   * "permanently bigger" should not read as unrelated ideas.
   */
  const boostOnly = !permanent.edit && !!permanent.tempBoost;
  const pumpKeywords = permanent.tempBoost?.keywords ?? [];

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

  /**
   * A tapped card is turned ninety degrees, so the space it needs is its own
   * dimensions swapped. The box reserves that, and the image is centred inside
   * it — otherwise the rotation overhangs a box still shaped like an upright
   * card, and the row either clipped the overhang against the seat's edge or
   * let it paint over the card beside it.
   */
  const cardHeight = Math.round(width * CARD_ASPECT);
  const boxWidth = permanent.tapped ? cardHeight : width;
  const boxHeight = permanent.tapped ? width : cardHeight;

  /**
   * Cast: the card leaves the zone it was cast from, swings out over the table
   * getting bigger, turns face up, and lands in this slot.
   *
   * Usually the hand fan. A commander comes off the command pile and a
   * Gravecrawler off the graveyard, and flying either of those out of a hand
   * that may well be empty read as a card appearing from nowhere.
   *
   * It replaces the deal-in keyframe for this one card rather than joining it.
   * Two arrival animations on one card show it twice — and the keyframe would
   * win the fight over the inline `opacity: 0` that hides the real card while
   * its copy is in the air, because a running animation outranks an inline
   * style.
   *
   * A layout effect, so the hide lands in the same paint as the launch. On a
   * useEffect the card is visible in its slot for a frame before the flight
   * has even started, which reads as the card arriving twice.
   *
   * Only a lone card hides. A pile stands for three or more copies, so hiding
   * it would take the other two off the board to animate the third.
   *
   * `visibility` rather than opacity, because this element transitions opacity
   * over 300ms — the real card would fade out underneath its own flight and
   * then fade back in after it landed. Visibility is not in that transition
   * list, so it switches on the frame it is asked to.
   */
  const flown = useRef(0);
  const [flying, setFlying] = useState(false);
  useLayoutEffect(() => {
    if (!castFrom || !animations) return;
    if (flown.current === beatTick) return;
    flown.current = beatTick;
    const to = boxOf(boxRef.current);
    const from = captureBox(
      castFrom === 'hand'
        ? `[data-bot-hand="${opponentId}"]`
        : `[data-bot-zone="${castFrom}:${opponentId}"]`,
    );
    if (!to || !from) return;
    useCardFlights.getState().launch([{
      card: permanent.card,
      from,
      to,
      delay: 0,
      reveal: true,
      duration: PLAY_FLIGHT_MS,
      // Big enough in the middle to actually read the card as it turns over —
      // that is the whole point of the flourish.
      peakWidth: Math.max(92, Math.round(to.width * 2.6)),
      bow: 44,
    }]);
    if (count > 1) return;
    setFlying(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatTick, castFrom]);

  /**
   * Give the card back when its flight lands.
   *
   * Its own effect, keyed on the hide rather than on the beat, and this is not
   * a style preference — it is the whole bug. With the timer living in the
   * launch effect above, its cleanup ran on the next dependency change, and
   * the next beat is 260ms away while the flight is 460ms long. So React
   * cleared the timer, re-ran the effect, found `castFrom` null for
   * this card by then, returned early — and the card stayed hidden for the
   * rest of the game. Everything a bot played was invisible except the last
   * card of each turn, which had no following beat to cancel it.
   */
  useEffect(() => {
    if (!flying) return;
    const t = setTimeout(() => setFlying(false), PLAY_FLIGHT_MS);
    return () => clearTimeout(t);
  }, [flying]);

  return (
    <div
      ref={boxRef}
      data-float-id={permanent.instanceId}
      // Keyed by instanceId upstream, so this runs once when the card arrives —
      // it drops onto their board rather than blinking into existence.
      className={`relative shrink-0 transition-[opacity,width,height] duration-300 ${
        drag.isDragging ? 'opacity-30' : attacking ? 'opacity-25' : ''
      } ${
        // The flight is this card's arrival animation when it was cast;
        // everything else still drops in from the top.
        animations && !castFrom ? 'animate-deal-in-from-top' : ''
      } ${comboPiece ? 'ring-2 ring-rose-400 rounded-[3px] animate-pulse' : ''}`}
      style={{ width: boxWidth, height: boxHeight, visibility: flying ? 'hidden' : undefined }}
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
        onClick={() => { if (!dragMoved.current) togglePermanentTap(opponentId, permanent.instanceId); }}
        draggable={false}
        // Centred on the box rather than filling it: the box is the rotated
        // footprint, the image is always the upright card that spins inside it.
        style={{ width, height: cardHeight }}
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[3px] shadow cursor-grab touch-none transition-transform duration-200 ${
          permanent.tapped ? 'rotate-90' : ''
        } ${permanent.summoningSick ? 'ring-1 ring-amber-300/50' : ''}`}
      />

      {count > 1 && (
        <span
          className="absolute -top-1 -left-1 px-1 rounded-full bg-violet-600 text-white text-[10px] font-bold leading-4 tabular-nums shadow ring-1 ring-black/50 pointer-events-none"
          aria-label={`${count} copies`}
        >
          ×{count}
        </span>
      )}

      {restatedPT && (
        <span
          className={`absolute -bottom-1 -right-1 px-1 rounded-[3px] text-white text-[9px] font-bold leading-4 tabular-nums shadow ring-1 ring-black/50 pointer-events-none ${
            boostOnly ? 'bg-emerald-600' : 'bg-amber-600'
          }`}
          title={
            boostOnly
              ? `Until end of turn${pumpKeywords.length > 0 ? ` · gains ${pumpKeywords.join(', ')}` : ''}`
              : `Edited${permanent.edit?.loseAbilities ? ' · loses all abilities' : ''}`
          }
        >
          {restatedPT}{!boostOnly && permanent.edit?.loseAbilities ? ' ⊘' : ''}
        </span>
      )}

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
