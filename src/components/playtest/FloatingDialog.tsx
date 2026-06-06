import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GripHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePersistentRect } from '@/hooks/usePersistentRect';
import { useMediaQuery } from '@/hooks/useMediaQuery';

interface Props {
  title: React.ReactNode;
  onClose: () => void;
  /** Initial position; defaults to ~80px from top, horizontally centered for the given width */
  initialPos?: { x: number; y: number };
  /** localStorage key — when provided, the dialog's position persists across opens */
  storageKey?: string;
  /** Pixel width of the dialog. Default 600. */
  width?: number;
  /** Pixel height (only applied when resizable; otherwise content drives height with max-h-[80vh]) */
  height?: number;
  /** Make the dialog resizable via a bottom-right corner handle */
  resizable?: boolean;
  /** localStorage key for the persisted size — used only when resizable */
  sizeStorageKey?: string;
  minWidth?: number;
  minHeight?: number;
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
  storageKey,
  width = 600,
  height,
  resizable = false,
  sizeStorageKey,
  minWidth = 320,
  minHeight = 240,
  headerExtra,
  outerRef,
  outerClassName = '',
  children,
}: Props) {
  const initialHeight =
    height ?? Math.min(typeof window !== 'undefined' ? Math.floor(window.innerHeight * 0.7) : 520, 520);
  const posFallback = () =>
    initialPos ?? {
      x: Math.max(40, (typeof window !== 'undefined' ? window.innerWidth : 1200) / 2 - width / 2),
      y: 80,
    };
  const sizeFallback = () => ({ width, height: initialHeight });

  const [persistedPos, setPersistedPos] = usePersistentRect(
    storageKey ?? '__floating-dialog-pos-unused__',
    posFallback,
  );
  const [localPos, setLocalPos] = useState(posFallback);
  const pos = storageKey ? persistedPos : localPos;
  const setPos = storageKey ? setPersistedPos : setLocalPos;

  const [persistedSize, setPersistedSize] = usePersistentRect(
    sizeStorageKey ?? '__floating-dialog-size-unused__',
    sizeFallback,
  );
  const [localSize, setLocalSize] = useState(sizeFallback);
  const size = sizeStorageKey ? persistedSize : localSize;
  const setSize = sizeStorageKey ? setPersistedSize : setLocalSize;

  const dragOffset = useRef<{ dx: number; dy: number } | null>(null);
  const resizeStart = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

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

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    resizeStart.current = { startX: e.clientX, startY: e.clientY, startW: size.width, startH: size.height };
    const onMove = (ev: PointerEvent) => {
      if (!resizeStart.current) return;
      const { startX, startY, startW, startH } = resizeStart.current;
      const maxW = window.innerWidth - pos.x - 8;
      const maxH = window.innerHeight - pos.y - 8;
      setSize({
        width:  Math.max(minWidth,  Math.min(maxW, startW + (ev.clientX - startX))),
        height: Math.max(minHeight, Math.min(maxH, startH + (ev.clientY - startY))),
      });
    };
    const onUp = () => {
      resizeStart.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // On mobile the dialog behaves as a near-fullscreen sheet — fixed-pixel
  // sizes and persisted positions are ignored so the dialog actually fits
  // the viewport. Header drag and resize handle are also disabled (see below).
  const isMobile = !useMediaQuery('(min-width: 768px)');
  const sizeStyle = isMobile
    ? { left: 8, top: 8, right: 8, bottom: 8, width: 'auto', height: 'auto' } as React.CSSProperties
    : resizable
      ? { left: pos.x, top: pos.y, width: size.width, height: size.height }
      : { left: pos.x, top: pos.y, width };

  return createPortal(
    <div
      ref={outerRef}
      className={`fixed z-[150] bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-2xl flex flex-col ${
        resizable || isMobile ? '' : 'max-w-[90vw] max-h-[80vh]'
      } ${outerClassName}`}
      style={sizeStyle}
    >
      <div
        onPointerDown={isMobile ? undefined : startHeaderDrag}
        className={`flex items-center justify-between gap-3 px-4 py-2 border-b border-border/60 bg-muted/40 rounded-t-lg select-none ${isMobile ? '' : 'cursor-grab active:cursor-grabbing'}`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {!isMobile && <GripHorizontal className="w-4 h-4 opacity-50 shrink-0" />}
          <h2 className="text-sm font-semibold truncate">{title}</h2>
          {headerExtra}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose} title="Close (Esc)">
          <X className="w-4 h-4" />
        </Button>
      </div>
      {children}
      {resizable && !isMobile && (
        <div
          onPointerDown={startResize}
          title="Drag to resize"
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize text-muted-foreground/60 hover:text-foreground"
          style={{ touchAction: 'none' }}
        >
          <svg viewBox="0 0 16 16" className="w-full h-full" fill="currentColor" aria-hidden>
            <circle cx="13" cy="13" r="1" />
            <circle cx="13" cy="9"  r="1" />
            <circle cx="9"  cy="13" r="1" />
          </svg>
        </div>
      )}
    </div>,
    document.body,
  );
}
