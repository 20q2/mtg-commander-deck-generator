import { useEffect, useState } from 'react';
import { Sparkles, BookOpen, Trash2, Crown } from 'lucide-react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardImageUrl } from '@/services/scryfall/client';
import type { ZoneKey } from '@/components/playtest/types';

interface PileSpec {
  zone: Exclude<ZoneKey, 'hand'>;
  label: string;
  Icon: typeof Crown;
  bgClass: string;
  faceUp: boolean; // library renders face-down
}

const PILES: PileSpec[] = [
  { zone: 'command',   label: 'Command',   Icon: Crown,    bgClass: 'bg-purple-500/10 border-purple-400/30',  faceUp: true },
  { zone: 'library',   label: 'Library',   Icon: BookOpen, bgClass: 'bg-blue-500/10 border-blue-400/30',      faceUp: false },
  { zone: 'graveyard', label: 'Graveyard', Icon: Trash2,   bgClass: 'bg-zinc-500/15 border-zinc-400/30',      faceUp: true },
  { zone: 'exile',     label: 'Exile',     Icon: Sparkles, bgClass: 'bg-amber-500/10 border-amber-400/30',    faceUp: true },
];

export function PlaytestSidebar() {
  return (
    <aside className="w-36 border-r border-border/50 p-3 flex flex-col gap-3 overflow-y-auto bg-card/30">
      {PILES.map(p => <Pile key={p.zone} spec={p} />)}
    </aside>
  );
}

function Pile({ spec }: { spec: PileSpec }) {
  const cards = usePlaytestStore(s => s.zones[spec.zone]);
  const openModal = usePlaytestStore(s => s.openModal);
  const moveCard = usePlaytestStore(s => s.moveCard);
  const draw = usePlaytestStore(s => s.draw);
  const shuffleTick = usePlaytestStore(s => s.shuffleTick);
  const [jiggle, setJiggle] = useState(false);
  useEffect(() => {
    if (spec.zone !== 'library' || shuffleTick === 0) return;
    setJiggle(true);
    const t = setTimeout(() => setJiggle(false), 500);
    return () => clearTimeout(t);
  }, [shuffleTick, spec.zone]);
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `pile:${spec.zone}`,
    data: { kind: 'pile', zone: spec.zone },
  });
  const drag = useDraggable({
    id: `pile-top:${spec.zone}`,
    data: { source: { kind: 'zone', zone: spec.zone, index: 0 } },
    disabled: cards.length === 0,
  });
  const top = cards[0];
  const Icon = spec.Icon;

  const onClickPile = () => {
    if (cards.length === 0) return;
    if (spec.zone === 'library') {
      draw(1);
      return;
    }
    moveCard({
      source: { kind: 'zone', zone: spec.zone, index: 0 },
      target: { kind: 'battlefield', x: 50, y: 0, arrived: true },
    });
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (cards.length === 0 && spec.zone !== 'library') return;
    openModal({ kind: 'zoneViewer', zone: spec.zone });
  };

  const interactive = cards.length > 0;
  const titleText = !interactive
    ? spec.label
    : spec.zone === 'library'
      ? `Click to draw a card · right-click to search ${spec.label.toLowerCase()}`
      : `Click to play top card · right-click to view ${spec.label.toLowerCase()}`;

  return (
    <div
      ref={setDropRef}
      onClick={onClickPile}
      onContextMenu={onContextMenu}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={titleText}
      className={`relative rounded-lg border ${spec.bgClass} p-2 text-center transition-all select-none ${interactive ? 'hover:brightness-125 cursor-pointer' : 'opacity-60'} ${isOver ? 'ring-2 ring-primary' : ''}`}
    >
      <div className="aspect-[5/7] w-full rounded-[5px] overflow-hidden bg-black/20 flex items-center justify-center relative">
        {cards.length > 0 ? (
          <div
            ref={drag.setNodeRef}
            {...drag.attributes}
            {...drag.listeners}
            className={`absolute inset-0 cursor-grab ${drag.isDragging ? 'opacity-0' : ''} ${jiggle ? 'animate-jiggle' : ''}`}
          >
            <img
              src={spec.faceUp ? getCardImageUrl(top, 'small') : `${import.meta.env.BASE_URL}card-back.png`}
              alt={spec.faceUp ? top.name : spec.label}
              className="w-full h-full object-cover pointer-events-none"
              draggable={false}
            />
          </div>
        ) : (
          <Icon className="w-6 h-6 opacity-60" />
        )}
      </div>
      <div className="mt-1 text-[10px] flex items-center justify-between">
        <span>{spec.label}</span>
        <span className="font-bold">{cards.length}</span>
      </div>
    </div>
  );
}
