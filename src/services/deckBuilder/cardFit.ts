// src/services/deckBuilder/cardFit.ts
import type {
  ScryfallCard,
  EDHRECCommanderData,
  GapAnalysisCard,
  Misfit,
  MisfitReason,
} from '@/types';
import { isLiteralThemeMember, type ThemeMembership } from '@/components/analyze/themeMembership';
import { ROLE_LABELS } from './roleTargets';
import { getCardRole, isTutor } from '../tagger/client';
import { isAnyLand } from '../scryfall/client';
import { LOW_FIT_INCLUSION, LOW_FIT_SYNERGY } from './cutRanking';
import { isFastMana } from './bracketEstimator';

// Shared with the trim drawer's "low-fit" reason (see cutRanking) so the two
// surfaces provably agree on what counts as a poor fit.
const INCLUSION_LOW = LOW_FIT_INCLUSION;  // %
const SYNERGY_LOW = LOW_FIT_SYNERGY;      // EDHREC synergy ≤ 0
const MISFIT_REASON_THRESHOLD = 2; // need ≥ 2 reasons to flag as misfit
const FAST_MANA_PROTECTED_FROM = 4; // bracket at which fast mana is never a misfit
const TUTORS_PROTECTED_FROM = 3;    // bracket at which tutors are never a misfit

// Misfit score weights
const MISFIT_REASON_WEIGHT = 10;     // per reason flagged
const MISFIT_SYNERGY_WEIGHT = 5;     // multiplier on negative synergy
// (inclusion deficit is already in percentage units; weight 1, no constant needed)

