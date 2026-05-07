import { useEffect, useRef, useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { getCardImageUrl, getFrontFaceTypeLine } from '@/services/scryfall/client';
import { PlaytestCardMenu, type CardMenuTarget } from '@/components/playtest/PlaytestCardMenu';
import { PlaytestActionsBar } from '@/components/playtest/PlaytestActionsBar';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { useMagnifyKey } from '@/hooks/useMagnifyKey';
import type { ScryfallCard } from '@/types';

type SortMode = 'none' | 'cmc' | 'type';

export function Hand() {
  const hand = usePlaytestStore(s => s.zones.hand);
  const moveCard = usePlaytestStore(s => s.moveCard);
  const [sort, setSort] = useState<SortMode>('none');
  const [menu, setMenu] = useState<CardMenuTarget | null>(null);
  const [hoveredFanIndex, setHoveredFanIndex] = useState<number | null>(null);

  const display = sortedHand(hand, sort);

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: 'hand',
    data: { kind: 'pile', zone: 'hand' },
  });

  const playToBattlefield = (handIndex: number) => {
    moveCard({
      source: { kind: 'zone', zone: 'hand', index: handIndex },
      target: { kind: 'battlefield', x: 50, y: 0, arrived: true },
    });
  };

  return (
    <div
      ref={setDropRef}
      className={`border-t border-border/50 bg-card/30 px-4 py-3 flex flex-col transition-shadow ${isOver ? 'ring-2 ring-primary/50 ring-inset' : ''}`}
    >
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[10px] uppercase opacity-60 shrink-0">Hand · {hand.length}</span>
        <PlaytestActionsBar />
        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortMode)}
          className="ml-auto text-[10px] uppercase opacity-60 bg-transparent border border-border/50 rounded px-1.5 py-0.5"
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
              hoveredFanIndex={hoveredFanIndex}
              onHoverChange={(h) => setHoveredFanIndex(prev => h ? i : (prev === i ? null : prev))}
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
  hoveredFanIndex: number | null;
  onHoverChange: (hovered: boolean) => void;
  onClickPlay: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function HandCard({ card, indexInHand, fanIndex, total, hoveredFanIndex, onHoverChange, onClickPlay, onContextMenu }: HandCardProps) {
  const dragId = `hand:${indexInHand}:${card.id}`;
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: dragId,
    data: { source: { kind: 'zone', zone: 'hand', index: indexInHand } },
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `hand-slot:${indexInHand}`,
    data: { kind: 'hand-slot', index: indexInHand },
  });
  const localRef = useRef<HTMLDivElement | null>(null);
  const composedRef = (node: HTMLDivElement | null) => {
    setDragRef(node);
    setDropRef(node);
    localRef.current = node;
  };
  const [hovered, setHovered] = useState(false);
  const magnify = useMagnifyKey();
  const showPreview = magnify && hovered && !isDragging;

  // Deal-in: capture the lastDrawRange at MOUNT to detect cards that were
  // freshly drawn (vs ones that just remounted because their key shifted on
  // a reorder, or arrived from another zone). Only freshly drawn cards run
  // the deal-in keyframe; everything else snaps into place without growing.
  const animations = usePlaytestSettings(s => s.animations);
  const [drawRangeAtMount] = useState(() => usePlaytestStore.getState().lastDrawRange);
  const isFreshlyDrawn =
    animations &&
    indexInHand >= drawRangeAtMount.start &&
    indexInHand < drawRangeAtMount.end;
  const [dealing, setDealing] = useState(isFreshlyDrawn);
  useEffect(() => {
    if (!isFreshlyDrawn) return;
    const t = setTimeout(() => setDealing(false), 380);
    return () => clearTimeout(t);
  }, [isFreshlyDrawn]);

  const overlap = total <= 7 ? 24 : Math.min(24 + (total - 7) * 6, 88);
  const dragTransform = transform ? `translate3d(${transform.x}px, ${transform.y}px, 0) scale(1.05)` : undefined;

  // Hover-fan-spread: when a sibling is hovered, push neighbors away to make
  // room. The hovered card itself lifts and scales up slightly.
  const isHovered = hoveredFanIndex === fanIndex;
  const spreadPx = (() => {
    if (isDragging || dealing || hoveredFanIndex === null || isHovered) return 0;
    const dist = fanIndex - hoveredFanIndex;
    const direction = dist > 0 ? 1 : -1;
    const magnitude = Math.max(0, Math.min(overlap, 18 - (Math.abs(dist) - 1) * 6));
    return direction * magnitude;
  })();

  const restingTransform = (() => {
    const parts: string[] = [];
    if (spreadPx) parts.push(`translateX(${spreadPx}px)`);
    if (isHovered) {
      parts.push('translateY(-14px)');
      parts.push('scale(1.06)');
    }
    return parts.join(' ') || undefined;
  })();

  // While dealing, let the CSS keyframe drive transform — don't set an inline
  // transform (it would override the keyframe). Drag still wins if it starts.
  const inlineTransform = isDragging
    ? dragTransform
    : dealing
      ? undefined
      : restingTransform;
  const style: React.CSSProperties = {
    marginLeft: fanIndex === 0 ? 0 : `-${overlap}px`,
    transform: inlineTransform,
    zIndex: isDragging ? 50 : isHovered ? 30 : fanIndex,
    transition: isDragging || dealing ? 'none' : 'transform 160ms ease-out',
    width: 'clamp(80px, 11vw, 130px)',
    cursor: isDragging ? 'grabbing' : 'pointer',
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div
      ref={composedRef}
      {...attributes}
      {...listeners}
      onClick={onClickPlay}
      onContextMenu={onContextMenu}
      onMouseEnter={() => { setHovered(true); onHoverChange(true); }}
      onMouseLeave={() => { setHovered(false); onHoverChange(false); }}
      title={`Click to play ${card.name} · right-click for more options`}
      className={`relative shrink-0 rounded-[5px] select-none touch-none ${
        isOver && !isDragging ? 'ring-2 ring-primary' : ''
      } ${dealing && !isDragging ? 'animate-deal-in' : ''}`}
      style={style}
    >
      <img
        src={getCardImageUrl(card, 'normal')}
        alt={card.name}
        className="w-full rounded-[5px] shadow-md pointer-events-none"
        loading="lazy"
        draggable={false}
      />
      {showPreview && <MagnifiedPreview card={card} anchorRef={localRef} />}
    </div>
  );
}
