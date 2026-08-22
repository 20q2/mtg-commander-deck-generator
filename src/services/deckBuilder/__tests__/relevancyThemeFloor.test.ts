import { describe, it, expect } from 'vitest';
import type { GeneratedDeck, ScryfallCard } from '@/types';
import { rebuildRelevancyMap } from '../relevancyMap';

function card(name: string): ScryfallCard {
  return {
    id: name,
    oracle_id: `oid-${name}`,
    name,
    cmc: 3,
    type_line: 'Creature — Human',
    keywords: [],
    color_identity: ['G'],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
  } as ScryfallCard;
}

/** Neither card has EDHREC data — the exact condition that produced the bug. */
function deck(): GeneratedDeck {
  return {
    categories: { creatures: [card('On Theme'), card('Off Theme')] },
    cardInclusionMap: {},
    cardSynergyMap: {},
    roleCounts: {},
    roleTargets: {},
  } as unknown as GeneratedDeck;
}

describe('rebuildRelevancyMap theme floor', () => {
  it('zeroes EDHREC-absent cards when no theme evidence is supplied', () => {
    const rel = rebuildRelevancyMap(deck());
    expect(rel['On Theme']).toBe(0);
    expect(rel['Off Theme']).toBe(0);
  });

  it('scores an EDHREC-absent literal theme member above an off-theme one', () => {
    const rel = rebuildRelevancyMap(deck(), new Set(['on theme']));
    expect(rel['On Theme']).toBeGreaterThan(rel['Off Theme']);
    expect(rel['Off Theme']).toBe(0);
  });

  it('does not disturb a card that has real EDHREC inclusion', () => {
    const d = deck();
    d.cardInclusionMap = { 'Off Theme': 40 };
    const withFit = rebuildRelevancyMap(d, new Set(['on theme']));
    const without = rebuildRelevancyMap(d);
    expect(withFit['Off Theme']).toBe(without['Off Theme']);
  });

  it('matches theme members case-insensitively', () => {
    const rel = rebuildRelevancyMap(deck(), new Set(['ON THEME'.toLowerCase()]));
    expect(rel['On Theme']).toBeGreaterThan(0);
  });
});
