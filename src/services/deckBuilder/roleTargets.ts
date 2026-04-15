import { Archetype, type DeckFormat, type ThemeResult, type EDHRECCommanderStats, type EDHRECCommanderData, type RoleTargetBreakdown } from '@/types';
import type { Pacing } from './themeDetector';
import { getCardRole, type RoleKey } from '@/services/tagger/client';

// ─── EDHREC Blend Tuning ────────────────────────────────────────────
// Threshold for "cards in the typical deck for this commander" — a card above
// this inclusion % is played in roughly 1 of every 4 tracked decks.
export const EDHREC_INCLUSION_THRESHOLD = 25; // percent

// Weight for the EDHREC-derived role counts in the final blended target.
// Default 0.6 means 60% EDHREC / 40% archetype model. Overridable per-deck
// via customization.advancedTargets.edhrecBlendWeight.
export const EDHREC_BLEND_WEIGHT = 0.6;

// ─── EDHREC-Derived Role Counts ─────────────────────────────────────
// For the current commander, count cards per role whose EDHREC inclusion
// meets the threshold. Lands are skipped (basics dominate the distribution
// and role classification doesn't apply). Cards whose role is undefined
// are assumed to be synergy/payoff pieces and correctly contribute nothing.
export function computeEdhrecRoleTargets(
  edhrecData: EDHRECCommanderData | null | undefined,
  threshold: number = EDHREC_INCLUSION_THRESHOLD,
): Record<RoleKey, number> {
  const counts: Record<RoleKey, number> = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
  if (!edhrecData?.cardlists?.allNonLand) return counts;

  for (const card of edhrecData.cardlists.allNonLand) {
    if (card.inclusion < threshold) continue;
    const role = getCardRole(card.name);
    if (role) counts[role]++;
  }

  return counts;
}

// ─── Theme → Archetype Mapping ──────────────────────────────────────

const THEME_TO_ARCHETYPE: Record<string, Archetype> = {
  // Aggro / Combat
  aggro:             Archetype.AGGRO,
  combat:            Archetype.AGGRO,
  'extra combat':    Archetype.AGGRO,
  infect:            Archetype.AGGRO,
  poison:            Archetype.AGGRO,

  // Control
  control:           Archetype.CONTROL,
  stax:              Archetype.CONTROL,
  pillowfort:        Archetype.CONTROL,

  // Combo
  combo:             Archetype.COMBO,
  'extra turns':     Archetype.COMBO,

  // Voltron / Equipment / Auras
  voltron:           Archetype.VOLTRON,
  equipment:         Archetype.VOLTRON,
  auras:             Archetype.VOLTRON,

  // Spellslinger
  spellslinger:      Archetype.SPELLSLINGER,
  cantrips:          Archetype.SPELLSLINGER,

  // Tokens
  tokens:            Archetype.TOKENS,
  'go wide':         Archetype.TOKENS,

  // Aristocrats / Sacrifice
  aristocrats:       Archetype.ARISTOCRATS,
  sacrifice:         Archetype.ARISTOCRATS,
  lifedrain:         Archetype.ARISTOCRATS,

  // Reanimator / Graveyard
  reanimator:        Archetype.REANIMATOR,
  graveyard:         Archetype.REANIMATOR,
  mill:              Archetype.REANIMATOR,
  dredge:            Archetype.REANIMATOR,
  flashback:         Archetype.REANIMATOR,

  // Landfall / Lands
  landfall:          Archetype.LANDFALL,
  lands:             Archetype.LANDFALL,

  // Artifacts
  artifacts:         Archetype.ARTIFACTS,
  treasures:         Archetype.ARTIFACTS,
  vehicles:          Archetype.ARTIFACTS,
  clues:             Archetype.ARTIFACTS,
  food:              Archetype.ARTIFACTS,

  // Enchantress
  enchantress:       Archetype.ENCHANTRESS,
  enchantments:      Archetype.ENCHANTRESS,
  constellation:     Archetype.ENCHANTRESS,

  // Storm
  storm:             Archetype.STORM,

  // Tribal — individual tribes all map here
  tribal:            Archetype.TRIBAL,
  elves:             Archetype.TRIBAL,
  goblins:           Archetype.TRIBAL,
  zombies:           Archetype.TRIBAL,
  vampires:          Archetype.TRIBAL,
  dragons:           Archetype.TRIBAL,
  angels:            Archetype.TRIBAL,
  demons:            Archetype.TRIBAL,
  wizards:           Archetype.TRIBAL,
  warriors:          Archetype.TRIBAL,
  rogues:            Archetype.TRIBAL,
  clerics:           Archetype.TRIBAL,
  soldiers:          Archetype.TRIBAL,
  knights:           Archetype.TRIBAL,
  merfolk:           Archetype.TRIBAL,
  spirits:           Archetype.TRIBAL,
  dinosaurs:         Archetype.TRIBAL,
  pirates:           Archetype.TRIBAL,
  cats:              Archetype.TRIBAL,
  dogs:              Archetype.TRIBAL,
  beasts:            Archetype.TRIBAL,
  elementals:        Archetype.TRIBAL,
  slivers:           Archetype.TRIBAL,
  allies:            Archetype.TRIBAL,
  humans:            Archetype.TRIBAL,

  // Midrange-ish strategies
  '+1/+1 counters':    Archetype.MIDRANGE,
  '-1/-1 counters':    Archetype.MIDRANGE,
  counters:            Archetype.MIDRANGE,
  proliferate:         Archetype.MIDRANGE,
  blink:               Archetype.MIDRANGE,
  flicker:             Archetype.MIDRANGE,
  etb:                 Archetype.MIDRANGE,
  clones:              Archetype.MIDRANGE,
  copy:                Archetype.MIDRANGE,
  lifegain:            Archetype.MIDRANGE,
  energy:              Archetype.MIDRANGE,
  cascade:             Archetype.MIDRANGE,
  monarch:             Archetype.MIDRANGE,

  // Goodstuff / catch-all
  superfriends:        Archetype.GOODSTUFF,
  planeswalkers:       Archetype.GOODSTUFF,
  chaos:               Archetype.GOODSTUFF,
  politics:            Archetype.GOODSTUFF,
  wheels:              Archetype.GOODSTUFF,
  discard:             Archetype.GOODSTUFF,
  tutors:              Archetype.GOODSTUFF,
};

