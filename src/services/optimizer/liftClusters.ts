import type { ScryfallCard } from '@/types';
import { fetchCardLiftPool, type CardLiftEntry } from '@/services/edhrec/client';
import { getCardsByNames, isLand } from '@/services/scryfall/client';

/**
 * Deck-wide lift discovery (experimental "Lift Web").
 *
 * Each card in the deck is a seed; EDHREC's card page lists every card played alongside it with a real
 * `lift` (how many times more often it co-occurs than its baseline predicts) and a co-occurrence %.
 * We aggregate those into per-candidate "edges" — one per deck card that lifts the candidate, so every
 * result is anchored to cards you actually run. The UI then surfaces two extremes: bombs (one insane
 * single-card lift) and clusters (lifted by several of your cards). Pure reuse of fetchCardLiftPool +
 * getCardsByNames — no graph, no brew context.
 */

/** One deck card's lift relationship to a candidate. */
export interface LiftEdge { seed: string; lift: number; coPct: number; numDecks: number; }

export interface LiftCandidate {
  card: ScryfallCard;
  edges: LiftEdge[];
  connectionCount: number; // how many of your cards list it
  bestLift: number;        // max lift across edges (display)
  bestCoPct: number;       // max co-occurrence % across edges (display)
  bestNumDecks: number;    // strongest co-occurrence support — drives the low-confidence flag
}

/** Aggregation row before the card is resolved/filtered. */
export type LiftCandidateAgg = Omit<LiftCandidate, 'card'> & { name: string };

const RESOLVE_CAP = 150;           // most-connected aggregates to resolve before identity/legality filtering
const MIN_CONNECTIONS = 1;         // a lone strong edge (e.g. the commander) is still worth surfacing

function inIdentity(card: ScryfallCard, identity: string[]): boolean {
  return (card.color_identity ?? []).every(c => identity.includes(c));
}

/**
 * Pure: fold each seed's lift pool into per-candidate edges. One edge per seed that lists the card
 * (pools are deduped per page upstream). Excludes owned names; keeps candidates with >= minConnections.
 * Sorted by connection count desc then best lift — a stable order for the resolve cap.
 */
export function aggregateLiftCandidates(
  poolsBySeed: { seed: string; pool: CardLiftEntry[] }[],
  excludeNames: Set<string>,
  minConnections: number = MIN_CONNECTIONS,
): LiftCandidateAgg[] {
  const map = new Map<string, LiftCandidateAgg>();
  for (const { seed, pool } of poolsBySeed) {
    for (const entry of pool) {
      if (excludeNames.has(entry.name)) continue;
      let agg = map.get(entry.name);
      if (!agg) {
        agg = { name: entry.name, edges: [], connectionCount: 0, bestLift: 0, bestCoPct: 0, bestNumDecks: 0 };
        map.set(entry.name, agg);
      }
      agg.edges.push({ seed, lift: entry.lift, coPct: entry.coPct, numDecks: entry.numDecks });
      agg.connectionCount = agg.edges.length;
      agg.bestLift = Math.max(agg.bestLift, entry.lift);
      agg.bestCoPct = Math.max(agg.bestCoPct, entry.coPct);
      agg.bestNumDecks = Math.max(agg.bestNumDecks, entry.numDecks);
    }
  }
  return [...map.values()]
    .filter(a => a.connectionCount >= minConnections)
    .sort((a, b) => (b.connectionCount - a.connectionCount) || (b.bestLift - a.bestLift) || a.name.localeCompare(b.name));
}

// --- Composite relevance: cross lift × inclusion, damped by sample size ---
// Crossing lift with co-occurrence as a PRODUCT means a card must be both surprising (lift) and
// actually played (coPct) — a high-lift fluke with ~no adoption scores near zero. The confidence
// factor folds in sample size so a signal from many shared decks outweighs one from few (smoothing
// the hard floor rather than just gating on it). K is tunable.
const CONFIDENCE_K = 50;

export function edgeScore(e: LiftEdge): number {
  return e.lift * e.coPct * (e.numDecks / (e.numDecks + CONFIDENCE_K));
}

/** A "bomb": the single strongest lift×inclusion connection to one of your cards. */
export function bombScore(c: { edges: LiftEdge[] }): number {
  return c.edges.reduce((m, e) => Math.max(m, edgeScore(e)), 0);
}

