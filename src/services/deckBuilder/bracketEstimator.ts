import type { DetectedCombo } from '@/types';
import { hasTag, isMassLandDenial, isExtraTurn, getCardRole } from '@/services/tagger/client';

// ── Types ──────────────────────────────────────────────────────────────────

export interface BracketEstimation {
  bracket: 1 | 2 | 3 | 4 | 5;
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

// ── Estimation ─────────────────────────────────────────────────────────────

export function estimateBracket(
  allCardNames: string[],
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
    if (hasTag(name, 'tutor') && getCardRole(name) === 'cardDraw') tutors.push(name);
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

  // ── 3. Interaction count (removal + counterspell + boardwipe) ──

  const interactionCount = roleCounts
    ? (roleCounts['removal'] ?? 0) + (roleCounts['boardwipe'] ?? 0)
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

  if (earlyComboCount >= 2) {
    hardFloors.push({ bracket: 4, reason: `${earlyComboCount} early-game infinite combos`, detail: 'Multiple ways to win out of nowhere before opponents can set up. This is competitive-level power.' });
  } else if (earlyComboCount === 1) {
    hardFloors.push({ bracket: 3, reason: '1 early-game infinite combo', detail: 'An infinite combo that can fire early means games can end before everyone gets to play.' });
  }

  if (lateComboCount > 0) {
    hardFloors.push({ bracket: 3, reason: `${lateComboCount} late-game combo${lateComboCount > 1 ? 's' : ''}`, detail: 'Infinite combos that need setup are generally accepted, but they still bump the power level.' });
  }

  if (extraTurns.length > 0) {
    hardFloors.push({ bracket: 2, reason: `${extraTurns.length} extra turn spell${extraTurns.length > 1 ? 's' : ''}`, detail: 'Extra turns are powerful but slow the game down — most groups consider them a step above casual.' });
  }

  const floor = hardFloors.length > 0
    ? Math.max(...hardFloors.map(f => f.bracket))
    : 1;

  // ── 5. Soft score (0-100) ──

  const softScore = Math.min(100,
    Math.min(40, fastMana.length * 8) +
    Math.min(25, tutors.length * 5) +
    Math.min(20, Math.max(0, (3.5 - averageCmc) * 15)) +
    Math.min(15, Math.max(0, (interactionCount - 8) * 2))
  );

  // ── 6. Final bracket ──

  let bracket: number = floor;

  if (floor >= 4 && softScore >= 70) {
    bracket = 5;
  } else if (floor < 4 && softScore >= 50) {
    bracket = Math.min(floor + 1, 4);
  }

  const clampedBracket = Math.max(1, Math.min(5, bracket)) as 1 | 2 | 3 | 4 | 5;

  return {
    bracket: clampedBracket,
    label: BRACKET_LABELS[clampedBracket],
    hardFloors,
    softScore: Math.round(softScore),
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
