import { useEffect, useMemo, useState } from 'react';
import type { ScryfallCard } from '@/types';
import {
  scanLiftCandidates,
  LIFT_SCAN_CACHE,
  liftDeckKey,
  buildLiftScanInputs,
  type LiftCandidate,
} from '@/services/optimizer/liftClusters';

interface UseLiftScanOpts {
  enabled: boolean;
  commanderName: string;
  partnerCommanderName?: string;
  /** Deck cards (spells + lands, commander excluded) — MUST be the same array the tab/connectivity key on. */
  cards: ScryfallCard[];
}

interface UseLiftScanResult {
  /** Deck-wide lift candidates, or null until a scan resolves (null = "still loading" for the gate). */
  candidates: LiftCandidate[] | null;
  loading: boolean;
}

/**
 * Deck-wide lift candidates for the current decklist, sourced from the shared lift scan.
 * Reuses LIFT_SCAN_CACHE (warmed by the Lift Web tab, Overview bento, and trim drawer) so a deck the
 * user has already inspected resolves instantly and EDHREC isn't hit twice; otherwise runs the same
 * scan and populates the cache for those surfaces too. On failure it resolves to [] (not null) so the
 * consumer's gate releases and falls back to the un-blended list.
 */
export function useLiftScan(opts: UseLiftScanOpts): UseLiftScanResult {
  const { enabled, commanderName, partnerCommanderName, cards } = opts;
  const deckKey = useMemo(
    () => liftDeckKey(commanderName, partnerCommanderName, cards),
    [commanderName, partnerCommanderName, cards],
  );
  const [state, setState] = useState<UseLiftScanResult>({ candidates: null, loading: false });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const cached = LIFT_SCAN_CACHE.get(deckKey);
    if (cached) {
      setState({ candidates: cached.candidates, loading: false });
      return;
    }
    if (cards.length === 0) {
      setState({ candidates: [], loading: false });
      return;
    }

    setState(s => ({ candidates: s.candidates, loading: true }));
    const inputs = buildLiftScanInputs({ commanderName, partnerCommanderName, currentCards: cards });
    scanLiftCandidates({ ...inputs, isCancelled: () => cancelled })
      .then(result => {
        if (cancelled) return;
        LIFT_SCAN_CACHE.set(deckKey, result);
        setState({ candidates: result.candidates, loading: false });
      })
      .catch(() => { if (!cancelled) setState({ candidates: [], loading: false }); });

    return () => { cancelled = true; };
    // deckKey captures commander/partner/cards; the rest are stable for a given key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, deckKey]);

  return state;
}
