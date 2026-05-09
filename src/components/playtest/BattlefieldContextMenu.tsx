import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { COUNTER_COLORS, type CounterColor } from '@/components/playtest/types';

export interface BattlefieldMenuTarget {
  /** Viewport coords for placing the menu UI */
  screenX: number;
  screenY: number;
  /** Battlefield-relative coords for placing the new object */
  bfX: number;
  bfY: number;
}

interface Props {
  target: BattlefieldMenuTarget | null;
  onClose: () => void;
  onAddCounter: (color: CounterColor, position: { x: number; y: number }) => void;
}

export function BattlefieldContextMenu({ target, onClose, onAddCounter }: Props) {
  useEffect(() => {
    if (!target) return;
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
  }, [target, onClose]);

  const ref = useRef<HTMLDivElement>(null);
  const [adjusted, setAdjusted] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!target || !ref.current) {
      setAdjusted(null);
      return;
    }
    const rect = ref.current.getBoundingClientRect();
    const margin = 8;
    let left = target.screenX;
    let top = target.screenY;
    if (left + rect.width + margin > window.innerWidth)  left = Math.max(margin, target.screenX - rect.width);
    if (top + rect.height + margin > window.innerHeight) top = Math.max(margin, target.screenY - rect.height);
    left = Math.max(margin, Math.min(window.innerWidth - rect.width - margin, left));
    top = Math.max(margin, Math.min(window.innerHeight - rect.height - margin, top));
    setAdjusted({ left, top });
  }, [target]);

  if (!target) return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-[200] w-[200px] bg-popover border border-border rounded-md shadow-2xl text-xs py-2"
      style={{
        left: adjusted ? adjusted.left : target.screenX,
        top: adjusted ? adjusted.top : target.screenY,
        visibility: adjusted ? 'visible' : 'hidden',
      }}
    >
      <div className="px-2.5 pb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">
        Add counter
      </div>
      <div className="px-2 grid grid-cols-6 gap-1">
        {COUNTER_COLORS.map((c) => (
          <button
            key={c.key}
            onClick={() => {
              onAddCounter(c.key, { x: target.bfX, y: target.bfY });
              onClose();
            }}
            title={c.label}
            className={`w-6 h-6 rounded-full ${c.chip} hover:ring-2 hover:ring-foreground/40`}
          />
        ))}
      </div>
    </div>,
    document.body,
  );
}
