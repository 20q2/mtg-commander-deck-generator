import React, { useRef, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { DraggableAttributes } from '@dnd-kit/core';
import { usePlaytestStore, STACK_FLIGHT_MS } from '@/store/playtestStore';
import { usePlaytestSettings, CARD_SIZES } from '@/store/playtestSettingsStore';
import { getCardImageUrl, getCardBackFaceUrl, isDoubleFacedCard } from '@/services/scryfall/client';
import { PlaytestCardMenu, type CardMenuTarget } from '@/components/playtest/PlaytestCardMenu';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { CardOverlays, badgeFloatAnchor } from '@/components/playtest/CardOverlays';
import { useMagnifyHover } from '@/components/playtest/hooks/useMagnifyHover';
import type { BattlefieldCard as BfCard } from '@/components/playtest/types';

export function BattlefieldCard({ card }: { card: BfCard }) {
  const toggleTap = usePlaytestStore(s => s.toggleTap);
  const toggleSelect = usePlaytestStore(s => s.toggleSelect);
  const adjustCounter = usePlaytestStore(s => s.adjustCounter);
  const setHovered = usePlaytestStore(s => s.setHovered);
  const battlefield = usePlaytestStore(s => s.battlefield);
  const selected = usePlaytestStore(s => s.selectedIds.includes(card.instanceId));
  // Group-drag follow: when a different selected card is being dragged, this card
  // should visually translate by the same delta until drop.
  const followDelta = usePlaytestStore(s => {
    const aid = s.dragActiveId;
    if (!aid) return null;
    // Skip if this card is itself the active drag target.
    if (aid.kind === 'card' && aid.id === card.instanceId) return null;
    if (!s.selectedIds.includes(card.instanceId)) return null;
    // Only follow if the active draggable is part of the marquee selection.
    const activeSelected =
      aid.kind === 'card'    ? s.selectedIds.includes(aid.id)
    : aid.kind === 'counter' ? s.selectedCounterIds.includes(aid.id)
    :                          s.selectedDieIds.includes(aid.id);
    if (!activeSelected) return null;
    return s.dragDelta;
  });
  const [menu, setMenu] = useState<CardMenuTarget | null>(null);

  const draggable = useDraggable({
    id: `bf:${card.instanceId}`,
    data: { source: { kind: 'battlefield', instanceId: card.instanceId } },
  });

  // Compute attachment offset: how many cards are attached above us in the stack?
  let xPx = card.x;
  let yPx = card.y;
  if (card.attachedTo) {
    const parent = battlefield.find(b => b.instanceId === card.attachedTo);
    if (parent) {
      const siblings = battlefield.filter(b => b.attachedTo === card.attachedTo);
      const myIdx = siblings.findIndex(b => b.instanceId === card.instanceId);
      xPx = parent.x + (myIdx + 1) * 8;
      yPx = parent.y + (myIdx + 1) * 28;
    }
  }

  return (
    <>
      <PositionedCard
        ref={draggable.setNodeRef}
        attributes={draggable.attributes}
        listeners={draggable.listeners}
        card={card}
        xPx={xPx}
        yPx={yPx}
        transform={draggable.transform ?? followDelta}
        isDragging={draggable.isDragging}
        selected={selected}
        onTap={(e) => {
          // Ctrl/Cmd-click selects instead of tapping, so a card can be picked
          // out without dragging a marquee around it.
          if (e.ctrlKey || e.metaKey) toggleSelect('card', card.instanceId);
          else toggleTap(card.instanceId);
        }}
        onAdjust={(t, d, anchor) => adjustCounter(card.instanceId, t, d, anchor)}
        onHover={(v) => setHovered(v ? card.instanceId : null)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ kind: 'battlefield', instanceId: card.instanceId, card: card.card, x: e.clientX, y: e.clientY });
        }}
      />
      <PlaytestCardMenu target={menu} onClose={() => setMenu(null)} />
    </>
  );
}

