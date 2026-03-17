import { create } from 'zustand';
import type { AppState, Customization, BanList, AppliedList, ScryfallCard, GeneratedDeck, EDHRECTheme, ThemeResult } from '@/types';
import { isEuropean } from '@/lib/region';
import { swapCard } from '@/services/deckBuilder/cardSwap';

const BANNED_CARDS_KEY = 'mtg-deck-builder-banned-cards';
const MUST_INCLUDE_CARDS_KEY = 'mtg-deck-builder-must-include-cards';
const CURRENCY_KEY = 'mtg-deck-builder-currency';
const BAN_LISTS_KEY = 'mtg-deck-builder-ban-lists';
const APPLIED_EXCLUDE_LISTS_KEY = 'mtg-deck-builder-applied-exclude-lists';
const APPLIED_INCLUDE_LISTS_KEY = 'mtg-deck-builder-applied-include-lists';
const ARENA_ONLY_KEY = 'mtg-deck-builder-arena-only';

// Load banned cards from localStorage
function loadBannedCards(): string[] {
  try {
    const stored = localStorage.getItem(BANNED_CARDS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load banned cards from localStorage:', e);
  }
  return [];
}

// Save banned cards to localStorage
function saveBannedCards(cards: string[]): void {
  try {
    localStorage.setItem(BANNED_CARDS_KEY, JSON.stringify(cards));
  } catch (e) {
    console.warn('Failed to save banned cards to localStorage:', e);
  }
}

// Load must-include cards from localStorage
function loadMustIncludeCards(): string[] {
  try {
    const stored = localStorage.getItem(MUST_INCLUDE_CARDS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load must-include cards from localStorage:', e);
  }
  return [];
}

// Save must-include cards to localStorage
function saveMustIncludeCards(cards: string[]): void {
  try {
    localStorage.setItem(MUST_INCLUDE_CARDS_KEY, JSON.stringify(cards));
  } catch (e) {
    console.warn('Failed to save must-include cards to localStorage:', e);
  }
}

// Load currency from localStorage, falling back to region detection
function loadCurrency(): 'USD' | 'EUR' {
  try {
    const stored = localStorage.getItem(CURRENCY_KEY);
    if (stored === 'USD' || stored === 'EUR') return stored;
  } catch (e) {
    console.warn('Failed to load currency from localStorage:', e);
  }
  return isEuropean() ? 'EUR' : 'USD';
}

// Save currency to localStorage
function saveCurrency(currency: 'USD' | 'EUR'): void {
  try {
    localStorage.setItem(CURRENCY_KEY, currency);
  } catch (e) {
    console.warn('Failed to save currency to localStorage:', e);
  }
}

// Load ban lists from localStorage
function loadBanLists(): BanList[] {
  try {
    const stored = localStorage.getItem(BAN_LISTS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load ban lists from localStorage:', e);
  }
  return [];
}

// Save ban lists to localStorage
function saveBanLists(lists: BanList[]): void {
  try {
    localStorage.setItem(BAN_LISTS_KEY, JSON.stringify(lists));
  } catch (e) {
    console.warn('Failed to save ban lists to localStorage:', e);
  }
}

// Load applied exclude lists from localStorage
function loadAppliedExcludeLists(): AppliedList[] {
  try {
    const stored = localStorage.getItem(APPLIED_EXCLUDE_LISTS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Failed to load applied exclude lists from localStorage:', e);
  }
  return [];
}

// Save applied exclude lists to localStorage
function saveAppliedExcludeLists(lists: AppliedList[]): void {
  try {
    localStorage.setItem(APPLIED_EXCLUDE_LISTS_KEY, JSON.stringify(lists));
  } catch (e) {
    console.warn('Failed to save applied exclude lists to localStorage:', e);
  }
}

// Load applied include lists from localStorage
function loadAppliedIncludeLists(): AppliedList[] {
  try {
    const stored = localStorage.getItem(APPLIED_INCLUDE_LISTS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Failed to load applied include lists from localStorage:', e);
  }
  return [];
}

// Save applied include lists to localStorage
function saveAppliedIncludeLists(lists: AppliedList[]): void {
  try {
    localStorage.setItem(APPLIED_INCLUDE_LISTS_KEY, JSON.stringify(lists));
  } catch (e) {
    console.warn('Failed to save applied include lists to localStorage:', e);
  }
}

// Load arena-only setting from localStorage
function loadArenaOnly(): boolean {
  try {
    return localStorage.getItem(ARENA_ONLY_KEY) === 'true';
  } catch {
    return false;
  }
}

// Save arena-only setting to localStorage
function saveArenaOnly(value: boolean): void {
  try {
    localStorage.setItem(ARENA_ONLY_KEY, String(value));
  } catch {
    // ignore
  }
}

const defaultCustomization: Customization = {
  deckFormat: 99,
  landCount: 37,
  nonBasicLandCount: 15, // Default to 15 non-basics, rest will be basics
  bannedCards: loadBannedCards(), // Load from localStorage
  banLists: loadBanLists(), // Load from localStorage
  mustIncludeCards: loadMustIncludeCards(), // Load from localStorage
  tempBannedCards: [],
  tempMustIncludeCards: [],
  maxCardPrice: null, // No limit by default
  deckBudget: null, // No total deck budget by default
  budgetOption: 'any' as const, // Default to normal card pool
  gameChangerLimit: 'unlimited' as const,
  bracketLevel: 'all' as const,
  maxRarity: null,
  tinyLeaders: false,
  ignoreOwnedBudget: false,
  collectionMode: false,
  collectionStrategy: 'full' as const,
  collectionOwnedPercent: 75,
  arenaOnly: loadArenaOnly(),
  scryfallQuery: '',
  comboCount: 1,
  hyperFocus: false,
  balancedRoles: true,
  currency: loadCurrency(),
  appliedExcludeLists: loadAppliedExcludeLists(),
  appliedIncludeLists: loadAppliedIncludeLists(),
  advancedTargets: { curvePercentages: null, typePercentages: null, roleTargets: null },
};

export const useStore = create<AppState>((set, get) => ({
  // Commander
  commander: null,
  partnerCommander: null,
  colorIdentity: [],

  // EDHREC Themes
  edhrecThemes: [],
  selectedThemes: [],
  themesLoading: false,
  themesError: null,
  themeSource: 'local',
  edhrecNumDecks: null,
  edhrecLandSuggestion: null,
  edhrecStats: null,
  userEditedLands: false,

  // Customization
  customization: defaultCustomization,

  // Deck
  generatedDeck: null,

  // UI
  isLoading: false,
  loadingMessage: '',
  error: null,

  // Actions
  setCommander: (card: ScryfallCard | null) => set((state) => {
    const partnerIdentity = state.partnerCommander?.color_identity || [];
    const commanderIdentity = card?.color_identity || [];
    const combined = [...new Set([...commanderIdentity, ...partnerIdentity])];

    return {
      commander: card,
      colorIdentity: combined,
      generatedDeck: null, // Reset deck when commander changes
      // Reset theme state when commander changes
      edhrecThemes: [],
      selectedThemes: [],
      themesLoading: false,
      themesError: null,
      themeSource: 'local',
      edhrecNumDecks: null,
      edhrecLandSuggestion: null,
      edhrecStats: null,
      userEditedLands: false,
    };
  }),

  setPartnerCommander: (card: ScryfallCard | null) => set((state) => {
    const commanderIdentity = state.commander?.color_identity || [];
    const partnerIdentity = card?.color_identity || [];
    const combined = [...new Set([...commanderIdentity, ...partnerIdentity])];

    return {
      partnerCommander: card,
      colorIdentity: combined,
      generatedDeck: null,
      // Reset theme state when partner changes
      edhrecThemes: [],
      selectedThemes: [],
      themesLoading: false,
      themesError: null,
      themeSource: 'local',
      edhrecNumDecks: null,
      edhrecStats: null,
    };
  }),

  setEdhrecThemes: (themes: EDHRECTheme[]) => set({
    edhrecThemes: themes,
    themeSource: 'edhrec',
    themesError: null,
  }),

  setEdhrecNumDecks: (count) => set({ edhrecNumDecks: count }),

  setEdhrecLandSuggestion: (suggestion) => set({ edhrecLandSuggestion: suggestion }),
  setEdhrecStats: (stats) => set({ edhrecStats: stats }),

  setSelectedThemes: (themes: ThemeResult[]) => set({ selectedThemes: themes }),

  toggleThemeSelection: (themeName: string) => set((state) => {
    const updated = state.selectedThemes.map((t) =>
      t.name === themeName ? { ...t, isSelected: !t.isSelected } : t
    );
    return { selectedThemes: updated };
  }),

  setThemesLoading: (loading: boolean) => set({ themesLoading: loading }),

  setThemesError: (error: string | null) => set((state) => ({
    themesError: error,
    themeSource: error ? 'local' : state.themeSource,
  })),

  updateCustomization: (updates: Partial<Customization>) => set((state) => {
    const newCustomization = { ...state.customization, ...updates };

    // Persist banned cards to localStorage when they change
    if (updates.bannedCards !== undefined) {
      saveBannedCards(newCustomization.bannedCards);
    }

    // Persist must-include cards to localStorage when they change
    if (updates.mustIncludeCards !== undefined) {
      saveMustIncludeCards(newCustomization.mustIncludeCards);
    }

    // Persist ban lists to localStorage when they change
    if (updates.banLists !== undefined) {
      saveBanLists(newCustomization.banLists);
    }

    // Persist currency to localStorage when it changes
    if (updates.currency !== undefined) {
      saveCurrency(newCustomization.currency);
    }

    // Persist applied exclude lists to localStorage when they change
    if (updates.appliedExcludeLists !== undefined) {
      saveAppliedExcludeLists(newCustomization.appliedExcludeLists);
    }

    // Persist applied include lists to localStorage when they change
    if (updates.appliedIncludeLists !== undefined) {
      saveAppliedIncludeLists(newCustomization.appliedIncludeLists);
    }

    // Persist arena-only setting to localStorage when it changes
    if (updates.arenaOnly !== undefined) {
      saveArenaOnly(newCustomization.arenaOnly);
    }

    return { customization: newCustomization };
  }),

  setGeneratedDeck: (deck: GeneratedDeck | null) => set({ generatedDeck: deck }),
  swapDeckCard: (oldCard: ScryfallCard, newCard: ScryfallCard) => {
    const { generatedDeck } = get();
    if (!generatedDeck) return;
    const result = swapCard(generatedDeck, oldCard, newCard);
    if (result.success) {
      set({ generatedDeck: result.deck });
    } else {
      console.warn('[Store] Card swap failed:', result.error);
    }
  },

  setLoading: (loading: boolean, message = '') => set({
    isLoading: loading,
    loadingMessage: message,
  }),

  setError: (error: string | null) => set({ error }),

  reset: () => set((state) => ({
    commander: null,
    partnerCommander: null,
    colorIdentity: [],
    edhrecThemes: [],
    selectedThemes: [],
    themesLoading: false,
    themesError: null,
    themeSource: 'local',
    edhrecNumDecks: null,
    userEditedLands: false,
    // Preserve all customization settings when switching commanders
    customization: state.customization,
    generatedDeck: null,
    isLoading: false,
    loadingMessage: '',
    error: null,
  })),
}));
