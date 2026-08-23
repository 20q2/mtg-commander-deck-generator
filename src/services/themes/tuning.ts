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

/**
 * Absolute member count. Three Praetors is not a Praetors deck.
 *
 * At a full 99 this is nearly redundant with MIN_RATIO (12% of ~65 non-lands ≈ 8), so it exists
 * mainly to stop thin partial lists — which the Inspector accepts — from detecting on 2-3 cards.
 * Measured at 6 because textbook Aristocrats and Blink lists scored 7 members and were being
 * thrown away by a floor of 8.
 */
export const MIN_MEMBERS = 6;
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
 *
 * Applied to ARCHETYPES only. Their base rate is itself derived from tag lift, so a tiny value can be
 * an artefact and needs the guard. A deterministic theme's base rate was measured directly — the
 * build script counted the cards passing its literal test — and clamping a measured value throws away
 * the only thing that separates a rare mechanic from an ambient one. At three cards in a 35-card
 * deck, Dredge (0.042% of the pool) is a 20x concentration and Flying (9.9%) is 0.9x; the clamp
 * flattened Dredge, Storm, Infect and Prowess to the same 4.3x as noise, which is why 55% of
 * mechanic themes couldn't be detected at all.
 */
export const EXPECTED_RATE_FLOOR = 0.02;

// ─── Rare-mechanic floor ──────────────────────────────────────────────

/**
 * The main floor (MIN_MEMBERS / MIN_RATIO) is calibrated for themes that span a deck. It is simply
 * wrong for a narrow mechanic: a real Storm deck runs three Storm cards, a Dredge deck three or four,
 * because that is all that exist. Measured over the taxonomy, 55% of mechanic themes could never be
 * declared on their own cards — including Dredge, which found exactly the right three (Life from the
 * Loam, Golgari Grave-Troll, Stinkweed Imp) and was rejected for finding only three.
 *
 * So a second path: fewer cards are enough when the concentration is extraordinary. Restricted to
 * themes with LITERAL evidence, consistent with the rest of the pipeline — the card itself says
 * "Dredge 3", which no amount of tag co-occurrence can match for reliability. Archetypes keep the
 * full floor, since a handful of tag hits is exactly what noise looks like.
 *
 * Re-swept 1-3 members x 12-26 lift once the failure list was measured properly. 21 deterministic
 * themes were failing for one reason only -- one or two members -- and nearly all with lift pinned at
 * the cap: two Wraith cards in a 35-card deck against a 0.06% base rate is not chance. Moving to
 * 2 members while RAISING the lift bar to 18 gains three points of deterministic top-3 (80.0% ->
 * 83.0%) and half a point of top-1, for 0.2 of a survivor on themeless decks. Fewer cards allowed,
 * but they must be more extraordinary.
 */
export const RARE_MIN_MEMBERS = 2;
/** …and the lift it must clear. Comfortably above Flying (0.9x), Haste (3.6x) and Elves (3.9x). */
export const RARE_MIN_LIFT = 18;
/**
 * Ceiling on the observed/expected multiplier, so one obscure tag can't run away with the ranking.
 *
 * Set at 8 initially, which turned out to saturate: on a test Aristocrats deck the top four themes
 * all pinned at exactly the cap and tied at 65.0, leaving the real winner indistinguishable from
 * noise. Raised to give the top of the ranking room to separate — the cap should be a guard against
 * runaway rare themes, not the value everything lands on.
 *
 * Re-swept at 12/16/20/26/32: 26 is where it plateaus, and moving 20 -> 26 gains half a point of
 * deterministic top-1 and a full point of archetype top-1 by leaving more room at the top of the
 * ranking before everything pins to the cap. 32 measures identically, so 26 is the corner.
 */
export const MAX_LIFT = 26;

// ─── Popularity prior ─────────────────────────────────────────────────

/**
 * A theme's total EDHREC deck count is the best available answer to "is this a real archetype people
 * build, or just a tag with a page?" — and it was being carried on every model and never used.
 *
 * The themes that win other themes' decks are overwhelmingly tiny. Blue Moon has 484 decks in the
 * entire format and a definition of generic blue vocabulary (synergy-blue, counterspell,
 * manaless-value, removal-bounce); it beat 12 themes on their own cards, including Spellslinger,
 * which has 87,716. Summons has 94. Turbo-Fog 384. Druids 534. Looting 790. Delver 934.
 *
 * The existing off-list prior gestures at this but can't see it: a rare theme that happens to sit on
 * the commander's page still gets 1.0. Popularity is the calibrated version. Log-scaled, because the
 * difference between 94 and 900 decks matters far more than between 40,000 and 80,000.
 *
 * Swept against both benchmarks. The floor trades long-tail accuracy for mainstream accuracy, so the
 * two metrics move in opposite directions: deck-count-WEIGHTED accuracy (how often a real user gets
 * the right answer) climbs 40.5% -> 47.0% as the floor falls from 1.0 to 0.15, while unweighted
 * per-theme accuracy falls 64.0% -> 56.6%. 0.60 is the efficient point: it captures most of the
 * weighted gain (+4.1) for the same 1.3-point tail cost as a much gentler 0.75, and 0.45 buys only
 * +0.3 more for twice the tail loss. Identifying strange decks matters, so the tail is not for sale.
 */
