// Scryfall Card type
export interface ScryfallCard {
  id: string;
  oracle_id: string;
  name: string;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  colors?: string[];
  color_identity: string[];
  keywords: string[];
  produced_mana?: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  rarity: string;
  layout?: string; // Scryfall layout: "normal", "modal_dfc", "transform", etc.
  set: string;
  set_name: string;
  edhrec_rank?: number;
  image_uris?: {
    small: string;
    normal: string;
    large: string;
    png: string;
    art_crop: string;
    border_crop: string;
  };
  card_faces?: Array<{
    name: string;
    mana_cost?: string;
    type_line: string;
    oracle_text?: string;
    colors?: string[];
    power?: string;
    toughness?: string;
    image_uris?: {
      small: string;
      normal: string;
      large: string;
      art_crop?: string;
    };
  }>;
  prices: {
    usd?: string | null;
    usd_foil?: string | null;
    usd_etched?: string | null;
    eur?: string | null;
    eur_foil?: string | null;
    tix?: string | null;
  };
  legalities: {
    commander: string;
    [format: string]: string;
  };
  games?: string[]; // Platforms: "paper", "arena", "mtgo"
  // Added during deck generation
  isGameChanger?: boolean;
  isMustInclude?: boolean;
  mustIncludeSource?: 'user' | 'deck' | 'combo'; // Where the must-include came from
  deckRole?: string; // Functional role detected by tagger/oracle text (e.g., 'ramp', 'removal')
  multiRole?: boolean; // True if card matches multiple role categories
  rampSubtype?: 'mana-producer' | 'mana-rock' | 'cost-reducer' | 'ramp';
  removalSubtype?: 'counterspell' | 'bounce' | 'spot-removal' | 'removal';
  boardwipeSubtype?: 'bounce-wipe' | 'boardwipe';
  cardDrawSubtype?: 'tutor' | 'wheel' | 'cantrip' | 'card-draw' | 'card-advantage';
  isMdfcLand?: boolean; // True if this is an MDFC with a land back face
  isChannelLand?: boolean; // True if this is a Kamigawa channel land
  isUtilityLand?: boolean; // True if this land has meaningful non-mana abilities (from otag:utility-land)
  isTapland?: boolean; // True if this land enters the battlefield tapped (from otag:tapland)
}

export interface ScryfallSearchResponse {
  object: 'list';
  total_cards: number;
  has_more: boolean;
  next_page?: string;
  data: ScryfallCard[];
}

// Archetype definitions
export enum Archetype {
  AGGRO = 'aggro',
  CONTROL = 'control',
  COMBO = 'combo',
  MIDRANGE = 'midrange',
  VOLTRON = 'voltron',
  SPELLSLINGER = 'spellslinger',
  TOKENS = 'tokens',
  ARISTOCRATS = 'aristocrats',
  REANIMATOR = 'reanimator',
  TRIBAL = 'tribal',
  LANDFALL = 'landfall',
  ARTIFACTS = 'artifacts',
  ENCHANTRESS = 'enchantress',
  STORM = 'storm',
  GOODSTUFF = 'goodstuff',
}

// EDHREC Theme types
export interface EDHRECTheme {
  name: string;
  slug: string; // URL slug for theme-specific endpoint (e.g., "plus-1-plus-1-counters")
  count: number;
  url: string;
  popularityPercent?: number;
}

// EDHREC Card data (from cardlists)
export interface EDHRECCard {
  name: string;
  sanitized: string;
  primary_type: string;
  inclusion: number; // Percentage of decks that include this card
  num_decks: number; // Number of decks with this card
  synergy?: number; // Synergy score (-1 to 1)
  // Track if this card came from a high-priority synergy list
  isThemeSynergyCard?: boolean; // true if from highsynergycards, topcards, gamechangers
  isNewCard?: boolean; // true if from the newcards list (gets a small relevancy boost)
  isGameChanger?: boolean; // true if from the gamechangers list specifically
  prices?: {
    tcgplayer?: { price: number };
    cardkingdom?: { price: number };
  };
  image_uris?: Array<{
    normal: string;
    art_crop?: string;
  }>;
  color_identity?: string[];
  cmc?: number;
  salt?: number;
}

