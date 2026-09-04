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
 * Creatures each opponent can block with, and how big they are.
 *
 * These replace a flat "connect rate", which multiplied total damage by 0.7 and let any card
 * granting trample bypass blocking entirely — so a Craterhoof swing was scored as though the
 * table were empty. That was tolerable while every alpha strike capped at one opponent; once
 * combat could claim the whole table it became the model's most optimistic assumption by far.
 *
 * Blocking is per-defender, which is what makes it interesting: attacking three opponents means
 * facing three separate blocking crews, so a wide board pays this cost once per player it wants
 * to kill. Trample pays only the blockers' toughness; no evasion loses whole attackers.
 */
export const BLOCKERS_PER_OPPONENT = 2;
export const BLOCKER_TOUGHNESS = 3;
/**
 * How much credit a TARGETED SPELL's damage beyond lethal-on-one-player earns.
 *
 * Applies to `burn-x` only. Combat no longer routes through this: attackers are assigned per
 * defender, so an alpha strike splits across the table on its own and its leftover damage is a
 * derived fact rather than a dial. For one Fireball, 0 is simply the truth — the excess is gone
 * unless you can recur or copy it, which is what turning this up models.
 */
export const OVERKILL_CREDIT = 0.0;
/**
 * Table fraction at which a card reads LIVE, and below which it reads WEAK then DEAD.
 *
 * With three opponents the meaningful steps are 0.33 / 0.67 / 1.00 — one, two, or all three
 * players dead. 0.25 sits deliberately just under "kills one opponent" so that a finisher which
 * takes a single player out still reads LIVE.
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
  blockersPerOpponent: number;
  blockerToughness: number;
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
  blockersPerOpponent: BLOCKERS_PER_OPPONENT,
  blockerToughness: BLOCKER_TOUGHNESS,
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
    hint: 'How many players must die. Caps targeted spells at 1/opponents' },
  { key: 'startingLife', label: 'Starting life', min: 20, max: 40, step: 1,
    hint: 'Life total each opponent must be reduced from' },
  { key: 'boardFraction', label: 'Board fraction', min: 0.1, max: 1, step: 0.05,
    hint: 'Share of creatures / ramp that has resolved by the target turn' },
  { key: 'tokensPerMaker', label: 'Tokens per maker', min: 0.5, max: 8, step: 0.5,
    hint: 'Average bodies each token producer has made by then' },
  { key: 'rampMultiplier', label: 'Ramp effectiveness', min: 0, max: 2, step: 0.1,
    hint: 'Mana actually gained per ramp card' },
  { key: 'blockersPerOpponent', label: 'Blockers each', min: 0, max: 6, step: 1,
    hint: 'Creatures each opponent can block with — paid once per player you attack' },
  { key: 'blockerToughness', label: 'Blocker size', min: 1, max: 8, step: 1,
    hint: 'Average blocker toughness. Trample loses only this; no evasion loses whole attackers' },
  { key: 'overkillCredit', label: 'Overkill credit', min: 0, max: 1, step: 0.05,
    hint: 'Targeted spells only. 0 = damage past lethal is wasted; 1 = every point is spendable' },
  { key: 'liveThreshold', label: 'LIVE at', min: 0, max: 1, step: 0.01,
    hint: 'Table fraction to read LIVE (note: single-target caps at 1/opponents)' },
  { key: 'weakThreshold', label: 'WEAK at', min: 0, max: 1, step: 0.01,
    hint: 'Below this reads DEAD' },
];
