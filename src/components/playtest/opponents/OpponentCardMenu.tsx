import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpToLine, Hand as HandIcon, Grab, Minus, Plus, RotateCcw, Sparkles, Trash2,
} from 'lucide-react';
import { useOpponentStore } from '@/store/opponentStore';
import { usePlaytestStore } from '@/store/playtestStore';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import type { OpponentPermanent } from '@/components/playtest/opponentTypes';

export interface OpponentMenuTarget {
  opponentId: string;
  permanent: OpponentPermanent;
  x: number;
  y: number;
}

interface Props {
  target: OpponentMenuTarget | null;
  onClose: () => void;
}

const COUNTER_TYPES: Array<{ key: string; label: string }> = [
  { key: '+1/+1', label: '+1/+1' },
  { key: '-1/-1', label: '−1/−1' },
];

/**
 * Right-click menu for a bot's permanent. Mirrors the player's card menu in
 * shape and behaviour — same portal, same edge-clamping, same Esc-to-close — but
 * offers the actions that make sense against someone else's board.
 */
export function OpponentCardMenu({ target, onClose }: Props) {
  const togglePermanentTap = useOpponentStore(s => s.togglePermanentTap);
  const permanentToZone = useOpponentStore(s => s.permanentToZone);
  const adjustPermanentCounter = useOpponentStore(s => s.adjustPermanentCounter);
  const takePermanent = useOpponentStore(s => s.takePermanent);
  const addPermanent = usePlaytestStore(s => s.addPermanent);

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

  // Flip / clamp so the menu stays on screen, same as the player's card menu.
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjusted, setAdjusted] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!target || !menuRef.current) { setAdjusted(null); return; }
    const rect = menuRef.current.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = target.x;
    let top = target.y;
    if (left + rect.width + margin > vw) left = Math.max(margin, target.x - rect.width);
    if (top + rect.height + margin > vh) top = Math.max(margin, target.y - rect.height);
    left = Math.max(margin, Math.min(vw - rect.width - margin, left));
    top = Math.max(margin, Math.min(vh - rect.height - margin, top));
    setAdjusted({ left, top });
  }, [target]);

  if (!target) return null;

  const { opponentId, permanent } = target;
  const typeLine = getFrontFaceTypeLine(permanent.card);

  const act = (fn: () => void) => { fn(); onClose(); };

  const steal = () => {
    const card = takePermanent(opponentId, permanent.instanceId);
    if (card) addPermanent(card, undefined, `You stole ${card.name}`);
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-[200] w-[212px] max-h-[80vh] overflow-y-auto bg-popover border border-border rounded-md shadow-2xl text-xs py-1"
      style={{
        left: adjusted ? adjusted.left : target.x,
        top: adjusted ? adjusted.top : target.y,
        visibility: adjusted ? 'visible' : 'hidden',
      }}
    >
      <div className="px-2.5 pt-1 pb-1.5">
        <div className="text-[12px] font-semibold leading-tight truncate">{permanent.card.name}</div>
        {typeLine && (
          <div className="text-[10px] text-muted-foreground/80 leading-tight truncate">{typeLine}</div>
        )}
      </div>
      <Sep />

      <Item
        icon={<RotateCcw className={`w-3.5 h-3.5 ${permanent.tapped ? '' : 'rotate-90'}`} />}
        onClick={() => act(() => togglePermanentTap(opponentId, permanent.instanceId))}
      >
        {permanent.tapped ? 'Untap' : 'Tap'}
      </Item>
      <Item icon={<Grab className="w-3.5 h-3.5" />} onClick={() => act(steal)}>
        Steal to your battlefield
      </Item>

      <Sep />
      <Item
        icon={<Trash2 className="w-3.5 h-3.5" />}
        onClick={() => act(() => permanentToZone(opponentId, permanent.instanceId, 'graveyard'))}
      >
        Destroy
      </Item>
      <Item
        icon={<Sparkles className="w-3.5 h-3.5" />}
        onClick={() => act(() => permanentToZone(opponentId, permanent.instanceId, 'exile'))}
      >
        Exile
      </Item>
      <Item
        icon={<HandIcon className="w-3.5 h-3.5" />}
        onClick={() => act(() => permanentToZone(opponentId, permanent.instanceId, 'hand'))}
      >
        Return to their hand
      </Item>
      <Item
        icon={<ArrowUpToLine className="w-3.5 h-3.5" />}
        onClick={() => act(() => permanentToZone(opponentId, permanent.instanceId, 'library'))}
      >
        Put on top of their library
      </Item>

      <Sep />
      {COUNTER_TYPES.map(c => (
        <div key={c.key} className="flex items-center gap-1 px-2.5 py-1">
          <span className="flex-1 truncate">{c.label} counter</span>
          <span className="tabular-nums text-muted-foreground/80 w-4 text-right">
            {permanent.counters[c.key] ?? 0}
          </span>
          <button
            onClick={() => adjustPermanentCounter(opponentId, permanent.instanceId, c.key, -1)}
            className="px-1 rounded bg-accent/40 hover:bg-accent"
            aria-label={`Remove ${c.label} counter`}
          >
            <Minus className="w-3 h-3" />
          </button>
          <button
            onClick={() => adjustPermanentCounter(opponentId, permanent.instanceId, c.key, 1)}
            className="px-1 rounded bg-accent/40 hover:bg-accent"
            aria-label={`Add ${c.label} counter`}
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

function Item({
  icon, onClick, children,
}: {
  icon?: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-accent transition-colors"
    >
      <span className="w-4 flex items-center justify-center opacity-70 shrink-0">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
    </button>
  );
}

function Sep() {
  return <div className="h-px bg-border/60 my-1" />;
}
