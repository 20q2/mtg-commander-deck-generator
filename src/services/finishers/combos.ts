/**
 * Infinite combos as FUEL, not as a separate list bolted on the side.
 *
 * A combo's `results` are a structured vocabulary, and most of them don't win on their own — they
 * make a finisher the deck already has lethal. Measured over the 11,667-combo golgari closure:
 *
 *   Infinite death triggers        6547   → makes Blood Artist / Zulaport lethal
 *   Infinite creature sacrifice    6288   → same
 *   Infinite * mana               ~4500   → every drain-x and burn-x gets X = infinity
 *   Infinite creature tokens      ~1600   → every alpha-strike gets unbounded bodies
 *   Infinite lifeloss / damage    ~2000   → wins outright
 *
 * "Infinite death triggers" being the single most common result is the point: the kill math
 * already had a `deaths` scaling variable that always returned null because nothing could supply
 * a value. This is that value.
 *
 * Only COMPLETE combos count. A near-miss (missing a card) is a deckbuilding note, not a kill.
 */

import type { DetectedCombo, EDHRECCombo, ScryfallCard } from '@/types';

/** What a combo's results do for the deck. */
export interface ComboClass {
  /** Wins on its own, with no other card needed. */
  wins: boolean;
  /** 'single' when the result names one opponent — it takes out a player, not the table. */
  winScope: 'table' | 'single';
  infiniteMana: boolean;
  infiniteTokens: boolean;
  infiniteDeaths: boolean;
}

/**
 * Whether a result wins the game on its own.
 *
 * Two qualifiers flip the meaning of an otherwise-lethal phrase and must be excluded FIRST:
 * "Infinite damage to creatures" is a board wipe, and "Infinite self-mill" (652 in the golgari
 * closure, more common than real mill) fills your OWN graveyard — it's combo fuel, not a kill.
 *
 * "Infinite turns" is counted as a win. Strictly it's a loop that draws unless you can close,
 * but a deck taking infinite turns is not a deck that can't close, and this lab exists to answer
 * that question.
 */
function isWinResult(result: string): boolean {
  if (/damage to (most |some |all )?creatures/i.test(result)) return false;
  if (/self-mill/i.test(result)) return false;
  return /win the game/i.test(result)
    || /(each|target|all|an?) (opponent|player)s? loses? the game/i.test(result)
    || /(near-)?infinite (lifeloss|damage|poison|mill)/i.test(result)
    || /infinite turns/i.test(result);
}

/** Results naming one opponent kill a player, not the table — the same cap applies. */
function isSingleTarget(result: string): boolean {
  return /target (opponent|player)|to one opponent|for one opponent/i.test(result);
}

export function classifyCombo(results: string[]): ComboClass {
  const wins = results.filter(isWinResult);
  return {
    wins: wins.length > 0,
    // Table-wide unless EVERY winning result is explicitly single-target.
    winScope: wins.length > 0 && wins.every(isSingleTarget) ? 'single' : 'table',
    infiniteMana: results.some(r => /(near-)?infinite\b.*\bmana/i.test(r)),
    infiniteTokens: results.some(r => /(near-)?infinite creature tokens/i.test(r)),
    infiniteDeaths: results.some(r =>
      /(near-)?infinite (death triggers|creature sacrifice triggers)/i.test(r)),
  };
}

/** Union of the combo flags across every complete combo in the deck. */
export function comboFuel(combos: DetectedCombo[]): Pick<
  import('@/types').DeckFuel, 'infiniteMana' | 'infiniteTokens' | 'infiniteDeaths'
> {
  const complete = combos.filter(c => c.isComplete);
  return {
    infiniteMana: complete.some(c => classifyCombo(c.results).infiniteMana),
    infiniteTokens: complete.some(c => classifyCombo(c.results).infiniteTokens),
    infiniteDeaths: complete.some(c => classifyCombo(c.results).infiniteDeaths),
  };
}

/** The deck's color identity — the union of every card's, which is what the combo index keys on. */
export function deriveColorIdentity(cards: ScryfallCard[]): string[] {
  const out = new Set<string>();
  for (const c of cards) for (const col of c.color_identity ?? []) out.add(col);
  return [...out];
}

/**
 * Which of the fetched combos are actually assembled in this deck.
 *
 * Deliberately stricter than the playtest resolver, which keeps near-misses so it can show you
 * what you're one card away from. Here a combo either scores or it doesn't exist.
 */
export function detectCompleteCombos(
  combos: EDHRECCombo[], deckNames: Set<string>,
): DetectedCombo[] {
  const out: DetectedCombo[] = [];
  for (const combo of combos) {
    const names = combo.cards.map(c => c.name);
    // DFC names in a decklist are often the front face alone; accept either form.
    const missing = names.filter(n => !deckNames.has(n) && !deckNames.has(n.split(' // ')[0]));
    if (missing.length > 0) continue;
    out.push({
      comboId: combo.comboId,
      cards: names,
      results: combo.results,
      isComplete: true,
      missingCards: [],
      deckCount: combo.deckCount,
      bracket: combo.bracket,
      source: combo.source ?? 'color-identity',
    });
  }
  // Most-played first — a 4000-deck combo is the deck's plan, a 3-deck one is a coincidence.
  return out.sort((a, b) => b.deckCount - a.deckCount);
}