interface PositionedProps {
  card: BfCard;
  xPx: number;
  yPx: number;
  transform: { x: number; y: number } | null;
  isDragging: boolean;
  selected: boolean;
  attributes: DraggableAttributes;
  listeners: Record<string, unknown> | undefined;
  onTap: (e: React.MouseEvent) => void;
  onAdjust: (type: string, delta: number, anchor?: { x: number; y: number }) => void;
  onHover: (v: boolean) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

/**
 * Flight-in for a card that was just tidied into a pile. The store has already
 * moved it, so this renders it back at its old spot for a frame and then lets
 * CSS carry it home — a snap with no travel reads as a glitch rather than as
 * cards being gathered up.
 *
 * Deliberately not a general "animate any position change": a card being
 * dragged has to track the cursor exactly, and a transition on transform would
 * put it on a leash. Only stacking opts in.
 */
function useStackFlight(instanceId: string, enabled: boolean) {
  const flight = usePlaytestStore(s => s.stackFlight);
  // Initialised to whatever tick is current, so a card mounting long after a
  // stack doesn't fly in from a stale offset.
  const seenTick = React.useRef(flight?.tick ?? 0);
  const [leg, setLeg] = React.useState<{ dx: number; dy: number; gliding: boolean } | null>(null);

  // Layout, not passive: the store has already moved the card, so the offset
  // has to be in place before the browser paints. A passive effect lands one
  // frame late and the pile flashes into view before the cards fly in.
  React.useLayoutEffect(() => {
    if (!flight || flight.tick === seenTick.current) return;
    seenTick.current = flight.tick;
    const off = flight.offsets[instanceId];
    if (!enabled || !off || (off.dx === 0 && off.dy === 0)) return;
    setLeg({ ...off, gliding: false });
    // Two frames, not one: React would otherwise batch the offset and the
    // glide into a single commit, the browser would never paint the start
    // position, and there'd be nothing to transition from.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setLeg({ ...off, dx: 0, dy: 0, gliding: true }));
    });
    const land = setTimeout(() => setLeg(null), STACK_FLIGHT_MS + 80);
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      clearTimeout(land);
    };
  }, [flight, instanceId, enabled]);

  return leg;
}

/** Float the loyalty text off the shield itself rather than the card centre. */
const shieldAnchor = (e: React.MouseEvent<HTMLElement>) => badgeFloatAnchor(e.currentTarget);

