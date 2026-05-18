import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, ClipboardPaste, Sparkles, RotateCcw } from 'lucide-react';
import { usePlaytestStore } from '@/store/playtestStore';

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
}

export function BattlefieldContextMenu({ target, onClose }: Props) {
  const openModal = usePlaytestStore(s => s.openModal);
  const pasteClipboard = usePlaytestStore(s => s.pasteClipboard);
  const untapAll = usePlaytestStore(s => s.untapAll);
  const hasClipboard = usePlaytestStore(s => s.clipboard !== null);

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

  const itemBase =
    'w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors';
  const itemEnabled = `${itemBase} hover:bg-accent`;
  const itemDisabled = `${itemBase} opacity-50 cursor-not-allowed`;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-[200] w-[200px] bg-popover/95 backdrop-blur-sm border border-border rounded-md shadow-2xl text-xs py-1.5"
      style={{
        left: adjusted ? adjusted.left : target.screenX,
        top: adjusted ? adjusted.top : target.screenY,
        visibility: adjusted ? 'visible' : 'hidden',
      }}
    >
      <button
        className={itemEnabled}
        onClick={() => { openModal({ kind: 'create' }); onClose(); }}
      >
        <Plus className="w-3.5 h-3.5 text-muted-foreground" />
        <span>Create…</span>
      </button>

      <button
        className={hasClipboard ? itemEnabled : itemDisabled}
        disabled={!hasClipboard}
        onClick={() => {
          if (!hasClipboard) return;
          pasteClipboard({ x: target.bfX, y: target.bfY });
          onClose();
        }}
      >
        <ClipboardPaste className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="flex-1">Paste</span>
        <span className="text-[10px] font-mono text-muted-foreground/60">Ctrl+V</span>
      </button>

      <div className="h-px bg-border/60 my-1" />

      <button
        className={itemEnabled}
        onClick={() => { openModal({ kind: 'tokens' }); onClose(); }}
      >
        <Sparkles className="w-3.5 h-3.5 text-muted-foreground" />
        <span>Spawn token…</span>
      </button>

      <div className="h-px bg-border/60 my-1" />

      <button
        className={itemEnabled}
        onClick={() => { untapAll(); onClose(); }}
      >
        <RotateCcw className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="flex-1">Untap all</span>
        <span className="text-[10px] font-mono text-muted-foreground/60">U</span>
      </button>
    </div>,
    document.body,
  );
}
