import { useEffect, useMemo, useState, useCallback } from 'react';
import { useUserLists } from '@/hooks/useUserLists';
import { getRelevantCards } from '@/services/deckUpgrades/getRelevantCards';
import { computeNewUpgrades, parseIntendedThemes } from '@/services/deckUpgrades/deckUpgrades';
import type { UserCardList } from '@/types';

/** Re-fetch recommendations if the snapshot is older than this. */
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

export interface DeckUpgradesResult {
  /** New-for-this-commander cards not in the deck and not yet seen (relevance order). */
  newCards: string[];
  /** Record cards as seen so they stop flagging. */
  markSeen: (names: string[]) => void;
}

/**
 * Computes the "new cards for this deck" set for a saved commander deck.
 * - Fetches new-for-commander cards on open when missing or older than REFRESH_MS.
 * - First open SHOWS the current new cards (short list, so no wall).
 * - A later refetch baselines everything already shown, so only cards that became
 *   new since the last fetch surface — keeping it a recurring trigger, not a nag.
 * - Persists `seen` to the list's upgradeState (no updatedAt bump).
 * Non-commander decks / generic lists get an inert result.
 */
export function useDeckUpgrades(list: UserCardList): DeckUpgradesResult {
  const { setUpgradeState } = useUserLists();
  const isCommanderDeck = list.type === 'deck' && !!list.commanderName;

  // Local mirror of the persisted snapshot so the panel updates immediately.
  const [snapshot, setSnapshot] = useState(list.upgradeState);
  useEffect(() => { setSnapshot(list.upgradeState); }, [list.id, list.upgradeState]);

  // Fetch-on-open / refresh. Runs once per list.id unless stale.
  useEffect(() => {
    if (!isCommanderDeck || !list.commanderName) return;
    const existing = list.upgradeState;
    const fresh = existing && Date.now() - existing.fetchedAt < REFRESH_MS;
    if (fresh) return;

    let cancelled = false;
    getRelevantCards({
      commanderName: list.commanderName,
      partnerName: list.partnerCommanderName,
      deckCardNames: [...new Set([list.commanderName, list.partnerCommanderName, ...list.cards].filter(Boolean) as string[])],
      // Intended themes: persisted at save time; older decks recover them from the summary text.
      themes: list.usedThemes?.length ? list.usedThemes : parseIntendedThemes(list.generationSummary),
      colorIdentity: list.cachedColorIdentity,
    }).then(recs => {
      if (cancelled || recs.length === 0) return;
      const names = recs.map(r => r.name);
      const next = existing
        // Refetch: baseline everything previously shown (prior recs + seen), so
        // only cards that became new since the last fetch surface now.
        ? { recommendations: names, seen: Array.from(new Set([...existing.seen, ...existing.recommendations])), fetchedAt: Date.now() }
        // First open: show the current new cards (seen starts empty).
        : { recommendations: names, seen: [], fetchedAt: Date.now() };
      setSnapshot(next);
      setUpgradeState(list.id, next);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.id]);

  const newCards = useMemo(() => {
    if (!snapshot) return [];
    return computeNewUpgrades(snapshot.recommendations, list.cards, snapshot.seen);
  }, [snapshot, list.cards]);

  const markSeen = useCallback((names: string[]) => {
    if (!snapshot || names.length === 0) return;
    const merged = Array.from(new Set([...snapshot.seen, ...names]));
    const next = { ...snapshot, seen: merged };
    setSnapshot(next);
    setUpgradeState(list.id, next);
  }, [snapshot, list.id, setUpgradeState]);

  return { newCards, markSeen };
}
