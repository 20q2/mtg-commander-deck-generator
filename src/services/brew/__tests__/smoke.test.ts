import { describe, it, expect } from 'vitest';
import { ROLE_LABELS } from '@/services/deckBuilder/roleTargets';

describe('vitest infrastructure', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});

describe('path alias', () => {
  it('resolves @/ imports in tests', () => {
    expect(ROLE_LABELS.ramp).toBe('Ramp');
  });
});
