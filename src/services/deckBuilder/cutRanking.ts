// src/services/deckBuilder/cutRanking.ts
// Single source of truth for cut-suggestion ranking. Every surface that
// proposes cuts (trim drawer, Optimize tab, Curve tab, Card Fit) consumes
// these helpers so suggestions never drift between surfaces.
import type { ScryfallCard, DetectedCombo } from '@/types';

/** A card below this inclusion % with non-positive synergy is a "low fit". */
export const LOW_FIT_INCLUSION = 5;
export const LOW_FIT_SYNERGY = 0;

/** Priority boost for Kamigawa channel lands — near-auto-includes in their color.
 *  Lives here (not deckGenerator) so the analyzer can share it without an
 *  analyzer→generator import cycle; deckGenerator re-exports it. */
export const CHANNEL_LAND_BOOST = 80;
/** Priority boost for MDFC spell/lands — strictly better than spell-only equivalents. */
export const MDFC_LAND_BOOST = 50;

/** Lands that grant a basic type to EVERY land rather than producing mana themselves.
 *  Scryfall gives them no `produced_mana`, no basic subtype and no "add {X}" oracle
 *  text, so the naive readings score them as colorless — yet in a deck whose pips
 *  lean hard on their color they are the single best fixer available, turning the
 *  whole mana base into a source. Keyed name -> granted color. */
export const OMNIPRESENCE_LANDS: Record<string, string> = {
  'Urborg, Tomb of Yawgmoth': 'B',
  'Yavimaya, Cradle of Growth': 'G',
};

/** The granted color for an omnipresence land, or null if the card isn't one. */
export function omnipresenceColor(cardName: string): string | null {
  return OMNIPRESENCE_LANDS[cardName] ?? null;
}

/** Pip demand share below which an omnipresence land isn't worth a land slot —
 *  granting Swamp to everything does little for a deck that wants one {B}. */
export const OMNIPRESENCE_MIN_PIP_SHARE = 0.3;
/** Fewer than this many convertible lands and the effect is too small to chase. */
export const OMNIPRESENCE_MIN_DEFICIT = 6;
/** Per-convertible-land boost, capped, landing in the same band as
 *  CHANNEL_LAND_BOOST (80) at a typical 10-15 land deficit. */
export const OMNIPRESENCE_PER_LAND = 7;
export const OMNIPRESENCE_MAX_BOOST = 110;

/**
 * Priority boost for an omnipresence land, scaled by how much of the mana base it
 * would actually convert. Returns 0 unless the granted color is a major pip
 * consumer AND enough lands don't already produce it.
 *
 * @param pipShare      the granted color's share of the deck's colored pip demand (0-1)
 * @param landDeficit   lands in the base that don't already produce that color
 */
export function omnipresenceBoost(pipShare: number, landDeficit: number): number {
  if (pipShare < OMNIPRESENCE_MIN_PIP_SHARE) return 0;
  if (landDeficit < OMNIPRESENCE_MIN_DEFICIT) return 0;
  return Math.round(Math.min(landDeficit * OMNIPRESENCE_PER_LAND, OMNIPRESENCE_MAX_BOOST));
}

/**
 * Convertible-land estimate for the DECK-GENERATION path, which has to score an
 * omnipresence land before any land is actually chosen. Mirrors the real mana base:
 * basics are dealt out proportional to pip demand (see the basics fill in
 * deckGenerator), and roughly half the non-basic slots go to lands that produce the
 * dominant color (in-identity duals) while the rest are utility / colorless.
 *
 * Checked against a Golgari 25-land base at ~75% green pips: predicts 9 convertible
 * lands, the hand count is 9. Predicts ~3 for mono-green (correctly below the floor).
 */
export function estimateConvertibleLands(
  landCount: number,
  basicCount: number,
  pipShare: number,
): number {
  const nonBasicSlots = Math.max(0, landCount - basicCount);
  const basicsForColor = basicCount * pipShare;
  return Math.max(0, landCount - basicsForColor - nonBasicSlots * NONBASIC_COLOR_HIT_RATE);
}
/** Assumed share of non-basic land slots that already produce the dominant color. */
const NONBASIC_COLOR_HIT_RATE = 0.5;

/** Connectivity re-weighting amplitude: a card's lift-graph connectivity
 *  percentile maps to at most this many relevancy points either way.
 *  Meaningful next to typical relevancy gaps but below combo/role boosts
 *  (~80), so it re-ranks near-ties without overriding hard keeps. */
export const SYN_ADJ_MAX = 35;

/** Forced-trim stickiness for bracket game changers: cuttable as a last
 *  resort, never first out the door. Suggest-mode surfaces exclude them
 *  outright instead. */
export const GAME_CHANGER_KEEP_BOOST = 80;

/** Combo participation for protection purposes: commander-source combos that
 *  are complete or meaningfully in progress (2+ pieces in deck). Cards in
 *  this map are hard-excluded from suggest-mode cut lists. */
export function buildComboParticipation(combos?: DetectedCombo[]): Map<string, number> {
  const map = new Map<string, number>();
  if (!combos) return map;
  for (const combo of combos) {
    if (combo.source !== 'commander') continue;
    if (!combo.isComplete && combo.deckCount < 2) continue;
    for (const card of combo.cards) map.set(card, (map.get(card) || 0) + 1);
  }
  return map;
}

/** Is this card the still-in-deck piece of a one-away combo? (DFC-aware.) */
export function isNearMissComboPiece(cardName: string, combos?: DetectedCombo[]): boolean {
  if (!combos) return false;
  const variants = cardName.includes(' // ') ? [cardName, cardName.split(' // ')[0]] : [cardName];
  return combos.some(c =>
    !c.isComplete && c.missingCards.length === 1 && c.cards.some(cn => variants.includes(cn))
  );
}

export interface ConnectivityPercentiles {
  /** Deck-relative connectivity percentile per card (0 = least connected). */
  percentile: Record<string, number>;
  /** False until a lift scan has resolved — consumers fall back to relevancy-only. */
  has: boolean;
}

/** Deck-relative connectivity percentile per card, midrank tie handling (a
 *  cluster of zero-connectivity cards shares one percentile). Built over the
 *  supplied pool so "outlier" means outlier *within this deck*. O(n²) but
 *  n ≈ 60 — negligible. */
export function buildConnectivityPercentiles(
  cards: ScryfallCard[],
  connectivityMap?: Record<string, number>,
): ConnectivityPercentiles {
  const has = !!connectivityMap && Object.keys(connectivityMap).length > 0;
  const percentile: Record<string, number> = {};
  if (has) {
    const cm = connectivityMap!;
    const vals = cards.map(c => cm[c.name] ?? 0);
    for (const c of cards) {
      const v = cm[c.name] ?? 0;
      let below = 0, atOrBelow = 0;
      for (const x of vals) { if (x < v) below++; if (x <= v) atOrBelow++; }
      percentile[c.name] = vals.length ? ((below + atOrBelow) / 2) / vals.length : 0.5;
    }
  }
  return { percentile, has };
}

/** Map a card's connectivity percentile to a relevancy-point adjustment in
 *  [-SYN_ADJ_MAX, +SYN_ADJ_MAX]. Least-connected loses the most, pushing
 *  synergy outliers toward the cut; well-connected cards are protected.
 *  Zero while no scan is available. */
export function connectivityAdjustment(conn: ConnectivityPercentiles, name: string): number {
  return conn.has ? ((conn.percentile[name] ?? 0.5) - 0.5) * 2 * SYN_ADJ_MAX : 0;
}
