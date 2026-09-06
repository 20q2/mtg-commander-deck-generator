import type { ScryfallCard } from '@/types';
import { lookupEffect, type BotEffectSpec } from '@/services/playtest/opponents/effects';
import { canBlock, type Combatant } from '@/services/playtest/combat';

/** One of the player's battlefield cards, flattened to what a bot cares about. */
export interface PlayerCardRead {
  instanceId: string;
  name: string;
  isCreature: boolean;
  isArtifact: boolean;
  power: number;
  toughness: number;
  isCommander: boolean;
  /** Set when this card is a piece of a combo that's live or one card away. */
  comboId: string | null;
}

export interface PlayerBoardRead {
  cards: PlayerCardRead[];
  life: number;
  handSize: number;
}

/** What the bot decided to do to the player. Small on purpose — the store applies it. */
export interface AppliedEffect {
  /** Player battlefield instanceIds to remove. */
  destroy: string[];
  destination: 'graveyard' | 'exile';
  lifeLoss: number;
  /** Cards to discard at random from the player's hand. */
  discard: number;
}

export interface CastDecision {
  handIndex: number;
  card: ScryfallCard;
  /** Null for a plain permanent with no scripted behaviour. */
  effect: AppliedEffect | null;
  /** Shown in the game log so the bot's thinking is visible. */
  reason: string;
  /** ETB permanents stay on the bot's board; instants and sorceries don't. */
  staysOnBattlefield: boolean;
}

const EMPTY: AppliedEffect = { destroy: [], destination: 'graveyard', lifeLoss: 0, discard: 0 };

function creatures(board: PlayerBoardRead) {
  return board.cards.filter(c => c.isCreature);
}

/** Biggest by power, commander breaking ties — commanders are the scarier card. */
function biggestCreature(board: PlayerBoardRead): PlayerCardRead | null {
  const list = creatures(board);
  if (list.length === 0) return null;
  return [...list].sort((a, b) =>
    b.power - a.power || Number(b.isCommander) - Number(a.isCommander),
  )[0];
}

/**
 * A piece of a combo that's live or one card away, and only when at least two
 * pieces are already on the table — otherwise every removal spell in the deck
 * would chase a combo that's nowhere near assembling.
 */
function comboPieceToBreak(board: PlayerBoardRead): PlayerCardRead | null {
  const byCombo = new Map<string, PlayerCardRead[]>();
  for (const c of board.cards) {
    if (!c.comboId) continue;
    const list = byCombo.get(c.comboId) ?? [];
    list.push(c);
    byCombo.set(c.comboId, list);
  }
  let best: PlayerCardRead | null = null;
  for (const pieces of byCombo.values()) {
    if (pieces.length < 2) continue;
    // Prefer a creature: it's the piece most removal can actually answer.
    const pick = pieces.find(p => p.isCreature) ?? pieces[0];
    if (!best || pick.power > best.power) best = pick;
  }
  return best;
}

/** Which of the player's permanents this spec would hit, and what it costs them. */
function resolveEffect(
  spec: BotEffectSpec,
  board: PlayerBoardRead,
): { effect: AppliedEffect; target: string } | null {
  switch (spec.kind) {
    case 'destroyCreature':
    case 'exileCreature': {
      const target = comboPieceToBreak(board) ?? biggestCreature(board);
      if (!target) return null;
      return {
        effect: {
          ...EMPTY,
          destroy: [target.instanceId],
          destination: spec.kind === 'exileCreature' ? 'exile' : 'graveyard',
        },
        target: target.name,
      };
    }
    case 'destroyPermanent': {
      const target = comboPieceToBreak(board)
        ?? biggestCreature(board)
        ?? board.cards[0];
      if (!target) return null;
      return { effect: { ...EMPTY, destroy: [target.instanceId] }, target: target.name };
    }
    case 'boardWipe': {
      const list = creatures(board);
      if (list.length === 0) return null;
      return {
        effect: { ...EMPTY, destroy: list.map(c => c.instanceId) },
        target: `${list.length} creature${list.length > 1 ? 's' : ''}`,
      };
    }
    case 'artifactSweep': {
      const list = board.cards.filter(c => c.isArtifact);
      if (list.length === 0) return null;
      return {
        effect: { ...EMPTY, destroy: list.map(c => c.instanceId) },
        target: `${list.length} artifact${list.length > 1 ? 's' : ''}`,
      };
    }
    case 'edict': {
      const list = creatures(board);
      if (list.length === 0) return null;
      // The player chooses what to sacrifice, so they'd give up their worst.
      const worst = [...list].sort((a, b) => a.power - b.power)[0];
      return { effect: { ...EMPTY, destroy: [worst.instanceId] }, target: worst.name };
    }
    case 'damage': {
      // Prefer a creature it can actually kill; otherwise it goes upstairs.
      const killable = creatures(board)
        .filter(c => c.toughness > 0 && c.toughness <= spec.amount)
        .sort((a, b) => b.power - a.power)[0];
      if (killable) {
        return { effect: { ...EMPTY, destroy: [killable.instanceId] }, target: killable.name };
      }
      return { effect: { ...EMPTY, lifeLoss: spec.amount }, target: 'you' };
    }
    case 'drain':
      return { effect: { ...EMPTY, lifeLoss: spec.amount }, target: 'you' };
    case 'discard':
      if (board.handSize === 0) return null;
      return { effect: { ...EMPTY, discard: spec.count }, target: 'your hand' };
  }
}

