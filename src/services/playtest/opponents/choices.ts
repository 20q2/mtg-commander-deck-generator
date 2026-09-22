/**
 * What a bot gives up when YOU make it choose.
 *
 * The other decision modules run on the bot's own turn — `evaluate` aims its
 * removal, `combatChoices` picks its blocks. This one runs on yours: you cast
 * Rise of the Witch-king, every seat has to sacrifice a creature, and somebody
 * has to decide which. Until this existed the answer was "you do", by hand, for
 * each of three seats — which is both tedious and a conflict of interest.
 *
 * Pure, like its siblings: an `Opponent` in, instance ids or hand indexes out.
 * The store owns the moving of cards and the firing of death triggers.
 *
 * The ranking is deliberately simple and deliberately explainable — you should
 * be able to look at what a bot gave up and agree that a player would have given
 * up the same thing. Two exceptions sit above the arithmetic: a bot never hands
 * over an armed combo piece or its commander while it has any other legal
 * choice. An edict that takes the Thoracle while a Llanowar Elves stands next to
 * it isn't a hard choice, it's a broken one.
 */

import { isLand } from '@/components/playtest/utils';
import {
  botPower, botToughness, effectiveCost, isTokenCard, typeLineOf,
} from '@/services/playtest/opponents/stats';
import { BOT_COMBOS } from '@/services/playtest/opponents/botCombos';
import type { Opponent, OpponentPermanent } from '@/components/playtest/opponentTypes';

/** The type a "sacrifice a ___" or "return a ___" asks for. */
export type ChoiceType = 'creature' | 'permanent' | 'artifact' | 'enchantment' | 'land';

/** Reads as the tail of "Grix sacrifices…" / "Return…". */
export const CHOICE_LABEL: Record<ChoiceType, string> = {
  creature: 'a creature',
  permanent: 'a permanent',
  artifact: 'an artifact',
  enchantment: 'an enchantment',
  land: 'a land',
};

/**
 * One question put to a seat. `of` is the type the card names — "sacrifice a
 * creature", "return an artifact to its owner's hand". A discard names no type
 * because a hand has none to choose between.
 */
/** Which way a permanent is being taken — see `TOKEN_SWING`. */
export type GiveUpMode = 'sacrifice' | 'bounce';

export type BotDecision =
  | { kind: 'sacrifice'; of: ChoiceType }
  | { kind: 'bounce'; of: ChoiceType }
  | { kind: 'discard' };

/** Never given up while anything else is legal. See the module note. */
const COMBO_PIECE = 1000;
const COMMANDER = 600;

/**
 * A token is the thing you reach for first when something must DIE — it is not
 * a card, it leaves no corpse worth reanimating, and a player facing an edict
 * sacrifices one without thinking. Small enough that a 4/4 token still outranks
 * a 1/1 body.
 *
 * It flips sign for a bounce, and that is not a detail. Returning a creature to
 * hand costs a real card nothing but tempo — you get the card back — while
 * returning a token destroys it outright. So the one permanent a bot should
 * never choose to bounce is the very one it would sacrifice first, and a single
 * ranking used for both would have had every bot answering Whelming Wave by
 * killing its own token army.
 */
const TOKEN_SWING = 3;

/** Below this, a land is the game rather than a spare resource. */
const LAND_SCARCITY_FLOOR = 4;

/** A land the bot is still counting on. High enough to outrank every spell. */
const KEEP_LAND = 500;

/** Does this permanent answer the question being asked? */
export function matchesChoice(p: OpponentPermanent, of: ChoiceType): boolean {
  if (of === 'permanent') return true;
  return typeLineOf(p).toLowerCase().includes(of);
}

/** Names on the battlefield half of any combo this bot has actually armed. */
function armedPieces(o: Opponent): Set<string> {
  const ids = o.armedCombos ?? [];
  if (ids.length === 0) return new Set();
  return new Set(BOT_COMBOS.filter(c => ids.includes(c.id)).flatMap(c => c.onBattlefield));
}

/**
 * Roughly what this permanent is worth to the bot, on one scale across types so
 * "sacrifice a permanent" can compare a land against a creature.
 *
 * Creatures are power-weighted, which is the same call the engine already makes
 * when it pays Diabolic Intent's additional cost — the bot should not value its
 * board one way for its own costs and another way for yours.
 */
