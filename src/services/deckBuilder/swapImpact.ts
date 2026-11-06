// src/services/deckBuilder/swapImpact.ts
//
// What a set of Card Fit swaps does to the deck, measured the way each part of the Inspector already
// measures it — plan score, bracket, combos, roles, curve, price — so the summary under the Card
// Fit header can never disagree with the tab it summarises. Every figure is a before/after of the
// SAME computation, so nothing reads as changed unless the swaps changed it.
import type { DetectedCombo, PlanScore, ScryfallCard } from '@/types';
import type { DeckAnalysis, OptimizeCard } from './deckAnalyzer';
import { projectSwaps } from './planScore';
import { estimateBracket } from './bracketEstimator';
import { recomputeComboCompleteness } from '../combos/detect';
import { getAllCardRoles } from '../tagger/client';
import { getCachedCard, getFrontFaceTypeLine } from '../scryfall/client';
import { ROLE_LABELS } from './roleTargets';

export interface SwapImpactInputs {
  cuts: OptimizeCard[];
  adds: OptimizeCard[];
  /** The deck without its commander(s). */
  currentCards: ScryfallCard[];
  commander?: ScryfallCard | null;
  partnerCommander?: ScryfallCard | null;
  analysis: DeckAnalysis;
  combos?: DetectedCombo[];
  /** Every Game Changer's name (the deck's cached list) — needed to re-estimate the bracket. */
  gameChangerNames?: string[];
  /** Stored role counts — the estimator's interaction measure reads these. */
  roleCounts?: Record<string, number>;
  priceDelta: number | null;
}

export interface RoleShift {
  role: string;
  label: string;
  from: number;
  to: number;
  target: number;
}

export interface SwapImpact {
  score?: { from: number; to: number };
  bracket?: { from: number; fromMax: number; to: number; toMax: number };
  combosCompleted: DetectedCombo[];
  combosBroken: DetectedCombo[];
  /** Roles whose count changes, in the Roles tab's own counting (a card counts in every lane). */
  roles: RoleShift[];
  manaValue?: { from: number; to: number };
  lands?: { from: number; to: number; target: number };
  misfitsCleared: string[];
  priceDelta: number | null;
}

const isLandCard = (c: OptimizeCard) => (c.primaryType ?? '').toLowerCase().includes('land');
const isLandScry = (c: ScryfallCard) => getFrontFaceTypeLine(c).toLowerCase().includes('land');

/** The add as a card object: the Scryfall cache when it has it, else enough of one for name checks. */
function asCard(c: OptimizeCard): ScryfallCard {
  return getCachedCard(c.name) ?? ({ name: c.name, type_line: c.primaryType ?? '', cmc: c.cmc ?? 0 } as ScryfallCard);
}

