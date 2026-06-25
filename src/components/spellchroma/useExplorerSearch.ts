import { useEffect, useRef, useState } from 'react';
import type { ScryfallCard } from '@/types';
import {
  searchTagPage,
  searchAllTagPages,
  type ExplorerSort,
  type ExplorerFilters,
  type SortDir,
} from '@/services/spellchroma/explorerSearch';

interface ExplorerState {
  cards: ScryfallCard[];
  total: number;       // total_cards Scryfall reports for the query
  hasMore: boolean;    // more pages beyond what's loaded
  loading: boolean;    // page-1 fetch in flight
  loadingAll: boolean; // "load all" fetch in flight
  error: boolean;
}

const EMPTY: ExplorerState = { cards: [], total: 0, hasMore: false, loading: false, loadingAll: false, error: false };

/**
 * Drives the explorer results. The search identity is tags + filters (NOT sort):
 * a new search always refetches page 1. A sort change only refetches while pages
 * remain unloaded — so the server still picks the correct top-N for the new
 * order. Once everything is loaded, changing sort fires no query at all; the grid
 * re-sorts the loaded cards client-side. `loadAll` fetches remaining pages and
 * appends. An async token guards against out-of-order responses.
 */
export function useExplorerSearch(slugs: string[], filters: ExplorerFilters, sort: ExplorerSort, dir: SortDir = 'asc') {
  const [state, setState] = useState<ExplorerState>(EMPTY);
  const tokenRef = useRef(0);
  // Latest sort/dir + hasMore for the sort effect to read without re-subscribing.
  const sortRef = useRef(sort);
  const dirRef = useRef(dir);
  const hasMoreRef = useRef(false);

  const searchKey = [
    [...slugs].sort().join(','),
    [...filters.colorIdentity].sort().join(''),
    filters.colorMode,
    [...filters.excludedColors].sort().join(''),
    [...filters.typeFilter].sort().join(','),
  ].join('|');

  // Fetch page 1 for the current search + sort, replacing the result set.
  const fetchPage1 = () => {
    if (slugs.length === 0) { setState(EMPTY); hasMoreRef.current = false; return; }
    const token = ++tokenRef.current;
    setState(s => ({ ...EMPTY, loading: true, cards: s.cards }));
    searchTagPage(slugs, filters, sortRef.current, 1, dirRef.current)
      .then(res => {
        if (token !== tokenRef.current) return; // stale
        hasMoreRef.current = res.has_more;
        setState({
          cards: res.data, total: res.total_cards ?? res.data.length,
          hasMore: res.has_more, loading: false, loadingAll: false, error: false,
        });
      })
      .catch(() => {
        if (token !== tokenRef.current) return;
        hasMoreRef.current = false;
        setState({ ...EMPTY, error: true });
      });
  };

  // New search (tags/filters changed) → always refetch page 1.
  useEffect(() => {
    fetchPage1();
    // searchKey encodes slugs+filters; intentionally the only dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey]);

  // Sort or direction changed → refetch ONLY while more pages remain. Fully
  // loaded → no query (the grid sorts the loaded cards client-side).
  const firstSortRun = useRef(true);
  useEffect(() => {
    sortRef.current = sort;
    dirRef.current = dir;
    if (firstSortRun.current) { firstSortRun.current = false; return; }
    if (hasMoreRef.current && slugs.length > 0) fetchPage1();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, dir]);

  const loadAll = async () => {
    if (!state.hasMore || state.loadingAll) return;
    const token = tokenRef.current;
    setState(s => ({ ...s, loadingAll: true }));
    try {
      const all = await searchAllTagPages(slugs, filters, sortRef.current,
        { object: 'list', total_cards: state.total, has_more: true, data: state.cards }, dirRef.current);
      if (token !== tokenRef.current) return;
      hasMoreRef.current = false;
      setState(s => ({ ...s, cards: all, hasMore: false, loadingAll: false }));
    } catch {
      if (token !== tokenRef.current) return;
      setState(s => ({ ...s, loadingAll: false, error: true }));
    }
  };

  return { ...state, loadAll };
}
