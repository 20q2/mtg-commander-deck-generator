import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDraggable } from '@dnd-kit/core';
import { Trash2 } from 'lucide-react';
import { usePlaytestStore } from '@/store/playtestStore';
import { COUNTER_COLORS, type CounterColor, type FreeCounter as FreeCounterType } from '@/components/playtest/types';

interface Props {
  counter: FreeCounterType;
}

export function FreeCounter({ counter }: Props) {
  const adjustFreeCounter = usePlaytestStore(s => s.adjustFreeCounter);
  const removeFreeCounter = usePlaytestStore(s => s.removeFreeCounter);
  const setFreeCounterColor = usePlaytestStore(s => s.setFreeCounterColor);

  const drag = useDraggable({
    id: `freecounter:${counter.id}`,
    data: { source: { kind: 'freecounter', id: counter.id } },
  });

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const tx = drag.transform?.x ?? 0;
  const ty = drag.transform?.y ?? 0;

  // Suppress click after a drag of any meaningful distance
  const dragMovedRef = useRef(false);
  useEffect(() => {
    if (drag.isDragging) dragMovedRef.current = true;
    else {
      const id = setTimeout(() => { dragMovedRef.current = false; }, 50);
      return () => clearTimeout(id);
    }
  }, [drag.isDragging]);

  const colorCfg = COUNTER_COLORS.find(c => c.key === counter.color) ?? COUNTER_COLORS[0];

  return (
    <>
      <div
        ref={drag.setNodeRef}
        {...drag.attributes}
        {...drag.listeners}
        onClick={(e) => {
          e.stopPropagation();
          if (dragMovedRef.current) return;
          adjustFreeCounter(counter.id, 1);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) {
            // shift-right-click opens the color/delete menu
            setMenu({ x: e.clientX, y: e.clientY });
          } else {
            adjustFreeCounter(counter.id, -1);
          }
        }}
        onDoubleClick={(e) => {
          // Double-click also opens the menu (extra discoverability)
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        title={`${counter.value} · left-click +1, right-click −1, shift-right-click for options`}
        className={`absolute select-none touch-none flex items-center justify-center rounded-full font-bold text-base shadow-lg ring-2 ${colorCfg.chip} ${colorCfg.ring}`}
        style={{
          left: counter.x,
          top: counter.y,
          transform: `translate3d(${tx}px, ${ty}px, 0)`,
          width: 44,
          height: 44,
          cursor: drag.isDragging ? 'grabbing' : 'grab',
          // Counters always sit ABOVE battlefield cards (cards are z-10/z-50).
          zIndex: drag.isDragging ? 70 : 60,
        }}
      >
        <span className="tabular-nums leading-none">{counter.value}</span>
      </div>

      {menu && (
        <CounterContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onColor={(c) => { setFreeCounterColor(counter.id, c); setMenu(null); }}
          onDelete={() => { removeFreeCounter(counter.id); setMenu(null); }}
          activeColor={counter.color}
        />
      )}
    </>
  );
}

function CounterContextMenu({
  x, y, onClose, onColor, onDelete, activeColor,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onColor: (c: CounterColor) => void;
  onDelete: () => void;
  activeColor: CounterColor;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const margin = 8;
    let left = x;
    let top = y;
    if (left + r.width + margin > window.innerWidth)  left = Math.max(margin, x - r.width);
    if (top + r.height + margin > window.innerHeight) top = Math.max(margin, y - r.height);
    setPos({ left, top });
  }, [x, y]);

  return createPortal(
    <div
      ref={ref}
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-[200] w-[180px] bg-popover border border-border rounded-md shadow-2xl text-xs py-2"
      style={{
        left: pos ? pos.left : x,
        top: pos ? pos.top : y,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div className="px-2.5 pb-1.5 text-[10px] uppercase opacity-60">Color</div>
      <div className="px-2 grid grid-cols-6 gap-1">
        {COUNTER_COLORS.map(c => (
          <button
            key={c.key}
            onClick={() => onColor(c.key)}
            title={c.label}
            className={`w-6 h-6 rounded-full border ${c.chip} ${activeColor === c.key ? 'ring-2 ring-foreground' : 'border-transparent hover:ring-2 hover:ring-foreground/40'}`}
          />
        ))}
      </div>
      <div className="h-px bg-border/60 my-2" />
      <button
        onClick={onDelete}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-accent text-red-300 hover:text-red-200 transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span>Remove counter</span>
      </button>
    </div>,
    document.body,
  );
}
