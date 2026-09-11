import type { TokenSpec } from '@/services/playtest/opponents/effects';

/**
 * The combos a bot knows how to assemble and fire.
 *
 * This is the piece that lets a high-bracket deck be honest about itself. A
 * bracket is anchored on how fast a deck can win, and a high one wins by
 * assembling two or three cards — which is exactly what this engine could not
 * do. There is no stack and no rules engine, so "Kiki-Jiki plus Zealous
 * Conscripts makes infinite hasty copies" cannot emerge from the cards. But it
 * does not have to emerge: we know which decks are on the table and which
 * combos are in them, so the line is written down.
 *
 * Same bet as the rest of `effects.ts` — curate the cards, don't parse them.
 *
 * ## What does NOT belong here
 *
 * Only lines the engine cannot already express. Purphoros plus Krenko is not a
 * combo entry: `BOT_TRIGGERS` already bills two damage per token and Krenko
 * already doubles the goblins, so writing it down again would deal the damage
 * twice. If the pieces produce the result through rules the engine models, let
 * them.
 *
 * ## Why a bot telegraphs before it fires
 *
 * A bot that silently wins on turn four is a loss screen, not a playtest. The
 * value of putting a combo deck across the table is the pressure it applies:
 * you can see the pieces land, and you have a turn to answer them. So a combo
 * that comes live is *announced* on the turn it assembles and executed on the
 * next one, which is also roughly how a real combo player behaves — the pieces
 * are permanents, sitting face up, waiting on mana.
 *
 * Killing a piece in that window is a real out, and the playtest already gives
 * you the tools: the seat's kill button, or any removal in your own deck.
 */

export type ComboOutcome =
  /** The table is dead. Ends the game in the bot's favour. */
  | { kind: 'winTheGame' }
  /** A finite but enormous amount of damage — an unbounded damage loop, capped. */
  | { kind: 'damage'; amount: number }
  /** An arbitrarily large board. Bounded by MAX_BOARD like any other tokens. */
  | { kind: 'makeTokens'; tokens: TokenSpec[] };

export interface BotCombo {
  id: string;
  /** Shown in the log and on the seat when it arms. */
  name: string;
  /**
   * Permanents that must be on the bot's battlefield. Matched by card name, so
   * a token copy of a piece counts — which is correct for most loops.
   */
  onBattlefield: string[];
  /** Cards that must be in hand: the spell it casts to finish the line. */
  inHand?: string[];
  /** Total mana to execute, on top of already holding the pieces. */
  mana: number;
  outcome: ComboOutcome;
  /**
   * One line saying what the loop actually does, logged when it fires. A
   * playtest where you lose without learning why teaches nothing.
   */
  how: string;
}

/**
 * Authored per deck. Everything here is a two- or three-card line from a real
 * precon; the point is that each is written out rather than deduced.
 *
 * `mana` is what the bot must have untapped to go off, colours ignored as
 * everywhere else. Where a line is free once assembled, it is 0 — and the
 * telegraph is then the only window you get.
 */
export const BOT_COMBOS: BotCombo[] = [
  {
    id: 'kiki-conscripts',
    name: 'Kiki-Jiki + Zealous Conscripts',
    onBattlefield: ['Kiki-Jiki, Mirror Breaker', 'Zealous Conscripts'],
    mana: 0,
    outcome: { kind: 'damage', amount: 40 },
    how: 'Kiki-Jiki copies Zealous Conscripts, which untaps Kiki-Jiki — infinite hasty copies.',
  },
  {
    id: 'sanguine-blood',
    name: 'Sanguine Bond + Exquisite Blood',
    onBattlefield: ['Sanguine Bond', 'Exquisite Blood'],
    mana: 0,
    outcome: { kind: 'winTheGame' },
    how: 'Each drains you, each triggers the other — the loop only stops when you are at zero.',
  },
  {
    id: 'thoracle-consult',
    name: "Thassa's Oracle + Demonic Consultation",
    onBattlefield: ["Thassa's Oracle"],
    inHand: ['Demonic Consultation'],
    mana: 1,
    outcome: { kind: 'winTheGame' },
    how: 'Consultation exiles the library, so the Oracle sees an empty deck and wins on resolution.',
  },
];

