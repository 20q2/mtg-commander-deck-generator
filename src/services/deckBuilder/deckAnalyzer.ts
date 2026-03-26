import type { ScryfallCard, EDHRECCommanderData, EDHRECCard } from '@/types';
import { getCardRole, cardMatchesRole, getAllCardRoles, hasTag, getCardSubtype, isUtilityLand, isTapland, type RoleKey } from '@/services/tagger/client';
import { getFrontFaceTypeLine, isMdfcLand, isChannelLand, getCachedCard } from '@/services/scryfall/client';
import { calculateCurvePercentages } from './curveUtils';
import { detectPacing, type Pacing } from './themeDetector';

export interface RoleDeficit {
  role: string;
  label: string;
  current: number;
  target: number;
  deficit: number;
}

export interface CurveSlot {
  cmc: number;
  current: number;
  target: number;
  delta: number; // positive = over, negative = under
}

export type LandVerdict = 'critically-low' | 'low' | 'ok' | 'slightly-low' | 'high';

export interface ManaBaseAnalysis {
  currentLands: number;
  suggestedLands: number;
  adjustedSuggestion: number; // EDHREC avg nudged up, or down if ramp is strong
  currentBasic: number;
  currentNonbasic: number;
  suggestedBasic: number;
  suggestedNonbasic: number;
  rampCount: number; // total ramp-role cards in deck
  manaProducerCount: number; // mana dorks + mana rocks specifically
  verdict: LandVerdict;
  verdictMessage: string;
  // Starting hand probabilities (hypergeometric, 7-card hand)
  probLand0: number;
  probLand1: number;
  probLand2to3: number;
  probLand4plus: number;
  deckSize: number;
  taplandCount: number;   // lands that ETB tapped (from otag:tapland)
  taplandRatio: number;   // taplandCount / currentLands (0-1)
}

export interface TypeSlot {
  type: string;
  current: number;
  target: number;
  delta: number;
}

export interface RecommendedCard {
  name: string;
  inclusion: number;
  synergy: number;
  role?: string;
  roleLabel?: string;
  allRoles?: string[];
  allRoleLabels?: string[];
  fillsDeficit: boolean;
  primaryType: string;
  imageUrl?: string;
  backImageUrl?: string;
  price?: string;
  producedColors?: string[];
  isThemeSynergy?: boolean;
  score?: number;
  cmc?: number;
  isUtilityLand?: boolean;
  isTapland?: boolean;
}

export interface AnalyzedCard {
  card: ScryfallCard;
  inclusion: number | null;
  score?: number;
  role?: string;
  roleLabel?: string;
  subtype?: string;
  subtypeLabel?: string;
}

export interface RoleBreakdown {
  role: string;
  label: string;
  current: number;
  target: number;
  deficit: number;
  cards: AnalyzedCard[];
  suggestedReplacements: RecommendedCard[];
}

export interface CurveBreakdown {
  cmc: number;
  current: number;
  target: number;
  delta: number;
  cards: AnalyzedCard[];
}

export type CurvePhase = 'early' | 'mid' | 'late';
export type PhaseRoleGroup = 'ramp' | 'interaction' | 'cardDraw' | 'other';

export interface PhaseRoleBreakdown {
  roleGroup: PhaseRoleGroup;
  label: string;
  current: number;
  target: number;
  deficit: number;
}

export interface CurvePhaseAnalysis {
  phase: CurvePhase;
  label: string;
  cmcRange: [number, number];
  current: number;
  target: number;
  delta: number;
  cards: AnalyzedCard[];
  pctOfDeck: number;
  avgCmc: number;
  grade: GradeResult;
  rampInPhase: number;
  interactionInPhase: number;
  cardDrawInPhase: number;
  phaseRoleBreakdowns: PhaseRoleBreakdown[];
}

export interface ManaTrajectoryPoint {
  turn: number;
  // ── Mana availability ──
  expectedLandsRaw: number;       // land mana ignoring tap penalty
  expectedLands: number;          // effective land mana (tap penalty applied)
  tapPenalty: number;             // mana lost to taplands this turn
  expectedRampMana: number;       // mana from ramp spells
  totalExpectedMana: number;      // effective lands + ramp
  // ── Probabilities ──
  landDropProbability: number;    // P(made all land drops through this turn)
  // ── Card-based (enriched after generation — zero until enriched) ──
  castableCards: number;          // non-land cards with CMC ≤ totalExpectedMana
  castablePct: number;            // castableCards / totalNonLand (0-1)
  newUnlocks: number;             // cards that become castable THIS turn (not previous)
  manaEfficiency: number;         // estimated mana utilization (0-1, higher = busier turns)
}

export interface ColorFixingAnalysis {
  colorsNeeded: string[];
  sourcesPerColor: Record<string, number>;
  fixingLands: AnalyzedCard[];   // lands producing 2+ of needed colors
  colorlessOnly: AnalyzedCard[]; // utility lands producing only colorless
  utilityLands: AnalyzedCard[];  // lands with non-mana abilities (from otag:utility-land)
  taplands: AnalyzedCard[];      // lands that enter the battlefield tapped (from otag:tapland)
  manaFixCards: AnalyzedCard[];  // non-land cards with mana-fix tag (actually fix colors)
  nonFixRampCards: AnalyzedCard[]; // non-land ramp (dorks, rocks, cost-reducers) without mana-fix tag
  pipDemand: Record<string, number>;           // colored pip count per color across non-land cards
  pipDemandTotal: number;                      // sum of all colored pips
  demandVsSupplyRatio: Record<string, number>; // (demand% - supply%) per color; positive = underserved
  weakestColor: string | null;                 // color with highest positive ratio
  anyColorLandCount: number;                   // lands with "any color"/"any type" in oracle
  fixingScore: number;                         // 0-100 composite score
  fixingGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  fixingGradeMessage: string;
  fixingRecommendations: RecommendedCard[];    // suggested non-land mana fixers from EDHREC
}

export interface ManaSourcesAnalysis {
  totalRamp: number;
  producers: number;        // dorks + rocks
  reducers: number;         // cost-reducer subtype
  otherRamp: number;        // everything else
  avgRampCmc: number;       // average CMC of ramp cards
  earlyRamp: number;        // ramp at CMC ≤ 2
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  message: string;
}

export interface GradeResult {
  letter: string;
  message: string;
}

export interface DeckAnalysis {
  roleDeficits: RoleDeficit[];
  curveAnalysis: CurveSlot[];
  manaBase: ManaBaseAnalysis;
  manaSources: ManaSourcesAnalysis;
  typeAnalysis: TypeSlot[];
  recommendations: RecommendedCard[];
  roleBreakdowns: RoleBreakdown[];
  curveBreakdowns: CurveBreakdown[];
  landCards: AnalyzedCard[];
  rampCards: AnalyzedCard[];
  landRecommendations: RecommendedCard[];
  colorFixing: ColorFixingAnalysis;
  mdfcsInDeck: AnalyzedCard[];
  channelLandsInDeck: AnalyzedCard[];
  curvePhases: CurvePhaseAnalysis[];
  manaTrajectory: ManaTrajectoryPoint[];
  rolesGrade: GradeResult;
  manaGrade: GradeResult;
  curveGrade: GradeResult;
  pacing: Pacing;
  pacingLabel: string;
}

const ROLE_LABELS: Record<string, string> = {
  ramp: 'Ramp',
  removal: 'Removal',
  boardwipe: 'Board Wipes',
  cardDraw: 'Card Advantage',
};

// Binomial coefficient C(n, k)
function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = result * (n - i) / (i + 1);
  }
  return result;
}

// Hypergeometric PMF: P(X=k) drawing n from N total with K successes
export function hypergeoPmf(N: number, K: number, n: number, k: number): number {
  return (binomial(K, k) * binomial(N - K, n - k)) / binomial(N, n);
}

// ─── Hand Simulation Stats ──────────────────────────────────────────

export interface HandStats {
  expectedLands: number;
  expectedRamp: number;
  expectedRemoval: number;
  expectedEarlyPlays: number; // CMC ≤ 2
  keepableRate: number;       // 0-1
  manaScrew: number;          // P(0-1 lands) — 0-1
  manaFlood: number;          // P(5+ lands) — 0-1
}

/**
 * Compute expected opening hand composition and keepable hand rate.
 * "Keepable" = 2-4 lands AND at least 1 spell with CMC ≤ 3.
 */
export function computeHandStats(
  deckSize: number,
  landCount: number,
  rampCount: number,
  removalCount: number,
  earlyPlayCount: number,  // cards with CMC ≤ 2 (non-land)
  lowCmcCount: number,     // cards with CMC ≤ 3 (non-land)
): HandStats {
  const hand = 7;
  const expectedLands = Math.round((hand * landCount / deckSize) * 10) / 10;
  const expectedRamp = Math.round((hand * rampCount / deckSize) * 10) / 10;
  const expectedRemoval = Math.round((hand * removalCount / deckSize) * 10) / 10;
  const expectedEarlyPlays = Math.round((hand * earlyPlayCount / deckSize) * 10) / 10;

  // P(exactly k lands in 7-card hand)
  const pLandByK: number[] = [];
  for (let k = 0; k <= hand; k++) {
    pLandByK.push(hypergeoPmf(deckSize, landCount, hand, k));
  }

  let pLand2to4 = 0;
  for (let k = 2; k <= 4; k++) pLand2to4 += pLandByK[k];

  // Screw = P(0-1 lands), Flood = P(5+ lands)
  const manaScrew = pLandByK[0] + pLandByK[1];
  const manaFlood = pLandByK.slice(5).reduce((a, b) => a + b, 0);

  // P(0 low-CMC non-land spells in 7 cards)
  const pNoEarlySpell = lowCmcCount >= deckSize ? 0 :
    binomial(deckSize - lowCmcCount, hand) / binomial(deckSize, hand);
  const pHasEarlySpell = 1 - pNoEarlySpell;

  const keepableRate = Math.round(pLand2to4 * pHasEarlySpell * 100) / 100;

  return { expectedLands, expectedRamp, expectedRemoval, expectedEarlyPlays, keepableRate, manaScrew, manaFlood };
}

// ─── Land Drop Probabilities ────────────────────────────────────────

export interface LandDropProbability {
  turn: number;
  probability: number; // 0-1
}

/**
 * P(made all land drops through turn T) for turns 1-7.
 * On turn T you've seen T+6 cards (7 opening + T-1 draws).
 * Need at least T lands in those T+6 cards.
 */
export function computeLandDropProbabilities(
  deckSize: number,
  landCount: number,
): LandDropProbability[] {
  const results: LandDropProbability[] = [];
  for (let turn = 1; turn <= 7; turn++) {
    const cardsSeen = turn + 6;
    // P(X >= turn) = 1 - sum_{k=0}^{turn-1} hypergeoPmf(N, K, n, k)
    let pLess = 0;
    for (let k = 0; k < turn; k++) {
      pLess += hypergeoPmf(deckSize, landCount, cardsSeen, k);
    }
    results.push({ turn, probability: Math.max(0, Math.min(1, 1 - pLess)) });
  }
  return results;
}

