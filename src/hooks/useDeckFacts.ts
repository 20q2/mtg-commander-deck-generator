import { useMemo } from 'react';
import { useStore } from '@/store';

/**
 * The active deck's colour identity as a WUBRG string ('' for colourless).
 *
 * Taken from the commander(s) plus every card actually in the deck: for a legal
 * deck the union equals the commander's identity, but this also covers lists
 * with no commander and "choose a colour" commanders, whose printed identity is
 * colourless.
 */
export function useDeckColorIdentity(): string {
  return useStore(s => {
    const deck = s.generatedDeck;
    const seen = new Set<string>();
    const add = (c?: { color_identity?: string[] } | null) => {
      for (const x of c?.color_identity ?? []) seen.add(x.toUpperCase());
    };
    add(deck?.commander ?? s.commander);
    add(deck?.partnerCommander);
    if (deck) for (const arr of Object.values(deck.categories)) for (const c of arr) add(c);
    return ['W', 'U', 'B', 'R', 'G'].filter(x => seen.has(x)).join('');
  });
}

/**
 * Lowercased names of every card in the active deck — commanders included — so
 * a card browser can mark what you already run. `override` wins when the caller
 * already holds the deck's card list (e.g. the list deck view, which renders a
 * saved list rather than the store's generated deck).
 */
export function useDeckNamesLower(override?: string[]): Set<string> {
  const deck = useStore(s => s.generatedDeck);
  return useMemo(() => {
    const names = new Set<string>();
    const add = (n?: string | null) => { if (n) names.add(n.toLowerCase()); };
    if (override?.length) {
      for (const n of override) add(n);
      return names;
    }
    if (!deck) return names;
    add(deck.commander?.name);
    add(deck.partnerCommander?.name);
    for (const cards of Object.values(deck.categories)) for (const c of cards) add(c.name);
    return names;
  }, [override, deck]);
}
