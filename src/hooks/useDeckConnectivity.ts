import { useEffect, useMemo, useState } from 'react';
import type { ScryfallCard } from '@/types';
import {
  scanLiftCandidates,
  LIFT_SCAN_CACHE,
  liftDeckKey,
  buildLiftScanInputs,
  type DeckLink,
} from '@/services/optimizer/liftClusters';

interface UseDeckConnectivityOpts {
  /** Only scan while the consumer is visible (e.g. the trim drawer is open). */
  enabled: boolean;
  commanderName: string;
  partnerCommanderName?: string;
  /** Deck cards (spells + lands, commander excluded — matches TrimDeckDialog's `cards`). */
  cards: ScryfallCard[];
}

interface UseDeckConnectivityResult {
  /** Per-card deck-internal synergy connectivity, or null until a scan resolves. */
  connectivity: Record<string, number> | null;
  /** Deck↔deck ties from the same scan (used to draw the synergy web), or null until resolved. */
  deckLinks: DeckLink[] | null;
  loading: boolean;
}

/**
 * Deck-internal synergy connectivity for the current decklist, sourced from the shared lift scan.
 * Reuses LIFT_SCAN_CACHE (warmed by the Lift Web tab and Overview bento) so a deck the user has
 * already inspected resolves instantly and EDHREC isn't hit twice; otherwise it runs the same
 * scan and populates the cache for those surfaces too. Purely additive — the trim planner falls
 * back to relevancy-only ranking while this is loading or if the scan fails.
 */
export function useDeckConnectivity(opts: UseDeckConnectivityOpts): UseDeckConnectivityResult {
  const { enabled, commanderName, partnerCommanderName, cards } = opts;
  const deckKey = useMemo(
    () => liftDeckKey(commanderName, partnerCommanderName, cards),
    [commanderName, partnerCommanderName, cards],
  );
  const [state, setState] = useState<UseDeckConnectivityResult>({ connectivity: null, deckLinks: null, loading: false });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const cached = LIFT_SCAN_CACHE.get(deckKey);
    if (cached?.connectivity) {
      setState({ connectivity: cached.connectivity, deckLinks: cached.deckLinks, loading: false });
      return;
    }
    if (cards.length === 0) {
      setState({ connectivity: null, deckLinks: null, loading: false });
      return;
    }

    setState(s => ({ connectivity: s.connectivity, deckLinks: s.deckLinks, loading: true }));
    const inputs = buildLiftScanInputs({ commanderName, partnerCommanderName, currentCards: cards });
    scanLiftCandidates({ ...inputs, isCancelled: () => cancelled })
      .then(result => {
        if (cancelled) return;
        LIFT_SCAN_CACHE.set(deckKey, result);
        setState({ connectivity: result.connectivity, deckLinks: result.deckLinks, loading: false });
      })
      .catch(() => { if (!cancelled) setState({ connectivity: null, deckLinks: null, loading: false }); });

    return () => { cancelled = true; };
    // deckKey captures commander/partner/cards; the rest are stable for a given key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, deckKey]);

  return state;
}
