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
  | 'deck_optimized'
  | 'deck_imported'
  | 'playtest_started'
  | 'analyze_page_viewed'
  | 'analyze_deck_loaded'
  | 'analyze_deck_saved'
  | 'analyze_lane_switched'
  | 'inspector_tab_viewed'
  | 'analyze_cta_clicked'
  | 'spellchroma_viewed'
  | 'spellchroma_deck_loaded'
  | 'spellchroma_tag_selected'
  | 'spellchroma_card_added'
  | 'spellchroma_open_clicked'
  | 'deck_stats_tag_clicked'
  | 'poll_nudge_shown'
  | 'poll_nudge_dismissed'
  | 'brew_started'
  | 'brew_finished'
  | 'brew_abandoned'
  | 'rebrew_clicked'
  | 'strategy_selected';

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
    allowedRarities: string[] | null;
    hyperFocus: boolean;
    gameChangerLimit: string | number;
    tinyLeaders: boolean;
    arenaOnly: boolean;
    landCount: number;
    nonBasicLandCount: number;
    suggestedLandCount: number | null;
    suggestedNonBasicLandCount: number | null;
    landCountModified: boolean;
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
  combos_viewed: {
    commanderName: string;
    comboCount: number;
    // Combos sourced from the commander's EDHREC combo page.
    commanderComboCount: number;
    // Combos sourced from the color-identity combo page (off-commander detection).
    colorIdentityComboCount: number;
  };
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
  deck_imported: { source: string; cardCount: number; deckName: string };
  analyze_page_viewed: { source: 'direct' | 'from_generate' | 'from_list' };
  analyze_deck_loaded: { source: 'paste' | 'list' | 'generated'; cardCount: number; hasCommander: boolean };
  analyze_deck_saved: { listName: string; cardCount: number; source: 'paste' | 'list' | 'generated' };
  analyze_lane_switched: { from: string; to: string };
  /** An inspector analyzer tab became active (overview/roles/mana/tempo/optimize/bracket/cost/lift). */
  inspector_tab_viewed: { tab: string };
  analyze_cta_clicked: { from: 'builder' | 'list-deck' | 'generate-lane-auto' };
  /** SpellChroma page opened. */
  spellchroma_viewed: Record<string, never>;
  /** A deck was loaded into SpellChroma (paste / saved deck / list). */
  spellchroma_deck_loaded: { source: string; cardCount: number };
  /** A tag was added to the SpellChroma explorer search. */
  spellchroma_tag_selected: { slug: string };
  /** A card was added from the SpellChroma explorer to the deck or a list. */
  spellchroma_card_added: { dest: 'deck' | 'list' | 'sideboard' | 'maybeboard' };
  /** "Open in SpellChroma" clicked from a deck toolbar. */
  spellchroma_open_clicked: { from: 'list-deck' | 'builder' };
  /** A Top Tags chip in the deck Statistics sidebar was clicked → opens SpellChroma. */
  deck_stats_tag_clicked: { slug: string };
  poll_nudge_shown: { visitCount: number };
  poll_nudge_dismissed: { action: 'clicked' | 'dismissed' };
  brew_started: { commanderName: string; partnerName?: string; collectionMode: boolean };
  brew_finished: { commanderName: string; picks: number };
  brew_abandoned: { commanderName: string; picks: number };
  rebrew_clicked: { commanderName: string | null };
  /** A strategy/archetype was opened from the "By strategy" commander-discovery tab. */
  strategy_selected: { strategy: string };
  playtest_started: {
    /** Where the playtest was launched from. */
    source: 'list' | 'generated';
    /** Deck name (commander name for generated, list name for lists). */
    deckName: string;
    /** Commander(s) — concatenated with " // " for partner pairs. */
    commanderName?: string;
    /** Library size at the start of the session (after opening hand is dealt). */
    libraryCount: number;
    /** Total cards in the deck (library + opening hand + command zone). */
    totalCards: number;
  };
}

export interface AnalyticsEvent {
  event: AnalyticsEventType;
  timestamp: string;
  metadata: Record<string, unknown>;
}
