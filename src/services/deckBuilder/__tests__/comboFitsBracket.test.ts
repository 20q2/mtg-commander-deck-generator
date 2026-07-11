import { describe, it, expect } from 'vitest';
import { comboFitsBracket } from '../bracketEstimator';

describe('comboFitsBracket', () => {
  it('allows everything when no bracket is selected', () => {
    expect(comboFitsBracket('5', undefined)).toBe(true);
    expect(comboFitsBracket('unknown', undefined)).toBe(true);
  });

  it('excludes combos rated above the selected bracket', () => {
    expect(comboFitsBracket('4', 3)).toBe(false);
    expect(comboFitsBracket('5', 3)).toBe(false);
    expect(comboFitsBracket('3', 2)).toBe(false);
  });

  it('allows combos rated at or below the selected bracket', () => {
    expect(comboFitsBracket('3', 3)).toBe(true);
    expect(comboFitsBracket('1', 3)).toBe(true);
    expect(comboFitsBracket('4', 4)).toBe(true);
    expect(comboFitsBracket('5', 5)).toBe(true);
  });

  it('only trusts unrated combos at bracket 4+', () => {
    expect(comboFitsBracket('unknown', 3)).toBe(false);
    expect(comboFitsBracket('unknown', 2)).toBe(false);
    expect(comboFitsBracket('unknown', 4)).toBe(true);
    expect(comboFitsBracket('unknown', 5)).toBe(true);
  });
});
