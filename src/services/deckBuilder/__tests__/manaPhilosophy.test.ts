import { describe, it, expect } from 'vitest';
import { manaPhilosophyBoost } from '../deckGenerator';
import type { ScryfallCard } from '@/types';

function land(over: Partial<ScryfallCard>): ScryfallCard {
  return { id: 'x', name: 'x', cmc: 0, type_line: 'Land', color_identity: [], prices: {}, ...over } as ScryfallCard;
}

// Reliable + Budget are dependency-free (read produced_mana / prices) and carry the novel math; the
// most safety-critical claim is that a colorless/zero case contributes nothing. Greedy/Spell-lands
// delegate to the well-established isUtilityLand / isMdfcLand helpers, so they're not re-tested here.
describe('manaPhilosophyBoost', () => {
  it('reliable scales with the number of colors the land can produce', () => {
    const dual = land({ produced_mana: ['W', 'U'] });
    const tri = land({ produced_mana: ['W', 'U', 'B'] });
    expect(manaPhilosophyBoost(tri, 'Triome', 'reliable')).toBeGreaterThan(manaPhilosophyBoost(dual, 'Dual', 'reliable'));
  });

  it('reliable ignores colorless production (no fixing value)', () => {
    expect(manaPhilosophyBoost(land({ produced_mana: ['C'] }), 'Wastes', 'reliable')).toBe(0);
    expect(manaPhilosophyBoost(land({ produced_mana: [] }), 'Nothing', 'reliable')).toBe(0);
  });

  it('budget rewards cheaper lands (less penalty) over pricey ones', () => {
    const cheap = land({ prices: { usd: '0.50' } });
    const pricey = land({ prices: { usd: '25.00' } });
    expect(manaPhilosophyBoost(cheap, 'Cheap', 'budget')).toBeGreaterThan(manaPhilosophyBoost(pricey, 'Pricey', 'budget'));
  });
});
