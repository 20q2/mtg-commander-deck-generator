import { describe, it, expect } from 'vitest';
import { buildScoringContext, scoreCandidate, affinityWeight, isUrgentFill } from '../scoring';
import { makeContext, makeState, makeCandidate } from './fixtures';
import type { BrewRelic } from '../brewTypes';

describe('buildScoringContext', () => {
  it('derives role/curve/type deficits from current state', () => {
    const ctx = makeContext({ roleTargets: { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 } });
    const state = makeState();
    const sc = buildScoringContext(ctx, state);
    const removal = sc.roleDeficits.find(d => d.role === 'removal');
    expect(removal?.deficit).toBe(8);   // nothing picked yet
    expect(Array.isArray(sc.typeAnalysis)).toBe(true);
    expect(Array.isArray(sc.curveAnalysis)).toBe(true);
  });
});

describe('scoreCandidate', () => {
  it('scores a deficit-role candidate higher than an off-role one', () => {
    const ctx = makeContext();
    const state = makeState();
    const removalCard = makeCandidate('Swords to Plowshares', { role: 'removal', inclusion: 70, primary_type: 'Instant', type_line: 'Instant' });
    const vanillaCard = makeCandidate('Random Bear', { role: null, inclusion: 70, primary_type: 'Creature' });
    const sRemoval = scoreCandidate(ctx, state, removalCard);
    const sVanilla = scoreCandidate(ctx, state, vanillaCard);
    expect(sRemoval).toBeGreaterThan(sVanilla);
  });

  it('applies theme-affinity weight to matching candidates', () => {
    const ctx = makeContext();
    const base = scoreCandidate(ctx, makeState(), makeCandidate('Token Maker', { role: null, inclusion: 40 }));
    const boosted = scoreCandidate(
      ctx,
      makeState({ themeAffinity: { tokens: 30 } }),
      { ...makeCandidate('Token Maker', { role: null, inclusion: 40 }),
        edhrec: { ...makeCandidate('Token Maker', { inclusion: 40 }).edhrec } },
      ['tokens'],
    );
    expect(boosted).toBeGreaterThan(base);
  });
});

describe('discovery bonus', () => {
  it('ranks a lift discovery above an equal-inclusion vanilla card', () => {
    const ctx = makeContext({ candidates: [] });
    const state = makeState();
    const vanilla = makeCandidate('Vanilla', { role: 'removal', inclusion: 30 });
    const found = makeCandidate('Lift Find', { role: 'removal', inclusion: 30, discoveredVia: 'Korvold', coSynergy: 30, discoverySource: 'lift' });
    expect(scoreCandidate(ctx, state, found)).toBeGreaterThan(scoreCandidate(ctx, state, vanilla));
  });
});

describe('affinityWeight ramp', () => {
  const stubPick = (() => {
    const c = makeCandidate('x');
    return { name: 'x', card: c.scryfall, role: null, subtype: null, inclusion: 0, viaRouteId: '', reasons: [] };
  })();

  it('ramps from early (low) to late (high) as the deck fills', () => {
    const ctx = makeContext({ nonLandTarget: 60 });
    const early = affinityWeight(ctx, makeState({ picks: [] }));
    const late = affinityWeight(ctx, makeState({ picks: Array(60).fill(stubPick) }));
    expect(late).toBeGreaterThan(early);
  });
});

describe('committed-theme soft-remove', () => {
  it('scores an off-theme card below an on-theme card once a theme is committed', () => {
    const ctx = makeContext({ themeNames: { tokens: 'Tokens', artifacts: 'Artifacts' }, typeTargets: {} });
    const state = makeState({ committedTheme: 'tokens' });
    const onTheme = makeCandidate('Token Card', { role: null, inclusion: 50, themeTags: ['tokens'] });
    const offTheme = makeCandidate('Off Card', { role: null, inclusion: 50, themeTags: ['artifacts'] });
    expect(scoreCandidate(ctx, state, offTheme)).toBeLessThan(scoreCandidate(ctx, state, onTheme, ['tokens']));
  });

  it('still surfaces a critically-short off-theme staple (deficit-urgency override)', () => {
    const ctx = makeContext({ roleTargets: { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 }, typeTargets: {} });
    const state = makeState({ committedTheme: 'tokens' });   // nothing picked → removal deficit 8/8 = 1.0 ≥ 0.75
    const staple = makeCandidate('Swords', { role: 'removal', inclusion: 50, themeTags: ['artifacts'], type_line: 'Instant', primary_type: 'Instant' });
    const vanilla = makeCandidate('Bear', { role: null, inclusion: 50, themeTags: ['artifacts'] });
    expect(isUrgentFill(ctx, state, staple)).toBe(true);
    expect(scoreCandidate(ctx, state, staple)).toBeGreaterThan(scoreCandidate(ctx, state, vanilla));
  });
});

describe('pinned cards', () => {
  const ctx = makeContext({ typeTargets: {} });

  it('boosts a pinned card so it resurfaces', () => {
    const card = makeCandidate('Pinned Card', { role: null, inclusion: 40 });
    const base = scoreCandidate(ctx, makeState(), card);
    const boosted = scoreCandidate(ctx, makeState({ pinnedNames: ['Pinned Card'] }), card);
    expect(boosted).toBeGreaterThan(base);
  });

  it('exempts a pinned off-theme card from the commit soft-remove', () => {
    const off = makeCandidate('Off But Pinned', { role: null, inclusion: 50, themeTags: ['artifacts'] });
    const committed = scoreCandidate(ctx, makeState({ committedTheme: 'tokens' }), off);
    const pinned = scoreCandidate(ctx, makeState({ committedTheme: 'tokens', pinnedNames: ['Off But Pinned'] }), off);
    expect(pinned).toBeGreaterThan(committed);
  });
});

describe('efficiency philosophy (the Efficient Brew)', () => {
  const ctx = makeContext({ typeTargets: {} });
  const efficient = [{ id: 'philosophy:efficient', name: 'The Efficient Brew', description: '', effect: { type: 'efficiency', mult: 2 } }] as BrewRelic[];

  it('lifts a proven high-inclusion staple', () => {
    const staple = makeCandidate('Staple', { role: null, inclusion: 90 });
    const base = scoreCandidate(ctx, makeState(), staple);
    const boosted = scoreCandidate(ctx, makeState({ relics: efficient }), staple);
    expect(boosted).toBeGreaterThan(base);
  });

  it('dampens a speculative low-inclusion discovery card', () => {
    const disc = makeCandidate('Spice', { role: null, inclusion: 20, discoveredVia: 'Korvold', coSynergy: 40, discoverySource: 'lift' });
    const base = scoreCandidate(ctx, makeState(), disc);
    const damped = scoreCandidate(ctx, makeState({ relics: efficient }), disc);
    expect(damped).toBeLessThan(base);
  });
});
