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

export interface ArchetypeResult {
  archetype: Archetype;
  score: number;
  matchedKeywords: string[];
  confidence: 'high' | 'medium' | 'low';
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
}

/** Describes which data source was ultimately used for deck generation */
export type DeckDataSource =
  | 'theme+bracket'   // Ideal: theme-specific data with bracket/power level
  | 'theme'           // Theme data but without bracket filtering
  | 'base+bracket'    // Base commander data with bracket/power level
  | 'base'            // Base commander data, no bracket
  | 'scryfall';       // No EDHREC data at all — pure Scryfall search

export interface GeneratedDeck {
  commander: ScryfallCard;
  partnerCommander: ScryfallCard | null;
  categories: Record<DeckCategory, ScryfallCard[]>;
  stats: DeckStats;
  usedThemes?: string[];
  gapAnalysis?: GapAnalysisCard[];
  builtFromCollection?: boolean;
  collectionShortfall?: number;
  detectedCombos?: DetectedCombo[];
  typeTargets?: Record<string, number>;
  dataSource?: DeckDataSource;
}

export interface DeckStats {
  totalCards: number;
  averageCmc: number;
  manaCurve: Record<number, number>; // CMC -> count
  colorDistribution: Record<string, number>; // Color -> count
  typeDistribution: Record<string, number>; // Type -> count
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

// Ban list (preset or custom)
export interface BanList {
  id: string;
  name: string;
  cards: string[];
  isPreset: boolean;
  enabled: boolean;
}

// User-created reusable card list
export interface UserCardList {
  id: string;
  name: string;
  description: string;
  cards: string[];
  createdAt: number;
  updatedAt: number;
}

// Reference to a user list applied as exclude or include
export interface AppliedList {
  listId: string;
  enabled: boolean;
}

// User customization
export interface Customization {
  deckFormat: DeckFormat;
  landCount: number;
  nonBasicLandCount: number; // How many non-basic lands to include (rest will be basics)
  bannedCards: string[]; // Card names to exclude from deck generation
  banLists: BanList[]; // Named ban lists (preset + custom)
  mustIncludeCards: string[]; // Card names to force-include in deck generation (first priority)
  maxCardPrice: number | null; // Max USD price per card, null = no limit
  deckBudget: number | null; // Total deck budget in USD, null = no limit
  budgetOption: BudgetOption; // EDHREC card pool: any (normal), budget, or expensive
  gameChangerLimit: GameChangerLimit; // How many game changer cards to allow
  bracketLevel: BracketLevel; // EDHREC bracket level for power level filtering
  maxRarity: MaxRarity; // Max card rarity, null = no limit
  tinyLeaders: boolean; // Restrict all non-land cards to CMC <= 3
  collectionMode: boolean; // When true, constrain generation to owned cards
  arenaOnly: boolean; // When true, only use cards available on MTG Arena
  comboCount: number; // 0 = none, 1 = a few, 2 = many combo pieces prioritized
  hyperFocus: boolean; // When true, boost unique theme cards and penalize generic multi-theme cards
  currency: 'USD' | 'EUR'; // Price currency for budget filtering and display
  appliedExcludeLists: AppliedList[]; // User lists toggled on as exclude lists
  appliedIncludeLists: AppliedList[]; // User lists toggled on as must-include lists
}

// Store state
export interface AppState {
  // Commander
  commander: ScryfallCard | null;
  partnerCommander: ScryfallCard | null;
  colorIdentity: string[];

  // Archetype
  detectedArchetypes: ArchetypeResult[];
  selectedArchetype: Archetype;

  // EDHREC Themes
  edhrecThemes: EDHRECTheme[];
  selectedThemes: ThemeResult[];
  themesLoading: boolean;
  themesError: string | null;
  themeSource: 'edhrec' | 'local';

  // EDHREC land suggestion (set when commander data is fetched)
  edhrecLandSuggestion: { landCount: number; nonBasicLandCount: number } | null;
  // True when the user has manually adjusted land count (prevents EDHREC from overriding)
  userEditedLands: boolean;

  // Customization
  customization: Customization;

  // Deck
  generatedDeck: GeneratedDeck | null;

  // UI
  isLoading: boolean;
  loadingMessage: string;
  error: string | null;

  // Actions
  setCommander: (card: ScryfallCard | null) => void;
  setPartnerCommander: (card: ScryfallCard | null) => void;
  setDetectedArchetypes: (archetypes: ArchetypeResult[]) => void;
  setSelectedArchetype: (archetype: Archetype) => void;
  setEdhrecThemes: (themes: EDHRECTheme[]) => void;
  setSelectedThemes: (themes: ThemeResult[]) => void;
  toggleThemeSelection: (themeName: string) => void;
  setThemesLoading: (loading: boolean) => void;
  setThemesError: (error: string | null) => void;
  setEdhrecLandSuggestion: (suggestion: { landCount: number; nonBasicLandCount: number } | null) => void;
  updateCustomization: (updates: Partial<Customization>) => void;
  setGeneratedDeck: (deck: GeneratedDeck | null) => void;
  setLoading: (loading: boolean, message?: string) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}
