import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  Loader2,
  Plus,
  RotateCcw,
  Shapes,
  Sparkles,
  Trash2,
  Type,
} from 'lucide-react';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardsByIds, getFrontFaceTypeLine } from '@/services/scryfall/client';
import type { ScryfallCard } from '@/types';
import type { ZoneKey } from '@/components/playtest/types';

export interface CardMenuTarget {
  // Battlefield card (instanceId), hand card (handIndex), or non-hand zone card (zone + zoneIndex)
  kind: 'battlefield' | 'hand' | 'zone';
  instanceId?: string;
  handIndex?: number;
  zone?: Exclude<ZoneKey, 'hand'>;
  zoneIndex?: number;
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
];

export function PlaytestCardMenu({ target, onClose }: Props) {
  const moveCard = usePlaytestStore(s => s.moveCard);
  const toggleTap = usePlaytestStore(s => s.toggleTap);
  const toggleFaceDown = usePlaytestStore(s => s.toggleFaceDown);
  const adjustCounter = usePlaytestStore(s => s.adjustCounter);
  const addSticker = usePlaytestStore(s => s.addSticker);
  const copyCard = usePlaytestStore(s => s.copyCard);
  const unattach = usePlaytestStore(s => s.unattach);
  const battlefield = usePlaytestStore(s => s.battlefield);
  const commanderNames = usePlaytestStore(s => s.source?.commanderNames ?? []);
  const selectedIds = usePlaytestStore(s => s.selectedIds ?? []);
  const spawnToken = usePlaytestStore(s => s.spawnToken);

  // Tokens this specific card creates, straight off its Scryfall `all_parts`.
  const tokenParts = useMemo(() => {
    const parts = target?.card.all_parts ?? [];
    const seen = new Set<string>();
    return parts.filter(p => {
      if (p.component !== 'token') return false;
      if (p.id === target?.card.id) return false;
      const key = `${p.name.toLowerCase()}|${p.type_line.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [target]);
  const tokenKey = tokenParts.map(p => p.id).join(',');

  // Resolve the token cards up front so the menu can show power/toughness and
  // spawning is instant; clicking still self-heals if the fetch hasn't landed.
  const [tokenCards, setTokenCards] = useState<ScryfallCard[]>([]);
  const [spawnCounts, setSpawnCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    setTokenCards([]);
    setSpawnCounts({});
    if (!tokenKey) return;
    let alive = true;
    getCardsByIds(tokenKey.split(','))
      .then(byId => {
        if (!alive) return;
        setTokenCards([...byId.values()]);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [tokenKey]);

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
  const typeLine = getFrontFaceTypeLine(target.card);

  // If the right-clicked card is part of a multi-selection, every action
  // applies to the whole selection. Right-clicking outside the selection
  // (or with no selection) just acts on the right-clicked card.
  const isBulk = onBattlefield && bfCard
    ? selectedIds.includes(bfCard.instanceId) && selectedIds.length > 1
    : false;
  const targetIds = isBulk ? selectedIds : (bfCard ? [bfCard.instanceId] : []);
  const bulkSuffix = isBulk ? ` (${targetIds.length})` : '';

  // Drive tap/face-down/transform off the right-clicked card's state, then
  // set every target to that opposite state — so a mixed selection ends up
  // uniformly tapped/untapped instead of randomly toggled.
  const applyTap = () => {
    if (!bfCard) return;
    const wantTapped = !bfCard.tapped;
    targetIds.forEach((id) => {
      const c = battlefield.find((b) => b.instanceId === id);
      if (c && c.tapped !== wantTapped) toggleTap(id);
    });
    onClose();
  };
  const applyFaceDown = () => {
    if (!bfCard) return;
    const wantFaceDown = !bfCard.faceDown;
    targetIds.forEach((id) => {
      const c = battlefield.find((b) => b.instanceId === id);
      if (c && c.faceDown !== wantFaceDown) toggleFaceDown(id);
    });
    onClose();
  };
  const applyCopy = () => { targetIds.forEach((id) => copyCard(id)); onClose(); };
  const applyUnattach = () => { targetIds.forEach((id) => unattach(id)); onClose(); };
  const applyCounter = (type: string) => { targetIds.forEach((id) => adjustCounter(id, type, 1)); onClose(); };
  // Stagger stickers down the card so a second one doesn't land on the first.
  const applySticker = () => {
    targetIds.forEach((id) => {
      const c = battlefield.find((b) => b.instanceId === id);
      const n = c?.stickers?.length ?? 0;
      addSticker(id, 'New sticker', { x: 8, y: 8 + n * 20 });
    });
    onClose();
  };

  // Token creation keeps the menu open so "create three 1/1 Soldiers" is just
  // three clicks; the running count is shown on the row.
  const spawnPart = async (part: { id: string; name: string }) => {
    let card = tokenCards.find(c => c.id === part.id);
    if (!card) {
      const byId = await getCardsByIds([part.id]);
      card = byId.get(part.id);
      if (!card) return;
      setTokenCards(prev => (prev.some(c => c.id === card!.id) ? prev : [...prev, card!]));
    }
    // Land it next to the card that made it (battlefield only); findArrivalSlot
    // nudges it to the nearest free spot.
    spawnToken(card, bfCard ? { x: bfCard.x, y: bfCard.y } : undefined);
    setSpawnCounts(prev => ({ ...prev, [part.id]: (prev[part.id] ?? 0) + 1 }));
  };

  const move = (dest: 'hand' | 'graveyard' | 'exile' | 'command' | 'libtop' | 'libbot') => {
    if (onBattlefield) {
      // Bulk-aware battlefield → zone moves.
      targetIds.forEach((id) => {
        const source = { kind: 'battlefield' as const, instanceId: id };
        if (dest === 'libtop') moveCard({ source, target: { kind: 'library', position: 'top' } });
        else if (dest === 'libbot') moveCard({ source, target: { kind: 'library', position: 'bottom' } });
        else moveCard({ source, target: { kind: 'zone', zone: dest } });
      });
    } else if (target.kind === 'zone' && target.zone && typeof target.zoneIndex === 'number') {
      const source = { kind: 'zone' as const, zone: target.zone, index: target.zoneIndex };
      if (dest === 'libtop') moveCard({ source, target: { kind: 'library', position: 'top' } });
      else if (dest === 'libbot') moveCard({ source, target: { kind: 'library', position: 'bottom' } });
      else moveCard({ source, target: { kind: 'zone', zone: dest } });
    } else {
      const source = { kind: 'zone' as const, zone: 'hand' as const, index: target.handIndex! };
      if (dest === 'libtop') moveCard({ source, target: { kind: 'library', position: 'top' } });
      else if (dest === 'libbot') moveCard({ source, target: { kind: 'library', position: 'bottom' } });
      else moveCard({ source, target: { kind: 'zone', zone: dest } });
    }
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
        {isBulk && (
          <div className="mt-1 text-[10px] text-primary/90 font-medium">
            Acting on {targetIds.length} selected
          </div>
        )}
      </div>
      <Sep />

      {/* Battlefield-only: card-state actions first (most common) */}
      {onBattlefield && bfCard && (
        <>
          <Item
            icon={<RotateCcw className={`w-3.5 h-3.5 ${bfCard.tapped ? '' : 'rotate-90'}`} />}
            onClick={applyTap}
            shortcut="T"
          >
            {bfCard.tapped ? 'Untap' : 'Tap'}{bulkSuffix}
          </Item>
          <Item
            icon={bfCard.faceDown ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            onClick={applyFaceDown}
          >
            {bfCard.faceDown ? 'Flip face up' : 'Flip face down'}{bulkSuffix}
          </Item>
          <Item
            icon={<CopyIcon className="w-3.5 h-3.5" />}
            onClick={applyCopy}
          >
            {isBulk ? `Create copies${bulkSuffix}` : 'Create copy'}
          </Item>
          {isAttached && (
            <Item
              icon={<Link2Off className="w-3.5 h-3.5" />}
              onClick={applyUnattach}
            >
              Unattach{bulkSuffix}
            </Item>
          )}
          <Sep />
        </>
      )}

      {/* Tokens this card creates */}
      {tokenParts.length > 0 && (
        <>
          {tokenParts.map(part => {
            const resolved = tokenCards.find(c => c.id === part.id);
            const pt = resolved?.power && resolved?.toughness
              ? `${resolved.power}/${resolved.toughness}`
              : null;
            const made = spawnCounts[part.id] ?? 0;
            return (
              <Item
                key={part.id}
                icon={resolved
                  ? <Shapes className="w-3.5 h-3.5" />
                  : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                onClick={() => { void spawnPart(part); }}
                trailing={
                  <span className="flex items-center gap-1 shrink-0">
                    {pt && <span className="font-mono text-[9px] text-muted-foreground">{pt}</span>}
                    {made > 0 && <span className="font-mono text-[9px] text-primary">×{made}</span>}
                  </span>
                }
              >
                Create {part.name}
              </Item>
            );
          })}
          <Sep />
        </>
      )}

      {/* Move destinations */}
      {target.kind !== 'hand' && (
        <Item icon={<HandIcon className="w-3.5 h-3.5" />} onClick={() => move('hand')}>Move to hand{bulkSuffix}</Item>
      )}
      <Item icon={<ArrowUpToLine className="w-3.5 h-3.5" />}   onClick={() => move('libtop')}>Move to library top{bulkSuffix}</Item>
      <Item icon={<ArrowDownToLine className="w-3.5 h-3.5" />} onClick={() => move('libbot')}>Move to library bottom{bulkSuffix}</Item>
      <Item icon={<Trash2 className="w-3.5 h-3.5" />}          onClick={() => move('graveyard')}>Move to graveyard{bulkSuffix}</Item>
      <Item icon={<Sparkles className="w-3.5 h-3.5" />}        onClick={() => move('exile')}>Move to exile{bulkSuffix}</Item>
      {commanderNames.includes(target.card.name) && (
        <Item icon={<Crown className="w-3.5 h-3.5" />}         onClick={() => move('command')}>Move to command zone{bulkSuffix}</Item>
      )}

      {/* Counters */}
      {onBattlefield && bfCard && (
        <>
          <Sep />
          {COUNTER_TYPES.map(c => (
            <Item
              key={c.key}
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => applyCounter(c.key)}
            >
              Add {c.label} counter{bulkSuffix}
            </Item>
          ))}
          <Sep />
          <Item icon={<Type className="w-3.5 h-3.5" />} onClick={applySticker}>
            Add text sticker{bulkSuffix}
          </Item>
        </>
      )}
    </div>,
    document.body,
  );
}

function Item({
  icon, onClick, shortcut, trailing, children,
}: {
  icon?: React.ReactNode;
  onClick: () => void;
  shortcut?: string;
  trailing?: React.ReactNode;
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
      {trailing}
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
