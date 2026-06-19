import { describe, it, expect } from 'vitest';
import { openNode, deriveReasons, shortPayoff, buildPackNode } from '../nodes';
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
  it('builds a single-card 4-option draft for an elite draft route', () => {
    const ctx = makeContext({ candidates: removalPool }); // 5 removal cards
    const route: BrewRoute = { id: 'draft:elite', type: 'draft', title: 'Headliner',
      description: '', targetRole: null, targetType: null, tone: 'neutral', fills: 1 };
    const node = openNode(ctx, makeState(), route);
    expect(node.type).toBe('draft');
    expect(node.options.length).toBeGreaterThanOrEqual(2);
    expect(node.options.length).toBeLessThanOrEqual(4);
    node.options.forEach(o => expect(o.cards.length).toBe(1)); // one card per option
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

describe('buildPackNode — coherent sub-strategy bundles', () => {
  it('clusters cards into named bundles by shared theme/subtype', () => {
    const ctx = makeContext({
      roleTargets: { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 },
      typeTargets: {},
      themeNames: { tokens: 'Tokens', sacrifice: 'Sacrifice' },
      candidates: [
        makeCandidate('Token A', { themeTags: ['tokens'], inclusion: 70 }),
        makeCandidate('Token B', { themeTags: ['tokens'], inclusion: 65 }),
        makeCandidate('Token C', { themeTags: ['tokens'], inclusion: 60 }),
        makeCandidate('Sac A', { themeTags: ['sacrifice'], inclusion: 68 }),
        makeCandidate('Sac B', { themeTags: ['sacrifice'], inclusion: 63 }),
        makeCandidate('Sac C', { themeTags: ['sacrifice'], inclusion: 58 }),
      ],
    });
    const node = buildPackNode(ctx, makeState())!;
    expect(node.type).toBe('bundle');
    // Theme bundles wear evocative flavor-map names (tokens → "Raise an Army", sacrifice → "Feed the Machine").
    const labels = node.options.map(o => o.label);
    expect(labels).toContain('Raise an Army');
    expect(labels).toContain('Feed the Machine');
    const tokenBundle = node.options.find(o => o.label === 'Raise an Army')!;
    expect(tokenBundle.cards.every(c => c.themeTags.includes('tokens'))).toBe(true);
    expect(tokenBundle.cards.length).toBeGreaterThanOrEqual(2);
  });

  it('always offers a bundle addressing the leading deficit', () => {
    const ctx = makeContext({
      roleTargets: { ramp: 0, removal: 8, boardwipe: 0, cardDraw: 0 },
      typeTargets: {},
      themeNames: { tokens: 'Tokens' },
      candidates: [
        makeCandidate('Removal A', { role: 'removal', type_line: 'Instant', primary_type: 'Instant', inclusion: 80 }),
        makeCandidate('Removal B', { role: 'removal', type_line: 'Instant', primary_type: 'Instant', inclusion: 75 }),
        makeCandidate('Removal C', { role: 'removal', type_line: 'Instant', primary_type: 'Instant', inclusion: 70 }),
        makeCandidate('Token A', { themeTags: ['tokens'], inclusion: 60 }),
        makeCandidate('Token B', { themeTags: ['tokens'], inclusion: 55 }),
      ],
    });
    const node = buildPackNode(ctx, makeState())!;
    const needBundle = node.options.find(o => o.flavor === 'need')!;
    expect(needBundle).toBeDefined();
    expect(needBundle.cards.every(c => c.role === 'removal')).toBe(true);
  });

  it('picking one bundle excludes the others (no card appears in two bundles)', () => {
    const ctx = makeContext({
      themeNames: { tokens: 'Tokens', sacrifice: 'Sacrifice' },
      candidates: [
        makeCandidate('Both A', { themeTags: ['tokens', 'sacrifice'], inclusion: 70 }),
        makeCandidate('Token B', { themeTags: ['tokens'], inclusion: 65 }),
        makeCandidate('Token C', { themeTags: ['tokens'], inclusion: 60 }),
        makeCandidate('Sac B', { themeTags: ['sacrifice'], inclusion: 63 }),
        makeCandidate('Sac C', { themeTags: ['sacrifice'], inclusion: 58 }),
      ],
    });
    const node = buildPackNode(ctx, makeState())!;
    const allNames = node.options.flatMap(o => o.cards.map(c => c.name));
    expect(allNames.length).toBe(new Set(allNames).size);
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

    // Each option carries the owned piece(s) it combos with, for display.
    expect(tokens.comboHave?.map(p => p.name)).toEqual(['Test Commander']);
    expect(tokens.comboHave?.[0].scryfall.name).toBe('Test Commander');
  });

  it('resolves comboHave art from prior picks as well as the commander', () => {
    const combo: EDHRECCombo = { comboId: 'c1',
      cards: [{ name: 'Kiki-Jiki', id: '1' }, { name: 'Zealous Conscripts', id: '2' }],
      results: ['Infinite haste tokens'], deckCount: 700, rank: 1, bracket: '3', prereqCount: 0 };
    const kiki = makeCandidate('Kiki-Jiki', { primary_type: 'Creature', type_line: 'Creature' });
    const ctx = makeContext({
      candidates: [makeCandidate('Zealous Conscripts', { primary_type: 'Creature', type_line: 'Creature' })],
      combos: [combo],
    });
    // Kiki is a prior pick (owned via state.picks), not the commander.
    const state = makeState({
      usedNames: ['Kiki-Jiki'],
      picks: [{ name: 'Kiki-Jiki', card: kiki.scryfall, role: null, subtype: null, inclusion: 50, viaRouteId: 'r', reasons: [] }],
    });
    const route: BrewRoute = { id: 'combo', type: 'combo', title: 'Combos', description: '',
      targetRole: null, targetType: null, tone: 'theme', fills: 1 };

    const node = openNode(ctx, state, route);
    const opt = node.options[0];
    expect(opt.cards.map(c => c.name)).toEqual(['Zealous Conscripts']);
    expect(opt.comboHave?.map(p => p.name)).toEqual(['Kiki-Jiki']);
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
  it('produces a role reason for a deficit-role card and no raw synergy chip', () => {
    const ctx = makeContext();
    const card = makeCandidate('Swords to Plowshares', { role: 'removal', inclusion: 88, primary_type: 'Instant', type_line: 'Instant' });
    const reasons = deriveReasons(ctx, makeState(), card);
    expect(reasons.some(r => r.kind === 'role')).toBe(true);
    expect(reasons.some(r => r.kind === 'synergy')).toBe(false); // the "Synergy NN" chip is gone
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

describe('discovered cards in the pool', () => {
  it('surfaces lift/co-play finds as their own Hidden Synergy pack', () => {
    const d1 = makeCandidate('Surprise Tech', { inclusion: 30, discoveredVia: 'Korvold', coSynergy: 40, discoverySource: 'lift' });
    const d2 = makeCandidate('Sleeper Hit', { inclusion: 20, discoveredVia: 'Korvold', coSynergy: 35, discoverySource: 'lift' });
    // A few ramp cards so the need pack forms from them; creature target 0 so the discovered
    // creatures aren't pulled into the need pack and instead land in their own discovery pack.
    const ctx = makeContext({
      typeTargets: { creature: 0, sorcery: 8, artifact: 6 },
      candidates: [
        makeCandidate('Rampant Growth', { role: 'ramp', primary_type: 'Sorcery', type_line: 'Sorcery' }),
        makeCandidate('Cultivate', { role: 'ramp', primary_type: 'Sorcery', type_line: 'Sorcery' }),
        makeCandidate('Farseek', { role: 'ramp', primary_type: 'Sorcery', type_line: 'Sorcery' }),
      ],
    });
    const state = makeState({ discovered: [d1, d2] });
    const route: BrewRoute = { id: 'bundle:pack', type: 'bundle', title: 'Open a Pack',
      description: '', targetRole: null, targetType: null, tone: 'need', fills: 3 };
    const node = openNode(ctx, state, route);
    const discovery = node.options.find(o => o.flavor === 'discovery');
    expect(discovery).toBeDefined();
    expect(discovery!.label).toBe('Hidden Synergy');
    expect(discovery!.cards.map(c => c.name).sort()).toEqual(['Sleeper Hit', 'Surprise Tech']);
  });
});

describe('discovery reasons', () => {
  it('flags lift as its own hidden-synergy reason; coplay/similar as discovery', () => {
    const ctx = makeContext({ candidates: [] });
    const state = makeState();
    const lift = makeCandidate('L', { discoveredVia: 'Korvold', coSynergy: 12, discoverySource: 'lift' });
    const coplay = makeCandidate('C', { discoveredVia: 'Korvold', coSynergy: 63, discoverySource: 'coplay' });
    const similar = makeCandidate('S', { discoveredVia: 'Gitrog', coSynergy: 0, discoverySource: 'similar' });
    expect(deriveReasons(ctx, state, lift).find(r => r.kind === 'lift')?.label).toBe('Hidden synergy with Korvold');
    expect(deriveReasons(ctx, state, coplay).find(r => r.kind === 'discovery')?.label).toBe('Plays with Korvold');
    expect(deriveReasons(ctx, state, similar).find(r => r.kind === 'discovery')?.label).toBe('Similar to Gitrog');
    // A lift find drops the commander-popularity "Synergy NN" chip — it's here via lift, not play rate.
    expect(deriveReasons(ctx, state, lift).some(r => r.kind === 'synergy')).toBe(false);
  });
});