export const POPULARITY_FLOOR = 0.45;
export const POPULARITY_FULL_AT = 20000;

/** Multiplier in [POPULARITY_FLOOR, 1] for how established a theme is. */
export function popularityPrior(
  numDecks: number, floor = POPULARITY_FLOOR, fullAt = POPULARITY_FULL_AT,
): number {
  if (fullAt <= 1) return 1;
  const t = Math.min(1, Math.log10(Math.max(0, numDecks) + 1) / Math.log10(fullAt));
  return floor + (1 - floor) * t;
}

/**
 * How much COVERAGE counts in the ranking, as an exponent on (ratio / COVERAGE_FULL).
 *
 * 0 reproduces the original lift-only score. Lift answers 'how surprising is this concentration';
 * coverage answers 'how much of the deck does this actually explain'. A theme accounting for 60% of
 * the cards is a stronger claim than one accounting for 15% at the same lift, and the ranking could
 * not see the difference.
 *
 * Swept 0 to 1.5. Gains plateau at 0.15-0.3 and are modest but free: archetype top-1 29.0% -> 32.5%
 * and weighted accuracy +0.6, for 0.9 of deterministic top-1 and no fixture change. Past 0.5 it
 * starts trading real deterministic accuracy for archetype accuracy, so it stays low. Re-swept with
 * the pruned definitions: 0.15 is now the corner rather than 0.3, worth 0.4 on every page-sweep
 * metric at identical fixtures. The knobs interact, so both were re-searched together.
 */
export const COVERAGE_WEIGHT = 0.15;

/**
 * How many cards the COMMANDER counts as when it belongs to a theme.
 *
 * The commander is the one card always available, and the deck is built around it: a Krenko deck is a
 * Goblins deck because of Krenko, not because of the eighteenth goblin. Counting it as one card in
 * ninety-nine is why commander-driven themes could never clear the floor -- Experience Counters lives
 * in the command zone, and the 99 may contain nothing that says 'experience' at all.
 *
 * Swept 1-12 against both benchmarks, with the FIXTURES as arbiter: the page sweep uses each theme's
 * own top commander, so weighting it there is circular and shows gains that mean nothing. 2 is free
 * on the fixtures and slightly positive everywhere; 3 and above buy page-sweep accuracy at the cost
 * of a fixture, and 6+ break five.
 *
 * It does NOT rescue command-zone-only themes — Ezuri's deck still has one card matching Experience
 * Counters, below any floor. What it does is calibrate confidence on answers already right:
 * Talrand/Spellslinger 38% → 48%, Chatterfang/Squirrels 61% → 68%, Ezuri/+1+1 84% → 88%. A Goblins
 * deck led by Krenko really is more certainly Goblins, and that is the number a reader acts on.
 *
 * Weighted into the RATIO only, never the absolute member floor. Inflating "how many cards match" is
 * a lie about the deck, and it would let any commander single-handedly declare a theme.
 */
export const COMMANDER_WEIGHT = 2;

// ─── Nesting suppression ──────────────────────────────────────────────

/**
 * If theme B's members are mostly a subset of stronger theme A's, drop B. Stops an Elf Druid deck
 * reporting both "Elves" and "Druids", and stops "Humans" riding along on every creature deck.
 */
/*
 * Swept 0.6-1.0. Lower means suppression fires more readily, and more readily is better: 0.7 gains
 * 1.3 points of deterministic top-1 over 0.8 by collapsing sibling archetypes and leaving the
 * literal theme on top. Below 0.7 it keeps gaining top-1 but starts costing top-3 -- 0.6 gives up
 * 1.8 points there -- and top-3 is the metric that matters for finding an unusual deck's theme at
 * all, so 0.7 is the corner.
 */
export const NEST_SUPPRESS_RATIO = 0.75;

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
  rareMinMembers: number;
  rareMinLift: number;
  popularityFloor: number;
  popularityFullAt: number;
  coverageWeight: number;
  commanderWeight: number;
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
  rareMinMembers: RARE_MIN_MEMBERS,
  rareMinLift: RARE_MIN_LIFT,
  popularityFloor: POPULARITY_FLOOR,
  popularityFullAt: POPULARITY_FULL_AT,
  coverageWeight: COVERAGE_WEIGHT,
  commanderWeight: COMMANDER_WEIGHT,
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
  { key: 'commanderWeight', label: 'Commander weight', min: 1, max: 12, step: 0.5,
    hint: 'How many cards the commander counts as when it matches a theme' },
  { key: 'rareMinMembers', label: 'Rare-mechanic members', min: 1, max: 10, step: 1,
    hint: 'Members needed when a literal theme is extraordinarily concentrated' },
  { key: 'rareMinLift', label: 'Rare-mechanic lift', min: 1, max: 20, step: 1,
    hint: 'Lift that few-card path must clear (Flying is 0.9x, Elves 3.9x)' },
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
