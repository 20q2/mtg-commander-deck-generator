export type AnalyticsEventType =
  | 'commander_searched'
  | 'commander_selected'
  | 'deck_generated'
  | 'deck_generation_failed'
  | 'archetype_detected'
  | 'theme_toggled'
  | 'collection_imported'
  | 'combos_viewed'
  | 'page_viewed';

export interface AnalyticsEventMetadata {
  commander_searched: { query: string; resultCount: number };
  commander_selected: { commanderName: string; colorIdentity: string[]; hasPartner: boolean };
  deck_generated: {
    commanderName: string;
    partnerName?: string;
    archetype: string;
    deckFormat: number;
    themes: string[];
    collectionMode: boolean;
    totalCards: number;
    averageCmc: number;
    comboCount: number;
  };
  deck_generation_failed: { commanderName: string; error: string };
  archetype_detected: { commanderName: string; archetypes: Array<{ name: string; confidence: string }> };
  theme_toggled: { commanderName: string; themeName: string; selected: boolean };
  collection_imported: { cardCount: number; added: number; updated: number };
  combos_viewed: { commanderName: string; comboCount: number };
  page_viewed: { page: string; path: string };
}

export interface AnalyticsEvent {
  event: AnalyticsEventType;
  timestamp: string;
  metadata: Record<string, unknown>;
}
