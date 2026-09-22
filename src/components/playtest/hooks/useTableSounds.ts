/**
 * Fires the shuffle and draw cues off the store's existing tick counters.
 *
 * Both events already publish a "this happened" signal that the UI watches for animations
 * (PlaytestPile flips the library on `shuffleTick`), and those ticks are the better trigger than
 * the actions themselves for two reasons: a shuffle reaches the library down seven different paths
 * — the button, a mulligan, Timetwister, emptying a zone back in — and one tick covers all of
 * them; and a tick bumps once per operation, so `draw(7)` for an opening hand is a single card
 * sound rather than seven layered on top of each other.
 *
 * The card-landing cue rides the same idea one step further: rather than instrumenting each of the
 * actions that can put a permanent down (a move from any zone, addPermanent, spawnToken, a copy),
 * it watches the battlefield grow. One rule, and it cannot fall out of date as new ways to make a
 * token get added.
 *
 * Counters and taps have neither a tick nor a countable effect, so those two play from the store
 * actions themselves, next to the floating text those actions already fire.
 */
import { useEffect, useRef } from 'react';
import { usePlaytestStore } from '@/store/playtestStore';
import { playCue } from '@/services/playtest/playtestSound';

export function useTableSounds(): void {
  const shuffleTick = usePlaytestStore(s => s.shuffleTick);
  const libraryDrawTick = usePlaytestStore(s => s.libraryDrawTick);
  const onField = usePlaytestStore(s => s.battlefield.length);
  // Seeded from the first render so hydrating a deck — which lands with ticks already advanced and
  // a commander already out — doesn't greet you with sounds you didn't ask for.
  const seen = useRef({ shuffle: shuffleTick, draw: libraryDrawTick, onField });

  useEffect(() => {
    if (shuffleTick !== seen.current.shuffle) {
      seen.current.shuffle = shuffleTick;
      playCue('shuffle');
    }
  }, [shuffleTick]);

  useEffect(() => {
    if (libraryDrawTick !== seen.current.draw) {
      seen.current.draw = libraryDrawTick;
      playCue('draw');
    }
  }, [libraryDrawTick]);

  useEffect(() => {
    // Only growth is a landing. A board wipe shrinking the battlefield is not five cards arriving,
    // and a card sliding to a new position never changes the count at all.
    const grew = onField > seen.current.onField;
    seen.current.onField = onField;
    if (grew) playCue('land');
  }, [onField]);
}
