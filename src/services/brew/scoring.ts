import { scoreRecommendation, type ScoringContext, type RoleDeficit, type CurveSlot, type TypeSlot } from '@/services/deckBuilder/deckAnalyzer';
import { ROLE_LABELS } from '@/services/deckBuilder/roleTargets';
import type { RoleKey } from '@/services/tagger/client';
import type { BrewContext, BrewState, BrewCandidate } from './brewTypes';
import { buildHealth } from './health';
import { relicMult, relicThemeMult } from './relics';

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

/**
 * Per-unit-of-affinity weight, ramped by deck fill: identity barely steers early (exploration) and
 * dominates late (consequences), so two runs of the same commander diverge by mid-game.
 */
const AFFINITY_WEIGHT_EARLY = 0.4;
const AFFINITY_WEIGHT_LATE = 1.3;
export function affinityWeight(ctx: BrewContext, state: BrewState): number {
  const target = ctx.nonLandTarget || 1;
  const fill = Math.max(0, Math.min(1, state.picks.length / target));
  return AFFINITY_WEIGHT_EARLY + (AFFINITY_WEIGHT_LATE - AFFINITY_WEIGHT_EARLY) * fill;
}

/** Score penalty that drops an off-theme card below the surfacing line after a commit. */
const OFF_THEME_PENALTY = 60;
/** A role this fraction (or more) short still surfaces a staple even when off the committed theme. */
const URGENCY_RATIO = 0.75;

/**
 * True when this card fills a critically short role — used to let a needed staple (a board wipe, the
 * only ramp) break through the committed-theme penalty, so a commit never leaves the deck unplayable.
 */
export function isUrgentFill(ctx: BrewContext, state: BrewState, c: BrewCandidate): boolean {
  if (!c.role) return false;
  const target = ctx.roleTargets[c.role] ?? 0;
  if (target <= 0) return false;
  const current = buildHealth(ctx, state).roleCounts[c.role] ?? 0;
  return (target - current) / target >= URGENCY_RATIO;
}

/** Per-point-of-co-synergy bonus for discovered cards, plus a flat bump for high-lift finds. */
const DISCOVERY_WEIGHT = 0.3;
const LIFT_BONUS = 8;

/** Flat bump for a card the player chose to chase at a Combo Fragment ("Investigate"). */
const COMBO_WATCH_BONUS = 30;

/** Per-point-of-inclusion bonus applied per unit of efficiency above 1 (the Efficient Brew). */
const INCLUSION_WEIGHT = 0.4;

/** Flat bonus for a card the player pinned "for later" — floats it back up in future offers. */
const PIN_BONUS = 25;

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
  const w = affinityWeight(ctx, state);
  for (const tag of matchingTags) affinity += (state.themeAffinity[tag] ?? 0) * w * relicThemeMult(state.relics, tag);
  let discovery = 0;
  if (candidate.discoveredVia) {
    discovery = (candidate.coSynergy ?? 0) * DISCOVERY_WEIGHT;
    if (candidate.discoverySource === 'lift') discovery += LIFT_BONUS;
  }
  // Pieces the player chose to chase at a Combo Fragment ("Investigate") float to the top of
  // later packs. A comboBias relic amplifies the pull.
  const combo = state.comboWatch.includes(candidate.name) ? COMBO_WATCH_BONUS * relicMult(state.relics, 'comboBias') : 0;
  // The Efficient Brew (efficiency > 1): reward proven staples by inclusion and dampen speculative
  // discovery. eff === 1 (the default with no philosophy) is a no-op — scoring is unchanged.
  const eff = relicMult(state.relics, 'efficiency');
  const staples = (eff - 1) * (candidate.inclusion ?? 0) * INCLUSION_WEIGHT;
  discovery *= Math.max(0, 2 - eff);
  // Cards the player pinned for later get a flat boost so they resurface in future offers.
  const pinned = (state.pinnedNames ?? []).includes(candidate.name);
  const pin = pinned ? PIN_BONUS : 0;
  // After a commit, push off-theme cards below the surfacing line — unless they fill a critical role
  // or the player explicitly pinned them (an explicit "I want this" overrides the soft-remove).
  const penalty = state.committedTheme
    && !candidate.themeTags.includes(state.committedTheme)
    && !isUrgentFill(ctx, state, candidate)
    && !pinned
    ? OFF_THEME_PENALTY : 0;
  return base + affinity + discovery + combo - penalty + staples + pin;
}
