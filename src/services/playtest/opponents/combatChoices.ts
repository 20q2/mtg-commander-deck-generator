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
  // Nothing in combat kills an indestructible creature, deathtouch included.
  // Every block and attack decision below is phrased in terms of this one
  // question, so answering it correctly is the whole of "the bots understand
  // indestructible": they take the free block with an indestructible wall,
  // they stop trading into an indestructible attacker, and they stop holding
  // an indestructible creature home to die for them.
  if (target.keywords.has('indestructible')) return false;
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
  /**
   * 0..1. Raises the bar on a trade block: a cautious bot only eats an attacker
   * that is clearly worth more than the blocker it spends, an aggressive one
   * will take a near-even swap. Defaults to the middle.
   */
  aggression?: number;
}

/**
 * Roughly what a creature is worth, for comparing a blocker against the
 * attacker it would trade with. Power plus toughness is crude but it ranks the
 * cases that matter — a 1/3 deathtouch blocker eating a 6/6 is the trade the
 * old logic refused, and 4 against 12 says so plainly.
 */
function value(c: Combatant): number {
  return Math.max(0, c.power) + Math.max(0, c.toughness);
}

/**
 * Decide how a bot blocks. Four passes, best blocks first:
 *
 *  1. Kill the attacker and keep the blocker — free.
 *  2. Trade: the blocker dies but takes a more valuable attacker with it. This
 *     is what makes a deathtouch blocker behave like one.
 *  3. Absorb: the blocker kills nothing but survives, so the block costs
 *     nothing and stops the damage anyway. A wall doing its job.
 *  4. Chump, but only against lethal.
 *
 * Returns attacker instanceId to blocker instanceIds. An attacker missing from
 * the map is unblocked.
 *
 * Passes 2 and 3 were the whole reason bots read as asleep in combat: the
 * original pass 1 required a blocker to kill AND survive, so a 1/3 deathtouch
 * flier watched a 6/6 walk past it, and a 2/5 took three to the face rather
 * than blocking a 3/3 it comfortably lived through.
 *
 * There is deliberately no "hold some back to attack with" rule here. Blocking
 * does not tap a creature, so the reserve belongs on the attack side — see
 * `chooseAttackers`.
 *
 * Known gap: a chump block against a trampler still lets the excess through,
 * so the lethal check in pass 4 can be optimistic against trample. Rare enough
 * on bot boards that the bookkeeping is not worth it yet.
 */
