import type { ScryfallCard, EDHRECCard } from '@/types';
import { fetchCardRelations, type CardRelation } from '@/services/edhrec/client';
import { getCardsByNames, getCardPrice } from '@/services/scryfall/client';
import { getCardRole, getCardSubtype, loadTaggerData } from '@/services/tagger/client';
import type { BrewContext, BrewState, BrewCandidate } from './brewTypes';
import { typeKey } from './health';
import { relicBudgetCap } from './relics';

const SOURCE_RANK: Record<CardRelation['source'], number> = { lift: 0, coplay: 1, similar: 2 };

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

  // 2. Exclude names we already have or have used.
  const exclude = new Set<string>([
    ...state.usedNames,
    ...ctx.candidates.map(c => c.name),
    ...state.discovered.map(c => c.name),
    ...seedNames,
    ctx.commander.name,
    ...(ctx.partnerCommander ? [ctx.partnerCommander.name] : []),
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