// EDHREC Commander statistics
export interface EDHRECCommanderStats {
  avgPrice: number;
  numDecks: number;
  deckSize: number; // Non-commander deck size from EDHREC (typically ~81)
  manaCurve: Record<number, number>; // CMC -> count (e.g., { 1: 10, 2: 12, 3: 20, ... })
  typeDistribution: {
    creature: number;
    instant: number;
    sorcery: number;
    artifact: number;
    enchantment: number;
    land: number;
    planeswalker: number;
    battle: number;
  };
  landDistribution: {
    basic: number;
    nonbasic: number;
    total: number;
  };
}

// EDHREC Top Commander (from commanders page)
export interface EDHRECTopCommander {
  rank: number;
  name: string;
  sanitized: string;
  colorIdentity: string[];
  numDecks: number;
}

// EDHREC Similar Commander
export interface EDHRECSimilarCommander {
  name: string;
  sanitized: string;
  colorIdentity: string[];
  cmc: number;
  imageUrl?: string;
  url: string;
}

// Full EDHREC Commander data
export interface EDHRECCommanderData {
  themes: EDHRECTheme[];
  stats: EDHRECCommanderStats;
  cardlists: {
    creatures: EDHRECCard[];
    instants: EDHRECCard[];
    sorceries: EDHRECCard[];
    artifacts: EDHRECCard[];
    enchantments: EDHRECCard[];
    planeswalkers: EDHRECCard[];
    lands: EDHRECCard[];
    // All non-land cards combined
    allNonLand: EDHRECCard[];
  };
  similarCommanders: EDHRECSimilarCommander[];
}

export interface ThemeResult {
  name: string;
  source: 'edhrec' | 'local';
  slug?: string; // URL slug for EDHREC theme-specific endpoint
  deckCount?: number;
  popularityPercent?: number;
  archetype?: Archetype;
  score?: number;
  confidence?: 'high' | 'medium' | 'low';
  isSelected: boolean;
}

// Deck composition
export type DeckCategory =
  | 'lands'
  | 'ramp'
  | 'cardDraw'
  | 'singleRemoval'
  | 'boardWipes'
  | 'creatures'
  | 'synergy'
  | 'utility';

export interface DeckComposition {
  lands: number;
  ramp: number;
  cardDraw: number;
  singleRemoval: number;
  boardWipes: number;
  creatures: number;
  synergy: number;
  utility: number;
}

// EDHREC Combo types
export interface EDHRECCombo {
  comboId: string;
  cards: { name: string; id: string }[];
  results: string[];
  deckCount: number;
  rank: number;
  bracket: string;
  prereqCount: number;
}

export interface DetectedCombo {
  comboId: string;
  cards: string[];
  results: string[];
  isComplete: boolean;
  missingCards: string[];
  deckCount: number;
  bracket: string;
}

export interface GapAnalysisCard {
  name: string;
  price: string | null;
  inclusion: number;
  synergy: number;
  typeLine: string;
  imageUrl?: string;
  isOwned?: boolean;
  role?: string;       // Functional role from tagger (e.g. 'ramp', 'removal')
  roleLabel?: string;  // Display label (e.g. 'Ramp', 'Card Draw')
}

/** Describes which data source was ultimately used for deck generation */
export type DeckDataSource =
  | 'theme+bracket'   // Ideal: theme-specific data with bracket/power level
  | 'theme'           // Theme data but without bracket filtering
  | 'base+bracket'    // Base commander data with bracket/power level
  | 'base'            // Base commander data, no bracket
  | 'scryfall';       // No EDHREC data at all — pure Scryfall search

