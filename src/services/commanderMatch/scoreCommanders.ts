import type { CardCommanderStat } from '@/services/edhrec/client';

/** One seed card and the commanders EDHREC says run it. `commanders: []` = no data for that card. */
export interface SeedResult {
  name: string;
  commanders: CardCommanderStat[];
}

export interface CommanderMatch {
  name: string;
  sanitized: string;
  /** Seed card names this commander is a top commander for. */
  matchedSeeds: string[];
  score: number;
  /** Filled in by the caller after the Scryfall batch; [] until then. */
  colorIdentity: string[];
}

/**
 * How hard partial coverage is punished. Raw score is multiplied by
 * (matched / total) ** COVERAGE_EXPONENT. At 0.5 a commander playing 4 of 5 seeds keeps ~89%
 * of its score, so a strong-but-incomplete match stays competitive, while a 1-of-5 keeps ~45%.
 * This is THE tuning knob for the feature.
 */
export const COVERAGE_EXPONENT = 0.5;

/**
 * Rank commanders for a group of cards: sum of co-play rate across the seeds a commander
 * covers, damped by how much of the group it covers. Pure — no network, no store.
 *
 * Seeds with no EDHREC data still count toward the denominator, which correctly stops us
 * claiming coverage we cannot substantiate.
 */
export function scoreCommanderMatches(seeds: SeedResult[]): CommanderMatch[] {
  const total = seeds.length;
  if (total === 0) return [];

  const acc = new Map<string, { name: string; sanitized: string; raw: number; matched: string[] }>();
  for (const seed of seeds) {
    for (const c of seed.commanders) {
      const key = c.name.toLowerCase();
      const prev = acc.get(key);
      if (prev) {
        prev.raw += c.coRate;
        prev.matched.push(seed.name);
      } else {
        acc.set(key, { name: c.name, sanitized: c.sanitized, raw: c.coRate, matched: [seed.name] });
      }
    }
  }

  const out: CommanderMatch[] = [...acc.values()].map(e => ({
    name: e.name,
    sanitized: e.sanitized,
    matchedSeeds: e.matched,
    score: e.raw * Math.pow(e.matched.length / total, COVERAGE_EXPONENT),
    colorIdentity: [],
  }));

  // Ties break on coverage then name so the order is stable across recomputes.
  out.sort((a, b) =>
    b.score - a.score ||
    b.matchedSeeds.length - a.matchedSeeds.length ||
    a.name.localeCompare(b.name)
  );
  return out;
}
