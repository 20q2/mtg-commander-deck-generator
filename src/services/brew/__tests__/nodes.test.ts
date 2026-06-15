import { describe, it, expect } from 'vitest';
import { openNode, deriveReasons, shortPayoff } from '../nodes';
import { makeContext, makeState, makeCandidate } from './fixtures';
import type { BrewRoute } from '../brewTypes';
import type { EDHRECCombo } from '@/types';

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
  it('offers one option per near-miss combo, labeled with a short payoff and no card reasons', () => {
    const combos: EDHRECCombo[] = [
      { comboId: 'c1', cards: [{ name: 'Test Commander', id: '1' }, { name: 'Cathars Crusade', id: '2' }],
        results: ['Infinite tokens'], deckCount: 900, rank: 1, bracket: '3', prereqCount: 0 },
      { comboId: 'c2', cards: [{ name: 'Test Commander', id: '1' }, { name: 'Sol Ring', id: '3' }],
        results: ['Infinite mana'], deckCount: 800, rank: 2, bracket: '3', prereqCount: 0 },
    ];
    const ctx = makeContext({
      candidates: [
        makeCandidate('Cathars Crusade', { primary_type: 'Enchantment', type_line: 'Enchantment' }),
        makeCandidate('Sol Ring', { role: 'ramp', primary_type: 'Artifact', type_line: 'Artifact' }),
      ],
      combos,
    });
    const route: BrewRoute = { id: 'combo', type: 'combo', title: 'Combos', description: '',
      targetRole: null, targetType: null, tone: 'theme', fills: 1 };

    const node = openNode(ctx, makeState(), route);
    expect(node.type).toBe('combo');
    expect(node.prompt).toBe('Complete a combo');
    expect(node.canPass).toBe(true);
    expect(node.options).toHaveLength(2);

    const tokens = node.options.find(o => o.cards.some(c => c.name === 'Cathars Crusade'))!;
    expect(tokens.label).toBe('Infinite tokens');
    expect(tokens.reasons.flat()).toHaveLength(0); // synergy reasons suppressed for combos

    const mana = node.options.find(o => o.cards.some(c => c.name === 'Sol Ring'))!;
    expect(mana.label).toBe('Infinite mana');
  });

  it('caps the list at 3 combos', () => {
    const combos: EDHRECCombo[] = ['a', 'b', 'c', 'd'].map((k, i) => ({
      comboId: k, cards: [{ name: 'Test Commander', id: '1' }, { name: `Piece ${k}`, id: `p${k}` }],
      results: [`Result ${k}`], deckCount: 900 - i, rank: i + 1, bracket: '3', prereqCount: 0,
    }));
    const ctx = makeContext({
      candidates: ['a', 'b', 'c', 'd'].map(k =>
        makeCandidate(`Piece ${k}`, { primary_type: 'Artifact', type_line: 'Artifact' })),
      combos,
    });
    const route: BrewRoute = { id: 'combo', type: 'combo', title: 'Combos', description: '',
      targetRole: null, targetType: null, tone: 'theme', fills: 1 };

    const node = openNode(ctx, makeState(), route);
    expect(node.options).toHaveLength(3);
  });
});

describe('shortPayoff', () => {
  it('uses the first result string', () => {
    expect(shortPayoff(['Infinite mana', 'Infinite ETB triggers'])).toBe('Infinite mana');
  });

  it('truncates a long result with an ellipsis', () => {
    const long = 'A very long combo result that runs well past forty characters in total length';
    const out = shortPayoff([long]);
    expect(out.length).toBeLessThanOrEqual(41); // 40 chars + the ellipsis
    expect(out.endsWith('…')).toBe(true);
  });

  it('falls back to "Combo" when there are no results', () => {
    expect(shortPayoff([])).toBe('Combo');
    expect(shortPayoff([''])).toBe('Combo');
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

describe('theme-affinity feedback', () => {
  it('floats a theme-tagged card above an equal off-theme card once you lean that theme', () => {
    const onTheme = makeCandidate('Token Maker', { role: 'removal', inclusion: 50, themeTags: ['tokens'] });
    const offTheme = makeCandidate('Plain Removal', { role: 'removal', inclusion: 50, themeTags: [] });
    const ctx = makeContext({ candidates: [offTheme, onTheme], themeNames: { tokens: 'Tokens' } });
    const route: BrewRoute = { id: 'draft:removal', type: 'draft', title: 'Add Removal',
      description: '', targetRole: 'removal', targetType: null, tone: 'need', fills: 1 };

    // No lean yet: equal base score, original order preserved (offTheme first).
    const neutral = openNode(ctx, makeState(), route);
    expect(neutral.options[0].cards[0].name).toBe('Plain Removal');

    // Leaning Tokens: the token-tagged removal is now surfaced first.
    const leaning = makeState({ themeAffinity: { tokens: 30 } });
    const biased = openNode(ctx, leaning, route);
    expect(biased.options[0].cards[0].name).toBe('Token Maker');
  });

  it('names the leaning theme in the reasons', () => {
    const c = makeCandidate('Token Maker', { role: 'removal', inclusion: 50, themeTags: ['tokens'] });
    const ctx = makeContext({ candidates: [c], themeNames: { tokens: 'Tokens' } });
    const reasons = deriveReasons(ctx, makeState({ themeAffinity: { tokens: 30 } }), c);
    expect(reasons.some(r => r.kind === 'theme' && r.label === 'On-theme: Tokens')).toBe(true);
  });
});