// ─── Archetype Role Multipliers ─────────────────────────────────────
// Applied to format-based baseline targets.
// >1.0 = archetype wants MORE of this role, <1.0 = wants LESS.

const ARCHETYPE_ROLE_MULTIPLIERS: Record<Archetype, Record<RoleKey, number>> = {
  [Archetype.AGGRO]:        { ramp: 1.10, removal: 0.75, boardwipe: 0.67, cardDraw: 0.80 },
  [Archetype.CONTROL]:      { ramp: 0.90, removal: 1.25, boardwipe: 1.67, cardDraw: 1.10 },
  [Archetype.COMBO]:        { ramp: 1.00, removal: 0.88, boardwipe: 0.67, cardDraw: 1.20 },
  [Archetype.MIDRANGE]:     { ramp: 1.00, removal: 1.00, boardwipe: 1.00, cardDraw: 1.00 },
  [Archetype.VOLTRON]:      { ramp: 1.10, removal: 1.00, boardwipe: 0.33, cardDraw: 0.90 },
  [Archetype.SPELLSLINGER]: { ramp: 0.80, removal: 1.00, boardwipe: 1.00, cardDraw: 1.30 },
  [Archetype.TOKENS]:       { ramp: 1.00, removal: 0.88, boardwipe: 0.67, cardDraw: 1.00 },
  [Archetype.ARISTOCRATS]:  { ramp: 1.00, removal: 0.88, boardwipe: 0.67, cardDraw: 1.10 },
  [Archetype.REANIMATOR]:   { ramp: 0.90, removal: 0.88, boardwipe: 1.00, cardDraw: 1.20 },
  [Archetype.TRIBAL]:       { ramp: 1.00, removal: 0.88, boardwipe: 0.67, cardDraw: 1.00 },
  [Archetype.LANDFALL]:     { ramp: 1.30, removal: 0.75, boardwipe: 1.00, cardDraw: 0.90 },
  [Archetype.ARTIFACTS]:    { ramp: 1.10, removal: 0.88, boardwipe: 1.00, cardDraw: 1.00 },
  [Archetype.ENCHANTRESS]:  { ramp: 0.90, removal: 0.88, boardwipe: 1.00, cardDraw: 1.20 },
  [Archetype.STORM]:        { ramp: 1.10, removal: 0.63, boardwipe: 0.33, cardDraw: 1.40 },
  [Archetype.GOODSTUFF]:    { ramp: 1.00, removal: 1.00, boardwipe: 1.00, cardDraw: 1.00 },
};

// ─── Pacing Adjustments ─────────────────────────────────────────────
// Small secondary multipliers that fine-tune based on tempo.

