import type { NonBasicLandMix } from '@/types';
import { fetchCommanderData, fetchPartnerCommanderData } from '@/services/edhrec';
import { getCardsByNames, searchCards, BASIC_LAND_NAMES } from '@/services/scryfall/client';
import { loadTaggerData } from '@/services/tagger/client';
import { landKind, flexKind, type LandKind } from './landMix';

export interface LandMixRecommendation {
  /** Average number of each group's lands in the commander's EDHREC decks. */
  expected: Record<LandKind, number>;
  numDecks: number;
}

const front = (name: string) => name.split(' // ')[0];

/**
 * What real decks for this commander play: every non-basic on its EDHREC page, sorted with the
 * generator's own `landKind`, each weighted by the share of decks that run it. EDHREC files MDFCs
 * under their spell side, so those are found in the non-land lists. The page cuts off rarely-played
 * lands, so the sums undercount the total — use them as proportions (see `recommendedMix`).
 */
export async function recommendLandMix(commander: string, partner: string | null, colors: string[]): Promise<LandMixRecommendation | null> {
  const [data, , mdfcs] = await Promise.all([
    partner ? fetchPartnerCommanderData(commander, partner) : fetchCommanderData(commander),
    loadTaggerData(), // utility detection reads the tagger's utility-land tag
    searchCards('is:mdfc t:land', colors).catch(() => null),
  ]);
  const lands = data.cardlists.lands.filter(l => !BASIC_LAND_NAMES.has(l.name));
  const cards = await getCardsByNames(lands.map(l => l.name));
  const expected: Record<LandKind, number> = { fixing: 0, mdfc: 0, utility: 0, other: 0 };
  for (const l of lands) {
    const card = cards.get(l.name);
    if (card) expected[landKind(card, colors)] += l.inclusion / 100;
  }
  const spellLands = new Set((mdfcs?.data ?? []).map(c => front(c.name)));
  const counted = new Set(lands.map(l => front(l.name)));
  for (const c of data.cardlists.allNonLand) {
    if (spellLands.has(front(c.name)) && !counted.has(front(c.name))) {
      counted.add(front(c.name));
      expected.mdfc += c.inclusion / 100;
    }
  }
  if (flexKind(colors) === 'other') { expected.other += expected.fixing; expected.fixing = 0; }
  const sum = expected.fixing + expected.mdfc + expected.utility + expected.other;
  return sum > 0 ? { expected, numDecks: data.stats.numDecks ?? 0 } : null;
}

/** The recommendation as a split of `total` non-basics (largest remainder, so it sums exactly). */
export function recommendedMix(rec: LandMixRecommendation, total: number): NonBasicLandMix {
  const kinds: LandKind[] = ['fixing', 'mdfc', 'utility', 'other'];
  const sum = kinds.reduce((s, k) => s + rec.expected[k], 0);
  const raw = kinds.map(k => (rec.expected[k] / sum) * total);
  const out = raw.map(Math.floor);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (let left = total - out.reduce((s, v) => s + v, 0), j = 0; left > 0; left--, j++) out[order[j % 4][1]]++;
  const [, mdfc, utility, other] = out;
  return { mdfc, utility, other, total };
}
