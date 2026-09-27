import { resolveDamage, type Combatant, type CombatOutcome } from '@/services/playtest/combat';
import { playerCombatant } from '@/services/playtest/opponents/combatants';
import { botKeywords, botPower, botToughness } from '@/services/playtest/opponents/stats';
import type { Attacker, CombatState, Opponent } from '@/components/playtest/opponentTypes';
import type { BattlefieldCard } from '@/components/playtest/types';

/**
 * A bot's open attack, read off the live board rather than off the snapshot it
 * was declared from.
 *
 * `CombatState` is a photograph taken when the bot declared. Two things then go
 * wrong if you trust it:
 *
 *  - You kill one of the attackers mid-combat. It is gone from the bot's board
 *    but still in the photograph, so it dealt its damage anyway.
 *  - Its stats change. An anthem dies, a counter comes off, and the numbers in
 *    the photograph are no longer what is standing there.
 *
 * And because the preview number and the resolution used to be computed two
 * different ways, the button could lie outright: it summed unblocked power,
 * while `resolveDamage` also adds trample overflow. Chumping a 10/10 trampler
 * read "Resolve" and then took nine off you.
 *
 * One function, used by both, so they cannot disagree.
 */
export interface IncomingCombat {
  /** Attackers still on the bot's battlefield, for rendering. */
  live: Attacker[];
  /** The same, flattened with current stats. */
  attackers: Combatant[];
  /** Attacker instanceId → the player's creatures actually blocking it. */
  blocks: Record<string, Combatant[]>;
  /** Names of the blocking creatures, for the death log lines. */
  blockerNames: Map<string, string>;
}

export function readIncomingCombat(
  combat: CombatState,
  opponent: Opponent | undefined,
  playerBattlefield: BattlefieldCard[],
): IncomingCombat {
  const board = opponent?.battlefield ?? [];

  const live: Attacker[] = [];
  const attackers: Combatant[] = [];
  for (const a of combat.attackers) {
    const p = board.find(x => x.instanceId === a.instanceId);
    // Not on the board any more: killed, exiled, bounced or stolen mid-combat.
    if (!p) continue;
    const power = botPower(p, board, opponent?.graveyard ?? []);
    const toughness = botToughness(p, board, opponent?.graveyard ?? []);
    live.push({ instanceId: a.instanceId, card: p.card, power, toughness });
    attackers.push({
      instanceId: a.instanceId,
      name: p.card.name,
      power,
      toughness,
      keywords: botKeywords(p, board, opponent?.graveyard ?? []),
    });
  }

  const blockerNames = new Map<string, string>();
  const blocks: Record<string, Combatant[]> = {};
  for (const a of attackers) {
    blocks[a.instanceId] = (combat.blocks[a.instanceId] ?? [])
      .map(id => playerBattlefield.find(b => b.instanceId === id))
      .filter((b): b is BattlefieldCard => !!b)
      .map(b => {
        blockerNames.set(b.instanceId, b.card.name);
        return playerCombatant(b);
      });
  }

  return { live, attackers, blocks, blockerNames };
}

/**
 * What you would actually lose by resolving right now — trample overflow and
 * all. This is the number on the button.
 */
/**
 * The whole fight worked out from a reading of it: what reaches you, and which
 * creatures on both sides are left standing.
 *
 * Takes the reading rather than the raw state, so the strip — which already
 * has one in hand to draw the cards from — does not re-read both boards to
 * find out what happens to them. Null when nothing is still attacking.
 */
export function incomingOutcome(read: IncomingCombat): CombatOutcome | null {
  if (read.attackers.length === 0) return null;
  return resolveDamage(read.attackers, read.blocks);
}

export function incomingDamage(
  combat: CombatState,
  opponent: Opponent | undefined,
  playerBattlefield: BattlefieldCard[],
): number {
  return incomingOutcome(readIncomingCombat(combat, opponent, playerBattlefield))?.damageToDefender ?? 0;
}
