import type { ScryfallCard, EDHRECCard } from '@/types';
import { fetchCardRelations, type CardRelation } from '@/services/edhrec/client';
import { getCardsByNames, getCardPrice } from '@/services/scryfall/client';
import { getCardRole, getCardSubtype, loadTaggerData } from '@/services/tagger/client';
import { scanLiftCandidates, clusterScore, edgeScore } from '@/services/optimizer/liftClusters';
import type { BrewContext, BrewState, BrewCandidate } from './brewTypes';
import { typeKey, offerExcludedNames } from './health';
import { relicBudgetCap } from './relics';
import { bannedNameSet } from './banned';

const SOURCE_RANK: Record<CardRelation['source'], number> = { lift: 0, coplay: 1, similar: 2 };

/** A "cluster" find must be lifted by at least this many of your cards (matches the optimizer's Lift Web). */
export const CLUSTER_MIN_CONN = 2;
const CLUSTER_TAKE = 12;     // cap how many cluster finds we inject per scan

function inIdentity(card: ScryfallCard, identity: string[]): boolean {
  return (card.color_identity ?? []).every(c => identity.includes(c));
}

/**
 * Pull card-to-card discoveries for the given seed cards, resolve + filter them, and return
 * ranked BrewCandidates (lift first) carrying provenance. Network: 1 relations fetch per seed
 * + 1 batched Scryfall call. Never throws (per-seed failures yield no relations).
 */
export async function discoverFrom(
  seedNames: string[], ctx: BrewContext, state: BrewState,
): Promise<BrewCandidate[]> {
  await loadTaggerData();

  // 1. Gather relations across seeds; dedupe by name keeping the strongest source.
  const relLists = await Promise.all(seedNames.map(async (seed) => ({ seed, rels: await fetchCardRelations(seed) })));
  const best = new Map<string, { rel: CardRelation; via: string }>();
  for (const { seed, rels } of relLists) {
    for (const rel of rels) {
      const prev = best.get(rel.name);
      if (!prev || SOURCE_RANK[rel.source] < SOURCE_RANK[prev.rel.source]) best.set(rel.name, { rel, via: seed });
    }
  }

  // 2. Exclude names we already have or have used — and the player's banned list, so a lift find can't
  //    reintroduce a card we deliberately kept out of the base pool.
  const exclude = new Set<string>([
    ...offerExcludedNames(state),
    ...ctx.candidates.map(c => c.name),
    ...state.discovered.map(c => c.name),
    ...seedNames,
    ctx.commander.name,
    ...(ctx.partnerCommander ? [ctx.partnerCommander.name] : []),
    ...bannedNameSet(ctx.customization),
  ]);
  const wanted = [...best.entries()].filter(([name]) => !exclude.has(name));
  if (wanted.length === 0) return [];

  // 3. Resolve via Scryfall (one batched call).
  const cardMap = await getCardsByNames(wanted.map(([name]) => name), undefined, undefined, { currency: ctx.customization.currency });

  // 4. Filter to in-identity, commander-legal, non-land, in-budget (tightened by a Budget Brewer relic).
  const relicCap = relicBudgetCap(state.relics);
  const maxPrice = [ctx.customization.maxCardPrice, relicCap].filter((v): v is number => v != null).reduce<number | null>((m, v) => m == null ? v : Math.min(m, v), null);
  const out: BrewCandidate[] = [];
  for (const [name, { rel, via }] of wanted) {
    const scryfall = cardMap.get(name);
    if (!scryfall) continue;
    if (!inIdentity(scryfall, ctx.colorIdentity)) continue;
    if (scryfall.legalities?.commander !== 'legal') continue;
    if (scryfall.type_line.toLowerCase().includes('land')) continue;
    if (maxPrice != null) {
      const price = parseFloat(getCardPrice(scryfall, ctx.customization.currency) ?? '') || 0;
      if (price > maxPrice) continue;
    }
    const edhrec: EDHRECCard = {
      name, sanitized: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      primary_type: typeKey(scryfall.type_line), inclusion: rel.coPct, num_decks: 0,
      synergy: rel.coPct / 100, cmc: scryfall.cmc,
    };
    out.push({
      name, edhrec, scryfall, role: getCardRole(name), subtype: getCardSubtype(name),
      inclusion: rel.coPct, isLand: false, themeTags: [],
      discoveredVia: via, coSynergy: rel.coPct, discoverySource: rel.source,
    });
  }

  // 5. Rank: lift first, then by co% desc.
  out.sort((a, b) => SOURCE_RANK[a.discoverySource!] - SOURCE_RANK[b.discoverySource!] || (b.coSynergy ?? 0) - (a.coSynergy ?? 0));
  return out;
}

