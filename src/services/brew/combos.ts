import type { BrewContext, BrewState } from './brewTypes';

export interface NearMissCombo {
  comboId: string;
  missing: string[];     // card names still needed (all guaranteed present in the pool)
  have: string[];        // combo pieces already owned (commander/partner/picks) — the cards it pairs with
  results: string[];
  deckCount: number;
}

/** Add a name + its front-face (DFC) to a set. */
function addName(set: Set<string>, name: string): void {
  set.add(name);
  if (name.includes(' // ')) set.add(name.split(' // ')[0]);
}

/**
 * How much we *want* to surface a combo for its payoff, independent of how achievable it is.
 * EDHREC result strings are free text, so we match on intent. Higher = better. A combo's rank is
 * the best (max) of its result lines, so a "blink, then deal infinite damage" combo ranks as damage.
 * "Draw the game" is a literal stalemate — the opposite of a wincon — so it sinks below everything.
 */
const PAYOFF_TIERS: { match: RegExp; rank: number }[] = [
  // Decisive — these straight-up end the game.
  { match: /\bwin the game\b|infinite damage|infinite mill|infinite life ?loss|infinite drain|exile (?:all|your opponents)/i, rank: 5 },
  // Floods the board — converts into a win with the rest of the deck.
  { match: /infinite (?:creature )?tokens?/i, rank: 4 },
  // Unbounded mana — fuels almost any payoff.
  { match: /infinite (?:colou?red |colou?rless )?mana/i, rank: 3 },
  // Card / life engines — strong, but not a kill on their own.
  { match: /infinite (?:card )?draw|draw your (?:library|deck)|infinite life\b/i, rank: 2 },
  // Loops that need a separate payoff to matter (blink, untap, storm count…).
  { match: /infinite (?:blink|flicker|untap|cast|storm|landfall|loot|bounce|combat)/i, rank: 1 },
  // A stalemate, not a win — actively deprioritise.
  { match: /draw the game/i, rank: -1 },
];

/** Best payoff tier across a combo's result lines (0 if none recognised; negative = deprioritised). */
export function payoffRank(results: string[]): number {
  let best: number | null = null;
  for (const r of results) {
    for (const tier of PAYOFF_TIERS) {
      if (tier.match.test(r) && (best === null || tier.rank > best)) best = tier.rank;
    }
  }
  return best ?? 0;
}

/**
 * Combos the current deck is 1-2 cards short of, where every missing piece is available
 * in the candidate pool and at least one piece is already owned (commander or a pick).
 * Sorted by fewest missing, then popularity.
 */
export function detectNearMissCombos(ctx: BrewContext, state: BrewState): NearMissCombo[] {
  const owned = new Set<string>();
  addName(owned, ctx.commander.name);
  if (ctx.partnerCommander) addName(owned, ctx.partnerCommander.name);
  for (const n of state.usedNames) addName(owned, n);

  const used = new Set(state.usedNames);
  const poolNames = new Set(ctx.candidates.filter(c => !used.has(c.name)).map(c => c.name));

  const out: NearMissCombo[] = [];
  for (const combo of ctx.combos) {
    const names = combo.cards.map(c => c.name);
    const missing = names.filter(n => !owned.has(n));
    const have = names.filter(n => owned.has(n));
    const ownedCount = have.length;
    if (missing.length === 0) continue;            // already complete
    if (missing.length > 2) continue;              // too far
    if (ownedCount < 1) continue;                  // not a near-miss yet
    if (!missing.every(n => poolNames.has(n))) continue; // can't actually complete it
    out.push({ comboId: combo.comboId, missing, have, results: combo.results, deckCount: combo.deckCount });
  }
  // Payoff quality first (a decisive combo is worth chasing even if it's a card further off),
  // then how close we are to finishing it, then popularity.
  out.sort((a, b) =>
    (payoffRank(b.results) - payoffRank(a.results)) ||
    (a.missing.length - b.missing.length) ||
    (b.deckCount - a.deckCount));
  // Collapse combos that ask for the SAME missing piece(s): from the player's seat those are one
  // decision ("add Magistrate's Scepter") that happens to complete several listed lines, so showing
  // each as a separate "combo within reach" inflates the count and reads as redundant. Keep the
  // best-ranked representative per missing-set (the sort above already ordered them), so "3 combos"
  // means three genuinely different next cards, not the same card three ways.
  const seenMissing = new Set<string>();
  const deduped: NearMissCombo[] = [];
  for (const nm of out) {
    const key = [...nm.missing].sort().join('|');
    if (seenMissing.has(key)) continue;
    seenMissing.add(key);
    deduped.push(nm);
  }
  return deduped;
}
