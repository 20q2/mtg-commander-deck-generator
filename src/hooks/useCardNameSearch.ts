import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { autocompleteCardName } from '@/services/scryfall/client';

export interface CardNameSearchOptions {
  /** Minimum query length before searching (Scryfall autocomplete needs ≥2). */
  minChars?: number;
  /** Debounce window in ms before firing the request. */
  debounceMs?: number;
  /** Cap on suggestions returned. */
  limit?: number;
  /** Lower-cased names to drop from suggestions (e.g. cards already in the deck). */
  exclude?: Set<string>;
}

export interface CardNameSearch {
  query: string;
  setQuery: (q: string) => void;
  suggestions: string[];
  loading: boolean;
  clear: () => void;
  /**
   * The suggestion Enter should act on. Starts on the top row and is moved by
   * ↑/↓ via {@link CardNameSearch.navKeyDown}, or by the pointer through
   * `setActiveIndex` so hover and keyboard never show two highlights.
   */
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  /** `suggestions[activeIndex]`, or undefined when there are none. */
  activeSuggestion: string | undefined;
  /**
   * Call first in the input's onKeyDown. Handles ↑/↓ (wrapping) and returns
   * true when it consumed the key, so the caller can return early.
   */
  navKeyDown: (e: KeyboardEvent) => boolean;
  /**
   * Attach to the element wrapping the suggestion rows; each row needs
   * `data-suggestion-index={i}`. Keeps the highlighted row scrolled into view.
   */
  listRef: RefObject<HTMLDivElement>;
}

/**
 * Shared card-name autocomplete. Wraps Scryfall's `/cards/autocomplete` endpoint
 * (the forgiving, name-only suggester) with debounce, min-length gating, and an
 * optional exclude set. This is the canonical card-name search used across the
 * app — prefer it over ad-hoc `searchCards` calls for "add a card by name" UIs,
 * which over-constrain partial typing with `f:commander`/color filters.
 *
 * Presentation stays with the caller; this owns only the query → suggestions
 * logic. Resolve a chosen name to a full card via `getCardByName` when needed.
 */
export function useCardNameSearch(options: CardNameSearchOptions = {}): CardNameSearch {
  const { minChars = 2, debounceMs = 200, limit = 8 } = options;
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Held in a ref so changing the exclude set (e.g. after adding a card) doesn't
  // re-fire the debounced request; it's applied when results come back.
  const excludeRef = useRef(options.exclude);
  excludeRef.current = options.exclude;

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < minChars) { setSuggestions([]); setLoading(false); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const names = await autocompleteCardName(q);
        const exclude = excludeRef.current;
        const kept = exclude ? names.filter(n => !exclude.has(n.toLowerCase())) : names;
        setSuggestions(kept.slice(0, limit));
        setActiveIndex(0);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, debounceMs);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query, minChars, debounceMs, limit]);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    setQuery('');
    setSuggestions([]);
    setLoading(false);
    setActiveIndex(0);
  };

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-suggestion-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const navKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return false;
    if (suggestions.length === 0) return false;
    e.preventDefault();
    const n = suggestions.length;
    setActiveIndex(i => (e.key === 'ArrowDown' ? i + 1 : i - 1 + n) % n);
    return true;
  };

  return {
    query, setQuery, suggestions, loading, clear,
    activeIndex, setActiveIndex, activeSuggestion: suggestions[activeIndex], navKeyDown, listRef,
  };
}
