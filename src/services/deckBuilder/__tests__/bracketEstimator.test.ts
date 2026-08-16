import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DetectedCombo } from '@/types';

/**
 * Conformance tests for the bracket estimator.
 *
 * Each case here encodes a rule from WotC's published Commander bracket
 * criteria (Feb 2025, revised Oct 2025 / Feb 2026), so a failure means the
 * estimator has drifted from the official system rather than from our taste.
 *
 * The last block documents the places where we KNOWINGLY differ. Those use
 * `it.fails`, so the suite stays green while the divergence is deliberate —
 * and goes red the moment someone fixes the estimator without updating it.
 */

// ── Tagger stub ────────────────────────────────────────────────────────────
// The estimator reads every card property through the tagger client, which is
// populated from S3 in production. This stands in for that data so each test
// can state exactly what its cards are.

const tagger = vi.hoisted(() => ({
  massLandDenial: new Set<string>(),
  extraTurn: new Set<string>(),
  tutor: new Set<string>(),
  roles: new Map<string, string>(),
}));

vi.mock('@/services/tagger/client', () => ({
  isMassLandDenial: (name: string) => tagger.massLandDenial.has(name),
  isExtraTurn: (name: string) => tagger.extraTurn.has(name),
  hasTag: (name: string, tag: string) => tag === 'tutor' && tagger.tutor.has(name),
  getCardRole: (name: string) => tagger.roles.get(name) ?? null,
}));

import { estimateBracket } from '../bracketEstimator';

// ── Deck fixtures ──────────────────────────────────────────────────────────

/** Real names, because the estimator matches fast mana against a literal set. */
const FAST_MANA_POOL = [
  'Sol Ring', 'Mana Crypt', 'Mana Vault', 'Grim Monolith',
  'Chrome Mox', 'Mox Diamond', 'Lotus Petal',
];

interface DeckSpec {
  gameChangers?: number;
  massLandDenial?: number;
  extraTurns?: number;
  fastMana?: number;
  tutors?: number;
  /** Tutor-tagged cards that are lands — fetches, Evolving Wilds and friends. */
  landTutors?: number;
  /** EDHREC combo ratings for COMPLETE combos, e.g. ['4', '3', 'unknown']. */
  combos?: string[];
  /** Ratings for combos still missing pieces — these should never count. */
  partialCombos?: string[];
  averageCmc?: number;
  interaction?: number;
}

function estimate(spec: DeckSpec = {}) {
  const {
    gameChangers = 0, massLandDenial = 0, extraTurns = 0,
    fastMana = 0, tutors = 0, landTutors = 0, combos = [], partialCombos = [],
    averageCmc = 3.5, interaction = 0,
  } = spec;

  const gcNames = names('Game Changer', gameChangers);
  const mldNames = names('Armageddon', massLandDenial);
  const turnNames = names('Time Warp', extraTurns);
  const tutorNames = names('Demonic Tutor', tutors);
  const landTutorNames = names('Evolving Wilds', landTutors);
  const manaNames = FAST_MANA_POOL.slice(0, fastMana);

  mldNames.forEach(n => tagger.massLandDenial.add(n));
  turnNames.forEach(n => tagger.extraTurn.add(n));
  // Scryfall tags fetch lands as tutors too, so these look identical to the
  // tagger — only the land set tells them apart.
  [...tutorNames, ...landTutorNames].forEach(n => {
    tagger.tutor.add(n);
    tagger.roles.set(n, 'cardDraw'); // only cardDraw-role tutors are counted
  });

  const detected: DetectedCombo[] = [
    ...combos.map((b, i) => makeCombo(`complete-${i}`, b, true)),
    ...partialCombos.map((b, i) => makeCombo(`partial-${i}`, b, false)),
  ];

  return estimateBracket(
    [...gcNames, ...mldNames, ...turnNames, ...tutorNames, ...landTutorNames, ...manaNames],
    new Set(landTutorNames),
    detected,
    averageCmc,
    undefined,
    { removal: interaction },
    new Set(gcNames),
  );
}

