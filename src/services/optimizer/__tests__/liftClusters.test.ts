import { describe, it, expect } from 'vitest';
import { aggregateLiftCandidates, edgeScore, bombScore, clusterScore, type LiftEdge } from '../liftClusters';
import type { CardLiftEntry } from '@/services/edhrec/client';

const e = (name: string, lift: number, coPct: number, numDecks = 100): CardLiftEntry => ({ name, lift, coPct, numDecks });
const edge = (seed: string, lift: number, coPct: number, numDecks: number): LiftEdge => ({ seed, lift, coPct, numDecks });

describe('aggregateLiftCandidates', () => {
  it('folds seeds into per-candidate edges with connection count + maxes', () => {
    const out = aggregateLiftCandidates([
      { seed: 'Skullclamp', pool: [e('Ophiomancer', 5, 30), e('Blood Artist', 8, 20)] },
      { seed: "Ashnod's Altar", pool: [e('Ophiomancer', 3, 25)] },
    ], new Set());
    const oph = out.find(c => c.name === 'Ophiomancer')!;
    expect(oph.connectionCount).toBe(2);
    expect(oph.edges.map(x => x.seed)).toEqual(['Skullclamp', "Ashnod's Altar"]);
    expect(oph.bestLift).toBe(5);    // max across edges
    expect(oph.bestCoPct).toBe(30);
  });

  it('excludes owned cards', () => {
    const out = aggregateLiftCandidates([{ seed: 'A', pool: [e('Owned', 9, 40)] }], new Set(['Owned']));
    expect(out).toHaveLength(0);
  });

  it('honors a min-connections threshold', () => {
    const pools = [{ seed: 'A', pool: [e('Solo', 9, 40)] }];
    expect(aggregateLiftCandidates(pools, new Set(), 1)).toHaveLength(1);
    expect(aggregateLiftCandidates(pools, new Set(), 2)).toHaveLength(0);
  });

  it('sorts by connection count, then best lift', () => {
    const out = aggregateLiftCandidates([
      { seed: 'A', pool: [e('Two', 9, 10), e('OneHigh', 30, 5)] },
      { seed: 'B', pool: [e('Two', 4, 10)] },
    ], new Set());
    expect(out.map(c => c.name)).toEqual(['Two', 'OneHigh']); // Two links 2 seeds → ranks first
  });

  it('records best lift, co-occurrence and support across a candidate edges', () => {
    const out = aggregateLiftCandidates([
      { seed: 'A', pool: [e('Bomb', 9, 6, 30)] },
      { seed: 'B', pool: [e('Bomb', 3, 40, 80)] },
    ], new Set());
    const bomb = out[0];
    expect(bomb.bestLift).toBe(9);        // the single insane edge — drives the "bomb" bucket
    expect(bomb.bestCoPct).toBe(40);      // max co-occurrence across edges
    expect(bomb.bestNumDecks).toBe(80);   // strongest support — drives the confidence flag
    expect(bomb.connectionCount).toBe(2);
  });
});

describe('edge scoring (lift × inclusion × sample-confidence)', () => {
  it('crosses lift with inclusion — a well-included card beats a higher-lift fluke', () => {
    const included = { edges: [edge('A', 8, 25, 400)] };
    const fluke = { edges: [edge('A', 40, 2, 400)] };  // huge lift, barely played
    expect(bombScore(included)).toBeGreaterThan(bombScore(fluke));
  });

  it('rewards sample size — more shared decks scores higher, all else equal', () => {
    const many = { edges: [edge('A', 10, 20, 1000)] };
    const few = { edges: [edge('A', 10, 20, 60)] };
    expect(bombScore(many)).toBeGreaterThan(bombScore(few));
  });

  it('bombScore is the single best edge; clusterScore sums across edges', () => {
    const c = { edges: [edge('A', 10, 20, 400), edge('B', 4, 10, 200)] };
    expect(bombScore(c)).toBe(Math.max(edgeScore(c.edges[0]), edgeScore(c.edges[1])));
    expect(clusterScore(c)).toBeCloseTo(edgeScore(c.edges[0]) + edgeScore(c.edges[1]));
  });
});
