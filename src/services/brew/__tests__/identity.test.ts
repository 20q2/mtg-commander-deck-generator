import { describe, it, expect } from 'vitest';
import { leaningThemes } from '../identity';
import { makeContext, makeState } from './fixtures';

describe('leaningThemes', () => {
  const ctx = makeContext({ themeNames: { tokens: 'Tokens', sacrifice: 'Sacrifice' } });

  it('returns nothing before the threshold is crossed', () => {
    expect(leaningThemes(ctx, makeState({ themeAffinity: { tokens: 10 } }))).toEqual([]);
  });

  it('returns themes past the threshold, strongest first, capped at two', () => {
    const state = makeState({ themeAffinity: { tokens: 30, sacrifice: 50, lifegain: 40 } });
    // lifegain has weight but no display name (not a selected theme) -> excluded.
    expect(leaningThemes(ctx, state)).toEqual(['Sacrifice', 'Tokens']);
  });

  it('ignores non-theme affinity tags (e.g. subtypes)', () => {
    const state = makeState({ themeAffinity: { 'spot-removal': 100 } });
    expect(leaningThemes(ctx, state)).toEqual([]);
  });
});