function keepValue(
  p: OpponentPermanent,
  o: Opponent,
  pieces: Set<string>,
  mode: GiveUpMode,
): number {
  let v = 0;
  if (pieces.has(p.card.name)) v += COMBO_PIECE;
  if (o.commanderName && p.card.name === o.commanderName) v += COMMANDER;

  const type = typeLineOf(p).toLowerCase();
  if (type.includes('creature')) {
    v += botPower(p, o.battlefield, o.graveyard) * 2 + botToughness(p, o.battlefield, o.graveyard);
  } else if (isLand(p.card)) {
    // A land is worth about a cheap rock, plus a lot more while the bot is
    // still climbing its curve — giving up land number three costs it the turn.
    const lands = o.battlefield.filter(x => isLand(x.card)).length;
    v += (type.includes('basic') ? 3 : 5) + (lands <= LAND_SCARCITY_FLOOR ? 10 : 0);
  } else {
    // Rocks, enchantments, walkers: what it paid, plus a floor so a Sol Ring
    // isn't cheaper to lose than a Wastes.
    v += effectiveCost(p.card, o.battlefield) + 3;
  }

  if (isTokenCard(p.card)) v += mode === 'bounce' ? TOKEN_SWING : -TOKEN_SWING;
  return v;
}

/**
 * The permanents this bot would hand over, worst first.
 *
 * Returns fewer than `count` when it has fewer to give — "each player sacrifices
 * two creatures" against a bot holding one is one creature, not an error.
 */
export function pickPermanentsToGiveUp(
  o: Opponent,
  of: ChoiceType,
  count = 1,
  mode: GiveUpMode = 'sacrifice',
): string[] {
  const pieces = armedPieces(o);
  return o.battlefield
    .filter(p => matchesChoice(p, of))
    .map(p => ({ id: p.instanceId, value: keepValue(p, o, pieces, mode) }))
    .sort((a, b) => a.value - b.value)
    .slice(0, Math.max(0, count))
    .map(x => x.id);
}

/** True when this seat has anything at all to give up of that type. */
export function canGiveUp(o: Opponent, of: ChoiceType): boolean {
  return o.battlefield.some(p => matchesChoice(p, of));
}

/**
 * How many lands a bot wants to keep in hand rather than pitch.
 *
 * One, until it has enough on board that another is a dead draw. A bot that
 * discarded its only land on turn two because a land is "cheap" would be
 * throwing the game away to a heuristic.
 */
function landsWorthKeeping(landsInPlay: number): number {
  return landsInPlay >= 6 ? 0 : 1;
}

/**
 * Which cards this bot pitches, worst first — the choose-a-card half of a
 * discard, as opposed to `discardRandom`, which is what Mind Rot does.
 *
 * Spare lands go first, then the top of its curve: the card it is least likely
 * to live long enough to cast. Combo pieces and the lands it still needs stay.
 */
export function pickCardsToDiscard(o: Opponent, count = 1): number[] {
  const pieces = armedPieces(o);
  const landsInPlay = o.battlefield.filter(p => isLand(p.card)).length;

  // Which of the lands in hand are spares. Decided as a group rather than per
  // card, because "is this land excess" is a question about the whole hand.
  const landIdx = o.hand.map((c, i) => (isLand(c) ? i : -1)).filter(i => i >= 0);
  const keeping = new Set(landIdx.slice(0, landsWorthKeeping(landsInPlay)));

  return o.hand
    .map((card, i) => {
      if (pieces.has(card.name)) return { i, value: COMBO_PIECE };
      if (isLand(card)) return { i, value: keeping.has(i) ? KEEP_LAND : -COMBO_PIECE };
      // Everything else: the most expensive thing goes first. Negative so the
      // sort, which is worst-first, reaches for the top of the curve.
      return { i, value: -effectiveCost(card, o.battlefield) };
    })
    .sort((a, b) => a.value - b.value)
    .slice(0, Math.max(0, count))
    .map(x => x.i)
    // Descending, so a caller splicing them out of the hand one at a time
    // doesn't invalidate the indexes it hasn't used yet.
    .sort((a, b) => b - a);
}

/**
 * The engine's own sacrifice costs run through here too — see the note on
 * `keepValue`. Creature-only and single, which is every additional cost the
 * registry models today.
 */
export function pickSacrificeFodder(o: Opponent): OpponentPermanent | null {
  const [id] = pickPermanentsToGiveUp(o, 'creature', 1);
  return o.battlefield.find(p => p.instanceId === id) ?? null;
}
