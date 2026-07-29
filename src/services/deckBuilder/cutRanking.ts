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