// Determine which colors a land produces from produced_mana + oracle text fallback
function getLandProducedColors(card: ScryfallCard): string[] {
  const colors: Set<string> = new Set();
  const producedMana = card.produced_mana || [];
  const oracleText = (card.oracle_text || '').toLowerCase();
  const typeLine = (card.type_line || '').toLowerCase();

  for (const mana of producedMana) {
    if (['W', 'U', 'B', 'R', 'G'].includes(mana)) colors.add(mana);
  }

  // Fallback: check basic land types and oracle text
  if (colors.size === 0) {
    if (typeLine.includes('plains') || oracleText.includes('add {w}')) colors.add('W');
    if (typeLine.includes('island') || oracleText.includes('add {u}')) colors.add('U');
    if (typeLine.includes('swamp') || oracleText.includes('add {b}')) colors.add('B');
    if (typeLine.includes('mountain') || oracleText.includes('add {r}')) colors.add('R');
    if (typeLine.includes('forest') || oracleText.includes('add {g}')) colors.add('G');
    // "any color" / "any type" patterns
    if (oracleText.includes('any color') || oracleText.includes('any type')) {
      for (const c of ['W', 'U', 'B', 'R', 'G']) colors.add(c);
    }
  }

  return [...colors];
}

/** Resolve produced colors for a recommendation card via Scryfall cache, with EDHREC color_identity fallback. */
function getRecommendationColors(cardName: string, edhrecColorIdentity?: string[]): string[] {
  const cached = getCachedCard(cardName);
  if (cached) {
    // Use the full Scryfall logic for lands, or produced_mana for others
    const typeLine = (cached.type_line || '').toLowerCase();
    if (typeLine.includes('land')) return getLandProducedColors(cached);
    const produced = cached.produced_mana || [];
    const colors = produced.filter(c => ['W', 'U', 'B', 'R', 'G'].includes(c));
    if (colors.length > 0) return [...new Set(colors)];
    // Fall back to Scryfall color_identity
    if (cached.color_identity && cached.color_identity.length > 0) {
      return cached.color_identity.map(c => c.toUpperCase());
    }
  }
  // Fall back to EDHREC color_identity
  if (edhrecColorIdentity && edhrecColorIdentity.length > 0) {
    return edhrecColorIdentity.map(c => c.toUpperCase());
  }
  return [];
}

// ─── Macro Grading Functions ─────────────────────────────────────

const GRADE_SCORES: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };

function letterFromScore(score: number): string {
  if (score >= 3.5) return 'A';
  if (score >= 2.5) return 'B';
  if (score >= 1.5) return 'C';
  if (score >= 0.75) return 'D';
  return 'F';
}

export function getRolesGrade(roleDeficits: RoleDeficit[]): GradeResult {
  const totalDeficit = roleDeficits.reduce((sum, rd) => sum + rd.deficit, 0);
  const maxSingleDeficit = Math.max(...roleDeficits.map(rd => rd.deficit), 0);
  const rolesMet = roleDeficits.filter(rd => rd.current >= rd.target).length;
  const totalRoles = roleDeficits.length;
  const worstRole = roleDeficits.reduce((worst, rd) => rd.deficit > worst.deficit ? rd : worst, roleDeficits[0]);

  if (totalDeficit === 0)
    return { letter: 'A', message: 'All roles on target — well-balanced deck.' };
  if (totalDeficit <= 3 && maxSingleDeficit <= 2)
    return { letter: 'B', message: `Nearly balanced, ${totalDeficit} card${totalDeficit > 1 ? 's' : ''} short across roles.` };
  if (totalDeficit <= 6 && rolesMet >= 2)
    return { letter: 'C', message: `${rolesMet}/${totalRoles} roles met. Consider more ${worstRole?.label?.toLowerCase() || 'role cards'}.` };
  if (totalDeficit <= 10 || rolesMet >= 1)
    return { letter: 'D', message: `Significant gaps — ${worstRole?.label || 'a role'} is ${worstRole?.deficit || 0} short.` };
  return { letter: 'F', message: `Deck is severely unbalanced. Missing ${totalDeficit} role cards.` };
}

// ─── Per-Role Verdict Messages ─────────────────────────────────────

const ROLE_FLAVOR: Record<string, { noun: string; okMsg: string; whyItMatters: string; excessHint: string; zeroMsg: string }> = {
  ramp: {
    noun: 'ramp',
    okMsg: 'your deck should consistently accelerate ahead of curve.',
    whyItMatters: 'you\'ll fall behind on mana while opponents pull ahead',
    excessHint: 'extra slots could go toward threats or interaction',
    zeroMsg: 'No ramp at all — you\'ll be stuck playing one land per turn while opponents pull ahead. Even the fastest decks run mana rocks or dorks to keep up.',
  },
  removal: {
    noun: 'removal',
    okMsg: 'you have plenty of answers for key threats at the table.',
    whyItMatters: 'opponents\' biggest threats will go unchecked',
    excessHint: 'you might be answering threats instead of building your own board',
    zeroMsg: 'No removal at all — you have no way to deal with an opponent\'s key combo piece, threatening commander, or game-winning enchantment. Interaction is non-negotiable in Commander.',
  },
  boardwipe: {
    noun: 'board wipe',
    okMsg: 'you have reset buttons for when opponents go wide.',
    whyItMatters: 'you\'ll struggle to recover when opponents flood the board',
    excessHint: 'too many resets can stall your own board development',
    zeroMsg: 'No board wipes — if even one opponent builds a wide board, you\'ll have no way to reset. A single well-timed wipe can turn a losing game around.',
  },
  cardDraw: {
    noun: 'card draw',
    okMsg: 'your hand should stay stocked through the mid-to-late game.',
    whyItMatters: 'you\'ll be topdecking while opponents still have full hands',
    excessHint: 'drawing cards is great, but you need things worth casting too',
    zeroMsg: 'No card draw at all — you\'ll empty your hand by turn 5-6 and be topdecking the rest of the game while opponents refuel. Card advantage is how you stay in the game.',
  },
};

export function getRoleVerdict(rb: RoleBreakdown): { verdict: string; message: string } {
  const { current, target, deficit, role } = rb;
  const flavor = ROLE_FLAVOR[role] || { noun: role, okMsg: 'this role is well covered.', whyItMatters: '' };
  const surplus = current - target;

  // Zero cards — always critically low with special message
  if (current === 0) {
    return {
      verdict: 'critically-low',
      message: flavor.zeroMsg,
    };
  }
  // Over target by 3+
  if (surplus >= 3) {
    return {
      verdict: 'high',
      message: `${current} ${flavor.noun} is ${surplus} above the ${target} target — you could swap a few for other roles or synergy pieces.`,
    };
  }
  // On target or slightly above
  if (current >= target) {
    return {
      verdict: 'ok',
      message: `${current} ${flavor.noun} ${current === 1 ? 'effect' : 'sources'} is solid — ${flavor.okMsg}`,
    };
  }
  // 1-2 short
  if (deficit <= 2) {
    return {
      verdict: 'slightly-low',
      message: `${current} ${flavor.noun} is ${deficit} short of the ${target} target. Close, but a couple more would help consistency.`,
    };
  }
  // 3-4 short
  if (deficit <= 4) {
    return {
      verdict: 'low',
      message: `${current} ${flavor.noun} is ${deficit} below the ${target} target. ${flavor.whyItMatters}`,
    };
  }
  return {
    verdict: 'critically-low',
    message: `Only ${current} ${flavor.noun} — ${deficit} short of ${target}. ${flavor.whyItMatters}`,
  };
}

export function getManaGrade(
  manaBase: ManaBaseAnalysis,
  manaSources: ManaSourcesAnalysis,
  colorFixing: ColorFixingAnalysis,
  flexCount: number,
): GradeResult {
  // Convert each sub-grade to numeric
  const landGradeLetter = getManaBaseGradeLetter(manaBase);
  const sourceGrade = manaSources.grade;
  const fixingGrade = colorFixing.fixingGrade;
  const flexGrade = getFlexGradeLetter(flexCount);

  const scores = {
    lands: GRADE_SCORES[landGradeLetter] ?? 0,
    sources: GRADE_SCORES[sourceGrade] ?? 0,
    fixing: GRADE_SCORES[fixingGrade] ?? 0,
    flex: GRADE_SCORES[flexGrade] ?? 0,
  };

  // Weighted average: lands 30%, sources 30%, fixing 25%, flex 15%
  const composite = scores.lands * 0.30 + scores.sources * 0.30 + scores.fixing * 0.25 + scores.flex * 0.15;
  const letter = letterFromScore(composite);

  // Find weakest sub-grade for message
  const subGrades = [
    { label: 'Land count', score: scores.lands },
    { label: 'Ramp', score: scores.sources },
    { label: 'Color fixing', score: scores.fixing },
    { label: 'Flex lands', score: scores.flex },
  ];
  const weakest = subGrades.reduce((w, s) => s.score < w.score ? s : w, subGrades[0]);
  const allGood = subGrades.every(s => s.score >= 3);

  let message: string;
  if (allGood) {
    message = 'Mana base is solid across the board.';
  } else if (letter === 'A' || letter === 'B') {
    message = `Looking good — ${weakest.label.toLowerCase()} could use a small bump.`;
  } else {
    message = `${weakest.label} is the weak spot.`;
  }

  return { letter, message };
}

/** Land count grade letter (mirrors getManaBaseGrade in DeckOptimizer) */
function getManaBaseGradeLetter(mb: ManaBaseAnalysis): string {
  const sweetSpot = mb.probLand2to3;
  if (mb.verdict === 'ok' && sweetSpot >= 0.48) return 'A';
  if (mb.verdict === 'ok' || (mb.verdict === 'slightly-low' && sweetSpot >= 0.45)) return 'B';
  if (mb.verdict === 'slightly-low' || mb.verdict === 'high') return 'C';
  if (mb.verdict === 'low') return 'D';
  return 'F';
}

/** Flex land grade letter (mirrors getMdfcGrade in DeckOptimizer) */
function getFlexGradeLetter(count: number): string {
  if (count >= 6) return 'A';
  if (count >= 3) return 'B';
  if (count >= 1) return 'C';
  return 'F';
}

export function getCurveGrade(phases: CurvePhaseAnalysis[]): GradeResult {
  if (phases.length === 0) return { letter: 'F', message: 'No non-land cards to evaluate.' };

  // Weighted average of phase grades: early 30%, mid 40%, late 30%
  const PHASE_WEIGHTS: Record<string, number> = { early: 0.30, mid: 0.40, late: 0.30 };
  const weightedScore = phases.reduce((sum, p) => {
    const score = GRADE_SCORES[p.grade.letter] ?? 0;
    const weight = PHASE_WEIGHTS[p.phase] ?? 0;
    return sum + score * weight;
  }, 0);

  const letter = letterFromScore(weightedScore);

  // Detect direction for message flavor
  const earlyDelta = phases.find(p => p.phase === 'early')?.delta ?? 0;
  const lateDelta = phases.find(p => p.phase === 'late')?.delta ?? 0;
  const shape = lateDelta > 3 ? 'top-heavy' : earlyDelta > 3 ? 'bottom-heavy' : 'uneven';

  const messages: Record<string, string> = {
    'A': 'Excellent tempo — plays on curve consistently.',
    'B': 'Good tempo with minor gaps in the curve.',
    'C': `Tempo is a bit ${shape} — may stall at some points.`,
    'D': `Tempo is ${shape} — expect awkward turns.`,
    'F': 'Poor tempo — likely to miss plays or waste mana often.',
  };

  return { letter, message: messages[letter] || messages.F };
}

