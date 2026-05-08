import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Copy as CopyIcon,
  Crown,
  Eye,
  EyeOff,
  Hand as HandIcon,
  Link2Off,
  Plus,
  Repeat,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { usePlaytestStore } from '@/store/playtestStore';
import { isDoubleFacedCard, getFrontFaceTypeLine } from '@/services/scryfall/client';
import type { ScryfallCard } from '@/types';

export interface CardMenuTarget {
  // Either a battlefield card (instanceId set) or a hand card (handIndex set)
  kind: 'battlefield' | 'hand';
  instanceId?: string;
  handIndex?: number;
  card: ScryfallCard;
  x: number;
  y: number;
}

interface Props {
  target: CardMenuTarget | null;
  onClose: () => void;
}

const COUNTER_TYPES: Array<{ key: string; label: string }> = [
  { key: '+1/+1',   label: '+1/+1' },
  { key: '-1/-1',   label: '−1/−1' },
  { key: 'loyalty', label: 'Loyalty' },
  { key: 'charge',  label: 'Charge' },
  { key: 'storage', label: 'Storage' },
];

export function PlaytestCardMenu({ target, onClose }: Props) {
  const moveCard = usePlaytestStore(s => s.moveCard);
  const toggleTap = usePlaytestStore(s => s.toggleTap);
  const toggleFaceDown = usePlaytestStore(s => s.toggleFaceDown);
  const toggleFlipped = usePlaytestStore(s => s.toggleFlipped);
  const adjustCounter = usePlaytestStore(s => s.adjustCounter);
  const copyCard = usePlaytestStore(s => s.copyCard);
  const unattach = usePlaytestStore(s => s.unattach);
  const battlefield = usePlaytestStore(s => s.battlefield);

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

  // Flip / clamp the menu so it stays on screen.
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjusted, setAdjusted] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!target || !menuRef.current) {
      setAdjusted(null);
      return;
    }
    const rect = menuRef.current.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = target.x;
    let top = target.y;
    if (left + rect.width + margin > vw) {
      left = Math.max(margin, target.x - rect.width);
    }
    if (top + rect.height + margin > vh) {
      top = Math.max(margin, target.y - rect.height);
    }
    left = Math.max(margin, Math.min(vw - rect.width - margin, left));
    top = Math.max(margin, Math.min(vh - rect.height - margin, top));
    setAdjusted({ left, top });
  }, [target]);

  if (!target) return null;

  const onBattlefield = target.kind === 'battlefield';
  const bfCard = onBattlefield && target.instanceId ? battlefield.find(b => b.instanceId === target.instanceId) : null;
  const isAttached = !!bfCard?.attachedTo;
  const isDFC = onBattlefield && bfCard ? isDoubleFacedCard(bfCard.card) : false;
  const typeLine = getFrontFaceTypeLine(target.card);

  const move = (dest: 'hand' | 'graveyard' | 'exile' | 'command' | 'libtop' | 'libbot') => {
    const source = onBattlefield && target.instanceId
      ? { kind: 'battlefield' as const, instanceId: target.instanceId }
      : { kind: 'zone' as const, zone: 'hand' as const, index: target.handIndex! };
    if (dest === 'libtop') moveCard({ source, target: { kind: 'library', position: 'top' } });
    else if (dest === 'libbot') moveCard({ source, target: { kind: 'library', position: 'bottom' } });
    else moveCard({ source, target: { kind: 'zone', zone: dest } });
    onClose();
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-[200] w-[220px] max-h-[80vh] overflow-y-auto bg-popover border border-border rounded-md shadow-2xl text-xs py-1"
      style={{
        left: adjusted ? adjusted.left : target.x,
        top: adjusted ? adjusted.top : target.y,
        visibility: adjusted ? 'visible' : 'hidden',
      }}
    >
      {/* Header */}
      <div className="px-2.5 pt-1 pb-1.5">
        <div className="text-[12px] font-semibold leading-tight truncate">{target.card.name}</div>
        {typeLine && (
          <div className="text-[10px] text-muted-foreground/80 leading-tight truncate">{typeLine}</div>
        )}
      </div>
      <Sep />

      {/* Battlefield-only: card-state actions first (most common) */}
      {onBattlefield && bfCard && (
        <>
          <Item
            icon={<RotateCcw className={`w-3.5 h-3.5 ${bfCard.tapped ? '' : 'rotate-90'}`} />}
            onClick={() => { toggleTap(bfCard.instanceId); onClose(); }}
            shortcut="T"
          >
            {bfCard.tapped ? 'Untap' : 'Tap'}
          </Item>
          {isDFC && (
            <Item
              icon={<Repeat className="w-3.5 h-3.5" />}
              onClick={() => { toggleFlipped(bfCard.instanceId); onClose(); }}
            >
              {bfCard.flipped ? 'Show front face' : 'Transform'}
            </Item>
          )}
          <Item
            icon={bfCard.faceDown ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            onClick={() => { toggleFaceDown(bfCard.instanceId); onClose(); }}
          >
            {bfCard.faceDown ? 'Flip face up' : 'Flip face down'}
          </Item>
          <Item
            icon={<CopyIcon className="w-3.5 h-3.5" />}
            onClick={() => { copyCard(bfCard.instanceId); onClose(); }}
          >
            Create copy
          </Item>
          {isAttached && (
            <Item
              icon={<Link2Off className="w-3.5 h-3.5" />}
              onClick={() => { unattach(bfCard.instanceId); onClose(); }}
            >
              Unattach
            </Item>
          )}
          <Sep />
        </>
      )}

      {/* Move destinations */}
      {onBattlefield && (
        <Item icon={<HandIcon className="w-3.5 h-3.5" />} onClick={() => move('hand')}>Move to hand</Item>
      )}
      <Item icon={<ArrowUpToLine className="w-3.5 h-3.5" />}   onClick={() => move('libtop')}>Move to library top</Item>
      <Item icon={<ArrowDownToLine className="w-3.5 h-3.5" />} onClick={() => move('libbot')}>Move to library bottom</Item>
      <Item icon={<Trash2 className="w-3.5 h-3.5" />}          onClick={() => move('graveyard')}>Move to graveyard</Item>
      <Item icon={<Sparkles className="w-3.5 h-3.5" />}        onClick={() => move('exile')}>Move to exile</Item>
      <Item icon={<Crown className="w-3.5 h-3.5" />}           onClick={() => move('command')}>Move to command zone</Item>

      {/* Counters */}
      {onBattlefield && bfCard && (
        <>
          <Sep />
          {COUNTER_TYPES.map(c => (
            <Item
              key={c.key}
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => { adjustCounter(bfCard.instanceId, c.key, 1); onClose(); }}
            >
              Add {c.label} counter
            </Item>
          ))}
        </>
      )}
    </div>,
    document.body,
  );
}

function Item({
  icon, onClick, shortcut, children,
}: {
  icon?: React.ReactNode;
  onClick: () => void;
  shortcut?: string;
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
      {shortcut && (
        <kbd className="ml-2 px-1 py-0.5 rounded border border-border/60 bg-accent/30 font-mono text-[9px] text-muted-foreground shrink-0">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

function Sep() {
  return <div className="h-px bg-border/60 my-1" />;
}
