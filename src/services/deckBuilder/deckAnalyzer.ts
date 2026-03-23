import type { ScryfallCard, EDHRECCommanderData, EDHRECCard } from '@/types';
import { getCardRole, cardMatchesRole, getAllCardRoles, hasTag, getCardSubtype, type RoleKey } from '@/services/tagger/client';
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
}

export interface AnalyzedCard {
  card: ScryfallCard;
  inclusion: number | null;
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
}

export interface ManaTrajectoryPoint {
  turn: number;
  expectedLands: number;
  expectedRampMana: number;
  totalExpectedMana: number;
}

export interface ColorFixingAnalysis {
  colorsNeeded: string[];
  sourcesPerColor: Record<string, number>;
  fixingLands: AnalyzedCard[];   // lands producing 2+ of needed colors
  colorlessOnly: AnalyzedCard[]; // utility lands producing only colorless
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
function hypergeoPmf(N: number, K: number, n: number, k: number): number {
  return (binomial(K, k) * binomial(N - K, n - k)) / binomial(N, n);
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

export function getCurveGrade(curveAnalysis: CurveSlot[]): GradeResult {
  const totalDeviation = curveAnalysis.reduce((sum, s) => sum + Math.abs(s.delta), 0);
  const totalCards = curveAnalysis.reduce((sum, s) => sum + s.current, 0);
  if (totalCards === 0) return { letter: 'F', message: 'No non-land cards to evaluate.' };

  const deviationPct = totalDeviation / totalCards;

  // Detect direction: top-heavy or bottom-heavy
  const highEnd = curveAnalysis.filter(s => s.cmc >= 5).reduce((sum, s) => sum + s.delta, 0);
  const lowEnd = curveAnalysis.filter(s => s.cmc <= 2).reduce((sum, s) => sum + s.delta, 0);
  const shape = highEnd > 3 ? 'top-heavy' : lowEnd > 3 ? 'bottom-heavy' : 'uneven';

  if (deviationPct <= 0.10)
    return { letter: 'A', message: 'Curve closely matches the average — well-distributed.' };
  if (deviationPct <= 0.20)
    return { letter: 'B', message: 'Curve is solid with minor deviations.' };
  if (deviationPct <= 0.30)
    return { letter: 'C', message: `Curve is a bit ${shape}.` };
  if (deviationPct <= 0.40)
    return { letter: 'D', message: `Curve is significantly ${shape}.` };
  return { letter: 'F', message: 'Curve is far from average — expect inconsistent draws.' };
}

/** Pacing multipliers shift curve targets to match detected deck tempo. */
export const PACING_MULTIPLIERS: Record<Pacing, { early: number; mid: number; late: number }> = {
  'aggressive-early': { early: 1.20, mid: 0.95, late: 0.75 },
  'fast-tempo':       { early: 1.12, mid: 1.00, late: 0.82 },
  'midrange':         { early: 0.92, mid: 1.10, late: 0.95 },
  'late-game':        { early: 0.85, mid: 0.95, late: 1.25 },
  'balanced':         { early: 1.00, mid: 1.00, late: 1.00 },
};

/** Build curve phase analysis for early (0-2), mid (3-4), late (5+) game. */
export function getCurvePhases(
  curveBreakdowns: CurveBreakdown[],
  curveAnalysis: CurveSlot[],
  totalNonLand: number,
  pacing?: Pacing,
): CurvePhaseAnalysis[] {
  const phaseDefs: { phase: CurvePhase; label: string; range: [number, number] }[] = [
    { phase: 'early', label: 'Early Game', range: [0, 2] },
    { phase: 'mid',   label: 'Mid Game',   range: [3, 4] },
    { phase: 'late',  label: 'Late Game',   range: [5, 7] },
  ];

  const multipliers = pacing ? PACING_MULTIPLIERS[pacing] : PACING_MULTIPLIERS.balanced;

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

    // Count ramp and interaction in this phase
    let rampInPhase = 0;
    let interactionInPhase = 0;
    for (const ac of cards) {
      const role = ac.card.deckRole || getCardRole(ac.card.name);
      if (role === 'ramp') rampInPhase++;
      if (role === 'removal' || role === 'boardwipe') interactionInPhase++;
    }

    return {
      phase, label, cmcRange: range, current, target, cards,
      pctOfDeck, avgCmc, rampInPhase, interactionInPhase,
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
): ManaTrajectoryPoint[] {
  const points: ManaTrajectoryPoint[] = [];

  for (let turn = 1; turn <= 7; turn++) {
    // Cards seen by this turn = 7 (opening hand) + (turn - 1) draws
    const cardsSeen = 7 + (turn - 1);

    // Expected lands in hand/play by this turn (E[X] for hypergeometric)
    // E[X] = n * K / N for hypergeometric
    const expectedLands = Math.min(cardsSeen * landCount / deckSize, turn + 2); // can't play more than turn+mulligan lands

    // Expected ramp mana: each early ramp piece has P(drawn by turn) * P(castable)
    // Simplified: P(at least 1 copy drawn) ~ min(1, cardsSeen * count / deckSize) for the pool
    // But we want expected count drawn, not just "at least 1"
    // E[ramp drawn] = cardsSeen * earlyRampCount / deckSize
    // Each drawn ramp contributes 1 mana if castable (CMC < mana available at that point)
    // Approximate: ramp castable if its avg CMC < turn (since you have ~turn lands)
    let expectedRampMana = 0;
    if (earlyRampCount > 0 && turn >= 2) {
      const rampDrawn = cardsSeen * earlyRampCount / deckSize;
      // Fraction of ramp that's castable by this turn: ramp with CMC <= turn-1
      // (you need to have played it a turn before to get mana this turn)
      // avgRampCmc gives us a rough idea; if avg is 2, most are castable by turn 3
      const castableFrac = avgRampCmc > 0 ? Math.min(1, (turn - 1) / avgRampCmc) : 1;
      // Deployed ramp = drawn * castable fraction, but capped — can't deploy more than turns allow
      const deployedRamp = Math.min(rampDrawn * castableFrac, turn - 1);
      expectedRampMana = deployedRamp;
    }

    const totalExpectedMana = Math.round((expectedLands + expectedRampMana) * 10) / 10;

    points.push({
      turn,
      expectedLands: Math.round(expectedLands * 10) / 10,
      expectedRampMana: Math.round(expectedRampMana * 10) / 10,
      totalExpectedMana,
    });
  }

  return points;
}

/** Generate a human-readable HTML summary about the deck's health. Returns HTML with <strong> tags. */
export function getDeckSummary(analysis: DeckAnalysis, deckExcess?: number): string {
  const b = (text: string) => `<strong class="text-foreground/90">${text}</strong>`;

  const grades = [analysis.rolesGrade, analysis.manaGrade, analysis.curveGrade];
  const avgScore = grades.reduce((s, g) => s + (GRADE_SCORES[g.letter] ?? 0), 0) / grades.length;

  const totalCards = analysis.curveAnalysis.reduce((s, c) => s + c.current, 0);
  const weightedCmc = analysis.curveAnalysis.reduce((s, c) => s + c.cmc * c.current, 0);
  const avgCmc = totalCards > 0 ? weightedCmc / totalCards : 0;

  const rolesMet = analysis.roleDeficits.filter(rd => rd.current >= rd.target).length;
  const totalRoles = analysis.roleDeficits.length;

  // Identify specific problems
  const deficits = analysis.roleDeficits.filter(rd => rd.deficit > 0).sort((a, b_) => b_.deficit - a.deficit);
  const excesses = analysis.roleDeficits.filter(rd => rd.current > rd.target + 2).sort((a, b_) => (b_.current - b_.target) - (a.current - a.target));

  const earlyDelta = analysis.curveAnalysis.filter(s => s.cmc <= 2).reduce((sum, s) => sum + s.delta, 0);
  const lateDelta = analysis.curveAnalysis.filter(s => s.cmc >= 5).reduce((sum, s) => sum + s.delta, 0);
  const curveShape = lateDelta > 3 ? 'top-heavy' : earlyDelta > 3 ? 'bottom-heavy' : null;

  const { currentLands, adjustedSuggestion, verdict } = analysis.manaBase;
  const landDelta = currentLands - adjustedSuggestion;

  const parts: string[] = [];

  // ── Over-target: explain why cuts are needed ──
  if (deckExcess && deckExcess > 0) {
    parts.push(`Your deck is ${b(`${deckExcess} cards over`)} the target.`);

    const reasons: string[] = [];
    if (excesses.length > 0) {
      const exLabels = excesses.slice(0, 2).map(rd => b(rd.label.toLowerCase()));
      reasons.push(`excess ${exLabels.join(' and ')}`);
    }
    if (curveShape === 'top-heavy') {
      reasons.push(`a ${b('top-heavy curve')} with too many expensive spells`);
    } else if (curveShape === 'bottom-heavy') {
      reasons.push(`a ${b('bottom-heavy curve')} with too many cheap spells`);
    }
    if (landDelta > 2) {
      reasons.push(`${b(`${landDelta} extra lands`)} beyond the suggestion`);
    }
    if (deficits.length > 0 && reasons.length < 2) {
      const defLabels = deficits.slice(0, 2).map(rd => b(rd.label.toLowerCase()));
      reasons.push(`not enough ${defLabels.join(' or ')}`);
    }

    if (reasons.length > 0) {
      parts.push(`The weakest fits below were chosen because of ${reasons.join(', and ')}.`);
    } else {
      parts.push('The cards below have the lowest EDHREC inclusion rates and are the weakest fits for this deck.');
    }

    return parts.join(' ');
  }

  // ── Normal summary ──
  if (avgScore >= 3.5) {
    parts.push(`This deck is well-tuned — ${b(`${rolesMet} of ${totalRoles} roles met`)} with a ${b(`${avgCmc.toFixed(1)} avg CMC`)}.`);
    if (deficits.length === 0) {
      parts.push('All roles are on target, the mana base is solid, and the curve is well-distributed.');
    }
  } else if (avgScore >= 2.5) {
    parts.push(`Solid foundation — ${b(`${rolesMet} of ${totalRoles} roles met`)} with a ${b(`${avgCmc.toFixed(1)} avg CMC`)}.`);
  } else if (avgScore >= 1.5) {
    parts.push(`This deck has some gaps — only ${b(`${rolesMet} of ${totalRoles} roles`)} are on target.`);
  } else {
    parts.push(`This deck needs work — only ${b(`${rolesMet} of ${totalRoles} roles`)} are on target with a ${b(`${avgCmc.toFixed(1)} avg CMC`)}.`);
  }

  // Call out specific issues
  const insights: string[] = [];

  if (deficits.length > 0) {
    const top = deficits[0];
    insights.push(`${b(top.label)} is ${b(`${top.deficit} below`)} target`);
  }
  if (verdict === 'low' || verdict === 'critically-low') {
    insights.push(`running ${b(`${Math.abs(landDelta)} too few lands`)}`);
  } else if (verdict === 'high') {
    insights.push(`running ${b(`${landDelta} extra lands`)}`);
  }
  if (curveShape) {
    insights.push(`curve is ${b(curveShape)}`);
  }
  if (excesses.length > 0 && insights.length < 3) {
    const ex = excesses[0];
    insights.push(`${b(ex.label.toLowerCase())} is ${ex.current - ex.target} over target`);
  }

  if (insights.length > 0) {
    parts.push(`Your biggest gaps: ${insights.join(', ')}.`);
  }

  return parts.join(' ');
}

// ─── Smart Suggestion Scoring ────────────────────────────────────────

const ROLE_SUBTYPES: Record<string, string[]> = {
  ramp: ['mana-producer', 'mana-rock', 'cost-reducer', 'ramp'],
  removal: ['counterspell', 'bounce', 'spot-removal', 'removal'],
  boardwipe: ['bounce-wipe', 'boardwipe'],
  cardDraw: ['tutor', 'wheel', 'cantrip', 'card-draw', 'card-advantage'],
};

interface ScoringContext {
  roleDeficits: RoleDeficit[];
  curveAnalysis: CurveSlot[];
  typeAnalysis: TypeSlot[];
  currentSubtypeCounts: Record<string, number>;
}

/**
 * Unified recommendation scoring — mirrors the deck generator's multi-factor
 * approach (calculateCardPriority + computeRoleBoosts + curve awareness).
 */
function scoreRecommendation(
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

  function makeAnalyzedCard(card: ScryfallCard): AnalyzedCard {
    const subtype = card.rampSubtype || card.removalSubtype || card.boardwipeSubtype || card.cardDrawSubtype;
    return {
      card,
      inclusion: incMap[card.name] ?? null,
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
    });
  }

  const roleBreakdowns: RoleBreakdown[] = Object.entries(roleTargets).map(([role, target]) => {
    const current = roleCounts[role] || 0;
    const deficit = Math.max(0, target - current);
    const roleCards = currentCards
      .filter(c => c.deckRole === role || cardMatchesRole(c.name, role as RoleKey))
      .map(makeAnalyzedCard)
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
      if (suggestedReplacements.length >= 15) break;
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
      .map(makeAnalyzedCard)
      .sort(sortByInclusion);
    return { ...slot, cards };
  });

  // Land cards
  const analyzedLandCards: AnalyzedCard[] = landCards
    .map(makeAnalyzedCard)
    .sort(sortByInclusion);

  // Ramp cards
  const rampCards: AnalyzedCard[] = currentCards
    .filter(c => c.deckRole === 'ramp' || cardMatchesRole(c.name, 'ramp'))
    .map(makeAnalyzedCard)
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

  for (const card of landCards) {
    const produced = getLandProducedColors(card);
    const matchedColors = produced.filter(c => ci.includes(c));
    for (const color of matchedColors) {
      sourcesPerColor[color] = (sourcesPerColor[color] || 0) + 1;
    }
    const ac = makeAnalyzedCard(card);
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
    .map(makeAnalyzedCard)
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
    });
  }
  fixingRecommendations.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  fixingRecommendations.splice(15);

  const colorFixing: ColorFixingAnalysis = {
    colorsNeeded: ci,
    sourcesPerColor,
    fixingLands: fixingLands.sort(sortByInclusion),
    colorlessOnly: colorlessOnly.sort(sortByInclusion),
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
    .map(makeAnalyzedCard)
    .sort(sortByInclusion);

  // --- Channel Lands in Deck ---
  const channelLandsInDeck: AnalyzedCard[] = currentCards
    .filter(c => isChannelLand(c))
    .map(makeAnalyzedCard)
    .sort(sortByInclusion);

  // --- Macro Grades ---
  const rolesGrade = getRolesGrade(roleDeficits);
  const flexCount = mdfcsInDeck.length + channelLandsInDeck.length;
  const manaGrade = getManaGrade(manaBase, manaSources, colorFixing, flexCount);
  const curveGrade = getCurveGrade(curveAnalysis);
  const { pacing, label: pacingLabel } = detectPacing(currentCards, curveAnalysis);
  const curvePhases = getCurvePhases(curveBreakdowns, curveAnalysis, totalNonLand, pacing);
  const manaTrajectory = getManaTrajectory(deckSize, currentLands, manaSources.earlyRamp, manaSources.avgRampCmc);

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
