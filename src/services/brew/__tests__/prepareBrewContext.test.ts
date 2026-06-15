import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/edhrec/client', () => ({
  fetchCommanderData: vi.fn(),
  fetchPartnerCommanderData: vi.fn(),
  fetchCommanderCombos: vi.fn(async () => []),
}));
vi.mock('@/services/scryfall/client', () => ({
  getCardsByNames: vi.fn(),
}));
vi.mock('@/services/tagger/client', () => ({
  loadTaggerData: vi.fn(async () => null),
  getCardRole: vi.fn((name: string) => (name === 'Swords to Plowshares' ? 'removal' : null)),
  getCardSubtype: vi.fn(() => null),
}));

import { prepareBrewContext } from '../prepareBrewContext';
import { fetchCommanderData } from '@/services/edhrec/client';
import { getCardsByNames } from '@/services/scryfall/client';
import type { Customization, ScryfallCard, EDHRECCommanderData } from '@/types';

const baseCustomization = {
  deckFormat: 99, landCount: 36, nonBasicLandCount: 15, bannedCards: [], banLists: [],
  mustIncludeCards: [], tempBannedCards: [], tempMustIncludeCards: [], maxCardPrice: null,
  deckBudget: null, budgetOption: 'any', gameChangerLimit: 'unlimited', bracketLevel: 'all',
  maxRarity: null, tinyLeaders: false, collectionMode: false, collectionStrategy: 'full',
  collectionOwnedPercent: 75, arenaOnly: false, scryfallQuery: '', comboCount: 0, hyperFocus: false,
  balancedRoles: false, ignoreOwnedBudget: false, ignoreOwnedRarity: false, currency: 'USD',
  appliedExcludeLists: [], appliedIncludeLists: [], advancedTargets: { curvePercentages: null,
  typePercentages: null, roleTargets: null, edhrecBlendWeight: null, edhrecInclusionThreshold: null },
  tempoAutoDetect: true, tempoPacing: 'balanced',
} as unknown as Customization;

function sf(name: string, over: Partial<ScryfallCard> = {}): ScryfallCard {
  return { id: name, name, cmc: 3, type_line: 'Instant', color_identity: ['W'],
    prices: { usd: '1.00' }, ...over } as ScryfallCard;
}

const commander = sf('Test Commander', { type_line: 'Legendary Creature' });

beforeEach(() => {
  vi.mocked(fetchCommanderData).mockResolvedValue({
    themes: [],
    stats: { numDecks: 1000, manaCurve: { 1: 5, 2: 10, 3: 10 }, landDistribution: { total: 36, nonbasic: 15, basic: 21 },
      typeDistribution: { creature: 25, instant: 10, sorcery: 8, artifact: 8, enchantment: 6, planeswalker: 1, battle: 0 } },
    cardlists: {
      allNonLand: [
        { name: 'Swords to Plowshares', sanitized: 'swords', primary_type: 'Instant', inclusion: 88, num_decks: 900, isThemeSynergyCard: true },
        { name: 'Some Forest', sanitized: 'forest', primary_type: 'Land', inclusion: 50, num_decks: 500 },
        { name: 'Random Bear', sanitized: 'bear', primary_type: 'Creature', inclusion: 40, num_decks: 400 },
      ],
    },
  } as unknown as EDHRECCommanderData);

  vi.mocked(getCardsByNames).mockResolvedValue(new Map<string, ScryfallCard>([
    ['Swords to Plowshares', sf('Swords to Plowshares', { cmc: 1, type_line: 'Instant' })],
    ['Some Forest', sf('Some Forest', { cmc: 0, type_line: 'Basic Land — Forest' })],
    ['Random Bear', sf('Random Bear', { cmc: 2, type_line: 'Creature — Bear', color_identity: ['G'] })],
  ]));
});

describe('prepareBrewContext', () => {
  it('builds a non-land candidate pool with roles, and stamps cmc + theme flag', async () => {
    const ctx = await prepareBrewContext({
      commander, partnerCommander: null, colorIdentity: ['G', 'W'],
      customization: baseCustomization,
    });
    const names = ctx.candidates.map(c => c.name);
    expect(names).toContain('Swords to Plowshares');
    expect(names).toContain('Random Bear');
    expect(names).not.toContain('Some Forest');           // land excluded

    const swords = ctx.candidates.find(c => c.name === 'Swords to Plowshares')!;
    expect(swords.role).toBe('removal');                   // from mocked getCardRole
    expect(swords.edhrec.cmc).toBe(1);                     // stamped from scryfall.cmc
    expect(swords.scryfall.isThemeSynergyCard).toBe(true); // stamped from edhrec flag
  });

  it('computes targets and respects landCount', async () => {
    const ctx = await prepareBrewContext({
      commander, partnerCommander: null, colorIdentity: ['G', 'W'],
      customization: { ...baseCustomization, landCount: 36 },
    });
    expect(ctx.landTarget).toBe(36);
    expect(ctx.nonLandTarget).toBe(63);                    // 99 - 36
    expect(ctx.roleTargets.ramp).toBeGreaterThan(0);
  });

  it('in collection full mode, keeps only owned cards', async () => {
    const ctx = await prepareBrewContext({
      commander, partnerCommander: null, colorIdentity: ['G', 'W'],
      customization: { ...baseCustomization, collectionMode: true, collectionStrategy: 'full' },
      collectionNames: new Set(['Swords to Plowshares']),
    });
    expect(ctx.candidates.map(c => c.name)).toEqual(['Swords to Plowshares']);
  });
});
