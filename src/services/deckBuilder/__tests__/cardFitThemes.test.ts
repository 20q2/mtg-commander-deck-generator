import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/types';
import { computeMisfits } from '../cardFit';
import type { ThemeMembership } from '@/components/analyze/themeMembership';

function card(name: string, over: Partial<ScryfallCard> = {}): ScryfallCard {
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
    ...over,
  } as ScryfallCard;
}

/**
 * Landfall selected. Scute Swarm proved membership from its own keyword; Off Plan matched nothing.
 * Tagger data is unavailable under test, so getCardRole returns null and every card also picks up
 * 'No tagged role' — which is what makes this sharp: the literal member must survive three
 * independent strikes, and the off-theme card with the same strikes must not.
 */
const membership: ThemeMembership = {
  themes: [{ slug: 'landfall', name: 'Landfall' }],
  byCard: new Map([['scute swarm', [0]]]),
  basisByCard: new Map([['scute swarm', 'literal']]),
};

// Both cards look equally bad to EDHREC: absent from the commander's page, coerced to 0.
const inclusion = { 'Scute Swarm': 0, 'Off Plan': 0 };
const synergy = { 'Scute Swarm': 0, 'Off Plan': 0 };

describe('computeMisfits with classifier theme evidence', () => {
  it('does not flag a literal theme member, however thin its EDHREC data', () => {
    const misfits = computeMisfits({
      cards: [card('Scute Swarm', { keywords: ['Landfall'] })],
      cardInclusionMap: inclusion,
      cardSynergyMap: synergy,
      themeMembership: membership,
    });
    expect(misfits.map(m => m.card.name)).toEqual([]);
  });

  it('still flags an off-theme card with the same EDHREC profile', () => {
    const misfits = computeMisfits({
      cards: [card('Off Plan')],
      cardInclusionMap: inclusion,
      cardSynergyMap: synergy,
      themeMembership: membership,
    });
    expect(misfits.map(m => m.card.name)).toEqual(['Off Plan']);
  });

  it('a tag-basis member is NOT protected — inferred evidence is not proof', () => {
    const tagMembership: ThemeMembership = {
      themes: [{ slug: 'aristocrats', name: 'Aristocrats' }],
      byCard: new Map([['off plan', [0]]]),
      basisByCard: new Map([['off plan', 'tag']]),
    };
    const misfits = computeMisfits({
      cards: [card('Off Plan')],
      cardInclusionMap: inclusion,
      cardSynergyMap: synergy,
      themeMembership: tagMembership,
    });
    expect(misfits.map(m => m.card.name)).toEqual(['Off Plan']);
  });

  it('an EDHREC-page member is NOT protected — page presence is not proof either', () => {
    const edhrecMembership: ThemeMembership = {
      themes: [{ slug: 'landfall', name: 'Landfall' }],
      byCard: new Map([['off plan', [0]]]),
      basisByCard: new Map([['off plan', 'edhrec']]),
    };
    const misfits = computeMisfits({
      cards: [card('Off Plan')],
      cardInclusionMap: inclusion,
      cardSynergyMap: synergy,
      themeMembership: edhrecMembership,
    });
    expect(misfits.map(m => m.card.name)).toEqual(['Off Plan']);
  });

  it('behaves as before when there is no theme membership at all', () => {
    const misfits = computeMisfits({
      cards: [card('Scute Swarm', { keywords: ['Landfall'] }), card('Off Plan')],
      cardInclusionMap: inclusion,
      cardSynergyMap: synergy,
      themeMembership: null,
    });
    // No themes selected → no theme evidence → both are judged on EDHREC data alone.
    expect(misfits.map(m => m.card.name).sort()).toEqual(['Off Plan', 'Scute Swarm']);
  });
});
