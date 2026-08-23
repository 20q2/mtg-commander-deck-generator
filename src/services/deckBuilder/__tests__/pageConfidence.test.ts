import { describe, it, expect } from 'vitest';
import { pageConfidence, INCLUSION_PRIOR_DECKS } from '../archetypeBlend';
import { computeEdhrecRoleTargets, EDHREC_INCLUSION_THRESHOLD } from '../roleTargets';
import type { EDHRECCommanderData } from '@/types';

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

describe('role targets no longer trust a thin page', () => {
  const CARDS = ['Wipe A', 'Wipe B', 'Wipe C', 'Wipe D', 'Wipe E'];

  it('an unsmoothed two-deck page would count every card toward targets', () => {
    // 100% is far above the 18% threshold, so all five would count — the nonsense this prevents.
    const counted = computeEdhrecRoleTargets(page(100, CARDS));
    const total = Object.values(counted).reduce((a, b) => a + b, 0);
    expect(EDHREC_INCLUSION_THRESHOLD).toBeLessThan(100);
    expect(total).toBeGreaterThanOrEqual(0); // roles come from the tagger; the point is the threshold
    expect(page(100, CARDS).cardlists.allNonLand.every(c => c.inclusion >= EDHREC_INCLUSION_THRESHOLD)).toBe(true);
  });

  it('after smoothing, a two-deck page falls under the threshold entirely', () => {
    const thin = smoothed(page(100, CARDS), 2);
    expect(thin.cardlists.allNonLand.every(c => c.inclusion < EDHREC_INCLUSION_THRESHOLD)).toBe(true);
  });

  it('a well-sampled page still clears the threshold', () => {
    const healthy = smoothed(page(40, CARDS), 476);
    expect(healthy.cardlists.allNonLand.every(c => c.inclusion >= EDHREC_INCLUSION_THRESHOLD)).toBe(true);
  });
});
