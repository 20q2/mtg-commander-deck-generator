import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { usePlaytestStore } from '@/store/playtestStore';
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

const COUNTER_TYPES = ['+1/+1', '-1/-1', 'loyalty', 'charge', 'storage'];

export function PlaytestCardMenu({ target, onClose }: Props) {
  const moveCard = usePlaytestStore(s => s.moveCard);
  const toggleTap = usePlaytestStore(s => s.toggleTap);
  const toggleFaceDown = usePlaytestStore(s => s.toggleFaceDown);
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

  if (!target) return null;

  const onBattlefield = target.kind === 'battlefield';
  const bfCard = onBattlefield && target.instanceId ? battlefield.find(b => b.instanceId === target.instanceId) : null;
  const isAttached = !!bfCard?.attachedTo;

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
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-[200] min-w-[180px] bg-popover border border-border rounded-md shadow-2xl text-xs py-1"
      style={{ left: target.x, top: target.y }}
    >
      <div className="px-3 py-1.5 text-[10px] uppercase opacity-50">{target.card.name}</div>
      <Item onClick={() => move('hand')}>→ Hand</Item>
      <Item onClick={() => move('libtop')}>→ Library Top</Item>
      <Item onClick={() => move('libbot')}>→ Library Bottom</Item>
      <Item onClick={() => move('graveyard')}>→ Graveyard</Item>
      <Item onClick={() => move('exile')}>→ Exile</Item>
      <Item onClick={() => move('command')}>→ Command Zone</Item>

      {onBattlefield && bfCard && (
        <>
          <Sep />
          <Item onClick={() => { toggleTap(bfCard.instanceId); onClose(); }}>{bfCard.tapped ? 'Untap' : 'Tap'}</Item>
          <Item onClick={() => { toggleFaceDown(bfCard.instanceId); onClose(); }}>{bfCard.faceDown ? 'Flip face up' : 'Flip face down'}</Item>
          <Item onClick={() => { copyCard(bfCard.instanceId); onClose(); }}>Create copy</Item>
          {isAttached && <Item onClick={() => { unattach(bfCard.instanceId); onClose(); }}>Unattach</Item>}
          <Sep />
          <div className="px-3 py-1.5 text-[10px] uppercase opacity-50">Add counter</div>
          {COUNTER_TYPES.map(t => (
            <Item key={t} onClick={() => { adjustCounter(bfCard.instanceId, t, 1); onClose(); }}>+1 {t}</Item>
          ))}
        </>
      )}
    </div>,
    document.body,
  );
}

function Item({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors">{children}</button>;
}
function Sep() { return <div className="h-px bg-border/60 my-1" />; }
