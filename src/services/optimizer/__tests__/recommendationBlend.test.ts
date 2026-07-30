import { describe, it, expect, vi } from 'vitest';

// Deterministic roles without loading real tagger data.
vi.mock('@/services/tagger/client', () => ({
  getCardRole: (name: string) => (name === 'Ramp Card' ? 'ramp' : null),
  getAllCardRoles: () => [],
  isUtilityLand: () => false,
  isTapland: () => false,
}));

import { blendClusterIntoRecommendations } from '../recommendationBlend';
import type { LiftCandidate } from '../liftClusters';
import type { RecommendedCard } from '@/services/deckBuilder/deckAnalyzer';
import type { ScryfallCard } from '@/types';

const rec = (name: string, score: number, extra: Partial<RecommendedCard> = {}): RecommendedCard => ({
  name, inclusion: 50, synergy: 0, fillsDeficit: false, primaryType: 'Creature', score, ...extra,
});

const sc = (name: string): ScryfallCard =>
  ({ id: name, name, cmc: 2, type_line: 'Creature', prices: { usd: '1.00' } } as unknown as ScryfallCard);

const edge = (seed: string, lift: number, coPct: number, numDecks = 100) => ({ seed, lift, coPct, numDecks });

const cand = (name: string, edges: LiftCandidate['edges']): LiftCandidate => ({
  card: sc(name),
  edges,
  connectionCount: edges.length,
  bestLift: Math.max(...edges.map(e => e.lift)),
  bestCoPct: Math.max(...edges.map(e => e.coPct)),
  bestNumDecks: Math.max(...edges.map(e => e.numDecks)),
});

describe('blendClusterIntoRecommendations', () => {
  it('boosts an existing rec that is also a cluster above an equal-base rec that is not', () => {
    const out = blendClusterIntoRecommendations(
      [rec('A', 100), rec('B', 100)],
      [cand('A', [edge('S1', 8, 20), edge('S2', 6, 15)])],
    );
    expect(out[0].name).toBe('A');
    expect(out[0].score!).toBeGreaterThan(100);
    expect(out[0].clusterConnections).toBe(2);
  });

  it('injects a cluster-only card the rec list never had', () => {
    const out = blendClusterIntoRecommendations(
      [rec('A', 100)],
      [cand('New', [edge('S1', 8, 20), edge('S2', 7, 18)])],
    );
    const injected = out.find(c => c.name === 'New');
    expect(injected).toBeTruthy();
    expect(injected!.inclusion).toBe(0);
    expect(injected!.clusterConnections).toBe(2);
  });

  it('does NOT inject a single-anchor (connectionCount === 1) candidate', () => {
    const out = blendClusterIntoRecommendations(
      [rec('A', 100)],
      [cand('Solo', [edge('S1', 30, 20)])],
    );
    expect(out.find(c => c.name === 'Solo')).toBeUndefined();
  });

  it('excludes broadly-played staples (baseline% >= 3.5)', () => {
    // lift 3, coPct 40 -> baseline 13.3% -> staple, even with 2 connections.
    const out = blendClusterIntoRecommendations(
      [rec('A', 100)],
      [cand('Staple', [edge('S1', 3, 40, 200), edge('S2', 3, 38, 200)])],
    );
    expect(out).toHaveLength(1);
    expect(out.find(c => c.name === 'Staple')).toBeUndefined();
  });

  it('keeps the cluster bonus bounded — a strong cluster cannot overtake a top inclusion rec', () => {
    const out = blendClusterIntoRecommendations(
      [rec('Top', 200)],
      [cand('New', [edge('S1', 40, 60, 1000), edge('S2', 40, 60, 1000)])],
    );
    expect(out[0].name).toBe('Top');
  });

  it('respects the limit and returns sorted-desc output', () => {
    const out = blendClusterIntoRecommendations(
      [rec('A', 10), rec('B', 20), rec('C', 30)],
      [cand('New', [edge('S1', 8, 20), edge('S2', 7, 18)])],
      { limit: 2 },
    );
    expect(out).toHaveLength(2);
    expect(out[0].score!).toBeGreaterThanOrEqual(out[1].score!);
  });

  it('with a roleFilter, only injects synthesized cards of that role', () => {
    const cands = [cand('Ramp Card', [edge('S1', 8, 20), edge('S2', 7, 18)])];
    expect(blendClusterIntoRecommendations([rec('A', 100)], cands, { roleFilter: 'ramp' })
      .some(c => c.name === 'Ramp Card')).toBe(true);
    expect(blendClusterIntoRecommendations([rec('A', 100)], cands, { roleFilter: 'removal' })
      .some(c => c.name === 'Ramp Card')).toBe(false);
  });

  it('does not synthesize excluded (banned) names', () => {
    const out = blendClusterIntoRecommendations(
      [rec('A', 100)],
      [cand('Banned', [edge('S1', 8, 20), edge('S2', 7, 18)])],
      { excludeNames: new Set(['Banned']) },
    );
    expect(out.find(c => c.name === 'Banned')).toBeUndefined();
  });
});
