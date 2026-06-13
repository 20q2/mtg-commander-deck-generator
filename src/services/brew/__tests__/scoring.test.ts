import { describe, it, expect } from 'vitest';
import { buildScoringContext, scoreCandidate } from '../scoring';
import { makeContext, makeState, makeCandidate } from './fixtures';

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
