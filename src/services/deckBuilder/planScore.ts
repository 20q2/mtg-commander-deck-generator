// src/services/deckBuilder/planScore.ts
import type {
  ScryfallCard,
  EDHRECCommanderData,
  SubScore,
  PlanScore,
  SubScoreKey,
  Misfit,
  GapAnalysisCard,
} from '@/types';
import type { ThemeMembership } from '@/components/analyze/themeMembership';
import type { RoleBreakdown, CurvePhaseAnalysis, DeckAnalysis, OptimizeSwaps } from './deckAnalyzer';
import { isAnyLand } from '../scryfall/client';
import { computeCardFitSubscore } from './cardFit';

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

/**
 * What Strategy was scored on. Kept so the score can be re-read against the swaps on offer
 * (scoreAgainstSwaps) and projected per swap (projectSwaps).
 */
export interface StrategyBasis {
  /** Non-land cards in a selected theme, out of `nonLand`. */
  inTheme: number;
  nonLand: number;
  /** In-theme cards for full density marks. */
  densityTarget: number;
  /** Of the theme page's top cards, how many the deck runs. */
  hits: number;
  /** Hits for full coverage marks; null when there's no theme page to cover. */
  hitTarget: number | null;
  /** The theme page's top non-land cards (lower-cased), the ones a hit counts against. */
  topNames: string[];
}

/** Strategy's value from its basis: 60% density, 40% coverage, or density alone without a theme page. */
export function strategyValue(b: StrategyBasis): number {
  const densityScore = b.densityTarget > 0 ? Math.min(1, b.inTheme / b.densityTarget) : 1;
  if (b.hitTarget == null) return Math.round(densityScore * 100);
  const coverageScore = b.hitTarget > 0 ? Math.min(1, b.hits / b.hitTarget) : 1;
  return Math.round((densityScore * 0.6 + coverageScore * 0.4) * 100);
}

