/**
 * Every knob for theme scoring, in one file on purpose.
 *
 * These values are GUESSES. Nothing here has been validated against real decks yet — the whole
 * point of `/theme-lab` is to make them answerable by looking rather than by arguing. The debug
 * page can override any of them live, so prefer changing a number there first and only writing the
 * winner back here.
 */

/** How many themes from local Phase A scoring get promoted to an EDHREC page fetch. */
export const SHORTLIST_SIZE = 6;

// ─── Floors ───────────────────────────────────────────────────────────
// A theme must clear BOTH to be considered at all. Scoring ~400 themes means ~400 chances to be
// wrong, and the long tail is where the embarrassing false positives live.

/** Absolute member count. Three Praetors is not a Praetors deck. */
export const MIN_MEMBERS = 8;
/** Members as a share of non-land cards. */
export const MIN_RATIO = 0.12;

// ─── Prior ────────────────────────────────────────────────────────────

/** Score multiplier for themes EDHREC lists on the commander's own page. */
export const COMMANDER_LIST_PRIOR = 1.0;
/**
 * ...and for themes it doesn't. Below 1 so an off-list theme must be clearly stronger to win, which
 * is what keeps 400 long-tail tags from each getting a free shot at the title — while still letting
 * a genuine off-meta build (a real Praetors pile) take it on a huge ratio.
 */
export const OFF_LIST_PRIOR = 0.65;

// ─── Signal blend ─────────────────────────────────────────────────────
// Deliberately TIMID at launch: membership is a tiebreaker against the EDHREC signals we already
// trust, not the dominant term. Turn MEMBERSHIP_WEIGHT up once /theme-lab shows the numbers are
// sane. Shipping it confident is how you discover Humans-tribal Atraxa in the wild.

export const MEMBERSHIP_WEIGHT = 0.35;
export const OVERLAP_WEIGHT = 0.40;
export const INCLUSION_WEIGHT = 0.25;

// ─── Observed-over-expected ───────────────────────────────────────────

/**
 * Floor on a theme's expected hit rate, guarding division by zero for themes that essentially never
 * appear. Also caps how enormous a rare theme's lift can get from a single lucky match.
 */
export const EXPECTED_RATE_FLOOR = 0.02;
/** Ceiling on the observed/expected multiplier, so one obscure tag can't run away with the ranking. */
export const MAX_LIFT = 8;

// ─── Nesting suppression ──────────────────────────────────────────────

/**
 * If theme B's members are mostly a subset of stronger theme A's, drop B. Stops an Elf Druid deck
 * reporting both "Elves" and "Druids", and stops "Humans" riding along on every creature deck.
 */
export const NEST_SUPPRESS_RATIO = 0.8;

/** The full knob set, as data — this is what `/theme-lab` edits and passes back in. */
export interface ThemeTuning {
  shortlistSize: number;
  minMembers: number;
  minRatio: number;
  commanderListPrior: number;
  offListPrior: number;
  membershipWeight: number;
  overlapWeight: number;
  inclusionWeight: number;
  expectedRateFloor: number;
  maxLift: number;
  nestSuppressRatio: number;
}

export const DEFAULT_TUNING: ThemeTuning = {
  shortlistSize: SHORTLIST_SIZE,
  minMembers: MIN_MEMBERS,
  minRatio: MIN_RATIO,
  commanderListPrior: COMMANDER_LIST_PRIOR,
  offListPrior: OFF_LIST_PRIOR,
  membershipWeight: MEMBERSHIP_WEIGHT,
  overlapWeight: OVERLAP_WEIGHT,
  inclusionWeight: INCLUSION_WEIGHT,
  expectedRateFloor: EXPECTED_RATE_FLOOR,
  maxLift: MAX_LIFT,
  nestSuppressRatio: NEST_SUPPRESS_RATIO,
};

/** Human labels + sane input bounds for the debug page's tuning panel. */
export const TUNING_FIELDS: {
  key: keyof ThemeTuning; label: string; min: number; max: number; step: number; hint: string;
}[] = [
  { key: 'membershipWeight', label: 'Membership weight', min: 0, max: 1, step: 0.05,
    hint: 'How much derived card membership counts vs. EDHREC signals' },
  { key: 'overlapWeight', label: 'Overlap weight', min: 0, max: 1, step: 0.05,
    hint: 'EDHREC theme-page card overlap' },
  { key: 'inclusionWeight', label: 'Inclusion weight', min: 0, max: 1, step: 0.05,
    hint: 'Weighted inclusion % of overlapping cards' },
  { key: 'minMembers', label: 'Min members', min: 0, max: 40, step: 1,
    hint: 'Hard floor on absolute member count' },
  { key: 'minRatio', label: 'Min ratio', min: 0, max: 1, step: 0.01,
    hint: 'Hard floor on members / non-land cards' },
  { key: 'offListPrior', label: 'Off-list prior', min: 0, max: 1.5, step: 0.05,
    hint: 'Multiplier for themes not on the commander page' },
  { key: 'commanderListPrior', label: 'On-list prior', min: 0, max: 2, step: 0.05,
    hint: 'Multiplier for themes EDHREC lists for this commander' },
  { key: 'expectedRateFloor', label: 'Expected-rate floor', min: 0.001, max: 0.5, step: 0.005,
    hint: 'Guards observed/expected against div-by-zero' },
  { key: 'maxLift', label: 'Max lift', min: 1, max: 30, step: 1,
    hint: 'Ceiling on the observed/expected multiplier' },
  { key: 'nestSuppressRatio', label: 'Nest suppression', min: 0, max: 1, step: 0.05,
    hint: 'Drop a theme whose members are this fraction inside a stronger one' },
  { key: 'shortlistSize', label: 'Shortlist size', min: 1, max: 20, step: 1,
    hint: 'Themes promoted to an EDHREC page fetch' },
];
