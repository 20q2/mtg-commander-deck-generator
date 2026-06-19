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
  out.sort((a, b) => (a.missing.length - b.missing.length) || (b.deckCount - a.deckCount));
  return out;
}