/** Pacing multipliers shift curve targets to match detected deck tempo. */
export const PACING_MULTIPLIERS: Record<Pacing, { early: number; mid: number; late: number }> = {
  'aggressive-early': { early: 1.20, mid: 0.95, late: 0.75 },
  'fast-tempo':       { early: 1.12, mid: 1.00, late: 0.82 },
  'midrange':         { early: 0.92, mid: 1.10, late: 0.95 },
  'late-game':        { early: 0.85, mid: 0.95, late: 1.25 },
  'balanced':         { early: 1.00, mid: 1.00, late: 1.00 },
};

/** Per-phase role distribution ratios — how global role targets split across phases. */
const PHASE_ROLE_DIST: Record<CurvePhase, Record<PhaseRoleGroup, number>> = {
  early: { ramp: 0.75, interaction: 0.25, cardDraw: 0.30, other: 0 },
  mid:   { ramp: 0.20, interaction: 0.45, cardDraw: 0.40, other: 0 },
  late:  { ramp: 0.05, interaction: 0.30, cardDraw: 0.30, other: 0 },
};

/** Pacing-adjusted phase role distributions. */
const PACING_PHASE_ROLE_DIST: Record<Pacing, Record<CurvePhase, Record<PhaseRoleGroup, number>>> = {
  'aggressive-early': {
    early: { ramp: 0.82, interaction: 0.30, cardDraw: 0.35, other: 0 },
    mid:   { ramp: 0.15, interaction: 0.40, cardDraw: 0.35, other: 0 },
    late:  { ramp: 0.03, interaction: 0.30, cardDraw: 0.30, other: 0 },
  },
  'fast-tempo': {
    early: { ramp: 0.78, interaction: 0.28, cardDraw: 0.33, other: 0 },
    mid:   { ramp: 0.18, interaction: 0.42, cardDraw: 0.37, other: 0 },
    late:  { ramp: 0.04, interaction: 0.30, cardDraw: 0.30, other: 0 },
  },
  'midrange': {
    early: { ramp: 0.72, interaction: 0.25, cardDraw: 0.30, other: 0 },
    mid:   { ramp: 0.22, interaction: 0.45, cardDraw: 0.40, other: 0 },
    late:  { ramp: 0.06, interaction: 0.30, cardDraw: 0.30, other: 0 },
  },
  'late-game': {
    early: { ramp: 0.70, interaction: 0.20, cardDraw: 0.25, other: 0 },
    mid:   { ramp: 0.22, interaction: 0.45, cardDraw: 0.40, other: 0 },
    late:  { ramp: 0.08, interaction: 0.35, cardDraw: 0.35, other: 0 },
  },
  'balanced': PHASE_ROLE_DIST,
};

/** Distribute global role targets across phases based on pacing. */
export function getPhaseRoleTargets(
  roleTargets: Record<string, number>,
  pacing: Pacing,
): Record<CurvePhase, Record<PhaseRoleGroup, number>> {
  const dist = PACING_PHASE_ROLE_DIST[pacing] ?? PHASE_ROLE_DIST;
  const globalRamp = roleTargets.ramp ?? 10;
  const globalInteraction = (roleTargets.removal ?? 8) + (roleTargets.boardwipe ?? 3);
  const globalDraw = roleTargets.cardDraw ?? 10;

  const result: Record<CurvePhase, Record<PhaseRoleGroup, number>> = {
    early: { ramp: 0, interaction: 0, cardDraw: 0, other: 0 },
    mid:   { ramp: 0, interaction: 0, cardDraw: 0, other: 0 },
    late:  { ramp: 0, interaction: 0, cardDraw: 0, other: 0 },
  };

  for (const phase of ['early', 'mid', 'late'] as CurvePhase[]) {
    result[phase].ramp = Math.round(globalRamp * dist[phase].ramp);
    result[phase].interaction = Math.round(globalInteraction * dist[phase].interaction);
    result[phase].cardDraw = Math.round(globalDraw * dist[phase].cardDraw);
  }

  // Fix rounding drift so per-role totals across phases match global targets
  for (const [roleKey, globalTarget] of [
    ['ramp', globalRamp], ['interaction', globalInteraction], ['cardDraw', globalDraw],
  ] as [PhaseRoleGroup, number][]) {
    const total = result.early[roleKey] + result.mid[roleKey] + result.late[roleKey];
    if (total !== globalTarget && total > 0) {
      const largest = (['early', 'mid', 'late'] as CurvePhase[])
        .reduce((max, p) => result[p][roleKey] > result[max][roleKey] ? p : max, 'early' as CurvePhase);
      result[largest][roleKey] += globalTarget - total;
    }
  }

  return result;
}

/** Build curve phase analysis for early (0-2), mid (3-4), late (5+) game. */
export function getCurvePhases(
  curveBreakdowns: CurveBreakdown[],
  curveAnalysis: CurveSlot[],
  totalNonLand: number,
  pacing?: Pacing,
  roleTargets?: Record<string, number>,
): CurvePhaseAnalysis[] {
  const phaseDefs: { phase: CurvePhase; label: string; range: [number, number] }[] = [
    { phase: 'early', label: 'Early Game', range: [0, 2] },
    { phase: 'mid',   label: 'Mid Game',   range: [3, 4] },
    { phase: 'late',  label: 'Late Game',   range: [5, 7] },
  ];

  const multipliers = pacing ? PACING_MULTIPLIERS[pacing] : PACING_MULTIPLIERS.balanced;
  const phaseRoleTargets = roleTargets ? getPhaseRoleTargets(roleTargets, pacing ?? 'balanced') : null;

  const result = phaseDefs.map(({ phase, label, range }) => {
    const slots = curveAnalysis.filter(s => s.cmc >= range[0] && s.cmc <= range[1]);
    const buckets = curveBreakdowns.filter(b => b.cmc >= range[0] && b.cmc <= range[1]);
    const cards = buckets.flatMap(b => b.cards);
    const current = slots.reduce((s, sl) => s + sl.current, 0);
    const rawTarget = slots.reduce((s, sl) => s + sl.target, 0);
    const target = Math.round(rawTarget * multipliers[phase]);
    const pctOfDeck = totalNonLand > 0 ? Math.round((current / totalNonLand) * 100) : 0;

    // Avg CMC within phase
    const cmcSum = cards.reduce((s, ac) => s + ac.card.cmc, 0);
    const avgCmc = cards.length > 0 ? cmcSum / cards.length : 0;

    // Count roles in this phase
    let rampInPhase = 0;
    let interactionInPhase = 0;
    let cardDrawInPhase = 0;
    for (const ac of cards) {
      const role = ac.card.deckRole || getCardRole(ac.card.name);
      if (role === 'ramp') rampInPhase++;
      if (role === 'removal' || role === 'boardwipe') interactionInPhase++;
      if (role === 'cardDraw') cardDrawInPhase++;
    }

    // Per-phase role breakdowns with targets
    const prt = phaseRoleTargets?.[phase];
    const otherCount = cards.length - rampInPhase - interactionInPhase - cardDrawInPhase;
    const phaseRoleBreakdowns: PhaseRoleBreakdown[] = [
      { roleGroup: 'ramp', label: 'Ramp', current: rampInPhase, target: prt?.ramp ?? 0, deficit: Math.max(0, (prt?.ramp ?? 0) - rampInPhase) },
      { roleGroup: 'interaction', label: 'Interaction', current: interactionInPhase, target: prt?.interaction ?? 0, deficit: Math.max(0, (prt?.interaction ?? 0) - interactionInPhase) },
      { roleGroup: 'cardDraw', label: 'Card Draw', current: cardDrawInPhase, target: prt?.cardDraw ?? 0, deficit: Math.max(0, (prt?.cardDraw ?? 0) - cardDrawInPhase) },
      { roleGroup: 'other', label: 'Other', current: otherCount, target: 0, deficit: 0 },
    ];

    return {
      phase, label, cmcRange: range, current, target, cards,
      pctOfDeck, avgCmc, rampInPhase, interactionInPhase, cardDrawInPhase,
      phaseRoleBreakdowns,
      // delta and grade are set after normalization
      delta: 0, grade: { letter: 'A', message: '' } as GradeResult,
    };
  });

  // Normalize so adjusted targets sum to totalNonLand
  const totalAdjusted = result.reduce((s, p) => s + p.target, 0);
  if (totalAdjusted > 0 && totalAdjusted !== totalNonLand) {
    const scale = totalNonLand / totalAdjusted;
    for (const p of result) p.target = Math.round(p.target * scale);
    // Fix rounding drift on the largest phase
    const diff = totalNonLand - result.reduce((s, p) => s + p.target, 0);
    if (diff !== 0) {
      const largest = result.reduce((max, p) => p.target > max.target ? p : max, result[0]);
      largest.target += diff;
    }
  }

  // Compute delta and grade from normalized targets
  for (const p of result) {
    p.delta = p.current - p.target;
    const absDelta = Math.abs(p.delta);
    const deviationPct = p.target > 0 ? absDelta / p.target : (p.current > 0 ? 0.5 : 0);
    if (deviationPct <= 0.10) {
      p.grade = { letter: 'A', message: `${p.label} is right on target.` };
    } else if (deviationPct <= 0.20) {
      p.grade = { letter: 'B', message: p.delta > 0 ? `Slightly heavy on ${p.label.toLowerCase()} cards.` : `Slightly light on ${p.label.toLowerCase()} cards.` };
    } else if (deviationPct <= 0.35) {
      p.grade = { letter: 'C', message: p.delta > 0 ? `Running ${absDelta} more ${p.label.toLowerCase()} cards than average.` : `${absDelta} below target for ${p.label.toLowerCase()}.` };
    } else if (deviationPct <= 0.50) {
      p.grade = { letter: 'D', message: p.delta > 0 ? `Significantly overloaded in ${p.label.toLowerCase()}.` : `Significantly lacking ${p.label.toLowerCase()} plays.` };
    } else {
      p.grade = { letter: 'F', message: p.delta > 0 ? `Far too many ${p.label.toLowerCase()} cards.` : `Critically lacking ${p.label.toLowerCase()} plays.` };
    }
  }

  return result;
}

/**
 * Compute expected mana available per turn (1-7).
 * Uses hypergeometric model for land draws + simplified ramp deployment.
 */
