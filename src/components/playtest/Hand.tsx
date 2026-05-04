import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardImageUrl, getFrontFaceTypeLine } from '@/services/scryfall/client';
import { PlaytestCardMenu, type CardMenuTarget } from '@/components/playtest/PlaytestCardMenu';
import type { ScryfallCard } from '@/types';

type SortMode = 'none' | 'cmc' | 'type';

export function Hand() {
  const hand = usePlaytestStore(s => s.zones.hand);
  const moveCard = usePlaytestStore(s => s.moveCard);
  const [sort, setSort] = useState<SortMode>('none');
  const [menu, setMenu] = useState<CardMenuTarget | null>(null);

  const display = sortedHand(hand, sort);

  const playToBattlefield = (handIndex: number) => {
    moveCard({
      source: { kind: 'zone', zone: 'hand', index: handIndex },
      target: { kind: 'battlefield', x: 50, y: 0, arrived: true },
    });
  };

  return (
    <div className="border-t border-border/50 bg-card/30 px-4 py-3 flex flex-col">
      <div className="flex items-center justify-between mb-2 text-[10px] uppercase opacity-60">
        <span>Hand · {hand.length}</span>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortMode)}
          className="bg-transparent border border-border/50 rounded px-1.5 py-0.5"
        >
          <option value="none">None</option>
          <option value="cmc">CMC</option>
          <option value="type">Type</option>
        </select>
      </div>
      <div className="flex justify-center min-h-[160px]">
        <div className="flex items-end">
          {display.map(({ card, originalIndex }, i) => (
            <HandCard
              key={`${card.id}-${originalIndex}`}
              card={card}
              indexInHand={originalIndex}
              fanIndex={i}
              total={display.length}
              onClickPlay={() => playToBattlefield(originalIndex)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ kind: 'hand', handIndex: originalIndex, card, x: e.clientX, y: e.clientY });
              }}
            />
          ))}
        </div>
      </div>
      <PlaytestCardMenu target={menu} onClose={() => setMenu(null)} />
    </div>
  );
}

function sortedHand(hand: ScryfallCard[], mode: SortMode) {
  const indexed = hand.map((card, originalIndex) => ({ card, originalIndex }));
  if (mode === 'cmc') indexed.sort((a, b) => a.card.cmc - b.card.cmc);
  else if (mode === 'type') indexed.sort((a, b) => getFrontFaceTypeLine(a.card).localeCompare(getFrontFaceTypeLine(b.card)));
  return indexed;
}

interface HandCardProps {
  card: ScryfallCard;
  indexInHand: number;
  fanIndex: number;
  total: number;
  onClickPlay: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function HandCard({ card, indexInHand, fanIndex, total, onClickPlay, onContextMenu }: HandCardProps) {
  const dragId = `hand:${indexInHand}:${card.id}`;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: dragId,
    data: { source: { kind: 'zone', zone: 'hand', index: indexInHand } },
  });

  const overlap = total <= 7 ? 24 : Math.min(24 + (total - 7) * 6, 88);
  const style: React.CSSProperties = {
    marginLeft: fanIndex === 0 ? 0 : `-${overlap}px`,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0) scale(1.05)` : undefined,
    zIndex: isDragging ? 50 : fanIndex,
    transition: isDragging ? 'none' : 'transform 200ms ease',
    width: 'clamp(80px, 11vw, 130px)',
    cursor: isDragging ? 'grabbing' : 'pointer',
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClickPlay}
      onContextMenu={onContextMenu}
      title={`Click to play ${card.name} · right-click for more options`}
      className={`relative shrink-0 rounded-lg select-none touch-none transition-transform ${
        isDragging ? '' : 'hover:-translate-y-2 hover:z-20'
      }`}
      style={style}
    >
      <img
        src={getCardImageUrl(card, 'normal')}
        alt={card.name}
        className="w-full rounded-lg shadow-md pointer-events-none"
        loading="lazy"
        draggable={false}
      />
    </div>
  );
}
