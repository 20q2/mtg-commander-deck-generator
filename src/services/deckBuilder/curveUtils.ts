import type { EDHRECCommanderStats } from '@/types';
import type { Pacing } from '@/types';
import { PACING_CURVE_MULTIPLIERS } from './roleTargets';

/** The card-type buckets the generator allocates. `battle` is last and usually 0. */
export const TYPE_TARGET_KEYS = [
  'creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'battle',
] as const;

/**
 * Shape used when a commander has no usable EDHREC distribution. Shared with the Advanced
 * Customization panel, which opens on these same numbers — a second copy over there drifted
 * out of sync with this one (45% creatures here vs 49% on screen) and nothing caught it.
 * Percentages, summing to 100.
 */
export const FALLBACK_TYPE_WEIGHTS: Record<string, number> = {
  creature: 49, instant: 12, sorcery: 12, artifact: 12, enchantment: 12, planeswalker: 3,
};

/** As FALLBACK_TYPE_WEIGHTS, for the mana curve: percentage of non-lands per CMC bucket. */
export const FALLBACK_CURVE_WEIGHTS: Record<number, number> = {
  0: 2, 1: 12, 2: 20, 3: 25, 4: 18, 5: 12, 6: 6, 7: 5,
};

/**
 * Move the whole rounding leftover into one bucket so the targets sum to `total` exactly.
 *
 * Mutates `targets`. `overflowKey` names the sink (creatures, for type targets); without
 * one the largest bucket absorbs it, which is where the curve has always put it.
 */
function closeGap<K extends string | number>(
  targets: Record<K, number>,
  total: number,
  overflowKey?: K
): Record<K, number> {
  const keys = Object.keys(targets) as K[];
  if (keys.length === 0) return targets;

  const diff = total - keys.reduce((s, k) => s + targets[k], 0);
  if (diff === 0) return targets;

  const sink = overflowKey !== undefined && targets[overflowKey] !== undefined
    ? overflowKey
    : keys.reduce((max, k) => (targets[k] > targets[max] ? k : max), keys[0]);
  targets[sink] += diff;
  return targets;
}

/**
 * Split `total` cards across buckets in proportion to `weights`, landing on `total` exactly.
 *
 * Rounding each bucket on its own drifts by up to half a card per bucket, so six type
 * sliders can describe a 97- or 101-card deck. Every allocation in the app goes through
 * here instead — the generator's targets AND the Advanced Customization panel that displays
 * them — so the panel shows the numbers the build will actually aim for.
 *
 * `weights` are normalized, so they need not already sum to 100.
 */
export function apportionTargets<K extends string | number>(
  weights: Record<K, number>,
  total: number,
  overflowKey?: K
): Record<K, number> {
  const keys = Object.keys(weights) as K[];
  const targets = {} as Record<K, number>;

  const weightTotal = keys.reduce((s, k) => s + (weights[k] || 0), 0);
  if (weightTotal <= 0) return targets;

  for (const k of keys) targets[k] = Math.round(((weights[k] || 0) / weightTotal) * total);
  return closeGap(targets, total, overflowKey);
}

/**
 * Calculate type distribution as percentages of non-land cards
 */
export function calculateTypePercentages(stats: EDHRECCommanderStats): Record<string, number> {
  const { typeDistribution, landDistribution } = stats;

  // Total non-land cards from EDHREC
  const totalNonLand =
    typeDistribution.creature +
    typeDistribution.instant +
    typeDistribution.sorcery +
    typeDistribution.artifact +
    typeDistribution.enchantment +
    typeDistribution.planeswalker +
    typeDistribution.battle;

  if (totalNonLand === 0) return {};

  return {
    creature: (typeDistribution.creature / totalNonLand) * 100,
    instant: (typeDistribution.instant / totalNonLand) * 100,
    sorcery: (typeDistribution.sorcery / totalNonLand) * 100,
    artifact: (typeDistribution.artifact / totalNonLand) * 100,
    enchantment: (typeDistribution.enchantment / totalNonLand) * 100,
    planeswalker: (typeDistribution.planeswalker / totalNonLand) * 100,
    battle: (typeDistribution.battle / totalNonLand) * 100,
    land: landDistribution.total, // Keep as absolute count for reference
    basicLand: landDistribution.basic,
    nonbasicLand: landDistribution.nonbasic,
  };
}