export const PACING_ROLE_ADJUSTMENTS: Record<Pacing, Record<RoleKey, number>> = {
  'aggressive-early': { ramp: 1.10, removal: 0.90, boardwipe: 0.85, cardDraw: 0.90 },
  'fast-tempo':       { ramp: 1.05, removal: 0.95, boardwipe: 0.90, cardDraw: 0.95 },
  'midrange':         { ramp: 1.00, removal: 1.00, boardwipe: 1.00, cardDraw: 1.00 },
  'late-game':        { ramp: 0.90, removal: 1.05, boardwipe: 1.15, cardDraw: 1.10 },
  'balanced':         { ramp: 1.00, removal: 1.00, boardwipe: 1.00, cardDraw: 1.00 },
};

/** Multipliers for mana curve phases by pacing. Used by both generator and analyzer. */
export const PACING_CURVE_MULTIPLIERS: Record<Pacing, { early: number; mid: number; late: number }> = {
  'aggressive-early': { early: 1.20, mid: 0.95, late: 0.75 },
  'fast-tempo':       { early: 1.12, mid: 1.00, late: 0.82 },
  'balanced':         { early: 1.00, mid: 1.00, late: 1.00 },
  'midrange':         { early: 0.92, mid: 1.10, late: 0.95 },
  'late-game':        { early: 0.85, mid: 0.95, late: 1.25 },
};

// ─── Pacing Estimation from EDHREC Stats ────────────────────────────

/**
 * Estimate pacing from EDHREC mana curve stats (before card selection).
 * Same thresholds as detectPacing() but computed from aggregate stats
 * without keyword analysis.
 */
export function estimatePacingFromStats(manaCurve: Record<number, number>): Pacing {
  const total = Object.values(manaCurve).reduce((s, v) => s + v, 0);
  if (total === 0) return 'balanced';

  const weightedCmc = Object.entries(manaCurve)
    .reduce((s, [cmc, count]) => s + Number(cmc) * count, 0);
  const avgCmc = weightedCmc / total;

  let earlyCount = 0;
  let lateCount = 0;
  let midCount = 0;
  for (const [cmcStr, count] of Object.entries(manaCurve)) {
    const cmc = Number(cmcStr);
    if (cmc <= 2) earlyCount += count;
    else if (cmc >= 5) lateCount += count;
    else midCount += count;
  }

  const earlyPct = earlyCount / total;
  const latePct = lateCount / total;
  const midPct = midCount / total;

  if (avgCmc <= 2.5 && earlyPct >= 0.50) return 'aggressive-early';
  if (avgCmc <= 2.7 && earlyPct >= 0.42) return 'fast-tempo';
  if (avgCmc >= 3.8 || latePct >= 0.28) return 'late-game';
  if (avgCmc >= 2.8 && avgCmc < 3.8 && midPct >= 0.30) return 'midrange';
  return 'balanced';
}

// ─── Archetype Inference ────────────────────────────────────────────

export function inferArchetype(selectedThemes?: ThemeResult[]): Archetype {
  if (!selectedThemes?.length) return Archetype.GOODSTUFF;

  const selected = selectedThemes.filter(t => t.isSelected);
  if (!selected.length) return Archetype.GOODSTUFF;

  // Use existing archetype field if populated
  if (selected[0].archetype) return selected[0].archetype;

  // Look up primary theme name
  const lower = selected[0].name.toLowerCase().trim();
  return THEME_TO_ARCHETYPE[lower] ?? Archetype.GOODSTUFF;
}

// ─── Base Targets (format-only, backward compat) ────────────────────

export function getBaseRoleTargets(format: DeckFormat): Record<RoleKey, number> {
  if (format >= 99) return { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 };
  if (format >= 60) return { ramp: 4, removal: 5, boardwipe: 2, cardDraw: 4 };
  if (format >= 40) return { ramp: 2, removal: 3, boardwipe: 1, cardDraw: 2 };
  const ratio = format / 99;
  return {
    ramp: Math.max(1, Math.round(10 * ratio)),
    removal: Math.max(1, Math.round(8 * ratio)),
    boardwipe: Math.max(0, Math.round(3 * ratio)),
    cardDraw: Math.max(1, Math.round(10 * ratio)),
  };
}

// ─── Dynamic Role Targets (the main export) ─────────────────────────

const ROLE_KEYS: RoleKey[] = ['ramp', 'removal', 'boardwipe', 'cardDraw'];

