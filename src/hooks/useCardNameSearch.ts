import { useEffect, useRef, useState } from 'react';
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
  };

  return { query, setQuery, suggestions, loading, clear };
}
