import { scoreRecommendation, type ScoringContext, type RoleDeficit, type CurveSlot, type TypeSlot } from '@/services/deckBuilder/deckAnalyzer';
import { ROLE_LABELS } from '@/services/deckBuilder/roleTargets';
import type { RoleKey } from '@/services/tagger/client';
import type { BrewContext, BrewState, BrewCandidate } from './brewTypes';
import { buildHealth } from './health';
import { relicMult, relicThemeMult } from './relics';

const ROLE_KEYS: RoleKey[] = ['ramp', 'removal', 'boardwipe', 'cardDraw', 'protection'];

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

/** Deck fill fraction (0 = empty, 1 = at the nonland target). Drives the affinity ramp + commit scaling. */
export function deckFill(ctx: BrewContext, state: BrewState): number {
  const target = ctx.nonLandTarget || 1;
  return Math.max(0, Math.min(1, state.picks.length / target));
}

/**
 * Below this deck-fill fraction the run is in its "identity" phase: packs stay theme-focused so the
 * deck's direction forms first. Past it, deficit/"need" packs return to fill holes and add staples.
 */
export const IDENTITY_PHASE_FILL = 0.3;

/**
 * Per-unit-of-affinity weight, ramped by deck fill: identity barely steers early (exploration) and
 * firms up late (consequences). The late weight is intentionally capped (was 1.3) — combined with
 * the concave affinity response below, this stops the lead theme's advantage from compounding into
 * a late-game lock-in, which was the biggest driver of "every deck feels the same".
 */
const AFFINITY_WEIGHT_EARLY = 0.4;
const AFFINITY_WEIGHT_LATE = 0.9;
export function affinityWeight(ctx: BrewContext, state: BrewState): number {
  return AFFINITY_WEIGHT_EARLY + (AFFINITY_WEIGHT_LATE - AFFINITY_WEIGHT_EARLY) * deckFill(ctx, state);
}

/**
 * Concave (diminishing-returns) response to accumulated affinity. A theme 4× ahead is only ~2×
 * stronger, so a runaway lead can't crowd everything else out — yet more picks still always mean
 * more lean (monotonic). Scaled so a freshly-leaning theme (~20-40 affinity) contributes a
 * meaningful-but-not-dominant boost next to the ~100-200 base scores.
 */
