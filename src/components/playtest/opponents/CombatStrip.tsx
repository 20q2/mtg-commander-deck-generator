import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDroppable } from '@dnd-kit/core';
import { X } from 'lucide-react';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { useOpponentStore } from '@/store/opponentStore';
import { getCardImageUrl } from '@/services/scryfall/client';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { useMagnifyKey } from '@/hooks/useMagnifyKey';
import type { BattlefieldCard } from '@/components/playtest/types';
import type { Attacker } from '@/components/playtest/opponentTypes';
import type { ScryfallCard } from '@/types';

/** Declared attackers sitting in the strip before you confirm. */
const ATTACKER_W = 34;
/**
 * A creature in an open combat. Much bigger than the resting size — combat is
 * the moment you actually need to read power, toughness and keywords, and the
 * seat shrinks its other rows to pay for it.
 */
const COMBAT_W = 68;
const BLOCKER_W = 30;

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
  const combatPhase  = useOpponentStore(s => s.combatPhase);

  const declared = declaration?.[opponentId] ?? [];
  const mine     = playerCombat?.perOpponent[opponentId];
  const theirs   = combat?.opponentId === opponentId ? combat : null;

  const { setNodeRef, isOver } = useDroppable({
    id: `strip:${opponentId}`,
    data: { kind: 'combatStrip', opponentId },
  });

  // Open only once you've stepped into combat. Deliberately not "whenever a
  // drag is in flight" — moving a card around your own board shouldn't make
  // three attack zones appear.
  const armed = combatPhase && !mine;
  const busy  = declared.length > 0 || !!mine || !!theirs;

  if (!armed && !busy) return <div ref={setNodeRef} className="h-1" />;

  return (
    <div
      ref={setNodeRef}
      className={`mt-1 rounded-md border p-1 min-h-[38px] flex items-center gap-1 flex-wrap transition-colors ${
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
              style={{ width: COMBAT_W }}
            />
            <div className="flex gap-0.5 min-h-[26px] items-start">
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
                    style={{ width: BLOCKER_W }}
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

/**
 * Collapse identical attackers into one slot.
 *
 * A goblin swarm attacks with fifty-two creatures. Drawn one slot each at the
 * combat size, the strip ran about nine hundred pixels wide and wrapped its
 * Resolve button off the bottom of the canvas — the attack was unresolvable.
 * Identical tokens share a Scryfall id and identical stats, so they collapse.
 */
function groupAttackers(attackers: Attacker[]): { key: string; members: Attacker[] }[] {
  const groups = new Map<string, Attacker[]>();
  for (const a of attackers) {
    const key = `${a.card.id}|${a.power}/${a.toughness}`;
    const hit = groups.get(key);
    if (hit) hit.push(a);
    else groups.set(key, [a]);
  }
  return [...groups].map(([key, members]) => ({ key, members }));
}

/** Their attack. Same strip, roles flipped — drag your creatures in to block. */
function IncomingAttack({ opponentId }: { opponentId: string }) {
  const combat = useOpponentStore(s => s.combat);
  const resolveCombat = useOpponentStore(s => s.resolveCombat);
  const removeBlocker = useOpponentStore(s => s.removeBlocker);
  const assignBlocker = useOpponentStore(s => s.assignBlocker);
  const battlefield = usePlaytestStore(s => s.battlefield);
  if (!combat || combat.opponentId !== opponentId) return null;

  const blocksOf = (a: Attacker) => combat.blocks[a.instanceId] ?? [];
  const unblocked = combat.attackers.filter(a => blocksOf(a).length === 0);
  const incoming = unblocked.reduce((sum, a) => sum + a.power, 0);
  const piles = groupAttackers(combat.attackers);

  return (
    <>
      {piles.map(({ key, members }) => {
        const top = members[0];
        // Every blocker assigned anywhere in the pile, shown on the one slot.
        const blockerIds = members.flatMap(blocksOf);
        const blockedCount = members.filter(m => blocksOf(m).length > 0).length;
        return (
          <AttackerSlot
            key={key}
            // A new blocker goes onto the next member with nothing in front of
            // it, so chumping a swarm one goblin at a time works as expected.
            attackerId={(members.find(m => blocksOf(m).length === 0) ?? top).instanceId}
            card={top.card}
            label={`${top.power}/${top.toughness}`}
            count={members.length}
            blockedCount={blockedCount}
            blockerIds={blockerIds}
            onRemoveBlocker={id => {
              const owner = members.find(m => blocksOf(m).includes(id));
              if (owner) removeBlocker(owner.instanceId, id);
            }}
            battlefield={battlefield}
            onAssign={assignBlocker}
          />
        );
      })}
      <button
        onClick={resolveCombat}
        className="ml-auto shrink-0 px-2 h-6 rounded bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold"
      >
        {incoming > 0 ? `Take ${incoming}` : 'Resolve'}
      </button>
    </>
  );
}

/**
 * One incoming attacker and the slot where its blockers go.
 *
 * Two ways to block, because they suit different moments. Drag one of your
 * creatures up onto the attacker, as before — or pull an arrow down out of the
 * blocker slot and point it at the creature you want. The arrow is the one that
 * scales: with the seats floating over your board, dragging a card all the way
 * up to a strip is a long haul, and aiming down at your own board is short.
 */
function AttackerSlot({
  attackerId, card, label, blockerIds, onRemoveBlocker, battlefield, onAssign,
  count = 1, blockedCount = 0,
}: {
  attackerId: string;
  card: ScryfallCard;
  label: string;
  blockerIds: string[];
  onRemoveBlocker: (instanceId: string) => void;
  battlefield: BattlefieldCard[];
  onAssign: (attackerId: string, blockerInstanceId: string) => void;
  /** How many identical attackers this slot stands for. */
  count?: number;
  /** How many of them already have a blocker in front of them. */
  blockedCount?: number;
}) {
  const previewMode = usePlaytestSettings(s => s.opponentPreview);
  const ctrlHeld = useMagnifyKey();
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const [aim, setAim] = useState<{ from: Point; to: Point } | null>(null);
  const { setNodeRef, isOver } = useDroppable({
    id: `combat:${attackerId}`,
    data: { kind: 'combatAttacker', attackerId },
  });
  const showPreview =
    previewMode === 'off' ? false : previewMode === 'hover' ? hovered : ctrlHeld && hovered;

  /** Pull an arrow out of the slot and drop it on one of your creatures. */
  const startAim = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Clicking a blocker already in the slot removes it; don't fight that.
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.stopPropagation();
    const slot = e.currentTarget;
    const r = slot.getBoundingClientRect();
    const from = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    slot.setPointerCapture(e.pointerId);
    setAim({ from, to: { x: e.clientX, y: e.clientY } });

    const onMove = (ev: PointerEvent) => setAim({ from, to: { x: ev.clientX, y: ev.clientY } });
    const onUp = (ev: PointerEvent) => {
      slot.removeEventListener('pointermove', onMove);
      slot.removeEventListener('pointerup', onUp);
      slot.removeEventListener('pointercancel', onUp);
      try { slot.releasePointerCapture(ev.pointerId); } catch { /* already gone */ }
      setAim(null);
      // The arrow layer is pointer-events:none and portalled to <body>, so the
      // hit test sees the card underneath rather than the overlay.
      const hit = document.elementsFromPoint(ev.clientX, ev.clientY)
        .map(el => (el as HTMLElement).closest?.('[data-bf-card]'))
        .find(Boolean) as HTMLElement | null | undefined;
      const id = hit?.getAttribute('data-bf-card');
      if (id) onAssign(attackerId, id);
    };
    slot.addEventListener('pointermove', onMove);
    slot.addEventListener('pointerup', onUp);
    slot.addEventListener('pointercancel', onUp);
  }, [attackerId, onAssign]);

  const empty = blockerIds.length === 0;

  return (
    <div
      ref={setNodeRef}
      className={`shrink-0 rounded p-0.5 border transition-colors ${
        isOver ? 'border-emerald-400/70 bg-emerald-500/10'
        : !empty ? 'border-emerald-400/40'
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
          style={{ width: COMBAT_W }}
        />
        <span className="absolute bottom-0 right-0 px-1 rounded-tl bg-black/85 text-white text-[10px] font-bold tabular-nums">
          {label}
        </span>
        {count > 1 && (
          <span
            className="absolute top-0 left-0 px-1 rounded-br bg-rose-600 text-white text-[10px] font-bold tabular-nums shadow"
            title={`${count} attacking · ${blockedCount} blocked`}
          >
            ×{count}
            {blockedCount > 0 && <span className="text-emerald-200">{` −${blockedCount}`}</span>}
          </span>
        )}
        {showPreview && <MagnifiedPreview card={card} anchorRef={ref} />}
      </div>

      {/* The blocker slot. While it is empty it pulses, so it reads as
          something to act on rather than an empty box. */}
      <div
        onPointerDown={startAim}
        title={
          empty
            ? `Drag from here onto one of your creatures to block ${card.name}`
            : `Blocking ${card.name} · drag from here to add another, click one to remove`
        }
        style={{ width: COMBAT_W }}
        className={`mt-0.5 rounded border border-dashed flex flex-wrap gap-0.5 p-0.5 justify-center items-center min-h-[26px] cursor-crosshair touch-none transition-colors ${
          aim ? 'border-emerald-300 bg-emerald-500/25 ring-2 ring-emerald-300/60'
          : empty ? 'border-emerald-400/60 bg-emerald-500/10 hover:bg-emerald-500/25 animate-pulse'
          : 'border-emerald-400/50 bg-emerald-500/5'
        }`}
      >
        {empty ? (
          <span className="text-[8px] uppercase tracking-wider text-emerald-300/90 select-none leading-tight">
            Block
          </span>
        ) : blockerIds.map(bid => {
          const b = battlefield.find(x => x.instanceId === bid);
          return b ? (
            <button
              key={bid}
              onClick={() => onRemoveBlocker(bid)}
              title={`${b.card.name} is blocking · click to remove`}
              className="relative shrink-0 group"
              style={{ width: BLOCKER_W }}
            >
              <img
                src={getCardImageUrl(b.card, 'small')}
                alt={b.card.name}
                draggable={false}
                className="w-full rounded-[2px]"
              />
              <span className="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/60 rounded-[2px]">
                <X className="w-2.5 h-2.5 text-red-300" />
              </span>
            </button>
          ) : null;
        })}
      </div>

      {aim && <TargetArrow from={aim.from} to={aim.to} />}
    </div>
  );
}

interface Point { x: number; y: number }

/**
 * The targeting arrow, portalled to <body>. It has to escape the seat: the
 * seat uses backdrop-blur, which makes it a containing block for fixed
 * positioning, so an arrow rendered in place would be trapped inside the seat
 * instead of reaching your board.
 */
function TargetArrow({ from, to }: { from: Point; to: Point }) {
  // Bow the curve out sideways so a near-vertical drag still reads as an arc
  // rather than a straight line lying on top of itself.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(60, len * 0.25);
  const cx = (from.x + to.x) / 2 - (dy / len) * bow;
  const cy = (from.y + to.y) / 2 + (dx / len) * bow;
  // The head points along the tangent at the tip, which is the line from the
  // control point to the end of the curve.
  const angle = (Math.atan2(to.y - cy, to.x - cx) * 180) / Math.PI;

  return createPortal(
    <svg
      aria-hidden
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 200, width: '100vw', height: '100vh' }}
    >
      <path
        d={`M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`}
        fill="none"
        stroke="rgb(52 211 153)"
        strokeWidth={4}
        strokeLinecap="round"
        opacity={0.95}
      />
      <circle cx={from.x} cy={from.y} r={5} fill="rgb(52 211 153)" />
      <polygon
        points="0,-7 14,0 0,7"
        fill="rgb(52 211 153)"
        transform={`translate(${to.x} ${to.y}) rotate(${angle})`}
      />
    </svg>,
    document.body,
  );
}
