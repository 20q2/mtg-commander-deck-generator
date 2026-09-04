/**
 * The one hand-written surface in the finisher model.
 *
 * `drain-static` cards each scale on a DIFFERENT board quantity — Gray Merchant on devotion,
 * Corrupt on Swamps, Blood Artist on deaths — and no oracle tag distinguishes them. This map says
 * which. It will always be incomplete; cards outside it resolve to `unknown` and are reported as
 * UNKNOWN with an explicit reason rather than silently scoring zero.
 *
 * `alt-win` cards name a precondition AND say which deck-level evidence would satisfy it. Some of
 * those are checkable from a card list (self-mill, five colors, Gates) and some genuinely are not
 * (Barren Glory's empty board). Checkable ones are checked; the rest score as UNKNOWN rather than
 * as a win, because "any deck containing Thassa's Oracle wins the game" was the single biggest
 * overclaim in the model.
 */

import type { DeckFuel, AltWinEnabler } from '@/types';
import type { FinisherAssumptions } from './tuning';

export type { AltWinEnabler };

export type ScalingVar =
  | 'devotion-w' | 'devotion-u' | 'devotion-b' | 'devotion-r' | 'devotion-g'
  | 'creatures'
  | 'swamps'
  | 'flat'
  | 'deaths'          // not modelled — needs a sac-loop simulation
  | 'lifegain-events' // not modelled — needs a lifegain-trigger count
  | 'unknown';

export interface ScalingRule { variable: ScalingVar; amount?: number }

/** Card name → what its drain scales on. */
export const SCALING_MAP: Record<string, ScalingRule> = {
  'Gray Merchant of Asphodel': { variable: 'devotion-b' },
  'Corrupt': { variable: 'swamps' },
  'Tendrils of Corruption': { variable: 'swamps' },
  'Kokusho, the Evening Star': { variable: 'flat', amount: 5 },
  'Blood Artist': { variable: 'deaths' },
  'Zulaport Cutthroat': { variable: 'deaths' },
  'Falkenrath Noble': { variable: 'deaths' },
  'Bastion of Remembrance': { variable: 'deaths' },
  'Cruel Celebrant': { variable: 'deaths' },
  'Vito, Thorn of the Dusk Rose': { variable: 'lifegain-events' },
  'Sanguine Bond': { variable: 'lifegain-events' },
  'Marauding Blight-Priest': { variable: 'lifegain-events' },
  'Epicure of Blood': { variable: 'lifegain-events' },
};

/**
 * Deck-level evidence an alternate win condition needs before it counts as a real plan.
 *
 * `unverifiable` is an honest answer, not a TODO: nothing in a decklist tells you whether you can
 * empty your board and hand for Barren Glory, and inventing a check would just relocate the
 * overclaim. Those cards stay listed and stay unscored.
 */
export interface AltWinRule {
  /** The condition, printed verbatim in the lab. */
  condition: string;
  /** What the deck must show before this is credited as a win. */
  needs: AltWinEnabler;
}

/** Card name → its precondition and the evidence that would satisfy it. */
export const ALT_WIN_CONDITIONS: Record<string, AltWinRule> = {
  "Thassa's Oracle": { condition: 'library empty or near-empty when it enters', needs: 'self-mill' },
  'Laboratory Maniac': { condition: 'draw from an empty library', needs: 'self-mill' },
  'Jace, Wielder of Mysteries': { condition: 'draw from an empty library', needs: 'self-mill' },
  'Approach of the Second Sun': { condition: 'cast it twice, 7 mana each', needs: 'unverifiable' },
  'Felidar Sovereign': { condition: '40+ life at your upkeep', needs: 'big-lifegain' },
  'Test of Endurance': { condition: '50+ life at your upkeep', needs: 'big-lifegain' },
  'Revel in Riches': { condition: '10 Treasures at your upkeep', needs: 'treasures' },
  'Mechanized Production': { condition: '8 copies of one artifact', needs: 'unverifiable' },
  'Coalition Victory': { condition: 'all five colors on lands and creatures', needs: 'five-colors' },
  "Maze's End": { condition: '10 Gates', needs: 'gates' },
  'Simic Ascendancy': { condition: '20 growth counters', needs: 'unverifiable' },
  'Helix Pinnacle': { condition: '100 tower counters', needs: 'unverifiable' },
  'Darksteel Reactor': { condition: '20 charge counters', needs: 'unverifiable' },
  "Azor's Elocutors": { condition: '5 filibuster counters', needs: 'unverifiable' },
  'Chance Encounter': { condition: '10 luck counters', needs: 'unverifiable' },
  'Near-Death Experience': { condition: 'exactly 1 life at your upkeep', needs: 'unverifiable' },
  'Barren Glory': { condition: 'empty board and hand at your upkeep', needs: 'unverifiable' },
  'Epic Struggle': { condition: '20 creatures at your upkeep', needs: 'unverifiable' },
  'Happily Ever After': { condition: 'all five colors, 5+ card types, 50+ life', needs: 'five-colors' },
  'Aetherflux Reservoir': { condition: '50+ life to pay for the 50-damage blast', needs: 'big-lifegain' },
};

/** The printed condition for a card, or null when it isn't in the map. */
export function altWinCondition(cardName: string): string | null {
  return ALT_WIN_CONDITIONS[cardName]?.condition ?? null;
}

