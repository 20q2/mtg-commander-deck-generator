import { Archetype, type DeckFormat, type ThemeResult, type EDHRECCommanderStats } from '@/types';
import type { Pacing } from './themeDetector';
import type { RoleKey } from '@/services/tagger/client';

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

const PACING_ROLE_ADJUSTMENTS: Record<Pacing, Record<RoleKey, number>> = {
  'aggressive-early': { ramp: 1.10, removal: 0.90, boardwipe: 0.85, cardDraw: 0.90 },
  'fast-tempo':       { ramp: 1.05, removal: 0.95, boardwipe: 0.90, cardDraw: 0.95 },
  'midrange':         { ramp: 1.00, removal: 1.00, boardwipe: 1.00, cardDraw: 1.00 },
  'late-game':        { ramp: 0.90, removal: 1.05, boardwipe: 1.15, cardDraw: 1.10 },
  'balanced':         { ramp: 1.00, removal: 1.00, boardwipe: 1.00, cardDraw: 1.00 },
};

// ─── Pacing Estimation from EDHREC Stats ────────────────────────────

/**
 * Estimate pacing from EDHREC mana curve stats (before card selection).
 * Same thresholds as detectPacing() but computed from aggregate stats
 * without keyword analysis.
 */
function estimatePacingFromStats(manaCurve: Record<number, number>): Pacing {
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
): { targets: Record<RoleKey, number>; archetype: Archetype; pacing: Pacing } {
  const base = getBaseRoleTargets(format);

  const archetype = inferArchetype(selectedThemes);
  const archetypeMults = ARCHETYPE_ROLE_MULTIPLIERS[archetype];

  const pacing: Pacing = edhrecStats?.manaCurve
    ? estimatePacingFromStats(edhrecStats.manaCurve)
    : 'balanced';
  const pacingMults = PACING_ROLE_ADJUSTMENTS[pacing];

  const result = {} as Record<RoleKey, number>;
  let total = 0;

  for (const role of ROLE_KEYS) {
    const raw = base[role] * archetypeMults[role] * pacingMults[role];
    result[role] = Math.max(role === 'boardwipe' ? 0 : 1, Math.round(raw));
    total += result[role];
  }

  // Cap total to reasonable range (scaled by format)
  const maxTotal = Math.round(format * 0.35); // ~34 for 99
  const minTotal = Math.round(format * 0.28); // ~28 for 99

  if (total > maxTotal) {
    const scale = maxTotal / total;
    for (const role of ROLE_KEYS) {
      result[role] = Math.max(role === 'boardwipe' ? 0 : 1, Math.round(result[role] * scale));
    }
  } else if (total < minTotal) {
    const scale = minTotal / total;
    for (const role of ROLE_KEYS) {
      result[role] = Math.round(result[role] * scale);
    }
  }

  console.log(`[DeckGen] Dynamic role targets: archetype=${archetype}, pacing=${pacing}`, result,
    `(total=${Object.values(result).reduce((s, v) => s + v, 0)})`);

  return { targets: result, archetype, pacing };
}
