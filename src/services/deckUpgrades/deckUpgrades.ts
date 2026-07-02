/** A recommended card with the signals we surface in the upgrade panel. */
export interface RankedCard {
  name: string;
  inclusion: number;   // EDHREC inclusion percentage (0-100)
  synergy?: number;
  isNew?: boolean;     // EDHREC "new cards" flag
}

/** A new-card candidate before deck-fit ranking. */
export interface UpgradeCandidate {
  name: string;
  inclusion: number;
  synergy?: number;
  /** Came from an intended-theme new-cards pool (or EDHREC's theme-synergy flag). */
  fromTheme?: boolean;
}

/** Minimal lift-pool row (structurally matches the EDHREC client's CardLiftEntry). */
export interface LiftPoolEntry { name: string; lift: number; coPct: number; numDecks: number; }

// Same composite as the Lift Web (see liftClusters.edgeScore): lift × co-occurrence,
// damped by sample size, so a high-lift fluke with no adoption scores near zero.
const CONFIDENCE_K = 50;

/** Score of a single candidate→deck-card lift edge. */
export function liftEdgeScore(e: LiftPoolEntry): number {
  return e.lift * e.coPct * (e.numDecks / (e.numDecks + CONFIDENCE_K));
}

/**
 * The lift edges from a candidate's own card page to cards ALREADY in this deck,
 * strongest first. Direction matters — we fetch the candidate's pool (one page
 * per candidate, bounded) rather than scanning every deck card's pool (a page
 * per deck card, ~60 fetches).
 */
export function deckLiftEdges(candidatePool: LiftPoolEntry[], deckNames: Set<string>): LiftPoolEntry[] {
  return candidatePool
    .filter(e => deckNames.has(e.name))
    .sort((a, b) => liftEdgeScore(b) - liftEdgeScore(a));
}

/** Deck-fit evidence for one candidate: summed edge scores against the deck. */
export function liftFitScore(candidatePool: LiftPoolEntry[], deckNames: Set<string>): number {
  return deckLiftEdges(candidatePool, deckNames).reduce((s, e) => s + liftEdgeScore(e), 0);
}

// Deck-specific lift evidence dominates; commander-page synergy and intended-theme
// membership refine. Lift fit is normalized against the round's best so the weights
// stay meaningful whatever the deck's absolute lift magnitudes are.
const WEIGHT_LIFT = 2.0;
const WEIGHT_THEME = 0.5;

/** Rank candidates by blended deck fit. Pure; ties break by inclusion then name. */
export function rankUpgradeCandidates<T extends UpgradeCandidate>(
  scored: { candidate: T; liftFit: number }[],
): T[] {
  const maxFit = Math.max(0, ...scored.map(s => s.liftFit));
  const composite = (s: { candidate: T; liftFit: number }) =>
    (maxFit > 0 ? (s.liftFit / maxFit) * WEIGHT_LIFT : 0)
    + (s.candidate.synergy ?? 0)
    + (s.candidate.fromTheme ? WEIGHT_THEME : 0);
  return [...scored]
    .sort((a, b) =>
      composite(b) - composite(a)
      || b.candidate.inclusion - a.candidate.inclusion
      || a.candidate.name.localeCompare(b.candidate.name))
    .map(s => s.candidate);
}

/**
 * Intended themes for decks saved before `usedThemes` was persisted: recover them
 * from the human-readable generation summary ("Built with: Tokens, Aristocrats · …").
 */
export function parseIntendedThemes(generationSummary?: string): string[] {
  const m = generationSummary?.match(/Built with:\s*([^·]+)/);
  return m ? m[1].split(',').map(s => s.trim()).filter(Boolean) : [];
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
