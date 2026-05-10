import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GripHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  title: React.ReactNode;
  onClose: () => void;
  /** Initial position; defaults to ~80px from top, horizontally centered for the given width */
  initialPos?: { x: number; y: number };
  /** Pixel width of the dialog (max-w-[90vw] still applies). Default 600. */
  width?: number;
  /** Extra header content rendered after the title */
  headerExtra?: React.ReactNode;
  /** Optional ref attached to the outer dialog div — useful for adding a useDroppable overlay */
  outerRef?: (node: HTMLDivElement | null) => void;
  /** Optional extra class on the outer dialog div */
  outerClassName?: string;
  children: React.ReactNode;
}

export function FloatingDialog({
  title,
  onClose,
  initialPos,
  width = 600,
  headerExtra,
  outerRef,
  outerClassName = '',
  children,
}: Props) {
  const [pos, setPos] = useState(() =>
    initialPos ?? {
      x: Math.max(40, (typeof window !== 'undefined' ? window.innerWidth : 1200) / 2 - width / 2),
      y: 80,
    },
  );
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const startHeaderDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragOffset.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    const onMove = (ev: PointerEvent) => {
      if (!dragOffset.current) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      setPos({
        x: Math.max(-40, Math.min(w - 200, ev.clientX - dragOffset.current.dx)),
        y: Math.max(0, Math.min(h - 60, ev.clientY - dragOffset.current.dy)),
      });
    };
    const onUp = () => {
      dragOffset.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return createPortal(
    <div
      ref={outerRef}
      className={`fixed z-[150] bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-2xl max-w-[90vw] max-h-[80vh] flex flex-col ${outerClassName}`}
      style={{ left: pos.x, top: pos.y, width }}
    >
      <div
        onPointerDown={startHeaderDrag}
        className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border/60 cursor-grab active:cursor-grabbing select-none"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <GripHorizontal className="w-4 h-4 opacity-50 shrink-0" />
          <h2 className="text-sm font-semibold truncate">{title}</h2>
          {headerExtra}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose} title="Close (Esc)">
          <X className="w-4 h-4" />
        </Button>
      </div>
      {children}
    </div>,
    document.body,
  );
}
