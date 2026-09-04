import { useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Shield, Swords, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { useOpponentStore } from '@/store/opponentStore';
import { getCardImageUrl } from '@/services/scryfall/client';
import { resolvePT } from '@/services/playtest/powerToughness';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { useMagnifyKey } from '@/hooks/useMagnifyKey';
import type { Attacker } from '@/components/playtest/opponentTypes';
import type { BattlefieldCard } from '@/components/playtest/types';

const ATTACKER_WIDTH = 76;

/**
 * The combat step. Appears across the top of your play area when a bot swings,
 * holding its attackers; you drag your own creatures onto them to block, then
 * resolve. The bot's turn is genuinely paused behind this — nothing else of
 * theirs happens until you're done.
 */
export function CombatZone() {
  const combat = useOpponentStore(s => s.combat);
  const resolveCombat = useOpponentStore(s => s.resolveCombat);
  const battlefield = usePlaytestStore(s => s.battlefield);

  if (!combat) return null;

  const blockedCount = Object.values(combat.blocks).filter(ids => ids.length > 0).length;
  const unblocked = combat.attackers.filter(a => (combat.blocks[a.instanceId] ?? []).length === 0);
  const incoming = unblocked.reduce((sum, a) => sum + a.power, 0);

  return (
    <div className="shrink-0 border-b border-rose-500/30 bg-rose-950/20 px-2 sm:px-3 py-1.5">
      <div className="flex items-center gap-2 mb-1.5">
        <Swords className="w-3.5 h-3.5 text-rose-300 shrink-0" />
        <span className="text-[11px] font-semibold text-rose-200">
          {combat.opponentName} attacks
        </span>
        {/* Instruction only until you've blocked something — once you've done it
            once you know how, and the tally to the right is the useful readout. */}
        {blockedCount === 0 && (
          <span className="text-[10px] text-muted-foreground hidden sm:inline">
            Drag your creatures onto an attacker to block
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] tabular-nums">
            {blockedCount > 0 && (
              <span className="text-emerald-300 mr-2">{blockedCount} blocked</span>
            )}
            <span className={incoming > 0 ? 'text-rose-300 font-bold' : 'text-emerald-300 font-bold'}>
              {incoming} incoming
            </span>
          </span>
          <Button
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={resolveCombat}
          >
            {incoming > 0 ? `Take ${incoming}` : 'Resolve'}
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-2 overflow-x-auto pb-1">
        {combat.attackers.map(attacker => (
          <AttackerSlot
            key={attacker.instanceId}
            attacker={attacker}
            blockerIds={combat.blocks[attacker.instanceId] ?? []}
            battlefield={battlefield}
          />
        ))}
      </div>
    </div>
  );
}

function AttackerSlot({
  attacker, blockerIds, battlefield,
}: {
  attacker: Attacker;
  blockerIds: string[];
  battlefield: BattlefieldCard[];
}) {
  const removeBlocker = useOpponentStore(s => s.removeBlocker);
  const previewMode = usePlaytestSettings(s => s.opponentPreview);
  const ctrlHeld = useMagnifyKey();
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const { setNodeRef, isOver } = useDroppable({
    id: `combat:${attacker.instanceId}`,
    data: { kind: 'combatAttacker', attackerId: attacker.instanceId },
  });

  const blockers = blockerIds
    .map(id => battlefield.find(b => b.instanceId === id))
    .filter((b): b is NonNullable<typeof b> => !!b);

  const blockerPower = blockers.reduce((sum, b) => {
    const p = parseInt(resolvePT(b)?.modified.split('/')[0] ?? '0', 10);
    return sum + (Number.isNaN(p) ? 0 : p);
  }, 0);
  const attackerDies = attacker.toughness > 0 && blockerPower >= attacker.toughness;

  const showPreview =
    previewMode === 'off' ? false : previewMode === 'hover' ? hovered : ctrlHeld && hovered;

  return (
    <div
      ref={setNodeRef}
      className={`shrink-0 rounded-md border p-1 transition-colors ${
        isOver ? 'border-emerald-400/70 bg-emerald-500/10'
        : blockers.length > 0 ? 'border-emerald-400/40 bg-emerald-500/5'
        : 'border-rose-400/30 bg-rose-500/5'
      }`}
      style={{ width: ATTACKER_WIDTH + 8 }}
    >
      <div
        ref={ref}
        className="relative"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <img
          src={getCardImageUrl(attacker.card, 'small')}
          alt={attacker.card.name}
          title={`${attacker.card.name} · ${attacker.power}/${attacker.toughness}`}
          className={`w-full rounded-[3px] shadow ${attackerDies ? 'ring-2 ring-emerald-400/70' : ''}`}
          draggable={false}
          style={{ width: ATTACKER_WIDTH }}
        />
        <span className="absolute bottom-0 right-0 px-1 rounded-tl bg-black/80 text-white text-[9px] font-bold tabular-nums">
          {attacker.power}/{attacker.toughness}
        </span>
        {showPreview && <MagnifiedPreview card={attacker.card} anchorRef={ref} />}
      </div>

      {/* Blocker slot: a dashed box until something is in it. */}
      <div
        className={`mt-1 rounded border border-dashed min-h-[26px] flex flex-wrap gap-0.5 p-0.5 ${
          blockers.length > 0 ? 'border-emerald-400/40' : 'border-border/50'
        }`}
      >
        {blockers.length === 0 ? (
          <span className="w-full text-center text-[9px] text-muted-foreground/50 leading-[22px]">
            <Shield className="w-2.5 h-2.5 inline" />
          </span>
        ) : (
          blockers.map(b => (
            <button
              key={b.instanceId}
              onClick={() => removeBlocker(attacker.instanceId, b.instanceId)}
              title={`${b.card.name} is blocking · click to remove`}
              className="relative shrink-0 group"
              style={{ width: 22 }}
            >
              <img
                src={getCardImageUrl(b.card, 'small')}
                alt={b.card.name}
                className="w-full rounded-[2px]"
                draggable={false}
              />
              <span className="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/60 rounded-[2px]">
                <X className="w-2.5 h-2.5 text-red-300" />
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
