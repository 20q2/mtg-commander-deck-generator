import { Archetype } from '@/types';

export interface ThemeQuery {
  primary: string;
  secondary?: string;
  keywords: string[];
  suggestedArchetype?: Archetype;
}

/**
 * Maps EDHREC theme names to Scryfall queries and scoring keywords.
 * Theme names are case-insensitive.
 */
const THEME_QUERY_MAP: Record<string, ThemeQuery> = {
  // Token strategies
  tokens: {
    primary: 'o:"create" o:"token"',
    secondary: 'o:"populate" OR o:"go wide"',
    keywords: ['create', 'token', 'populate', 'creatures you control'],
    suggestedArchetype: Archetype.TOKENS,
  },
  'go wide': {
    primary: 'o:"creatures you control" OR o:"each creature you control"',
    keywords: ['creatures you control', 'anthem', 'overrun'],
    suggestedArchetype: Archetype.TOKENS,
  },

  // Counter strategies
  '+1/+1 counters': {
    primary: 'o:"+1/+1 counter"',
    secondary: 'o:"proliferate"',
    keywords: ['+1/+1 counter', 'proliferate', 'enters with', 'counter on'],
  },
  '-1/-1 counters': {
    primary: 'o:"-1/-1 counter"',
    keywords: ['-1/-1 counter', 'wither', 'persist'],
  },
  counters: {
    primary: 'o:"counter on" OR o:"proliferate"',
    keywords: ['counter', 'proliferate'],
  },
  proliferate: {
    primary: 'o:"proliferate"',
    keywords: ['proliferate', 'counter'],
  },

  // Sacrifice/Death strategies
  aristocrats: {
    primary: 'o:"sacrifice" OR (o:"when" o:"dies")',
    secondary: 'o:"drain" OR o:"each opponent loses"',
    keywords: ['sacrifice', 'dies', 'drain', 'blood artist'],
    suggestedArchetype: Archetype.ARISTOCRATS,
  },
  sacrifice: {
    primary: 'o:"sacrifice"',
    keywords: ['sacrifice', 'sac outlet', 'fodder'],
    suggestedArchetype: Archetype.ARISTOCRATS,
  },

  // Equipment/Aura strategies
  voltron: {
    primary: 't:equipment OR t:aura',
    secondary: 'o:"equipped creature" OR o:"enchanted creature"',
    keywords: ['equipment', 'aura', 'equip', 'attach', 'hexproof', 'protection'],
    suggestedArchetype: Archetype.VOLTRON,
  },
  equipment: {
    primary: 't:equipment OR o:"equipped creature"',
    keywords: ['equipment', 'equip', 'attach'],
    suggestedArchetype: Archetype.VOLTRON,
  },
  auras: {
    primary: 't:aura OR o:"enchanted creature"',
    keywords: ['aura', 'enchant', 'enchanted creature'],
    suggestedArchetype: Archetype.VOLTRON,
  },

  // Spell strategies
  spellslinger: {
    primary: '(t:instant OR t:sorcery) o:"whenever you cast"',
    secondary: 'o:"magecraft" OR o:"prowess"',
    keywords: ['instant', 'sorcery', 'whenever you cast', 'magecraft', 'prowess'],
    suggestedArchetype: Archetype.SPELLSLINGER,
  },
  'instants matter': {
    primary: 't:instant OR o:"instant"',
    keywords: ['instant', 'flash'],
    suggestedArchetype: Archetype.SPELLSLINGER,
  },
  storm: {
    primary: 'o:"storm" OR o:"cost" o:"less"',
    secondary: 'o:"add" o:"mana"',
    keywords: ['storm', 'cost less', 'ritual', 'mana'],
    suggestedArchetype: Archetype.STORM,
  },
  cantrips: {
    primary: 'o:"draw a card" cmc<=2',
    keywords: ['draw a card', 'cantrip'],
    suggestedArchetype: Archetype.SPELLSLINGER,
  },

  // Planeswalker strategies
  superfriends: {
    primary: 't:planeswalker',
    secondary: 'o:"planeswalker" OR o:"loyalty"',
    keywords: ['planeswalker', 'loyalty', 'ultimate'],
  },
  planeswalkers: {
    primary: 't:planeswalker',
    keywords: ['planeswalker', 'loyalty'],
  },

  // Graveyard strategies
  reanimator: {
    primary: 'o:"graveyard" o:"return"',
    secondary: 'o:"reanimate" OR o:"unearth"',
    keywords: ['graveyard', 'return', 'reanimate', 'unearth'],
    suggestedArchetype: Archetype.REANIMATOR,
  },
  graveyard: {
    primary: 'o:"graveyard"',
    keywords: ['graveyard', 'mill', 'discard'],
    suggestedArchetype: Archetype.REANIMATOR,
  },
  mill: {
    primary: 'o:"mill" OR (o:"puts" o:"graveyard")',
    keywords: ['mill', 'graveyard', 'library'],
  },
  'self-mill': {
    primary: 'o:"mill" OR o:"discard"',
    keywords: ['mill', 'discard', 'graveyard'],
    suggestedArchetype: Archetype.REANIMATOR,
  },
  flashback: {
    primary: 'o:"flashback"',
    keywords: ['flashback', 'graveyard'],
  },
  dredge: {
    primary: 'o:"dredge"',
    keywords: ['dredge', 'graveyard', 'mill'],
    suggestedArchetype: Archetype.REANIMATOR,
  },

  // Hand manipulation
  wheels: {
    primary: 'o:"each player" (o:"discards" OR o:"draws")',
    secondary: 'o:"wheel" OR o:"discard" o:"draw"',
    keywords: ['wheel', 'discard', 'draw', 'each player'],
  },
  discard: {
    primary: 'o:"discard"',
    keywords: ['discard', 'madness'],
  },

  // Blink/Flicker
  blink: {
    primary: 'o:"exile" o:"return" o:"battlefield"',
    secondary: 'o:"flicker" OR o:"enters the battlefield"',
    keywords: ['exile', 'return', 'flicker', 'enters the battlefield'],
  },
  flicker: {
    primary: 'o:"exile" o:"return" o:"battlefield"',
    keywords: ['exile', 'return', 'enters'],
  },
  etb: {
    primary: 'o:"enters the battlefield"',
    keywords: ['enters the battlefield', 'etb'],
  },

  // Clone/Copy
  clones: {
    primary: 'o:"copy" OR o:"becomes a copy"',
    keywords: ['copy', 'clone', 'becomes'],
  },
  copy: {
    primary: 'o:"copy"',
    keywords: ['copy', 'clone'],
  },

  // Land strategies
  landfall: {
    primary: 'o:"landfall" OR (o:"land" o:"enters")',
    secondary: 'o:"play" o:"additional land"',
    keywords: ['landfall', 'land enters', 'extra land'],
    suggestedArchetype: Archetype.LANDFALL,
  },
  lands: {
    primary: 'o:"land"',
    keywords: ['land', 'landfall'],
    suggestedArchetype: Archetype.LANDFALL,
  },
  'lands matter': {
    primary: 'o:"landfall" OR o:"lands you control"',
    keywords: ['landfall', 'lands you control'],
    suggestedArchetype: Archetype.LANDFALL,
  },

  // Artifact strategies
  artifacts: {
    primary: 't:artifact OR (o:"artifact" o:"enters")',
    secondary: 'o:"affinity" OR o:"metalcraft"',
    keywords: ['artifact', 'affinity', 'metalcraft', 'improvise'],
    suggestedArchetype: Archetype.ARTIFACTS,
  },
  'artifact tokens': {
    primary: 'o:"create" o:"artifact token"',
    keywords: ['artifact token', 'treasure', 'clue', 'food'],
    suggestedArchetype: Archetype.ARTIFACTS,
  },
  treasures: {
    primary: 'o:"treasure"',
    keywords: ['treasure', 'create', 'artifact'],
    suggestedArchetype: Archetype.ARTIFACTS,
  },
  food: {
    primary: 'o:"food"',
    keywords: ['food', 'create', 'gain life'],
  },
  clues: {
    primary: 'o:"clue"',
    keywords: ['clue', 'investigate', 'draw'],
  },

  // Enchantment strategies
  enchantress: {
    primary: 't:enchantment OR (o:"enchantment" o:"draw")',
    secondary: 'o:"constellation"',
    keywords: ['enchantment', 'constellation', 'enchant'],
    suggestedArchetype: Archetype.ENCHANTRESS,
  },
  enchantments: {
    primary: 't:enchantment',
    keywords: ['enchantment', 'aura'],
    suggestedArchetype: Archetype.ENCHANTRESS,
  },
  constellation: {
    primary: 'o:"constellation"',
    keywords: ['constellation', 'enchantment'],
    suggestedArchetype: Archetype.ENCHANTRESS,
  },

  // Combat strategies
  aggro: {
    primary: 'o:"haste" OR o:"attack"',
    keywords: ['haste', 'attack', 'combat'],
    suggestedArchetype: Archetype.AGGRO,
  },
  combat: {
    primary: 'o:"combat" OR o:"attack"',
    keywords: ['combat', 'attack', 'damage'],
    suggestedArchetype: Archetype.AGGRO,
  },
  'extra combat': {
    primary: 'o:"additional combat"',
    keywords: ['additional combat', 'untap', 'attack'],
    suggestedArchetype: Archetype.AGGRO,
  },
  'attack triggers': {
    primary: 'o:"whenever" o:"attacks"',
    keywords: ['attacks', 'combat', 'attack triggers'],
    suggestedArchetype: Archetype.AGGRO,
  },

  // Control strategies
  control: {
    primary: 'o:"counter target" OR o:"destroy target"',
    secondary: 'o:"exile target" OR o:"return" o:"hand"',
    keywords: ['counter', 'destroy', 'exile', 'removal'],
    suggestedArchetype: Archetype.CONTROL,
  },
  stax: {
    primary: 'o:"can\'t" OR o:"opponents" o:"sacrifice"',
    keywords: ["can't", 'sacrifice', 'tax'],
    suggestedArchetype: Archetype.CONTROL,
  },
  pillowfort: {
    primary: 'o:"can\'t attack" OR o:"propaganda"',
    keywords: ["can't attack", 'tax', 'protection'],
    suggestedArchetype: Archetype.CONTROL,
  },

  // Life strategies
  lifegain: {
    primary: 'o:"gain" o:"life"',
    secondary: 'o:"whenever you gain life"',
    keywords: ['gain life', 'lifegain', 'life total'],
  },
  'life gain': {
    primary: 'o:"gain" o:"life"',
    keywords: ['gain life', 'lifegain'],
  },
  lifedrain: {
    primary: 'o:"lose" o:"life" OR o:"drain"',
    keywords: ['lose life', 'drain', 'each opponent'],
  },

  // Special mechanics
  infect: {
    primary: 'o:"infect" OR o:"poison counter"',
    keywords: ['infect', 'poison', 'toxic'],
  },
  poison: {
    primary: 'o:"poison counter" OR o:"toxic"',
    keywords: ['poison', 'toxic', 'infect'],
  },
  energy: {
    primary: 'o:"energy counter"',
    keywords: ['energy', 'counter'],
  },
  cascade: {
    primary: 'o:"cascade"',
    keywords: ['cascade', 'free spell'],
  },
  chaos: {
    primary: 'o:"random" OR o:"flip a coin"',
    keywords: ['random', 'coin', 'chaos'],
  },

  // Group strategies
  'group hug': {
    primary: 'o:"each player" (o:"draws" OR o:"gains")',
    keywords: ['each player', 'draw', 'ramp'],
  },
  'group slug': {
    primary: 'o:"each player" o:"loses" o:"life"',
    keywords: ['each player', 'loses life', 'damage'],
  },
  politics: {
    primary: 'o:"vote" OR o:"monarch"',
    keywords: ['vote', 'monarch', 'politics'],
  },
  monarch: {
    primary: 'o:"monarch"',
    keywords: ['monarch', 'draw'],
  },

  // Draw strategies
  'card draw': {
    primary: 'o:"draw" o:"card"',
    keywords: ['draw', 'cards'],
  },

  // Combo enablers
  combo: {
    primary: 'o:"untap" OR o:"infinite"',
    secondary: 'o:"each" o:"add"',
    keywords: ['untap', 'combo', 'infinite'],
    suggestedArchetype: Archetype.COMBO,
  },
  'infinite combos': {
    primary: 'o:"untap" OR o:"whenever"',
    keywords: ['untap', 'infinite', 'combo'],
    suggestedArchetype: Archetype.COMBO,
  },
  tutors: {
    primary: 'o:"search your library"',
    keywords: ['search', 'tutor', 'library'],
    suggestedArchetype: Archetype.COMBO,
  },

  // Creature type themes (tribal)
  tribal: {
    primary: 't:creature',
    keywords: ['tribal', 'creature type'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  elves: {
    primary: 't:elf',
    keywords: ['elf', 'elves'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  goblins: {
    primary: 't:goblin',
    keywords: ['goblin', 'goblins'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  zombies: {
    primary: 't:zombie',
    keywords: ['zombie', 'zombies'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  vampires: {
    primary: 't:vampire',
    keywords: ['vampire', 'vampires', 'blood'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  dragons: {
    primary: 't:dragon',
    keywords: ['dragon', 'dragons'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  angels: {
    primary: 't:angel',
    keywords: ['angel', 'angels'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  demons: {
    primary: 't:demon',
    keywords: ['demon', 'demons'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  wizards: {
    primary: 't:wizard',
    keywords: ['wizard', 'wizards'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  warriors: {
    primary: 't:warrior',
    keywords: ['warrior', 'warriors'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  rogues: {
    primary: 't:rogue',
    keywords: ['rogue', 'rogues'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  clerics: {
    primary: 't:cleric',
    keywords: ['cleric', 'clerics'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  soldiers: {
    primary: 't:soldier',
    keywords: ['soldier', 'soldiers'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  knights: {
    primary: 't:knight',
    keywords: ['knight', 'knights'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  merfolk: {
    primary: 't:merfolk',
    keywords: ['merfolk', 'islandwalk'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  spirits: {
    primary: 't:spirit',
    keywords: ['spirit', 'spirits'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  dinosaurs: {
    primary: 't:dinosaur',
    keywords: ['dinosaur', 'dinosaurs', 'enrage'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  pirates: {
    primary: 't:pirate',
    keywords: ['pirate', 'pirates', 'treasure'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  cats: {
    primary: 't:cat',
    keywords: ['cat', 'cats'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  dogs: {
    primary: 't:dog',
    keywords: ['dog', 'dogs'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  beasts: {
    primary: 't:beast',
    keywords: ['beast', 'beasts'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  elementals: {
    primary: 't:elemental',
    keywords: ['elemental', 'elementals'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  slivers: {
    primary: 't:sliver',
    keywords: ['sliver', 'slivers'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  allies: {
    primary: 't:ally',
    keywords: ['ally', 'allies'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  humans: {
    primary: 't:human',
    keywords: ['human', 'humans'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  faeries: {
    primary: 't:faerie',
    keywords: ['faerie', 'faeries', 'flash', 'flying'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  eldrazi: {
    primary: 't:eldrazi',
    keywords: ['eldrazi', 'colorless', 'annihilator'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  horrors: {
    primary: 't:horror',
    keywords: ['horror', 'horrors'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  insects: {
    primary: 't:insect',
    keywords: ['insect', 'insects'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  tyranids: {
    primary: 't:tyranid',
    keywords: ['tyranid', '+1/+1 counter'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  hydras: {
    primary: 't:hydra',
    keywords: ['hydra', '+1/+1 counter'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  werewolves: {
    primary: 't:werewolf OR t:wolf',
    keywords: ['werewolf', 'wolf', 'transform'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  wolves: {
    primary: 't:wolf',
    keywords: ['wolf', 'wolves'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  rats: {
    primary: 't:rat',
    keywords: ['rat', 'rats'],
    suggestedArchetype: Archetype.TRIBAL,
  },
  squirrels: {
    primary: 't:squirrel',
    keywords: ['squirrel', 'squirrels'],
    suggestedArchetype: Archetype.TRIBAL,
  },
};

/**
 * Get Scryfall query for an EDHREC theme
 */
export function getQueryForTheme(themeName: string): ThemeQuery | null {
  const normalized = themeName.toLowerCase().trim();
  return THEME_QUERY_MAP[normalized] || null;
}

/**
 * Get keywords for scoring cards based on theme
 */
export function getKeywordsForTheme(themeName: string): string[] {
  const query = getQueryForTheme(themeName);
  return query?.keywords || [];
}

/**
 * Get suggested archetype for a theme (for deck composition adjustments)
 */
export function getSuggestedArchetype(themeName: string): Archetype | null {
  const query = getQueryForTheme(themeName);
  return query?.suggestedArchetype || null;
}

/**
 * Build combined queries from multiple selected themes
 */
export function buildQueriesFromThemes(themeNames: string[]): {
  creatureQuery: string;
  synergyQuery: string;
  keywords: string[];
} {
  const queries = themeNames
    .map((name) => getQueryForTheme(name))
    .filter((q): q is ThemeQuery => q !== null);

  if (queries.length === 0) {
    return {
      creatureQuery: 't:creature',
      synergyQuery: '',
      keywords: [],
    };
  }

  // Collect all keywords
  const keywords = [...new Set(queries.flatMap((q) => q.keywords))];

  // Build synergy query from primaries
  const primaryQueries = queries.map((q) => `(${q.primary})`);
  const synergyQuery = primaryQueries.join(' OR ');

  // For creatures, check if any theme is tribal
  const tribalQueries = queries.filter((q) => q.primary.startsWith('t:'));
  const creatureQuery =
    tribalQueries.length > 0
      ? tribalQueries.map((q) => q.primary).join(' OR ')
      : 't:creature';

  return {
    creatureQuery,
    synergyQuery,
    keywords,
  };
}

/**
 * Get all available theme names (for autocomplete/suggestions)
 */
export function getAllThemeNames(): string[] {
  return Object.keys(THEME_QUERY_MAP);
}
