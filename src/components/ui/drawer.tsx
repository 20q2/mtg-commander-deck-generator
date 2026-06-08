import { useEffect, useCallback, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type DrawerPosition = 'bottom' | 'left' | 'right';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  position: DrawerPosition;
  onPositionChange: (p: DrawerPosition) => void;
  /** Optional override for the default size (vh for bottom, vw for sides). */
  defaultSizePercent?: number;
}

const MIN_BOTTOM_HEIGHT = 200;
const MIN_SIDE_WIDTH = 380;
const DEFAULT_BOTTOM_VH = 55;
const DEFAULT_SIDE_VW = 38;
const MOBILE_BREAKPOINT = 640;
const MOBILE_SIDE_VW = 92;

function computeSize(position: DrawerPosition, defaultSizePercent: number | undefined, isMobile: boolean) {
  if (position === 'bottom') {
    const pct = defaultSizePercent ?? DEFAULT_BOTTOM_VH;
    return Math.max(MIN_BOTTOM_HEIGHT, Math.round(window.innerHeight * pct / 100));
  }
  if (isMobile) {
    return Math.round(window.innerWidth * MOBILE_SIDE_VW / 100);
  }
  const pct = defaultSizePercent ?? DEFAULT_SIDE_VW;
  return Math.max(MIN_SIDE_WIDTH, Math.round(window.innerWidth * pct / 100));
}

export function Drawer({ open, onClose, children, position, defaultSizePercent }: DrawerProps) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT);
  const [size, setSize] = useState(() => computeSize(position, defaultSizePercent, window.innerWidth < MOBILE_BREAKPOINT));
  const dragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(0);

  // Track viewport crossing the mobile breakpoint so the drawer width stays sensible
  // when the user rotates / resizes the window.
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setSize(computeSize(position, defaultSizePercent, isMobile));
  }, [position, defaultSizePercent, isMobile]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, handleKeyDown]);

  // Drag-to-resize is desktop-only — on mobile the drawer takes ~full width and
  // there's nothing useful to drag toward.
  const canResize = !isMobile;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!canResize) return;
    dragging.current = true;
    startPos.current = position === 'bottom' ? e.clientY : e.clientX;
    startSize.current = size;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [size, position, canResize]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const isBottom = position === 'bottom';
    const cursor = isBottom ? e.clientY : e.clientX;
    const maxSize = isBottom
      ? Math.round(window.innerHeight * 0.92)
      : Math.round(window.innerWidth * 0.75);
    const minSize = isBottom ? MIN_BOTTOM_HEIGHT : MIN_SIDE_WIDTH;
    let delta: number;
    if (isBottom) delta = startPos.current - cursor;
    else if (position === 'left') delta = cursor - startPos.current;
    else delta = startPos.current - cursor;
    setSize(Math.max(minSize, Math.min(maxSize, startSize.current + delta)));
  }, [position]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const isBottom = position === 'bottom';
  const isLeft = position === 'left';
  const isRight = position === 'right';
  const isSide = isLeft || isRight;

  const panelClasses = [
    'fixed z-50 flex bg-[hsl(220_13%_18%)] shadow-[0_0_40px_rgba(0,0,0,0.5)] transition-transform duration-300 ease-out',
    isBottom && `bottom-0 left-0 right-0 flex-col border-t-2 border-border rounded-t-2xl ${open ? 'translate-y-0' : 'translate-y-full'}`,
    isLeft && `top-0 left-0 bottom-0 flex-row border-r-2 border-border rounded-r-2xl ${open ? 'translate-x-0' : '-translate-x-full'}`,
    isRight && `top-0 right-0 bottom-0 flex-row-reverse border-l-2 border-border rounded-l-2xl ${open ? 'translate-x-0' : 'translate-x-full'}`,
  ].filter(Boolean).join(' ');

  const style = isBottom
    ? { height: `${size}px` }
    : { width: `${size}px` };

  // Bottom drawers keep a visible grab bar (touch + desktop UX is the same).
  // Side drawers get a slim invisible resize strip on the open edge — no visible
  // "drag me" affordance, which previously made the panel feel scrappy.
  return createPortal(
    <div className={panelClasses} style={style}>
      {isBottom ? (
        <div
          className="flex items-center justify-center shrink-0 select-none touch-none cursor-ns-resize py-1.5"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>
      ) : canResize ? (
        <div
          className="shrink-0 w-1.5 select-none touch-none cursor-ew-resize hover:bg-muted-foreground/20 transition-colors"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          aria-hidden
        />
      ) : null}
      <div className={`flex-1 overflow-y-auto overflow-x-hidden ${isSide ? 'flex flex-col' : ''}`}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
