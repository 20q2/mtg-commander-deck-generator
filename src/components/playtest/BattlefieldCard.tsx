import React, { useRef, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { DraggableAttributes } from '@dnd-kit/core';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings, CARD_SIZES } from '@/store/playtestSettingsStore';
import { getCardImageUrl, getCardBackFaceUrl, isDoubleFacedCard } from '@/services/scryfall/client';
import { PlaytestCardMenu, type CardMenuTarget } from '@/components/playtest/PlaytestCardMenu';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { TextSticker } from '@/components/playtest/TextSticker';
import { resolvePT } from '@/services/playtest/powerToughness';
import { useMagnifyKey } from '@/hooks/useMagnifyKey';
import type { BattlefieldCard as BfCard } from '@/components/playtest/types';

const COUNTER_COLOR: Record<string, string> = {
  '+1/+1': 'bg-emerald-500/80 text-white',
  '-1/-1': 'bg-red-500/80 text-white',
  loyalty: 'bg-blue-500/80 text-white',
  charge: 'bg-yellow-500/80 text-black',
  storage: 'bg-zinc-500/80 text-white',
};

export function BattlefieldCard({ card }: { card: BfCard }) {
  const toggleTap = usePlaytestStore(s => s.toggleTap);
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
        onTap={() => toggleTap(card.instanceId)}
        onAdjust={(t, d) => adjustCounter(card.instanceId, t, d)}
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
  onTap: () => void;
  onAdjust: (type: string, delta: number) => void;
  onHover: (v: boolean) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const PositionedCard = React.forwardRef<HTMLDivElement, PositionedProps>(function PositionedCard(props, ref) {
  const { card, xPx, yPx, transform, isDragging, selected, attributes, listeners, onTap, onAdjust, onHover, onContextMenu } = props;
  const cardSize = usePlaytestSettings(s => s.cardSize);
  const cardWidth = CARD_SIZES[cardSize].width;
  const localRef = useRef<HTMLDivElement | null>(null);
  const setRefs = (node: HTMLDivElement | null) => {
    localRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
  };
  const [hovered, setHoveredLocal] = useState(false);
  const magnify = useMagnifyKey();
  const showPreview = magnify && hovered && !isDragging;
  const allCounterEntries = Object.entries(card.counters).filter(([, v]) => v > 0);
  const loyaltyValue = card.counters['loyalty'] ?? 0;
  const counterEntries = allCounterEntries.filter(([type]) => type !== 'loyalty');
  const isPlaneswalker = card.card.type_line.toLowerCase().includes('planeswalker');
  const pt = resolvePT(card);
  // Only worth showing when it differs from what's printed on the art — an
  // unmodified 3/3 needs no badge.
  const showPT = pt !== null && (pt.modified !== pt.base || pt.overridden);
  const tx = transform?.x ?? 0;
  const ty = transform?.y ?? 0;

  // Arrival shrink: cards mount briefly larger then transition down to the
  // battlefield's normal size, matching the visual "drop from hand" intent.
  const animations = usePlaytestSettings(s => s.animations);
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
      {...attributes}
      {...(listeners as Record<string, unknown>)}
      onClick={(e) => { e.stopPropagation(); onTap(); }}
      onContextMenu={onContextMenu}
      onMouseEnter={() => { onHover(true); setHoveredLocal(true); }}
      onMouseLeave={() => { onHover(false); setHoveredLocal(false); }}
      className={`absolute select-none touch-none ${isDragging ? 'opacity-0 z-50' : 'z-10'}`}
      style={{
        left: xPx,
        top: yPx,
        transform: `translate3d(${tx}px, ${ty}px, 0)`,
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
          className={`w-full rounded-[5px] shadow-lg pointer-events-none ${selected ? 'ring-2 ring-primary ring-offset-1 ring-offset-transparent' : ''} ${flipping ? 'animate-bf-flip' : ''}`}
          draggable={false}
        />
        {/* Counter badges — centered on the face, counter-rotated to stay upright. */}
        {counterEntries.length > 0 && (
          <div
            className="absolute inset-0 flex items-center justify-center gap-2 pointer-events-none"
            style={{ transform: card.tapped ? 'rotate(-90deg)' : undefined }}
          >
            {counterEntries.map(([type, n]) => (
              <CounterBadge key={type} type={type} value={n} onAdjust={(d) => onAdjust(type, d)} />
            ))}
          </div>
        )}
        {/* Loyalty shield (planeswalkers) — bottom-right with MTG-style hex shield */}
        {isPlaneswalker && (
          <div
            className="absolute bottom-1 right-1 flex items-end gap-1 pointer-events-auto"
            style={{ transform: card.tapped ? 'rotate(-90deg)' : undefined, transformOrigin: 'center' }}
          >
            {/* Planeswalker loyalty shield — uses the SVG asset under public/icons/.
                Left-click +1, right-click −1, no separate spinner buttons. */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onAdjust('loyalty', 1); }}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onAdjust('loyalty', -1); }}
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

        {(card.stickers ?? []).map(st => (
          <TextSticker
            key={st.id}
            instanceId={card.instanceId}
            sticker={st}
            rotation={totalRotation}
          />
        ))}

        {/* Modified P/T — hangs off the bottom-right corner, outside the frame. */}
        {showPT && pt && (
          <div
            className="absolute -bottom-2.5 -right-1.5 z-30 pointer-events-none"
            style={{ transform: card.tapped ? 'rotate(-90deg)' : undefined, transformOrigin: 'center' }}
          >
            <span className="inline-block px-1.5 py-0.5 rounded bg-fuchsia-600/95 text-white text-[11px] font-bold tabular-nums shadow-lg ring-1 ring-white/30">
              {pt.modified}
            </span>
          </div>
        )}
      </div>
      {showPreview && <MagnifiedPreview card={card.card} anchorRef={localRef} faceDown={card.faceDown} />}
    </div>
  );
});

function CounterBadge({
  type, value, onAdjust,
}: {
  type: string;
  value: number;
  onAdjust: (delta: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const arrow = 'absolute left-1/2 -translate-x-1/2 w-0 h-0 border-x-[7px] border-x-transparent drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] cursor-pointer';

  return (
    <div
      className="relative pointer-events-auto"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onWheel={(e) => { e.stopPropagation(); onAdjust(e.deltaY < 0 ? 1 : -1); }}
    >
      {/* Label only on hover — the badge colour already carries the type, and a
          permanent caption is noise on a busy board. */}
      {hovered && (
        <div
          className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-bold uppercase tracking-wide text-white"
          style={{ textShadow: '0 1px 3px rgba(0,0,0,0.95)' }}
        >
          {value} {type}
        </div>
      )}
      {hovered && (
        <button
          type="button"
          aria-label={`Add ${type} counter`}
          onClick={(e) => { e.stopPropagation(); onAdjust(1); }}
          className={`${arrow} -top-3.5 border-b-[9px] border-b-white/90`}
        />
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (e.altKey) onAdjust(-value);
          else if (e.shiftKey) onAdjust(-1);
          else onAdjust(1);
        }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onAdjust(-1); }}
        className={`w-9 h-9 rounded-full font-bold text-sm tabular-nums shadow-lg ring-2 ring-white/40 ${COUNTER_COLOR[type] ?? 'bg-zinc-600/90 text-white'}`}
        title={`${value} ${type} · click +1 · right-click −1 · scroll to adjust · alt-click clears`}
      >
        {value}
      </button>
      {hovered && (
        <button
          type="button"
          aria-label={`Remove ${type} counter`}
          onClick={(e) => { e.stopPropagation(); onAdjust(-1); }}
          className={`${arrow} -bottom-3.5 border-t-[9px] border-t-white/90`}
        />
      )}
    </div>
  );
}
