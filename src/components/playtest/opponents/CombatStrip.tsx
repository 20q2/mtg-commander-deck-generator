import { useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Shield, X } from 'lucide-react';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { useOpponentStore } from '@/store/opponentStore';
import { getCardImageUrl } from '@/services/scryfall/client';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { useMagnifyKey } from '@/hooks/useMagnifyKey';
import type { BattlefieldCard } from '@/components/playtest/types';
import type { ScryfallCard } from '@/types';

const ATTACKER_W = 34;

/**
 * The contested space between you and one opponent. Used in both directions:
 * your attackers slide up into it, theirs slide down into it, and blockers are
 * always dragged into the same strip to meet them.
 *
 * Four states. Idle is a hairline so a seat with nothing happening costs
 * nothing. Armed is a drop target. Declared and resolving both show cards.
 */
export function CombatStrip({ opponentId }: { opponentId: string }) {
  const declaration  = useOpponentStore(s => s.declaration);
  const playerCombat = useOpponentStore(s => s.playerCombat);
  const combat       = useOpponentStore(s => s.combat);
  const dragActiveId = usePlaytestStore(s => s.dragActiveId);

  const declared = declaration?.[opponentId] ?? [];
  const mine     = playerCombat?.perOpponent[opponentId];
  const theirs   = combat?.opponentId === opponentId ? combat : null;

  const { setNodeRef, isOver } = useDroppable({
    id: `strip:${opponentId}`,
    data: { kind: 'combatStrip', opponentId },
  });

  // Armed while you're dragging a card — counters and dice have no business
  // in combat — and only if this seat isn't already mid-resolution.
  const armed = dragActiveId?.kind === 'card' && !mine;
  const busy  = declared.length > 0 || !!mine || !!theirs;

  if (!armed && !busy) return <div ref={setNodeRef} className="h-1" />;

  return (
    <div
      ref={setNodeRef}
      className={`mt-1 rounded-md border p-1 min-h-[30px] flex items-center gap-1 flex-wrap transition-colors ${
        isOver   ? 'border-violet-300 bg-violet-500/25'
        : theirs ? 'border-rose-400/50 bg-rose-500/10'
        : busy   ? 'border-violet-400/60 bg-violet-500/12'
        :          'border-dashed border-violet-400/60 bg-violet-500/10'
      }`}
    >
      {theirs                 ? <IncomingAttack opponentId={opponentId} />
      : mine                  ? <OutgoingResolve opponentId={opponentId} />
      : declared.length > 0   ? <Declared instanceIds={declared} />
      : (
        <span className="w-full text-center text-[8px] uppercase tracking-wider text-violet-300/80 select-none">
          Drop to attack
        </span>
      )}
    </div>
  );
}

/** Your declared attackers. Click one to pull it back out. */
function Declared({ instanceIds }: { instanceIds: string[] }) {
  const battlefield = usePlaytestStore(s => s.battlefield);
  const undeclare = useOpponentStore(s => s.undeclareAttacker);
  return (
    <>
      {instanceIds.map(id => {
        const card = battlefield.find(b => b.instanceId === id);
        if (!card) return null;
        return (
          <button
            key={id}
            onClick={() => undeclare(id)}
            title={`${card.card.name} is attacking · click to pull it back`}
            className="relative shrink-0 group"
            style={{ width: ATTACKER_W }}
          >
            <img
              src={getCardImageUrl(card.card, 'small')}
              alt={card.card.name}
              draggable={false}
              className="w-full rounded-[2px] rotate-90 shadow"
            />
            <span className="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/60 rounded-[2px]">
              <X className="w-3 h-3 text-red-300" />
            </span>
          </button>
        );
      })}
    </>
  );
}

