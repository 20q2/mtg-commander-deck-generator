// src/components/deck/optimizer/dashboard/launchpad/useLiftPicks.ts
import { useEffect, useMemo, useState } from 'react';
import type { ScryfallCard } from '@/types';
import {
  scanLiftCandidates, selectTopLiftPicks,
  LIFT_SCAN_CACHE, liftDeckKey, buildLiftScanInputs,
  type LiftCandidate,
} from '@/services/optimizer/liftClusters';

export type LiftPicks = { bomb: LiftCandidate | null; cluster: LiftCandidate | null };

export interface UseLiftPicksOptions {
  commanderName: string;
  partnerCommanderName?: string;
  commander?: ScryfallCard;
  partnerCommander?: ScryfallCard;
  colorIdentity?: string[];
  currentCards: ScryfallCard[];
  /** False defers the scan (e.g. until the job that shows it is opened). */
  enabled?: boolean;
}

/**
 * Background lift scan for Overview teasers. Reads the cache the Lift Web tab writes (and writes it
 * back), so warming here makes the tab instant and EDHREC isn't hit twice. Keyed on the decklist.
 */
export function useLiftPicks(opts: UseLiftPicksOptions): { picks: LiftPicks | null; loading: boolean } {
  const { commander, partnerCommander, commanderName, partnerCommanderName, currentCards, colorIdentity, enabled = true } = opts;
  const deckKey = useMemo(
    () => liftDeckKey(commanderName, partnerCommanderName, currentCards),
    [commanderName, partnerCommanderName, currentCards],
  );
  const [state, setState] = useState<{ picks: LiftPicks | null; loading: boolean }>({ picks: null, loading: true });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const cached = LIFT_SCAN_CACHE.get(deckKey);
    if (cached) {
      setState({ picks: selectTopLiftPicks(cached.candidates), loading: false });
      return;
    }
    if (currentCards.length === 0) {
      setState({ picks: null, loading: false });
      return;
    }
    setState({ picks: null, loading: true });
    const inputs = buildLiftScanInputs({
      commander, partnerCommander, commanderName, partnerCommanderName, currentCards, colorIdentity,
    });
    scanLiftCandidates({ ...inputs, isCancelled: () => cancelled })
      .then(result => {
        if (cancelled) return;
        LIFT_SCAN_CACHE.set(deckKey, result);
        setState({ picks: selectTopLiftPicks(result.candidates), loading: false });
      })
      .catch(() => { if (!cancelled) setState({ picks: null, loading: false }); });
    return () => { cancelled = true; };
    // deckKey captures commander/partner/cards; the rest are stable for a given key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckKey, enabled]);

  return state;
}