export interface GeneratedDeck {
  commander: ScryfallCard | null;
  partnerCommander: ScryfallCard | null;
  categories: Record<DeckCategory, ScryfallCard[]>;
  stats: DeckStats;
  usedThemes?: string[];
  gapAnalysis?: GapAnalysisCard[];
  builtFromCollection?: boolean;
  collectionShortfall?: number;
  filterShortfall?: number; // Extra basic lands added because scryfallQuery filters reduced the available card pool
  detectedCombos?: DetectedCombo[];
  typeTargets?: Record<string, number>;
  dataSource?: DeckDataSource;
  roleCounts?: Record<string, number>; // Actual role counts when balanced roles mode was active
  roleTargets?: Record<string, number>; // Target role counts when balanced roles mode was active
  rampSubtypeCounts?: Record<string, number>;
  removalSubtypeCounts?: Record<string, number>;
  boardwipeSubtypeCounts?: Record<string, number>;
  cardDrawSubtypeCounts?: Record<string, number>;
  swapCandidates?: Record<string, ScryfallCard[]>; // Keyed by RoleKey or 'type:{cardType}', top candidates per role/type for card swapping
  removedFromDeck?: string[]; // Cards from original deck that were cut during build-from-deck optimization
  deckScore?: number; // Sum of EDHREC inclusion % for all non-land cards
  cardInclusionMap?: Record<string, number>; // cardName → EDHREC inclusion %
  cardRelevancyMap?: Record<string, number>; // cardName → composite relevancy score (raw, 0-200+)
  detectedArchetype?: Archetype; // Archetype inferred from themes for dynamic role targeting
  detectedPacing?: string; // Pacing estimated from EDHREC stats at generation time
}

export interface DeckStats {
  totalCards: number;
  averageCmc: number;
  manaCurve: Record<number, number>; // CMC -> count
  colorDistribution: Record<string, number>; // Color -> count
  typeDistribution: Record<string, number>; // Type -> count
}

// Deck edit history
export type DeckHistoryAction = 'add' | 'remove' | 'swap' | 'sideboard' | 'maybeboard';

export interface DeckHistoryEntry {
  id: string;
  action: DeckHistoryAction;
  cardName: string;
  targetCardName?: string;
  timestamp: number;
}

// Deck format/size
export type DeckFormat = number;

export interface DeckFormatConfig {
  size: DeckFormat;
  label: string;
  description: string;
  defaultLands: number;
  landRange: [number, number];
  hasCommander: boolean;
  allowMultipleCopies: boolean;
}

// EDHREC budget filter
export type BudgetOption = 'any' | 'budget' | 'expensive';

// Game changer limit: 'none' = 0, 'unlimited' = no cap, or a specific number
export type GameChangerLimit = 'none' | 'unlimited' | number;

// EDHREC bracket level (power level tiers)
export type BracketLevel = 'all' | 1 | 2 | 3 | 4 | 5;

// Max card rarity filter
export type MaxRarity = 'common' | 'uncommon' | 'rare' | 'mythic' | null;

export type CollectionStrategy = 'full' | 'partial';

// Ban list (preset or custom)
export interface BanList {
  id: string;
  name: string;
  cards: string[];
  isPreset: boolean;
  enabled: boolean;
}

// User-created reusable card list or deck
export interface UserCardList {
  id: string;
  type?: 'list' | 'deck';
  name: string;
  description: string;
  cards: string[];
  sideboard?: string[];
  maybeboard?: string[];
  commanderName?: string;
  partnerCommanderName?: string;
  deckSize?: number; // Total intended deck size including commander(s)
  primer?: string; // Strategy notes / deck primer (deck type only)
  createdAt: number;
  updatedAt: number;
  // Cached display data (computed on save to avoid Scryfall fetches on browse)
  cachedTypeBreakdown?: Record<string, number>;
  cachedColorIdentity?: string[];
  cachedCommanderArtUrl?: string;
}

// Reference to a user list applied as exclude or include
export interface AppliedList {
  listId: string;
  enabled: boolean;
}

// Advanced deck framework targets — null fields mean "use EDHREC/fallback defaults"
export interface AdvancedTargets {
  curvePercentages: Record<number, number> | null;   // CMC bucket → percentage of non-land cards
  typePercentages: Record<string, number> | null;    // card type → percentage of non-land cards
  roleTargets: Record<string, number> | null;        // role → absolute count target
}

