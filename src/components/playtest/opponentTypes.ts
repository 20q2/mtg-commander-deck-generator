import type { ScryfallCard } from '@/types';
import type { AppliedEffect } from '@/services/playtest/opponents/evaluate';

export interface OpponentPermanent {
  instanceId: string;
  card: ScryfallCard;
  tapped: boolean;
  /** Creatures can't attack the turn they arrive. */
  summoningSick: boolean;
  /** Same shape as a player card's, so counter handling reads the same. */
  counters: Record<string, number>;
}

/** Zones a permanent can be sent to from the board. */
export type OpponentZone = 'graveyard' | 'exile' | 'hand' | 'library';

export interface Opponent {
  id: string;
  /** Deck name, used as the lane heading. */
  name: string;
  /** Which bundled stub this came from, if any. */
  stubId: string | null;
  blurb: string;
  colors: string[];
  life: number;
  library: ScryfallCard[];
  /** Real cards. Only the count is ever shown to the player. */
  hand: ScryfallCard[];
  graveyard: ScryfallCard[];
  exile: ScryfallCard[];
  command: ScryfallCard[];
  /** The commander's card name, so a copy on the battlefield is recognisable. */
  commanderName: string | null;
  /** How many times it has been cast. Each one adds {2} to the next. */
  commanderCasts: number;
  /**
   * Every token this deck can make, fetched once when the bot sits down.
   * Token specs in the registry are matched against this list by name.
   */
  tokens: ScryfallCard[];
  battlefield: OpponentPermanent[];
  /** True once this bot has stopped drawing because its library ran dry. */
  decked: boolean;
  /** Off = a passive threat dummy that only develops and attacks. */
  resistance: boolean;
  /** 0..1 — higher fires interaction sooner and at smaller threats. */
  aggression: number;
  /** Drives the "hold early" rule in evaluation. */
  turnsTaken: number;
}

export interface OpponentStub {
  id: string;
  name: string;
  blurb: string;
  commander: string;
  colors: string[];
  /** Entries are "<qty> <card name>". */
  cards: string[];
}

/**
 * One visible beat of a bot's turn — untap, land, cast, attack. The store plays
 * these in sequence with a short pause between so the turn reads as a series of
 * moves rather than the board changing all at once.
 */
export interface TurnFrame {
  opponent: Opponent;
  logs: string[];
  /** Short label popped off the lane for this beat, e.g. a card name. */
  blurb?: string;
  /** What to do to the player's board. Described here, applied by the store. */
  effects: AppliedEffect[];
  /**
   * Instance ids on the bot's board that are attacking. Non-empty only on the
   * attack beat, and it stops the turn: combat waits for you to block.
   */
  attackers: string[];
}

/** One creature swinging at you, flattened for the combat UI. */
export interface Attacker {
  instanceId: string;
  card: ScryfallCard;
  power: number;
  toughness: number;
}

/** An open combat step, waiting on blocks. */
export interface CombatState {
  opponentId: string;
  opponentName: string;
  attackers: Attacker[];
  /** Attacker instance id → the player battlefield instance ids blocking it. */
  blocks: Record<string, string[]>;
}

/** One bot's turn, as a value — the store applies it. */
export interface TurnResult {
  final: Opponent;
  frames: TurnFrame[];
}
