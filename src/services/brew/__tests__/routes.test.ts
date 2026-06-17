import { describe, it, expect } from 'vitest';
import { nextRoutes, computeDeficits } from '../routes';
import { makeContext, makeState, makeCandidate } from './fixtures';
import type { BrewPick } from '../brewTypes';
import type { EDHRECCombo } from '@/types';

function pick(c: ReturnType<typeof makeCandidate>): BrewPick {
  return { name: c.name, card: c.scryfall, role: c.role, subtype: c.subtype,
    inclusion: c.inclusion, viaRouteId: 'r', reasons: [] };
}

describe('nextRoutes', () => {
  it('offers 1-3 routes — always the pack, plus combo/elite when available', () => {
    // A plain early fork (no near-miss combo, not an elite fork) offers just the pack route;
    // the meaningful choice now lives inside the 3-bundle pack node. Combo/elite add a real fork.
    const ctx = makeContext({ candidates: [
      makeCandidate('Swords to Plowshares', { role: 'removal', primary_type: 'Instant', type_line: 'Instant' }),
      makeCandidate('Sol Ring', { role: 'ramp', primary_type: 'Artifact', type_line: 'Artifact' }),
    ]});
    const routes = nextRoutes(ctx, makeState());
    expect(routes.length).toBeGreaterThanOrEqual(1);
    expect(routes.length).toBeLessThanOrEqual(3);
    expect(routes.some(r => r.id === 'bundle:pack')).toBe(true);
  });

  it('surfaces the largest role deficit with a "need" tone', () => {
    // removal target 8, current 0 (biggest reachable deficit); ramp already full
    const ramp = Array.from({ length: 10 }, (_, i) => pick(makeCandidate(`Ramp${i}`, { role: 'ramp' })));
    const ctx = makeContext({ candidates: [
      makeCandidate('Swords to Plowshares', { role: 'removal', primary_type: 'Instant', type_line: 'Instant' }),
      makeCandidate('Generous Gift', { role: 'removal', primary_type: 'Instant', type_line: 'Instant' }),
      makeCandidate('Beast Within', { role: 'removal', primary_type: 'Instant', type_line: 'Instant' }),
    ]});
    const routes = nextRoutes(ctx, makeState({ picks: ramp }));
    const removalRoute = routes.find(r => r.targetRole === 'removal');
    expect(removalRoute).toBeDefined();
    expect(removalRoute?.tone).toBe('need');
  });

  it('biases toward multi-slot nodes as the deck fills', () => {
    // 40 of 63 nonland slots filled (past the 50% multi-slot threshold, below the 95% completion cutoff)
    const many = Array.from({ length: 40 }, (_, i) => pick(makeCandidate(`C${i}`, { role: null })));
    const removalPool = Array.from({ length: 8 }, (_, i) =>
      makeCandidate(`Removal${i}`, { role: 'removal', subtype: 'spot-removal', primary_type: 'Instant', type_line: 'Instant', inclusion: 60 - i }));
    const ctx = makeContext({ nonLandTarget: 63, candidates: removalPool });
    const routes = nextRoutes(ctx, makeState({ picks: many }));
    expect(routes.some(r => r.type === 'bundle')).toBe(true);
    expect(routes.some(r => r.type === 'lightning')).toBe(false); // lightning is gone
  });

  it('returns a single manabase route once nonland phase completes', () => {
    const ctx = makeContext({ nonLandTarget: 4 });
    const picks = Array.from({ length: 4 }, (_, i) => pick(makeCandidate(`C${i}`, { role: null })));
    const routes = nextRoutes(ctx, makeState({ picks }));
    expect(routes).toHaveLength(1);
    expect(routes[0].type).toBe('manabase');
  });
});

describe('computeDeficits — magnitude', () => {
  it('carries current count and target alongside the deficit', () => {
    // removal target 8, two removal picks → current 2, target 8, deficit 6
    const removalPicks = [
      pick(makeCandidate('R1', { role: 'removal', type_line: 'Instant', primary_type: 'Instant' })),
      pick(makeCandidate('R2', { role: 'removal', type_line: 'Instant', primary_type: 'Instant' })),
    ];
    const ctx = makeContext({
      roleTargets: { ramp: 0, removal: 8, boardwipe: 0, cardDraw: 0 },
      candidates: [makeCandidate('R3', { role: 'removal', type_line: 'Instant', primary_type: 'Instant' })],
    });
    const deficits = computeDeficits(ctx, makeState({ picks: removalPicks, usedNames: ['R1', 'R2'] }));
    const removal = deficits.find(d => d.key === 'removal')!;
    expect(removal.current).toBe(2);
    expect(removal.target).toBe(8);
    expect(removal.deficit).toBe(6);
  });
});

