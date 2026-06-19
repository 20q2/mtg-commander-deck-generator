import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('@/services/brew/discovery', () => ({
  discoverFrom: vi.fn(async () => [
    { name: 'Discovered Card', edhrec: { name: 'Discovered Card', sanitized: 'discovered-card', primary_type: 'Instant', inclusion: 40, num_decks: 0 },
      scryfall: { id: 'd', name: 'Discovered Card', cmc: 2, type_line: 'Instant', color_identity: ['W'], prices: { usd: '1' } },
      role: 'removal', subtype: null, inclusion: 40, isLand: false, themeTags: [],
      discoveredVia: 'Sol Ring', coSynergy: 40, discoverySource: 'lift' },
  ]),
}));
import { useStore } from '@/store';
import type { BrewContext, BrewCandidate } from '@/services/brew/engine';
import type { ScryfallCard, EDHRECCard } from '@/types';

function cand(name: string, role: BrewCandidate['role'], type_line = 'Instant'): BrewCandidate {
  const scryfall = { id: name, name, cmc: 2, type_line, color_identity: ['W'], prices: { usd: '1' } } as ScryfallCard;
  const edhrec = { name, sanitized: name, primary_type: type_line, inclusion: 60, num_decks: 100 } as EDHRECCard;
  return { name, edhrec, scryfall, role, subtype: null, inclusion: 60, isLand: false, themeTags: [] };
}

function ctx(): BrewContext {
  const candidates = [
    cand('Swords to Plowshares', 'removal'), cand('Path to Exile', 'removal'),
    cand('Generous Gift', 'removal'), cand('Mortify', 'removal'), cand('Putrefy', 'removal'),
    cand('Sol Ring', 'ramp', 'Artifact'), cand('Arcane Signet', 'ramp', 'Artifact'),
  ];
  return {
    commander: { name: 'Cmd' } as ScryfallCard, partnerCommander: null, colorIdentity: ['W', 'B'],
    customization: {} as BrewContext['customization'], candidates,
    roleTargets: { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 },
    typeTargets: { creature: 0, instant: 8, artifact: 6 }, curveTargets: { 2: 14 },
    landTarget: 36, nonLandTarget: 14, combos: [], themeNames: {}, themeSignatures: {},
  };
}

beforeEach(() => {
  useStore.getState().clearBrewSession();
});

describe('brewSession slice', () => {
  it('starts a session and produces routes', () => {
    useStore.getState().startBrewSession(ctx());
    expect(useStore.getState().brewState?.picks).toHaveLength(0);
    expect(useStore.getState().brewRoutes.length).toBeGreaterThanOrEqual(1);
  });

  it('expandBrewDiscoveries merges discovered cards into state', async () => {
    const s = useStore.getState();
    s.startBrewSession(ctx());
    s.openBrewRoute(useStore.getState().brewRoutes.find(r => r.targetRole === 'removal') ?? useStore.getState().brewRoutes[0]);
    s.applyBrewOption(useStore.getState().brewNode!.options[0], []);
    await useStore.getState().expandBrewDiscoveries();
    expect(useStore.getState().brewState!.discovered.map(c => c.name)).toContain('Discovered Card');
    expect(useStore.getState().brewState!.seededNames.length).toBeGreaterThan(0);
  });

  it('opens a route and applies an option, advancing the session', () => {
    const s = useStore.getState();
    s.startBrewSession(ctx());
    const route = useStore.getState().brewRoutes.find(r => r.targetRole === 'removal') ?? useStore.getState().brewRoutes[0];
    s.openBrewRoute(route);
    const node = useStore.getState().brewNode!;
    expect(node.options.length).toBeGreaterThanOrEqual(1);
    s.applyBrewOption(node.options[0], []);
    expect(useStore.getState().brewState!.picks.length).toBeGreaterThanOrEqual(1);
    // Auto-advances straight to the next card screen — the steering fork only returns every 5 picks.
    expect(useStore.getState().brewNode).not.toBeNull();
    expect(useStore.getState().brewNode!.options.length).toBeGreaterThanOrEqual(1);
  });

  it('undo reverts the last decision (the whole pack)', () => {
    const s = useStore.getState();
    s.startBrewSession(ctx());
    s.openBrewRoute(useStore.getState().brewRoutes[0]);
    s.applyBrewOption(useStore.getState().brewNode!.options[0], []);
    const histBefore = useStore.getState().brewState!.history.length;
    const picksBefore = useStore.getState().brewState!.picks.length;
    s.undoBrewPick();
    expect(useStore.getState().brewState!.history.length).toBe(histBefore - 1);
    expect(useStore.getState().brewState!.picks.length).toBeLessThan(picksBefore);
  });

  it('reroll swaps shown cards and is capped at 2', () => {
    const s = useStore.getState();
    s.startBrewSession(ctx());
    const route = useStore.getState().brewRoutes.find(r => r.id === 'bundle:pack') ?? useStore.getState().brewRoutes[0];
    s.openBrewRoute(route);
    const node = useStore.getState().brewNode!;
    const key = node.routeId;        // packs reroll under their own node id
    const first = node.options.flatMap(o => o.cards.map(c => c.name));
    s.rerollBrew();
    const second = useStore.getState().brewNode!.options.flatMap(o => o.cards.map(c => c.name));
    expect(second.some(n => !first.includes(n)) || second.length < first.length).toBe(true);
    s.rerollBrew(); // 2nd reroll ok
    const usedAfter = useStore.getState().brewState!.rerollsUsed[key] ?? 0;
    s.rerollBrew(); // 3rd should be capped (no further increment)
    expect(useStore.getState().brewState!.rerollsUsed[key]).toBe(usedAfter);
  });
});
