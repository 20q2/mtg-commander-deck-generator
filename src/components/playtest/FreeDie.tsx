import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDraggable } from '@dnd-kit/core';
import { Dices, Trash2 } from 'lucide-react';
import { usePlaytestStore } from '@/store/playtestStore';
import { COUNTER_COLORS, type CounterColor, type FreeDie as FreeDieType } from '@/components/playtest/types';

interface Props {
  die: FreeDieType;
}

export function FreeDie({ die }: Props) {
  const rollFreeDie = usePlaytestStore(s => s.rollFreeDie);
  const setFreeDieValue = usePlaytestStore(s => s.setFreeDieValue);
  const setFreeDieColor = usePlaytestStore(s => s.setFreeDieColor);
  const removeFreeDie = usePlaytestStore(s => s.removeFreeDie);
  const selected = usePlaytestStore(s => s.selectedDieIds.includes(die.id));
  const followDelta = usePlaytestStore(s => {
    const aid = s.dragActiveId;
    if (!aid) return null;
    if (aid.kind === 'die' && aid.id === die.id) return null;
    if (!s.selectedDieIds.includes(die.id)) return null;
    const activeSelected =
      aid.kind === 'card'    ? s.selectedIds.includes(aid.id)
    : aid.kind === 'counter' ? s.selectedCounterIds.includes(aid.id)
    :                          s.selectedDieIds.includes(aid.id);
    if (!activeSelected) return null;
    return s.dragDelta;
  });

  const colorCfg = COUNTER_COLORS.find(c => c.key === die.color) ?? COUNTER_COLORS[2]; // default to blue

  const drag = useDraggable({
    id: `freedie:${die.id}`,
    data: { source: { kind: 'freedie', id: die.id } },
  });

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const tx = drag.transform?.x ?? followDelta?.x ?? 0;
  const ty = drag.transform?.y ?? followDelta?.y ?? 0;

  // Brief wiggle when the die is rolled (click). Cleared after the keyframe.
  const [rolling, setRolling] = useState(false);
  const wiggle = () => {
    setRolling(true);
    setTimeout(() => setRolling(false), 450);
  };

  const dragMovedRef = useRef(false);
  useEffect(() => {
    if (drag.isDragging) dragMovedRef.current = true;
    else {
      const id = setTimeout(() => { dragMovedRef.current = false; }, 50);
      return () => clearTimeout(id);
    }
  }, [drag.isDragging]);

  return (
    <>
      <div
        ref={drag.setNodeRef}
        {...drag.attributes}
        {...drag.listeners}
        onClick={(e) => {
          e.stopPropagation();
          if (dragMovedRef.current) return;
          if (e.shiftKey) {
            setMenu({ x: e.clientX, y: e.clientY });
            return;
          }
          rollFreeDie(die.id);
          wiggle();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        title={`d${die.sides} = ${die.value} · click to roll · right-click / shift-click for options`}
        className={`absolute select-none touch-none flex flex-col items-center justify-center rounded-md font-bold shadow-lg ring-2 ${colorCfg.chip} ${colorCfg.ring} ${selected ? 'outline outline-2 outline-offset-2 outline-primary' : ''} ${rolling ? 'animate-jiggle' : ''}`}
        style={{
          left: die.x,
          top: die.y,
          transform: `translate3d(${tx}px, ${ty}px, 0)`,
          width: 44,
          height: 44,
          cursor: drag.isDragging ? 'grabbing' : 'grab',
          zIndex: drag.isDragging ? 70 : 60,
        }}
      >
        <span className="text-base leading-none tabular-nums">{rolling ? '–' : die.value}</span>
        <span className="text-[8px] uppercase tracking-wider opacity-80 leading-none mt-0.5">d{die.sides}</span>
      </div>

      {menu && (
        <DieContextMenu
          x={menu.x}
          y={menu.y}
          die={die}
          onClose={() => setMenu(null)}
          onRoll={() => { rollFreeDie(die.id); }}
          onSet={(v) => { setFreeDieValue(die.id, v); }}
          onColor={(c) => { setFreeDieColor(die.id, c); }}
          onDelete={() => { removeFreeDie(die.id); setMenu(null); }}
        />
      )}
    </>
  );
}

function DieContextMenu({
  x, y, die, onClose, onRoll, onSet, onColor, onDelete,
}: {
  x: number;
  y: number;
  die: FreeDieType;
  onClose: () => void;
  onRoll: () => void;
  onSet: (v: number) => void;
  onColor: (c: CounterColor) => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [input, setInput] = useState(String(die.value));

  useEffect(() => { setInput(String(die.value)); }, [die.value]);

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

  const commitSet = () => {
    const n = parseInt(input, 10);
    if (!isNaN(n)) onSet(n);
  };

  return createPortal(
    <div
      ref={ref}
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-[200] w-[200px] bg-popover border border-border rounded-md shadow-2xl text-xs py-2"
      style={{
        left: pos ? pos.left : x,
        top: pos ? pos.top : y,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div className="px-2.5 pb-1.5 text-[10px] uppercase opacity-60">d{die.sides}</div>
      <button
        onClick={onRoll}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-accent transition-colors"
      >
        <Dices className="w-3.5 h-3.5" />
        <span>Roll</span>
      </button>
      <div className="px-2.5 py-1.5">
        <div className="text-[10px] uppercase opacity-60 mb-1">Set value (1–{die.sides})</div>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={1}
            max={die.sides}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { commitSet(); onClose(); } }}
            className="h-6 w-16 px-1.5 text-xs bg-background border border-border rounded outline-none focus:border-primary"
          />
          <button
            onClick={() => { commitSet(); onClose(); }}
            className="h-6 px-2 text-xs rounded border border-border hover:bg-accent"
          >
            Set
          </button>
        </div>
      </div>
      <div className="px-2.5 pb-1.5">
        <div className="text-[10px] uppercase opacity-60 mb-1">Color</div>
        <div className="grid grid-cols-6 gap-1">
          {COUNTER_COLORS.map(c => (
            <button
              key={c.key}
              onClick={() => onColor(c.key)}
              title={c.label}
              className={`w-6 h-6 rounded-full border ${c.chip} ${die.color === c.key ? 'ring-2 ring-foreground' : 'border-transparent hover:ring-2 hover:ring-foreground/40'}`}
            />
          ))}
        </div>
      </div>
      <div className="h-px bg-border/60 my-1" />
      <button
        onClick={onDelete}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-accent text-red-300 hover:text-red-200 transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span>Remove die</span>
      </button>
    </div>,
    document.body,
  );
}