describe('nextRoutes — exhaustion fallback', () => {
  it('offers the manabase/finish route when no usable route remains and deck is not yet complete', () => {
    // Only one candidate, already used → no deficits fillable, far from nonland target.
    const ctx = makeContext({ nonLandTarget: 40, candidates: [
      makeCandidate('Lone Card', { role: 'removal', primary_type: 'Instant', type_line: 'Instant' }),
    ]});
    const routes = nextRoutes(ctx, makeState({ usedNames: ['Lone Card'] }));
    expect(routes.length).toBeGreaterThanOrEqual(1);
    expect(routes.some(r => r.type === 'manabase')).toBe(true);
  });
});

describe('nextRoutes — deficit magnitude on the pack route', () => {
  it('tags the pack route with the leading gap as current/target', () => {
    const ctx = makeContext({
      roleTargets: { ramp: 0, removal: 8, boardwipe: 0, cardDraw: 0 },
      candidates: [
        makeCandidate('Swords to Plowshares', { role: 'removal', type_line: 'Instant', primary_type: 'Instant' }),
        makeCandidate('Beast Within', { role: 'removal', type_line: 'Instant', primary_type: 'Instant' }),
      ],
    });
    const routes = nextRoutes(ctx, makeState());
    const pack = routes.find(r => r.id === 'bundle:pack')!;
    expect(pack.tag).toBe('Removal 0/8');
  });
});

describe('nextRoutes — combo route', () => {
  it('surfaces a combo route when a near-miss combo is completable', () => {
    const combo: EDHRECCombo = { comboId: 'c1', cards: [
      { name: 'Test Commander', id: '1' }, { name: 'Cathars Crusade', id: '2' },
    ], results: ['Infinite tokens'], deckCount: 999, rank: 1, bracket: '3', prereqCount: 0 };
    const ctx = makeContext({
      candidates: [makeCandidate('Cathars Crusade', { primary_type: 'Enchantment', type_line: 'Enchantment' })],
      combos: [combo],
    });
    // makeContext's commander is named 'Test Commander' (a combo piece), so this is a near-miss.
    const routes = nextRoutes(ctx, makeState());
    const comboRoute = routes.find(r => r.type === 'combo');
    expect(comboRoute).toBeDefined();
    expect(comboRoute?.id).toBe('combo');
    expect(comboRoute?.title).toBe('Complete a Combo'); // exactly one near-miss
    expect(comboRoute?.tone).toBe('theme');
    // Copy no longer embeds card names or result strings — those live in the node now.
    expect(comboRoute?.description).not.toContain('Cathars Crusade');
    expect(comboRoute?.description).not.toContain('Infinite tokens');
  });
});

describe('nextRoutes — elite draft cadence', () => {
  const bombPool = Array.from({ length: 6 }, (_, i) =>
    makeCandidate(`Bomb${i}`, { role: 'removal', type_line: 'Instant', primary_type: 'Instant', inclusion: 90 - i }));
  const histOf = (n: number) => Array.from({ length: n }, (_, i) => ({
    pickNumber: i + 1, routeId: 'bundle:pack', routeType: 'bundle' as const, added: [`C${i}`], passed: [],
  }));

  it('offers an elite draft route on an elite fork (history length 7)', () => {
    const ctx = makeContext({ nonLandTarget: 63, candidates: bombPool });
    const picks = Array.from({ length: 7 }, (_, i) => pick(makeCandidate(`C${i}`, { role: null })));
    const routes = nextRoutes(ctx, makeState({ picks, history: histOf(7) }));
    expect(routes.some(r => r.type === 'draft')).toBe(true);
  });

  it('does NOT offer an elite draft on a non-elite fork (history length 3)', () => {
    const ctx = makeContext({ nonLandTarget: 63, candidates: bombPool });
    const picks = Array.from({ length: 3 }, (_, i) => pick(makeCandidate(`C${i}`, { role: null })));
    const routes = nextRoutes(ctx, makeState({ picks, history: histOf(3) }));
    expect(routes.some(r => r.type === 'draft')).toBe(false);
  });
});

describe('identity-flavored route copy', () => {
  it('appends the leaning theme to the primary need route description', () => {
    // A candidate pool with a removal deficit available to draft.
    const pool = [
      makeCandidate('Removal A', { role: 'removal', inclusion: 60, type_line: 'Instant', themeTags: ['tokens'] }),
      makeCandidate('Removal B', { role: 'removal', inclusion: 55, type_line: 'Instant' }),
    ];
    const ctx = makeContext({ candidates: pool, themeNames: { tokens: 'Tokens' },
      roleTargets: { ramp: 0, removal: 8, boardwipe: 0, cardDraw: 0 } });
    const state = makeState({ themeAffinity: { tokens: 30 } });

    const routes = nextRoutes(ctx, state);
    const need = routes.find(r => r.targetRole === 'removal')!;
    expect(need.description).toContain('Leaning into Tokens');
  });
});
