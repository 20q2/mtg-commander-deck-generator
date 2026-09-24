import { resolveDamage, type Combatant } from '@/services/playtest/combat';
import { botCombatant, playerCombatant } from '@/services/playtest/opponents/combatants';
import type { Opponent, OpponentPermanent } from '@/components/playtest/opponentTypes';
import type { BattlefieldCard } from '@/components/playtest/types';

/** One seat's worth of your confirmed attack: your attackers and their blocks. */
export interface PlayerAttackSide {
  attackers: string[];
  blocks: Record<string, string[]>;
}

/**
 * Your attack on one seat, read off both live boards.
 *
 * The mirror of `readIncomingCombat`, and for the same reason: the attack was
 * confirmed a moment ago and the board has moved since. A blocker you killed
 * in response is gone, an attacker that got bounced is gone, and everyone's
 * P/T is whatever it is now rather than whatever it was at confirm.
 */
export function readPlayerCombat(
  side: PlayerAttackSide,
  opponent: Opponent,
  playerBattlefield: BattlefieldCard[],
): { attackers: Combatant[]; blocks: Record<string, Combatant[]> } {
  const attackers = side.attackers
    .map(id => playerBattlefield.find(b => b.instanceId === id))
    .filter((b): b is BattlefieldCard => !!b)
    .map(playerCombatant);

  const blocks: Record<string, Combatant[]> = {};
  for (const attacker of attackers) {
    blocks[attacker.instanceId] = (side.blocks[attacker.instanceId] ?? [])
      .map(id => opponent.battlefield.find(p => p.instanceId === id))
      .filter((p): p is OpponentPermanent => !!p)
      .map(p => botCombatant(p, opponent.battlefield, opponent.graveyard));
  }

  return { attackers, blocks };
}

/**
 * What this seat would actually lose by resolving right now — trample overflow
 * included. This is the number on the Resolve button.
 */
export function outgoingDamage(
  side: PlayerAttackSide,
  opponent: Opponent,
  playerBattlefield: BattlefieldCard[],
): number {
  const { attackers, blocks } = readPlayerCombat(side, opponent, playerBattlefield);
  if (attackers.length === 0) return 0;
  return resolveDamage(attackers, blocks).damageToDefender;
}
