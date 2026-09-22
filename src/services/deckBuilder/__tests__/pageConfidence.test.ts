import { describe, it, expect, vi } from 'vitest';
import { pageConfidence, INCLUSION_PRIOR_DECKS } from '../archetypeBlend';
import { computeEdhrecRoleTargets } from '../roleTargets';
import type { EDHRECCommanderData } from '@/types';

// Role classification is the tagger's job and needs its S3 payload; stub it so these tests can
// exercise the arithmetic computeEdhrecRoleTargets does on top of it.
vi.mock('@/services/tagger/client', () => ({
  getCardRole: (name: string) => (name.startsWith('Wipe') ? 'boardwipe' : null),
}));

/** A theme page where every card reads the same inclusion — what a tiny denominator produces. */
function page(inclusion: number, names: string[]): EDHRECCommanderData {
  return {
    cardlists: {
      allNonLand: names.map(name => ({ name, inclusion, synergy: 0.2, primary_type: 'Instant' })),
      lands: [],
    },
  } as unknown as EDHRECCommanderData;
}

function smoothed(data: EDHRECCommanderData, pageDecks: number): EDHRECCommanderData {
  const f = pageConfidence(pageDecks);
  return {
    ...data,
    cardlists: {
      allNonLand: data.cardlists.allNonLand.map(c => ({ ...c, inclusion: c.inclusion * f })),
      lands: [],
    },
  } as unknown as EDHRECCommanderData;
}

describe('pageConfidence', () => {
  it('crushes a two-deck page and barely touches a well-sampled one', () => {
    expect(pageConfidence(2)).toBeCloseTo(2 / 14, 4);      // 0.14
    expect(pageConfidence(33)).toBeCloseTo(33 / 45, 4);    // 0.73
    expect(pageConfidence(476)).toBeGreaterThan(0.97);
    expect(pageConfidence(5230)).toBeGreaterThan(0.99);
  });

  it('is monotonic and never exceeds 1', () => {
    let prev = -1;
    for (const n of [0, 1, 2, 5, 12, 33, 100, 476, 5000]) {
      const c = pageConfidence(n);
      expect(c).toBeGreaterThanOrEqual(prev);
      expect(c).toBeLessThanOrEqual(1);
      prev = c;
    }
    expect(pageConfidence(0)).toBe(0);
  });

  it('treats a page of exactly the prior size as half-authoritative', () => {
    expect(pageConfidence(INCLUSION_PRIOR_DECKS)).toBeCloseTo(0.5, 6);
  });

  it('scales every card equally, so ranking within the page is unchanged', () => {
    const f = pageConfidence(2);
    const raw = [80, 40, 20];
    const out = raw.map(v => v * f);
    expect(out[0] / out[1]).toBeCloseTo(raw[0] / raw[1], 6);
    expect(out[1] / out[2]).toBeCloseTo(raw[1] / raw[2], 6);
  });
});

describe('role targets weigh each card by its inclusion, not by existing', () => {
  const CARDS = ['Wipe A', 'Wipe B', 'Wipe C', 'Wipe D', 'Wipe E'];

  it('a card counts for its inclusion rate, not a whole slot', () => {
    // Five wipes each played in 40% of decks is TWO wipes in the average deck, not five. Counting
    // cards above a threshold instead is what put 21 ramp in a 100-card Golgari deck.
    expect(computeEdhrecRoleTargets(page(40, CARDS)).boardwipe).toBeCloseTo(2, 6);
  });

  it('a thin page, once smoothed, contributes proportionally less', () => {
    // Two decks where every card reads 100%: smoothing leaves the five of them worth under a
    // single slot between them, instead of claiming all five.
    const thin = computeEdhrecRoleTargets(smoothed(page(100, CARDS), 2)).boardwipe;
    expect(thin).toBeCloseTo(5 * pageConfidence(2), 6);
    expect(thin).toBeLessThan(1);
  });

  it('a well-sampled page keeps nearly its full weight', () => {
    const healthy = computeEdhrecRoleTargets(smoothed(page(40, CARDS), 476)).boardwipe;
    expect(healthy).toBeGreaterThan(1.9);
    expect(healthy).toBeLessThanOrEqual(2);
  });
});
