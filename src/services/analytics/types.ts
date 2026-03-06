export type AnalyticsEventType =
  | 'commander_searched'
  | 'commander_selected'
  | 'deck_generated'
  | 'deck_generation_failed'
  | 'deck_exported'
  | 'theme_toggled'
  | 'collection_imported'
  | 'combos_viewed'
  | 'page_viewed'
  | 'list_created'
  | 'list_deleted'
  | 'list_exported'
  | 'list_toggled'
  | 'card_swapped'
  | 'cards_removed'
  | 'must_include_added'
  | 'build_mode_toggled'
  | 'deck_optimized';

export interface AnalyticsEventMetadata {
  commander_searched: { query: string; resultCount: number };
  commander_selected: { commanderName: string; colorIdentity: string[]; hasPartner: boolean };
  deck_generated: {
    commanderName: string;
    partnerName?: string;
    deckFormat: number;
    themes: string[];
    collectionMode: boolean;
    totalCards: number;
    averageCmc: number;
    comboCount: number;
    comboPreference: number;
    budgetOption: string;
    maxCardPrice: number | null;
    deckBudget: number | null;
    bracketLevel: string | number;
    maxRarity: string | null;
    hyperFocus: boolean;
    gameChangerLimit: string | number;
    tinyLeaders: boolean;
    arenaOnly: boolean;
    landCount: number;
    nonBasicLandCount: number;
    mustIncludeCount: number;
    bannedCount: number;
    currency: string;
    isRegeneration: boolean;
    balancedRoles: boolean;
  };
  deck_generation_failed: { commanderName: string; error: string };
  deck_exported: { commanderName: string; format: 'clipboard' | 'download' };
  theme_toggled: { commanderName: string; themeName: string; selected: boolean };
  collection_imported: { cardCount: number; added: number; updated: number };
  combos_viewed: { commanderName: string; comboCount: number };
  page_viewed: { page: string; path: string };
  list_created: { listName: string; cardCount: number };
  list_deleted: { listName: string; cardCount: number };
  list_exported: { listName: string; cardCount: number };
  list_toggled: { listName: string; cardCount: number; mode: 'exclude' | 'include'; enabled: boolean };
  card_swapped: { commanderName: string; oldCardName: string; newCardName: string; swapType: string };
  cards_removed: { commanderName: string; cardCount: number };
  must_include_added: { commanderName: string; cardName: string; source: 'combo' | 'modal' };
  build_mode_toggled: { commanderName: string; mode: 'balanced' | 'classic' };
  deck_optimized: { commanderName: string; partnerName?: string; listName: string; originalCardCount: number; deckFormat: number; themes: string[]; totalCards: number; isRegeneration: boolean };
}

export interface AnalyticsEvent {
  event: AnalyticsEventType;
  timestamp: string;
  metadata: Record<string, unknown>;
}
