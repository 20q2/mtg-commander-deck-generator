// src/services/deckBuilder/landCutSelection.ts
import type { ScryfallCard } from '@/types';
import type { AnalyzedCard, ColorFixingAnalysis } from './deckAnalyzer';
import { isMdfcLand, isChannelLand, getFrontFaceTypeLine } from '@/services/scryfall/client';
import { isUtilityLand } from '@/services/tagger/client';

const BASIC_FETCH_RE = /search(?:es)?\s+(?:your|their)\s+library\s+for\s+(?:up\s+to\s+\w+\s+)?(?:a\s+)?basic\s+(?:land|forest|island|swamp|mountain|plains)/i;

/** Count cards whose oracle text searches the library for a basic land. */
export function countBasicFetchers(cards: ScryfallCard[]): number {
  let n = 0;
  for (const c of cards) {
    const oracle = c.oracle_text || c.card_faces?.[0]?.oracle_text || '';
    if (BASIC_FETCH_RE.test(oracle)) n++;
  }
  return n;
}

/** Minimum basics to keep so basic-fetchers (Cultivate etc.) have live targets. */
export function computeBasicFloor(basicFetcherCount: number): number {
  return Math.max(2, basicFetcherCount * 2);
}

export type LandCutKind = 'basic' | 'nonbasic' | 'fallback';

export interface LandCut {
  ac: AnalyzedCard;
  kind: LandCutKind;
  /** For basics: the count this cut takes you from. e.g. 8 (cutting brings to 7). */
  beforeCount?: number;
  afterCount?: number;
  /** Set on `fallback` rows so the UI can render a warning badge. */
  warning?: string;
}

export interface SelectLandCutsInput {
  landCards: AnalyzedCard[];          // analysis.landCards (all lands, basics + nonbasics)
  nonLandCards: ScryfallCard[];       // current non-land cards in deck (for basic-fetcher scan)
  colorFixing: ColorFixingAnalysis;   // for pipDemand
  colorIdentity: string[];            // ['W','U','B','R','G'] subset
  target: number;                     // effective land target (userLandTarget ?? mb.adjustedSuggestion)
  currentLands: number;               // analysis.manaBase.currentLands
  mustIncludeNames: Set<string>;
}

export interface SelectLandCutsResult {
  topN: LandCut[];                    // exactly min(N, available) entries; the cuts to make
  others: LandCut[];                  // additional candidates the user can substitute in
  basicFloor: number;                 // computed floor below which we won't cut basics
  basicFetcherCount: number;          // detected basic-fetcher count
}

export function selectLandCuts(input: SelectLandCutsInput): SelectLandCutsResult {
  const {
    landCards, nonLandCards, colorFixing, target, currentLands, mustIncludeNames,
  } = input;

  const N = Math.max(0, currentLands - target);
  const basicFetcherCount = countBasicFetchers(nonLandCards);
  const basicFloor = computeBasicFloor(basicFetcherCount);

  if (N === 0) {
    return { topN: [], others: [], basicFloor, basicFetcherCount };
  }

  // 1. Surplus basics down to floor.
  const basics = groupBasics(landCards);
  const totalBasics = basics.reduce((s, g) => s + g.count, 0);
  const basicCuts = selectBasicCuts(
    basics, totalBasics, basicFloor,
    colorFixing.pipDemand, colorFixing.pipDemandTotal,
    N,
  );

  const taken = new Set<string>();
  // Basic cuts can repeat the same name across copies; only mark as taken when
  // we move to nonbasics so they aren't re-selected. Basics use copy-counts, nonbasics use names.
  // (No name added to `taken` for basics — they're identified by copies.)

  // 2. Weakest nonbasics.
  const stillWanted = N - basicCuts.length;
  const nonbasicCuts = selectNonbasicCuts(landCards, mustIncludeNames, stillWanted, taken);
  for (const c of nonbasicCuts) taken.add(c.ac.card.name);

  // 3. Last-resort fallback (MDFC/utility) only if priorities 1+2 short of N.
  const fallbackWanted = N - basicCuts.length - nonbasicCuts.length;
  const fallbackCuts = selectFallbackCuts(landCards, mustIncludeNames, fallbackWanted, taken);
  for (const c of fallbackCuts) taken.add(c.ac.card.name);

  const topN = [...basicCuts, ...nonbasicCuts, ...fallbackCuts].slice(0, N);

  // 4. "Other candidates" — surface up to 6 more weakest-nonbasic candidates not already in topN.
  const OTHERS_LIMIT = 6;
  const othersTaken = new Set(taken);
  const others: LandCut[] = landCards
    .filter(ac => isPureNonbasic(ac))
    .filter(ac => !mustIncludeNames.has(ac.card.name))
    .filter(ac => !othersTaken.has(ac.card.name))
    .sort(byScoreAsc)
    .slice(0, OTHERS_LIMIT)
    .map(ac => ({ ac, kind: 'nonbasic' as const }));

  return { topN, others, basicFloor, basicFetcherCount };
}

