import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/tagger/client', () => ({ hasTag: vi.fn(() => false), isTutor: vi.fn(() => false) }));

import { computeDeckStats } from '../stats';
import { hasTag, isTutor } from '@/services/tagger/client';
import { makeContext, makeState } from './fixtures';
import type { BrewPick } from '../brewTypes';
import type { ScryfallCard } from '@/types';

function pick(name: string, role: BrewPick['role'], cmc = 2, type_line = 'Creature — Test'): BrewPick {
  return {
    name, role, subtype: null, inclusion: 50, viaRouteId: 'r', reasons: [],
    card: { id: name, name, cmc, type_line, color_identity: [], prices: { usd: '1' } } as unknown as ScryfallCard,
  };
}

beforeEach(() => { vi.mocked(hasTag).mockReturnValue(false); vi.mocked(isTutor).mockReturnValue(false); });

describe('computeDeckStats', () => {
  it('counts role axes against role targets and caps fill at 1', () => {
    const ctx = makeContext({ roleTargets: { ramp: 4, removal: 8, boardwipe: 3, cardDraw: 10 } });
    const state = makeState({ picks: [pick('A', 'ramp'), pick('B', 'ramp'), pick('C', 'removal')] });
    const stats = computeDeckStats(ctx, state);
    const byKey = Object.fromEntries(stats.radar.map(a => [a.key, a]));
    expect(byKey.ramp.current).toBe(2);
    expect(byKey.ramp.target).toBe(4);
    expect(byKey.ramp.fill).toBe(0.5);
    expect(byKey.removal.current).toBe(1);
    expect(stats.radar.map(a => a.key)).toEqual(['ramp', 'removal', 'boardwipe', 'cardDraw', 'tutor', 'protection']);
  });

  it('counts tutors via isTutor and protection via hasTag', () => {
    vi.mocked(isTutor).mockImplementation(name => name === 'Demonic Tutor');
    vi.mocked(hasTag).mockImplementation((name, tag) => tag === 'protection' && name === 'Heroic Intervention');
    const ctx = makeContext();
    const state = makeState({ picks: [pick('Demonic Tutor', 'cardDraw'), pick('Heroic Intervention', null), pick('Bear', null)] });
    const byKey = Object.fromEntries(computeDeckStats(ctx, state).radar.map(a => [a.key, a]));
    expect(byKey.tutor.current).toBe(1);
    expect(byKey.protection.current).toBe(1);
  });

  it('buckets non-land picks into the curve, excluding lands', () => {
    const ctx = makeContext({ curveTargets: { 1: 8, 2: 14, 3: 14 } });
    const state = makeState({ picks: [
      pick('One', 'ramp', 1), pick('Two', 'ramp', 2), pick('TwoB', 'removal', 1.9),
      pick('Land', null, 0, 'Land'),
    ] });
    const curve = computeDeckStats(ctx, state).curve;
    expect(curve.map(c => c.cmc)).toEqual([1, 2, 3]);
    expect(curve.find(c => c.cmc === 1)!.current).toBe(1);
    expect(curve.find(c => c.cmc === 2)!.current).toBe(2); // 2 and 1.9→round 2; land excluded
    expect(curve.find(c => c.cmc === 2)!.target).toBe(14);
  });

  it('rounded is false when empty or lopsided, true when every axis is filled', () => {
    const ctx = makeContext({ roleTargets: { ramp: 1, removal: 1, boardwipe: 1, cardDraw: 1 } });
    expect(computeDeckStats(ctx, makeState()).rounded).toBe(false);
    vi.mocked(hasTag).mockReturnValue(true);  // protection check passes
    vi.mocked(isTutor).mockReturnValue(true); // tutor check passes
    const full = makeState({ picks: [
      pick('a', 'ramp'), pick('b', 'removal'), pick('c', 'boardwipe'), pick('d', 'cardDraw'),
      pick('e', null), pick('f', null), pick('g', null), pick('h', null),
    ] });
    expect(computeDeckStats(ctx, full).rounded).toBe(true);
  });

  it('returns an empty curve when there are no curve targets', () => {
    const ctx = makeContext({ curveTargets: {} });
    expect(computeDeckStats(ctx, makeState()).curve).toEqual([]);
  });
});