export function computeSwapImpact(i: SwapImpactInputs): SwapImpact {
  const cutNames = new Set(i.cuts.map(c => c.name));
  const after = [...i.currentCards.filter(c => !cutNames.has(c.name)), ...i.adds.map(asCard)];

  // ── Plan score: Card Fit's own projection, same as the Overview's "+N pts". ──
  const plan: PlanScore | undefined = i.analysis.planScore;
  let score: SwapImpact['score'];
  if (plan) {
    const steps = projectSwaps(plan, i.analysis.cardFitMisfits ?? i.analysis.misfits ?? [], i.analysis.cardFitGaps ?? i.analysis.gapAnalysis ?? [], [
      ...i.cuts.map(c => ({ out: c.name })),
      ...i.adds.map(c => ({ in: c.name })),
    ], i.analysis.strategyBasis ? { basis: i.analysis.strategyBasis, themeAdds: i.analysis.strategyThemeAdds ?? [] } : undefined);
    const to = steps.length ? steps[steps.length - 1] : plan.overall;
    if (to !== plan.overall) score = { from: plan.overall, to };
  }

  // ── Combos ──
  const before = i.combos ?? [];
  const recomputed = before.length > 0
    ? recomputeComboCompleteness(before, after, i.commander, i.partnerCommander)
    : [];
  const combosCompleted = recomputed.filter((c, k) => c.isComplete && !before[k].isComplete);
  const combosBroken = recomputed.filter((c, k) => !c.isComplete && before[k].isComplete);

  // ── Roles: lanes, as the Roles tab counts them ──
  const delta: Record<string, number> = {};
  for (const c of i.cuts) for (const r of getAllCardRoles(c.name)) delta[r] = (delta[r] ?? 0) - 1;
  for (const c of i.adds) for (const r of getAllCardRoles(c.name)) delta[r] = (delta[r] ?? 0) + 1;
  const roles: RoleShift[] = i.analysis.roleBreakdowns
    .filter(rb => (delta[rb.role] ?? 0) !== 0)
    .map(rb => ({ role: rb.role, label: rb.label || ROLE_LABELS[rb.role] || rb.role, from: rb.current, to: rb.current + delta[rb.role], target: rb.target }));

  // ── Curve and lands ──
  const avg = (cards: { cmc?: number }[]) =>
    cards.length ? cards.reduce((s, c) => s + (c.cmc ?? 0), 0) / cards.length : 0;
  const nonLandBefore = i.currentCards.filter(c => !isLandScry(c));
  const nonLandAfter = [
    ...nonLandBefore.filter(c => !cutNames.has(c.name)),
    // An add whose cost we don't know can't move an average honestly — leave it out.
    ...i.adds.filter(c => !isLandCard(c) && (c.cmc != null || getCachedCard(c.name))).map(c => ({ cmc: c.cmc ?? getCachedCard(c.name)?.cmc })),
  ];
  const mvFrom = avg(nonLandBefore);
  const mvTo = avg(nonLandAfter);
  const manaValue = Math.abs(mvTo - mvFrom) >= 0.05 ? { from: mvFrom, to: mvTo } : undefined;

  const landDelta = i.adds.filter(isLandCard).length - i.cuts.filter(isLandCard).length;
  const lands = landDelta !== 0
    ? { from: i.analysis.manaBase.currentLands, to: i.analysis.manaBase.currentLands + landDelta, target: i.analysis.manaBase.adjustedSuggestion }
    : undefined;

  // ── Bracket: the estimator run on both lists, so only the swaps move it. ──
  let bracket: SwapImpact['bracket'];
  if (i.gameChangerNames) {
    const gc = new Set(i.gameChangerNames);
    const commanders = [i.commander?.name, i.partnerCommander?.name].filter((n): n is string => !!n);
    const roleCountsAfter = { ...(i.roleCounts ?? {}) };
    for (const c of i.cuts) if (c.role) roleCountsAfter[c.role] = (roleCountsAfter[c.role] ?? 0) - 1;
    for (const c of i.adds) if (c.role) roleCountsAfter[c.role] = (roleCountsAfter[c.role] ?? 0) + 1;
    const estimate = (cards: ScryfallCard[], combos: DetectedCombo[], roleCounts: Record<string, number> | undefined) => {
      const nonLand = cards.filter(c => !isLandScry(c));
      return estimateBracket(
        [...cards.map(c => c.name), ...commanders],
        new Set(cards.filter(isLandScry).map(c => c.name)),
        combos,
        parseFloat(avg(nonLand).toFixed(2)),
        undefined,
        roleCounts,
        gc,
      );
    };
    const from = estimate(i.currentCards, before, i.roleCounts);
    const to = estimate(after, recomputed.length ? recomputed : before, roleCountsAfter);
    if (from.bracket !== to.bracket || from.bracketMax !== to.bracketMax) {
      bracket = { from: from.bracket, fromMax: from.bracketMax, to: to.bracket, toMax: to.bracketMax };
    }
  }

  const misfitNames = new Set((i.analysis.misfits ?? []).map(m => m.card.name));
  return {
    score,
    bracket,
    combosCompleted,
    combosBroken,
    roles,
    manaValue,
    lands,
    misfitsCleared: i.cuts.filter(c => misfitNames.has(c.name)).map(c => c.name),
    priceDelta: i.priceDelta,
  };
}
