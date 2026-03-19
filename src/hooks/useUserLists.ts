import { useState, useEffect, useCallback } from 'react';
import { getCardsByNames } from '@/services/scryfall/client';
import { useStore } from '@/store';
import type { UserCardList } from '@/types';

const USER_LISTS_KEY = 'mtg-deck-builder-user-lists';
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
): Promise<Pick<UserCardList, 'cachedTypeBreakdown' | 'cachedColorIdentity' | 'cachedCommanderArtUrl'>> {
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

    // Color identity (only meaningful with a commander)
    let colorIdentity: string[] | undefined;
    if (commanderName) {
      const colors = new Set<string>();
      for (const [, card] of cardMap) {
        for (const c of card.color_identity ?? []) colors.add(c);
      }
      colorIdentity = WUBRG.filter(c => colors.has(c));
    }

    // Commander art
    let commanderArtUrl: string | undefined;
    if (commanderName) {
      const cmdCard = cardMap.get(commanderName);
      if (cmdCard) {
        commanderArtUrl = cmdCard.image_uris?.art_crop
          ?? cmdCard.card_faces?.[0]?.image_uris?.art_crop
          ?? undefined;
      }
    }

    return {
      cachedTypeBreakdown: Object.keys(typeBreakdown).length > 0 ? typeBreakdown : undefined,
      cachedColorIdentity: colorIdentity,
      cachedCommanderArtUrl: commanderArtUrl,
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
}

export function useUserLists() {
  const [lists, setLists] = useState<UserCardList[]>(() => loadUserLists());

  // Auto-save whenever lists change
  useEffect(() => {
    saveUserLists(lists);
  }, [lists]);

  // Helper: update cached fields for a list by id (fire-and-forget)
  const refreshCache = useCallback((listId: string) => {
    setLists(prev => {
      const list = prev.find(l => l.id === listId);
      if (!list) return prev;
      // Fire async computation, update state when done
      computeCachedFields(list.cards, list.commanderName).then(cached => {
        setLists(p => p.map(l =>
          l.id === listId ? { ...l, ...cached } : l
        ));
      });
      return prev; // Return unchanged for now — async will update later
    });
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
      createdAt: now,
      updatedAt: now,
    };
    setLists(prev => [newList, ...prev]);
    // Compute cached fields async
    computeCachedFields(cards, options?.commanderName).then(cached => {
      setLists(prev => prev.map(l =>
        l.id === newList.id ? { ...l, ...cached } : l
      ));
    });
    return newList;
  }, []);

  const updateList = useCallback((id: string, updates: Partial<Pick<UserCardList, 'name' | 'cards' | 'description' | 'type' | 'commanderName' | 'partnerCommanderName' | 'deckSize' | 'sideboard' | 'maybeboard' | 'primer'>>) => {
    setLists(prev => prev.map(l =>
      l.id === id ? { ...l, ...updates, updatedAt: Date.now() } : l
    ));
    // Re-compute cached fields if cards or commander changed
    if (updates.cards || updates.commanderName !== undefined) {
      // Use a microtask to read updated state
      setTimeout(() => refreshCache(id), 0);
    }
  }, [refreshCache]);

  const deleteList = useCallback((id: string) => {
    setLists(prev => prev.filter(l => l.id !== id));
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

  const duplicateList = useCallback((id: string) => {
    setLists(prev => {
      const original = prev.find(l => l.id === id);
      if (!original) return prev;
      const now = Date.now();
      const copy: UserCardList = {
        id: `list-${now}`,
        type: original.type,
        name: `${original.name} (Copy)`,
        description: original.description,
        cards: [...original.cards],
        sideboard: original.sideboard ? [...original.sideboard] : undefined,
        maybeboard: original.maybeboard ? [...original.maybeboard] : undefined,
        commanderName: original.commanderName,
        partnerCommanderName: original.partnerCommanderName,
        primer: original.primer,
        cachedTypeBreakdown: original.cachedTypeBreakdown,
        cachedColorIdentity: original.cachedColorIdentity,
        cachedCommanderArtUrl: original.cachedCommanderArtUrl,
        createdAt: now,
        updatedAt: now,
      };
      return [copy, ...prev];
    });
  }, []);

  const convertToDeck = useCallback((id: string) => {
    setLists(prev => prev.map(l =>
      l.id === id ? { ...l, type: 'deck' as const, updatedAt: Date.now() } : l
    ));
  }, []);

  const convertToList = useCallback((id: string) => {
    setLists(prev => prev.map(l =>
      l.id === id ? { ...l, type: 'list' as const, commanderName: undefined, partnerCommanderName: undefined, cachedColorIdentity: undefined, cachedCommanderArtUrl: undefined, updatedAt: Date.now() } : l
    ));
  }, []);

  const exportList = useCallback((id: string): string => {
    const list = lists.find(l => l.id === id);
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
  }, [lists]);

  const getListById = useCallback((id: string) => {
    return lists.find(l => l.id === id) ?? null;
  }, [lists]);

  return { lists, createList, updateList, deleteList, duplicateList, convertToDeck, convertToList, exportList, getListById };
}