// User customization
export interface Customization {
  deckFormat: DeckFormat;
  landCount: number;
  nonBasicLandCount: number; // How many non-basic lands to include (rest will be basics)
  bannedCards: string[]; // Card names to exclude from deck generation
  banLists: BanList[]; // Named ban lists (preset + custom)
  mustIncludeCards: string[]; // Card names to force-include in deck generation (first priority)
  tempBannedCards: string[]; // Temporary bans from deck toolbar (cleared on generation)
  tempMustIncludeCards: string[]; // Temporary must-includes from combo section (cleared on generation)
  maxCardPrice: number | null; // Max USD price per card, null = no limit
  deckBudget: number | null; // Total deck budget in USD, null = no limit
  budgetOption: BudgetOption; // EDHREC card pool: any (normal), budget, or expensive
  gameChangerLimit: GameChangerLimit; // How many game changer cards to allow
  bracketLevel: BracketLevel; // EDHREC bracket level for power level filtering
  maxRarity: MaxRarity; // Max card rarity, null = no limit
  tinyLeaders: boolean; // Restrict all non-land cards to CMC <= 3
  collectionMode: boolean; // When true, constrain generation to owned cards
  collectionStrategy: CollectionStrategy; // 'full' = only owned cards, 'partial' = prioritize owned then fill with recommended
  collectionOwnedPercent: number; // 25-100, target % of non-land cards from collection in partial mode
  arenaOnly: boolean; // When true, only use cards available on MTG Arena
  scryfallQuery: string; // Additional Scryfall search syntax appended to all card queries (e.g. "set:mkm", "is:full-art")
  comboCount: number; // 0 = none, 1 = normal, 2 = a few extra, 3 = many combo pieces prioritized
  hyperFocus: boolean; // When true, boost unique theme cards and penalize generic multi-theme cards
  balancedRoles: boolean; // When true, boost cards that fill underrepresented functional roles (ramp, removal, etc.)
  ignoreOwnedBudget: boolean; // When true, owned cards don't count against budget limits
  currency: 'USD' | 'EUR'; // Price currency for budget filtering and display
  appliedExcludeLists: AppliedList[]; // User lists toggled on as exclude lists
  appliedIncludeLists: AppliedList[]; // User lists toggled on as must-include lists
  advancedTargets: AdvancedTargets; // Advanced framework overrides (null = use defaults)
}

// Store state
export interface AppState {
  // Commander
  commander: ScryfallCard | null;
  partnerCommander: ScryfallCard | null;
  colorIdentity: string[];

  // EDHREC Themes
  edhrecThemes: EDHRECTheme[];
  selectedThemes: ThemeResult[];
  themesLoading: boolean;
  themesError: string | null;
  themeSource: 'edhrec' | 'local';
  edhrecNumDecks: number | null;

  // EDHREC land suggestion (set when commander data is fetched)
  edhrecLandSuggestion: { landCount: number; nonBasicLandCount: number } | null;
  // Full EDHREC stats for seeding advanced customization defaults
  edhrecStats: EDHRECCommanderStats | null;
  // True when the user has manually adjusted land count (prevents EDHREC from overriding)
  userEditedLands: boolean;

  // Customization
  customization: Customization;

  // Deck
  generatedDeck: GeneratedDeck | null;
  deckHistory: DeckHistoryEntry[];

  // UI
  isLoading: boolean;
  loadingMessage: string;
  error: string | null;

  // Actions
  setCommander: (card: ScryfallCard | null) => void;
  setPartnerCommander: (card: ScryfallCard | null) => void;
  setEdhrecThemes: (themes: EDHRECTheme[]) => void;
  setEdhrecNumDecks: (count: number | null) => void;
  setSelectedThemes: (themes: ThemeResult[]) => void;
  toggleThemeSelection: (themeName: string) => void;
  setThemesLoading: (loading: boolean) => void;
  setThemesError: (error: string | null) => void;
  setEdhrecLandSuggestion: (suggestion: { landCount: number; nonBasicLandCount: number } | null) => void;
  setEdhrecStats: (stats: EDHRECCommanderStats | null) => void;
  updateCustomization: (updates: Partial<Customization>) => void;
  setGeneratedDeck: (deck: GeneratedDeck | null) => void;
  swapDeckCard: (oldCard: ScryfallCard, newCard: ScryfallCard) => void;
  pushDeckHistory: (entry: Omit<DeckHistoryEntry, 'id' | 'timestamp'>) => void;
  clearDeckHistory: () => void;
  setLoading: (loading: boolean, message?: string) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}