/** A "cluster": summed strength across the cards that lift it — rewards breadth, quality-gated per edge. */
export function clusterScore(c: { edges: LiftEdge[] }): number {
  return c.edges.reduce((s, e) => s + edgeScore(e), 0);
}

// ── Deck-internal relationships ─────────────────────────────────────────
// An undirected lift tie between two cards you ALREADY run — the synergy backbone of your deck.
export interface DeckLink { a: string; b: string; lift: number; coPct: number; numDecks: number; }
const DECK_LINK_MIN_LIFT = 3;   // only plot pairs that co-occur notably more than baseline (skip ~independent)
const DECK_LINK_CAP = 80;       // keep the strongest ties so the map stays legible, not a hairball

/** Fold the already-fetched seed pools into deck↔deck ties (both endpoints are cards you run). */
function buildDeckLinks(poolsBySeed: { seed: string; pool: CardLiftEntry[] }[], seedNames: string[]): DeckLink[] {
  const deckSet = new Set(seedNames);
  const map = new Map<string, DeckLink>();
  for (const { seed, pool } of poolsBySeed) {
    for (const e of pool) {
      if (e.name === seed || !deckSet.has(e.name) || e.lift < DECK_LINK_MIN_LIFT) continue;
      const [a, b] = seed < e.name ? [seed, e.name] : [e.name, seed];
      const prev = map.get(`${a}|${b}`);
      // The pair shows up from both directions; keep the one with the higher co-play % (and its sample).
      if (!prev || e.coPct > prev.coPct) map.set(`${a}|${b}`, { a, b, lift: e.lift, coPct: e.coPct, numDecks: e.numDecks });
    }
  }
  const score = (d: DeckLink) => d.lift * d.coPct * (d.numDecks / (d.numDecks + CONFIDENCE_K));
  return [...map.values()].sort((x, y) => score(y) - score(x)).slice(0, DECK_LINK_CAP);
}

export interface LiftScanResult { candidates: LiftCandidate[]; deckLinks: DeckLink[]; }

/**
 * Per-deck scan cache, shared between the Lift Web tab and the Overview bento so a background warm
 * from one makes the other instant (and EDHREC isn't hit twice). Keyed by `liftDeckKey`.
 */
export const LIFT_SCAN_CACHE = new Map<string, LiftScanResult>();

/** Stable cache key for a decklist (order-independent), matching the Lift Web tab + bento. */
export function liftDeckKey(commanderName: string, partnerCommanderName: string | undefined, cards: ScryfallCard[]): string {
  return [commanderName, partnerCommanderName ?? '', ...cards.map(c => c.name).sort()].join('|');
}

/** Resolve the seed/exclude/identity inputs for a deck scan — one source of truth for both callers. */
export function buildLiftScanInputs(opts: {
  commander?: ScryfallCard;
  partnerCommander?: ScryfallCard;
  commanderName: string;
  partnerCommanderName?: string;
  currentCards: ScryfallCard[];
  colorIdentity?: string[];
}): { seedNames: string[]; excludeNames: Set<string>; identity: string[] } {
  const { commander, partnerCommander, commanderName, partnerCommanderName, currentCards, colorIdentity } = opts;
  const excludeNames = new Set<string>([
    ...currentCards.map(c => c.name),
    commanderName,
    ...(partnerCommanderName ? [partnerCommanderName] : []),
  ]);
  const seedNames = [...new Set<string>([
    commanderName,
    ...(partnerCommanderName ? [partnerCommanderName] : []),
    ...currentCards.filter(c => !isLand(c)).map(c => c.name),
  ])];
  let identity = colorIdentity && colorIdentity.length ? colorIdentity : null;
  if (!identity) {
    const set = new Set<string>();
    for (const c of [commander, partnerCommander, ...currentCards]) {
      for (const col of c?.color_identity ?? []) set.add(col);
    }
    identity = [...set];
  }
  return { seedNames, excludeNames, identity };
}

// Selection thresholds — kept identical to the Lift Web tab so the bento teaser names the same hits.
const PICK_HIGH_LIFT = 5;          // "insanely high" single-card lift (a bomb)
const PICK_CLUSTER_MIN_CONN = 2;   // a cluster = lifted by at least this many of your cards