export function getManaTrajectory(
  deckSize: number,
  landCount: number,
  earlyRampCount: number,
  avgRampCmc: number,
  taplandRatio: number = 0,
): ManaTrajectoryPoint[] {
  const points: ManaTrajectoryPoint[] = [];
  const landDropProbs = computeLandDropProbabilities(deckSize, landCount);

  for (let turn = 1; turn <= 7; turn++) {
    // Cards seen by this turn = 7 (opening hand) + (turn - 1) draws
    const cardsSeen = 7 + (turn - 1);

    // Expected lands in hand/play by this turn (E[X] for hypergeometric)
    // E[X] = n * K / N for hypergeometric
    const expectedLandsRaw = Math.min(cardsSeen * landCount / deckSize, turn + 2);

    // Tapland tempo penalty: the land played THIS turn has a taplandRatio chance
    // of entering tapped, costing ~taplandRatio mana this turn.
    const tapPenalty = taplandRatio;
    const effectiveLands = Math.max(0, expectedLandsRaw - tapPenalty);

    // Expected ramp mana
    let expectedRampMana = 0;
    if (earlyRampCount > 0 && turn >= 2) {
      const rampDrawn = cardsSeen * earlyRampCount / deckSize;
      const castableFrac = avgRampCmc > 0 ? Math.min(1, (turn - 1) / avgRampCmc) : 1;
      const deployedRamp = Math.min(rampDrawn * castableFrac, turn - 1);
      expectedRampMana = deployedRamp;
    }

    const totalExpectedMana = Math.round((effectiveLands + expectedRampMana) * 10) / 10;
    const ldp = landDropProbs.find(l => l.turn === turn);

    points.push({
      turn,
      expectedLandsRaw: Math.round(expectedLandsRaw * 10) / 10,
      expectedLands: Math.round(effectiveLands * 10) / 10,
      tapPenalty: Math.round(tapPenalty * 100) / 100,
      expectedRampMana: Math.round(expectedRampMana * 10) / 10,
      totalExpectedMana,
      landDropProbability: ldp?.probability ?? 0,
      // Card-based fields — enriched later in analyzeDeck()
      castableCards: 0,
      castablePct: 0,
      newUnlocks: 0,
      manaEfficiency: 0,
    });
  }

  return points;
}

/** Generate a human-readable HTML summary about the deck's health. Returns HTML with <strong> tags. */
const SUMMARY_SVGS: Record<string, string> = {
  // Sprout — matches ROLE_META.ramp
  ramp:      '<path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/>',
  // Swords — matches ROLE_META.removal
  removal:   '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>',
  // Flame — matches ROLE_META.boardwipe
  boardwipe: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  // BookOpen — matches ROLE_META.cardDraw
  cardDraw:  '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  // Mountain — matches Mana tab icon
  lands:     '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  // ChartColumn (BarChart3) — matches Tempo tab icon
  curve:     '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
};

export interface SummaryItem {
  icon: string;       // key into SUMMARY_SVGS
  label: string;      // e.g. "Removal"
  tab: string;        // e.g. "roles:removal" or "lands"
  text: string;       // e.g. "have 7, want 8"
  hint?: string;      // gameplay-impact flavor, e.g. "opponents' threats go unchecked"
}

export interface DeckSummaryData {
  gradeLetter: string;
  headline: string;
  cardCountNote: string | null;   // "2 cards short of 60-card target" or "3 cards over"
  cardCountSeverity: 'short' | 'over' | null;
  needs: SummaryItem[];
  trims: SummaryItem[];
  notes: SummaryItem[];
}

export function getDeckSummaryData(analysis: DeckAnalysis, deckExcess?: number): DeckSummaryData {
  const grades = [analysis.rolesGrade, analysis.manaGrade, analysis.curveGrade];
  const avgScore = grades.reduce((s, g) => s + (GRADE_SCORES[g.letter] ?? 0), 0) / grades.length;

  const totalCards = analysis.curveAnalysis.reduce((s, c) => s + c.current, 0);
  const weightedCmc = analysis.curveAnalysis.reduce((s, c) => s + c.cmc * c.current, 0);
  const avgCmc = totalCards > 0 ? weightedCmc / totalCards : 0;

  const totalRoles = analysis.roleDeficits.length;

  const deficits = analysis.roleDeficits.filter(rd => rd.deficit > 0).sort((a, b_) => b_.deficit - a.deficit);
  const excesses = analysis.roleDeficits.filter(rd => rd.current > rd.target + 2).sort((a, b_) => (b_.current - b_.target) - (a.current - a.target));

  const earlyDelta = analysis.curveAnalysis.filter(s => s.cmc <= 2).reduce((sum, s) => sum + s.delta, 0);
  const lateDelta = analysis.curveAnalysis.filter(s => s.cmc >= 5).reduce((sum, s) => sum + s.delta, 0);
  const curveShape = lateDelta > 3 ? 'top-heavy' : earlyDelta > 3 ? 'bottom-heavy' : null;

  const { currentLands, adjustedSuggestion, verdict } = analysis.manaBase;
  const landDelta = currentLands - adjustedSuggestion;

  const gradeLetter = letterFromScore(avgScore);

  // Card count note
  let cardCountNote: string | null = null;
  let cardCountSeverity: 'short' | 'over' | null = null;
  if (deckExcess && deckExcess > 0) {
    cardCountNote = `${deckExcess} card${deckExcess > 1 ? 's' : ''} over the ${analysis.manaBase.deckSize + 1}-card target`;
    cardCountSeverity = 'over';
  } else if (deckExcess && deckExcess < 0) {
    const shortage = Math.abs(deckExcess);
    cardCountNote = `${shortage} card${shortage > 1 ? 's' : ''} short of the ${analysis.manaBase.deckSize + 1}-card target`;
    cardCountSeverity = 'short';
  }

  // Headline — describe actual strengths & weaknesses by name
  let headline: string;

  if (deckExcess && deckExcess > 0) {
    headline = `${deckExcess} cards over target — the weakest fits are listed below.`;
  } else {
    // Identify strong roles (met or exceeded target)
    const strongRoles = analysis.roleDeficits
      .filter(rd => rd.current >= rd.target)
      .map(rd => rd.label.toLowerCase());
    // Identify weak roles (deficit > 0), sorted by worst first
    const weakRoles = deficits.map(rd => rd.label.toLowerCase());

    // Mana base descriptor
    const manaNote = verdict === 'critically-low' ? 'mana base is critically low'
      : verdict === 'low' ? 'mana base is light'
      : verdict === 'high' ? 'running extra lands'
      : null;

    // Curve descriptor
    const curveNote = curveShape === 'top-heavy' ? 'curve is top-heavy'
      : curveShape === 'bottom-heavy' ? 'curve skews low'
      : null;

    // Build the headline from parts
    const parts: string[] = [];

    if (strongRoles.length > 0 && strongRoles.length <= 3) {
      parts.push(`Strong ${strongRoles.join(' and ')}`);
    } else if (strongRoles.length === totalRoles) {
      parts.push('All roles well-covered');
    } else if (strongRoles.length > 3) {
      parts.push(`${strongRoles.length} of ${totalRoles} roles solid`);
    }

    // Collect weaknesses
    const issues: string[] = [];
    if (weakRoles.length === 1) {
      issues.push(`needs more ${weakRoles[0]}`);
    } else if (weakRoles.length === 2) {
      issues.push(`needs more ${weakRoles[0]} and ${weakRoles[1]}`);
    } else if (weakRoles.length > 2) {
      issues.push(`${weakRoles.length} roles under target`);
    }
    if (manaNote) issues.push(manaNote);
    if (curveNote) issues.push(curveNote);

    if (parts.length > 0 && issues.length > 0) {
      headline = `${parts[0]}, but ${issues[0]}.${issues.length > 1 ? ` Also ${issues.slice(1).join(', ')}.` : ''}`;
    } else if (parts.length > 0) {
      // No issues — everything looks good
      headline = `${parts[0]} with a balanced ${avgCmc.toFixed(1)} avg CMC — looking sharp.`;
    } else if (issues.length > 0) {
      headline = `${issues[0].charAt(0).toUpperCase() + issues[0].slice(1)}.${issues.length > 1 ? ` ${issues.slice(1).map(i => i.charAt(0).toUpperCase() + i.slice(1)).join('. ')}.` : ''}`;
    } else {
      headline = `Balanced build at ${avgCmc.toFixed(1)} avg CMC.`;
    }
  }

  // Build items
  const needs: SummaryItem[] = [];
  const trims: SummaryItem[] = [];
  const noteItems: SummaryItem[] = [];

  const deficitHint = (role: string) => ROLE_FLAVOR[role]?.whyItMatters;
  const excessHint = (role: string) => ROLE_FLAVOR[role]?.excessHint;

  if (deckExcess && deckExcess > 0) {
    // Over-target: show all deficits and excesses
    for (const rd of deficits) {
      needs.push({ icon: rd.role, label: rd.label, tab: `roles:${rd.role}`, text: `have ${rd.current}, want ${rd.target}`, hint: deficitHint(rd.role) });
    }
    for (const rd of excesses) {
      trims.push({ icon: rd.role, label: rd.label, tab: `roles:${rd.role}`, text: `running ${rd.current}, only need ${rd.target}`, hint: excessHint(rd.role) });
    }
    if (landDelta > 2) {
      trims.push({ icon: 'lands', label: 'Lands', tab: 'lands', text: `running ${currentLands}, only need ${adjustedSuggestion}`, hint: 'extra lands mean fewer spells to play' });
    }
  } else {
    // Normal: show all deficits + land issues
    for (const rd of deficits) {
      needs.push({ icon: rd.role, label: rd.label, tab: `roles:${rd.role}`, text: `have ${rd.current}, want ${rd.target}`, hint: deficitHint(rd.role) });
    }
    if (verdict === 'low' || verdict === 'critically-low') {
      needs.push({ icon: 'lands', label: 'Lands', tab: 'lands', text: `have ${currentLands}, want ${adjustedSuggestion}`, hint: 'you\'ll miss land drops and fall behind on tempo' });
    }
    for (const rd of excesses) {
      trims.push({ icon: rd.role, label: rd.label, tab: `roles:${rd.role}`, text: `running ${rd.current}, only need ${rd.target}`, hint: excessHint(rd.role) });
    }
    if (verdict === 'high') {
      trims.push({ icon: 'lands', label: 'Lands', tab: 'lands', text: `running ${currentLands}, only need ${adjustedSuggestion}`, hint: 'extra lands mean fewer spells to play' });
    }
  }

  if (curveShape === 'top-heavy') {
    noteItems.push({ icon: 'curve', label: 'Tempo', tab: 'curve', text: `avg CMC is ${avgCmc.toFixed(1)} — too many expensive spells`, hint: 'you\'ll be sitting on uncastable hands while opponents develop their boards' });
  } else if (curveShape === 'bottom-heavy') {
    noteItems.push({ icon: 'curve', label: 'Tempo', tab: 'curve', text: `avg CMC is ${avgCmc.toFixed(1)} — skews very low`, hint: 'you\'ll run out of gas in the late game when opponents play their haymakers' });
  }

  return { gradeLetter, headline, cardCountNote, cardCountSeverity, needs, trims, notes: noteItems };
}