export function chooseBlocks(ctx: BlockContext): Record<string, string[]> {
  const { attackers, blockers, life, aggression = 0.5 } = ctx;
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

  // Pass 2 — trades worth making. The blocker dies, but it drags down an
  // attacker worth more than itself. `edge` is how much more: an aggressive bot
  // signs up for a near-even swap, a cautious one wants a clear win.
  const edge = 1 + (1 - aggression) * 2;
  for (const atk of ordered) {
    if (free().length === 0) break;
    if (blocks[atk.instanceId]?.length) continue;
    const legal = free().filter(b => canBlock(atk, b));
    const need = atk.keywords.has('menace') ? 2 : 1;
    if (legal.length < need) continue;

    if (need === 1) {
      // Cheapest body that still kills it — no reason to overpay for the trade.
      const trades = legal
        .filter(b => killsIt(b, atk) && value(atk) >= value(b) * edge)
        .sort((a, b) => value(a) - value(b));
      if (trades.length === 0) continue;
      blocks[atk.instanceId] = [trades[0].instanceId];
      take(trades[0]);
    } else {
      const pair = bestMenacePair(legal, atk);
      if (!pair) continue;
      const spent = pair.reduce((n, b) => n + (blockerSurvives(b, atk) ? 0 : value(b)), 0);
      if (value(atk) < spent * edge) continue;
      blocks[atk.instanceId] = pair.map(b => b.instanceId);
      pair.forEach(take);
    }
  }

  // Pass 3 — absorb. The blocker kills nothing but walks away, so the block is
  // free damage prevention. Only worth a body that is not needed elsewhere,
  // which by now means anything still unassigned.
  for (const atk of ordered) {
    if (free().length === 0) break;
    if (blocks[atk.instanceId]?.length) continue;
    if (atk.power <= 0) continue;
    const legal = free().filter(b => canBlock(atk, b) && blockerSurvives(b, atk));
    // Menace needs two survivors to be worth it; one body cannot absorb alone.
    const need = atk.keywords.has('menace') ? 2 : 1;
    if (legal.length < need) continue;
    // Smallest survivor first: keep the big blockers free for bigger attackers.
    const picks = [...legal].sort((a, b) => value(a) - value(b)).slice(0, need);
    blocks[atk.instanceId] = picks.map(b => b.instanceId);
    picks.forEach(take);
  }

  // Pass 4 — chump, but only against lethal.
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

/** Somebody a bot could swing at — the player, or another seat. */
export interface AttackCandidate {
  /** Null for the player; a seat id for a rival bot. */
  id: string | null;
  name: string;
  life: number;
  untappedCreatures: Combatant[];
  /**
   * Total power this seat has on board, tapped or not — what it will hit
   * somebody with next turn. This is the "threat" half of the decision, and
   * leaving it out is what made three bots gang the player forever.
   */
  threat?: number;
}

/**
 * Who this bot attacks. Real pods do not all point at one player, and three
 * bots that only ever knew about you meant you ate three full attacks a turn
 * cycle — seventy-eight damage in one round of a game I played — while the
 * bots never touched each other.
 *
 * Softness is life plus a premium per untapped blocker. The player has to stay
 * the default though: this is their playtest, and a table that ignores them is
 * as broken as a table that ganks them. So a rival is only chosen when it is
 * clearly the easier target, not merely the marginally easier one.
 */
export function chooseAttackTarget(
  player: AttackCandidate,
  rivals: AttackCandidate[],
  /**
   * Total power this bot could swing with. Only used to spot a kill — and a
   * kill outranks everything, because turning to finish off the seat on three
   * life is the most obviously correct attack in Magic.
   */
  myPower = 0,
): AttackCandidate {
  /**
   * How much this bot wants to attack a seat.
   *
   * Threat first, because that is what a player actually attacks: the seat
   * about to kill everybody. Then how hard it is to get through — blockers
   * matter far more than life, since blockers stop damage where life only
   * absorbs it. Life is a tiebreak, not the question.
   */
  const appeal = (c: AttackCandidate) => {
    // Can this bot just end it? Nothing else comes close in value.
    const kill = myPower > 0 && myPower >= c.life ? 50 : 0;
    return kill
      + 2 * (c.threat ?? 0)
      - 3 * c.untappedCreatures.length
      - c.life / 10;
  };

  // Never beat a corpse. A seat already at zero cannot be damaged further and
  // swinging at it wastes the turn — which is exactly what the log looked like
  // when three bots kept attacking a player who was two hundred life down.
  const live = rivals.filter(r => r.life > 0);
  const playerAlive = player.life > 0;
  if (!playerAlive && live.length === 0) return player;
  if (live.length === 0) return player;
  if (!playerAlive) {
    return [...live].sort((a, b) => appeal(b) - appeal(a))[0];
  }

  const best = [...live].sort((a, b) => appeal(b) - appeal(a))[0];
  /*
   * The player keeps a thumb on the scale, but a small one.
   *
   * It has to be small. The old rule scored only softness, so with three bots
   * building unopposed boards the human was permanently the softest seat at the
   * table and ate every single attack — twenty out of twenty in a game I
   * played, dead on turn six and still being swung at on turn eleven. Threat
   * fixes that on its own: a bot with thirty power on board is a bigger problem
   * to its neighbours than a player with two creatures, so the bots turn on each
   * other, and they come back for the player the moment the player is ahead.
   */
  return appeal(best) > appeal(player) + 4 ? best : player;
}

export interface AttackContext {
  /** The bot's creatures that legally could attack: untapped and not sick. */
  candidates: Combatant[];
  /** The player's untapped creatures — what might block, and what might swing back. */
  blockers: Combatant[];
  /** The player's life, for the "swing for the win" case. */
  playerLife: number;
  /**
   * 0..1, and now a dial rather than a switch. It sets how willingly a bot
   * takes an even trade AND how much of its board it keeps home to block, so
   * every step between 0 and 1 changes behaviour.
   */
  aggression: number;
  /** The bot's own life. Without it a bot never keeps a blocker home. */
  botLife?: number;
  /**
   * The most dangerous other seat at the table: its total creature power and
   * how many creatures that is. The reserve is sized against THIS, not against
   * whoever is being attacked — a bot swinging at an empty rival board while
   * the player sat on fifteen power used to tap out, because the only board it
   * looked at was the one in front of it. Defaults to `blockers`.
   */
  threatFrom?: { power: number; creatures: number };
}

/**
 * Which of the bot's creatures attack. Returns instance ids.
 *
 * Three rules, in order:
 *
 *  1. If the whole team gets there, the whole team goes. A lethal alpha strike
 *     beats any amount of careful value — counted both from evasion alone and
 *     from what survives the worst possible block assignment.
 *  2. A creature nothing can profitably block always attacks. That covers an
 *     empty board, evasion, and anything simply bigger than what is opposite.
 *  3. Otherwise it attacks only if an aggressive bot would take the trade.
 *  4. Finally, keep some defence home if the swing back would hurt, sized
 *     against the most dangerous seat at the table rather than against
 *     whichever one is being attacked. Attacking
 *     taps, and a bot's turn runs inside your Next Turn, so a bot that sent
 *     everything every turn met your attack with a board lying sideways — its
 *     blocking logic was effectively unreachable.
 *
 * This is deliberately not a full combat solver. It exists to stop the one
 * behaviour that reads as broken: a 1/1 walking into a 5/5 every single turn.
 */
export function chooseAttackers(ctx: AttackContext): string[] {
  const { candidates, blockers, playerLife, aggression, botLife = Infinity } = ctx;
  const able = candidates.filter(c => c.power > 0);
  if (able.length === 0) return [];

  // 1a. Lethal from evasion alone: what nothing on their board can even block.
  const unblockable = able.filter(a => !blockers.some(b => canBlock(a, b)));
  if (unblockable.reduce((n, a) => n + a.power, 0) >= playerLife) {
    return able.map(a => a.instanceId);
  }

  // 1b. Lethal through the blockers they have. Each blocker stops at most one
  // attacker, so the worst case is that they eat the biggest ones: sort by
  // power and write off the top `blockers.length`. What is left is what gets
  // through no matter how they block.
  //
  // Requiring an empty board here instead — which is what this did first —
  // meant four chump blockers held off a board of three hundred goblins,
  // forever. A swarm that is obviously lethal has to be allowed to swing.
  const byPower = [...able].sort((a, b) => b.power - a.power);
  const throughAnyBlock = byPower
    .slice(blockers.length)
    .reduce((n, a) => n + a.power, 0);
  if (throughAnyBlock >= playerLife) return able.map(a => a.instanceId);

  // 2 and 3. First, per creature: is there a block the defender would love?
  // One where their creature lives and ours dies is one-sided. A mutual kill
  // is a trade, and only an aggressive bot signs up for one.
  const takesTrades = aggression >= 0.5;
  const badlyBlocked = (atk: Combatant) => {
    const legal = blockers.filter(b => canBlock(atk, b));
    if (legal.length === 0) return false;
    if (legal.some(b => killsIt(b, atk) && !killsIt(atk, b))) return true;
    const trade = legal.some(b => killsIt(b, atk) && killsIt(atk, b));
    return trade && !takesTrades;
  };
  const safe = able.filter(atk => !badlyBlocked(atk));
  const risky = able.filter(badlyBlocked);

  // Then the swarm question. Each blocker stops one attacker, so once the
  // risky attackers outnumber the blockers the defender can only punish a few
  // of them and the rest connect. Judging every creature alone against every
  // blocker missed this completely: ten 2/2s into a lone 5/5 stayed home for
  // the whole game, every goblin flinching at the same wall, when the real
  // play is to lose one goblin and deal eighteen. So when the swarm is bigger
  // than the wall, weigh what gets through against what gets eaten — the
  // worst case being that they block the biggest — and swing with everything
  // if it pays. Aggression sets the rate: a reckless bot takes an even swap,
  // a cautious one wants to deal one and a half times what it loses.
  let wanted = safe;
  if (risky.length > blockers.length) {
    const byPow = [...risky].sort((a, b) => b.power - a.power);
    const eaten = byPow.slice(0, blockers.length).reduce((n, a) => n + a.power, 0);
    const through = byPow.slice(blockers.length).reduce((n, a) => n + a.power, 0);
    if (through >= eaten * (1.5 - aggression)) wanted = able;
  }

  // 4. Keep some defence home.
  //
  // Only when the swing back actually threatens: a board that could take a
  // third of the bot's life is worth respecting, anything less is not worth
  // slowing the clock for. Vigilant creatures are exempt — they attack and are
  // still home to block, which is the whole point of the keyword.
  const threat = ctx.threatFrom ?? {
    power: blockers.reduce((n, b) => n + Math.max(0, b.power), 0),
    creatures: blockers.length,
  };
  const threatened = threat.power > 0 && threat.power * 3 >= botLife;
  if (!threatened || wanted.length === 0) return wanted.map(a => a.instanceId);

  const reserveCount = Math.min(
    // Never hold back more than there are attackers to answer...
    threat.creatures,
    // ...and never the whole board: at aggression 0 that is still a clock.
    Math.max(0, wanted.length - 1),
    Math.ceil(threat.creatures * (1 - aggression)),
  );
  if (reserveCount <= 0) return wanted.map(a => a.instanceId);

  // Hold back the best defenders: the ones that survive the biggest thing
  // coming, then the toughest. A vigilant creature never needs holding.
  const biggest = [...blockers].sort((a, b) => b.power - a.power)[0];
  const reserve = new Set(
    wanted
      .filter(c => !c.keywords.has('vigilance'))
      .sort((a, b) => {
        const aSafe = biggest ? Number(blockerSurvives(a, biggest)) : 0;
        const bSafe = biggest ? Number(blockerSurvives(b, biggest)) : 0;
        return bSafe - aSafe || b.toughness - a.toughness;
      })
      .slice(0, reserveCount)
      .map(c => c.instanceId),
  );

  return wanted.filter(a => !reserve.has(a.instanceId)).map(a => a.instanceId);
}