export function getDynamicRoleTargets(
  format: DeckFormat,
  selectedThemes?: ThemeResult[],
  edhrecStats?: EDHRECCommanderStats,
  edhrecData?: EDHRECCommanderData | null,
  overrideBlendWeight?: number | null,
  overrideThreshold?: number | null,
): {
  targets: Record<RoleKey, number>;
  archetype: Archetype;
  pacing: Pacing;
  breakdown: Record<RoleKey, RoleTargetBreakdown>;
} {
  const base = getBaseRoleTargets(format);

  const archetype = inferArchetype(selectedThemes);
  const archetypeMults = ARCHETYPE_ROLE_MULTIPLIERS[archetype];

  const pacing: Pacing = edhrecStats?.manaCurve
    ? estimatePacingFromStats(edhrecStats.manaCurve)
    : 'balanced';
  const pacingMults = PACING_ROLE_ADJUSTMENTS[pacing];

  // EDHREC-derived counts (zero-filled when edhrecData is missing)
  const edhrecCounts = edhrecData
    ? computeEdhrecRoleTargets(edhrecData, overrideThreshold ?? EDHREC_INCLUSION_THRESHOLD)
    : null;

  const blendWeight = Math.min(1, Math.max(0, overrideBlendWeight ?? EDHREC_BLEND_WEIGHT));

  const result = {} as Record<RoleKey, number>;
  const breakdown = {} as Record<RoleKey, RoleTargetBreakdown>;
  let total = 0;

  for (const role of ROLE_KEYS) {
    const archetypeTarget = base[role] * archetypeMults[role];
    const blendedPrePacing = edhrecCounts
      ? blendWeight * edhrecCounts[role] + (1 - blendWeight) * archetypeTarget
      : archetypeTarget;
    const afterPacing = blendedPrePacing * pacingMults[role];

    const floor = role === 'boardwipe' ? 0 : 1;
    const finalCount = Math.max(floor, Math.round(afterPacing));
    result[role] = finalCount;
    total += finalCount;

    breakdown[role] = {
      edhrecCount: edhrecCounts ? edhrecCounts[role] : null,
      archetypeTarget: Math.round(archetypeTarget),
      pacingMultiplier: pacingMults[role],
      blended: finalCount,
    };
  }

  // Cap total to reasonable range (scaled by format)
  const maxTotal = Math.round(format * 0.35); // ~34 for 99
  const minTotal = Math.round(format * 0.28); // ~28 for 99

  if (total > maxTotal) {
    const scale = maxTotal / total;
    for (const role of ROLE_KEYS) {
      const floor = role === 'boardwipe' ? 0 : 1;
      result[role] = Math.max(floor, Math.round(result[role] * scale));
      breakdown[role].blended = result[role];
    }
  } else if (total < minTotal) {
    const scale = minTotal / total;
    for (const role of ROLE_KEYS) {
      const floor = role === 'boardwipe' ? 0 : 1;
      result[role] = Math.max(floor, Math.round(result[role] * scale));
      breakdown[role].blended = result[role];
    }
  }

  console.log(
    `[DeckGen] Dynamic role targets: archetype=${archetype}, pacing=${pacing}, blend=${blendWeight}`,
    result,
    `(total=${Object.values(result).reduce((s, v) => s + v, 0)}, edhrecCounts=${edhrecCounts ? JSON.stringify(edhrecCounts) : 'null'})`,
  );

  return { targets: result, archetype, pacing, breakdown };
}

// ─── Recompute Role Targets for Pacing Override ─────────────────────
// Adjusts existing role targets by dividing out the old pacing multipliers
// and applying new ones. Used when the user overrides tempo in the optimizer.

export function recomputeRoleTargetsForPacing(
  currentTargets: Record<string, number>,
  oldPacing: Pacing,
  newPacing: Pacing,
): Record<string, number> {
  if (oldPacing === newPacing) return currentTargets;

  const oldMults = PACING_ROLE_ADJUSTMENTS[oldPacing] ?? PACING_ROLE_ADJUSTMENTS['balanced'];
  const newMults = PACING_ROLE_ADJUSTMENTS[newPacing] ?? PACING_ROLE_ADJUSTMENTS['balanced'];

  const result: Record<string, number> = {};
  for (const role of ROLE_KEYS) {
    const oldM = oldMults[role] || 1;
    const newM = newMults[role] || 1;
    // Divide out old pacing, apply new pacing
    const raw = (currentTargets[role] || 0) / oldM * newM;
    result[role] = Math.max(role === 'boardwipe' ? 0 : 1, Math.round(raw));
  }

  return result;
}