/**
 * Convert mana curve counts to percentages
 */
export function calculateCurvePercentages(manaCurve: Record<number, number>): Record<number, number> {
  const total = Object.values(manaCurve).reduce((sum, count) => sum + count, 0);
  if (total === 0) return {};

  // Clamp to 7+ bucket (EDHREC groups everything 7+ together)
  const clamped: Record<number, number> = {};
  for (const [cmc, count] of Object.entries(manaCurve)) {
    const key = Math.min(parseInt(cmc), 7);
    clamped[key] = (clamped[key] || 0) + count;
  }

  const percentages: Record<number, number> = {};
  for (const [cmc, count] of Object.entries(clamped)) {
    percentages[parseInt(cmc)] = (count / total) * 100;
  }
  return percentages;
}

/** Shift a curve's shape by the pacing multipliers, then re-close the gap to `total`. */
function applyPacing(
  targets: Record<number, number>,
  total: number,
  pacing: Pacing
): Record<number, number> {
  const mult = PACING_CURVE_MULTIPLIERS[pacing];
  for (const cmc of Object.keys(targets).map(Number)) {
    const phase = cmc <= 2 ? 'early' : cmc <= 4 ? 'mid' : 'late';
    targets[cmc] = Math.round(targets[cmc] * mult[phase]);
  }
  return closeGap(targets, total);
}

/**
 * Calculate target counts for each CMC bucket based on:
 * 1. EDHREC mana curve percentages
 * 2. Total non-land cards needed
 */
export function calculateCurveTargets(
  manaCurve: Record<number, number>,
  totalNonLandCards: number,
  pacing?: Pacing
): Record<number, number> {
  const percentages = calculateCurvePercentages(manaCurve);

  const targets = Object.keys(percentages).length === 0
    ? apportionTargets(FALLBACK_CURVE_WEIGHTS, totalNonLandCards)
    : apportionTargets(percentages, totalNonLandCards);

  // Shift the curve's shape (skip if balanced or not specified)
  return pacing && pacing !== 'balanced' ? applyPacing(targets, totalNonLandCards, pacing) : targets;
}

/**
 * Calculate target counts for each card type based on EDHREC percentages
 */
export function calculateTypeTargets(
  stats: EDHRECCommanderStats,
  totalNonLandCards: number
): Record<string, number> {
  const percentages = calculateTypePercentages(stats);

  console.log('[CurveUtils] EDHREC type distribution:', stats.typeDistribution);
  console.log('[CurveUtils] Calculated percentages:', percentages);
  console.log('[CurveUtils] Total non-land cards to allocate:', totalNonLandCards);

  if (Object.keys(percentages).length === 0) {
    console.log('[CurveUtils] Using fallback defaults (no EDHREC data)');
    return apportionTargets(FALLBACK_TYPE_WEIGHTS, totalNonLandCards, 'creature');
  }

  // calculateTypePercentages also returns absolute land counts under `land`/`basicLand`/
  // `nonbasicLand`, so pick the card-type keys out rather than apportioning the whole object.
  const weights: Record<string, number> = {};
  for (const type of TYPE_TARGET_KEYS) weights[type] = percentages[type] ?? 0;
  const targets = apportionTargets(weights, totalNonLandCards, 'creature');

  console.log('[CurveUtils] Final type targets:', targets, 'Total:', Object.values(targets).reduce((a, b) => a + b, 0));

  return targets;
}

/**
 * Check if a CMC bucket has room for more cards
 * Uses soft targeting with 10% overflow tolerance
 */
export function hasCurveRoom(
  cmc: number,
  curveTargets: Record<number, number>,
  currentCounts: Record<number, number>
): boolean {
  const normalizedCmc = Math.min(cmc, 7); // Cap at 7+
  const target = curveTargets[normalizedCmc] ?? 0;
  const current = currentCounts[normalizedCmc] ?? 0;

  // Allow 10% overflow, minimum 1 card tolerance
  const tolerance = Math.max(1, Math.ceil(target * 0.1));
  return current < target + tolerance;
}
