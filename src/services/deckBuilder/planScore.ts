// src/services/deckBuilder/planScore.ts
import type {
  ScryfallCard,
  EDHRECCommanderData,
  SubScore,
} from '@/types';
import type { ThemeMembership } from '@/components/analyze/themeMembership';
import type { RoleBreakdown, CurvePhaseAnalysis } from './deckAnalyzer';
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

// Roles: how close are we to per-role targets, weighted by role criticality.
// Reusing the existing rolesGrade letter as a coarse score is tempting, but we
// want a 0-100 that matches the rest of the dashboard.
const ROLE_WEIGHTS: Record<string, number> = {
  ramp: 1.0,
  removal: 1.0,
  boardwipe: 0.7, // wipes are important but variance-heavy
  cardDraw: 1.0,
};

export function computeRolesSubscore(roleBreakdowns: RoleBreakdown[]): SubScore {
  if (roleBreakdowns.length === 0) {
    return { value: 50, surface: 'No role data available.', bandLabel: 'Unscored', partial: true };
  }

  let weighted = 0;
  let weightTotal = 0;
  const thin: string[] = [];

  for (const rb of roleBreakdowns) {
    const w = ROLE_WEIGHTS[rb.role] ?? 0.5;
    const target = rb.target || 1;
    const ratio = Math.min(1.2, rb.current / target); // mild credit for slight excess
    const norm = ratio >= 1 ? 1 - Math.max(0, ratio - 1) * 0.5 : ratio; // penalize overshoot lightly
    weighted += norm * w;
    weightTotal += w;
    if (rb.current < target * 0.7) thin.push(rb.label);
  }

  const value = Math.round((weighted / Math.max(1, weightTotal)) * 100);
  const surface = thin.length === 0
    ? 'All roles healthy.'
    : `Low on ${thin.slice(0, 2).join(' and ')}${thin.length > 2 ? ` (+${thin.length - 2})` : ''}.`;

  return { value, surface, bandLabel: bandFor(value) };
}

// Tempo: deviation of deck curve from EDHREC commander average curve.
// Lower deviation = higher score. Early-CMC gaps weighted heavier.
const CMC_WEIGHTS = [0, 1.5, 1.5, 1.2, 1.0, 0.8, 0.6, 0.5];

export function computeTempoSubscore(curvePhases: CurvePhaseAnalysis[]): SubScore {
  if (curvePhases.length === 0) {
    return { value: 50, surface: 'No curve data available.', bandLabel: 'Unscored', partial: true };
  }

  // Use phase-level totals as a proxy: each phase has current vs target.
  let weighted = 0;
  let weightTotal = 0;
  let weakestPhase: string | null = null;
  let weakestRatio = Infinity;
  for (const phase of curvePhases) {
    const target = phase.target || 1;
    const ratio = Math.min(1.2, phase.current / target);
    const w = phase.phase === 'early' ? 1.4 : phase.phase === 'mid' ? 1.0 : 0.7;
    const norm = ratio >= 1 ? 1 - Math.max(0, ratio - 1) * 0.5 : ratio;
    weighted += norm * w;
    weightTotal += w;
    if (ratio < weakestRatio) {
      weakestRatio = ratio;
      weakestPhase = phase.phase;
    }
  }

  const value = Math.round((weighted / Math.max(1, weightTotal)) * 100);
  const surface = value >= 80
    ? 'On curve.'
    : `Curve is light in the ${weakestPhase} game.`;

  return { value, surface, bandLabel: bandFor(value) };
}

// CMC_WEIGHTS kept for potential per-bin refinement; not used in the phase-level
// version above. Leave in for the v2 enhancement (per-CMC-bin deviation).
void CMC_WEIGHTS;