/**
 * Every combo piece worth tutoring for, and how many cards that line is still
 * short — 1 for a line one card from live, 2 for one it has not started.
 *
 * `missingComboPieces` deliberately answers a narrower question (what completes
 * a line RIGHT NOW) and several callers want exactly that. But a tutor is not
 * one of them: a combo deck holding a Demonic Tutor and neither piece goes and
 * gets the first half, and scoring only "one away" meant the bot could tutor
 * for a piece only after it had already drawn the other one by luck. That made
 * a bracket-4 deck play like a bracket-1 one.
 */
export function comboPiecesWanted(
  battlefield: string[],
  hand: string[],
  decks?: BotCombo[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const combo of decks ?? BOT_COMBOS) {
    const held = [...battlefield, ...hand];
    const missing: string[] = [];
    for (const name of [...combo.onBattlefield, ...(combo.inHand ?? [])]) {
      const i = held.indexOf(name);
      if (i >= 0) held.splice(i, 1);
      else missing.push(name);
    }
    if (missing.length === 0) continue;
    for (const name of missing) {
      // A card on two lines is worth whichever is closer to going off.
      const prev = out.get(name);
      if (prev === undefined || missing.length < prev) out.set(name, missing.length);
    }
  }
  return out;
}

export interface ComboContext {
  /** Card names on the bot's battlefield. */
  battlefield: string[];
  /** Card names in the bot's hand. */
  hand: string[];
  /** Untapped mana available right now. */
  mana: number;
}

/** Is every piece of this combo present and payable? */
export function comboIsLive(combo: BotCombo, ctx: ComboContext): boolean {
  if (combo.mana > ctx.mana) return false;
  // Counted, not just present: a line needing two copies of a piece needs two.
  const has = (need: string[], pool: string[]) => {
    const left = [...pool];
    for (const n of need) {
      const i = left.indexOf(n);
      if (i < 0) return false;
      left.splice(i, 1);
    }
    return true;
  };
  if (!has(combo.onBattlefield, ctx.battlefield)) return false;
  return has(combo.inHand ?? [], ctx.hand);
}

/**
 * Cards this bot is exactly one short of, across every line it knows.
 *
 * This is what makes a tutor look like a player rather than a random draw: a
 * goblin deck holding Kiki-Jiki and a Goblin Matron should go and find Zealous
 * Conscripts, not fetch the biggest goblin in the deck.
 *
 * A piece already in hand counts as held — the bot needs to cast it, not search
 * for a second copy. And only a one-card gap counts: chasing a line you are
 * three cards away from is indistinguishable from noise.
 */
export function missingComboPieces(
  battlefield: string[],
  hand: string[],
  decks?: BotCombo[],
): string[] {
  const out = new Set<string>();
  for (const combo of decks ?? BOT_COMBOS) {
    const held = [...battlefield, ...hand];
    const missing: string[] = [];
    for (const name of [...combo.onBattlefield, ...(combo.inHand ?? [])]) {
      const i = held.indexOf(name);
      if (i >= 0) held.splice(i, 1);
      else missing.push(name);
    }
    if (missing.length === 1) out.add(missing[0]);
  }
  return [...out];
}

/**
 * Every combo this bot could fire right now, best outcome first, so a deck
 * holding two live lines takes the one that actually ends it.
 */
export function liveCombos(ctx: ComboContext, decks?: BotCombo[]): BotCombo[] {
  const rank = (c: BotCombo) =>
    c.outcome.kind === 'winTheGame' ? 0
    : c.outcome.kind === 'damage' ? 1
    : 2;
  return (decks ?? BOT_COMBOS)
    .filter(c => comboIsLive(c, ctx))
    .sort((a, b) => rank(a) - rank(b));
}