export function computeStrategySubscore(inputs: StrategyInputs): SubScore & { basis?: StrategyBasis } {
  const { cards, themeMembership, primaryThemeData, planName } = inputs;

  if (!themeMembership || themeMembership.themes.length === 0) {
    return {
      value: 0,
      surface: 'No clear plan detected — set a theme to score strategy.',
      bandLabel: 'Unscored',
      partial: true,
      // Not a data gap. EDHREC may have thousands of decklists for this commander; what's missing
      // is a declaration only the user can make.
      partialReason: 'no-theme',
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
  let hits = 0;
  let hitTarget: number | null = null;
  let topNames: string[] = [];
  if (primaryThemeData?.cardlists.allNonLand?.length) {
    const topN = primaryThemeData.cardlists.allNonLand.slice(0, STRATEGY_COVERAGE_TARGET_TOP_N);
    topNames = topN.map(tc => tc.name.toLowerCase());
    const deckNames = new Set(nonLand.map(c => c.name.toLowerCase()));
    for (const tc of topN) {
      if (deckNames.has(tc.name.toLowerCase())) hits++;
    }
    hitTarget = Math.max(STRATEGY_COVERAGE_MIN_DENOMINATOR, topN.length * STRATEGY_COVERAGE_FULL_MARKS_HIT_RATE);
    coverageScore = Math.min(1, hits / hitTarget);
  }

  // Composite: 60% density (deck-side commitment), 40% coverage (community alignment).
  const composite = densityScore * 0.6 + coverageScore * 0.4;
  const value = Math.round(composite * 100);
  const basis: StrategyBasis = {
    inTheme, nonLand: nonLandCount, densityTarget: STRATEGY_DENSITY_TARGET * nonLandCount,
    hits, hitTarget, topNames,
  };

  const plan = planName ?? 'your plan';
  const verb = inTheme === 1 ? 'reinforces' : 'reinforce';
  const surface = `${inTheme} of ${nonLandCount} non-land cards ${verb} ${plan}`;
  const bandLabel = bandFor(value);

  return { value, surface, bandLabel, basis };
}

export function bandFor(score: number): string {
  if (score >= 90) return 'Tuned';
  if (score >= 75) return 'Healthy';
  if (score >= 60) return 'Solid';
  if (score >= 40) return 'Rough';
  return 'Thin';
}

/**
 * The Overview splash sentence.
 *
 * `bracketPhrase` is joined additively ("and sits at Bracket 3"), never as a
 * scope ("at Bracket 3"). The score is absolute — every subscore measures
 * distance from EDHREC aggregates for this commander, and none takes a bracket
 * as input — so a phrasing that implied "N out of 100 *for that bracket*" would
 * be false.
 */
export function headlineFor(
  score: number,
  planName?: string | null,
  bracketPhrase?: string | null,
): string {
  const plan = planName?.trim() || null;
  const at = bracketPhrase ? ` and sits at ${bracketPhrase}` : '';

  // The score measures closeness to what this commander's decks run, not how well the deck plays,
  // so the top rung claims a tight fit and nothing past it.
  if (score >= 90) {
    return plan
      ? `Your deck is a tight fit for the ${plan} plan${at}.`
      : `Your deck is a tight fit for its commander${at}.`;
  }
  if (score >= 75) {
    return plan
      ? `Your deck reliably executes the ${plan} plan${at}, with a little room to grow.`
      : `Your deck is performing well${at}, with a little room to grow.`;
  }
  if (score >= 60) {
    return plan
      ? `Your deck solidly follows the ${plan} plan${at}, with clear room for improvement.`
      : `Your deck is solid${at}, with clear room for improvement.`;
  }
  if (score >= 40) {
    return plan
      ? `Your deck has the foundation of the ${plan} plan${at}, but needs some tuning.`
      : `Your deck has the foundation${at}, but needs some tuning.`;
  }
  return plan
    ? `Your deck is missing key pieces of the ${plan} plan${at}.`
    : `Your deck is missing key pieces of its plan${at}.`;
}

/**
 * Data-lineage line under the splash headline.
 *
 * Names the reference class explicitly. The old copy ("Based on N decklists")
 * said where the data came from but not what the deck was being compared
 * against, which is the thing that makes a 0-100 legible — and it matters more
 * now that the headline states a bracket beside the score.
 */
export function bylineFor(sampleSize?: number | null, commanderLabel?: string | null): string {
  const who = commanderLabel?.trim()
    ? `the average ${commanderLabel} deck`
    : 'the average deck for this commander';
  const n = sampleSize && sampleSize > 0 ? ` (${sampleSize.toLocaleString()} decklists)` : '';
  return `Compared to ${who}.${n}`;
}

// Roles: how close are we to per-role targets, weighted by role criticality.
// Reusing the existing rolesGrade letter as a coarse score is tempting, but we
// want a 0-100 that matches the rest of the dashboard.
const ROLE_WEIGHTS: Record<string, number> = {
  ramp: 1.0,
  removal: 1.0,
  boardwipe: 0.7, // wipes are important but variance-heavy
  cardDraw: 1.0,
  protection: 0.6, // valuable resilience, but more deck-dependent than the core four
};

export function computeRolesSubscore(roleBreakdowns: RoleBreakdown[]): SubScore {
  if (roleBreakdowns.length === 0) {
    return { value: 50, surface: 'No role data available.', bandLabel: 'Unscored', partial: true, partialReason: 'no-data' };
  }

  let weighted = 0;
  let weightTotal = 0;
  const thin: string[] = [];

  for (const rb of roleBreakdowns) {
    const w = ROLE_WEIGHTS[rb.role] ?? 0.5;
    // Role targets are floors — the Roles tab labels each one "at least N" — so meeting one is full
    // marks and running more costs nothing here. Excess is Card Fit's call: its cut list already
    // names "excess removal" and the like. A zero target is met by definition.
    const norm = rb.target > 0 ? Math.min(1, rb.current / rb.target) : 1;
    weighted += norm * w;
    weightTotal += w;
    if (rb.current < rb.target * 0.7) thin.push(rb.label);
  }

  const value = Math.round((weighted / Math.max(1, weightTotal)) * 100);
  const surface = thin.length === 0
    ? 'All roles healthy.'
    : `Low on ${thin.slice(0, 2).join(' and ')}${thin.length > 2 ? ` (+${thin.length - 2})` : ''}.`;

  return { value, surface, bandLabel: bandFor(value) };
}

// Tempo: deviation of deck curve from EDHREC commander average curve.
// Lower deviation = higher score. Early-game gaps weighted heavier.
export function computeTempoSubscore(curvePhases: CurvePhaseAnalysis[]): SubScore {
  if (curvePhases.length === 0) {
    return { value: 50, surface: 'No curve data available.', bandLabel: 'Unscored', partial: true, partialReason: 'no-data' };
  }

  // Use phase-level totals as a proxy: each phase has current vs target.
  let weighted = 0;
  let weightTotal = 0;
  let weakestPhase: string | null = null;
  let weakestRatio = Infinity;
  for (const phase of curvePhases) {
    // Only shortfalls count. getCurvePhases normalizes the phase targets to sum to the non-land
    // count, so a phase over target always forces another one under it — penalizing the overshoot
    // as well charged the same misplaced cards twice.
    const ratio = phase.target > 0 ? phase.current / phase.target : 1;
    const w = phase.phase === 'early' ? 1.4 : phase.phase === 'mid' ? 1.0 : 0.7;
    const norm = Math.min(1, ratio);
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

const WEIGHTS: Record<SubScoreKey, number> = {
  strategy: 0.30,
  roles: 0.25,
  tempo: 0.20,
  cardFit: 0.25,
};

export interface PointsToGain {
  key: SubScoreKey;
  /** Whole points the overall score would gain if this area reached 100. */
  points: number;
}

/**
 * How the gap between the overall score and 100 splits across the scored areas — the Overview's
 * "path to 100". Each area's share is its shortfall × its weight in the composite; partial areas are
 * left out exactly as composePlanScore leaves them out. Whole points via largest remainder, so the
 * parts always add up to `100 − overall` and the line never promises a point the score can't show.
 */
export function pointsToHundred(planScore: PlanScore): PointsToGain[] {
  const scored = (Object.keys(planScore.subscores) as SubScoreKey[]).filter(k => !planScore.subscores[k].partial);
  const weightTotal = scored.reduce((s, k) => s + WEIGHTS[k], 0);
  const gap = 100 - planScore.overall;
  if (weightTotal === 0 || gap <= 0) return [];

  const raw = scored.map(k => ({ key: k, exact: (100 - planScore.subscores[k].value) * WEIGHTS[k] / weightTotal }));
  const rawTotal = raw.reduce((s, r) => s + r.exact, 0);
  if (rawTotal <= 0) return [];
  // Rescale so the parts sum to the rounded gap the ring actually shows.
  const scaled = raw.map(r => ({ ...r, exact: r.exact * gap / rawTotal }));
  const out = scaled.map(r => ({ key: r.key, points: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  let left = gap - out.reduce((s, r) => s + r.points, 0);
  for (const r of [...out].sort((a, b) => b.rem - a.rem)) {
    if (left <= 0) break;
    r.points++;
    left--;
  }
  return out.filter(r => r.points > 0).map(({ key, points }) => ({ key, points }));
}

/**
 * The overall score after each prefix of a run of one-for-one swaps, as far as Card Fit can tell
 * without re-analysing the deck: each outgoing card leaves the misfit list, each incoming card leaves
 * the gap list, and Card Fit is recomputed with its own formula. Other areas are held where they are
 * — the launch pad pairs swaps by role, so roles and curve rarely move. An incoming card that would
 * itself be a misfit isn't modelled, so this is a projection, labelled as one wherever it's shown.
 *
 * `result[i]` is the score after swaps 0..i; a row's own gain is `result[i] − result[i−1]`.
 */
export function projectSwaps(
  planScore: PlanScore,
  misfits: Misfit[],
  gaps: GapAnalysisCard[],
  swaps: { out?: string; in?: string }[],
  /** When given, an incoming card on this list counts toward Strategy (the offered theme adds). */
  strategy?: { basis: StrategyBasis; themeAdds: string[] },
): number[] {
  const out = new Set<string>();
  const inn = new Set<string>();
  const themeAdds = new Set((strategy?.themeAdds ?? []).map(n => n.toLowerCase()));
  const top = new Set(strategy?.basis.topNames ?? []);
  return swaps.map(s => {
    if (s.out) out.add(s.out);
    if (s.in) inn.add(s.in);
    const cardFit = computeCardFitSubscore(
      misfits.filter(m => !out.has(m.card.name)),
      gaps.filter(g => !inn.has(g.name)),
    );
    const original = planScore.subscores.cardFit;
    let strat = planScore.subscores.strategy;
    if (strategy && !strat.partial) {
      const ins = [...inn].map(n => n.toLowerCase()).filter(n => themeAdds.has(n));
      strat = { ...strat, value: strategyValue({
        ...strategy.basis,
        inTheme: strategy.basis.inTheme + ins.length,
        hits: strategy.basis.hits + ins.filter(n => top.has(n)).length,
      }) };
    }
    return composePlanScore({
      ...planScore.subscores,
      strategy: strat,
      // Keep the area's partial status: an unscored Card Fit stays out of the composite.
      cardFit: { ...original, value: original.partial ? original.value : cardFit.value },
    }).overall;
  });
}

export interface ComposePlanScoreInputs {
  strategy: SubScore;
  roles: SubScore;
  tempo: SubScore;
  cardFit: SubScore;
  planName?: string | null;
  /** Sample size for byline. Pass null when unknown. */
  sampleSize?: number | null;
}

export function composePlanScore(inputs: ComposePlanScoreInputs): PlanScore {
  const subscores: Record<SubScoreKey, SubScore> = {
    strategy: inputs.strategy,
    roles: inputs.roles,
    tempo: inputs.tempo,
    cardFit: inputs.cardFit,
  };

  let weighted = 0;
  let weightTotal = 0;
  let limitedData = false;
  for (const k of Object.keys(subscores) as SubScoreKey[]) {
    const s = subscores[k];
    // Excluded from the average either way — an unscored area must not drag the composite down.
    // But only a genuine DATA gap flags limitedData: a deck with no theme has all the data in the
    // world and simply hasn't said what it's trying to do, which the dashboard prompt asks for
    // directly instead of blaming EDHREC for it.
    if (s.partial) {
      if (s.partialReason !== 'no-theme') limitedData = true;
      continue;
    }
    weighted += s.value * WEIGHTS[k];
    weightTotal += WEIGHTS[k];
  }
  const overall = Math.round(weightTotal > 0 ? weighted / weightTotal : 0);
  const bandLabel = bandFor(overall);
  const headline = headlineFor(overall, inputs.planName);
  // No commander name at this layer — HeroScore re-derives the byline with one.
  // This is the fallback for any other consumer.
  const byline = bylineFor(inputs.sampleSize);

  return { overall, bandLabel, headline, byline, subscores, limitedData, planName: inputs.planName };
}

/**
 * Card Fit charged only for what Card Fit offers. The analysis scores every misfit and every
 * widely played card the deck lacks, but the columns protect must-includes and combo pieces and
 * only trade a staple for a weaker card the deck runs. Scoring the analysis's lists left points
 * no swap could earn: a 60-card Valgavoth list sat at 80 with both columns empty. Re-scored here,
 * taking every offered swap reaches 100.
 */
export function scoreAgainstSwaps<A extends DeckAnalysis>(analysis: A, swaps: OptimizeSwaps | null): A {
  const plan = analysis.planScore;
  if (!plan || !swaps) return analysis;
  const offeredCuts = new Set(swaps.removals.map(r => r.name));
  const misfits = (analysis.misfits ?? []).filter(m => offeredCuts.has(m.card.name));
  const gaps = swaps.stapleGaps ?? [];
  const original = plan.subscores.cardFit;
  const fit = computeCardFitSubscore(misfits, gaps);
  // An unscored Card Fit stays unscored and out of the composite.
  const cardFit = original.partial ? original : { ...original, value: fit.value, surface: fit.surface, bandLabel: fit.bandLabel };
  // Strategy, the same way: its targets come down to what the offered theme swaps can reach. With
  // none on offer, the deck is as on-plan as Card Fit can make it.
  let strategy = plan.subscores.strategy;
  let strategyBasis = analysis.strategyBasis;
  if (strategyBasis && !strategy.partial) {
    const offered = swaps.themeAdds ?? [];
    const top = new Set(strategyBasis.topNames);
    const offeredHits = offered.filter(n => top.has(n.toLowerCase())).length;
    strategyBasis = {
      ...strategyBasis,
      densityTarget: Math.min(strategyBasis.densityTarget, strategyBasis.inTheme + offered.length),
      hitTarget: strategyBasis.hitTarget == null ? null : Math.min(strategyBasis.hitTarget, strategyBasis.hits + offeredHits),
    };
    const value = strategyValue(strategyBasis);
    strategy = { ...strategy, value, bandLabel: bandFor(value) };
  }
  const planScore = { ...composePlanScore({ ...plan.subscores, cardFit, strategy, planName: plan.planName }), byline: plan.byline };
  return { ...analysis, planScore, cardFitMisfits: misfits, cardFitGaps: gaps, strategyBasis, strategyThemeAdds: swaps.themeAdds ?? [] };
}
