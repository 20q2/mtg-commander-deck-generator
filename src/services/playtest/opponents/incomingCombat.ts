import { keywordsOf, resolveDamage, type Combatant } from '@/services/playtest/combat';
import { botKeywords, botPower, botToughness } from '@/services/playtest/opponents/stats';
import { resolvePT } from '@/services/playtest/powerToughness';
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

/** Flatten one of the player's battlefield cards, reading live P/T. */
function playerCombatant(b: BattlefieldCard): Combatant {
  const [p, t] = (resolvePT(b)?.modified ?? '0/0').split('/');
  const power = parseInt(p, 10);
  const toughness = parseInt(t, 10);
  return {
    instanceId: b.instanceId,
    name: b.card.name,
    power: Number.isNaN(power) ? 0 : power,
    toughness: Number.isNaN(toughness) ? 0 : toughness,
    keywords: keywordsOf(b.card, b.edit),
  };
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
export function incomingDamage(
  combat: CombatState,
  opponent: Opponent | undefined,
  playerBattlefield: BattlefieldCard[],
): number {
  const { attackers, blocks } = readIncomingCombat(combat, opponent, playerBattlefield);
  if (attackers.length === 0) return 0;
  return resolveDamage(attackers, blocks).damageToDefender;
}
