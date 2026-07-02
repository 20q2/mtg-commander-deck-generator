import { fetchCommanderData, fetchPartnerCommanderData } from '@/services/edhrec/client';
import type { RankedCard } from './deckUpgrades';

/** Cap on how many new cards to track per deck. */
const MAX_RECOMMENDATIONS = 40;

/**
 * v1 producer: genuinely NEW cards for this commander — the ones EDHREC flags as
 * recently printed / newly rising — that fit the deck, ranked by synergy (highest
 * first). This is deliberately NOT the generic top-synergy gap pool (that's what
 * the inspector overview already does); it only surfaces newness, which is the
 * "decks change on their own" signal.
 *
 * The EDHREC client caches results (14-day in-memory + IndexedDB), so re-calling
 * for an already-viewed deck is effectively free.
 *
 * Swappable contract: v2 will merge in Scryfall recent-set-in-identity cards and
 * (eventually) the S3 staples/spoiler feed, keeping this signature + return shape.
 *
 * Returns [] on any failure (fire-and-forget, never throws to the caller).
 *
 * NOTE: newness is read from EDHREC's `isNewCard` flag on the commander's card
 * pool. A brand-new card that also appears in a typed list with higher inclusion
 * can lose the flag during EDHREC-side dedupe; acceptable for v1.
 */
export async function getRelevantCards(
  commanderName: string,
  partnerName?: string,
): Promise<RankedCard[]> {
  try {
    const data = partnerName
      ? await fetchPartnerCommanderData(commanderName, partnerName)
      : await fetchCommanderData(commanderName);
    return data.cardlists.allNonLand
      .filter(c => c.isNewCard)
      .map(c => ({
        name: c.name,
        inclusion: c.inclusion,
        synergy: c.synergy,
        isNew: true,
      }))
      // Highest-synergy new cards float to the top.
      .sort((a, b) => (b.synergy ?? 0) - (a.synergy ?? 0))
      .slice(0, MAX_RECOMMENDATIONS);
  } catch {
    return [];
  }
}