// Card Fit sub-score penalties
const MISFIT_PENALTY_PER = 8;        // points subtracted per misfit
const MISFIT_PENALTY_CAP = 40;       // max penalty from misfits
const GAP_PENALTY_CAP = 20;          // the penalty approaches this, never reaches it
// Each missing staple takes this share of what's left of the cap, so every one you add moves the
// score. A flat 1.5 per gap capped at 20 saturated at 14 gaps: a 60-card Valgavoth list sat 23
// staples short, at 80 however many it added.
const GAP_PENALTY_DECAY = 0.88;
// Only a missing card this commander's decks broadly agree on counts as a gap. The gap list is the
// top 40 most-played cards NOT in the deck, with no floor — and a commander page has hundreds of
// cards, so without one there are always 40 more and the penalty can never be cleared: Card Fit
// capped at 80 and the overall score near 95 however the deck was tuned.
export const GAP_PENALTY_MIN_INCLUSION = 40; // % of decklists
// How much more widely played a staple must be than the card it would push out to count as an
// upgrade. Small differences are noise between two pages' samples, not a reason to swap.
const STAPLE_UPGRADE_MARGIN = 10; // percentage points

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
  /** The bracket the deck is judged at: the player's intended bracket, else the estimate. */
  bracket?: number;
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

    // A card whose own type line, keyword or rules text carries a selected theme's mechanic fits
    // the plan by construction. "Misfit" means doesn't-fit-the-plan, which is false here however
    // thin the aggregate data is — routine for a new commander or a new set, where a card can be
    // absent from EDHREC's page entirely and still obviously belong. Cutting for role excess and
    // cutting to hit deck size are separate categories and still apply.
    //
    // Only 'literal' evidence qualifies: EDHREC page presence and oracle-tag co-occurrence are
    // aggregate signals that can be wrong about any individual card, and a wrong keep costs the
    // user as much as a wrong cut.
    if (isLiteralThemeMember(themeMembership, card.name)) continue;

    // Game changers, fast mana at bracket 4+ and tutors at 3+ are in the deck for power, not for the
    // plan. The commander's page is mostly lower-bracket decks that don't run them (Chrome Mox is
    // absent from The Mycotyrant's all-brackets page and in 44% of its cEDH decks; Razaketh is on no
    // Mycotyrant page below cEDH), so their absence there says nothing about this deck. Whether they
    // belong at its power level is the Bracket tab's question. The tutor line matches the swap
    // service's, which stops counting tutors as surplus card draw from the same bracket.
    if (card.isGameChanger) continue;
    if ((inputs.bracket ?? 0) >= FAST_MANA_PROTECTED_FROM && isFastMana(card.name)) continue;
    if ((inputs.bracket ?? 0) >= TUTORS_PROTECTED_FROM && isTutor(card.name)) continue;

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

    // Missing synergy is never a reason of its own. With no inclusion either, the card is off the
    // page — one fact, already recorded above; counting it twice made absence alone a misfit. With
    // inclusion known, the card IS on a page and the synergy map just came from a different one.
    const syn = cardSynergyMap?.[card.name];
    if (syn != null && syn <= SYNERGY_LOW) {
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

    // At least one reason has to come from how this commander's decks actually play the card. "No
    // tagged role" + "off-theme" alone flag any tutor or staple, however widely it's played here.
    const dataBacked = reasons.some(r => r.kind.startsWith('inclusion') || r.kind.startsWith('synergy'));
    if (reasons.length >= MISFIT_REASON_THRESHOLD && dataBacked) {
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

/**
 * Card Fit charges for what it can hand back: pass the misfits it offers as cuts and the staples it
 * offers as adds (scoreAgainstSwaps does), so every point it holds back is a swap in its columns.
 */
export function computeCardFitSubscore(misfits: Misfit[], gaps: GapAnalysisCard[]) {
  // Inverse: more misfits + more high-value cards missing = worse score.
  const gapCount = gaps.filter(g => g.inclusion >= GAP_PENALTY_MIN_INCLUSION).length;
  const misfitPenalty = Math.min(MISFIT_PENALTY_CAP, misfits.length * MISFIT_PENALTY_PER);
  const gapPenalty = GAP_PENALTY_CAP * (1 - GAP_PENALTY_DECAY ** gapCount);
  // Whole points like every other sub-score.
  const value = Math.max(0, Math.round(100 - misfitPenalty - gapPenalty));
  const surface = misfits.length === 0 && gapCount === 0
    ? 'Every card pulls its weight.'
    : `${misfits.length} misfit${misfits.length === 1 ? '' : 's'} · ${gapCount} missing staple${gapCount === 1 ? '' : 's'}`;
  return { value, surface, bandLabel: bandForCardFit(value) };
}

/** A deck card a staple could replace: its play rate here, and whether it's a land. */
export interface CuttableCard {
  name: string;
  inclusion: number;
  isLand: boolean;
}

/**
 * Missing staples that are upgrades over a card the deck actually runs. Best staple first, each
 * against the weakest card left of the same kind (a land only replaces a land), and only while the
 * staple is played clearly more. A 60-card deck can't hold every staple of the 100-card lists the
 * page is built from; once its weakest card outplays the next staple, the rest aren't missing, the
 * deck spent those slots on better cards.
 */
export function pairStaplesWithCuts(
  staples: GapAnalysisCard[],
  cuttable: CuttableCard[],
): { add: GapAnalysisCard; cut: CuttableCard }[] {
  const isLandGap = (g: GapAnalysisCard) => /\bland\b/i.test(g.typeLine ?? '');
  const pool = {
    land: cuttable.filter(c => c.isLand).sort((a, b) => a.inclusion - b.inclusion),
    spell: cuttable.filter(c => !c.isLand).sort((a, b) => a.inclusion - b.inclusion),
  };
  const pairs: { add: GapAnalysisCard; cut: CuttableCard }[] = [];
  for (const add of [...staples].sort((a, b) => b.inclusion - a.inclusion)) {
    if (add.inclusion < GAP_PENALTY_MIN_INCLUSION) break;
    const side = pool[isLandGap(add) ? 'land' : 'spell'];
    const cut = side[0];
    if (!cut || add.inclusion < cut.inclusion + STAPLE_UPGRADE_MARGIN) continue;
    side.shift();
    pairs.push({ add, cut });
  }
  return pairs;
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

export { ROLE_LABELS };
