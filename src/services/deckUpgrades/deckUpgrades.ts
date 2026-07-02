/** A recommended card with the signals we surface in the upgrade panel. */
export interface RankedCard {
  name: string;
  inclusion: number;   // EDHREC inclusion percentage (0-100)
  synergy?: number;
  isNew?: boolean;     // EDHREC "new cards" flag
}

/**
 * Cards that are recommended, not already in the deck, and not yet seen.
 * Preserves recommendation order (highest relevance first).
 */
export function computeNewUpgrades(
  recommendations: string[],
  deckCardNames: string[],
  seen: string[],
): string[] {
  const inDeck = new Set(deckCardNames);
  const seenSet = new Set(seen);
  const out: string[] = [];
  for (const name of recommendations) {
    if (inDeck.has(name) || seenSet.has(name)) continue;
    out.push(name);
  }
  return out;
}

/**
 * First-sight baseline: seed `seen` with everything currently recommended so a
 * deck opened for the first time flags nothing as "new". Only cards recommended
 * in a LATER fetch (i.e. after the world moves) will surface.
 */
export function baselineSeen(recommendations: string[]): string[] {
  return [...recommendations];
}
