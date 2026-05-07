// src/services/deckBuilder/landCutSelection.ts
import type { ScryfallCard } from '@/types';
import type { AnalyzedCard, ColorFixingAnalysis } from './deckAnalyzer';

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

export function selectLandCuts(_input: SelectLandCutsInput): SelectLandCutsResult {
  // Stub — implemented in subsequent tasks.
  return { topN: [], others: [], basicFloor: 0, basicFetcherCount: 0 };
}