const PositionedCard = React.forwardRef<HTMLDivElement, PositionedProps>(function PositionedCard(props, ref) {
  const { card, xPx, yPx, transform, isDragging, selected, attributes, listeners, onTap, onAdjust, onHover, onContextMenu } = props;
  const cardSize = usePlaytestSettings(s => s.cardSize);
  const cardWidth = CARD_SIZES[cardSize].width;
  const cardHeight = CARD_SIZES[cardSize].height;
  const localRef = useRef<HTMLDivElement | null>(null);
  const setRefs = (node: HTMLDivElement | null) => {
    localRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
  };
  // Once a shake has tidied the group, the pile is what you're holding: the
  // dragged card stops hiding behind its floating ghost and sits in the stack
  // at the same z as its neighbours, so the cards below it aren't painted over.
  const stackedDrag = usePlaytestStore(s => s.stackedDrag);
  const [hovered, setHoveredLocal] = useState(false);
  const showPreview = useMagnifyHover(hovered) && !isDragging;
  const loyaltyValue = card.counters['loyalty'] ?? 0;
  const isPlaneswalker = card.card.type_line.toLowerCase().includes('planeswalker');
  const tx = transform?.x ?? 0;
  const ty = transform?.y ?? 0;

  // Arrival shrink: cards mount briefly larger then transition down to the
  // battlefield's normal size, matching the visual "drop from hand" intent.
  const animations = usePlaytestSettings(s => s.animations);
  const flight = useStackFlight(card.instanceId, animations);
  const [arrived, setArrived] = React.useState(!animations);
  React.useEffect(() => {
    if (!animations) { setArrived(true); return; }
    const id = requestAnimationFrame(() => setArrived(true));
    return () => cancelAnimationFrame(id);
  }, [animations]);

  // Flip: play a quick rotateY when the faceDown state toggles. The displayed
  // face lags the store value by ~half the animation so the image swap happens
  // at the edge-on midpoint (otherwise you'd see the *new* face rotating away
  // from frame 0). Skip the lag entirely when animations are disabled.
  const prevFaceDown = React.useRef(card.faceDown);
  const [flipping, setFlipping] = React.useState(false);
  const [displayFaceDown, setDisplayFaceDown] = React.useState(card.faceDown);
  React.useEffect(() => {
    if (prevFaceDown.current === card.faceDown) return;
    prevFaceDown.current = card.faceDown;
    if (!animations) {
      setDisplayFaceDown(card.faceDown);
      return;
    }
    setFlipping(true);
    const swap = setTimeout(() => setDisplayFaceDown(card.faceDown), 175);
    const end  = setTimeout(() => setFlipping(false), 380);
    return () => { clearTimeout(swap); clearTimeout(end); };
  }, [card.faceDown, animations]);

  const totalRotation = (card.tapped ? 90 : 0) + (card.rotation ?? 0);
  const innerTransform = [
    arrived ? 'scale(1)' : 'scale(1.15)',
    totalRotation !== 0 ? `rotate(${totalRotation}deg)` : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={setRefs}
      data-float-id={card.instanceId}
      // Distinct from data-float-id, which opponent permanents also carry.
      // Blocker targeting hit-tests on this, and must never match their board.
      data-bf-card={card.instanceId}
      {...attributes}
      {...(listeners as Record<string, unknown>)}
      onClick={(e) => { e.stopPropagation(); onTap(e); }}
      onContextMenu={onContextMenu}
      onMouseEnter={() => { onHover(true); setHoveredLocal(true); }}
      onMouseLeave={() => { onHover(false); setHoveredLocal(false); }}
      className={`absolute select-none touch-none ${isDragging && !stackedDrag ? 'opacity-0 z-50' : 'z-10'}`}
      style={{
        left: xPx,
        top: yPx,
        // The flight offset rides on top of the drag delta, so a group tidied
        // mid-drag keeps following the cursor while its cards fly together.
        transform: `translate3d(${tx + (flight?.dx ?? 0)}px, ${ty + (flight?.dy ?? 0)}px, 0)`,
        transition: flight?.gliding
          ? `transform ${STACK_FLIGHT_MS}ms cubic-bezier(0.2, 0.9, 0.25, 1)`
          : undefined,
        width: cardWidth,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
    >
      <div
        className="relative w-full"
        style={{ transform: innerTransform, transformOrigin: 'center', transition: 'transform 120ms ease-out' }}
      >
        <img
          src={
            displayFaceDown
              ? (isDoubleFacedCard(card.card)
                  ? (getCardBackFaceUrl(card.card, 'normal') ?? `${import.meta.env.BASE_URL}card-back.png`)
                  : `${import.meta.env.BASE_URL}card-back.png`)
              : (card.flipped && isDoubleFacedCard(card.card)
                  ? (getCardBackFaceUrl(card.card, 'normal') ?? getCardImageUrl(card.card, 'normal'))
                  : getCardImageUrl(card.card, 'normal'))
          }
          alt={displayFaceDown ? 'Face-down' : card.card.name}
          // A hairline violet ring marks the card under the cursor — enough to
          // pick one card out of an overlapped stack, thin enough not to read as
          // selection. Selection's own ring outranks it, so the two never stack.
          className={`w-full rounded-[6px] shadow-lg pointer-events-none ${
            selected
              ? 'ring-2 ring-primary ring-offset-1 ring-offset-transparent'
              : hovered && !isDragging ? 'ring-1 ring-violet-400' : ''
          } ${flipping ? 'animate-bf-flip' : ''}`}
          draggable={false}
        />
        {/* Loyalty shield — bottom-right, MTG-style hex shield. Planeswalkers
            always have one (so you can click it up from 0); anything else grows
            one the moment it's given loyalty counters, since CardOverlays
            deliberately never draws loyalty as a round badge. */}
        {(isPlaneswalker || loyaltyValue > 0) && (
          <div
            className="absolute bottom-1 right-1 flex items-end gap-1 pointer-events-auto"
            style={{ transform: card.tapped ? 'rotate(-90deg)' : undefined, transformOrigin: 'center' }}
          >
            {/* Planeswalker loyalty shield — uses the SVG asset under public/icons/.
                Left-click +1, right-click −1, no separate spinner buttons. */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onAdjust('loyalty', 1, shieldAnchor(e)); }}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onAdjust('loyalty', -1, shieldAnchor(e)); }}
              className="relative cursor-pointer drop-shadow-[0_2px_4px_rgba(0,0,0,0.75)] hover:brightness-110 active:scale-95 transition"
              style={{ width: 36, height: 24 }}
              title={`${loyaltyValue} loyalty · click +1 · right-click −1`}
            >
              <img
                src={`${import.meta.env.BASE_URL}icons/Loyalty.svg`}
                alt=""
                className="absolute inset-0 w-full h-full pointer-events-none"
                draggable={false}
                aria-hidden
              />
              <span
                className="absolute inset-0 flex items-center justify-center text-white font-extrabold text-[11px] leading-none tabular-nums"
                style={{ textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}
              >
                {loyaltyValue}
              </span>
            </button>
          </div>
        )}

        <CardOverlays
          card={card}
          cardWidth={cardWidth}
          cardHeight={cardHeight}
          onAdjust={onAdjust}
        />
      </div>
      {showPreview && <MagnifiedPreview card={card.card} anchorRef={localRef} faceDown={card.faceDown} />}
    </div>
  );
});
