import { describe, it, expect } from 'vitest';
import { leaningThemes, topIdentity, generateRunTitle, IDENTITY_COMMIT_THRESHOLD } from '../identity';
import { makeContext, makeState } from './fixtures';

describe('topIdentity', () => {
  it('returns themes ranked by affinity, strongest first, with display labels', () => {
    const ctx = makeContext({ themeNames: { tokens: 'Tokens', sacrifice: 'Sacrifice', artifacts: 'Artifacts' } });
    const state = makeState({ themeAffinity: { tokens: 30, sacrifice: 50, artifacts: 10, 'spot-removal': 99 } });
    const bars = topIdentity(ctx, state, 4);
    // 'spot-removal' has no themeNames entry → excluded (it's a subtype tag, not a theme).
    expect(bars.map(b => b.label)).toEqual(['Sacrifice', 'Tokens', 'Artifacts']);
    expect(bars[0]).toMatchObject({ slug: 'sacrifice', value: 50 });
  });

  it('marks a theme committed at/above the commit threshold OR when committedTheme is set', () => {
    const ctx = makeContext({ themeNames: { tokens: 'Tokens', sacrifice: 'Sacrifice' } });
    const byThreshold = topIdentity(ctx, makeState({ themeAffinity: { tokens: IDENTITY_COMMIT_THRESHOLD } }), 4);
    expect(byThreshold.find(b => b.slug === 'tokens')?.committed).toBe(true);
    const byCommit = topIdentity(ctx, makeState({ themeAffinity: { sacrifice: 10 }, committedTheme: 'sacrifice' }), 4);
    expect(byCommit.find(b => b.slug === 'sacrifice')?.committed).toBe(true);
  });

  it('caps the number of bars to n', () => {
    const ctx = makeContext({ themeNames: { a: 'A', b: 'B', c: 'C', d: 'D', e: 'E' } });
    const state = makeState({ themeAffinity: { a: 5, b: 4, c: 3, d: 2, e: 1 } });
    expect(topIdentity(ctx, state, 3)).toHaveLength(3);
  });
});

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

describe('generateRunTitle', () => {
  it('builds "The <theme> Engine" when a combo was chased', () => {
    const ctx = makeContext({ themeNames: { treasure: 'Treasure' } });
    const state = makeState({ themeAffinity: { treasure: 30 }, moments: [{ atPick: 5, kind: 'comboFragment', label: 'Chasing X' }] });
    expect(generateRunTitle(ctx, state)).toBe('The Treasure Engine');
  });

  it('falls back to the commander when no theme is leaning', () => {
    const ctx = makeContext({ themeNames: {} });
    expect(generateRunTitle(ctx, makeState())).toBe(`${ctx.commander.name}'s Brew`);
  });
});
