// src/services/deckBuilder/overBracket.ts
//
// What has to leave a deck for it to play at a lower bracket than it does — the one answer the
// Bracket tab's gap panel and Card Fit's "Above your bracket" cuts both read, so the two can never
// name different cards. Mirrors estimateBracket's rules; if those change, change these.
import type { DetectedCombo } from '@/types';
import type { BracketEstimation } from './bracketEstimator';

export type OverBracketKey = 'gameChangers' | 'combos' | 'landDenial' | 'extraTurns' | 'fastMana' | 'tutors';

export interface OverBracketGroup {
  key: OverBracketKey;
  /** "Game Changers". */
  name: string;
  /** What the aim allows and so what has to go — "Bracket 3 allows three — cut 2 of 5". */
  note: string;
  /** Per-card reason, shown beside each cut — "Game Changer — Bracket 2 allows none". */
  reason: string;
  /** Every card of this kind in the deck. */
  cards: string[];
  /** How many of `cards` must go. Ignored when `sets` is given. */
  cut: number;
  /** Combos: each inner list is one combo, broken by cutting any one piece. */
  sets?: string[][];
}

const NUMBER_WORDS = ['none', 'one', 'two', 'three'];
const GC_ALLOWED_AT_3 = 3;
const EXTRA_TURNS_ALLOWED = 2;
/** estimateBracket's soft-score bump line below a floor of 4. */
const SOFT_BUMP = 66;

/**
 * The groups holding the deck above `aim`, with how much of each must go. Empty when the deck
 * already plays at or below it, and for aims of 4 and up — 4 and 5 differ by intent, not cards.
 */
