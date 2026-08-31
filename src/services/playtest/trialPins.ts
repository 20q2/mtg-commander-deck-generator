import type { ScryfallCard } from '@/types';
import type { TrialPin } from '@/components/playtest/types';

export interface PinResult {
  /** The library with pinned cards removed or repositioned. */
  library: ScryfallCard[];
  /** Cards forced into the opening hand, ahead of the normal draw. */
  forcedHand: ScryfallCard[];
  /** Human-readable notes for the game log. */
  notes: string[];
}

/**
 * Reorder a freshly shuffled library so pinned cards land where the trial asks.
 * Pins can only name cards already in the deck, so anything not found in the
 * library is a real problem worth logging rather than something to conjure up.
 */
export function applyTrialPins(library: ScryfallCard[], pins: TrialPin[]): PinResult {
  if (pins.length === 0) return { library, forcedHand: [], notes: [] };

  const remaining = [...library];
  const forcedHand: ScryfallCard[] = [];
  const topPins: { card: ScryfallCard; topN: number }[] = [];
  const notes: string[] = [];

  for (const pin of pins) {
    const idx = remaining.findIndex(c => c.name === pin.cardName);
    if (idx < 0) {
      notes.push(`Trial card ${pin.cardName} is not in the library`);
      continue;
    }
    const card = remaining.splice(idx, 1)[0];
    if (pin.where === 'hand') forcedHand.push(card);
    else topPins.push({ card, topN: Math.max(1, pin.topN) });
  }

  // Randomise the slot inside the requested window so repeated trials don't
  // always deal the pinned cards in the same order.
  for (const { card, topN } of topPins) {
    const window = Math.min(topN, remaining.length + 1);
    remaining.splice(Math.floor(Math.random() * window), 0, card);
  }

  return { library: remaining, forcedHand, notes };
}
