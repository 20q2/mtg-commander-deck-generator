import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/deckBuilder/deckGenerator', () => ({
  generateDeck: vi.fn(async () => ({ stats: { totalCards: 99 }, categories: {} })),
}));

import { finishBrew } from '../finishBrew';
import { generateDeck } from '@/services/deckBuilder/deckGenerator';
import type { BrewContext, BrewState, BrewPick } from '../engine';
import type { ScryfallCard } from '@/types';

function sf(name: string): ScryfallCard {
  return { id: name, name, cmc: 2, type_line: 'Instant', color_identity: ['W'], prices: { usd: '1' } } as ScryfallCard;
}
function pickOf(name: string): BrewPick {
  return { name, card: sf(name), role: null, subtype: null, inclusion: 50, viaRouteId: 'r', reasons: [] };
}

function makeCtx(): BrewContext {
  return {
    commander: sf('Cmd'), partnerCommander: null, colorIdentity: ['W'],
    customization: { mustIncludeCards: ['Pre-Existing'], collectionMode: false } as unknown as BrewContext['customization'],
    candidates: [], roleTargets: { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 },
    typeTargets: {}, curveTargets: {}, landTarget: 36, nonLandTarget: 63, combos: [],
  };
}
function makeState(names: string[]): BrewState {
  return { picks: names.map(pickOf), usedNames: names, themeAffinity: {}, rerollsUsed: {}, phase: 'nonland', history: [] };
}

beforeEach(() => vi.clearAllMocks());

describe('finishBrew', () => {
  it('passes brewed picks (merged with existing) as must-includes to generateDeck', async () => {
    const deck = await finishBrew(makeCtx(), makeState(['Sol Ring', 'Swords to Plowshares']));
    expect(generateDeck).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(generateDeck).mock.calls[0][0];
    expect(arg.customization.mustIncludeCards).toContain('Sol Ring');
    expect(arg.customization.mustIncludeCards).toContain('Swords to Plowshares');
    expect(arg.customization.mustIncludeCards).toContain('Pre-Existing'); // merged, not replaced
    expect(arg.customization.tempMustIncludeCards).toEqual([]);
    expect(deck.stats.totalCards).toBe(99);
  });

  it('dedupes when a brewed pick equals an existing must-include', async () => {
    const ctx = makeCtx();
    (ctx.customization as { mustIncludeCards: string[] }).mustIncludeCards = ['Sol Ring'];
    await finishBrew(ctx, makeState(['Sol Ring', 'Cultivate']));
    const arg = vi.mocked(generateDeck).mock.calls[0][0];
    const solRingCount = arg.customization.mustIncludeCards.filter((n: string) => n === 'Sol Ring').length;
    expect(solRingCount).toBe(1);
  });
});
