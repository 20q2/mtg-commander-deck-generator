import { describe, it, expect } from 'vitest';
import { rankUpgradeCandidates, themeCredit, type UpgradeCandidate } from '../deckUpgrades';

/**
 * The "New Cards" tab's theme signal. A card printed last month has thin EDHREC data by
 * definition, so its absence from a theme page usually means "no data yet" rather than "off
 * theme" — which is exactly why the classifier's read of the card ITSELF is worth as much here as
 * page membership, and why the two are combined with max() rather than summed.
 */
const c = (name: string, extra: Partial<UpgradeCandidate> = {}): UpgradeCandidate =>
  ({ name, inclusion: 10, ...extra });

describe('themeCredit', () => {
  it('rates classifier literal evidence equal to EDHREC page membership', () => {
    expect(themeCredit(c('x', { themeBasis: 'literal' })))
      .toBe(themeCredit(c('y', { fromTheme: true })));
  });

  it('discounts tag-basis evidence', () => {
    expect(themeCredit(c('x', { themeBasis: 'tag' })))
      .toBeLessThan(themeCredit(c('y', { themeBasis: 'literal' })));
    expect(themeCredit(c('x', { themeBasis: 'tag' }))).toBeGreaterThan(0);
  });

  it('does not double-dip when both sources agree', () => {
    expect(themeCredit(c('x', { fromTheme: true, themeBasis: 'literal' })))
      .toBe(themeCredit(c('y', { fromTheme: true })));
  });

  it('is zero with no theme evidence at all', () => {
    expect(themeCredit(c('x'))).toBe(0);
  });
});

describe('rankUpgradeCandidates with classifier evidence', () => {
  it('lifts a card the classifier matched above an equal one it did not', () => {
    const ranked = rankUpgradeCandidates([
      { candidate: c('Off Theme'), liftFit: 0 },
      { candidate: c('On Theme', { themeBasis: 'literal' }), liftFit: 0 },
    ]);
    expect(ranked[0].name).toBe('On Theme');
  });

  it('does not let theme evidence overtake strong deck-specific lift', () => {
    const ranked = rankUpgradeCandidates([
      { candidate: c('Proven Fit'), liftFit: 100 },
      { candidate: c('On Theme', { themeBasis: 'literal' }), liftFit: 0 },
    ]);
    expect(ranked[0].name).toBe('Proven Fit');
  });

  it('orders literal above tag above nothing, all else equal', () => {
    const ranked = rankUpgradeCandidates([
      { candidate: c('None'), liftFit: 0 },
      { candidate: c('Tag', { themeBasis: 'tag' }), liftFit: 0 },
      { candidate: c('Literal', { themeBasis: 'literal' }), liftFit: 0 },
    ]);
    expect(ranked.map(r => r.name)).toEqual(['Literal', 'Tag', 'None']);
  });
});
