import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ExplorerSort, ColorMatch, SortDir } from '@/services/spellchroma/explorerSearch';
import {
  DEFAULT_FILTERS,
  parseFilters,
  serializeFilters,
  type ExplorerFilterState,
} from './explorerUrlState';

// Debounce a value so per-keystroke text changes don't rewrite the URL each press.
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/**
 * Owns all explorer filter state and mirrors it to the URL query string. Seeds from
 * the URL on mount (lazy), writes changes back with { replace: true } so filter
 * tweaks don't spam history. The text filter is debounced into the URL. Foreign
 * params (deck, card) are preserved by serializeFilters.
 */
export function useExplorerFilters() {
  const [, setSearchParams] = useSearchParams();

  // Lazy init from the live URL — runs before first render so a shared link skips
  // the landing splash (which keys off selectedTags.length).
  const initial = parseFilters(new URLSearchParams(window.location.search));
  const [selectedTags, setSelectedTags] = useState<string[]>(initial.selectedTags);
  const [colorIdentity, setColorIdentity] = useState<string[]>(initial.colorIdentity);
  const [colorMode, setColorMode] = useState<ColorMatch>(initial.colorMode);
  const [excludedColors, setExcludedColors] = useState<string[]>(initial.excludedColors);
  const [typeFilter, setTypeFilter] = useState<string[]>(initial.typeFilter);
  const [sort, setSort] = useState<ExplorerSort>(initial.sort);
  const [sortDir, setSortDir] = useState<SortDir>(initial.sortDir);
  const [textFilter, setTextFilter] = useState<string>(initial.textFilter);

  // Debounce only the text filter's contribution to the URL.
  const debouncedText = useDebouncedValue(textFilter, 400);

  // Mirror state -> URL. Reads `prev` so foreign params (deck/card) are preserved
  // and only owned keys are rewritten. replace:true keeps history clean.
  useEffect(() => {
    const next: ExplorerFilterState = {
      selectedTags, colorIdentity, colorMode, excludedColors,
      typeFilter, sort, sortDir, textFilter: debouncedText,
    };
    setSearchParams(prev => serializeFilters(next, prev), { replace: true });
  }, [
    selectedTags, colorIdentity, colorMode, excludedColors,
    typeFilter, sort, sortDir, debouncedText, setSearchParams,
  ]);

  // Clear every filter back to default (used by "back to start"). The sync effect
  // above then drops all owned keys from the URL.
  const reset = () => {
    setSelectedTags(DEFAULT_FILTERS.selectedTags);
    setColorIdentity(DEFAULT_FILTERS.colorIdentity);
    setColorMode(DEFAULT_FILTERS.colorMode);
    setExcludedColors(DEFAULT_FILTERS.excludedColors);
    setTypeFilter(DEFAULT_FILTERS.typeFilter);
    setSort(DEFAULT_FILTERS.sort);
    setSortDir(DEFAULT_FILTERS.sortDir);
    setTextFilter(DEFAULT_FILTERS.textFilter);
  };

  return {
    selectedTags, setSelectedTags,
    colorIdentity, setColorIdentity,
    colorMode, setColorMode,
    excludedColors, setExcludedColors,
    typeFilter, setTypeFilter,
    sort, setSort,
    sortDir, setSortDir,
    textFilter, setTextFilter,
    reset,
  };
}
