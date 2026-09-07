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
  /**
   * Combo ids this bot has announced and will execute next turn. A combo is
   * telegraphed on the turn it assembles and fired on the following one, so
   * there is always exactly one window to break it up.
   */
  armedCombos?: string[];
}

/**
 * Which Commander bracket a seat plays at, 1 (Exhibition) to 5 (cEDH).
 *
 * Since the October 2025 revision a bracket is anchored on how quickly a deck
 * expects to win — roughly turn 9+, 8+, 6+, 4+, and any — rather than on a
 * power-level vibe. That matters here because it is measurable: unlike the
 * Inspector, which has to estimate a stranger's bracket from a card list, we
 * own these decks and can measure their kill turn in the diagnostic. A label
 * on a seat is a claim we can check.
 *
 * Note that stock precons all sit at 2 by definition — bracket 2 IS
 * "precon-level power" — so 1 and 3 are a de-tune and an upgrade of one, and
 * 4 and 5 are built rather than bought.
 */
export type Bracket = 1 | 2 | 3 | 4 | 5;

export const BRACKET_LABELS: Record<Bracket, { name: string; hint: string }> = {
  1: { name: 'Exhibition', hint: 'Built around a theme rather than around winning. Expect to be around past turn nine.' },
  2: { name: 'Core',       hint: 'Precon-level power. Strong cards, no fast combos — what most tables expect.' },
  3: { name: 'Upgraded',   hint: 'Tuned mana and a real win condition. Wins from about turn six.' },
  4: { name: 'Optimized',  hint: 'Efficient interaction and a compact win condition. Can win from turn four.' },
  5: { name: 'cEDH',       hint: 'Playing to win. Will kill you as fast as it can assemble.' },
};

export interface OpponentStub {
  id: string;
  name: string;
  blurb: string;
  commander: string;
  colors: string[];
  /** 1-5. See `Bracket` — this is a claim the diagnostic can check. */
  bracket: Bracket;
  /**
   * The real product this list came from, when it came from one. Shown on the
   * seat picker, because "this is the actual precon" is the whole reason to
   * sit down across from it.
   */
  source?: string;
  /** Entries are "<qty> <card name>". */
  cards: string[];
}

/** Who a bot's attack is pointed at. */
export type AttackTarget =
  | { kind: 'player' }
  | { kind: 'opponent'; id: string; name: string };

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
   * Life the player loses from the bot's own triggers this beat — an Impact
   * Tremors or a Purphoros firing off its creatures. Separate from `effects`,
   * which describe things done to the player's permanents.
   */
  selfDamage?: number;
  /**
   * Instance ids on the bot's board that are attacking. Non-empty only on the
   * attack beat. An attack on YOU stops the turn while you block; an attack on
   * another seat is resolved by the store without pausing, since both sides of
   * it are decided by the bots.
   */
  attackers: string[];
  /** Who those attackers are pointed at. Absent on non-attack beats. */
  attackTarget?: AttackTarget;
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
