import type { ScryfallCard } from '@/types';
import type { Combatant } from '@/services/playtest/combat';
import { costOf, lookupEffect, type BotEffectSpec } from '@/services/playtest/opponents/effects';

/** One of the player's battlefield cards, flattened to what a bot cares about. */
export interface PlayerCardRead {
  instanceId: string;
  name: string;
  isCreature: boolean;
  isArtifact: boolean;
  /** Optional so older callers and the diagnostic's scripted board need not set it. */
  isLand?: boolean;
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
  /**
   * The player's untapped creatures, as combatants. Attack decisions need
   * keywords and live P/T, which `PlayerCardRead` deliberately does not carry —
   * it exists for targeting, where a name and a power are enough.
   */
  untappedCreatures: Combatant[];
  /** Whose board this is: absent/null for the player, a seat id for a rival bot. */
  seatId?: string | null;
  /** For logs and the stack label — "you" for the player. */
  seatName?: string;
}

/** What the bot decided to do to the player. Small on purpose — the store applies it. */
export interface AppliedEffect {
  /** Player battlefield instanceIds to remove. */
  destroy: string[];
  destination: 'graveyard' | 'exile';
  lifeLoss: number;
  /** Cards to discard at random from the player's hand. */
  discard: number;
  /**
   * The game is over. Set by a combo whose outcome is simply "you lose" rather
   * than a number — an Oracle on an empty library does not deal damage, it
   * wins. Kept separate from a huge `lifeLoss` so the log reads honestly.
   */
  lethal?: boolean;
  /**
   * Set when the effect lands on a rival bot's board rather than yours. The
   * store applies these directly; only effects aimed at you go on the stack.
   */
  target?: { seatId: string; name: string };
}

/**
 * A few words on what an effect does, for the stack panel.
 *
 * Built from the resolved effect rather than from the spec that made it, so the
 * one function covers a cast spell, an activated ability, a recurring trigger
 * and a combo payoff alike. `target` is the phrase `resolveEffect` already
 * returns — a card name for spot removal, "3 creatures" for a wrath.
 */
export function describeEffect(effect: AppliedEffect, target: string): string {
  if (effect.lethal) return 'You lose the game';
  if (effect.destroy.length > 0) {
    return `${effect.destination === 'exile' ? 'Exiles' : 'Destroys'} ${target}`;
  }
  if (effect.discard > 0) {
    return `You discard ${effect.discard} card${effect.discard > 1 ? 's' : ''}`;
  }
  if (effect.lifeLoss > 0) return `You lose ${effect.lifeLoss} life`;
  return 'No effect';
}

export interface CastDecision {
  handIndex: number;
  card: ScryfallCard;
  /** Null for a plain permanent with no scripted behaviour. */
  effect: AppliedEffect | null;
  /** Shown in the game log so the bot's thinking is visible. */
  reason: string;
  /** What it is pointed at, as `resolveEffect` phrases it. For the stack. */
  target: string;
  /** ETB permanents stay on the bot's board; instants and sorceries don't. */
  staysOnBattlefield: boolean;
  /** Rival copies of a sweeper, applied alongside `effect`. */
  extra: AppliedEffect[];
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

/**
 * Which of the player's permanents this spec would hit, and what it costs them.
 *
 * `scale` multiplies the amounts on the effects that count something the bot
 * controls — The Scarab God drains per Zombie, and only the caller can see the
 * bot's own board.
 */
export function resolveEffect(
  spec: BotEffectSpec,
  board: PlayerBoardRead,
  scale = 1,
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
      // Combo piece, then the biggest creature, then any artifact or
      // enchantment — a Beast Within on a basic land is a wasted card, and
      // `cards[0]` was very often a land.
      const target = comboPieceToBreak(board)
        ?? biggestCreature(board)
        ?? board.cards.find(c => c.isArtifact)
        ?? board.cards.find(c => !c.isLand && !c.isCreature)
        ?? board.cards[0];
      if (!target) return null;
      return { effect: { ...EMPTY, destroy: [target.instanceId] }, target: target.name };
    }
    case 'boardWipe': {
      // A -X/-X sweeper only kills what it is big enough to kill.
      const cap = spec.maxToughness;
      const list = creatures(board).filter(c => cap === undefined || c.toughness <= cap);
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
      const amount = spec.amount * scale;
      // Prefer a creature it can actually kill; otherwise it goes upstairs.
      const killable = creatures(board)
        .filter(c => c.toughness > 0 && c.toughness <= amount)
        .sort((a, b) => b.power - a.power)[0];
      if (killable) {
        return { effect: { ...EMPTY, destroy: [killable.instanceId] }, target: killable.name };
      }
      return { effect: { ...EMPTY, lifeLoss: amount }, target: 'you' };
    }
    case 'drain': {
      const amount = spec.amount * scale;
      // A scaled drain with nothing to count does nothing, and a bot should not
      // pay for it — an upkeep Scarab God trigger on an empty board is silent.
      if (amount <= 0) return null;
      return { effect: { ...EMPTY, lifeLoss: amount }, target: 'you' };
    }
    case 'discard':
      if (board.handSize === 0) return null;
      return { effect: { ...EMPTY, discard: spec.count }, target: 'your hand' };
  }
}

