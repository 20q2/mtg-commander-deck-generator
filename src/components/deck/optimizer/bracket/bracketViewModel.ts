import type { BracketEstimation } from '@/services/deckBuilder/bracketEstimator';
import type { DetectedCombo } from '@/types';
import { BRACKET_COLORS, BRACKET_LABELS, BRACKET_DESCRIPTIONS } from '../constants';

// ─── Raw color values ────────────────────────────────────────────────
// The prototype views need real color strings for SVG strokes and
// inline gradients, where Tailwind classes can't reach.

export const BRACKET_HEX: Record<number, string> = {
  1: '#34d399', // emerald-400
  2: '#38bdf8', // sky-400
  3: '#fbbf24', // amber-400
  4: '#fb923c', // orange-400
  5: '#f87171', // red-400
};

export type SoftKey = 'fastMana' | 'tutors' | 'cmc' | 'interaction';

/** Matches the palette the classic Bracket tab already uses for its score bars. */
export const SOFT_COLORS: Record<SoftKey, string> = {
  fastMana: 'hsl(38, 80%, 55%)',
  tutors: 'hsl(200, 80%, 55%)',
  cmc: 'hsl(155, 60%, 45%)',
  interaction: 'hsl(340, 65%, 55%)',
};

// ─── View-model shapes ───────────────────────────────────────────────

export interface SoftCriterion {
  key: SoftKey;
  name: string;
  /** Points earned in this category. */
  score: number;
  /** Points available in this category. */
  max: number;
  /** 0–100, score as a share of `max` (for the per-category bar). */
  pct: number;
  /** 0–100, score as a share of the whole 100-point soft score (for the stacked bar). */
  shareOfTotal: number;
  /** One plain-English sentence about what the deck actually has. */
  plain: string;
  /** The scoring rule, spelled out. */
  rule: string;
  /** Card names behind the score (empty for whole-deck measures like average cost). */
  cards: string[];
  color: string;
  /** True when the category is scoring its full allowance. */
  maxed: boolean;
}

/**
 * These are descriptions, not grades. A Bracket 4 deck is *supposed* to run
 * Game Changers, and a deck with no extra turns has not "done the right thing"
 * — it simply doesn't contain any. So: the element is either absent, present
 * and pointing at the bracket it requires, or measured but never forcing.
 */
export type GateStatus = 'absent' | 'present' | 'measured';

export interface Gate {
  key: string;
  name: string;
  /** Short right-aligned summary, e.g. "none" or "3 in deck". */
  countLabel: string;
  detail: string;
  status: GateStatus;
  /** Bracket this check forces when it trips (0 when it never forces one). */
  forcesBracket: number;
  cards: string[];
}

export interface Reason {
  key: string;
  mark: string;
  tone: 'good' | 'warn' | 'neutral';
  title: string;
  body: string;
}

export interface LadderEntry {
  n: number;
  name: string;
  desc: string;
  active: boolean;
}

export interface ReadingStep {
  n: number;
  title: string;
  body: string;
  chips: string[];
}

export interface NextMove {
  /** e.g. "Up to Bracket 2" */
  label: string;
  body: string;
  tone: 'up' | 'jump';
}

export interface BracketViewModel {
  bracket: number;
  /** Upper end of the estimate; equals `bracket` unless the reading is a range. */
  bracketMax: number;
  /** True when the deck can only honestly be narrowed to two brackets (1 or 2). */
  isRange: boolean;
  /** Compact form for big-number slots — "1" or "1–2". */
  bracketDisplay: string;
  /** Prose form — "Bracket 3" or "Bracket 1 or 2". */
  bracketLabel: string;
  label: string;
  description: string;
  /** Raw hex for the active bracket — SVG strokes, gradients. */
  accent: string;
  colors: (typeof BRACKET_COLORS)[number];
  /** Highest bracket forced by a hard-floor rule (1 when nothing forces one). */
  floor: number;
  softScore: number;
  /** The score the deck must reach for the next bump (66 or 80), or null at the ceiling. */
  bumpTarget: number | null;
  /** Points still needed to reach `bumpTarget` (0 when already there). */
  pointsToBump: number;
  wasElevated: boolean;
  /** Two-sentence plain-English verdict. */
  headline: string;
  confidence: 'high' | 'medium';
  confidenceNote: string;
  criteria: SoftCriterion[];
  gates: Gate[];
  reasons: Reason[];
  ladder: LadderEntry[];
  steps: ReadingStep[];
  nextMoves: NextMove[];
  /** Monospace arithmetic for the "show the math" disclosure. */
  mathLines: string[];
}

