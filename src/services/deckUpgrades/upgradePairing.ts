import type { ScryfallCard } from '@/types';
import { hasTag } from '@/services/tagger/client';
import { isFormatStaple } from '@/lib/constants/staples';
import type { LiftPoolEntry } from './deckUpgrades';

/**
 * Conservative candidate → incumbent upgrade pairing ("Branching Evolution is a
 * possible upgrade of your Doubling Season"). A pair must clear THREE gates:
 *
 *   1. Same type class (creature / instant+sorcery / other permanent) — a cheap
 *      sanity bound on "does the same kind of job".
 *   2. The incumbent appears in the candidate's EDHREC "similar cards" list —
 *      functional analogues, EDHREC's own call. This is the ONLY accepted basis:
 *        - Shared tagger tags are too coarse ("protection" paired Vigor with
 *          Daring Fiendbonder: both protect, in unrelated ways). Tags and shared
 *          themes only LABEL a pair that already qualified. Finer subtag sync
 *          (protects-creature, gives-indestructible, damage-prevention…) is the
 *          future avenue if tag-basis pairing is ever wanted again.
 *        - High mutual lift is NOT basis either: in a dense archetype every
 *          staple lifts hard with every other — lift says "same deck", not
 *          "same job" (it flooded a Skullbriar deck with Reyhan "upgrades").
 *      Plus: a cheap incumbent with strong commander synergy is thriving and is
 *      never a pairing target — an upgrade claim needs a weakness to address.
 *   3. An upgrade axis: meaningfully cheaper, better adopted (synergy), or newer
 *      with higher inclusion.
 *
 * Posture: prefer missed pairs over wrong pairs — one bad pairing costs more
 * trust than ten missed ones. Pure module: all data arrives as arguments.
 */

/** Narrow tagger tags used to LABEL a shared job (never to justify a pair). */
const LABEL_TAGS: ReadonlyArray<readonly [string, string]> = [
  ['counterspell', 'Counterspell'],
  ['boardwipe', 'Board wipe'],
  ['tutor', 'Tutor'],
  ['wheel', 'Wheel'],
  ['looting', 'Looting'],
  ['cantrip', 'Cantrip'],
  ['sacrifice', 'Sacrifice outlet'],
  ['graveyard-hate', 'Graveyard hate'],
  ['protection', 'Protection'],
  ['lifegain', 'Lifegain'],
  ['mana-dork', 'Mana dork'],
  ['cost-reducer', 'Cost reducer'],
];

/** "Cheaper" axis: candidate ≤ 60% of the incumbent's price, incumbent worth at least $5. */
const PRICE_UPGRADE_RATIO = 0.6;
const MIN_INCUMBENT_PRICE = 5;
/** "Adopted" axis: candidate synergy must beat the incumbent's by this margin. */
const SYNERGY_MARGIN = 0.05;
/** A cheap incumbent at or above this commander synergy is thriving — nothing to upgrade. */
const THRIVING_SYNERGY = 0.1;

export interface PairReceipt {
  /** The deck card this candidate could replace. */
  deckCard: string;
  /** What vouches for the equivalence: EDHREC's similar-cards list, or very high lift. */
  basis: 'similar' | 'high-lift';
  /** Optional label for the shared job ("Sacrifice outlet", a shared theme name). */
  sharedLabel?: string;
  /** The strongest upgrade axis that held. */
  axis: 'cheaper' | 'adopted' | 'newer';
  candidatePrice?: number;
  incumbentPrice?: number;
  candidateSynergy?: number;
  incumbentSynergy?: number;
  /** Lift between the pair, when the pool has an edge. */
  mutualLift?: number;
}

export interface FindPairArgs {
  candidate: {
    name: string;
    card?: ScryfallCard;
    synergy?: number;
    inclusion: number;
    /** Intended-theme names whose EDHREC page lists the candidate. */
    themes: string[];
  };
  /** The candidate's full (unfiltered) lift pool. */
  candidatePool: LiftPoolEntry[];
  /** EDHREC's "similar cards" for the candidate (its card page's own list). */
  similarNames: Set<string>;
  /** Deck cards with card data (lands and unknowns are skipped internally). */
  deckCards: ScryfallCard[];
  /** Commander-page stats for deck cards (synergy/inclusion) — absent = no adopted axis. */
  incumbentStats: Map<string, { synergy?: number; inclusion: number }>;
  /** Card name → intended-theme names whose EDHREC page lists it (full lists, not just new). */
  themeMembership: Map<string, string[]>;
}

type TypeClass = 'creature' | 'spell' | 'permanent' | 'land';

