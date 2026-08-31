/**
 * Every knob for finisher kill math, in one file on purpose — same contract as
 * `src/services/themes/tuning.ts`.
 *
 * These values are GUESSES. The whole point of the Finishers tab in `/lab` is to make them
 * answerable by looking rather than by arguing. The page overrides any of them live; write the
 * winner back here once it stops moving.
 */

/** The turn we model the board at. Eight is roughly when Commander games are decided. */
export const TURN = 8;
/** Opponents at the table. Drives the single-target cap of 1/opponents. */
export const OPPONENTS = 3;
export const STARTING_LIFE = 40;
/**
 * What share of the deck's creatures / token makers have actually resolved by `TURN`.
 * 0.4 of a 30-creature deck is 12 bodies, which is about what a real go-wide board looks like
 * on turn eight.
 */
export const BOARD_FRACTION = 0.4;
/** Average bodies a token maker has produced by `TURN`. */
export const TOKENS_PER_MAKER = 2.5;
/** How much of a ramp card's mana is actually available. 1.0 = every ramp spell resolved. */
export const RAMP_MULTIPLIER = 1.0;
/**
 * Share of an alpha strike that connects when the card grants NO trample or evasion.
 * Cards that grant it (Craterhoof, Overrun) bypass this entirely.
 */
export const UNBLOCKED_FRACTION = 0.7;
/**
 * How much credit damage beyond lethal-on-one-player earns.
 *
 * 0 is a pure cap: Craterhoof's 224 damage into a 40-life player scores exactly one kill and
 * throws away 184. 1 assumes you can spend every point (multiple combats, split attacks). The
 * truth is in between and depends on the board, which a card list cannot see — hence a slider.
 */
export const OVERKILL_CREDIT = 0.0;
/**
 * Table fraction at which a card reads LIVE, and below which it reads WEAK then DEAD.
 *
 * These interact with the single-target cap and it is easy to get wrong: an `alpha-strike` can
 * never exceed 1/OPPONENTS = 0.33, so a live threshold above that makes every Craterhoof in the
 * format read DEAD. 0.25 sits deliberately just under the cap.
 */
export const LIVE_THRESHOLD = 0.25;
export const WEAK_THRESHOLD = 0.10;

/** The full knob set, as data — this is what the lab edits and passes back in. */
export interface FinisherAssumptions {
  turn: number;
  opponents: number;
  startingLife: number;
  boardFraction: number;
  tokensPerMaker: number;
  rampMultiplier: number;
  unblockedFraction: number;
  overkillCredit: number;
  liveThreshold: number;
  weakThreshold: number;
}

export const DEFAULT_ASSUMPTIONS: FinisherAssumptions = {
  turn: TURN,
  opponents: OPPONENTS,
  startingLife: STARTING_LIFE,
  boardFraction: BOARD_FRACTION,
  tokensPerMaker: TOKENS_PER_MAKER,
  rampMultiplier: RAMP_MULTIPLIER,
  unblockedFraction: UNBLOCKED_FRACTION,
  overkillCredit: OVERKILL_CREDIT,
  liveThreshold: LIVE_THRESHOLD,
  weakThreshold: WEAK_THRESHOLD,
};

/** Human labels + sane input bounds for the lab's assumptions panel. */
export const ASSUMPTION_FIELDS: {
  key: keyof FinisherAssumptions; label: string; min: number; max: number; step: number; hint: string;
}[] = [
  { key: 'turn', label: 'Turn', min: 4, max: 15, step: 1,
    hint: 'Which turn we model the board and mana at' },
  { key: 'opponents', label: 'Opponents', min: 1, max: 5, step: 1,
    hint: 'Caps single-target shapes at 1/opponents of the table' },
  { key: 'startingLife', label: 'Starting life', min: 20, max: 40, step: 1,
    hint: 'Life total each opponent must be reduced from' },
  { key: 'boardFraction', label: 'Board fraction', min: 0.1, max: 1, step: 0.05,
    hint: 'Share of creatures / ramp that has resolved by the target turn' },
  { key: 'tokensPerMaker', label: 'Tokens per maker', min: 0.5, max: 8, step: 0.5,
    hint: 'Average bodies each token producer has made by then' },
  { key: 'rampMultiplier', label: 'Ramp effectiveness', min: 0, max: 2, step: 0.1,
    hint: 'Mana actually gained per ramp card' },
  { key: 'unblockedFraction', label: 'Connect rate', min: 0, max: 1, step: 0.05,
    hint: 'Share of an alpha strike that lands without trample/evasion' },
  { key: 'overkillCredit', label: 'Overkill credit', min: 0, max: 1, step: 0.05,
    hint: '0 = damage past lethal is wasted; 1 = every point is spendable' },
  { key: 'liveThreshold', label: 'LIVE at', min: 0, max: 1, step: 0.01,
    hint: 'Table fraction to read LIVE (note: single-target caps at 1/opponents)' },
  { key: 'weakThreshold', label: 'WEAK at', min: 0, max: 1, step: 0.01,
    hint: 'Below this reads DEAD' },
];
