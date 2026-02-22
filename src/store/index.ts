import { create } from 'zustand';
import type { AppState, Customization, ArchetypeResult, Archetype, ScryfallCard, GeneratedDeck, EDHRECTheme, ThemeResult } from '@/types';

const BANNED_CARDS_KEY = 'mtg-deck-builder-banned-cards';
const MUST_INCLUDE_CARDS_KEY = 'mtg-deck-builder-must-include-cards';

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

const defaultCustomization: Customization = {
  deckFormat: 99,
  landCount: 37,
  nonBasicLandCount: 15, // Default to 15 non-basics, rest will be basics
  bannedCards: loadBannedCards(), // Load from localStorage
  mustIncludeCards: loadMustIncludeCards(), // Load from localStorage
  maxCardPrice: null, // No limit by default
  deckBudget: null, // No total deck budget by default
  budgetOption: 'any' as const, // Default to normal card pool
  gameChangerLimit: 'unlimited' as const,
  bracketLevel: 'all' as const,
  maxRarity: null,
  tinyLeaders: false,
  collectionMode: false,
};

export const useStore = create<AppState>((set) => ({
  // Commander
  commander: null,
  partnerCommander: null,
  colorIdentity: [],

  // Archetype
  detectedArchetypes: [],
  selectedArchetype: 'midrange' as Archetype,

  // EDHREC Themes
  edhrecThemes: [],
  selectedThemes: [],
  themesLoading: false,
  themesError: null,
  themeSource: 'local',

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
    };
  }),

  setDetectedArchetypes: (archetypes: ArchetypeResult[]) => set({
    detectedArchetypes: archetypes,
    selectedArchetype: archetypes[0]?.archetype || ('midrange' as Archetype),
  }),

  setSelectedArchetype: (archetype: Archetype) => set({ selectedArchetype: archetype }),

  setEdhrecThemes: (themes: EDHRECTheme[]) => set({
    edhrecThemes: themes,
    themeSource: 'edhrec',
    themesError: null,
  }),

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

    return { customization: newCustomization };
  }),

  setGeneratedDeck: (deck: GeneratedDeck | null) => set({ generatedDeck: deck }),

  setLoading: (loading: boolean, message = '') => set({
    isLoading: loading,
    loadingMessage: message,
  }),

  setError: (error: string | null) => set({ error }),

  reset: () => set((state) => ({
    commander: null,
    partnerCommander: null,
    colorIdentity: [],
    detectedArchetypes: [],
    selectedArchetype: 'midrange' as Archetype,
    edhrecThemes: [],
    selectedThemes: [],
    themesLoading: false,
    themesError: null,
    themeSource: 'local',
    // Preserve all customization settings when switching commanders
    customization: state.customization,
    generatedDeck: null,
    isLoading: false,
    loadingMessage: '',
    error: null,
  })),
}));