/** Confirmed attack: your attackers, the bot's blocks, and the Resolve button. */
function OutgoingResolve({ opponentId }: { opponentId: string }) {
  const playerCombat = useOpponentStore(s => s.playerCombat);
  const resolve = useOpponentStore(s => s.resolvePlayerCombat);
  const battlefield = usePlaytestStore(s => s.battlefield);
  const opponent = useOpponentStore(s => s.opponents.find(o => o.id === opponentId));
  const side = playerCombat?.perOpponent[opponentId];
  if (!side || !opponent) return null;

  return (
    <>
      {side.attackers.map(id => {
        const card = battlefield.find(b => b.instanceId === id);
        if (!card) return null;
        const blockerIds = side.blocks[id] ?? [];
        return (
          <div key={id} className="shrink-0 flex flex-col items-center gap-0.5">
            <img
              src={getCardImageUrl(card.card, 'small')}
              alt={card.card.name}
              title={card.card.name}
              draggable={false}
              className={`rounded-[2px] rotate-90 shadow ${
                blockerIds.length === 0 ? 'ring-1 ring-emerald-400/70' : ''
              }`}
              style={{ width: ATTACKER_W }}
            />
            <div className="flex gap-0.5 min-h-[14px]">
              {blockerIds.length === 0 ? (
                <span className="text-[7px] text-emerald-300 uppercase tracking-wide">through</span>
              ) : blockerIds.map(bid => {
                const p = opponent.battlefield.find(x => x.instanceId === bid);
                return p ? (
                  <img
                    key={bid}
                    src={getCardImageUrl(p.card, 'small')}
                    alt={p.card.name}
                    title={`${p.card.name} blocks`}
                    draggable={false}
                    className="rounded-[2px]"
                    style={{ width: 14 }}
                  />
                ) : null;
              })}
            </div>
          </div>
        );
      })}
      <button
        onClick={resolve}
        className="ml-auto shrink-0 px-2 h-6 rounded bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-bold"
      >
        Resolve
      </button>
    </>
  );
}

/** Their attack. Same strip, roles flipped — drag your creatures in to block. */
function IncomingAttack({ opponentId }: { opponentId: string }) {
  const combat = useOpponentStore(s => s.combat);
  const resolveCombat = useOpponentStore(s => s.resolveCombat);
  const removeBlocker = useOpponentStore(s => s.removeBlocker);
  const battlefield = usePlaytestStore(s => s.battlefield);
  if (!combat || combat.opponentId !== opponentId) return null;

  const unblocked = combat.attackers.filter(a => (combat.blocks[a.instanceId] ?? []).length === 0);
  const incoming = unblocked.reduce((sum, a) => sum + a.power, 0);

  return (
    <>
      {combat.attackers.map(a => (
        <AttackerSlot
          key={a.instanceId}
          attackerId={a.instanceId}
          card={a.card}
          label={`${a.power}/${a.toughness}`}
          blockerIds={combat.blocks[a.instanceId] ?? []}
          onRemoveBlocker={id => removeBlocker(a.instanceId, id)}
          battlefield={battlefield}
        />
      ))}
      <button
        onClick={resolveCombat}
        className="ml-auto shrink-0 px-2 h-6 rounded bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold"
      >
        {incoming > 0 ? `Take ${incoming}` : 'Resolve'}
      </button>
    </>
  );
}

/** One incoming attacker with its own blocker drop target. */
function AttackerSlot({
  attackerId, card, label, blockerIds, onRemoveBlocker, battlefield,
}: {
  attackerId: string;
  card: ScryfallCard;
  label: string;
  blockerIds: string[];
  onRemoveBlocker: (instanceId: string) => void;
  battlefield: BattlefieldCard[];
}) {
  const previewMode = usePlaytestSettings(s => s.opponentPreview);
  const ctrlHeld = useMagnifyKey();
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const { setNodeRef, isOver } = useDroppable({
    id: `combat:${attackerId}`,
    data: { kind: 'combatAttacker', attackerId },
  });
  const showPreview =
    previewMode === 'off' ? false : previewMode === 'hover' ? hovered : ctrlHeld && hovered;

  return (
    <div
      ref={setNodeRef}
      className={`shrink-0 rounded p-0.5 border transition-colors ${
        isOver ? 'border-emerald-400/70 bg-emerald-500/10'
        : blockerIds.length > 0 ? 'border-emerald-400/40'
        : 'border-rose-400/30'
      }`}
    >
      <div
        ref={ref}
        className="relative"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <img
          src={getCardImageUrl(card, 'small')}
          alt={card.name}
          title={`${card.name} · ${label}`}
          draggable={false}
          className="rounded-[2px] shadow"
          style={{ width: ATTACKER_W }}
        />
        <span className="absolute bottom-0 right-0 px-0.5 rounded-tl bg-black/80 text-white text-[8px] font-bold tabular-nums">
          {label}
        </span>
        {showPreview && <MagnifiedPreview card={card} anchorRef={ref} />}
      </div>
      <div className="mt-0.5 flex gap-0.5 min-h-[14px] justify-center">
        {blockerIds.length === 0 ? (
          <Shield className="w-2.5 h-2.5 text-muted-foreground/50" />
        ) : blockerIds.map(bid => {
          const b = battlefield.find(x => x.instanceId === bid);
          return b ? (
            <button
              key={bid}
              onClick={() => onRemoveBlocker(bid)}
              title={`${b.card.name} is blocking · click to remove`}
              style={{ width: 14 }}
            >
              <img src={getCardImageUrl(b.card, 'small')} alt={b.card.name} draggable={false} className="rounded-[2px]" />
            </button>
          ) : null;
        })}
      </div>
    </div>
  );
}
