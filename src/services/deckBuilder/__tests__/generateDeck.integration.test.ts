/**
 * End-to-end tests for generateDeck against synthetic fixture data.
 *
 * The Scryfall / EDHREC / tagger network functions are mocked at the module
 * boundary; everything else (selection, curve, budget, trim, combo audit,
 * bracket estimation) runs for real. Because live data is dynamic, these tests
 * assert INVARIANTS — contracts that must hold no matter what the APIs return:
 * exact deck size, singleton rule, color identity, ban list, budget ceiling —
 * rather than exact card picks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Customization, EDHRECCard, EDHRECCombo, EDHRECCommanderData, ScryfallCard } from '@/types';

vi.mock('@/services/scryfall/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/scryfall/client')>();
  return {
    ...actual,
    searchCards: vi.fn(),
    getCardByName: vi.fn(),
    getCardsByNames: vi.fn(),
    getCheapestPrintings: vi.fn(),
    prefetchBasicLands: vi.fn(),
    getCachedCard: vi.fn(),
    getGameChangerNames: vi.fn(),
    getArenaLegalNames: vi.fn(),
    fetchMultiCopyCardNames: vi.fn(),
    upgradeCardPrintings: vi.fn(),
  };
});

vi.mock('@/services/edhrec/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/edhrec/client')>();
  return {
    ...actual,
    fetchCommanderData: vi.fn(),
    fetchCommanderThemeData: vi.fn(),
    fetchPartnerCommanderData: vi.fn(),
    fetchPartnerThemeData: vi.fn(),
    fetchAverageDeckMultiCopies: vi.fn(),
    fetchCommanderCombos: vi.fn(),
    fetchColorIdentityCombos: vi.fn(),
    fetchTagPageData: vi.fn(),
  };
});

vi.mock('@/services/tagger/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/tagger/client')>();
  // No tagger data in tests — role detection runs in its "unavailable" mode.
  return { ...actual, loadTaggerData: vi.fn(async () => {}) };
});

vi.mock('@/hooks/useUserLists', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useUserLists')>();
  return { ...actual, loadUserLists: vi.fn(() => []) };
});

import {
  searchCards, getCardByName, getCardsByNames, getCheapestPrintings,
  prefetchBasicLands, getCachedCard, getGameChangerNames, getArenaLegalNames,
  fetchMultiCopyCardNames, upgradeCardPrintings, getCardPrice,
} from '@/services/scryfall/client';
import {
  fetchCommanderData, fetchCommanderThemeData, fetchPartnerCommanderData,
  fetchPartnerThemeData, fetchAverageDeckMultiCopies, fetchCommanderCombos,
  fetchColorIdentityCombos, fetchTagPageData,
} from '@/services/edhrec/client';
import { generateDeck, clearGenerationCache } from '../deckGenerator';

// ── Fixture card database ─────────────────────────────────────────────────

const DB = new Map<string, ScryfallCard>();

let idCounter = 0;
function mkCard(name: string, typeLine: string, opts: {
  cmc?: number; ci?: string[]; price?: number; rarity?: string; oracle?: string;
} = {}): ScryfallCard {
  const card = {
    id: `fixture-${++idCounter}`,
    name,
    type_line: typeLine,
    cmc: opts.cmc ?? 2,
    color_identity: opts.ci ?? [],
    colors: opts.ci ?? [],
    rarity: opts.rarity ?? 'uncommon',
    prices: { usd: String(opts.price ?? 0.5), eur: String(opts.price ?? 0.5) },
    oracle_text: opts.oracle ?? '',
    set: 'fix',
    edhrec_rank: idCounter,
    legalities: { commander: 'legal' },
  } as unknown as ScryfallCard;
  DB.set(name, card);
  return card;
}

function mkEdhrec(name: string, primaryType: string, inclusion: number, synergy = 0.1): EDHRECCard {
  return {
    name,
    sanitized: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    primary_type: primaryType,
    inclusion,
    num_decks: Math.round(inclusion * 42),
    synergy,
  };
}

interface PoolSpec { type: string; typeLine: (i: number) => string; count: number }

const POOLS: PoolSpec[] = [
  { type: 'Creature', typeLine: () => 'Creature — Elf Wizard', count: 60 },
  { type: 'Instant', typeLine: () => 'Instant', count: 25 },
  { type: 'Sorcery', typeLine: () => 'Sorcery', count: 20 },
  { type: 'Artifact', typeLine: () => 'Artifact', count: 20 },
  { type: 'Enchantment', typeLine: () => 'Enchantment', count: 18 },
  { type: 'Planeswalker', typeLine: () => 'Legendary Planeswalker — Fixture', count: 8 },
];

const IDENTITY = ['G', 'U'];
const edhrecLists: Record<string, EDHRECCard[]> = {
  creatures: [], instants: [], sorceries: [], artifacts: [], enchantments: [], planeswalkers: [], lands: [],
};
const TYPE_TO_LIST: Record<string, string> = {
  Creature: 'creatures', Instant: 'instants', Sorcery: 'sorceries',
  Artifact: 'artifacts', Enchantment: 'enchantments', Planeswalker: 'planeswalkers',
};

// Spell pools: colors cycle within identity, CMC cycles 1–6, inclusion descends 90→~20.
for (const pool of POOLS) {
  for (let i = 1; i <= pool.count; i++) {
    const name = `Fixture ${pool.type} ${i}`;
    const ci = pool.type === 'Artifact' ? [] : [IDENTITY[i % IDENTITY.length]];
    mkCard(name, pool.typeLine(i), {
      cmc: (i % 6) + 1,
      ci,
      // Cheap pool (~$0.55 avg): the budget test needs a 99-card deck to be
      // comfortably affordable, since the shortage-fill path is documented as
      // budget-best-effort and would otherwise legitimately overshoot.
      price: 0.1 + (i % 7) * 0.15,
      rarity: ['common', 'uncommon', 'rare', 'mythic'][i % 4],
    });
    edhrecLists[TYPE_TO_LIST[pool.type]].push(mkEdhrec(name, pool.type, Math.max(20, 90 - i)));
  }
}

// Non-basic lands for the mana base.
for (let i = 1; i <= 20; i++) {
  const name = `Fixture Dual ${i}`;
  mkCard(name, 'Land', { cmc: 0, ci: IDENTITY, price: 0.5 });
  edhrecLists.lands.push(mkEdhrec(name, 'Land', Math.max(20, 85 - i)));
}

// Basics, staples, and special-case cards.
for (const [basic, color] of [
  ['Forest', 'G'], ['Island', 'U'], ['Plains', 'W'], ['Swamp', 'B'], ['Mountain', 'R'], ['Wastes', ''],
] as const) {
  mkCard(basic, `Basic Land — ${basic === 'Wastes' ? '' : basic}`, { cmc: 0, ci: color ? [color] : [], price: 0.02 });
}
mkCard('Command Tower', 'Land', { cmc: 0, ci: [], price: 0.4, rarity: 'common' });
mkCard('Sol Ring', 'Artifact', { cmc: 1, ci: [], price: 1.5, rarity: 'uncommon' });
mkCard('Arcane Signet', 'Artifact', { cmc: 2, ci: [], price: 0.8, rarity: 'common' });

// Off-color trap: must NEVER be picked despite top inclusion.
mkCard('Forbidden Bolt', 'Instant', { cmc: 1, ci: ['R'], price: 0.3 });
edhrecLists.instants.unshift(mkEdhrec('Forbidden Bolt', 'Instant', 95));

// Budget trap: legal color, top inclusion, but $49.99.
mkCard('Expensive Bomb', 'Creature — Dragon', { cmc: 5, ci: ['G'], price: 49.99, rarity: 'mythic' });
edhrecLists.creatures.unshift(mkEdhrec('Expensive Bomb', 'Creature', 92));

// Combo pieces (both in-pool, decent inclusion so they pass the combo floor).
mkCard('Combo Piece Alpha', 'Creature — Zombie', { cmc: 2, ci: ['G'], price: 1.0 });
mkCard('Combo Piece Beta', 'Instant', { cmc: 2, ci: ['U'], price: 1.0 });
edhrecLists.creatures.push(mkEdhrec('Combo Piece Alpha', 'Creature', 40));
edhrecLists.instants.push(mkEdhrec('Combo Piece Beta', 'Instant', 38));

const COMMANDER = mkCard('Testmander, Fixture Sage', 'Legendary Creature — Merfolk Druid', { cmc: 3, ci: IDENTITY, price: 5 });
const PARTNER = mkCard('Partner of Testing', 'Legendary Creature — Human Advisor', { cmc: 2, ci: ['U'], price: 2 });

const BASIC_NAMES = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes']);

const COMBOS: EDHRECCombo[] = [{
  comboId: 'fixture-combo-1',
  cards: [{ name: 'Combo Piece Alpha', id: 'a' }, { name: 'Combo Piece Beta', id: 'b' }],
  results: ['Infinite fixture value'],
  deckCount: 900,
  rank: 4,
  bracket: '3',
  prereqCount: 0,
}];

function makeEdhrecData(): EDHRECCommanderData {
  const lists = {
    creatures: [...edhrecLists.creatures],
    instants: [...edhrecLists.instants],
    sorceries: [...edhrecLists.sorceries],
    artifacts: [...edhrecLists.artifacts],
    enchantments: [...edhrecLists.enchantments],
    planeswalkers: [...edhrecLists.planeswalkers],
    lands: [...edhrecLists.lands],
    allNonLand: [] as EDHRECCard[],
  };
  lists.allNonLand = [
    ...lists.creatures, ...lists.instants, ...lists.sorceries,
    ...lists.artifacts, ...lists.enchantments, ...lists.planeswalkers,
  ];
  return {
    themes: [],
    similarCommanders: [],
    stats: {
      avgPrice: 120,
      numDecks: 4200,
      deckSize: 99,
      manaCurve: { 0: 2, 1: 8, 2: 13, 3: 15, 4: 11, 5: 7, 6: 4, 7: 2 },
      typeDistribution: { creature: 26, instant: 9, sorcery: 8, artifact: 9, enchantment: 7, land: 37, planeswalker: 2, battle: 0 },
      landDistribution: { basic: 20, nonbasic: 17, total: 37 },
    },
    cardlists: lists,
  };
}

// ── Test scaffolding ──────────────────────────────────────────────────────

function baseCustomization(overrides: Partial<Customization> = {}): Customization {
  return {
    deckFormat: 99,
    landCount: 37,
    nonBasicLandCount: 15,
    bannedCards: [],
    banLists: [],
    mustIncludeCards: [],
    tempBannedCards: [],
    tempMustIncludeCards: [],
    maxCardPrice: null,
    deckBudget: null,
    budgetOption: 'any',
    gameChangerLimit: 'unlimited',
    bracketLevel: 'all',
    allowedRarities: null,
    tinyLeaders: false,
    collectionMode: false,
    collectionStrategy: 'full',
    collectionOwnedPercent: 75,
    arenaOnly: false,
    scryfallQuery: '',
    comboCount: 0,
    hyperFocus: false,
    balancedRoles: true,
    ignoreOwnedBudget: false,
    ignoreOwnedRarity: false,
    currency: 'USD',
    appliedExcludeLists: [],
    appliedIncludeLists: [],
    advancedTargets: { curvePercentages: null, typePercentages: null, roleTargets: null, edhrecBlendWeight: null, edhrecInclusionThreshold: null },
    tempoAutoDetect: true,
    tempoPacing: 'balanced',
    ...overrides,
  };
}

function makeContext(overrides: {
  customization?: Partial<Customization>;
  partner?: boolean;
  collectionNames?: Set<string>;
} = {}) {
  return {
    commander: { ...COMMANDER },
    partnerCommander: overrides.partner ? { ...PARTNER } : null,
    colorIdentity: IDENTITY,
    customization: baseCustomization(overrides.customization),
    collectionNames: overrides.collectionNames,
  };
}

function allCards(deck: Awaited<ReturnType<typeof generateDeck>>): ScryfallCard[] {
  return Object.values(deck.categories).flat();
}

beforeEach(() => {
  clearGenerationCache();
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  const clone = (c: ScryfallCard): ScryfallCard => ({ ...c, prices: { ...c.prices } });

  vi.mocked(getCardsByNames).mockImplementation(async (names: string[]) => {
    const map = new Map<string, ScryfallCard>();
    for (const n of names) {
      const card = DB.get(n);
      if (card) map.set(n, clone(card));
    }
    return map;
  });
  vi.mocked(getCardByName).mockImplementation(async (name: string) => {
    const card = DB.get(name);
    if (!card) throw new Error(`fixture miss: ${name}`);
    return clone(card);
  });
  vi.mocked(getCachedCard).mockImplementation(((name: string) => {
    const card = DB.get(name);
    return card ? clone(card) : null;
  }) as typeof getCachedCard);
  vi.mocked(getCheapestPrintings).mockResolvedValue(new Map());
  vi.mocked(prefetchBasicLands).mockResolvedValue(undefined as never);
  vi.mocked(getGameChangerNames).mockResolvedValue(new Set());
  vi.mocked(getArenaLegalNames).mockImplementation(async (names: string[]) => new Set(names));
  vi.mocked(fetchMultiCopyCardNames).mockResolvedValue(new Map());
  vi.mocked(upgradeCardPrintings).mockResolvedValue(undefined as never);
  vi.mocked(searchCards).mockResolvedValue({ data: [] } as never);

  vi.mocked(fetchCommanderData).mockImplementation(async () => makeEdhrecData());
  vi.mocked(fetchPartnerCommanderData).mockImplementation(async () => makeEdhrecData());
  vi.mocked(fetchCommanderThemeData).mockImplementation(async () => makeEdhrecData());
  vi.mocked(fetchPartnerThemeData).mockImplementation(async () => makeEdhrecData());
  vi.mocked(fetchCommanderCombos).mockResolvedValue(COMBOS.map(c => ({ ...c, cards: [...c.cards] })));
  vi.mocked(fetchColorIdentityCombos).mockResolvedValue([]);
  vi.mocked(fetchTagPageData).mockResolvedValue(null as never);
  vi.mocked(fetchAverageDeckMultiCopies).mockResolvedValue(null);
});

// ── Invariant tests ───────────────────────────────────────────────────────

describe('generateDeck (fixture integration)', () => {
  it('produces a legal 99-card singleton deck within color identity', async () => {
    const deck = await generateDeck(makeContext());
    const cards = allCards(deck);

    expect(cards).toHaveLength(99);
    expect(deck.categories.lands).toHaveLength(37);

    // Singleton rule (basics exempt)
    const nonBasics = cards.filter(c => !BASIC_NAMES.has(c.name)).map(c => c.name);
    expect(new Set(nonBasics).size).toBe(nonBasics.length);

    // Color identity: every card's identity must be a subset of the commander's
    for (const card of cards) {
      for (const color of card.color_identity ?? []) {
        expect(IDENTITY, `${card.name} is outside color identity`).toContain(color);
      }
    }
    expect(cards.map(c => c.name)).not.toContain('Forbidden Bolt');
  });

  it('excludes banned cards and honors must-includes', async () => {
    const deck = await generateDeck(makeContext({
      customization: {
        bannedCards: ['Fixture Creature 1', 'Fixture Dual 1'],
        mustIncludeCards: ['Fixture Sorcery 15'],
      },
    }));
    const names = allCards(deck).map(c => c.name);

    expect(names).toHaveLength(99);
    expect(names).not.toContain('Fixture Creature 1');
    expect(names).not.toContain('Fixture Dual 1');
    expect(names).toContain('Fixture Sorcery 15');
    const mustInclude = allCards(deck).find(c => c.name === 'Fixture Sorcery 15');
    expect(mustInclude?.isMustInclude).toBe(true);
  });

  it('seeds combo pieces on the FIRST (uncached) generation', async () => {
    // Regression: combo scoring used to run before EDHREC data was fetched, so
    // the inclusion floor filtered out every combo on uncached runs.
    const deck = await generateDeck(makeContext({ customization: { comboCount: 1 } }));
    const names = allCards(deck).map(c => c.name);

    expect(names).toContain('Combo Piece Alpha');
    expect(names).toContain('Combo Piece Beta');
    const combo = deck.detectedCombos?.find(c => c.comboId === 'fixture-combo-1');
    expect(combo).toBeDefined();
    expect(combo?.isComplete).toBe(true);
  });

  it('keeps the deck under a feasible total budget and rejects over-cap cards', async () => {
    // The budget is a hard cap during selection but best-effort in the
    // shortage-fill path, so this asserts the feasible case: the pool has
    // plenty of cheap cards, so the total must land under the budget and the
    // $49.99 bomb must be rejected by the per-card effective cap.
    const deck = await generateDeck(makeContext({ customization: { deckBudget: 50 } }));
    const cards = allCards(deck);

    expect(cards).toHaveLength(99);
    expect(cards.map(c => c.name)).not.toContain('Expensive Bomb');
    const total = cards.reduce((sum, c) => sum + parseFloat(getCardPrice(c, 'USD') ?? '0'), 0);
    expect(total).toBeLessThanOrEqual(50);
  });

  it('does not auto-include Command Tower when it is not in the collection (full mode)', async () => {
    const owned = new Set([...DB.keys()].filter(n => n !== 'Command Tower'));
    const deck = await generateDeck(makeContext({
      customization: { collectionMode: true, collectionStrategy: 'full' },
      collectionNames: owned,
    }));
    const names = allCards(deck).map(c => c.name);

    expect(names).not.toContain('Command Tower');
    expect(names).toHaveLength(99);
  });

  it('builds a 98-card deck for partner commanders', async () => {
    const deck = await generateDeck(makeContext({ partner: true }));
    expect(allCards(deck)).toHaveLength(98);
    expect(allCards(deck).map(c => c.name)).not.toContain(COMMANDER.name);
    expect(allCards(deck).map(c => c.name)).not.toContain(PARTNER.name);
  });
});