/** How much of a problem the player's board is, relative to the bot's own. */
function threatScore(board: PlayerBoardRead, botPower: number): number {
  const list = creatures(board);
  const power = list.reduce((sum, c) => sum + c.power, 0);
  if (comboPieceToBreak(board)) return 100;                 // a live combo trumps everything
  if (list.length >= 3 && power >= botPower * 2) return 80;  // they're running away with it
  if (power >= 6) return 50;
  if (list.length > 0) return 25;
  return 0;
}

export interface ResistanceContext {
  hand: ScryfallCard[];
  mana: number;
  board: PlayerBoardRead;
  botPower: number;
  turn: number;
  /** 0..1 — higher fires interaction sooner and on smaller threats. */
  aggression: number;
}

/**
 * Pick the bot's interaction play, or null to fall through to developing the
 * board. Priority: break a combo, sweep a board that's ahead, then spot removal —
 * and hold early if nothing is worth answering yet.
 */
export function chooseResistancePlay(ctx: ResistanceContext): CastDecision | null {
  const { hand, mana, board, botPower, turn, aggression } = ctx;
  const threat = threatScore(board, botPower);

  interface Candidate {
    handIndex: number;
    card: ScryfallCard;
    spec: BotEffectSpec;
    etb: boolean;
    resolved: { effect: AppliedEffect; target: string };
    rank: number;
  }

  const candidates: Candidate[] = [];
  hand.forEach((card, handIndex) => {
    const entry = lookupEffect(card.name);
    if (!entry) return;
    if ((card.cmc ?? 0) > mana) return;
    const resolved = resolveEffect(entry.spec, board);
    if (!resolved) return;

    // Rank by how much of the problem it solves.
    let rank = 0;
    switch (entry.spec.kind) {
      case 'boardWipe':       rank = resolved.effect.destroy.length >= 3 ? 95 : 30; break;
      case 'destroyCreature':
      case 'exileCreature':
      case 'destroyPermanent': rank = comboPieceToBreak(board) ? 90 : 60; break;
      case 'artifactSweep':   rank = resolved.effect.destroy.length >= 2 ? 55 : 20; break;
      case 'edict':           rank = 40; break;
      case 'damage':          rank = resolved.effect.destroy.length > 0 ? 50 : 15; break;
      case 'drain':           rank = 20; break;
      case 'discard':         rank = 18; break;
    }
    candidates.push({ handIndex, card, spec: entry.spec, etb: !!entry.etb, resolved, rank });
  });

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.rank - a.rank);
  const best = candidates[0];

  // Hold fire early against a board that isn't threatening yet — but never sit on
  // a combo answer, and never hold a permanent, which is just a body otherwise.
  const holdThreshold = 40 - aggression * 25;
  if (threat < holdThreshold && turn < 6 && !best.etb && threat < 100) {
    return null;
  }

  return {
    handIndex: best.handIndex,
    card: best.card,
    effect: best.resolved.effect,
    staysOnBattlefield: best.etb,
    reason: `${best.card.name} → ${best.resolved.target}`,
  };
}

/**
 * Would this card's registry effect actually hit anything right now?
 *
 * The develop loop asks so it can tell two cases apart: a Ravenous Chupacabra
 * being held for the creature you are about to play, and a Ravenous Chupacabra
 * that is simply a 2/2 because your board is empty. Without this, a bot with an
 * empty board opposite it holds the card forever.
 */
export function hasLiveTarget(cardName: string, board: PlayerBoardRead): boolean {
  const entry = lookupEffect(cardName);
  if (!entry) return false;
  return resolveEffect(entry.spec, board) !== null;
}

/** Exposed so the engine can log why a bot sat on its hand. */
export function holdReason(board: PlayerBoardRead, botPower: number): string | null {
  return threatScore(board, botPower) === 0 ? null : 'holding interaction for a bigger threat';
}

/**
 * Would `dealer` put a lethal amount of damage on `target` in one pass?
 * Deathtouch makes any nonzero amount lethal.
 */
function killsIt(dealer: Combatant, target: Combatant): boolean {
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
  /** 0..1. Higher holds creatures back for its own attacks. */
  aggression: number;
}

/**
 * Decide how a bot blocks. Two passes: take the good blocks, then chump only
 * if what's left coming through would kill it.
 *
 * Returns attacker instanceId → blocker instanceIds. An attacker missing from
 * the map is unblocked.
 *
 * Known gap: a chump block against a trampler still lets the excess through,
 * so the lethal check in pass 2 can be optimistic against trample. Rare enough
 * on bot boards that the bookkeeping isn't worth it yet.
 */
export function chooseBlocks(ctx: BlockContext): Record<string, string[]> {
  const { attackers, blockers, life, aggression } = ctx;
  const blocks: Record<string, string[]> = {};
  const available = new Map(blockers.map(b => [b.instanceId, b]));
  const free = () => [...available.values()];
  const take = (c: Combatant) => available.delete(c.instanceId);

  // Biggest threat first — the creature most worth stopping gets first pick.
  const ordered = [...attackers].sort((a, b) => b.power - a.power);

  // An aggressive bot keeps bodies back to swing with next turn. The chump
  // pass ignores this: staying alive beats attacking later.
  const reserve = Math.round(blockers.length * aggression * 0.4);

  // Pass 1 — blocks that kill the attacker and keep the blocker.
  for (const atk of ordered) {
    if (free().length <= reserve) break;
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
