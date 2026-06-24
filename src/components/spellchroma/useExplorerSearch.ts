import { useEffect, useRef, useState } from 'react';
import type { ScryfallCard } from '@/types';
import {
  searchTagPage,
  searchAllTagPages,
  type ExplorerSort,
  type ExplorerFilters,
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
 * Drives the explorer results. Page 1 refetches on any change to the (tags,
 * filters, sort) key; `loadAll` fetches remaining pages and appends. An async
 * token guards against out-of-order responses when the key changes mid-flight.
 */
export function useExplorerSearch(slugs: string[], filters: ExplorerFilters, sort: ExplorerSort) {
  const [state, setState] = useState<ExplorerState>(EMPTY);
  const tokenRef = useRef(0);
  const key = [
    [...slugs].sort().join(','),
    [...filters.colorIdentity].sort().join(''),
    filters.colorMode,
    [...filters.excludedColors].sort().join(''),
    [...filters.typeFilter].sort().join(','),
    sort,
  ].join('|');

  useEffect(() => {
    if (slugs.length === 0) { setState(EMPTY); return; }
    const token = ++tokenRef.current;
    setState(s => ({ ...EMPTY, loading: true, cards: s.cards }));
    searchTagPage(slugs, filters, sort, 1)
      .then(res => {
        if (token !== tokenRef.current) return; // stale
        setState({
          cards: res.data, total: res.total_cards ?? res.data.length,
          hasMore: res.has_more, loading: false, loadingAll: false, error: false,
        });
      })
      .catch(() => {
        if (token !== tokenRef.current) return;
        setState({ ...EMPTY, error: true });
      });
    // key encodes slugs+filters+sort; intentionally the only dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loadAll = async () => {
    if (!state.hasMore || state.loadingAll) return;
    const token = tokenRef.current;
    setState(s => ({ ...s, loadingAll: true }));
    try {
      const all = await searchAllTagPages(slugs, filters, sort,
        { object: 'list', total_cards: state.total, has_more: true, data: state.cards });
      if (token !== tokenRef.current) return;
      setState(s => ({ ...s, cards: all, hasMore: false, loadingAll: false }));
    } catch {
      if (token !== tokenRef.current) return;
      setState(s => ({ ...s, loadingAll: false, error: true }));
    }
  };

  return { ...state, loadAll };
}