/** SVG markup for a summary icon */
export function summaryIconSvg(key: string): string {
  const svg = SUMMARY_SVGS[key];
  if (!svg) return '';
  return `<svg class="inline-block w-3.5 h-3.5 mr-0.5 -mt-px opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>`;
}

// ─── Smart Suggestion Scoring ────────────────────────────────────────

export const ROLE_SUBTYPES: Record<string, string[]> = {
  ramp: ['mana-producer', 'mana-rock', 'cost-reducer', 'ramp'],
  removal: ['counterspell', 'bounce', 'spot-removal', 'removal'],
  boardwipe: ['bounce-wipe', 'boardwipe'],
  cardDraw: ['tutor', 'wheel', 'cantrip', 'card-draw', 'card-advantage'],
};

export interface ScoringContext {
  roleDeficits: RoleDeficit[];
  curveAnalysis: CurveSlot[];
  typeAnalysis: TypeSlot[];
  currentSubtypeCounts: Record<string, number>;
}

/**
 * Unified recommendation scoring — mirrors the deck generator's multi-factor
 * approach (calculateCardPriority + computeRoleBoosts + curve awareness).
 */
export function scoreRecommendation(
  card: EDHRECCard,
  cardRole: RoleKey | null,
  cardSubtype: string | null,
  context: ScoringContext,
): number {
  const synergy = card.synergy ?? 0;
  const inclusion = card.inclusion;

  // ── Component 1: Base Priority (ports calculateCardPriority) ──
  let basePriority: number;
  if (card.isThemeSynergyCard) {
    basePriority = 100 + (synergy * 50) + inclusion;
  } else if (synergy > 0.3) {
    const newCardBoost = card.isNewCard ? 25 : 0;
    basePriority = (synergy * 100) + inclusion + newCardBoost;
  } else {
    const newCardBoost = card.isNewCard ? 25 : 0;
    basePriority = inclusion + newCardBoost;
  }

  // ── Component 2: Role Deficit Boost (ports computeRoleBoosts) ──
  let roleBoost = 0;
  if (cardRole) {
    const rd = context.roleDeficits.find(r => r.role === cardRole);
    if (rd && rd.deficit > 0 && rd.target > 0) {
      roleBoost = (rd.deficit / rd.target) * 75;

      // Early ramp CMC multiplier
      if (cardRole === 'ramp' && card.cmc !== undefined) {
        if (card.cmc <= 1) roleBoost *= 2.0;
        else if (card.cmc <= 2) roleBoost *= 1.5;
        else if (card.cmc <= 3) roleBoost *= 1.2;
      }

      // Subtype diversity multiplier
      if (cardSubtype && context.currentSubtypeCounts) {
        const subtypeCount = context.currentSubtypeCounts[cardSubtype] ?? 0;
        const roleSubtypes = ROLE_SUBTYPES[cardRole] || [];
        if (roleSubtypes.length > 0) {
          const total = roleSubtypes.reduce((s, st) => s + (context.currentSubtypeCounts[st] ?? 0), 0);
          const avg = total / roleSubtypes.length;
          const excess = subtypeCount - avg;
          if (excess > 1) {
            roleBoost *= Math.max(0.4, 1.0 - (excess - 1) * 0.1);
          } else if (subtypeCount === 0) {
            roleBoost *= 1.25;
          }
        }
      }
    }
  }

  // ── Component 3: Curve Fit Bonus/Penalty ──
  let curveBonus = 0;
  if (card.cmc !== undefined) {
    const cmc = Math.min(Math.floor(card.cmc), 7);
    const slot = context.curveAnalysis.find(s => s.cmc === cmc);
    if (slot) {
      if (slot.delta < 0) {
        curveBonus = Math.min(20, Math.abs(slot.delta) * 7);
      } else if (slot.delta > 1) {
        curveBonus = -Math.min(15, (slot.delta - 1) * 5);
      }
    }
  }

  // ── Component 4: Type Balance Bonus/Penalty ──
  let typeBonus = 0;
  if (card.primary_type && card.primary_type !== 'Land' && card.primary_type !== 'Unknown') {
    const typeLower = card.primary_type.toLowerCase();
    const typeSlot = context.typeAnalysis.find(t => t.type === typeLower);
    if (typeSlot) {
      if (typeSlot.delta < 0) {
        typeBonus = Math.min(10, Math.abs(typeSlot.delta) * 3);
      } else if (typeSlot.delta > 2) {
        typeBonus = -Math.min(8, (typeSlot.delta - 2) * 2);
      }
    }
  }

  return basePriority + roleBoost + curveBonus + typeBonus;
}

/**
 * Analyze a deck against EDHREC data.
 * Returns deficits, curve/type analysis, mana base insights, and card recommendations.
 */
