import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The frame every right-click menu in the playtest shares: a portal to body, a
 * position that flips and clamps so the menu can't open off-screen, and
 * dismissal on Esc or a click anywhere else.
 *
 * It is rendered hidden for one frame — the clamp needs the menu's measured
 * size, and a menu that paints at the raw cursor position first visibly jumps.
 */
export function ContextMenuShell({
  x, y, onClose, width = 212, children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
}) {
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

  const ref = useRef<HTMLDivElement>(null);
  const [adjusted, setAdjusted] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!ref.current) { setAdjusted(null); return; }
    const rect = ref.current.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width + margin > vw) left = Math.max(margin, x - rect.width);
    if (top + rect.height + margin > vh) top = Math.max(margin, y - rect.height);
    left = Math.max(margin, Math.min(vw - rect.width - margin, left));
    top = Math.max(margin, Math.min(vh - rect.height - margin, top));
    setAdjusted({ left, top });
  }, [x, y]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[200] max-h-[80vh] overflow-y-auto bg-popover border border-border rounded-md shadow-2xl text-xs py-1"
      style={{
        width,
        left: adjusted ? adjusted.left : x,
        top: adjusted ? adjusted.top : y,
        visibility: adjusted ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  icon, onClick, disabled, children,
}: {
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-accent transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
    >
      <span className="w-4 flex items-center justify-center opacity-70 shrink-0">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
    </button>
  );
}

export function MenuSep() {
  return <div className="h-px bg-border/60 my-1" />;
}

export function MenuHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pt-1 pb-1.5 text-[12px] font-semibold leading-tight truncate">
      {children}
    </div>
  );
}
