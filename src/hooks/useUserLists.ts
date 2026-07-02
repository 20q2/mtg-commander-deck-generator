import { useState, useEffect, useCallback } from 'react';
import { getCardsByNames } from '@/services/scryfall/client';
import { useStore } from '@/store';
import type { UserCardList, ScryfallCard } from '@/types';

const USER_LISTS_KEY = 'mtg-deck-builder-user-lists';
const LAST_ADD_TARGET_KEY = 'mtg-deck-builder-last-add-target';
const TYPES = ['Battle', 'Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land'];
const WUBRG = ['W', 'U', 'B', 'R', 'G'];

export function loadUserLists(): UserCardList[] {
  try {
    const stored = localStorage.getItem(USER_LISTS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Failed to load user lists from localStorage:', e);
  }
  return [];
}

function saveUserLists(lists: UserCardList[]): void {
  try {
    localStorage.setItem(USER_LISTS_KEY, JSON.stringify(lists));
  } catch (e) {
    console.warn('Failed to save user lists to localStorage:', e);
  }
}

/** Fetch card data and compute cached display fields for a list */
async function computeCachedFields(
  cards: string[],
  commanderName?: string,
  heroCardName?: string,
): Promise<Pick<UserCardList, 'cachedTypeBreakdown' | 'cachedColorIdentity' | 'cachedCommanderArtUrl' | 'cachedListArtUrl'>> {
  if (cards.length === 0) return {};
  try {
    const cardMap = await getCardsByNames(cards);

    // Type breakdown
    const typeBreakdown: Record<string, number> = {};
    for (const name of cards) {
      const card = cardMap.get(name);
      if (!card) continue;
      const typeLine = card.type_line?.toLowerCase() ?? '';
      const type = TYPES.find(t => typeLine.includes(t.toLowerCase())) ?? 'Other';
      typeBreakdown[type] = (typeBreakdown[type] ?? 0) + 1;
    }

    // Color identity — computed for ALL lists (not just commander decks)
    // so the overview can show a colored badge on every list.
    const colors = new Set<string>();
    for (const [, card] of cardMap) {
      for (const c of card.color_identity ?? []) colors.add(c);
    }
    const colorIdentity: string[] = WUBRG.filter(c => colors.has(c));

    // Helper: extract art_crop with DFC fallback
    const artOf = (card: ScryfallCard | undefined): string | undefined => {
      if (!card) return undefined;
      return card.image_uris?.art_crop
        ?? card.card_faces?.[0]?.image_uris?.art_crop
        ?? undefined;
    };

    // Commander art (commander decks only)
    let commanderArtUrl: string | undefined;
    if (commanderName) {
      commanderArtUrl = artOf(cardMap.get(commanderName));
    }

    // List art (non-commander lists). Resolution priority:
    //   1. heroCardName (if still present in list.cards)
    //   2. first card with art_crop
    let listArtUrl: string | undefined;
    if (!commanderName) {
      if (heroCardName && cards.includes(heroCardName)) {
        listArtUrl = artOf(cardMap.get(heroCardName));
      }
      if (!listArtUrl) {
        for (const name of cards) {
          const url = artOf(cardMap.get(name));
          if (url) { listArtUrl = url; break; }
        }
      }
    }

    return {
      cachedTypeBreakdown: Object.keys(typeBreakdown).length > 0 ? typeBreakdown : undefined,
      cachedColorIdentity: colorIdentity,
      cachedCommanderArtUrl: commanderArtUrl,
      cachedListArtUrl: listArtUrl,
    };
  } catch {
    return {};
  }
}

interface CreateListOptions {
  type?: 'list' | 'deck';
  commanderName?: string;
  partnerCommanderName?: string;
  deckSize?: number;
  primer?: string;
  generationSummary?: string;
  heroCardName?: string;
}

// ─── Shared state: all useUserLists() instances stay in sync ─────────
type Listener = (lists: UserCardList[]) => void;
const listeners = new Set<Listener>();
let sharedLists: UserCardList[] = loadUserLists();
// Module-level guard so we only run the one-shot backfill once per page load,
// regardless of how many components mount useUserLists.
let backfillDone = false;

function broadcast(next: UserCardList[]) {
  sharedLists = next;
  saveUserLists(next);
  for (const fn of listeners) fn(next);
}

function updateShared(updater: (prev: UserCardList[]) => UserCardList[]) {
  broadcast(updater(sharedLists));
}

// ─── Last "Add to …" target: powers the ethereal quick-shortcut in the card
// context menu. Persisted so the shortcut survives reloads, and shared across
// all hook instances so recording an add in one menu updates every other. ──
export interface LastAddTarget {
  listId: string;
  board?: 'main' | 'sideboard' | 'maybeboard';
}

function loadLastAddTarget(): LastAddTarget | null {
  try {
    const stored = localStorage.getItem(LAST_ADD_TARGET_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed.listId === 'string') return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

let sharedLastAddTarget: LastAddTarget | null = loadLastAddTarget();
const lastAddListeners = new Set<(t: LastAddTarget | null) => void>();

function setSharedLastAddTarget(next: LastAddTarget | null) {
  sharedLastAddTarget = next;
  try {
    if (next) localStorage.setItem(LAST_ADD_TARGET_KEY, JSON.stringify(next));
    else localStorage.removeItem(LAST_ADD_TARGET_KEY);
  } catch { /* ignore */ }
  for (const fn of lastAddListeners) fn(next);
}

/**
 * Subscribes to the last "Add to …" target only — deliberately independent of
 * the (much noisier) lists state so the many card-context menus don't re-render
 * every time any list changes.
 */
export function useLastAddTarget() {
  const [target, setTarget] = useState<LastAddTarget | null>(() => sharedLastAddTarget);
  useEffect(() => {
    const listener = (t: LastAddTarget | null) => setTarget(t);
    lastAddListeners.add(listener);
    if (sharedLastAddTarget !== target) setTarget(sharedLastAddTarget);
    return () => { lastAddListeners.delete(listener); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const recordLastAddTarget = useCallback((t: LastAddTarget) => setSharedLastAddTarget(t), []);
  return { lastAddTarget: target, recordLastAddTarget };
}

export function useUserLists() {
  const [lists, setLists] = useState<UserCardList[]>(() => sharedLists);

  // Subscribe to shared updates
  useEffect(() => {
    const listener: Listener = (next) => setLists(next);
    listeners.add(listener);
    // Sync in case shared state changed before mount
    if (sharedLists !== lists) setLists(sharedLists);
    return () => { listeners.delete(listener); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper: update cached fields for a list by id (fire-and-forget)
  const refreshCache = useCallback((listId: string) => {
    const list = sharedLists.find(l => l.id === listId);
    if (!list) return;
    computeCachedFields(list.cards, list.commanderName, list.heroCardName).then(cached => {
      updateShared(p => p.map(l =>
        l.id === listId ? { ...l, ...cached } : l
      ));
    });
  }, []);

  // One-shot backfill: existing lists may be missing cached fields added in
  // later versions. Lists are stale if EITHER the color identity OR the hero
  // art is missing. Commander decks never populate cachedListArtUrl, so we
  // exclude them from the listArt staleness signal.
  useEffect(() => {
    if (backfillDone) return;
    backfillDone = true;
    const stale = sharedLists.filter(l =>
      l.cards.length > 0 && (
        l.cachedColorIdentity === undefined ||
        (!l.commanderName && l.cachedListArtUrl === undefined)
      )
    );
    for (const l of stale) {
      // Fire-and-forget; each call batches its own Scryfall lookups.
      computeCachedFields(l.cards, l.commanderName, l.heroCardName).then(cached => {
        updateShared(prev => prev.map(x => x.id === l.id ? { ...x, ...cached } : x));
      });
    }
  }, []);

  const createList = useCallback((name: string, cards: string[], description = '', options?: CreateListOptions) => {
    const now = Date.now();
    const newList: UserCardList = {
      id: `list-${now}`,
      type: options?.type ?? 'list',
      name,
      description,
      cards,
      commanderName: options?.commanderName,
      partnerCommanderName: options?.partnerCommanderName,
      deckSize: options?.deckSize,
      primer: options?.primer,
      generationSummary: options?.generationSummary,
      heroCardName: options?.heroCardName,
      createdAt: now,
      updatedAt: now,
    };
    updateShared(prev => [newList, ...prev]);
    // Compute cached fields async
    computeCachedFields(cards, options?.commanderName, options?.heroCardName).then(cached => {
      updateShared(prev => prev.map(l =>
        l.id === newList.id ? { ...l, ...cached } : l
      ));
    });
    return newList;
  }, []);

  const updateList = useCallback((id: string, updates: Partial<Pick<UserCardList, 'name' | 'cards' | 'description' | 'type' | 'commanderName' | 'partnerCommanderName' | 'deckSize' | 'sideboard' | 'maybeboard' | 'primer' | 'generationSummary' | 'heroCardName' | 'customCombos'>>) => {
    updateShared(prev => prev.map(l =>
      l.id === id ? { ...l, ...updates, updatedAt: Date.now() } : l
    ));
    // Re-compute cached fields if anything that affects them changed.
    if (updates.cards || updates.commanderName !== undefined || updates.heroCardName !== undefined) {
      setTimeout(() => refreshCache(id), 0);
    }
  }, [refreshCache]);

  const deleteList = useCallback((id: string) => {
    updateShared(prev => prev.filter(l => l.id !== id));
    // Drop the quick-add shortcut if it pointed at the deleted list.
    if (sharedLastAddTarget?.listId === id) setSharedLastAddTarget(null);
    // Clean up orphaned applied list references in the store
    const { customization, updateCustomization } = useStore.getState();
    const includes = customization.appliedIncludeLists || [];
    const excludes = customization.appliedExcludeLists || [];
    if (includes.some(r => r.listId === id)) {
      updateCustomization({ appliedIncludeLists: includes.filter(r => r.listId !== id) });
    }
    if (excludes.some(r => r.listId === id)) {
      updateCustomization({ appliedExcludeLists: excludes.filter(r => r.listId !== id) });
    }
  }, []);

  const duplicateList = useCallback((id: string): string | null => {
    const original = sharedLists.find(l => l.id === id);
    if (!original) return null;
    const now = Date.now();
    const newId = `list-${now}`;
    updateShared(prev => {
      const src = prev.find(l => l.id === id);
      if (!src) return prev;
      const copy: UserCardList = {
        id: newId,
        type: src.type,
        name: `${src.name} (Copy)`,
        description: src.description,
        cards: [...src.cards],
        sideboard: src.sideboard ? [...src.sideboard] : undefined,
        maybeboard: src.maybeboard ? [...src.maybeboard] : undefined,
        commanderName: src.commanderName,
        partnerCommanderName: src.partnerCommanderName,
        primer: src.primer,
        customCombos: src.customCombos ? src.customCombos.map(c => ({ ...c })) : undefined,
        cachedTypeBreakdown: src.cachedTypeBreakdown,
        cachedColorIdentity: src.cachedColorIdentity,
        cachedCommanderArtUrl: src.cachedCommanderArtUrl,
        createdAt: now,
        updatedAt: now,
      };
      return [copy, ...prev];
    });
    return newId;
  }, [sharedLists]);

  const togglePin = useCallback((id: string) => {
    updateShared(prev => prev.map(l =>
      l.id === id ? { ...l, pinnedAt: l.pinnedAt ? undefined : Date.now() } : l
    ));
  }, []);

  const convertToDeck = useCallback((id: string) => {
    updateShared(prev => prev.map(l =>
      l.id === id ? { ...l, type: 'deck' as const, updatedAt: Date.now() } : l
    ));
  }, []);

  const convertToList = useCallback((id: string) => {
    updateShared(prev => prev.map(l =>
      l.id === id ? { ...l, type: 'list' as const, commanderName: undefined, partnerCommanderName: undefined, cachedColorIdentity: undefined, cachedCommanderArtUrl: undefined, updatedAt: Date.now() } : l
    ));
  }, []);

  const exportList = useCallback((id: string): string => {
    const list = sharedLists.find(l => l.id === id);
    if (!list) return '';
    const lines = list.cards.map(c => `1 ${c}`);
    if (list.sideboard && list.sideboard.length > 0) {
      lines.push('', 'Sideboard');
      lines.push(...list.sideboard.map(c => `1 ${c}`));
    }
    if (list.maybeboard && list.maybeboard.length > 0) {
      lines.push('', 'Maybeboard');
      lines.push(...list.maybeboard.map(c => `1 ${c}`));
    }
    return lines.join('\n');
  }, []);

  const getListById = useCallback((id: string) => {
    return sharedLists.find(l => l.id === id) ?? null;
  }, []);

  return { lists, createList, updateList, deleteList, duplicateList, togglePin, convertToDeck, convertToList, exportList, getListById };
}
