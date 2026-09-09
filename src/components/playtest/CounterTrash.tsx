import { useDndContext, useDroppable } from '@dnd-kit/core';
import { Trash2 } from 'lucide-react';
import { usePlaytestStore } from '@/store/playtestStore';

/** The loose things this corner will take: the objects you move around by hand. */
const TRASHABLE = new Set(['freecounter', 'freedie']);

/**
 * A bin in the corner of the battlefield, there only while you're dragging a
 * loose counter or die. Drop one in and it's gone.
 *
 * Reads the drag off the dnd context rather than taking props: the drop routing
 * lives in PlaytestPage, and this only needs to know whether to show itself.
 */
export function CounterTrash() {
  const { active } = useDndContext();
  const source = active?.data.current?.source as { kind?: string } | undefined;
  const dragging = !!source?.kind && TRASHABLE.has(source.kind);

  // `floating` is how PlaytestPage's collision detection resolves overlap: the
  // battlefield droppable covers this corner too, and without the flag it would
  // win the drop and quietly reposition the counter instead of binning it.
  //
  // Disabled while hidden, and that matters more than it looks: collision
  // detection is rect maths, so an invisible-but-registered trash would still
  // out-rank the battlefield for a card dragged into this corner, and the card
  // would land on a branch that doesn't move it.
  const { setNodeRef, isOver } = useDroppable({
    id: 'counter-trash',
    data: { kind: 'counterTrash', floating: true },
    disabled: !dragging,
  });

  // How many will go — the selection when the dragged one is part of it, else one.
  const count = usePlaytestStore(s => {
    if (!source?.kind) return 1;
    const id = (active?.data.current?.source as { id?: string } | undefined)?.id;
    const selected = source.kind === 'freecounter' ? s.selectedCounterIds : s.selectedDieIds;
    return id && selected.includes(id) ? selected.length : 1;
  });

  return (
    <div
      ref={setNodeRef}
      aria-hidden={!dragging}
      className={`absolute top-2 left-2 z-30 w-[52px] h-[52px] rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-0.5 transition-all duration-150 ${
        dragging ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none'
      } ${
        isOver
          ? 'border-rose-400 bg-rose-500/25 text-rose-200 shadow-[0_0_18px_rgba(244,63,94,0.45)]'
          : 'border-border/70 bg-background/70 text-muted-foreground backdrop-blur-sm'
      }`}
    >
      <Trash2 className={`transition-transform duration-150 ${isOver ? 'w-6 h-6' : 'w-5 h-5'}`} />
      {count > 1 && <span className="text-[9px] font-bold tabular-nums leading-none">×{count}</span>}
    </div>
  );
}