const BASIC_NAMES = new Set([
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
  'Snow-Covered Mountain', 'Snow-Covered Forest',
]);

const BASIC_TO_COLOR: Record<string, string> = {
  'Plains': 'W', 'Island': 'U', 'Swamp': 'B', 'Mountain': 'R', 'Forest': 'G',
  'Snow-Covered Plains': 'W', 'Snow-Covered Island': 'U', 'Snow-Covered Swamp': 'B',
  'Snow-Covered Mountain': 'R', 'Snow-Covered Forest': 'G',
  'Wastes': 'C',
};

interface BasicGroup {
  name: string;       // 'Forest', 'Snow-Covered Forest', 'Wastes', etc.
  color: string;      // 'W'|'U'|'B'|'R'|'G'|'C'
  count: number;
  /** A representative AnalyzedCard from this group (used for rendering). */
  sample: AnalyzedCard;
}

/** Group basics by name with counts, in stable name order. */
function groupBasics(landCards: AnalyzedCard[]): BasicGroup[] {
  const map = new Map<string, BasicGroup>();
  for (const ac of landCards) {
    if (!BASIC_NAMES.has(ac.card.name)) continue;
    const existing = map.get(ac.card.name);
    if (existing) {
      existing.count++;
    } else {
      map.set(ac.card.name, {
        name: ac.card.name,
        color: BASIC_TO_COLOR[ac.card.name] || 'C',
        count: 1,
        sample: ac,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Select up to `wantCuts` basic-cut LandCut entries, never dropping total basics
 * below `basicFloor`. Picks from most-oversupplied color first; ties broken by larger
 * group then alphabetical name.
 *
 * Oversupply per color = currentBasicsForColor - expectedBasicsForColor,
 * where expected is proportional to pip-demand share. If pipDemandTotal is 0 (no
 * colored spells), distribute expected evenly across colors present in basics.
 */
function selectBasicCuts(
  basics: BasicGroup[],
  totalBasics: number,
  basicFloor: number,
  pipDemand: Record<string, number>,
  pipDemandTotal: number,
  wantCuts: number,
): LandCut[] {
  const cuts: LandCut[] = [];
  if (wantCuts <= 0 || totalBasics <= basicFloor) return cuts;

  // Working copy of counts so we can decrement as we cut.
  const counts = new Map<string, number>();
  for (const g of basics) counts.set(g.name, g.count);

  const colorsPresent = [...new Set(basics.map(g => g.color))];

  const computeOversupply = (): { name: string; over: number; count: number }[] => {
    const totalNow = [...counts.values()].reduce((s, n) => s + n, 0);
    return basics
      .filter(g => (counts.get(g.name) ?? 0) > 0)
      .map(g => {
        const cur = counts.get(g.name) ?? 0;
        // Sum of all basics currently of this group's color.
        const colorTotal = basics
          .filter(other => other.color === g.color)
          .reduce((s, other) => s + (counts.get(other.name) ?? 0), 0);
        // Expected share: pip-demand for this color / pipDemandTotal × totalNow.
        // If pipDemandTotal is 0, evenly distribute among colorsPresent.
        const expectedColor = pipDemandTotal > 0
          ? (pipDemand[g.color] || 0) / pipDemandTotal * totalNow
          : totalNow / Math.max(1, colorsPresent.length);
        const over = colorTotal - expectedColor;
        return { name: g.name, over, count: cur };
      });
  };

  let totalNow = totalBasics;
  const remainingToCut = () => Math.min(wantCuts - cuts.length, totalNow - basicFloor);

  while (remainingToCut() > 0) {
    const ranked = computeOversupply()
      .sort((a, b) => {
        if (b.over !== a.over) return b.over - a.over;
        if (b.count !== a.count) return b.count - a.count;
        return a.name.localeCompare(b.name);
      });
    if (ranked.length === 0) break;
    const pick = ranked[0];
    const group = basics.find(g => g.name === pick.name)!;
    const before = counts.get(pick.name) ?? 0;
    const after = before - 1;
    counts.set(pick.name, after);
    totalNow--;
    cuts.push({
      ac: group.sample,
      kind: 'basic',
      beforeCount: before,
      afterCount: after,
    });
  }

  return cuts;
}

/** True if a land is a strict cuttable nonbasic — excludes basics, MDFC, channel, utility. */
function isPureNonbasic(ac: AnalyzedCard): boolean {
  if (BASIC_NAMES.has(ac.card.name)) return false;
  if (isMdfcLand(ac.card)) return false;
  if (isChannelLand(ac.card)) return false;
  if (isUtilityLand(ac.card.name)) return false;
  const tl = getFrontFaceTypeLine(ac.card).toLowerCase();
  return tl.includes('land');
}

/** True if a land is an MDFC or utility (allowed only as last-resort). */
function isFallbackEligible(ac: AnalyzedCard): boolean {
  // Channel lands stay excluded — too high cost to cut.
  if (isChannelLand(ac.card)) return false;
  if (BASIC_NAMES.has(ac.card.name)) return false;
  return isMdfcLand(ac.card) || isUtilityLand(ac.card.name);
}

/** Sort by AnalyzedCard.score ascending (lowest = weakest = most cuttable). */
function byScoreAsc(a: AnalyzedCard, b: AnalyzedCard): number {
  return (a.score ?? 0) - (b.score ?? 0);
}

function selectNonbasicCuts(
  landCards: AnalyzedCard[],
  mustIncludeNames: Set<string>,
  wantCuts: number,
  takenNames: Set<string>,
): LandCut[] {
  if (wantCuts <= 0) return [];
  return landCards
    .filter(ac => isPureNonbasic(ac))
    .filter(ac => !mustIncludeNames.has(ac.card.name))
    .filter(ac => !takenNames.has(ac.card.name))
    .sort(byScoreAsc)
    .slice(0, wantCuts)
    .map(ac => ({ ac, kind: 'nonbasic' as const }));
}

function selectFallbackCuts(
  landCards: AnalyzedCard[],
  mustIncludeNames: Set<string>,
  wantCuts: number,
  takenNames: Set<string>,
): LandCut[] {
  if (wantCuts <= 0) return [];
  return landCards
    .filter(ac => isFallbackEligible(ac))
    .filter(ac => !mustIncludeNames.has(ac.card.name))
    .filter(ac => !takenNames.has(ac.card.name))
    .sort(byScoreAsc)
    .slice(0, wantCuts)
    .map(ac => ({
      ac,
      kind: 'fallback' as const,
      warning: isMdfcLand(ac.card) ? 'Loses spell flexibility' : 'Loses utility',
    }));
}

