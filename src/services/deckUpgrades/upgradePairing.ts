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
 *   2. Shared function, via either
 *        a. a narrow tagger oracle-tag both cards carry (allowlist below — broad
 *           roles like plain removal/ramp/card-advantage are excluded on purpose:
 *           "both are removal" pairs Swords to Plowshares with Desert Twister), or
 *        b. membership in the same intended-theme page PLUS a strong lift edge
 *           between the two cards — same plan, and the format actually plays them
 *           together (this branch catches Doubling Season → Branching Evolution,
 *           which carries none of the 18 tagger tags).
 *   3. An upgrade axis: meaningfully cheaper, better adopted (synergy), or newer
 *      with higher inclusion.
 *
 * Posture: prefer missed pairs over wrong pairs — one bad pairing costs more
 * trust than ten missed ones. Pure module: all data arrives as arguments.
 */

/** Narrow tagger tags that identify a specific job. Key = oracle tag, value = chip label. */
const PAIRING_TAGS: ReadonlyArray<readonly [string, string]> = [
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

/** Theme-lift branch: minimum lift + shared-deck sample between candidate and incumbent. */
const MIN_PAIR_LIFT = 2;
const MIN_PAIR_DECKS = 50;
/** "Cheaper" axis: candidate ≤ 60% of the incumbent's price, incumbent worth at least $5. */
const PRICE_UPGRADE_RATIO = 0.6;
const MIN_INCUMBENT_PRICE = 5;
/** "Adopted" axis: candidate synergy must beat the incumbent's by this margin. */
const SYNERGY_MARGIN = 0.05;

export interface PairReceipt {
  /** The deck card this candidate could replace. */
  deckCard: string;
  basis: 'role' | 'theme-lift';
  /** Human label for the shared function ("Sacrifice outlet", "Counters (+1/+1)"). */
  sharedLabel: string;
  /** The strongest upgrade axis that held. */
  axis: 'cheaper' | 'adopted' | 'newer';
  candidatePrice?: number;
  incumbentPrice?: number;
  candidateSynergy?: number;
  incumbentSynergy?: number;
  /** Lift between the pair (theme-lift basis only). */
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
  const { candidate, candidatePool, deckCards, incumbentStats, themeMembership } = args;
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

    // Gate 2a: shared narrow tag.
    let basis: PairReceipt['basis'] | null = null;
    let sharedLabel = '';
    let mutualLift: number | undefined;
    for (const [tag, label] of PAIRING_TAGS) {
      if (hasTag(candidate.name, tag) && hasTag(incumbent.name, tag)) {
        basis = 'role';
        sharedLabel = label;
        break;
      }
    }

    // Gate 2b: same intended theme + strong mutual lift.
    if (!basis && candThemes.size > 0) {
      const sharedTheme = (themeMembership.get(incumbent.name) ?? []).find(t => candThemes.has(t));
      const edge = sharedTheme ? poolByName.get(incumbent.name) : undefined;
      if (sharedTheme && edge && edge.lift >= MIN_PAIR_LIFT && edge.numDecks >= MIN_PAIR_DECKS) {
        basis = 'theme-lift';
        sharedLabel = sharedTheme;
        mutualLift = edge.lift;
      }
    }
    if (!basis) continue;

    // Gate 3: an upgrade axis must hold.
    const incumbentStat = incumbentStats.get(incumbent.name);
    const axis = upgradeAxis(candidate, incumbent, incumbentStat);
    if (!axis) continue;

    const score = (basis === 'role' ? 1.5 : 1) + (mutualLift ?? 0) / 10 + axis.weight;
    if (best && score <= best.score) continue;
    best = {
      score,
      receipt: {
        deckCard: incumbent.name,
        basis,
        sharedLabel,
        axis: axis.axis,
        candidatePrice: usdPrice(candidate.card),
        incumbentPrice: usdPrice(incumbent),
        candidateSynergy: candidate.synergy,
        incumbentSynergy: incumbentStat?.synergy,
        mutualLift,
      },
    };
  }

  return best?.receipt ?? null;
}