const names = (stem: string, n: number) => Array.from({ length: n }, (_, i) => `${stem} ${i + 1}`);

function makeCombo(id: string, bracket: string, isComplete: boolean): DetectedCombo {
  return {
    comboId: id,
    cards: [`${id}-a`, `${id}-b`],
    results: ['Infinite mana'],
    isComplete,
    missingCards: isComplete ? [] : [`${id}-b`],
    deckCount: 100,
    bracket,
    source: 'commander',
  };
}

beforeEach(() => {
  tagger.massLandDenial.clear();
  tagger.extraTurn.clear();
  tagger.tutor.clear();
  tagger.roles.clear();
});

// ── Hard floors ────────────────────────────────────────────────────────────

describe('hard floors — cards that force a minimum bracket', () => {
  it('a deck with none of the restricted elements sits at the bottom', () => {
    expect(estimate().bracket).toBe(1);
    expect(estimate().hardFloors).toEqual([]);
  });

  describe('the 1-or-2 range', () => {
    it('reports a range when nothing at all triggers, since B1 and B2 are intent', () => {
      const est = estimate();
      expect(est.bracket).toBe(1);
      expect(est.bracketMax).toBe(2);
    });

    it('collapses to a single Bracket 2 once an extra turn rules out B1', () => {
      const est = estimate({ extraTurns: 1 });
      expect(est.bracket).toBe(2);
      expect(est.bracketMax).toBe(2);
    });

    it('never ranges above the bottom of the scale', () => {
      for (const spec of [{ gameChangers: 1 }, { gameChangers: 4 }, { massLandDenial: 1 }]) {
        const est = estimate(spec);
        expect(est.bracketMax).toBe(est.bracket);
      }
    });

    it('collapses when tuning alone bumps a floor-1 deck to Bracket 2', () => {
      const est = estimate({ fastMana: 5, tutors: 5, interaction: 9 });
      expect(est.bracket).toBe(2);
      expect(est.bracketMax).toBe(2);
    });
  });

  describe('Game Changers', () => {
    it('one to three allow Bracket 3, which is the official ceiling for them', () => {
      expect(estimate({ gameChangers: 1 }).bracket).toBe(3);
      expect(estimate({ gameChangers: 3 }).bracket).toBe(3);
    });

    it('four or more push to Bracket 4, since B3 permits at most three', () => {
      expect(estimate({ gameChangers: 4 }).bracket).toBe(4);
      expect(estimate({ gameChangers: 12 }).bracket).toBe(4);
    });

    it('reports which cards triggered it', () => {
      const est = estimate({ gameChangers: 2 });
      expect(est.breakdown.gameChangerCount).toBe(2);
      expect(est.breakdown.gameChangerNames).toHaveLength(2);
    });
  });

  describe('mass land denial', () => {
    it('is banned below Bracket 4, so a single piece forces 4', () => {
      expect(estimate({ massLandDenial: 1 }).bracket).toBe(4);
    });
  });

  describe('extra turns', () => {
    it('any copy rules out Bracket 1, which bans them outright', () => {
      expect(estimate({ extraTurns: 1 }).bracket).toBe(2);
    });

    it('a couple stays within the "low quantities" B2/B3 allowance', () => {
      expect(estimate({ extraTurns: 2 }).bracket).toBe(2);
    });

    it('three or more reads as chaining, which belongs in Bracket 4', () => {
      expect(estimate({ extraTurns: 3 }).bracket).toBe(4);
      expect(estimate({ extraTurns: 6 }).bracket).toBe(4);
    });
  });

  describe('two-card infinite combos', () => {
    it('a late combo is allowed at Bracket 3 but not below', () => {
      expect(estimate({ combos: ['3'] }).bracket).toBe(3);
    });

    it('a single early combo forces Bracket 4, since B3 permits none', () => {
      expect(estimate({ combos: ['4'] }).bracket).toBe(4);
      expect(estimate({ combos: ['5'] }).bracket).toBe(4);
    });

    it('two or more early combos force Bracket 4', () => {
      expect(estimate({ combos: ['4', '4'] }).bracket).toBe(4);
      expect(estimate({ combos: ['5', '4'] }).bracket).toBe(4);
    });

    it('ignores combos that are still missing pieces', () => {
      expect(estimate({ partialCombos: ['4', '4', '5'] }).bracket).toBe(1);
      expect(estimate({ partialCombos: ['4'] }).hardFloors).toEqual([]);
    });

    it('ignores combos EDHREC has not rated, and flags nothing about them', () => {
      // Worth knowing: an unrated combo could be an early one. The estimator
      // silently drops it, which is why the UI reports medium confidence when
      // a deck contains one.
      expect(estimate({ combos: ['unknown'] }).bracket).toBe(1);
      expect(estimate({ combos: ['unknown'] }).breakdown.earlyComboCount).toBe(0);
      expect(estimate({ combos: ['unknown'] }).breakdown.lateComboCount).toBe(0);
    });
  });

  it('takes the highest floor when several rules trip at once', () => {
    // Extra turns floor at 2, one Game Changer at 3, land denial at 4.
    const est = estimate({ extraTurns: 1, gameChangers: 1, massLandDenial: 1 });
    expect(est.hardFloors).toHaveLength(3);
    expect(est.bracket).toBe(4);
  });
});

