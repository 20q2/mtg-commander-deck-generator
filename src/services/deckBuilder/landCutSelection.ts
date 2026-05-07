// src/services/deckBuilder/landCutSelection.ts
import type { ScryfallCard } from '@/types';
import type { AnalyzedCard, ColorFixingAnalysis } from './deckAnalyzer';

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