// ─── Copy tables ─────────────────────────────────────────────────────

const LADDER_DESCS: Record<number, string> = {
  1: 'Themes over winning',
  2: 'A precon out of the box',
  3: 'Tuned, a few heavy hitters',
  4: 'Strongest cards, no limits',
  5: 'Tournament play',
};

const HEADLINES: Record<number, string> = {
  1: 'A casual, theme-forward deck. It wins eventually, not quickly.',
  2: 'Precon-level power. It has a plan, but nothing that ends a game out of nowhere.',
  3: 'A tuned deck with real teeth. It can close a game faster than a precon table expects.',
  4: 'High power. Strong engines and fast answers — it plays to win, not to durdle.',
  5: 'Competitive. Built to win as early as it can.',
};

// ─── Helpers ─────────────────────────────────────────────────────────

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** Card names belonging to complete combos in a bracket band. */
function comboCards(combos: DetectedCombo[] | undefined, min: number, max: number): string[] {
  if (!combos) return [];
  const names = new Set<string>();
  for (const combo of combos) {
    if (!combo.isComplete) continue;
    const b = parseInt(combo.bracket, 10);
    if (isNaN(b) || b < min || b > max) continue;
    for (const card of combo.cards) names.add(card);
  }
  return [...names];
}

// ─── Builder ─────────────────────────────────────────────────────────

