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
  /** What to do to the player's board. Described here, applied by the store. */
  effects: AppliedEffect[];
  damageToPlayer: number;
}

/** One bot's turn, as a value — the store applies it. */
export interface TurnResult {
  final: Opponent;
  frames: TurnFrame[];
}
