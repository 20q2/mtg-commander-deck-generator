import { useEffect, useState } from 'react';
import { Plus, Minus, Sparkles, BookOpen, Trash2, Crown } from 'lucide-react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { Button } from '@/components/ui/button';
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
  const life = usePlaytestStore(s => s.life);
  const adjustLife = usePlaytestStore(s => s.adjustLife);
  const setLife = usePlaytestStore(s => s.setLife);

  return (
    <aside className="w-36 border-r border-border/50 p-3 flex flex-col gap-3 overflow-y-auto bg-card/30">
      <LifePanel life={life} onAdjust={adjustLife} onSet={setLife} />
      {PILES.map(p => <Pile key={p.zone} spec={p} />)}
    </aside>
  );
}

function LifePanel({ life, onAdjust, onSet }: { life: number; onAdjust: (d: number) => void; onSet: (n: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(life));
  return (
    <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-2 text-center">
      <div className="text-[9px] uppercase opacity-60 tracking-wide">Life</div>
      {editing ? (
        <input
          autoFocus
          type="number"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { setEditing(false); const n = parseInt(draft, 10); if (!isNaN(n)) onSet(n); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="w-full text-2xl font-bold bg-transparent text-center outline-none"
        />
      ) : (
        <button className="block w-full text-2xl font-bold" onClick={() => { setDraft(String(life)); setEditing(true); }}>
          {life}
        </button>
      )}
      <div className="grid grid-cols-2 gap-1 mt-1">
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onAdjust(-1)}><Minus className="w-3 h-3" />1</Button>
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onAdjust(1)}><Plus className="w-3 h-3" />1</Button>
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onAdjust(-5)}><Minus className="w-3 h-3" />5</Button>
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onAdjust(5)}><Plus className="w-3 h-3" />5</Button>
      </div>
    </div>
  );
}

function Pile({ spec }: { spec: PileSpec }) {
  const cards = usePlaytestStore(s => s.zones[spec.zone]);
  const openModal = usePlaytestStore(s => s.openModal);
  const moveCard = usePlaytestStore(s => s.moveCard);
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

  const playTop = () => {
    if (cards.length === 0) return;
    moveCard({
      source: { kind: 'zone', zone: spec.zone, index: 0 },
      target: { kind: 'battlefield', x: 50, y: 0, arrived: true },
    });
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openModal({ kind: 'zoneViewer', zone: spec.zone });
  };

  return (
    <div
      ref={setDropRef}
      onClick={cards.length === 0 ? () => openModal({ kind: 'zoneViewer', zone: spec.zone }) : playTop}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
      title={cards.length > 0 ? `Click to play top card · right-click to view ${spec.label.toLowerCase()}` : `View ${spec.label.toLowerCase()}`}
      className={`relative rounded-lg border ${spec.bgClass} p-2 text-center hover:brightness-125 transition-all cursor-pointer select-none ${isOver ? 'ring-2 ring-primary' : ''}`}
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
