// src/services/deckBuilder/cutSuggestion.ts
// The reverse of cardSwap's "pick a card in the deck, get swap-in candidates" flow:
// given a card the user wants to add, rank every other deck card by cut-worthiness
// using the same signals as the rest of the app (cardFit's misfit reasons, cutRanking's
// boosts/penalties) so this never disagrees with the trim drawer / Optimize / Curve tabs.
import type { ScryfallCard, GeneratedDeck, Misfit, MisfitReason } from '@/types';
import { isAnyLand } from '../scryfall/client';
import { computeMisfits } from './cardFit';
import {
  buildComboParticipation,
  isNearMissComboPiece,
  buildConnectivityPercentiles,
  connectivityAdjustment,
  CHANNEL_LAND_BOOST,
  MDFC_LAND_BOOST,
  GAME_CHANGER_KEEP_BOOST,
} from './cutRanking';

export interface RankedCut {
  card: ScryfallCard;
  /** Higher = better cut candidate. */
  cutScore: number;
  /** Short human-readable reasons, worst-first (reuses Misfit reason copy where possible). */
  reasons: string[];
}

function isChannelLand(card: ScryfallCard): boolean {
  return /\bChannel\b/i.test(card.oracle_text ?? '') && isAnyLand(card);
}

function isMdfcLand(card: ScryfallCard): boolean {
  const faces = card.card_faces;
  if (!faces || faces.length < 2) return false;
  const backTypeLine = faces[1]?.type_line ?? '';
  return /land/i.test(backTypeLine) && !/land/i.test(faces[0]?.type_line ?? card.type_line ?? '');
}

/**
 * Rank every card currently in `deck` by how good a cut it'd be to make room for
 * `newCard`. Excludes the commander(s), the new card itself, and any card that's a
 * live (or near-miss) combo piece. Lands only rank against lands; nonlands only
 * against nonlands — mirrors getSwapCandidatesForCard's land-for-land rule.
 */
export function suggestCutCandidates(deck: GeneratedDeck, newCard: ScryfallCard): RankedCut[] {
  const commanderNames = new Set<string>();
  for (const cmdr of [deck.commander, deck.partnerCommander]) {
    if (!cmdr) continue;
    commanderNames.add(cmdr.name);
    if (cmdr.name.includes(' // ')) commanderNames.add(cmdr.name.split(' // ')[0]);
  }

  const newCardNorm = newCard.name.includes(' // ') ? newCard.name.split(' // ')[0] : newCard.name;
  const newCardIsLand = isAnyLand(newCard);

  const allCards = Object.values(deck.categories).flat();
  const pool = allCards.filter(c => {
    if (commanderNames.has(c.name)) return false;
    if (c.name === newCard.name || c.name === newCardNorm) return false;
    if (isAnyLand(c) !== newCardIsLand) return false;
    return true;
  });

  const comboParticipation = buildComboParticipation(deck.detectedCombos);
  const eligible = pool.filter(c =>
    !comboParticipation.has(c.name) && !isNearMissComboPiece(c.name, deck.detectedCombos)
  );

  // No lift-graph connectivity scan is available synchronously from a GeneratedDeck snapshot
  // (it's computed async elsewhere, e.g. deckAnalyzer/deckTrimmer); connectivityAdjustment is a
  // no-op until one is, same as those callers' fallback when the scan hasn't resolved yet.
  const conn = buildConnectivityPercentiles(eligible, undefined);
  const gameChangerSet = new Set(deck.gameChangerNames ?? []);

  if (newCardIsLand) {
    // Lands aren't scored by computeMisfits (it skips lands entirely) — rank by a simpler
    // "worse land" heuristic: boosted lands (channel/MDFC) are the least cuttable.
    const ranked: RankedCut[] = eligible.map(card => {
      let score = 0;
      const reasons: string[] = [];
      if (isChannelLand(card)) { score -= CHANNEL_LAND_BOOST; reasons.push('Channel land — near-auto-include'); }
      if (isMdfcLand(card)) { score -= MDFC_LAND_BOOST; reasons.push('MDFC land — strictly better than a spell-only equivalent'); }
      score += connectivityAdjustment(conn, card.name) * -1;
      if (reasons.length === 0) reasons.push('Basic/utility land with no special upside');
      return { card, cutScore: score, reasons };
    });
    ranked.sort((a, b) => b.cutScore - a.cutScore);
    return ranked;
  }

  const misfits = computeMisfits({
    cards: eligible,
    cardInclusionMap: deck.cardInclusionMap ?? {},
    cardSynergyMap: deck.cardSynergyMap,
    themeMembership: null,
    commanderNames: [...commanderNames],
  });
  const misfitByName = new Map<string, Misfit>(misfits.map(m => [m.card.name, m]));

  const reasonLabel = (r: MisfitReason) => r.label;

  const ranked: RankedCut[] = eligible.map(card => {
    const misfit = misfitByName.get(card.name);
    let score = misfit?.misfitScore ?? 0;
    const reasons: string[] = misfit ? misfit.reasons.map(reasonLabel) : [];

    score += connectivityAdjustment(conn, card.name) * -1; // least-connected → higher cut score

    if (gameChangerSet.has(card.name)) {
      score -= GAME_CHANGER_KEEP_BOOST;
      reasons.push('Bracket game changer — kept as a last resort');
    }

    if (reasons.length === 0) {
      const incl = deck.cardInclusionMap?.[card.name];
      reasons.push(incl != null ? `Played in ${incl.toFixed(0)}% of decklists` : 'No standout weakness found');
    }

    return { card, cutScore: score, reasons };
  });

  ranked.sort((a, b) => b.cutScore - a.cutScore);
  return ranked;
}
