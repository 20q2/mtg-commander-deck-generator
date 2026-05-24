// src/services/deckBuilder/planScore.ts
import type {
  ScryfallCard,
  EDHRECCommanderData,
  SubScore,
} from '@/types';
import type { ThemeMembership } from '@/components/analyze/themeMembership';
import { isAnyLand } from '../scryfall/client';

const STRATEGY_DENSITY_TARGET = 0.30; // 30% of non-land cards reinforcing the plan = full marks
const STRATEGY_COVERAGE_TARGET_TOP_N = 60; // overlap-with-top-60 of theme bucket = full marks
const STRATEGY_COVERAGE_FULL_MARKS_HIT_RATE = 0.33; // 33% of top-N overlap = 100
const STRATEGY_COVERAGE_MIN_DENOMINATOR = 20;       // floor so small theme buckets aren't trivial

export interface StrategyInputs {
  /** All cards in the deck (excluding commander). */
  cards: ScryfallCard[];
  /** Theme membership for the active themes. May be null if no theme detected. */
  themeMembership: ThemeMembership | null;
  /** EDHREC payload for the primary detected theme (used for top-N overlap). */
  primaryThemeData?: EDHRECCommanderData | null;
  /** Display name of the detected plan, e.g. "+1/+1 Counters". */
  planName?: string | null;
}

export function computeStrategySubscore(inputs: StrategyInputs): SubScore {
  const { cards, themeMembership, primaryThemeData, planName } = inputs;

  if (!themeMembership || themeMembership.themes.length === 0) {
    return {
      value: 0,
      surface: 'No clear plan detected — set a theme to score strategy.',
      bandLabel: 'Unscored',
      partial: true,
    };
  }

  const nonLand = cards.filter(c => !isAnyLand(c));
  const nonLandCount = nonLand.length || 1;

  // 1. Theme density: fraction of non-land cards that are in any selected theme.
  let inTheme = 0;
  for (const c of nonLand) {
    if (themeMembership.byCard.has(c.name.toLowerCase())) inTheme++;
  }
  const density = inTheme / nonLandCount; // 0..1
  const densityScore = Math.min(1, density / STRATEGY_DENSITY_TARGET);

  // 2. Theme coverage: of the top-N EDHREC theme cards, how many do we run?
  let coverageScore = 0.5; // neutral when we have no theme data
  if (primaryThemeData?.cardlists.allNonLand?.length) {
    const topN = primaryThemeData.cardlists.allNonLand.slice(0, STRATEGY_COVERAGE_TARGET_TOP_N);
    const deckNames = new Set(nonLand.map(c => c.name.toLowerCase()));
    let hits = 0;
    for (const tc of topN) {
      if (deckNames.has(tc.name.toLowerCase())) hits++;
    }
    const denom = Math.max(STRATEGY_COVERAGE_MIN_DENOMINATOR, topN.length * STRATEGY_COVERAGE_FULL_MARKS_HIT_RATE);
    coverageScore = Math.min(1, hits / denom);
  }

  // Composite: 60% density (deck-side commitment), 40% coverage (community alignment).
  const composite = densityScore * 0.6 + coverageScore * 0.4;
  const value = Math.round(composite * 100);

  const plan = planName ?? 'your plan';
  const verb = inTheme === 1 ? 'reinforces' : 'reinforce';
  const surface = `${inTheme} of ${nonLandCount} non-land cards ${verb} ${plan}`;
  const bandLabel = bandFor(value);

  return { value, surface, bandLabel };
}

export function bandFor(score: number): string {
  if (score >= 90) return 'Tuned';
  if (score >= 75) return 'Healthy';
  if (score >= 60) return 'Solid';
  if (score >= 40) return 'Rough';
  return 'Thin';
}
