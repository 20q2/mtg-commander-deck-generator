import { isAnyLand, isMdfcLand, getFrontFaceTypeLine } from '@/services/scryfall/client';
import type { ScryfallCard } from '@/types';

export interface CurveBuckets {
  /** Indexed by CMC 0..7 (column 7 = "7+"). Inner arrays sorted alphabetically. */
  creatures: ScryfallCard[][];
  noncreatures: ScryfallCard[][];
  /** All lands in lands[0] — CMC has no meaningful column position for lands. */
  lands: ScryfallCard[][];
  /** length 8 — sum of creatures[i].length + noncreatures[i].length per column. */
  countsByCmc: number[];
  landCount: number;
  /** Count of MDFCs included in BOTH lands and (creatures|noncreatures). The
   *  DECK header total must subtract this to avoid double-counting. */
  mdfcCount: number;
}

export interface BuildCurveBucketsOptions {
  /** Card names to exclude from the buckets (commanders show in CommanderStrip, not here). */
  excludeNames?: Set<string>;
}

const COLUMN_COUNT = 8; // CMC 0,1,2,3,4,5,6,7+

export function buildCurveBuckets(
  cards: ScryfallCard[],
  opts: BuildCurveBucketsOptions = {},
): CurveBuckets {
  const exclude = opts.excludeNames ?? new Set<string>();

  const creatures: ScryfallCard[][] = Array.from({ length: COLUMN_COUNT }, () => []);
  const noncreatures: ScryfallCard[][] = Array.from({ length: COLUMN_COUNT }, () => []);
  const lands: ScryfallCard[][] = Array.from({ length: COLUMN_COUNT }, () => []);

  let mdfcCount = 0;

  for (const card of cards) {
    if (exclude.has(card.name)) continue;

    const mdfc = isMdfcLand(card);

    if (isAnyLand(card)) {
      lands[0].push(card);
      // Plain lands stop here. MDFCs continue so they ALSO get bucketed by
      // their front face — they're spells that fall back to a land.
      if (!mdfc) continue;
      mdfcCount++;
    }

    const cmc = Math.min(Math.floor(card.cmc ?? 0), COLUMN_COUNT - 1);
    const typeLine = getFrontFaceTypeLine(card).toLowerCase();
    if (typeLine.includes('creature')) {
      creatures[cmc].push(card);
    } else {
      noncreatures[cmc].push(card);
    }
  }

  const sortByName = (a: ScryfallCard, b: ScryfallCard) => a.name.localeCompare(b.name);
  creatures.forEach(col => col.sort(sortByName));
  noncreatures.forEach(col => col.sort(sortByName));
  lands.forEach(col => col.sort(sortByName));

  const countsByCmc = creatures.map((col, i) => col.length + noncreatures[i].length);
  const landCount = lands.reduce((n, col) => n + col.length, 0);

  return { creatures, noncreatures, lands, countsByCmc, landCount, mdfcCount };
}
