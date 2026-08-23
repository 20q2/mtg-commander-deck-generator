import { describe, it, expect } from 'vitest';
import { STAPLE_BACKFILL_INCLUSION } from '../roleTargets';

/**
 * Pins the staple-backfill contract with the real Sapling of Colfenor numbers.
 *
 * Being off-theme is not a reason to hide a good card. The bar was 50%, which admitted only true
 * auto-includes and dropped the whole mid-tier Golgari removal suite from a self-damage deck's
 * suggestions — including from the per-role lists, where a Removal list without Assassin's Trophy
 * is plainly wrong.
 *
 * The merge itself lives in a useCallback inside DeckOptimizer, so this covers the decision the
 * merge makes rather than the component. Percentages are the live values on that 476-deck page,
 * read on 2026-08-22.
 */
const SAPLING_BASE_INCLUSION: Record<string, number> = {
  'Command Tower': 75,
  'Sol Ring': 63,
  'Cultivate': 53,
  'Assault Formation': 49,
  'Bojuka Bog': 47,
  "Assassin's Trophy": 34,
  'Beast Within': 39,
  'Putrefy': 32,
  'Abrupt Decay': 7,
};

/** The call site: inclusion clears the bar, OR the card fills a role the deck is short on. */
const backfills = (name: string, fillsDeficit = false) =>
  SAPLING_BASE_INCLUSION[name] >= STAPLE_BACKFILL_INCLUSION || fillsDeficit;

describe('staple backfill into a themed recommendation list', () => {
  it('admits the Golgari removal a deck in these colors obviously wants', () => {
    for (const name of ["Assassin's Trophy", 'Beast Within', 'Putrefy']) {
      expect(backfills(name), name).toBe(true);
    }
  });

  it('still admits the true auto-includes', () => {
    for (const name of ['Command Tower', 'Sol Ring', 'Cultivate', 'Bojuka Bog']) {
      expect(backfills(name), name).toBe(true);
    }
  });

  it('excludes cards that are genuinely fringe for this commander', () => {
    expect(backfills('Abrupt Decay')).toBe(false);
  });

  it('lets a role-filling card through no matter how low its inclusion', () => {
    // "You are low on removal" and "here is the removal this commander plays" belong together,
    // whatever the theme is — so the deficit branch does not consult the bar.
    expect(backfills('Abrupt Decay', true)).toBe(true);
  });

  it('would have dropped the removal suite at the old 50% bar', () => {
    for (const name of ["Assassin's Trophy", 'Beast Within', 'Putrefy']) {
      expect(SAPLING_BASE_INCLUSION[name], name).toBeLessThan(50);
    }
  });
});
