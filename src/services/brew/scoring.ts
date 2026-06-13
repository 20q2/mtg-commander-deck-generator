import { scoreRecommendation, type ScoringContext, type RoleDeficit, type CurveSlot, type TypeSlot } from '@/services/deckBuilder/deckAnalyzer';
import { ROLE_LABELS } from '@/services/deckBuilder/roleTargets';
import type { RoleKey } from '@/services/tagger/client';
import type { BrewContext, BrewState, BrewCandidate } from './brewTypes';
import { buildHealth } from './health';

const ROLE_KEYS: RoleKey[] = ['ramp', 'removal', 'boardwipe', 'cardDraw'];

/** Build the existing ScoringContext from current brew state, so we can reuse scoreRecommendation. */
export function buildScoringContext(ctx: BrewContext, state: BrewState): ScoringContext {
  const health = buildHealth(ctx, state);

  const roleDeficits: RoleDeficit[] = ROLE_KEYS.map(role => {
    const target = ctx.roleTargets[role] ?? 0;
    const current = health.roleCounts[role] ?? 0;
    return { role, label: ROLE_LABELS[role] ?? role, current, target, deficit: Math.max(0, target - current) };
  });

  const curveAnalysis: CurveSlot[] = Object.entries(ctx.curveTargets).map(([cmcStr, target]) => {
    const cmc = Number(cmcStr);
    const current = state.picks.filter(p => Math.min(7, Math.round(p.card.cmc ?? 0)) === cmc).length;
    return { cmc, current, target, delta: current - target };
  });

  const typeAnalysis: TypeSlot[] = Object.entries(ctx.typeTargets).map(([type, target]) => {
    const current = health.typeCounts[type] ?? 0;
    return { type, current, target, delta: current - target };
  });

  const currentSubtypeCounts: Record<string, number> = {};
  for (const p of state.picks) {
    if (p.subtype) currentSubtypeCounts[p.subtype] = (currentSubtypeCounts[p.subtype] ?? 0) + 1;
  }

  const roleCounts: Record<string, number> = { ...health.roleCounts };

  return { roleDeficits, curveAnalysis, typeAnalysis, currentSubtypeCounts, roleCounts };
}

/** Per-pick weight added per unit of accumulated theme affinity. Tuned conservative. */
const AFFINITY_WEIGHT = 0.5;

/**
 * Composite score for a candidate given current state.
 * Reuses scoreRecommendation (role/curve/type/combo/scarcity) and layers theme-affinity on top.
 * @param matchingTags tags of this candidate that the player has shown affinity for (Plan 2 supplies these).
 */
export function scoreCandidate(
  ctx: BrewContext,
  state: BrewState,
  candidate: BrewCandidate,
  matchingTags: string[] = [],
): number {
  const sc = buildScoringContext(ctx, state);
  const base = scoreRecommendation(candidate.edhrec, candidate.role, candidate.subtype, sc);
  let affinity = 0;
  for (const tag of matchingTags) affinity += (state.themeAffinity[tag] ?? 0) * AFFINITY_WEIGHT;
  return base + affinity;
}
