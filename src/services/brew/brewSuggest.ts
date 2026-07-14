/**
 * The "Suggestions" preference: an opt-out highlight of the engine's top-scored card or two in a
 * cracked fan (Lightbulb + lavender — the same "next best move" pairing the Inspector uses).
 * Persisted per player. Lives in its own tiny external store (not component state) because the
 * TOGGLE renders in the HUD (BrewHealthStrip) while the value is CONSUMED on the pack screen
 * (BrewPackCrack) — two components that aren't parent/child, so they subscribe to a shared source.
 */
import { useSyncExternalStore } from 'react';

const PREF_KEY = 'mtg-brew-suggest';

let enabled = (() => {
  try { return localStorage.getItem(PREF_KEY) !== 'false'; } catch { return true; }
})();

const listeners = new Set<() => void>();

export function isBrewSuggestEnabled(): boolean {
  return enabled;
}

export function setBrewSuggestEnabled(on: boolean): void {
  enabled = on;
  try { localStorage.setItem(PREF_KEY, on ? 'true' : 'false'); } catch { /* ignore */ }
  listeners.forEach(l => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Live-synced [enabled, setEnabled] — any consumer re-renders when the toggle flips anywhere. */
export function useBrewSuggest(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, isBrewSuggestEnabled, isBrewSuggestEnabled);
  return [on, setBrewSuggestEnabled];
}
