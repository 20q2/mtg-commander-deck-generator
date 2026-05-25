// src/services/deckBuilder/cardFit.ts
import type {
  ScryfallCard,
  EDHRECCommanderData,
  GapAnalysisCard,
  Misfit,
  MisfitReason,
} from '@/types';
import type { ThemeMembership } from '@/components/analyze/themeMembership';
import { ROLE_LABELS } from './roleTargets';
import { getCardRole } from '../tagger/client';
import { isAnyLand } from '../scryfall/client';

const INCLUSION_LOW = 5;       // %
const SYNERGY_LOW = 0;          // EDHREC synergy ≤ 0
const MISFIT_REASON_THRESHOLD = 2; // need ≥ 2 reasons to flag as misfit

// Misfit score weights
const MISFIT_REASON_WEIGHT = 10;     // per reason flagged
const MISFIT_SYNERGY_WEIGHT = 5;     // multiplier on negative synergy
// (inclusion deficit is already in percentage units; weight 1, no constant needed)

// Card Fit sub-score penalties
const MISFIT_PENALTY_PER = 8;        // points subtracted per misfit
const MISFIT_PENALTY_CAP = 40;       // max penalty from misfits
const GAP_PENALTY_PER = 1.5;         // points subtracted per gap card
const GAP_PENALTY_CAP = 20;          // max penalty from gaps

const SUPERTYPES = new Set(['Legendary', 'Basic', 'Snow', 'Tribal', 'World', 'Token', 'Ongoing']);

function primaryType(typeLine: string): string {
  const beforeDash = typeLine.split('—')[0].trim();
  const tokens = beforeDash.split(/\s+/).filter(Boolean);
  // Drop leading supertypes.
  while (tokens.length > 0 && SUPERTYPES.has(tokens[0])) tokens.shift();
  return tokens[0] ?? '';
}

export interface MisfitInputs {
  /** Cards currently in the deck (excluding commander). */
  cards: ScryfallCard[];
  /** Per-card EDHREC inclusion % for cards in the deck. */
  cardInclusionMap: Record<string, number>;
  /** Per-card EDHREC synergy. Optional. */
  cardSynergyMap?: Record<string, number>;
  /** Theme membership for active themes. */
  themeMembership: ThemeMembership | null;
  /** Gap candidates (top EDHREC cards not in deck) — used for replacement suggestion. */
  gapCandidates?: GapAnalysisCard[];
  /** EDHREC commander payload (for citing decklist count). */
  commanderData?: EDHRECCommanderData | null;
  /** Commander name (and partner if any) — never suggest these as replacements. */
  commanderNames?: string[];
}

export function computeMisfits(inputs: MisfitInputs): Misfit[] {
  const {
    cards,
    cardInclusionMap,
    cardSynergyMap,
    themeMembership,
    gapCandidates,
  } = inputs;

  const misfits: Misfit[] = [];
  const themeByCard = themeMembership?.byCard;

  const excludeBase = new Set<string>();
  for (const c of cards) excludeBase.add(c.name);
  for (const n of inputs.commanderNames ?? []) excludeBase.add(n);

  for (const card of cards) {
    if (isAnyLand(card)) continue; // lands evaluated separately, not as misfits here

    const reasons: MisfitReason[] = [];

    const incl = cardInclusionMap[card.name];
    if (incl == null) {
      reasons.push({
        kind: 'inclusion-absent',
        label: 'Not played in this commander\'s decks',
        detail: 'Card has no inclusion data on EDHREC for this commander',
      });
    } else if (incl < INCLUSION_LOW) {
      reasons.push({
        kind: 'inclusion-low',
        label: `Played in ${incl.toFixed(0)}% of decklists`,
        detail: `Below the inclusion floor (${INCLUSION_LOW}%)`,
      });
    }

    const syn = cardSynergyMap?.[card.name];
    if (syn == null) {
      reasons.push({
        kind: 'synergy-absent',
        label: 'No commander synergy data',
        detail: 'Card isn\'t on this commander\'s EDHREC page',
      });
    } else if (syn <= SYNERGY_LOW) {
      reasons.push({
        kind: 'synergy-low',
        label: 'Low commander synergy',
        detail: `EDHREC synergy ${syn >= 0 ? '+' : ''}${syn.toFixed(2)} for this commander`,
      });
    }

    const role = getCardRole(card.name);
    if (!role) {
      reasons.push({
        kind: 'role-missing',
        label: 'No tagged role',
        detail: 'Doesn\'t fill ramp / removal / draw / wipe',
      });
    }

    const themed = themeByCard?.has(card.name.toLowerCase());
    if (themeByCard && themeByCard.size > 0 && !themed) {
      reasons.push({
        kind: 'theme-off',
        label: 'Off detected themes',
        detail: 'Not in any active theme bucket',
      });
    }

    if (reasons.length >= MISFIT_REASON_THRESHOLD) {
      const misfitScore =
        (reasons.length * MISFIT_REASON_WEIGHT) +
        (incl != null ? Math.max(0, INCLUSION_LOW - incl) : 0) +
        (syn != null ? Math.max(0, -syn * MISFIT_SYNERGY_WEIGHT) : 0);
      const excludeNames = new Set(excludeBase);
      excludeNames.add(card.name);
      const suggestedReplacement = pickReplacement(card, role, gapCandidates, excludeNames);
      misfits.push({ card, misfitScore, reasons, suggestedReplacement });
    }
  }

  // Highest misfitScore first.
  misfits.sort((a, b) => b.misfitScore - a.misfitScore);
  return misfits;
}