const AFFINITY_SCALE = 6;
function affinityResponse(affinity: number): number {
  return AFFINITY_SCALE * Math.sqrt(Math.max(0, affinity));
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

/**
 * Cluster bonus: a card the whole-deck Lift Web found is lifted by N of your cards. We reward that
 * breadth directly (capped) so "fits the deck as a whole" floats up. These finds only exist late-run
 * (the scan fires past mid-game), so this is inherently the "especially later in the run" signal.
 */
const CLUSTER_PER_CONN = 6;
const CLUSTER_CONN_CAP = 6;

/** Flat bump for a card the player chose to chase at a Combo Fragment ("Investigate"). */
const COMBO_WATCH_BONUS = 30;

/** Per-point-of-inclusion bonus applied per unit of efficiency above 1 (the Efficient Brew). */
const INCLUSION_WEIGHT = 0.4;

/** Flat bonus for a card the player pinned "for later" — floats it back up in future offers. */
const PIN_BONUS = 25;

/** Combo glue (appears in ≥2 of the commander's combos) gets a small, capped bump so it surfaces a
 *  bit more often in packs — never enough to leapfrog a clearly better card. */
const COMBO_PIECE_PER = 4;
const COMBO_PIECE_CAP = 6;   // count past this stops adding (max ≈ +24)

/**
 * On-mechanic bonus: a card that carries the CHARACTERISTIC tags of a theme the deck is leaning into
 * gets a small, capped bump so genuine payoffs outrank incidental staples inside theme packs and their
 * ordering. Deliberately below the affinity/combo magnitudes — a tiebreaker, not a new dominant force.
 */
const ON_MECHANIC_BASE = 8;
const ON_MECHANIC_PER_EXTRA = 5;
const ON_MECHANIC_CAP = 18;

/**
 * "Deep cuts early": while the deck is forming its identity, favor theme-DEFINING cards (high EDHREC
 * synergy — they show up far more in this commander's decks than baseline) and dampen generic staples
 * (high inclusion, low synergy). Full strength on an empty deck, fading to zero by mid-game so staples
 * flow back in naturally once the identity is set. Mirrors the deck generator's Hyper Focus idea.
 */
const DEEP_CUT_FADE_FILL = 0.5;     // bias is gone once the deck is this full
const DEEP_CUT_SYNERGY_W = 140;     // reward per unit of synergy (synergy is -1..1)
const DEEP_CUT_STAPLE_W = 90;       // dampening per unit of (inclusion × non-synergy)

/** An inclusion at/above this counts as a "proven staple" the Efficient Brew visibly promotes. */
const EFFICIENT_PROMOTE_INCLUSION = 50;

/**
 * Did the chosen philosophy actively promote this candidate — the boolean behind the tiny
 * philosophy glyph on offered cards ("The Spicy Brew found this"), so the pick-6 choice keeps
 * visibly paying dividends instead of vanishing into an invisible multiplier. Mirrors where
 * scoreCandidate/discovery actually apply each philosophy's lever:
 *  - Efficient  → proven staples (the inclusion-weighted bonus above);
 *  - Spicy      → cards the discovery graph surfaced (its lever is the discovery RATE);
 *  - Combo Brew → pieces the player is chasing (the comboWatch bonus it amplifies).
 */
export function philosophyPromoted(state: BrewState, c: BrewCandidate): boolean {
  const p = state.relics[0];
  if (!p) return false;
  if (p.effect.type === 'efficiency') return (c.inclusion ?? 0) >= EFFICIENT_PROMOTE_INCLUSION;
  if (p.effect.type === 'discoveryRate') return !!c.discoveredVia;
  if (p.effect.type === 'comboBias') return state.comboWatch.includes(c.name);
  return false;
}

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
  for (const tag of matchingTags) affinity += affinityResponse(state.themeAffinity[tag] ?? 0) * w * relicThemeMult(state.relics, tag);
  let discovery = 0;
  if (candidate.discoveredVia) {
    discovery = (candidate.coSynergy ?? 0) * DISCOVERY_WEIGHT;
    if (candidate.discoverySource === 'lift') discovery += LIFT_BONUS;
  }
  // Whole-deck cluster pull: rewards a find that's lifted by MANY of your cards (capped).
  const cluster = (candidate.connectionCount ?? 0) >= 2
    ? Math.min(candidate.connectionCount!, CLUSTER_CONN_CAP) * CLUSTER_PER_CONN
    : 0;
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
  // Combo glue floats up a touch (capped) so recurring combo pieces show in packs more often.
  const comboCount = ctx.comboPieceCounts[candidate.name] ?? 0;
  const comboPiece = comboCount >= 2 ? Math.min(comboCount, COMBO_PIECE_CAP) * COMBO_PIECE_PER : 0;
  // Deep-cut early bias: reward theme-defining synergy, dampen generic staples, fading out by mid-game.
  const earlyRamp = Math.max(0, 1 - deckFill(ctx, state) / DEEP_CUT_FADE_FILL);
  const syn = candidate.edhrec.synergy ?? 0;            // -1..1; defining-ness for this commander
  const incl = candidate.inclusion ?? 0;                // 0..100; staple-ness
  const stapleness = (incl / 100) * (1 - Math.max(0, Math.min(1, syn)));
  const deepCut = earlyRamp * (syn * DEEP_CUT_SYNERGY_W - stapleness * DEEP_CUT_STAPLE_W);
  // After a commit, push off-theme cards below the surfacing line — unless they fill a critical role
  // or the player explicitly pinned them (an explicit "I want this" overrides the soft-remove).
  // Scaled by deck fill: gentle early (a committed deck still sees some spice) and firm late.
  const penalty = state.committedTheme
    && !candidate.themeTags.includes(state.committedTheme)
    && !isUrgentFill(ctx, state, candidate)
    && !pinned
    ? OFF_THEME_PENALTY * (0.5 + 0.5 * deckFill(ctx, state)) : 0;
  // On-mechanic bump: for the leaning themes this card matches, how many of those themes'
  // characteristic tags it carries. Scaled by the same affinity weight ramp so it grows with
  // commitment; capped so it never dominates. No-op when tag data is absent or nothing matches.
  let onMechanic = 0;
  if (ctx.themeCharTags && candidate.chromaTags?.length && matchingTags.length > 0) {
    let matchCount = 0;
    for (const slug of matchingTags) {
      const chars = ctx.themeCharTags[slug];
      if (!chars) continue;
      for (const t of chars) if (candidate.chromaTags.includes(t)) { matchCount++; }
    }
    if (matchCount > 0) {
      onMechanic = Math.min(ON_MECHANIC_CAP, ON_MECHANIC_BASE + ON_MECHANIC_PER_EXTRA * (matchCount - 1)) * w;
    }
  }
  return base + affinity + discovery + cluster + combo - penalty + staples + pin + comboPiece + deepCut + onMechanic;
}