// ── Soft score ─────────────────────────────────────────────────────────────

describe('soft score — how tuned the deck is inside its floor', () => {
  const scoreOf = (spec: DeckSpec) => estimate(spec).softScore;

  it('is zero for a deck with no speed, tutoring, or interaction', () => {
    expect(scoreOf({ averageCmc: 3.5, interaction: 8 })).toBe(0);
  });

  describe('fast mana — 8 points each, capped at 40', () => {
    it('scales linearly', () => {
      expect(scoreOf({ fastMana: 1 })).toBe(8);
      expect(scoreOf({ fastMana: 3 })).toBe(24);
    });
    it('caps at five sources', () => {
      expect(scoreOf({ fastMana: 5 })).toBe(40);
      expect(scoreOf({ fastMana: 7 })).toBe(40);
    });
  });

  describe('tutors — 5 points each, capped at 25', () => {
    it('scales linearly', () => {
      expect(scoreOf({ tutors: 2 })).toBe(10);
    });
    it('caps at five', () => {
      expect(scoreOf({ tutors: 5 })).toBe(25);
      expect(scoreOf({ tutors: 9 })).toBe(25);
    });
    it('only counts cards whose primary role is card draw', () => {
      // Cultivate carries the tutor tag but ramps; it must not score here.
      tagger.tutor.add('Cultivate');
      tagger.roles.set('Cultivate', 'ramp');
      const est = estimateBracket(['Cultivate'], new Set(), [], 3.5, undefined, {}, new Set());
      expect(est.breakdown.tutorCount).toBe(0);
      expect(est.softScore).toBe(0);
    });

    it('ignores land tutors — a land that finds a land is mana fixing', () => {
      // Evolving Wilds and the fetches carry Scryfall's tutor tag, but a
      // fixing-heavy manabase must not max this category on its own.
      const est = estimate({ landTutors: 5 });
      expect(est.breakdown.tutorCount).toBe(0);
      expect(est.softScore).toBe(0);
    });

    it('still counts real tutors in a deck that also runs fetches', () => {
      const est = estimate({ tutors: 2, landTutors: 5 });
      expect(est.breakdown.tutorCount).toBe(2);
      expect(est.softScore).toBe(10);
    });
  });

  describe('average mana value — (3.5 − avg) × 15, capped at 20', () => {
    it('scores nothing at or above 3.5', () => {
      expect(scoreOf({ averageCmc: 3.5 })).toBe(0);
      expect(scoreOf({ averageCmc: 4.2 })).toBe(0);
    });
    it('rewards a lower curve', () => {
      expect(scoreOf({ averageCmc: 3.0 })).toBe(8); // 0.5 × 15 = 7.5, rounded
      expect(scoreOf({ averageCmc: 2.5 })).toBe(15);
    });
    it('caps below roughly 2.17 average', () => {
      expect(scoreOf({ averageCmc: 2.0 })).toBe(20);
      expect(scoreOf({ averageCmc: 1.0 })).toBe(20);
    });
  });

  describe('interaction — 2 points per piece above 8, capped at 15', () => {
    it('scores nothing at or below the eight-piece baseline', () => {
      expect(scoreOf({ interaction: 8 })).toBe(0);
      expect(scoreOf({ interaction: 3 })).toBe(0);
    });
    it('scales above the baseline', () => {
      expect(scoreOf({ interaction: 12 })).toBe(8);
    });
    it('caps at sixteen pieces', () => {
      expect(scoreOf({ interaction: 16 })).toBe(15);
      expect(scoreOf({ interaction: 30 })).toBe(15);
    });
  });

  it('never exceeds 100', () => {
    expect(scoreOf({ fastMana: 7, tutors: 9, averageCmc: 1, interaction: 30 })).toBe(100);
  });
});