/**
 * Whole-deck "cluster" discovery (the real Lift Web): treat EVERY card so far (commander + picks) as a
 * seed, aggregate the lift graph, and surface cards lifted by MANY of your cards — strong relationships
 * to the deck as a whole, not just one seed. Distinct from discoverFrom (single-seed, shallow). Heavier
 * (one EDHREC card-page fetch per seed, cached 14d) so it's fired once, late-run. Returns BrewCandidates
 * carrying connectionCount/clusterScore so scoring + the UI can say "N of your cards want this".
 */
export async function discoverClustersFrom(
  ctx: BrewContext, state: BrewState, isCancelled?: () => boolean,
): Promise<BrewCandidate[]> {
  await loadTaggerData();

  const seedNames = [
    ctx.commander.name,
    ...(ctx.partnerCommander ? [ctx.partnerCommander.name] : []),
    ...state.picks.map(p => p.name),
  ];
  const exclude = new Set<string>([
    ...offerExcludedNames(state),
    ...ctx.candidates.map(c => c.name),
    ...state.discovered.map(c => c.name),
    ...seedNames,
    ...bannedNameSet(ctx.customization),
  ]);

  // scanLiftCandidates already filters to in-identity, commander-legal, non-land.
  const { candidates } = await scanLiftCandidates({
    seedNames, identity: ctx.colorIdentity, excludeNames: exclude, isCancelled,
  });
  if (isCancelled?.()) return [];

  const clusters = candidates
    .filter(c => c.connectionCount >= CLUSTER_MIN_CONN)   // clusters only — drop single-card "bombs"
    .sort((a, b) => clusterScore(b) - clusterScore(a))
    .slice(0, CLUSTER_TAKE);

  const relicCap = relicBudgetCap(state.relics);
  const maxPrice = [ctx.customization.maxCardPrice, relicCap].filter((v): v is number => v != null).reduce<number | null>((m, v) => m == null ? v : Math.min(m, v), null);

  const out: BrewCandidate[] = [];
  for (const c of clusters) {
    const scryfall = c.card;
    if (maxPrice != null) {
      const price = parseFloat(getCardPrice(scryfall, ctx.customization.currency) ?? '') || 0;
      if (price > maxPrice) continue;
    }
    const name = scryfall.name;
    // The deck card that most strongly lifts this one — for the "Hidden synergy with X" provenance.
    const topEdge = [...c.edges].sort((a, b) => edgeScore(b) - edgeScore(a))[0];
    const edhrec: EDHRECCard = {
      name, sanitized: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      primary_type: typeKey(scryfall.type_line), inclusion: c.bestCoPct, num_decks: 0,
      synergy: c.bestCoPct / 100, cmc: scryfall.cmc,
    };
    out.push({
      name, edhrec, scryfall, role: getCardRole(name), subtype: getCardSubtype(name),
      inclusion: c.bestCoPct, isLand: false, themeTags: [],
      discoveredVia: topEdge?.seed, coSynergy: c.bestCoPct, discoverySource: 'lift',
      connectionCount: c.connectionCount, clusterScore: clusterScore(c),
    });
  }
  return out;
}
