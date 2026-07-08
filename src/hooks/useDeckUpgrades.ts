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
  /** Already-seen recommendations still not in the deck (relevance order) — padding
   *  so the panel can fill a row even when only a card or two is genuinely new. */
  fillCards: string[];
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

  // Theme hierarchy (mirrors the Inspector's New Cards tab): the user's declared
  // themes → generation provenance → legacy summary parse.
  const themes = list.themes?.length ? list.themes.map(t => t.name)
    : list.usedThemes?.length ? list.usedThemes
    : parseIntendedThemes(list.generationSummary) ?? [];
  const themesKey = themes.map(t => t.trim().toLowerCase()).join('|');

  // Local mirror of the persisted snapshot so the panel updates immediately.
  const [snapshot, setSnapshot] = useState(list.upgradeState);
  useEffect(() => { setSnapshot(list.upgradeState); }, [list.id, list.upgradeState]);

  // Fetch-on-open / refresh. Runs once per list.id unless stale or the deck's
  // themes changed since the snapshot was taken.
  useEffect(() => {
    if (!isCommanderDeck || !list.commanderName) return;
    const existing = list.upgradeState;
    // A pre-themesKey snapshot counts as stale once, so it gets stamped.
    const fresh = existing && existing.themesKey === themesKey && Date.now() - existing.fetchedAt < REFRESH_MS;
    if (fresh) return;
    const themesChanged = !!existing?.themesKey && existing.themesKey !== themesKey;

    let cancelled = false;
    getRelevantCards({
      commanderName: list.commanderName,
      partnerName: list.partnerCommanderName,
      deckCardNames: [...new Set([list.commanderName, list.partnerCommanderName, ...list.cards].filter(Boolean) as string[])],
      themes,
      colorIdentity: list.cachedColorIdentity,
    }).then(recs => {
      if (cancelled || recs.length === 0) return;
      const names = recs.map(r => r.name);
      const next = existing
        ? themesChanged
          // Theme edit: re-rank for the new themes. Keep seen as-is (adds/dismissals
          // stay hidden) so theme-relevant cards resurface instead of being baselined.
          ? { recommendations: names, seen: existing.seen, fetchedAt: Date.now(), themesKey }
          // Refetch: baseline everything previously shown (prior recs + seen), so
          // only cards that became new since the last fetch surface now.
          : { recommendations: names, seen: Array.from(new Set([...existing.seen, ...existing.recommendations])), fetchedAt: Date.now(), themesKey }
        // First open: show the current new cards (seen starts empty).
        : { recommendations: names, seen: [], fetchedAt: Date.now(), themesKey };
      setSnapshot(next);
      setUpgradeState(list.id, next);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.id, themesKey]);

  const newCards = useMemo(() => {
    if (!snapshot) return [];
    return computeNewUpgrades(snapshot.recommendations, list.cards, snapshot.seen);
  }, [snapshot, list.cards]);

  const fillCards = useMemo(() => {
    if (!snapshot) return [];
    const inDeck = new Set(list.cards);
    const isNew = new Set(newCards);
    return snapshot.recommendations.filter(n => !inDeck.has(n) && !isNew.has(n));
  }, [snapshot, list.cards, newCards]);

  const markSeen = useCallback((names: string[]) => {
    if (!snapshot || names.length === 0) return;
    const merged = Array.from(new Set([...snapshot.seen, ...names]));
    const next = { ...snapshot, seen: merged };
    setSnapshot(next);
    setUpgradeState(list.id, next);
  }, [snapshot, list.id, setUpgradeState]);

  return { newCards, fillCards, markSeen };
}
