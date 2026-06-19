import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/edhrec/client', () => ({ fetchCardRelations: vi.fn() }));
vi.mock('@/services/scryfall/client', () => ({ getCardsByNames: vi.fn() }));
vi.mock('@/services/tagger/client', () => ({
  loadTaggerData: vi.fn(async () => null),
  getCardRole: vi.fn(() => null),
  getCardSubtype: vi.fn(() => null),
}));

import { discoverFrom } from '../discovery';
import { fetchCardRelations } from '@/services/edhrec/client';
import { getCardsByNames } from '@/services/scryfall/client';
import { makeContext, makeState } from './fixtures';
import type { ScryfallCard } from '@/types';

function sf(name: string, over: Partial<ScryfallCard> = {}): ScryfallCard {
  return { id: name, name, cmc: 3, type_line: 'Instant', color_identity: ['B'],
    legalities: { commander: 'legal' }, prices: { usd: '1.00' }, ...over } as ScryfallCard;
}

beforeEach(() => vi.clearAllMocks());

describe('discoverFrom', () => {
  it('keeps in-identity legal non-lands and drops the rest, with provenance', async () => {
    vi.mocked(fetchCardRelations).mockResolvedValue([
      { name: 'Good Find', source: 'lift', coPct: 12 },
      { name: 'Off Color', source: 'lift', coPct: 40 },
      { name: 'A Land', source: 'coplay', coPct: 80 },
    ]);
    vi.mocked(getCardsByNames).mockResolvedValue(new Map<string, ScryfallCard>([
      ['Good Find', sf('Good Find', { color_identity: ['B'] })],
      ['Off Color', sf('Off Color', { color_identity: ['R'] })],
      ['A Land', sf('A Land', { type_line: 'Land', color_identity: [] })],
    ]));

    const ctx = makeContext({ candidates: [], colorIdentity: ['B', 'G'] });
    const found = await discoverFrom(['Korvold'], ctx, makeState());

    expect(found.map(c => c.name)).toEqual(['Good Find']); // off-color + land dropped
    expect(found[0].discoveredVia).toBe('Korvold');
    expect(found[0].discoverySource).toBe('lift');
    expect(found[0].coSynergy).toBe(12);
    expect(found[0].inclusion).toBe(12);                    // inclusion seeded from co%
  });

  it('drops cards already used or already in the pool', async () => {
    vi.mocked(fetchCardRelations).mockResolvedValue([
      { name: 'Already Picked', source: 'lift', coPct: 50 },
      { name: 'Fresh', source: 'lift', coPct: 10 },
    ]);
    vi.mocked(getCardsByNames).mockResolvedValue(new Map<string, ScryfallCard>([
      ['Fresh', sf('Fresh', { color_identity: ['B'] })],
    ]));
    const ctx = makeContext({ candidates: [], colorIdentity: ['B'] });
    const state = makeState({ usedNames: ['Already Picked'] });
    const found = await discoverFrom(['Korvold'], ctx, state);
    expect(found.map(c => c.name)).toEqual(['Fresh']);
  });
});