export function analyzeDeck(
  edhrecData: EDHRECCommanderData,
  currentCards: ScryfallCard[],
  roleCounts: Record<string, number>,
  roleTargets: Record<string, number>,
  deckSize: number,
  cardInclusionMap?: Record<string, number>,
  colorIdentity?: string[],
  overridePacing?: Pacing,
): DeckAnalysis {
  // --- Role Deficits ---
  const roleDeficits: RoleDeficit[] = Object.entries(roleTargets).map(([role, target]) => {
    const current = roleCounts[role] || 0;
    return {
      role,
      label: ROLE_LABELS[role] || role,
      current,
      target,
      deficit: Math.max(0, target - current),
    };
  });

  // --- Mana Curve ---
  const nonLandCards = currentCards.filter(
    c => !getFrontFaceTypeLine(c).toLowerCase().includes('land')
  );
  const totalNonLand = nonLandCards.length;

  // Current curve
  const currentCurve: Record<number, number> = {};
  for (const card of nonLandCards) {
    const cmc = Math.min(Math.floor(card.cmc), 7);
    currentCurve[cmc] = (currentCurve[cmc] || 0) + 1;
  }

  // Target curve from EDHREC
  const edhrecCurvePercentages = calculateCurvePercentages(edhrecData.stats.manaCurve);
  const allCmcKeys = new Set([
    ...Object.keys(currentCurve).map(Number),
    ...Object.keys(edhrecCurvePercentages).map(Number),
  ]);

  const curveAnalysis: CurveSlot[] = [...allCmcKeys].sort((a, b) => a - b).map(cmc => {
    const current = currentCurve[cmc] || 0;
    const targetPct = edhrecCurvePercentages[cmc] || 0;
    const target = Math.round((targetPct / 100) * totalNonLand);
    return { cmc, current, target, delta: current - target };
  });

  // --- Mana Base (with smart land assessment) ---
  const landCards = currentCards.filter(
    c => getFrontFaceTypeLine(c).toLowerCase().includes('land') || isMdfcLand(c)
  );
  const currentLands = landCards.length;
  // EDHREC data is for 99-card Commander — scale to actual deck size
  const rawEdhrecLands = edhrecData.stats.landDistribution.total || 37;
  const edhrecLands = deckSize >= 99
    ? rawEdhrecLands
    : Math.round(rawEdhrecLands * (deckSize / 99));
  const landScale = deckSize >= 99 ? 1 : deckSize / 99;
  const currentBasic = landCards.filter(c => {
    const tl = getFrontFaceTypeLine(c).toLowerCase();
    return /\bbasic\b/.test(tl);
  }).length;
  const currentNonbasic = currentLands - currentBasic;

  // Count mana production to decide if running fewer lands is justified
  const rampCount = roleCounts['ramp'] || 0;
  let manaProducerCount = 0;
  for (const card of currentCards) {
    if (card.rampSubtype === 'mana-producer' || card.rampSubtype === 'mana-rock') {
      manaProducerCount++;
    }
  }

  // Adjust land suggestion: nudge UP by 1-2 unless ramp is strong
  // Thresholds scale with deck size (baseline: 99-card Commander)
  const ratio = deckSize / 99;
  const hasStrongRamp = rampCount >= Math.round(10 * ratio) && manaProducerCount >= Math.round(6 * ratio);
  const hasDecentRamp = rampCount >= Math.round(7 * ratio) && manaProducerCount >= Math.round(4 * ratio);
  let adjustedSuggestion: number;
  if (hasStrongRamp) {
    // Strong mana base justifies running at or slightly below EDHREC avg
    adjustedSuggestion = edhrecLands;
  } else if (hasDecentRamp) {
    // Decent ramp — nudge up by 1
    adjustedSuggestion = edhrecLands + 1;
  } else {
    // Weak ramp — push lands up by 2
    adjustedSuggestion = edhrecLands + 2;
  }
  // Pacing-based land nudge: faster decks can run leaner, slower need more consistency
  if (overridePacing === 'aggressive-early' || overridePacing === 'fast-tempo') {
    adjustedSuggestion -= 1;
  } else if (overridePacing === 'late-game') {
    adjustedSuggestion += 1;
  }

  // Hard floor: never suggest below 33% of deck
  const landFloor = Math.round(deckSize * 0.33);
  adjustedSuggestion = Math.max(adjustedSuggestion, landFloor);

  // Verdict
  const landDelta = currentLands - adjustedSuggestion;
  let verdict: LandVerdict;
  let verdictMessage: string;
  if (currentLands < landFloor - 3) {
    verdict = 'critically-low';
    verdictMessage = `Running ${currentLands} lands is dangerously low. You're likely to miss land drops and fall behind. Consider adding ${adjustedSuggestion - currentLands}+ lands.`;
  } else if (landDelta <= -3) {
    verdict = 'low';
    verdictMessage = hasDecentRamp
      ? `${currentLands} lands is ${Math.abs(landDelta)} below suggested (${adjustedSuggestion}). Your ${rampCount} ramp pieces help, but you may still stumble on mana.`
      : `${currentLands} lands is risky with only ${rampCount} ramp cards. Consider adding ${Math.abs(landDelta)} lands.`;
  } else if (landDelta < 0) {
    verdict = 'slightly-low';
    verdictMessage = hasStrongRamp
      ? `${currentLands} lands with ${rampCount} ramp pieces (${manaProducerCount} producers) — your mana base can support this.`
      : `${currentLands} lands is a touch light. Adding ${Math.abs(landDelta)} more would improve consistency.`;
  } else if (landDelta > 3) {
    verdict = 'high';
    verdictMessage = `${currentLands} lands is ${landDelta} above the suggestion (${adjustedSuggestion}). You could cut a few for more spells.`;
  } else {
    verdict = 'ok';
    verdictMessage = hasStrongRamp
      ? `${currentLands} lands with ${rampCount} ramp pieces — solid mana base.`
      : `${currentLands} lands looks good for this deck.`;
  }

  // Count taplands for tempo analysis
  let taplandCount = 0;
  for (const card of landCards) {
    if (isTapland(card.name)) taplandCount++;
  }
  const taplandRatio = currentLands > 0 ? taplandCount / currentLands : 0;

  // Starting hand probabilities (7-card hand)
  const probLand0 = hypergeoPmf(deckSize, currentLands, 7, 0);
  const probLand1 = hypergeoPmf(deckSize, currentLands, 7, 1);
  const probLand2to3 = hypergeoPmf(deckSize, currentLands, 7, 2) + hypergeoPmf(deckSize, currentLands, 7, 3);
  const probLand4plus = 1 - (probLand0 + probLand1 + probLand2to3);

  const manaBase: ManaBaseAnalysis = {
    currentLands,
    suggestedLands: edhrecLands,
    adjustedSuggestion,
    currentBasic,
    currentNonbasic,
    suggestedBasic: Math.round((edhrecData.stats.landDistribution.basic || 0) * landScale),
    suggestedNonbasic: Math.round((edhrecData.stats.landDistribution.nonbasic || 0) * landScale),
    rampCount,
    manaProducerCount,
    verdict,
    verdictMessage,
    probLand0,
    probLand1,
    probLand2to3,
    probLand4plus,
    deckSize,
    taplandCount,
    taplandRatio,
  };

  // --- Type Distribution ---
  const currentTypes: Record<string, number> = {};
  for (const card of nonLandCards) {
    const tl = getFrontFaceTypeLine(card).toLowerCase();
    if (tl.includes('creature')) currentTypes['creature'] = (currentTypes['creature'] || 0) + 1;
    else if (tl.includes('instant')) currentTypes['instant'] = (currentTypes['instant'] || 0) + 1;
    else if (tl.includes('sorcery')) currentTypes['sorcery'] = (currentTypes['sorcery'] || 0) + 1;
    else if (tl.includes('artifact')) currentTypes['artifact'] = (currentTypes['artifact'] || 0) + 1;
    else if (tl.includes('enchantment')) currentTypes['enchantment'] = (currentTypes['enchantment'] || 0) + 1;
    else if (tl.includes('planeswalker')) currentTypes['planeswalker'] = (currentTypes['planeswalker'] || 0) + 1;
    else if (tl.includes('battle')) currentTypes['battle'] = (currentTypes['battle'] || 0) + 1;
  }

  const edhrecTotalNonLand = Object.entries(edhrecData.stats.typeDistribution)
    .filter(([k]) => k !== 'land')
    .reduce((sum, [, v]) => sum + v, 0);

  const typeAnalysis: TypeSlot[] = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker']
    .map(type => {
      const current = currentTypes[type] || 0;
      const edhrecPct = edhrecTotalNonLand > 0
        ? (edhrecData.stats.typeDistribution[type as keyof typeof edhrecData.stats.typeDistribution] || 0) / edhrecTotalNonLand
        : 0;
      const target = Math.round(edhrecPct * totalNonLand);
      return { type, current, target, delta: current - target };
    })
    .filter(t => t.target > 0 || t.current > 0);

  // --- Scoring Context (for smart recommendation scoring) ---
  const currentSubtypeCounts: Record<string, number> = {};
  for (const card of currentCards) {
    const subtype = card.rampSubtype || card.removalSubtype || card.boardwipeSubtype || card.cardDrawSubtype;
    if (subtype) {
      currentSubtypeCounts[subtype] = (currentSubtypeCounts[subtype] ?? 0) + 1;
    } else {
      const st = getCardSubtype(card.name);
      if (st) currentSubtypeCounts[st] = (currentSubtypeCounts[st] ?? 0) + 1;
    }
  }

  const scoringContext: ScoringContext = {
    roleDeficits,
    curveAnalysis,
    typeAnalysis,
    currentSubtypeCounts,
  };

  // --- Recommendations ---
  // Include both full name ("A // B") and front face name ("A") so DFCs are matched
  const currentCardNames = new Set(currentCards.flatMap(c => {
    const names = [c.name];
    if (c.name.includes(' // ')) names.push(c.name.split(' // ')[0]);
    if (c.card_faces?.[0]?.name && c.card_faces[0].name !== c.name) names.push(c.card_faces[0].name);
    return names;
  }));
  const deficitRoles = new Set(roleDeficits.filter(d => d.deficit > 0).map(d => d.role));

  const BASIC_LANDS = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes']);
  const candidateMap = new Map<string, { card: EDHRECCard; source: 'nonland' | 'land' }>();

  for (const card of edhrecData.cardlists.allNonLand) {
    if (!currentCardNames.has(card.name)) {
      candidateMap.set(card.name, { card, source: 'nonland' });
    }
  }
  for (const card of edhrecData.cardlists.lands) {
    if (!currentCardNames.has(card.name) && !candidateMap.has(card.name) && !BASIC_LANDS.has(card.name)) {
      candidateMap.set(card.name, { card, source: 'land' });
    }
  }

  // Pre-compute scores for all candidates (reused by general, role, and land recommendations)
  const candidateScoreCache = new Map<string, { score: number; role: RoleKey | null; subtype: string | null }>();
  for (const [name, { card }] of candidateMap) {
    const role = getCardRole(name);
    const subtype = role ? getCardSubtype(name) : null;
    candidateScoreCache.set(name, { score: scoreRecommendation(card, role, subtype, scoringContext), role, subtype });
  }

  // Pre-compute scores for in-deck cards (for cut recommendations)
  // Combines EDHREC commander-specific inclusion/synergy with Scryfall global edhrec_rank
  const inDeckScoreMap = new Map<string, number>();
  const edhrecCardLookup = new Map<string, EDHRECCard>();
  for (const card of edhrecData.cardlists.allNonLand) edhrecCardLookup.set(card.name, card);
  for (const card of edhrecData.cardlists.lands) if (!edhrecCardLookup.has(card.name)) edhrecCardLookup.set(card.name, card);
  for (const card of currentCards) {
    const edhrecCard = edhrecCardLookup.get(card.name);
    const inclusion = edhrecCard?.inclusion ?? cardInclusionMap?.[card.name] ?? 0;
    const synergy = edhrecCard?.synergy ?? 0;
    // edhrec_rank: lower = more popular globally. Convert to 0-100 scale (100 = most popular)
    const rankScore = card.edhrec_rank != null
      ? Math.max(0, 100 - Math.floor(card.edhrec_rank / 100))
      : 50; // neutral default if no rank
    // Composite: 50% commander-specific inclusion, 25% global rank, 25% synergy-boosted inclusion
    const synergyBoost = Math.max(0, synergy) * 50;
    const role = getCardRole(card.name);
    // Role deficit boost (same logic as scoreRecommendation)
    let roleBoost = 0;
    if (role) {
      const rd = roleDeficits.find(r => r.role === role);
      if (rd && rd.deficit > 0 && rd.target > 0) {
        roleBoost = (rd.deficit / rd.target) * 75;
        if (role === 'ramp' && card.cmc !== undefined) {
          if (card.cmc <= 1) roleBoost *= 2.0;
          else if (card.cmc <= 2) roleBoost *= 1.5;
          else if (card.cmc <= 3) roleBoost *= 1.2;
        }
      }
    }
    const score = (inclusion * 0.5) + (rankScore * 0.25) + (synergyBoost * 0.25) + roleBoost;
    inDeckScoreMap.set(card.name, score);
  }

  const recommendations: RecommendedCard[] = [...candidateMap.values()].map(({ card }) => {
    const cached = candidateScoreCache.get(card.name);
    const role = cached?.role ?? getCardRole(card.name);
    const allRoles = getAllCardRoles(card.name);
    const fillsDeficit = role ? deficitRoles.has(role) : false;

    const price = card.prices?.tcgplayer?.price
      ? card.prices.tcgplayer.price.toFixed(2)
      : card.prices?.cardkingdom?.price
        ? card.prices.cardkingdom.price.toFixed(2)
        : undefined;

    return {
      name: card.name,
      inclusion: card.inclusion,
      synergy: card.synergy || 0,
      role: role || undefined,
      roleLabel: role ? ROLE_LABELS[role] : undefined,
      allRoles: allRoles.length > 0 ? allRoles : undefined,
      allRoleLabels: allRoles.length > 0 ? allRoles.map(r => ROLE_LABELS[r] || r) : undefined,
      fillsDeficit,
      primaryType: card.primary_type,
      imageUrl: card.image_uris?.[0]?.normal,
      price,
      isThemeSynergy: card.isThemeSynergyCard || undefined,
      score: cached?.score ?? 0,
      cmc: card.cmc,
      isUtilityLand: isUtilityLand(card.name) || undefined,
      isTapland: isTapland(card.name) || undefined,
    };
  })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 30);

  // --- Per-Card Breakdowns ---
  const incMap = cardInclusionMap || {};

  const SUBTYPE_LABELS: Record<string, string> = {
    'mana-producer': 'Mana Dork',
    'mana-rock': 'Mana Rock',
    'cost-reducer': 'Cost Reducer',
    'ramp': 'Ramp',
    'counterspell': 'Counter',
    'bounce': 'Bounce',
    'spot-removal': 'Spot Removal',
    'removal': 'Removal',
    'bounce-wipe': 'Bounce Wipe',
    'boardwipe': 'Board Wipe',
    'tutor': 'Tutor',
    'wheel': 'Wheel',
    'cantrip': 'Cantrip',
    'card-draw': 'Card Draw',
    'card-advantage': 'Card Advantage',
  };

  function makeAnalyzedCard(card: ScryfallCard, targetRole?: string): AnalyzedCard {
    let subtype: string | undefined;
    switch (targetRole) {
      case 'cardDraw':  subtype = card.cardDrawSubtype  || card.rampSubtype || card.removalSubtype || card.boardwipeSubtype; break;
      case 'removal':   subtype = card.removalSubtype   || card.boardwipeSubtype || card.rampSubtype || card.cardDrawSubtype; break;
      case 'boardwipe': subtype = card.boardwipeSubtype || card.removalSubtype  || card.rampSubtype || card.cardDrawSubtype; break;
      case 'ramp':      subtype = card.rampSubtype      || card.cardDrawSubtype || card.removalSubtype || card.boardwipeSubtype; break;
      default:          subtype = card.rampSubtype || card.removalSubtype || card.boardwipeSubtype || card.cardDrawSubtype; break;
    }
    return {
      card,
      inclusion: incMap[card.name] ?? null,
      score: inDeckScoreMap.get(card.name),
      role: card.deckRole || undefined,
      roleLabel: card.deckRole ? ROLE_LABELS[card.deckRole] : undefined,
      subtype: subtype || undefined,
      subtypeLabel: subtype ? SUBTYPE_LABELS[subtype] || subtype : undefined,
    };
  }

  const sortByInclusion = (a: AnalyzedCard, b: AnalyzedCard) =>
    (b.inclusion ?? -1) - (a.inclusion ?? -1);

  // Role breakdowns — source from full candidate pool so every role gets suggestions
  // Build RecommendedCard objects for all candidates that fill at least one role
  const roleCandidates: RecommendedCard[] = [];
  const candidateRolesMap = new Map<string, RoleKey[]>();
  for (const [name, { card }] of candidateMap) {
    const allRoles = getAllCardRoles(name);
    if (allRoles.length === 0) continue;
    candidateRolesMap.set(name, allRoles);
    const role = getCardRole(name);
    const price = card.prices?.tcgplayer?.price
      ? card.prices.tcgplayer.price.toFixed(2)
      : card.prices?.cardkingdom?.price
        ? card.prices.cardkingdom.price.toFixed(2)
        : undefined;
    const cached = candidateScoreCache.get(name);
    roleCandidates.push({
      name,
      inclusion: card.inclusion,
      synergy: card.synergy || 0,
      role: role || undefined,
      roleLabel: role ? ROLE_LABELS[role] : undefined,
      allRoles: allRoles.length > 0 ? allRoles : undefined,
      allRoleLabels: allRoles.length > 0 ? allRoles.map(r => ROLE_LABELS[r] || r) : undefined,
      fillsDeficit: role ? deficitRoles.has(role) : false,
      primaryType: card.primary_type,
      imageUrl: card.image_uris?.[0]?.normal,
      price,
      score: cached?.score ?? 0,
      cmc: card.cmc,
      isUtilityLand: isUtilityLand(name) || undefined,
      isTapland: isTapland(name) || undefined,
    });
  }

  const roleBreakdowns: RoleBreakdown[] = Object.entries(roleTargets).map(([role, target]) => {
    const current = roleCounts[role] || 0;
    const deficit = Math.max(0, target - current);
    const roleCards = currentCards
      .filter(c => c.deckRole === role || cardMatchesRole(c.name, role as RoleKey))
      .map(c => makeAnalyzedCard(c, role))
      .sort(sortByInclusion);

    // Gather candidates that match this role, sorted by composite score
    const seen = new Set<string>();
    const suggestedReplacements: RecommendedCard[] = [];
    const matching = roleCandidates
      .filter(rec => (candidateRolesMap.get(rec.name) || []).includes(role as RoleKey))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    for (const rec of matching) {
      if (!seen.has(rec.name)) {
        seen.add(rec.name);
        suggestedReplacements.push(rec);
      }
    }

    return {
      role,
      label: ROLE_LABELS[role] || role,
      current,
      target,
      deficit,
      cards: roleCards,
      suggestedReplacements,
    };
  });

  // Curve breakdowns
  const curveBreakdowns: CurveBreakdown[] = curveAnalysis.map(slot => {
    const cards = nonLandCards
      .filter(c => Math.min(Math.floor(c.cmc), 7) === slot.cmc)
      .map(c => makeAnalyzedCard(c))
      .sort(sortByInclusion);
    return { ...slot, cards };
  });

  // Land cards
  const analyzedLandCards: AnalyzedCard[] = landCards
    .map(c => makeAnalyzedCard(c))
    .sort(sortByInclusion);

  // Ramp cards
  const rampCards: AnalyzedCard[] = currentCards
    .filter(c => c.deckRole === 'ramp' || cardMatchesRole(c.name, 'ramp'))
    .map(c => makeAnalyzedCard(c, 'ramp'))
    .sort(sortByInclusion);

  // Mana sources analysis
  const msProducers = rampCards.filter(ac => ac.card.rampSubtype === 'mana-producer' || ac.card.rampSubtype === 'mana-rock').length;
  const msReducers = rampCards.filter(ac => ac.card.rampSubtype === 'cost-reducer').length;
  const msOther = rampCards.length - msProducers - msReducers;
  const msEarly = rampCards.filter(ac => ac.card.cmc <= 2).length;
  const msAvgCmc = rampCards.length > 0
    ? rampCards.reduce((sum, ac) => sum + ac.card.cmc, 0) / rampCards.length
    : 0;
  const msTotal = rampCards.length;

  // Scale grading thresholds by deck size (base targets are for 100-card decks)
  const scale = deckSize / 100;
  const threshA = { ramp: Math.round(10 * scale), early: Math.round(5 * scale), producers: Math.round(6 * scale) };
  const threshB = { ramp: Math.round(8 * scale), early: Math.round(3 * scale), producers: Math.round(4 * scale) };
  const threshC = Math.round(6 * scale);
  const threshD = Math.round(4 * scale);

  let msGrade: ManaSourcesAnalysis['grade'];
  let msMessage: string;
  if (msTotal >= threshA.ramp && msEarly >= threshA.early && msProducers >= threshA.producers) {
    msGrade = 'A';
    msMessage = `${msTotal} ramp with ${msEarly} early pieces — fast and reliable.`;
  } else if (msTotal >= threshB.ramp && msEarly >= threshB.early && msProducers >= threshB.producers) {
    msGrade = 'B';
    msMessage = `${msTotal} ramp with ${msProducers} producers — solid acceleration.`;
  } else if (msTotal >= threshC) {
    msGrade = 'C';
    msMessage = msEarly < threshB.early
      ? `${msTotal} ramp but only ${msEarly} early pieces — slow to accelerate.`
      : `${msTotal} ramp is decent. A couple more would smooth things out.`;
  } else if (msTotal >= threshD) {
    msGrade = 'D';
    msMessage = `Only ${msTotal} ramp cards — this deck will fall behind.`;
  } else {
    msGrade = 'F';
    msMessage = msTotal === 0
      ? 'No ramp cards. This deck has no acceleration.'
      : `Only ${msTotal} ramp card${msTotal > 1 ? 's' : ''}. This deck will struggle to keep pace.`;
  }

  const manaSources: ManaSourcesAnalysis = {
    totalRamp: msTotal,
    producers: msProducers,
    reducers: msReducers,
    otherRamp: msOther,
    avgRampCmc: msAvgCmc,
    earlyRamp: msEarly,
    grade: msGrade,
    message: msMessage,
  };

  // --- Color Source & Pip Demand (before land recs for scoring) ---
  const ci = colorIdentity || [];
  const sourcesPerColor: Record<string, number> = {};
  for (const color of ci) sourcesPerColor[color] = 0;

  const fixingLands: AnalyzedCard[] = [];
  const colorlessOnly: AnalyzedCard[] = [];
  const utilityLands: AnalyzedCard[] = [];
  const taplands: AnalyzedCard[] = [];

  for (const card of landCards) {
    const produced = getLandProducedColors(card);
    const matchedColors = produced.filter(c => ci.includes(c));
    for (const color of matchedColors) {
      sourcesPerColor[color] = (sourcesPerColor[color] || 0) + 1;
    }
    const ac = makeAnalyzedCard(card);
    if (isUtilityLand(card.name)) {
      utilityLands.push(ac);
      card.isUtilityLand = true;
    }
    if (isTapland(card.name)) {
      taplands.push(ac);
      card.isTapland = true;
    }
    if (matchedColors.length >= 2) {
      fixingLands.push(ac);
    } else if (matchedColors.length === 0) {
      colorlessOnly.push(ac);
    }
  }

  // Also count mana producers (dorks/rocks) as color sources
  for (const card of currentCards) {
    if (card.rampSubtype !== 'mana-producer' && card.rampSubtype !== 'mana-rock') continue;
    const produced = card.produced_mana || [];
    for (const mana of produced) {
      if (ci.includes(mana)) {
        sourcesPerColor[mana] = (sourcesPerColor[mana] || 0) + 1;
      }
    }
  }

  // Collect non-land ramp producers — split into true mana fixers vs other ramp
  const allNonLandRamp: AnalyzedCard[] = currentCards
    .filter(c => {
      const tl = getFrontFaceTypeLine(c).toLowerCase();
      if (tl.includes('land')) return false;
      return c.rampSubtype === 'mana-producer' || c.rampSubtype === 'mana-rock' || c.rampSubtype === 'cost-reducer'
        || hasTag(c.name, 'mana-dork') || hasTag(c.name, 'mana-rock') || hasTag(c.name, 'cost-reducer');
    })
    .map(c => makeAnalyzedCard(c, 'ramp'))
    .sort(sortByInclusion);
  const manaFixCards = allNonLandRamp.filter(ac => hasTag(ac.card.name, 'mana-fix'));
  const nonFixRampCards = allNonLandRamp.filter(ac => !hasTag(ac.card.name, 'mana-fix'));

  // --- Pip Demand Analysis ---
  const pipDemand: Record<string, number> = {};
  const symbolPattern = /\{([^}]+)\}/g;
  const colorLetters = new Set(['W', 'U', 'B', 'R', 'G']);
  for (const card of nonLandCards) {
    const costs: string[] = [];
    if (card.mana_cost) costs.push(card.mana_cost);
    if (card.card_faces) {
      for (const face of card.card_faces) {
        if (face.mana_cost) costs.push(face.mana_cost);
      }
    }
    for (const cost of costs) {
      let match;
      while ((match = symbolPattern.exec(cost)) !== null) {
        for (const char of match[1]) {
          if (colorLetters.has(char)) {
            pipDemand[char] = (pipDemand[char] || 0) + 1;
          }
        }
      }
    }
  }
  const pipDemandTotal = Object.values(pipDemand).reduce((s, v) => s + v, 0);

  // Demand vs supply ratios
  const totalSources = Object.values(sourcesPerColor).reduce((s, v) => s + v, 0);
  const demandVsSupplyRatio: Record<string, number> = {};
  let weakestColor: string | null = null;
  let maxImbalance = 0;
  for (const color of ci) {
    const demandPct = pipDemandTotal > 0 ? (pipDemand[color] || 0) / pipDemandTotal : 0;
    const supplyPct = totalSources > 0 ? (sourcesPerColor[color] || 0) / totalSources : 0;
    const ratio = demandPct - supplyPct;
    demandVsSupplyRatio[color] = ratio;
    if (ratio > maxImbalance) {
      maxImbalance = ratio;
      weakestColor = color;
    }
  }

  // Land recommendations from EDHREC (scored with color fixing bonus)
  const landRecommendations: RecommendedCard[] = edhrecData.cardlists.lands
    .filter(c => !currentCardNames.has(c.name) && !BASIC_LANDS.has(c.name))
    .map(card => {
      const role = getCardRole(card.name);
      const price = card.prices?.tcgplayer?.price
        ? card.prices.tcgplayer.price.toFixed(2)
        : card.prices?.cardkingdom?.price
          ? card.prices.cardkingdom.price.toFixed(2)
          : undefined;
      // Base score from cache (or compute fresh for land-only cards not in candidateMap)
      const cached = candidateScoreCache.get(card.name);
      let landScore = cached?.score ?? scoreRecommendation(card, role, null, scoringContext);
      // Color fixing bonus: boost lands that serve underserved colors
      if (ci.length >= 2) {
        const cardColors = getRecommendationColors(card.name, card.color_identity);
        const relevantColors = cardColors.filter(c => ci.includes(c));
        const fixingBonus = relevantColors.reduce((s, c) => s + (demandVsSupplyRatio[c] || 0) * 30, 0);
        landScore += fixingBonus;
        // Multi-color bonus
        if (relevantColors.length >= 3) landScore += 10;
        else if (relevantColors.length >= 2) landScore += 5;
      }
      return {
        name: card.name,
        inclusion: card.inclusion,
        synergy: card.synergy || 0,
        role: role || undefined,
        roleLabel: role ? ROLE_LABELS[role] : undefined,
        fillsDeficit: false,
        primaryType: card.primary_type,
        imageUrl: card.image_uris?.[0]?.normal,
        price,
        producedColors: getRecommendationColors(card.name, card.color_identity),
        isThemeSynergy: card.isThemeSynergyCard || undefined,
        score: landScore,
        isUtilityLand: isUtilityLand(card.name) || undefined,
        isTapland: isTapland(card.name) || undefined,
      };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 15);

  // Any-color land count
  let anyColorLandCount = 0;
  for (const card of landCards) {
    const oracle = (card.oracle_text || '').toLowerCase();
    if (oracle.includes('any color') || oracle.includes('any type')) {
      anyColorLandCount++;
    }
  }

  // --- Fixing Score (0-100 composite) ---
  // Three components:
  //   1. Coverage alignment (50%) — are sources distributed proportionally to pip demand?
  //   2. Worst-color penalty (25%) — is any single color critically underserved?
  //   3. Absolute adequacy (25%) — does every color meet a minimum source count?
  let fixingScore: number;
  let fixingGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  let fixingGradeMessage: string;
  const numColors = ci.length;

  if (numColors <= 1) {
    fixingScore = 100;
  } else {
    // Per-color coverage: actual sources vs expected (based on pip demand proportion)
    const coverages: { color: string; coverage: number; pips: number; sources: number }[] = [];
    for (const color of ci) {
      const pips = pipDemand[color] || 0;
      const sources = sourcesPerColor[color] || 0;
      // Expected = totalSources * demandPct, floored at 3 so splash colors aren't trivially "covered"
      const expectedFromDemand = pipDemandTotal > 0
        ? totalSources * (pips / pipDemandTotal)
        : totalSources / numColors;
      const expected = Math.max(expectedFromDemand, 3);
      // Cap at 1.3 so oversupplying one color can't fully mask another's deficit
      const coverage = expected > 0 ? Math.min(sources / expected, 1.3) : 1.0;
      coverages.push({ color, coverage, pips, sources });
    }

    // 1. Weighted average coverage (weighted by pip demand — heavier colors matter more)
    const totalPipWeight = coverages.reduce((s, c) => s + Math.max(c.pips, 1), 0);
    const weightedCoverage = coverages.reduce((s, c) => s + c.coverage * Math.max(c.pips, 1), 0) / totalPipWeight;
    const normalizedCoverage = Math.min(weightedCoverage / 1.3, 1.0); // normalize to 0-1

    // 2. Worst-color penalty: linear penalty if any color is below 60% coverage
    const worstCoverage = Math.min(...coverages.map(c => c.coverage));
    const worstPenalty = worstCoverage >= 0.6 ? 1.0 : worstCoverage / 0.6;

    // 3. Absolute adequacy: minimum sources across all colors vs a target
    //    Target scales with color count (5-color decks can get by with fewer per color thanks to 5c lands)
    const minSources = Math.min(...coverages.map(c => c.sources));
    const adequacyTarget = numColors >= 4 ? 5 : numColors >= 3 ? 6 : 8;
    const adequacy = Math.min(minSources / adequacyTarget, 1.0);

    // Composite: 50% alignment + 25% worst-color + 25% absolute adequacy
    fixingScore = (normalizedCoverage * 50 + worstPenalty * 25 + adequacy * 25);
    fixingScore = Math.max(0, Math.min(100, Math.round(fixingScore)));
  }

  // Map score to grade + generate contextual message explaining why
  const colorName = (c: string) => ({ W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' }[c] || c);
  const minSourceCount = ci.length > 0 ? Math.min(...ci.map(c => sourcesPerColor[c] || 0)) : 0;
  const weakColorName = weakestColor ? colorName(weakestColor) : null;
  const weakColorSources = weakestColor ? (sourcesPerColor[weakestColor] || 0) : 0;

  if (fixingScore >= 85) {
    fixingGrade = 'A';
    fixingGradeMessage = numColors <= 1
      ? 'No color fixing needed.'
      : `Sources match pip demand across all ${numColors} colors.`;
  } else if (fixingScore >= 70) {
    fixingGrade = 'B';
    fixingGradeMessage = weakColorName
      ? `Solid base — ${weakColorName} is slightly underrepresented (${weakColorSources} sources).`
      : `Solid base with minor distribution imbalance.`;
  } else if (fixingScore >= 50) {
    fixingGrade = 'C';
    fixingGradeMessage = weakColorName
      ? `${weakColorName[0].toUpperCase() + weakColorName.slice(1)} only has ${weakColorSources} sources for ${pipDemand[weakestColor!] || 0} pips of demand.`
      : `Source distribution doesn't match pip demand well.`;
  } else if (fixingScore >= 30) {
    fixingGrade = 'D';
    fixingGradeMessage = weakColorName
      ? `${weakColorName[0].toUpperCase() + weakColorName.slice(1)} has just ${weakColorSources} source${weakColorSources !== 1 ? 's' : ''} — most ${weakColorName} spells will be hard to cast on curve.`
      : `Multiple colors lack the sources to cast spells reliably.`;
  } else {
    fixingGrade = 'F';
    fixingGradeMessage = minSourceCount === 0
      ? `At least one color has zero sources — those spells are uncastable.`
      : `Too few sources across the board (worst: ${minSourceCount}). Consider more dual lands and mana rocks.`;
  }

  // Build fixing recommendations: non-land mana fixers from EDHREC candidates
  // Combines weakness coverage (dominant) with unified base score (tiebreaker)
  const fixingRecommendations: RecommendedCard[] = [];
  for (const [name, { card }] of candidateMap) {
    if (card.primary_type === 'Land') continue;
    const isFixer = hasTag(name, 'mana-dork') || hasTag(name, 'mana-rock') || hasTag(name, 'cost-reducer') || hasTag(name, 'ramp');
    if (!isFixer) continue;
    const cardColors = getRecommendationColors(name, card.color_identity);
    const relevantColors = cardColors.filter(c => ci.includes(c));
    const role = getCardRole(name);
    const allRoles = getAllCardRoles(name);
    const price = card.prices?.tcgplayer?.price
      ? card.prices.tcgplayer.price.toFixed(2)
      : card.prices?.cardkingdom?.price
        ? card.prices.cardkingdom.price.toFixed(2)
        : undefined;
    // Weakness coverage dominates, base score breaks ties
    const weaknessScore = ci.length >= 2
      ? relevantColors.reduce((s, c) => s + (demandVsSupplyRatio[c] || 0), 0)
      : 0;
    const baseScore = candidateScoreCache.get(name)?.score ?? 0;
    const combinedScore = (weaknessScore * 50) + baseScore;
    fixingRecommendations.push({
      name,
      inclusion: card.inclusion,
      synergy: card.synergy || 0,
      role: role || undefined,
      roleLabel: role ? ROLE_LABELS[role] : undefined,
      allRoles: allRoles.length > 0 ? allRoles : undefined,
      allRoleLabels: allRoles.length > 0 ? allRoles.map(r => ROLE_LABELS[r] || r) : undefined,
      fillsDeficit: role ? deficitRoles.has(role) : false,
      primaryType: card.primary_type,
      imageUrl: card.image_uris?.[0]?.normal,
      price,
      producedColors: cardColors,
      isThemeSynergy: card.isThemeSynergyCard || undefined,
      score: combinedScore,
      isUtilityLand: isUtilityLand(name) || undefined,
      isTapland: isTapland(name) || undefined,
    });
  }
  fixingRecommendations.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  fixingRecommendations.splice(15);

  const colorFixing: ColorFixingAnalysis = {
    colorsNeeded: ci,
    sourcesPerColor,
    fixingLands: fixingLands.sort(sortByInclusion),
    colorlessOnly: colorlessOnly.sort(sortByInclusion),
    utilityLands: utilityLands.sort(sortByInclusion),
    taplands: taplands.sort(sortByInclusion),
    manaFixCards,
    nonFixRampCards,
    pipDemand,
    pipDemandTotal,
    demandVsSupplyRatio,
    weakestColor,
    anyColorLandCount,
    fixingScore,
    fixingGrade,
    fixingGradeMessage,
    fixingRecommendations,
  };

  // --- MDFCs in Deck ---
  const mdfcsInDeck: AnalyzedCard[] = currentCards
    .filter(c => isMdfcLand(c))
    .map(c => makeAnalyzedCard(c))
    .sort(sortByInclusion);

  // --- Channel Lands in Deck ---
  const channelLandsInDeck: AnalyzedCard[] = currentCards
    .filter(c => isChannelLand(c))
    .map(c => makeAnalyzedCard(c))
    .sort(sortByInclusion);

  // --- Macro Grades ---
  const rolesGrade = getRolesGrade(roleDeficits);
  const flexCount = mdfcsInDeck.length + channelLandsInDeck.length;
  const manaGrade = getManaGrade(manaBase, manaSources, colorFixing, flexCount);
  const detected = detectPacing(currentCards, curveAnalysis);
  const pacing = overridePacing ?? detected.pacing;
  const pacingLabel = overridePacing ? (overridePacing.charAt(0).toUpperCase() + overridePacing.slice(1).replace('-', ' ')) : detected.label;
  const curvePhases = getCurvePhases(curveBreakdowns, curveAnalysis, totalNonLand, pacing, roleTargets);
  const curveGrade = getCurveGrade(curvePhases);
  const manaTrajectory = getManaTrajectory(deckSize, currentLands, manaSources.earlyRamp, manaSources.avgRampCmc, taplandRatio);

  // --- Enrich trajectory with card-based stats ---
  if (manaTrajectory.length > 0 && totalNonLand > 0) {
    // Sort non-land CMCs ascending for efficient castable counting
    const cmcs = nonLandCards.map(c => c.cmc).sort((a, b) => a - b);
    let prevCastable = 0;
    for (const pt of manaTrajectory) {
      // Count cards castable with this much mana
      let castable = 0;
      for (const cmc of cmcs) {
        if (cmc <= pt.totalExpectedMana) castable++;
        else break; // sorted, no need to check further
      }
      pt.castableCards = castable;
      pt.castablePct = castable / totalNonLand;
      pt.newUnlocks = castable - prevCastable;
      // Mana efficiency: what fraction of available mana could be spent
      // Approximate: avg CMC of newly unlocked cards / available mana
      if (pt.totalExpectedMana > 0 && castable > 0) {
        const castableCmcs = cmcs.slice(0, castable);
        const avgCastable = castableCmcs.reduce((s, c) => s + c, 0) / castable;
        pt.manaEfficiency = Math.min(1, avgCastable / pt.totalExpectedMana);
      }
      prevCastable = castable;
    }
  }

  return {
    roleDeficits,
    curveAnalysis,
    manaBase,
    manaSources,
    typeAnalysis,
    recommendations,
    roleBreakdowns,
    curveBreakdowns,
    landCards: analyzedLandCards,
    rampCards,
    landRecommendations,
    colorFixing,
    mdfcsInDeck,
    channelLandsInDeck,
    curvePhases,
    manaTrajectory,
    rolesGrade,
    manaGrade,
    curveGrade,
    pacing,
    pacingLabel,
  };
}
