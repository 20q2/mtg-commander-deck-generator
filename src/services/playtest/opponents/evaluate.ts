import type { ScryfallCard } from '@/types';
import type { Combatant } from '@/services/playtest/combat';
import { costOf, lookupEffect, type BotEffectSpec } from '@/services/playtest/opponents/effects';

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
  /**
   * The player's untapped creatures, as combatants. Attack decisions need
   * keywords and live P/T, which `PlayerCardRead` deliberately does not carry —
   * it exists for targeting, where a name and a power are enough.
   */
  untappedCreatures: Combatant[];
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
    if (costOf(card) > mana) return;
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
