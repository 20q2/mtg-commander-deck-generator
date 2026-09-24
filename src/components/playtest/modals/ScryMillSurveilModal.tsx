import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';
import { X, ArrowUpToLine, ArrowDownToLine, Trash2, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { HoverPreviewImage } from '@/components/playtest/HoverPreviewImage';
import type { ScryfallCard } from '@/types';

type ZoneId = 'revealed' | 'top' | 'other';

export function ScryMillSurveilModal() {
  const modal = usePlaytestStore(s => s.modal);
  const library = usePlaytestStore(s => s.zones.library);
  const closeModal = usePlaytestStore(s => s.closeModal);
  const scryConfirm = usePlaytestStore(s => s.scryConfirm);
  const surveilConfirm = usePlaytestStore(s => s.surveilConfirm);
  const millConfirm = usePlaytestStore(s => s.millConfirm);

  if (!modal || (modal.kind !== 'scry' && modal.kind !== 'mill' && modal.kind !== 'surveil')) return null;

  const n = Math.min(modal.n, library.length);
  const top = library.slice(0, n);

  if (modal.kind === 'mill') {
    return (
      <ModalShell title={`Mill ${n}`} onClose={closeModal}>
        <p className="text-sm text-muted-foreground mb-3">These {n} cards will be moved from library to graveyard:</p>
        <div className="grid grid-cols-7 gap-2 mb-5">
          {top.map((c, i) => <HoverPreviewImage key={`${c.id}-${i}`} card={c} size="normal" className="w-full rounded-[6px] shadow" />)}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={closeModal}>Cancel</Button>
          <Button onClick={() => millConfirm(n)}>Mill {n}</Button>
        </div>
      </ModalShell>
    );
  }

  if (modal.kind === 'scry') {
    return (
      <ArenaSortUI
        revealed={top}
        title={`Scry ${n}`}
        otherLabel="Bottom of Library"
        otherIcon={<ArrowDownToLine className="w-4 h-4" />}
        otherAccent="amber"
        onClose={closeModal}
        onConfirm={(topOrder, otherOrder) => scryConfirm(topOrder, otherOrder)}
      />
    );
  }

  return (
    <ArenaSortUI
      revealed={top}
      title={`Surveil ${n}`}
      otherLabel="Graveyard"
      otherIcon={<Trash2 className="w-4 h-4" />}
      otherAccent="zinc"
      onClose={closeModal}
      onConfirm={(topOrder, otherOrder) => surveilConfirm(topOrder, otherOrder)}
    />
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-background/85 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-2xl max-w-5xl w-full p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

interface ArenaSortProps {
  revealed: ScryfallCard[];
  title: string;
  otherLabel: string;
  otherIcon: React.ReactNode;
  otherAccent: 'amber' | 'zinc';
  onClose: () => void;
  onConfirm: (topOrder: number[], otherOrder: number[]) => void;
}

function ArenaSortUI({ revealed, title, otherLabel, otherIcon, otherAccent, onClose, onConfirm }: ArenaSortProps) {
  // Each zone holds an ordered list of indexes into `revealed`.
  const [revealedOrder, setRevealedOrder] = useState<number[]>(() => revealed.map((_, i) => i));
  const [topOrder, setTopOrder] = useState<number[]>([]);
  const [otherOrder, setOtherOrder] = useState<number[]>([]);
  useEffect(() => {
    setRevealedOrder(revealed.map((_, i) => i));
    setTopOrder([]);
    setOtherOrder([]);
  }, [revealed.length]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const zoneOf = (idx: number): ZoneId => {
    if (topOrder.includes(idx)) return 'top';
    if (otherOrder.includes(idx)) return 'other';
    return 'revealed';
  };
  const orderOf = (z: ZoneId) => z === 'top' ? topOrder : z === 'other' ? otherOrder : revealedOrder;
  const setOrderOf = (z: ZoneId, next: number[]) => {
    if (z === 'top') setTopOrder(next);
    else if (z === 'other') setOtherOrder(next);
    else setRevealedOrder(next);
  };

  const moveCard = (idx: number, destZone: ZoneId, destPos: number) => {
    const fromZone = zoneOf(idx);
    if (fromZone === destZone) {
      const list = [...orderOf(fromZone)];
      const oldPos = list.indexOf(idx);
      list.splice(oldPos, 1);
      const adjusted = destPos > oldPos ? destPos - 1 : destPos;
      list.splice(Math.max(0, Math.min(list.length, adjusted)), 0, idx);
      setOrderOf(fromZone, list);
      return;
    }
    // Cross-zone
    const fromList = orderOf(fromZone).filter(x => x !== idx);
    setOrderOf(fromZone, fromList);
    const toList = [...orderOf(destZone)];
    toList.splice(Math.max(0, Math.min(toList.length, destPos)), 0, idx);
    setOrderOf(destZone, toList);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const idStr = String(active.id);
    if (!idStr.startsWith('card:')) return;
    const idx = Number(idStr.slice(5));
    const overId = String(over.id);

    if (overId.startsWith('slot:')) {
      // slot:<zone>:<position>
      const [, z, posStr] = overId.split(':');
      moveCard(idx, z as ZoneId, Number(posStr));
    } else if (overId.startsWith('zone:')) {
      const z = overId.slice(5) as ZoneId;
      // Drop on zone background → append to end of that zone
      const len = orderOf(z).length - (zoneOf(idx) === z ? 1 : 0);
      moveCard(idx, z, len);
    }
  };

  const allAssigned = revealedOrder.length === 0;
  const otherRing = otherAccent === 'amber' ? 'ring-amber-400/60' : 'ring-zinc-400/60';
  const otherBg = otherAccent === 'amber' ? 'bg-amber-500/5' : 'bg-zinc-500/5';

  return (
    <ModalShell title={title} onClose={onClose}>
      <p className="text-xs text-muted-foreground mb-3">
        Drag cards into the zones below. The <span className="text-emerald-400">Top of Library</span> stack is ordered top-to-bottom — the first card is the next you'll draw. Drag between cards to reorder.
      </p>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        {/* Revealed (unassigned) zone */}
        <Zone
          zoneId="revealed"
          title="Revealed"
          subtitle={revealedOrder.length > 0 ? `${revealedOrder.length} to assign · drag below` : 'All assigned'}
          icon={<Eye className="w-4 h-4" />}
          accentRing="ring-border/60"
          accentBg="bg-background/30"
          order={revealedOrder}
          revealed={revealed}
          showPosition={false}
        />

        <div className="grid grid-cols-2 gap-3 mt-3 mb-5">
          <Zone
            zoneId="top"
            title="Top of Library"
            subtitle="First = next draw"
            icon={<ArrowUpToLine className="w-4 h-4" />}
            accentRing="ring-emerald-400/60"
            accentBg="bg-emerald-500/5"
              order={topOrder}
            revealed={revealed}
            showPosition
          />
          <Zone
            zoneId="other"
            title={otherLabel}
            subtitle=""
            icon={otherIcon}
            accentRing={otherRing}
            accentBg={otherBg}
              order={otherOrder}
            revealed={revealed}
            showPosition={false}
          />
        </div>

      </DndContext>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!allAssigned} onClick={() => onConfirm(topOrder, otherOrder)}>
          {allAssigned ? 'Confirm' : `Assign ${revealedOrder.length} more`}
        </Button>
      </div>
    </ModalShell>
  );
}

const CARD_W = 110;

function Zone({
  zoneId, title, subtitle, icon, accentRing, accentBg, order, revealed, showPosition,
}: {
  zoneId: ZoneId;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accentRing: string;
  accentBg: string;
  order: number[];
  revealed: ScryfallCard[];
  showPosition: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `zone:${zoneId}` });
  const empty = order.length === 0;
  return (
    <div
      ref={setNodeRef}
      className={`rounded-md border ${isOver ? 'border-primary' : 'border-border/60'} ${accentBg} ring-1 ${accentRing} p-2.5 min-h-[180px]`}
    >
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-xs font-semibold">{title}</span>
        {subtitle && <span className="text-[10px] text-muted-foreground/70 ml-auto">{subtitle}</span>}
      </div>
      {empty ? (
        <div className="text-xs text-muted-foreground/50 italic flex items-center justify-center min-h-[140px] border border-dashed border-border/40 rounded">
          Drop here
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {order.map((idx, pos) => (
            <CardSlot
              key={`${revealed[idx].id}-${idx}`}
              zoneId={zoneId}
              position={pos}
              cardIdx={idx}
              card={revealed[idx]}
              showPosition={showPosition}
            />
          ))}
          {/* Trailing slot for "drop at end" */}
          <EndSlot zoneId={zoneId} position={order.length} />
        </div>
      )}
    </div>
  );
}

function CardSlot({
  zoneId, position, cardIdx, card, showPosition,
}: {
  zoneId: ZoneId;
  position: number;
  cardIdx: number;
  card: ScryfallCard;
  showPosition: boolean;
}) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `slot:${zoneId}:${position}` });
  const drag = useDraggable({ id: `card:${cardIdx}` });
  const composed = (node: HTMLDivElement | null) => {
    setDropRef(node);
    drag.setNodeRef(node);
  };
  const dragStyle: React.CSSProperties = drag.transform
    ? {
        transform: `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0) scale(1.04)`,
        zIndex: 100,
      }
    : {};
  return (
    <div
      ref={composed}
      {...drag.attributes}
      {...drag.listeners}
      style={{ width: CARD_W, ...dragStyle }}
      className={`relative rounded-[6px] cursor-grab active:cursor-grabbing touch-none shrink-0 ${drag.isDragging ? 'shadow-2xl ring-2 ring-primary' : ''} ${isOver && !drag.isDragging ? 'ring-2 ring-primary' : ''}`}
    >
      <HoverPreviewImage card={card} size="normal" suppressed={drag.isDragging} className="w-full rounded-[6px] shadow touch-none" />
      {showPosition && (
        <span className="absolute top-1 left-1 text-[10px] font-bold bg-background/85 text-foreground px-1.5 py-0.5 rounded pointer-events-none">
          {position + 1}
        </span>
      )}
    </div>
  );
}

function EndSlot({ zoneId, position }: { zoneId: ZoneId; position: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${zoneId}:${position}` });
  return (
    <div
      ref={setNodeRef}
      style={{ width: CARD_W, height: Math.round(CARD_W * 1.4) }}
      className={`rounded-[6px] border border-dashed shrink-0 ${isOver ? 'border-primary bg-primary/10' : 'border-border/30'}`}
      aria-hidden
    />
  );
}