/**
 * Pick the single strongest bomb and the single strongest cluster from a scan — the two hits the
 * Overview bento teases. Mirrors the tab's bomb/cluster bucketing (bombs win ties over clusters).
 */
export function selectTopLiftPicks(candidates: LiftCandidate[]): { bomb: LiftCandidate | null; cluster: LiftCandidate | null } {
  const bomb = candidates
    .filter(c => c.bestLift >= PICK_HIGH_LIFT)
    .map(c => ({ c, s: bombScore(c) }))
    .sort((a, b) => b.s - a.s)[0]?.c ?? null;
  const cluster = candidates
    .filter(c => c.connectionCount >= PICK_CLUSTER_MIN_CONN && c.card.name !== bomb?.card.name)
    .map(c => ({ c, s: clusterScore(c) }))
    .sort((a, b) => b.s - a.s)[0]?.c ?? null;
  return { bomb, cluster };
}

export interface ScanArgs {
  seedNames: string[];
  identity: string[];
  excludeNames: Set<string>;
  onProgress?: (done: number, total: number) => void;
  isCancelled?: () => boolean;
  force?: boolean;   // bypass the in-memory parsed pool and re-derive (the "Re-scan" button)
}

/**
 * Scan every seed's lift pool, aggregate edges, resolve the most-connected candidates via Scryfall
 * (which also caches them so the add flow resolves), and filter to in-identity, commander-legal,
 * non-land. Returns candidates with edges intact so the UI can re-rank by the slider with no re-fetch.
 */
export async function scanLiftCandidates(args: ScanArgs): Promise<{ candidates: LiftCandidate[]; deckLinks: DeckLink[] }> {
  const { seedNames, identity, excludeNames, onProgress, isCancelled, force } = args;

  const poolsBySeed: { seed: string; pool: CardLiftEntry[] }[] = [];
  for (let i = 0; i < seedNames.length; i++) {
    if (isCancelled?.()) return { candidates: [], deckLinks: [] };
    const seed = seedNames[i];
    poolsBySeed.push({ seed, pool: await fetchCardLiftPool(seed, force) });
    onProgress?.(i + 1, seedNames.length);
  }

  if (isCancelled?.()) return { candidates: [], deckLinks: [] };
  const candidates = await buildCandidates(poolsBySeed, excludeNames, identity, MIN_CONNECTIONS);
  const deckLinks = buildDeckLinks(poolsBySeed, seedNames);   // same pools, no extra fetching
  return { candidates, deckLinks };
}

/**
 * Aggregate → resolve → filter. Resolves the union of the top candidates by co-occurrence and by lift
 * (so both clustered cards and single-card bombs survive the resolve cap), then keeps in-identity,
 * commander-legal non-lands. Returns candidates with edges intact for the UI to bucket.
 */
async function buildCandidates(
  poolsBySeed: { seed: string; pool: CardLiftEntry[] }[],
  excludeNames: Set<string>,
  identity: string[],
  minConnections: number,
): Promise<LiftCandidate[]> {
  const aggs = aggregateLiftCandidates(poolsBySeed, excludeNames, minConnections);
  if (aggs.length === 0) return [];

  const topByCoPct = [...aggs].sort((a, b) => b.bestCoPct - a.bestCoPct).slice(0, RESOLVE_CAP);
  const topByLift = [...aggs].sort((a, b) => b.bestLift - a.bestLift).slice(0, RESOLVE_CAP);
  const selected = new Set([...topByCoPct, ...topByLift].map(a => a.name));
  const cardMap = await getCardsByNames([...selected]);

  const out: LiftCandidate[] = [];
  for (const agg of aggs) {
    if (!selected.has(agg.name)) continue;
    const card = cardMap.get(agg.name);
    if (!card) continue;
    if (!inIdentity(card, identity)) continue;
    if (card.legalities?.commander !== 'legal') continue;
    if (isLand(card)) continue;
    out.push({ card, edges: agg.edges, connectionCount: agg.connectionCount, bestLift: agg.bestLift, bestCoPct: agg.bestCoPct, bestNumDecks: agg.bestNumDecks });
  }
  return out;
}