function pickReplacement(
  card: ScryfallCard,
  role: string | null,
  gapCandidates: GapAnalysisCard[] | undefined,
  excludeNames: Set<string>,
): GapAnalysisCard | undefined {
  if (!gapCandidates || gapCandidates.length === 0) return undefined;
  const candidates = gapCandidates.filter(g => !excludeNames.has(g.name));
  if (candidates.length === 0) return undefined;
  if (role) {
    const sameRole = candidates.find(g => g.role === role);
    if (sameRole) return sameRole;
  }
  const cardPrimary = primaryType(card.type_line ?? '');
  if (cardPrimary) {
    const sameType = candidates.find(
      g => primaryType(g.typeLine).toLowerCase() === cardPrimary.toLowerCase(),
    );
    if (sameType) return sameType;
  }
  return undefined;
}

export function computeCardFitSubscore(misfits: Misfit[], gapCount: number) {
  // Inverse: more misfits + fewer gaps filled = worse score.
  const misfitPenalty = Math.min(MISFIT_PENALTY_CAP, misfits.length * MISFIT_PENALTY_PER);
  const gapPenalty = Math.min(GAP_PENALTY_CAP, gapCount * GAP_PENALTY_PER);
  const value = Math.max(0, 100 - misfitPenalty - gapPenalty);
  const surface = misfits.length === 0 && gapCount === 0
    ? 'Every card pulls its weight.'
    : `${misfits.length} misfit${misfits.length === 1 ? '' : 's'} · ${gapCount} high-value gap${gapCount === 1 ? '' : 's'}`;
  return { value, surface, bandLabel: bandForCardFit(value) };
}

function bandForCardFit(score: number): string {
  if (score >= 90) return 'Tight';
  if (score >= 75) return 'Healthy';
  if (score >= 60) return 'Solid';
  if (score >= 40) return 'Loose';
  return 'Bloated';
}

const FEATURED_MIN_STRIKES = 3;
const FEATURED_MAX = 8;

/**
 * Cinematic slideshow rolls over the worst offenders only.
 * - "Worst" = ≥ 3 reasons triggered (a "strike" per reason).
 * - Capped at 8 so a fringe commander doesn't drag through 50 cards.
 * - Returns [] for a clean deck — UI shows the empty state.
 * `misfits` is assumed pre-sorted by misfitScore (computeMisfits does this).
 */
export function featuredMisfits(misfits: Misfit[]): Misfit[] {
  return misfits
    .filter(m => m.reasons.length >= FEATURED_MIN_STRIKES)
    .slice(0, FEATURED_MAX);
}

/**
 * Returns the Card Fit score delta if `replacement` were swapped in for `misfit.card`.
 * If `replacement` is undefined, returns the delta from removing the card outright.
 * Positive delta = improvement.
 */
export function simulateSwapImpact(
  misfits: Misfit[],
  misfit: Misfit,
  gapCount: number,
  replacement: { name: string } | undefined,
): number {
  const before = computeCardFitSubscore(misfits, gapCount).value;
  const afterMisfits = misfits.filter(m => m.card.name !== misfit.card.name);
  const afterGapCount = replacement ? Math.max(0, gapCount - 1) : gapCount;
  const after = computeCardFitSubscore(afterMisfits, afterGapCount).value;
  return Math.round(after - before);
}

export { ROLE_LABELS };
