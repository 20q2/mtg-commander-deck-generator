import { describe, it, expect } from 'vitest';
import { rarityAllowed, buildRarityQueryFragment } from '../rarityFilter';

describe('rarityAllowed', () => {
  it('allows everything when filter is null', () => {
    expect(rarityAllowed('common', null)).toBe(true);
    expect(rarityAllowed('mythic', null)).toBe(true);
  });
  it('allows everything when filter is empty', () => {
    expect(rarityAllowed('common', [])).toBe(true);
  });
  it('allows only listed rarities', () => {
    expect(rarityAllowed('rare', ['rare', 'mythic'])).toBe(true);
    expect(rarityAllowed('mythic', ['rare', 'mythic'])).toBe(true);
    expect(rarityAllowed('common', ['rare', 'mythic'])).toBe(false);
    expect(rarityAllowed('uncommon', ['rare', 'mythic'])).toBe(false);
  });
});

describe('buildRarityQueryFragment', () => {
  it('returns empty string for null or empty', () => {
    expect(buildRarityQueryFragment(null)).toBe('');
    expect(buildRarityQueryFragment([])).toBe('');
  });
  it('builds an OR group for multiple rarities', () => {
    expect(buildRarityQueryFragment(['rare', 'mythic'])).toBe(' (r:rare or r:mythic)');
  });
  it('handles a single rarity', () => {
    expect(buildRarityQueryFragment(['rare'])).toBe(' (r:rare)');
  });
});