// ── Bump rule ──────────────────────────────────────────────────────────────

describe('the bump rule — a tuned deck plays above its floor', () => {
  /** Builds a deck at the requested floor with a soft score near a threshold. */
  const atFloor = (floor: number, spec: DeckSpec) =>
    estimate(floor === 1 ? spec : { ...spec, gameChangers: floor === 3 ? 1 : 4 });

  it('leaves a deck alone below 66', () => {
    // 5 fast mana (40) + 5 tutors (25) = 65.
    expect(atFloor(1, { fastMana: 5, tutors: 5 }).softScore).toBe(65);
    expect(atFloor(1, { fastMana: 5, tutors: 5 }).bracket).toBe(1);
  });

  it('raises a sub-4 floor by exactly one bracket once it crosses 66', () => {
    // 65 plus 2 points of interaction.
    const est = atFloor(1, { fastMana: 5, tutors: 5, interaction: 9 });
    expect(est.softScore).toBe(67);
    expect(est.bracket).toBe(2);
  });

  it('never lifts a sub-4 floor past Bracket 4', () => {
    const est = atFloor(3, { fastMana: 5, tutors: 5, interaction: 30, averageCmc: 1 });
    expect(est.softScore).toBe(100);
    expect(est.bracket).toBe(4);
  });

  it('holds a Bracket 4 floor below 80', () => {
    // 40 + 25 + 14 (interaction 15) = 79.
    const est = atFloor(4, { fastMana: 5, tutors: 5, interaction: 15 });
    expect(est.softScore).toBe(79);
    expect(est.bracket).toBe(4);
  });

  it('lifts a Bracket 4 floor to cEDH at 80', () => {
    const est = atFloor(4, { fastMana: 5, tutors: 5, interaction: 16 });
    expect(est.softScore).toBe(80);
    expect(est.bracket).toBe(5);
  });
});

// ── Known divergences ──────────────────────────────────────────────────────

/*
 * Divergences that remain, for whoever picks this up next:
 *
 *  - Bracket 1 vs 2, and Bracket 4 vs 5, turn on the player's *intent* rather
 *    than the card list. Neither is detectable here, and the UI should keep
 *    saying so rather than pretending to a precision it doesn't have.
 *  - The soft score (fast mana / tutors / curve / interaction) is ours, not
 *    WotC's. Tutors were deregulated in the Oct 2025 revision but still move
 *    the bracket, and heavy interaction *lengthens* games while scoring as
 *    "more tuned" — backwards under a turn-count-anchored system.
 */

describe('the displayed score is the score that gets compared', () => {
  // Regression: the estimator used to round only on the way out, so a raw 65.6
  // displayed as "66 / 100" beside copy promising a bump at 66 — and not bump.
  const roundingEdgeCase = { fastMana: 5, tutors: 5, averageCmc: 3.46 }; // raw 65.6

  it('rounds a raw 65.6 up to a displayed 66', () => {
    expect(estimate(roundingEdgeCase).softScore).toBe(66);
  });

  it('bumps on that displayed 66 rather than the raw value', () => {
    expect(estimate(roundingEdgeCase).bracket).toBe(2);
  });
});
