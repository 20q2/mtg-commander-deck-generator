import type { DetectedCombo } from '@/types';
import { hasTag, isMassLandDenial, isExtraTurn, getCardRole } from '@/services/tagger/client';

// ── Types ──────────────────────────────────────────────────────────────────

export interface BracketEstimation {
  bracket: 1 | 2 | 3 | 4 | 5;
  /**
   * Upper end of the estimate. Equals `bracket` whenever we can name a single
   * bracket; only differs at the bottom of the scale, where 1 and 2 are not
   * separable from a card list. See the note where it's assigned.
   */
  bracketMax: 1 | 2 | 3 | 4 | 5;
  label: string;
  hardFloors: BracketFloor[];
  softScore: number;
  breakdown: BracketBreakdown;
}

export interface BracketFloor {
  bracket: number;
  reason: string;
  detail?: string;
}

export interface BracketBreakdown {
  gameChangerCount: number;
  gameChangerNames: string[];
  massLandDenialCount: number;
  massLandDenialNames: string[];
  extraTurnCount: number;
  extraTurnNames: string[];
  earlyComboCount: number;
  lateComboCount: number;
  fastManaCount: number;
  fastManaNames: string[];
  tutorCount: number;
  tutorNames: string[];
  averageCmc: number;
  interactionCount: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const BRACKET_LABELS: Record<number, string> = {
  1: 'Exhibition',
  2: 'Core',
  3: 'Upgraded',
  4: 'Optimized',
  5: 'cEDH',
};

/** Fast mana sources — small, stable list that rarely changes. */
const FAST_MANA = new Set([
  'Sol Ring',
  'Mana Crypt',
  'Mana Vault',
  'Grim Monolith',
  'Chrome Mox',
  'Mox Diamond',
  "Lion's Eye Diamond",
  'Lotus Petal',
  'Mox Opal',
  'Mox Amber',
  'Dark Ritual',
  'Cabal Ritual',
  'Simian Spirit Guide',
  'Elvish Spirit Guide',
  'Rite of Flame',
  'Ancient Tomb',
  'Jeweled Lotus',
]);

/**
 * How many extra-turn cards stop reading as "low quantities" and start reading
 * as a plan to chain them. The official wording turns on intent, which a card
 * list can't express — count is the closest honest proxy.
 */
const CHAINED_EXTRA_TURNS = 3;

// ── Bracket fit ────────────────────────────────────────────────────────────

/**
 * Whether a combo's EDHREC bracket vote ("1"–"5", or "unknown" when unrated)
 * is acceptable at the user's selected generation bracket. Unrated combos are
 * only trusted at bracket 4+ — seeding an unknown infinite into a B3-or-lower
 * deck risks the exact over-bracket decks the setting exists to prevent.
 */
export function comboFitsBracket(comboBracket: string, bracketLevel: number | undefined): boolean {
  if (!bracketLevel) return true;
  const rated = parseInt(comboBracket, 10);
  if (isNaN(rated)) return bracketLevel >= 4;
  return rated <= bracketLevel;
}

// ── Estimation ─────────────────────────────────────────────────────────────

export function estimateBracket(
  allCardNames: string[],
  /** Lands in the deck. Excluded from the tutor count — see the loop below. */
  landNames: Set<string>,
  detectedCombos: DetectedCombo[] | undefined,
  averageCmc: number,
  _deckScore: number | undefined,
  roleCounts: Record<string, number> | undefined,
  gameChangerNames: Set<string>,
): BracketEstimation {
  // ── 1. Count signals ──

  const gameChangers: string[] = [];
  const massLandDenial: string[] = [];
  const extraTurns: string[] = [];
  const fastMana: string[] = [];
  const tutors: string[] = [];

  for (const name of allCardNames) {
    if (gameChangerNames.has(name)) gameChangers.push(name);
    if (isMassLandDenial(name)) massLandDenial.push(name);
    if (isExtraTurn(name)) extraTurns.push(name);
    if (FAST_MANA.has(name)) fastMana.push(name);
    // Only count as tutor if primary role is cardDraw — cards like Cultivate
    // have the tutor tag but their primary role is ramp, not tutoring.
    //
    // Lands are excluded outright. Scryfall tags Evolving Wilds, the fetch
    // lands and Ash Barrens as tutors, but a land that finds a land is mana
    // fixing, not tutoring — it doesn't make the deck more consistent at
    // finding its best card, which is the thing this measure is for. Letting
    // them through meant a fixing-heavy manabase alone could max the category
    // and push a casual deck up a bracket. The rest of the enricher already
    // holds lands out of roleCounts and the curve average; this matches.
    if (!landNames.has(name) && hasTag(name, 'tutor') && getCardRole(name) === 'cardDraw') {
      tutors.push(name);
    }
  }

  // ── 2. Classify combos ──

  let earlyComboCount = 0;
  let lateComboCount = 0;

  if (detectedCombos) {
    for (const combo of detectedCombos) {
      if (!combo.isComplete) continue;
      const bracketNum = parseInt(combo.bracket, 10);
      if (isNaN(bracketNum)) continue;
      if (bracketNum >= 4) earlyComboCount++;
      else if (bracketNum === 3) lateComboCount++;
    }
  }

  // ── 3. Interaction count (removal + boardwipe + protection) ──
  // Protection now holds counterspells (previously counted as removal), which are core interaction —
  // a counterspell answers a threat as surely as a removal spell. Include the protection role so
  // counterspell-heavy control decks aren't under-counted on interaction.

  const interactionCount = roleCounts
    ? (roleCounts['removal'] ?? 0) + (roleCounts['boardwipe'] ?? 0) + (roleCounts['protection'] ?? 0)
    : 0;

  // ── 4. Hard floor rules ──

  const hardFloors: BracketFloor[] = [];

  if (gameChangers.length >= 4) {
    hardFloors.push({ bracket: 4, reason: `${gameChangers.length} Game Changer cards`, detail: 'Cards that warp the game on resolution — having 4+ pushes into high-power territory.' });
  } else if (gameChangers.length > 0) {
    hardFloors.push({ bracket: 3, reason: `${gameChangers.length} Game Changer card${gameChangers.length > 1 ? 's' : ''}`, detail: gameChangers.length > 1 ? 'These cards can take over a game on their own. Most casual tables expect to see a few.' : 'This card can take over a game on its own. Most casual tables expect to see a few.' });
  }

  if (massLandDenial.length > 0) {
    hardFloors.push({ bracket: 4, reason: `Mass land denial (${massLandDenial.join(', ')})`, detail: 'Destroying or locking all lands prevents opponents from playing the game — one of the strongest effects in Commander.' });
  }

  // Bracket 3 permits no two-card infinite that can go off cheaply inside the
  // first six or so turns, so a single early combo is disqualifying — the floor
  // is 4 whether there is one or several.
  if (earlyComboCount > 0) {
    hardFloors.push({
      bracket: 4,
      reason: `${earlyComboCount} early-game infinite combo${earlyComboCount > 1 ? 's' : ''}`,
      detail: earlyComboCount > 1
        ? 'Several ways to win out of nowhere before opponents can set up. This is competitive-level power.'
        : 'Bracket 3 allows no combo that wins cheaply in the first few turns, so one is enough to set the floor here.',
    });
  }

  if (lateComboCount > 0) {
    hardFloors.push({ bracket: 3, reason: `${lateComboCount} late-game combo${lateComboCount > 1 ? 's' : ''}`, detail: 'Infinite combos that need setup are generally accepted, but they still bump the power level.' });
  }

  // Bracket 1 rules extra turns out entirely; 2 and 3 allow them "in low
  // quantities and not intended to be chained". Intent isn't readable from a
  // card list, but quantity is: a deck running three or more has stopped
  // splashing one and started building around them.
  if (extraTurns.length >= CHAINED_EXTRA_TURNS) {
    hardFloors.push({
      bracket: 4,
      reason: `${extraTurns.length} extra turn spells`,
      detail: 'Brackets 2 and 3 allow a couple of extra turns, not a chain of them. Three or more reads as a deck built to take them back to back.',
    });
  } else if (extraTurns.length > 0) {
    hardFloors.push({
      bracket: 2,
      reason: `${extraTurns.length} extra turn spell${extraTurns.length > 1 ? 's' : ''}`,
      detail: 'Bracket 1 is the only bracket that rules extra turns out entirely, so any copy puts the floor at 2.',
    });
  }

  const floor = hardFloors.length > 0
    ? Math.max(...hardFloors.map(f => f.bracket))
    : 1;

  // ── 5. Soft score (0-100) ──

  // Rounded once, here, so the number we compare against the bump thresholds is
  // the same number the UI shows. Rounding only on the way out let a raw 65.6
  // display as "66 / 100" beside copy promising a bump at 66, and not bump.
  const softScore = Math.round(Math.min(100,
    Math.min(40, fastMana.length * 8) +
    Math.min(25, tutors.length * 5) +
    Math.min(20, Math.max(0, (3.5 - averageCmc) * 15)) +
    Math.min(15, Math.max(0, (interactionCount - 8) * 2))
  ));

  // ── 6. Final bracket ──

  let bracket: number = floor;

  if (floor >= 4 && softScore >= 80) {
    bracket = 5;
  } else if (floor < 4 && softScore >= 66) {
    bracket = Math.min(floor + 1, 4);
  }

  const clampedBracket = Math.max(1, Math.min(5, bracket)) as 1 | 2 | 3 | 4 | 5;

  // Brackets 1 and 2 carry identical restrictions except that B1 rules out
  // extra turns entirely — and we already floor at 2 the moment one appears.
  // Past that the difference is *intent*: whether winning is the goal. A card
  // list cannot show that. Calibration against builder-declared decks put the
  // mean soft score at 36 for declared-B1 and 37 for declared-B2, and the
  // estimator called all 20 of them Bracket 1. So a deck that trips nothing is
  // reported honestly as "1 or 2" rather than asserted as 1.
  const bracketMax: 1 | 2 | 3 | 4 | 5 = clampedBracket === 1 ? 2 : clampedBracket;

  return {
    bracket: clampedBracket,
    bracketMax,
    label: BRACKET_LABELS[clampedBracket],
    hardFloors,
    softScore,
    breakdown: {
      gameChangerCount: gameChangers.length,
      gameChangerNames: gameChangers,
      massLandDenialCount: massLandDenial.length,
      massLandDenialNames: massLandDenial,
      extraTurnCount: extraTurns.length,
      extraTurnNames: extraTurns,
      earlyComboCount,
      lateComboCount,
      fastManaCount: fastMana.length,
      fastManaNames: fastMana,
      tutorCount: tutors.length,
      tutorNames: tutors,
      averageCmc,
      interactionCount,
    },
  };
}