export function overBracketGroups(
  est: BracketEstimation,
  combos: DetectedCombo[] | undefined,
  aim: number,
): OverBracketGroup[] {
  if (aim >= 4 || aim >= est.bracket) return [];
  const b = est.breakdown;
  const groups: OverBracketGroup[] = [];

  // ── Hard floors ──
  const gcAllowed = aim >= 3 ? GC_ALLOWED_AT_3 : 0;
  if (b.gameChangerNames.length > gcAllowed) {
    const n = b.gameChangerNames.length;
    groups.push({
      key: 'gameChangers',
      name: 'Game Changers',
      note: gcAllowed === 0
        ? `Bracket ${aim} allows none — cut all ${n}`
        : `Bracket ${aim} allows ${NUMBER_WORDS[gcAllowed]} — cut ${n - gcAllowed} of ${n}`,
      reason: gcAllowed === 0 ? `Game Changer — Bracket ${aim} allows none` : `Game Changer — Bracket ${aim} allows three`,
      cards: b.gameChangerNames,
      cut: n - gcAllowed,
    });
  }

  // Rated combos only, as the estimator counts them: 4+ is an early win (none allowed at 3),
  // 3 needs setup (fine at 3, not below).
  const comboSets = (combos ?? [])
    .filter(c => c.isComplete)
    .filter(c => {
      const rated = parseInt(c.bracket, 10);
      return !isNaN(rated) && rated >= 3 && (aim <= 2 || rated >= 4);
    })
    .map(c => c.cards);
  if (comboSets.length > 0) {
    groups.push({
      key: 'combos',
      name: 'Two-card infinite combos',
      note: aim >= 3
        ? `Bracket 3 allows combos that need setup, not early wins — cut a piece of each (${comboSets.length})`
        : `Bracket ${aim} allows none — cut a piece of each (${comboSets.length})`,
      reason: aim >= 3 ? 'Early-win combo piece — not in Bracket 3' : `Combo piece — Bracket ${aim} allows no infinite combos`,
      cards: [...new Set(comboSets.flat())],
      cut: comboSets.length,
      sets: comboSets,
    });
  }

  if (b.massLandDenialNames.length > 0) {
    groups.push({
      key: 'landDenial',
      name: 'Mass land denial',
      note: `Not allowed below Bracket 4 — cut all ${b.massLandDenialNames.length}`,
      reason: 'Mass land denial — not allowed below Bracket 4',
      cards: b.massLandDenialNames,
      cut: b.massLandDenialNames.length,
    });
  }

  const etAllowed = aim >= 2 ? EXTRA_TURNS_ALLOWED : 0;
  if (b.extraTurnNames.length > etAllowed) {
    const n = b.extraTurnNames.length;
    groups.push({
      key: 'extraTurns',
      name: 'Extra turns',
      note: etAllowed === 0
        ? `Bracket 1 allows none — cut all ${n}`
        : `Bracket ${aim} allows a couple, not a chain — cut ${n - etAllowed} of ${n}`,
      reason: etAllowed === 0 ? 'Extra turn — Bracket 1 allows none' : `Extra turn — Bracket ${aim} allows a couple`,
      cards: b.extraTurnNames,
      cut: n - etAllowed,
    });
  }

  // ── Power score: with the floors handled, the soft score can still bump the deck a bracket up. ──
  // The floor left behind is what the aim allows of each element, so a bump only matters when it
  // would land above the aim.
  const floorAfter = Math.max(
    1,
    gcAllowed > 0 && b.gameChangerNames.length > 0 ? 3 : 1,
    aim >= 3 && b.lateComboCount > 0 ? 3 : 1,
    etAllowed > 0 && b.extraTurnNames.length > 0 ? 2 : 1,
  );
  if (Math.min(floorAfter + 1, 4) > aim) {
    const fixed =
      Math.min(20, Math.max(0, (3.5 - b.averageCmc) * 15)) +
      Math.min(15, Math.max(0, (b.interactionCount - 8) * 2));
    const fastPts = (n: number) => Math.min(40, n * 8);
    const tutorPts = (n: number) => Math.min(25, n * 5);
    let fast = b.fastManaNames.length;
    let tutors = b.tutorNames.length;
    const soft = () => Math.round(fixed + fastPts(fast) + tutorPts(tutors));
    // Fast mana first: more points per card, and it's the faster-games lever the brackets are about.
    while (soft() >= SOFT_BUMP && fast > 0) fast--;
    while (soft() >= SOFT_BUMP && tutors > 0) tutors--;
    const fastCut = b.fastManaNames.length - fast;
    const tutorCut = b.tutorNames.length - tutors;
    if (fastCut > 0) {
      groups.push({
        key: 'fastMana',
        name: 'Fast mana',
        note: `Its power score alone puts it a bracket up — cut ${fastCut} of ${b.fastManaNames.length}`,
        reason: `Fast mana — its power score puts it past Bracket ${aim}`,
        cards: b.fastManaNames,
        cut: fastCut,
      });
    }
    if (tutorCut > 0) {
      groups.push({
        key: 'tutors',
        name: 'Tutors',
        note: `Its power score alone puts it a bracket up — cut ${tutorCut} of ${b.tutorNames.length}`,
        reason: `Tutor — its power score puts it past Bracket ${aim}`,
        cards: b.tutorNames,
        cut: tutorCut,
      });
    }
  }

  return groups;
}

/**
 * Pick the cards that go: for each group, its `cut` weakest by `keepScore` among the cards the
 * player hasn't locked; for combos, the weakest piece of each combo not already broken. A card
 * picked for one group counts toward every group it belongs to — a Chrome Mox cut as a Game
 * Changer is also one fewer fast mana. Returns card → the group it was cut for.
 */
export function pickOverBracketCuts(
  groups: OverBracketGroup[],
  eligible: (name: string) => boolean,
  keepScore: (name: string) => number,
): Map<string, OverBracketGroup> {
  const picked = new Map<string, OverBracketGroup>();
  const weakestFirst = (names: string[]) => names.filter(eligible).sort((a, b) => keepScore(a) - keepScore(b));
  for (const g of groups) {
    if (g.sets) {
      for (const set of g.sets) {
        if (set.some(n => picked.has(n))) continue;
        const pick = weakestFirst(set)[0];
        if (pick) picked.set(pick, g);
      }
      continue;
    }
    const need = g.cut - g.cards.filter(n => picked.has(n)).length;
    for (const name of weakestFirst(g.cards.filter(n => !picked.has(n))).slice(0, Math.max(0, need))) {
      picked.set(name, g);
    }
  }
  return picked;
}
