import { canBlock, type Combatant } from '@/services/playtest/combat';

/**
 * How a bot decides combat, in both directions. Split out of `evaluate.ts`,
 * which is about which spell to cast — the two questions share no state and
 * reading either was harder for having the other in the file.
 */

/**
 * Would `dealer` put a lethal amount of damage on `target` in one pass?
 * Deathtouch makes any nonzero amount lethal.
 */
export function killsIt(dealer: Combatant, target: Combatant): boolean {
  if (dealer.power <= 0) return false;
  if (dealer.keywords.has('deathtouch')) return true;
  return dealer.power >= target.toughness;
}

/**
 * Does the blocker walk away? A first striker that kills its attacker outright
 * never takes damage back — which is exactly the case that makes a block good
 * rather than a trade.
 */
function blockerSurvives(blocker: Combatant, attacker: Combatant): boolean {
  const blockerFirst  = blocker.keywords.has('firstStrike')  || blocker.keywords.has('doubleStrike');
  const attackerFirst = attacker.keywords.has('firstStrike') || attacker.keywords.has('doubleStrike');
  if (blockerFirst && !attackerFirst && killsIt(blocker, attacker)) return true;
  return !killsIt(attacker, blocker);
}

/**
 * Menace needs two bodies. Prefer the pair that together kills the attacker
 * and loses the fewest creatures doing it.
 */
function bestMenacePair(legal: Combatant[], attacker: Combatant): Combatant[] | null {
  let best: Combatant[] | null = null;
  let bestLoss = Infinity;
  for (let i = 0; i < legal.length; i++) {
    for (let j = i + 1; j < legal.length; j++) {
      const pair = [legal[i], legal[j]];
      const lethal = pair.some(b => b.keywords.has('deathtouch'))
        || pair[0].power + pair[1].power >= attacker.toughness;
      if (!lethal) continue;
      const loss = pair.filter(b => !blockerSurvives(b, attacker)).length;
      if (loss < bestLoss) { bestLoss = loss; best = pair; }
    }
  }
  return best;
}

export interface BlockContext {
  /** The player's declared attackers, flattened. */
  attackers: Combatant[];
  /**
   * The bot's legal blockers, flattened. Untapped creatures only — summoning
   * sickness does NOT prevent blocking, which matters because bots cast a
   * creature nearly every turn.
   */
  blockers: Combatant[];
  /** The bot's current life, for the chump-block threshold. */
  life: number;
}

/**
 * Decide how a bot blocks. Two passes: take the good blocks, then chump only
 * if what is left coming through would kill it.
 *
 * Returns attacker instanceId to blocker instanceIds. An attacker missing from
 * the map is unblocked.
 *
 * There is deliberately no "hold some back to attack with" rule. Blocking does
 * not tap a creature, and pass 1 only takes blocks the blocker survives, so a
 * reserve costs the bot free value and buys it nothing.
 *
 * Known gap: a chump block against a trampler still lets the excess through,
 * so the lethal check in pass 2 can be optimistic against trample. Rare enough
 * on bot boards that the bookkeeping is not worth it yet.
 */
export function chooseBlocks(ctx: BlockContext): Record<string, string[]> {
  const { attackers, blockers, life } = ctx;
  const blocks: Record<string, string[]> = {};
  const available = new Map(blockers.map(b => [b.instanceId, b]));
  const free = () => [...available.values()];
  const take = (c: Combatant) => available.delete(c.instanceId);

  // Biggest threat first — the creature most worth stopping gets first pick.
  const ordered = [...attackers].sort((a, b) => b.power - a.power);

  // Pass 1 — blocks that kill the attacker and keep the blocker.
  for (const atk of ordered) {
    if (free().length === 0) break;
    const legal = free().filter(b => canBlock(atk, b));
    const need = atk.keywords.has('menace') ? 2 : 1;
    if (legal.length < need) continue;

    if (need === 1) {
      const good = legal
        .filter(b => killsIt(b, atk) && blockerSurvives(b, atk))
        .sort((a, b) => a.power - b.power || a.toughness - b.toughness);
      if (good.length === 0) continue;
      blocks[atk.instanceId] = [good[0].instanceId];
      take(good[0]);
    } else {
      const pair = bestMenacePair(legal, atk);
      if (!pair || pair.some(b => !blockerSurvives(b, atk))) continue;
      blocks[atk.instanceId] = pair.map(b => b.instanceId);
      pair.forEach(take);
    }
  }

  // Pass 2 — chump, but only against lethal.
  const stillComing = () => attackers
    .filter(a => !(blocks[a.instanceId]?.length))
    .reduce((n, a) => n + Math.max(0, a.power), 0);

  if (stillComing() < life) return blocks;

  for (const atk of ordered) {
    if (stillComing() < life) break;
    if (blocks[atk.instanceId]?.length) continue;
    const legal = free().filter(b => canBlock(atk, b));
    const need = atk.keywords.has('menace') ? 2 : 1;
    if (legal.length < need) continue;
    // Throw the least useful bodies in front of it.
    const chumps = [...legal].sort((a, b) => a.power - b.power).slice(0, need);
    blocks[atk.instanceId] = chumps.map(b => b.instanceId);
    chumps.forEach(take);
  }

  return blocks;
}

export interface AttackContext {
  /** The bot's creatures that legally could attack: untapped and not sick. */
  candidates: Combatant[];
  /** The player's untapped creatures — what might block. */
  blockers: Combatant[];
  /** The player's life, for the "swing for the win" case. */
  playerLife: number;
  /** 0..1. At 0.5 and above a bot will take an even trade. */
  aggression: number;
}

/**
 * Which of the bot's creatures attack. Returns instance ids.
 *
 * Three rules, in order:
 *
 *  1. If the whole team gets there, the whole team goes. A lethal alpha strike
 *     beats any amount of careful value.
 *  2. A creature nothing can profitably block always attacks. That covers an
 *     empty board, evasion, and anything simply bigger than what is opposite.
 *  3. Otherwise it attacks only if an aggressive bot would take the trade.
 *
 * This is deliberately not a full combat solver. It exists to stop the one
 * behaviour that reads as broken: a 1/1 walking into a 5/5 every single turn.
 */
export function chooseAttackers(ctx: AttackContext): string[] {
  const { candidates, blockers, playerLife, aggression } = ctx;
  const able = candidates.filter(c => c.power > 0);
  if (able.length === 0) return [];

  // 1. Lethal on the swing, counting only what the player could not block at all.
  const unblockable = able.filter(a => !blockers.some(b => canBlock(a, b)));
  const guaranteed = unblockable.reduce((n, a) => n + a.power, 0);
  if (guaranteed >= playerLife) return able.map(a => a.instanceId);
  if (able.reduce((n, a) => n + a.power, 0) >= playerLife && blockers.length === 0) {
    return able.map(a => a.instanceId);
  }

  // 2 and 3, per creature.
  const takesTrades = aggression >= 0.5;
  return able
    .filter(atk => {
      const legal = blockers.filter(b => canBlock(atk, b));
      if (legal.length === 0) return true;
      // A block the player would love: their creature lives, ours dies.
      const oneSided = legal.some(b => killsIt(b, atk) && !killsIt(atk, b));
      if (oneSided) return false;
      // An even trade: both die. Only an aggressive bot signs up for that.
      const trade = legal.some(b => killsIt(b, atk) && killsIt(atk, b));
      if (trade) return takesTrades;
      return true;
    })
    .map(a => a.instanceId);
}