export function buildBracketViewModel(
  est: BracketEstimation,
  combos: DetectedCombo[] | undefined,
): BracketViewModel {
  const b = est.breakdown;
  const floor = est.hardFloors.length > 0 ? Math.max(...est.hardFloors.map(f => f.bracket)) : 1;
  const soft = est.softScore;

  // ── Soft-score categories ──
  // These mirror estimateBracket()'s arithmetic exactly; if the estimator's
  // weights change, change them here too.
  const criteria: SoftCriterion[] = [
    {
      key: 'fastMana',
      name: 'Fast Mana',
      score: Math.min(40, b.fastManaCount * 8),
      max: 40,
      plain: b.fastManaCount === 0
        ? 'No fast mana at all — nothing that jumps you ahead of the table.'
        : `${b.fastManaCount} ${plural(b.fastManaCount, 'source')} that make more mana than they cost.`,
      rule: 'Fast mana lets a deck act a turn or two ahead of everyone else. Each source is worth 8 points, capped at 40. Decks at Bracket 3 and up usually run five or more.',
      cards: b.fastManaNames,
    },
    {
      key: 'tutors',
      name: 'Tutors',
      score: Math.min(25, b.tutorCount * 5),
      max: 25,
      plain: b.tutorCount === 0
        ? 'No tutors — every game plays out from the top of your library.'
        : `${b.tutorCount} ${plural(b.tutorCount, 'tutor')} making your draws repeatable.`,
      rule: 'Tutors turn a 99-card deck into a much smaller one. Each is worth 5 points, capped at 25. Only cards whose main job is finding another card count: ramp like Cultivate does not, and neither do land tutors — Evolving Wilds and the fetches fix your mana rather than find your best card.',
      cards: b.tutorNames,
    },
    {
      key: 'cmc',
      name: 'Average cost',
      score: Math.round(Math.min(20, Math.max(0, (3.5 - b.averageCmc) * 15))),
      max: 20,
      plain: b.averageCmc < 3.5
        ? `Average cost ${b.averageCmc.toFixed(2)} — ${(3.5 - b.averageCmc).toFixed(2)} under the 3.5 line.`
        : `Average cost ${b.averageCmc.toFixed(2)} — above the 3.5 line, so no bonus here.`,
      rule: 'A low curve means you deploy earlier. Everything under 3.5 average mana value scores, at 15 points per point of mana saved, capped at 20.',
      cards: [],
    },
    {
      key: 'interaction',
      name: 'Interaction',
      score: Math.min(15, Math.max(0, (b.interactionCount - 8) * 2)),
      max: 15,
      plain: b.interactionCount > 8
        ? `${b.interactionCount} removal, wipes and counterspells — ${b.interactionCount - 8} above the baseline of 8.`
        : `${b.interactionCount} removal, wipes and counterspells — the bonus starts above 8.`,
      rule: 'Heavy interaction reads as a tuned deck: you can answer what other people are doing. Two points for every piece past a baseline of 8, capped at 15.',
      cards: [],
    },
  ].map(c => ({
    ...c,
    pct: c.max > 0 ? Math.round((c.score / c.max) * 100) : 0,
    shareOfTotal: c.score,
    color: SOFT_COLORS[c.key as SoftKey],
    maxed: c.score >= c.max,
  })) as SoftCriterion[];

  // ── Hard-floor gates ──
  const earlyCombos = b.earlyComboCount;
  const lateCombos = b.lateComboCount;
  const totalCombos = earlyCombos + lateCombos;

  const gates: Gate[] = [
    {
      key: 'gameChangers',
      name: 'Game Changers',
      countLabel: b.gameChangerCount === 0 ? 'none' : `${b.gameChangerCount} in deck`,
      status: b.gameChangerCount === 0 ? 'absent' : 'present',
      forcesBracket: b.gameChangerCount >= 4 ? 4 : b.gameChangerCount > 0 ? 3 : 0,
      detail: b.gameChangerCount === 0
        ? 'The cards on the official Game Changers list are the ones that reliably warp a game on resolution. A single one puts a deck at Bracket 3 minimum, and four puts it at 4. You run none.'
        : b.gameChangerCount >= 4
          ? `Four or more Game Changers is high-power territory — this alone sets the floor at Bracket 4.`
          : `${b.gameChangerCount} Game ${plural(b.gameChangerCount, 'Changer')} can take over a game alone. Any at all sets the floor at Bracket 3; most casual tables expect to see a few.`,
      cards: b.gameChangerNames,
    },
    {
      key: 'combos',
      name: 'Two-card infinite combos',
      countLabel: totalCombos === 0
        ? 'none found'
        : `${totalCombos} complete`,
      status: totalCombos === 0 ? 'absent' : 'present',
      forcesBracket: earlyCombos > 0 ? 4 : lateCombos > 0 ? 3 : 0,
      detail: totalCombos === 0
        ? 'A combo that needs setup is fine from Bracket 3 up; one that wins cheaply in the first few turns belongs in Bracket 4. We scanned every pair in the deck and found no complete loop.'
        : earlyCombos > 1
          ? `${earlyCombos} early-game ${plural(earlyCombos, 'combo')} — several ways to win before opponents set up. Bracket 3 permits none of these, so the floor is 4.`
          : earlyCombos === 1
            ? 'One combo that can win cheaply inside the first few turns. Bracket 3 permits none, so a single one puts the floor at 4.'
            : `${lateCombos} late-game ${plural(lateCombos, 'combo')}. Combos that need setup are expected from Bracket 3 up, but they rule out 1 and 2.`,
      cards: comboCards(combos, 3, 99),
    },
    {
      key: 'landDenial',
      name: 'Mass land denial',
      countLabel: b.massLandDenialCount === 0 ? 'none' : `${b.massLandDenialCount} found`,
      status: b.massLandDenialCount === 0 ? 'absent' : 'present',
      forcesBracket: b.massLandDenialCount > 0 ? 4 : 0,
      detail: b.massLandDenialCount === 0
        ? 'Armageddon-style effects are permitted from Bracket 4 up and banned below it. None here.'
        : 'Destroying or locking every land is one of the strongest effects in Commander. Brackets 1 through 3 rule it out, so the floor is 4.',
      cards: b.massLandDenialNames,
    },
    {
      key: 'extraTurns',
      name: 'Extra turns',
      countLabel: b.extraTurnCount === 0 ? 'none' : `${b.extraTurnCount} ${plural(b.extraTurnCount, 'spell')}`,
      status: b.extraTurnCount === 0 ? 'absent' : 'present',
      forcesBracket: b.extraTurnCount >= 3 ? 4 : b.extraTurnCount > 0 ? 2 : 0,
      detail: b.extraTurnCount === 0
        ? 'Bracket 1 is the only one that rules extra turns out entirely; every bracket above it allows them in small numbers. None here.'
        : b.extraTurnCount >= 3
          ? `${b.extraTurnCount} extra turn spells. Brackets 2 and 3 allow a couple, not a chain — three or more reads as a deck built to take them back to back, which puts the floor at 4.`
          : 'Bracket 1 rules extra turns out entirely, so any copy puts the floor at 2. Brackets 2 and 3 expect a couple, which this is.',
      cards: b.extraTurnNames,
    },
    {
      key: 'tutorDensity',
      name: 'Tutor density',
      countLabel: b.tutorCount === 0 ? 'none' : `${b.tutorCount} ${plural(b.tutorCount, 'tutor')}`,
      status: 'measured',
      forcesBracket: 0,
      detail: 'Worth knowing, not disqualifying — tutors never force a bracket on their own, and the October 2025 revision dropped the tutor limits from Brackets 1 through 3 entirely. They still feed the tuning score below, since a deck that finds its best card every game plays above where its card list suggests. Land tutors are left out: Evolving Wilds and the fetches fix mana rather than find answers.',
      cards: b.tutorNames,
    },
  ];

  // ── Bump maths ──
  const bumpTarget = est.bracket === 5 ? null : floor >= 4 ? 80 : 66;
  const pointsToBump = bumpTarget === null ? 0 : Math.max(0, bumpTarget - soft);
  const wasElevated = est.bracket > floor;

  // ── Headline ──
  const floorSentence = est.hardFloors.length === 0
    ? 'Nothing in the deck forces it higher — no Game Changers, no complete combo, no land denial, no extra turns.'
    : `${est.hardFloors
        .slice()
        .sort((x, y) => y.bracket - x.bracket)
        .map(f => f.reason.toLowerCase())
        .join(', ')} — that sets the floor at ${floor}.`;
  const isRange = est.bracketMax > est.bracket;
  const rangeSentence = isRange
    ? ' Brackets 1 and 2 permit the same cards — the difference is whether winning is the goal, which a card list can\'t show, so this could honestly sit in either.'
    : '';
  const headline = `${HEADLINES[est.bracket]} ${floorSentence}${rangeSentence}`;

  // ── Confidence ──
  const unratedCombos = (combos ?? []).filter(
    c => c.isComplete && isNaN(parseInt(c.bracket, 10)),
  ).length;
  const confidence: 'high' | 'medium' = unratedCombos > 0 ? 'medium' : 'high';
  const confidenceNote = unratedCombos > 0
    ? `${unratedCombos} complete ${plural(unratedCombos, 'combo')} ${unratedCombos === 1 ? 'has' : 'have'} no community bracket rating, so the floor may be understated`
    : 'Every signal we check returned a clear answer';

  // ── Reasons (1a) ──
  const sortedByScore = criteria.slice().sort((x, y) => y.pct - x.pct);
  const strongest = sortedByScore[0];
  const weakest = sortedByScore[sortedByScore.length - 1];
  const topFloor = est.hardFloors.slice().sort((x, y) => y.bracket - x.bracket)[0];

  const reasons: Reason[] = [
    est.hardFloors.length === 0
      ? {
          key: 'floor',
          mark: '✓',
          tone: 'good',
          title: 'No card here forces a higher bracket',
          body: 'Zero Game Changers, no complete two-card combo, no mass land denial, no extra turns. That keeps the floor at 1.',
        }
      : {
          key: 'floor',
          mark: '!',
          tone: 'warn',
          title: topFloor.reason,
          body: `${topFloor.detail ?? ''} Floor ${topFloor.bracket}.`.trim(),
        },
    {
      key: 'strongest',
      mark: strongest.maxed ? '▲' : '·',
      tone: 'neutral',
      title: strongest.pct >= 50
        ? `${strongest.name} is doing most of the work`
        : 'Nothing here is scoring highly',
      body: strongest.plain,
    },
    {
      key: 'weakest',
      mark: '·',
      tone: 'neutral',
      title: weakest.pct <= 25 ? `${weakest.name} is what holds it back` : `${weakest.name} is the softest signal`,
      body: weakest.plain,
    },
  ];
  if (wasElevated) {
    reasons.push({
      key: 'elevated',
      mark: '↑',
      tone: 'warn',
      title: `Tuned enough to move up from ${floor}`,
      body: `A soft score of ${soft} clears the ${floor >= 4 ? 80 : 66}-point line, so the estimate moves up to ${est.bracket}.`,
    });
  }

  // ── Ladder ──
  const ladder: LadderEntry[] = [1, 2, 3, 4, 5].map(n => ({
    n,
    name: BRACKET_LABELS[n],
    desc: LADDER_DESCS[n],
    active: n >= est.bracket && n <= est.bracketMax,
  }));

  // ── Reading steps (1c) ──
  const chipCards = [
    ...b.gameChangerNames.slice(0, 2),
    ...b.fastManaNames.slice(0, 2),
    ...b.tutorNames.slice(0, 2),
  ].slice(0, 4);

  const steps: ReadingStep[] = [
    {
      n: 1,
      title: 'Checked for cards that force a bracket',
      body: est.hardFloors.length === 0
        ? 'Five hard checks — Game Changers, complete combos, mass land denial, extra turns, tutor density. All clear, so the floor stays at Bracket 1.'
        : `Five hard checks — Game Changers, complete combos, mass land denial, extra turns, tutor density. ${est.hardFloors.length} ${plural(est.hardFloors.length, 'rule')} tripped, and the highest one sets the floor at Bracket ${floor}.`,
      chips: [],
    },
    {
      n: 2,
      title: 'Scored how tuned the deck is',
      body: `${soft} of 100. ${strongest.plain} ${weakest.plain}`,
      chips: chipCards,
    },
    {
      n: 3,
      title: 'Applied the bump rule',
      body: wasElevated
        ? `A deck scoring ${floor >= 4 ? 80 : 66} or more moves up. At ${soft} it clears the line, so the floor of ${floor} becomes Bracket ${est.bracket}.`
        : bumpTarget === null
          ? `Already at the top of the scale — Bracket ${est.bracket}, ${est.label}.`
          : `A deck scoring ${bumpTarget} or more moves up one bracket. At ${soft} it stays put. Final estimate: Bracket ${est.bracket}, ${est.label}.`,
      chips: [],
    },
  ];

  // ── What would move it (1c right rail) ──
  const nextMoves: NextMove[] = [];
  if (bumpTarget !== null && pointsToBump > 0) {
    nextMoves.push({
      label: floor >= 4 ? 'Up to Bracket 5' : `Up to Bracket ${Math.min(floor + 1, 4)}`,
      tone: 'up',
      body: `Add ~${pointsToBump} points of speed: more fast mana, more tutors, or pull the curve further under 3.5.`,
    });
  }
  if (est.bracket < 3) {
    nextMoves.push({
      label: 'Straight to Bracket 3+',
      tone: 'jump',
      body: 'Any Game Changer, a complete two-card combo, mass land denial, or a stack of extra turns. These skip the score entirely.',
    });
  } else if (est.bracket < 4) {
    nextMoves.push({
      label: 'Straight to Bracket 4',
      tone: 'jump',
      body: 'Four or more Game Changers, two early-game combos, or any mass land denial. These skip the score entirely.',
    });
  }

  // ── Math disclosure ──
  const mathLines = [
    `floor = ${floor} (${est.hardFloors.length === 0 ? 'no forcing cards' : `${est.hardFloors.length} ${plural(est.hardFloors.length, 'rule')} tripped`})`,
    `soft = ${criteria.map(c => c.score).join(' + ')} = ${soft}`,
    bumpTarget === null
      ? 'already at bracket 5'
      : `${soft} ${soft >= bumpTarget ? '≥' : '<'} ${bumpTarget} → ${wasElevated ? 'bump' : 'no bump'}`,
    `final = bracket ${isRange ? `${est.bracket} or ${est.bracketMax}` : est.bracket}`,
  ];

  return {
    bracket: est.bracket,
    bracketMax: est.bracketMax,
    isRange,
    bracketDisplay: isRange ? `${est.bracket}–${est.bracketMax}` : String(est.bracket),
    bracketLabel: isRange ? `Bracket ${est.bracket} or ${est.bracketMax}` : `Bracket ${est.bracket}`,
    label: isRange ? `${BRACKET_LABELS[est.bracket]} or ${BRACKET_LABELS[est.bracketMax]}` : est.label,
    description: BRACKET_DESCRIPTIONS[est.bracket],
    accent: BRACKET_HEX[est.bracket],
    colors: BRACKET_COLORS[est.bracket],
    floor,
    softScore: soft,
    bumpTarget,
    pointsToBump,
    wasElevated,
    headline,
    confidence,
    confidenceNote,
    criteria,
    gates,
    reasons,
    ladder,
    steps,
    nextMoves,
    mathLines,
  };
}
