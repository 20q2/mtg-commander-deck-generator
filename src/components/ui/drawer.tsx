import { useEffect, useCallback, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type DrawerPosition = 'bottom' | 'left' | 'right';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  position: DrawerPosition;
  onPositionChange: (p: DrawerPosition) => void;
}

const MIN_SIZE = 120;
const DEFAULT_BOTTOM_VH = 55;
const DEFAULT_SIDE_VW = 38;

export function Drawer({ open, onClose, children, position }: DrawerProps) {
  const [size, setSize] = useState(() =>
    position === 'bottom'
      ? Math.round(window.innerHeight * DEFAULT_BOTTOM_VH / 100)
      : Math.round(window.innerWidth * DEFAULT_SIDE_VW / 100)
  );
  const dragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(0);

  // Reset size when position changes
  useEffect(() => {
    setSize(
      position === 'bottom'
        ? Math.round(window.innerHeight * DEFAULT_BOTTOM_VH / 100)
        : Math.round(window.innerWidth * DEFAULT_SIDE_VW / 100)
    );
  }, [position]);

  // Close on Escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, handleKeyDown]);

  // Drag-to-resize
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    startPos.current = position === 'bottom' ? e.clientY : e.clientX;
    startSize.current = size;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [size, position]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const isBottom = position === 'bottom';
    const cursor = isBottom ? e.clientY : e.clientX;
    const maxSize = isBottom
      ? Math.round(window.innerHeight * 0.92)
      : Math.round(window.innerWidth * 0.75);
    let delta: number;
    if (isBottom) delta = startPos.current - cursor; // drag up = bigger
    else if (position === 'left') delta = cursor - startPos.current; // drag right = bigger
    else delta = startPos.current - cursor; // right: drag left = bigger
    setSize(Math.max(MIN_SIZE, Math.min(maxSize, startSize.current + delta)));
  }, [position]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    if (size < MIN_SIZE + 20) onClose();
  }, [size, onClose]);

  const isBottom = position === 'bottom';
  const isLeft = position === 'left';
  const isRight = position === 'right';
  const isSide = isLeft || isRight;

  // Position classes
  const panelClasses = [
    'fixed z-50 flex bg-card shadow-2xl transition-transform duration-300 ease-out',
    isBottom && `bottom-0 left-0 right-0 flex-col border-t border-border/50 rounded-t-2xl ${open ? 'translate-y-0' : 'translate-y-full'}`,
    isLeft && `top-0 left-0 bottom-0 flex-row border-r border-border/50 rounded-r-2xl ${open ? 'translate-x-0' : '-translate-x-full'}`,
    isRight && `top-0 right-0 bottom-0 flex-row-reverse border-l border-border/50 rounded-l-2xl ${open ? 'translate-x-0' : 'translate-x-full'}`,
  ].filter(Boolean).join(' ');

  const style = isBottom
    ? { height: `${size}px` }
    : { width: `${size}px` };

  const handleCursor = isBottom ? 'cursor-ns-resize' : 'cursor-ew-resize';
  const handleBar = isBottom
    ? <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
    : <div className="h-10 w-1 rounded-full bg-muted-foreground/30" />;

  return createPortal(
    <div className={panelClasses} style={style}>
      {/* Drag handle */}
      <div
        className={`flex items-center justify-center shrink-0 select-none touch-none ${handleCursor} ${
          isBottom ? 'py-1.5' : 'px-1.5'
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {handleBar}
      </div>
      {/* Content */}
      <div className={`flex-1 overflow-y-auto overflow-x-hidden ${isSide ? 'flex flex-col' : ''}`}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
