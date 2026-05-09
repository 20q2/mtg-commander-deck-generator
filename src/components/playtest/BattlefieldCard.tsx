import React, { useRef, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { DraggableAttributes } from '@dnd-kit/core';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { getCardImageUrl, getCardBackFaceUrl, isDoubleFacedCard } from '@/services/scryfall/client';
import { PlaytestCardMenu, type CardMenuTarget } from '@/components/playtest/PlaytestCardMenu';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
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
        transform={draggable.transform}
        isDragging={draggable.isDragging}
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
  attributes: DraggableAttributes;
  listeners: Record<string, unknown> | undefined;
  onTap: () => void;
  onAdjust: (type: string, delta: number) => void;
  onHover: (v: boolean) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const PositionedCard = React.forwardRef<HTMLDivElement, PositionedProps>(function PositionedCard(props, ref) {
  const { card, xPx, yPx, transform, isDragging, attributes, listeners, onTap, onAdjust, onHover, onContextMenu } = props;
  const cardWidth = 100;
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

  const innerTransform = [
    arrived ? 'scale(1)' : 'scale(1.15)',
    card.tapped ? 'rotate(90deg)' : '',
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
            card.faceDown
              ? `${import.meta.env.BASE_URL}card-back.png`
              : (card.flipped && isDoubleFacedCard(card.card)
                  ? (getCardBackFaceUrl(card.card, 'normal') ?? getCardImageUrl(card.card, 'normal'))
                  : getCardImageUrl(card.card, 'normal'))
          }
          alt={card.faceDown ? 'Face-down' : card.card.name}
          className="w-full rounded-[5px] shadow-lg pointer-events-none"
          draggable={false}
        />
        {/* Counter chips, counter-rotated to stay upright when card is tapped */}
        {counterEntries.length > 0 && (
          <div
            className="absolute bottom-1 left-0 right-0 flex flex-wrap justify-center gap-1 pointer-events-auto"
            style={{ transform: card.tapped ? 'rotate(-90deg)' : undefined }}
          >
            {counterEntries.map(([type, n]) => (
              <button
                key={type}
                onClick={(e) => {
                  e.stopPropagation();
                  if (e.altKey) onAdjust(type, -n);              // remove all
                  else if (e.shiftKey) onAdjust(type, -1);
                  else onAdjust(type, 1);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onAdjust(type, -1);
                }}
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${COUNTER_COLOR[type] ?? 'bg-zinc-600/80 text-white'}`}
                title={`${type} (click +1, right-click −1, alt remove)`}
              >
                {n} {type}
              </button>
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
      </div>
      {showPreview && <MagnifiedPreview card={card.card} anchorRef={localRef} faceDown={card.faceDown} />}
    </div>
  );
});
