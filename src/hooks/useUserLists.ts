import { useState, useEffect, useCallback } from 'react';
import type { UserCardList } from '@/types';

const USER_LISTS_KEY = 'mtg-deck-builder-user-lists';

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

interface CreateListOptions {
  type?: 'list' | 'deck';
  commanderName?: string;
  partnerCommanderName?: string;
}

export function useUserLists() {
  const [lists, setLists] = useState<UserCardList[]>(() => loadUserLists());

  // Auto-save whenever lists change
  useEffect(() => {
    saveUserLists(lists);
  }, [lists]);

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
      createdAt: now,
      updatedAt: now,
    };
    setLists(prev => [newList, ...prev]);
    return newList;
  }, []);

  const updateList = useCallback((id: string, updates: Partial<Pick<UserCardList, 'name' | 'cards' | 'description' | 'type' | 'commanderName' | 'partnerCommanderName'>>) => {
    setLists(prev => prev.map(l =>
      l.id === id ? { ...l, ...updates, updatedAt: Date.now() } : l
    ));
  }, []);

  const deleteList = useCallback((id: string) => {
    setLists(prev => prev.filter(l => l.id !== id));
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
        commanderName: original.commanderName,
        partnerCommanderName: original.partnerCommanderName,
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
      l.id === id ? { ...l, type: 'list' as const, commanderName: undefined, partnerCommanderName: undefined, updatedAt: Date.now() } : l
    ));
  }, []);

  const exportList = useCallback((id: string): string => {
    const list = lists.find(l => l.id === id);
    if (!list) return '';
    return list.cards.map(c => `1 ${c}`).join('\n');
  }, [lists]);

  const getListById = useCallback((id: string) => {
    return lists.find(l => l.id === id) ?? null;
  }, [lists]);

  return { lists, createList, updateList, deleteList, duplicateList, convertToDeck, convertToList, exportList, getListById };
}
