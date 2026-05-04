import React, { useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { DraggableAttributes } from '@dnd-kit/core';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardImageUrl } from '@/services/scryfall/client';
import { PlaytestCardMenu, type CardMenuTarget } from '@/components/playtest/PlaytestCardMenu';
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
  const droppable = useDroppable({
    id: `bf-card:${card.instanceId}`,
    data: { kind: 'battlefield-card', instanceId: card.instanceId },
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
        droppableRef={droppable.setNodeRef}
        droppableIsOver={droppable.isOver}
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
  droppableRef: (node: HTMLElement | null) => void;
  droppableIsOver: boolean;
  onTap: () => void;
  onAdjust: (type: string, delta: number) => void;
  onHover: (v: boolean) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const PositionedCard = React.forwardRef<HTMLDivElement, PositionedProps>(function PositionedCard(props, ref) {
  const { card, xPx, yPx, transform, isDragging, attributes, listeners, droppableRef, droppableIsOver, onTap, onAdjust, onHover, onContextMenu } = props;
  const cardWidth = 100;
  const counterEntries = Object.entries(card.counters).filter(([, v]) => v > 0);
  const tx = transform?.x ?? 0;
  const ty = transform?.y ?? 0;

  const movedRef = React.useRef(false);

  return (
    <div
      ref={ref}
      {...attributes}
      {...(listeners as Record<string, unknown>)}
      onPointerDown={() => { movedRef.current = false; }}
      onPointerMove={() => { movedRef.current = true; }}
      onClick={(e) => { e.stopPropagation(); if (!movedRef.current) onTap(); }}
      onContextMenu={onContextMenu}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={`absolute select-none touch-none ${isDragging ? 'opacity-80 z-50' : 'z-10'}`}
      style={{
        left: xPx,
        top: yPx,
        transform: `translate3d(${tx}px, ${ty}px, 0)`,
        width: cardWidth,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
    >
      {/* Droppable overlay (for aura/equipment attachment) */}
      <div
        ref={droppableRef}
        className={`absolute inset-0 pointer-events-none rounded-md ${droppableIsOver ? 'ring-2 ring-emerald-400' : ''}`}
      />
      <div
        className="relative w-full"
        style={{ transform: card.tapped ? 'rotate(90deg)' : undefined, transformOrigin: 'center', transition: 'transform 150ms ease' }}
      >
        <img
          src={card.faceDown ? `${import.meta.env.BASE_URL}card-back.png` : getCardImageUrl(card.card, 'normal')}
          alt={card.faceDown ? 'Face-down' : card.card.name}
          className="w-full rounded-md shadow-lg pointer-events-none"
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
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${COUNTER_COLOR[type] ?? 'bg-zinc-600/80 text-white'}`}
                title={`${type} (click +1, shift -1, alt remove)`}
              >
                {n} {type}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