/**
 * Resolve a spec against every seat and return the hit worth taking.
 *
 * Bots aimed every Murder at the human even when a rival had a 6/6 and an
 * armed combo on board — three resistance bots meant every removal spell in
 * the pod pointed one way. A hit is scored by what it costs the victim: a
 * combo piece is worth everything, a commander a lot, then raw power, then
 * life and cards. The player keeps a thumb on the scale — this is their
 * playtest — so an exact tie still goes to them.
 */
export function pickTarget(
  spec: BotEffectSpec,
  boards: PlayerBoardRead[],
  scale = 1,
): { effect: AppliedEffect; target: string } | null {
  let best: { effect: AppliedEffect; target: string; board: PlayerBoardRead } | null = null;
  let bestScore = -Infinity;
  for (const board of boards) {
    const hit = resolveEffect(spec, board, scale);
    if (!hit) continue;
    const victims = hit.effect.destroy
      .map(id => board.cards.find(c => c.instanceId === id))
      .filter((c): c is PlayerCardRead => !!c);
    const score = victims.reduce((n, c) => n + Math.max(1, c.power) + (c.isCommander ? 4 : 0) + (c.comboId ? 100 : 0), 0)
      + hit.effect.lifeLoss
      + hit.effect.discard * 2
      + (board.seatId ? 0 : 1);
    if (score > bestScore) { bestScore = score; best = { ...hit, board }; }
  }
  if (!best) return null;
  if (!best.board.seatId) return { effect: best.effect, target: best.target };
  const name = best.board.seatName ?? 'a rival';
  return {
    effect: { ...best.effect, target: { seatId: best.board.seatId, name } },
    target: `${name}'s ${best.target}`,
  };
}

/**
 * A sweeper hits every seat. One effect per board it does anything to, the
 * player's first, rival copies carrying their `target`.
 */
export function resolveEverywhere(
  spec: BotEffectSpec,
  boards: PlayerBoardRead[],
): { effect: AppliedEffect; target: string }[] {
  const out: { effect: AppliedEffect; target: string }[] = [];
  for (const board of boards) {
    const hit = resolveEffect(spec, board);
    if (!hit) continue;
    if (board.seatId) {
      const name = board.seatName ?? 'a rival';
      out.push({ effect: { ...hit.effect, target: { seatId: board.seatId, name } }, target: `${name}'s ${hit.target}` });
    } else {
      out.push(hit);
    }
  }
  return out;
}