function typeClass(card: ScryfallCard): TypeClass {
  const t = card.type_line;
  if (t.includes('Land')) return 'land';
  if (t.includes('Creature')) return 'creature';
  if (t.includes('Instant') || t.includes('Sorcery')) return 'spell';
  return 'permanent';
}

function usdPrice(card?: ScryfallCard): number | undefined {
  const p = parseFloat(card?.prices?.usd ?? '');
  return Number.isFinite(p) ? p : undefined;
}

interface AxisResult { axis: PairReceipt['axis']; weight: number }

function upgradeAxis(
  candidate: FindPairArgs['candidate'],
  incumbent: ScryfallCard,
  incumbentStat: { synergy?: number; inclusion: number } | undefined,
): AxisResult | null {
  const candPrice = usdPrice(candidate.card);
  const incPrice = usdPrice(incumbent);
  if (
    candPrice !== undefined && incPrice !== undefined
    && incPrice >= MIN_INCUMBENT_PRICE && candPrice <= incPrice * PRICE_UPGRADE_RATIO
  ) return { axis: 'cheaper', weight: 1 };

  if (
    typeof candidate.synergy === 'number' && typeof incumbentStat?.synergy === 'number'
    && candidate.synergy >= incumbentStat.synergy + SYNERGY_MARGIN
  ) return { axis: 'adopted', weight: 0.6 };

  const candDate = candidate.card?.released_at;
  const incDate = incumbent.released_at;
  if (
    candDate && incDate && candDate > incDate
    && incumbentStat !== undefined && candidate.inclusion > incumbentStat.inclusion
  ) return { axis: 'newer', weight: 0.3 };

  return null;
}

/**
 * Best incumbent for this candidate, or null when nothing clears every gate.
 * O(deck × tags) with map lookups — no fetches.
 */
export function findUpgradePair(args: FindPairArgs): PairReceipt | null {
  const { candidate, candidatePool, similarNames, deckCards, incumbentStats, themeMembership } = args;
  if (!candidate.card) return null;
  const candClass = typeClass(candidate.card);
  if (candClass === 'land') return null;

  const poolByName = new Map(candidatePool.map(e => [e.name, e]));
  const candThemes = new Set(candidate.themes);

  let best: { receipt: PairReceipt; score: number } | null = null;

  for (const incumbent of deckCards) {
    if (incumbent.name === candidate.name) continue;
    if (isFormatStaple(incumbent.name)) continue;
    if (typeClass(incumbent) !== candClass) continue;

    // Gate 2: EDHREC's similar-cards list must vouch for the equivalence. High mutual
    // lift is deliberately NOT a basis: in a dense archetype (Skullbriar counters),
    // every staple lifts hard with every other — lift says "same deck", not "same job".
    // The edge is kept as corroborating display only.
    const edge = poolByName.get(incumbent.name);
    if (!similarNames.has(incumbent.name)) continue;
    const basis: PairReceipt['basis'] = 'similar';

    // A cheap incumbent with strong commander synergy is doing its job well — an
    // "upgrade" claim needs a weakness to address (price, or being out-adopted).
    const stat = incumbentStats.get(incumbent.name);
    const incPrice = usdPrice(incumbent);
    const thriving = typeof stat?.synergy === 'number' && stat.synergy >= THRIVING_SYNERGY
      && (incPrice === undefined || incPrice < MIN_INCUMBENT_PRICE);
    if (thriving) continue;

    // Label the shared job when we can name it (context only, not a gate).
    let sharedLabel: string | undefined;
    for (const [tag, label] of LABEL_TAGS) {
      if (hasTag(candidate.name, tag) && hasTag(incumbent.name, tag)) { sharedLabel = label; break; }
    }
    if (!sharedLabel && candThemes.size > 0) {
      sharedLabel = (themeMembership.get(incumbent.name) ?? []).find(t => candThemes.has(t));
    }

    // Gate 3: an upgrade axis must hold.
    const axis = upgradeAxis(candidate, incumbent, stat);
    if (!axis) continue;

    const score = axis.weight + (edge?.lift ?? 0) / 10;
    if (best && score <= best.score) continue;
    best = {
      score,
      receipt: {
        deckCard: incumbent.name,
        basis,
        sharedLabel,
        axis: axis.axis,
        candidatePrice: usdPrice(candidate.card),
        incumbentPrice: incPrice,
        candidateSynergy: candidate.synergy,
        incumbentSynergy: stat?.synergy,
        mutualLift: edge?.lift,
      },
    };
  }

  return best?.receipt ?? null;
}