/**
 * Whether the deck shows the evidence this win condition needs.
 *
 * `null` means "can't tell from a decklist" — distinct from `false`, which means we looked and the
 * support isn't there. The two read very differently in the workings column.
 */
export function altWinEnabled(rule: AltWinRule, fuel: DeckFuel): boolean | null {
  if (rule.needs === 'unverifiable') return null;
  return fuel.enablers[rule.needs] ?? false;
}

/** Why an alt-win didn't clear its evidence check. */
export function altWinShortfall(needs: AltWinEnabler): string {
  switch (needs) {
    case 'self-mill': return 'no way to empty your own library in this deck';
    case 'big-lifegain': return 'not enough lifegain to get there';
    case 'treasures': return 'not enough Treasure production';
    case 'five-colors': return 'this deck is not five colors';
    case 'gates': return 'not enough Gates';
    default: return 'setup not checkable from a decklist';
  }
}

/**
 * Lands on the battlefield at the modelled turn — one drop per turn, capped by how many you have
 * actually drawn. Shared with `manaCeiling` so mana and land-count scaling can't disagree.
 */
export function landsInPlay(fuel: DeckFuel, a: FinisherAssumptions): number {
  const landRatio = fuel.totalCards > 0 ? fuel.landCount / fuel.totalCards : 0;
  return Math.min(a.turn, (7 + a.turn) * landRatio);
}

/**
 * Resolve a scaling variable against the deck at the modelled turn. `null` means "not modelled".
 *
 * Every board quantity is discounted to what has actually HIT PLAY by then, the same way
 * `bodiesOnBoard` treats creatures. Reading these raw off the decklist was a large silent
 * overclaim: Gray Merchant scored on all ~99 cards' worth of devotion, and Corrupt scored on
 * every Swamp in the deck rather than the eight or so you have on turn eight.
 */
export function resolveScaling(
  rule: ScalingRule, fuel: DeckFuel, a: FinisherAssumptions,
): number | null {
  const onBoard = (n: number) => Math.round(n * a.boardFraction);
  switch (rule.variable) {
    case 'devotion-w': return onBoard(fuel.devotion.W ?? 0);
    case 'devotion-u': return onBoard(fuel.devotion.U ?? 0);
    case 'devotion-b': return onBoard(fuel.devotion.B ?? 0);
    case 'devotion-r': return onBoard(fuel.devotion.R ?? 0);
    case 'devotion-g': return onBoard(fuel.devotion.G ?? 0);
    case 'creatures': return onBoard(fuel.creatureCount);
    // Swamps follow the land curve, not the board fraction — lands come down on a schedule.
    case 'swamps': return fuel.landCount > 0
      ? Math.round(landsInPlay(fuel, a) * (fuel.swampCount / fuel.landCount))
      : 0;
    case 'flat': return rule.amount ?? 0;
    // A sac loop in the deck is what makes an aristocrats drain a kill. Without a combo supplying
    // the loop there's no honest number here, which is why this stayed null until combo detection
    // landed — and why a whole archetype read UNKNOWN.
    case 'deaths': return fuel.infiniteDeaths ? Infinity : null;
    // Same shape as `deaths`: a bounded guess at "how much life will you gain this turn" would be
    // invention, but an unbounded lifegain loop turns Vito into a table kill and is checkable.
    case 'lifegain-events': return fuel.infiniteLifegain ? Infinity : null;
    default: return null;
  }
}

/**
 * A one-shot drain read straight off the oracle text, for cards the curated map doesn't name.
 *
 * The curated map will always be incomplete, and "not in the map" was the single most common
 * UNKNOWN reason. This covers the unambiguous printed case — "each opponent loses 3 life" — so
 * only genuinely variable drains need a hand-written entry.
 *
 * Two exclusions, both found by running real cards through it:
 *  - `Whenever` — Blood Artist is "whenever a creature dies, each opponent loses 1 life", which is
 *    per-death, not a one-shot 1. Those belong to the `deaths` variable.
 *  - a `:` anywhere in the clause, which marks an ACTIVATED ability. Bontu the Glorified reads
 *    "{1}{B}, Sacrifice another creature: Scry 1. Each opponent loses 1 life" — repeatable, and
 *    reading it as a flat 1 put a 0.025 "finisher" in the deck's how-it-closes list.
 *
 * Both cases score as UNKNOWN instead, which is the right answer: the drain is real but its size
 * depends on how many times you can do it, and that isn't on the card.
 */
export function parseFlatDrain(oracleText: string): number | null {
  // Split by LINE, not by sentence. One oracle line is one ability, and the activation cost sits
  // at its head: Bontu's line is "{1}{B}, Sacrifice another creature: Scry 1. Each opponent loses
  // 1 life." — splitting on sentences puts the colon in a different fragment from the drain and
  // the check sails straight past it.
  for (const ability of oracleText.split('\n')) {
    if (/\bwhenever\b/i.test(ability) || ability.includes(':')) continue;
    const m = ability.match(/each (?:of your )?opponents? loses (\d+) life/i);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

/** Prose for the workings column when a variable isn't modelled. */
export function unmodelledReason(v: ScalingVar): string {
  if (v === 'deaths') return 'scales on creature deaths — no sac loop detected in this deck';
  if (v === 'lifegain-events') return 'scales on lifegain triggers — not counted yet';
  return 'scaling variable not in the curated map';
}
