import { describe, it, expect } from 'vitest';
import { openNode, deriveReasons } from '../nodes';
import { makeContext, makeState, makeCandidate } from './fixtures';
import type { BrewRoute } from '../brewTypes';

const removalPool = [
  makeCandidate('Swords to Plowshares', { role: 'removal', inclusion: 88, primary_type: 'Instant', type_line: 'Instant' }),
  makeCandidate('Generous Gift', { role: 'removal', inclusion: 79, primary_type: 'Instant', type_line: 'Instant' }),
  makeCandidate('Beast Within', { role: 'removal', inclusion: 82, primary_type: 'Instant', type_line: 'Instant' }),
  makeCandidate('Mortify', { role: 'removal', inclusion: 60, primary_type: 'Instant', type_line: 'Instant' }),
  makeCandidate('Putrefy', { role: 'removal', inclusion: 55, primary_type: 'Instant', type_line: 'Instant' }),
];

describe('openNode', () => {
  it('draft node offers ~4-5 single-card options for the route role', () => {
    const ctx = makeContext({ candidates: removalPool });
    const route: BrewRoute = { id: 'draft:removal', type: 'draft', title: 'Add Removal',
      description: '', targetRole: 'removal', targetType: null, tone: 'need', fills: 1 };
    const node = openNode(ctx, makeState(), route);
    expect(node.type).toBe('draft');
    expect(node.options.length).toBeGreaterThanOrEqual(4);
    node.options.forEach(o => expect(o.cards).toHaveLength(1));
  });

  it('bundle node offers 2-3 multi-card options', () => {
    const ctx = makeContext({ candidates: removalPool });
    const route: BrewRoute = { id: 'bundle:removal', type: 'bundle', title: 'Add Removal',
      description: '', targetRole: 'removal', targetType: null, tone: 'need', fills: 3 };
    const node = openNode(ctx, makeState(), route);
    expect(node.type).toBe('bundle');
    expect(node.options.length).toBeGreaterThanOrEqual(2);
    node.options.forEach(o => expect(o.cards.length).toBeGreaterThanOrEqual(2));
  });

  it('lightning node offers a single option holding five cards', () => {
    const ctx = makeContext({ candidates: removalPool });
    const route: BrewRoute = { id: 'lightning', type: 'lightning', title: 'Lightning Round',
      description: '', targetRole: null, targetType: null, tone: 'neutral', fills: 5 };
    const node = openNode(ctx, makeState(), route);
    expect(node.options).toHaveLength(1);
    expect(node.options[0].cards.length).toBe(5);
  });

  it('excludes already-used cards from options', () => {
    const ctx = makeContext({ candidates: removalPool });
    const route: BrewRoute = { id: 'draft:removal', type: 'draft', title: 'Add Removal',
      description: '', targetRole: 'removal', targetType: null, tone: 'need', fills: 1 };
    const state = makeState({ usedNames: ['Swords to Plowshares'] });
    const node = openNode(ctx, state, route);
    const names = node.options.flatMap(o => o.cards.map(c => c.name));
    expect(names).not.toContain('Swords to Plowshares');
  });
});

describe('openNode — combo', () => {
  it('offers a single option containing the missing combo pieces', () => {
    const missing = [
      makeCandidate('Cathars Crusade', { primary_type: 'Enchantment', type_line: 'Enchantment', inclusion: 70 }),
      makeCandidate('Sol Ring', { role: 'ramp', primary_type: 'Artifact', type_line: 'Artifact', inclusion: 80 }),
    ];
    const ctx = makeContext({ candidates: missing });
    const route: BrewRoute = {
      id: 'combo:c1', type: 'combo', title: 'Assemble a Combo', description: '',
      targetRole: null, targetType: null, tone: 'theme', fills: 2,
      comboMissing: ['Cathars Crusade', 'Sol Ring'], comboResults: ['Infinite tokens'],
    };
    const node = openNode(ctx, makeState(), route);
    expect(node.type).toBe('combo');
    expect(node.options).toHaveLength(1);
    expect(node.options[0].cards.map(c => c.name).sort()).toEqual(['Cathars Crusade', 'Sol Ring']);
  });
});

describe('deriveReasons', () => {
  it('produces a synergy reason and a role reason for a deficit-role card', () => {
    const ctx = makeContext();
    const card = makeCandidate('Swords to Plowshares', { role: 'removal', inclusion: 88, primary_type: 'Instant', type_line: 'Instant' });
    const reasons = deriveReasons(ctx, makeState(), card);
    expect(reasons.some(r => r.kind === 'synergy')).toBe(true);
    expect(reasons.some(r => r.kind === 'role')).toBe(true);
  });
});