export const isSweep = (spec: BotEffectSpec) => spec.kind === 'boardWipe' || spec.kind === 'artifactSweep';

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
  /**
   * What a card costs with the bot's board as it stands. Supplied by the engine
   * so a cost reducer applies to interaction too — without it a Goblin Warchief
   * discounted creatures and nothing else.
   */
  costFor?: (card: ScryfallCard) => number;
  board: PlayerBoardRead;
  botPower: number;
  turn: number;
  /** 0..1 — higher fires interaction sooner and on smaller threats. */
  aggression: number;
  /**
   * The bot's own creatures, as toughness values. A wrath that kills more of
   * its board than yours is a bad wrath, and without this it cannot tell.
   */
  botCreatureToughness: number[];
  /** Rival boards, so removal can be pointed at whoever is scariest. */
  rivals?: PlayerBoardRead[];
}

/**
 * Pick the bot's interaction play, or null to fall through to developing the
 * board. Priority: break a combo, sweep a board that's ahead, then spot removal —
 * and hold early if nothing is worth answering yet.
 */
export function chooseResistancePlay(ctx: ResistanceContext): CastDecision | null {
  const { hand, mana, board, botPower, turn, aggression } = ctx;
  const priceOf = ctx.costFor ?? costOf;
  const boards = [board, ...(ctx.rivals ?? [])];
  const threat = Math.max(...boards.map(b => threatScore(b, botPower)));

  interface Candidate {
    handIndex: number;
    card: ScryfallCard;
    spec: BotEffectSpec;
    etb: boolean;
    resolved: { effect: AppliedEffect; target: string };
    /** Rival copies of a sweeper — the same wrath, landing on the other seats. */
    extra: AppliedEffect[];
    rank: number;
  }

  const candidates: Candidate[] = [];
  hand.forEach((card, handIndex) => {
    const entry = lookupEffect(card.name);
    if (!entry) return;
    if (priceOf(card) > mana) return;
    const hits = isSweep(entry.spec) ? resolveEverywhere(entry.spec, boards) : [];
    const resolved = isSweep(entry.spec) ? hits[0] : pickTarget(entry.spec, boards);
    if (!resolved) return;
    const extra = hits.slice(1).map(h => h.effect);

    // Rank by how much of the problem it solves.
    let rank = 0;
    switch (entry.spec.kind) {
      case 'boardWipe': {
        const cap = entry.spec.maxToughness;
        const ownLosses = ctx.botCreatureToughness
          .filter(t => cap === undefined || t <= cap).length;
        const net = hits.reduce((n, h) => n + h.effect.destroy.length, 0) - ownLosses;
        // Only a wrath that leaves the bot ahead is worth the card.
        rank = net >= 3 ? 95 : net >= 1 ? 45 : 0;
        break;
      }
      case 'destroyCreature':
      case 'exileCreature':
      case 'destroyPermanent': rank = boards.some(b => comboPieceToBreak(b)) ? 90 : 60; break;
      case 'artifactSweep':   rank = resolved.effect.destroy.length >= 2 ? 55 : 20; break;
      case 'edict':           rank = 40; break;
      case 'damage':          rank = resolved.effect.destroy.length > 0 ? 50 : 15; break;
      case 'drain':           rank = 20; break;
      case 'discard':         rank = 18; break;
    }
    // Rank 0 means the play is actively bad — a wrath that costs the bot more
    // than it costs you. Leave it in hand rather than offering it.
    if (rank <= 0) return;
    candidates.push({ handIndex, card, spec: entry.spec, etb: !!entry.etb, resolved, extra, rank });
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
    extra: best.extra,
    staysOnBattlefield: best.etb,
    reason: `${best.card.name} → ${best.resolved.target}`,
    target: best.resolved.target,
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
export function hasLiveTarget(cardName: string, boards: PlayerBoardRead[]): boolean {
  const entry = lookupEffect(cardName);
  if (!entry) return false;
  return pickTarget(entry.spec, boards) !== null;
}

/** Exposed so the engine can log why a bot sat on its hand. */
export function holdReason(board: PlayerBoardRead, botPower: number): string | null {
  return threatScore(board, botPower) === 0 ? null : 'holding interaction for a bigger threat';
}
