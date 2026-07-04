import { describe, it, expect } from 'vitest';
import { buildStatsLine, shareFilename, fitTransform, liftLabel } from '../liftShareCard';

describe('liftLabel', () => {
  it('formats one decimal with × prefix', () => expect(liftLabel(21.34)).toBe('×21.3'));
  it('caps at 99+ like EDHREC', () => expect(liftLabel(1376)).toBe('×99+'));
});

describe('buildStatsLine', () => {
  it('builds the deck-mode line with the most-connected hub', () => {
    expect(buildStatsLine({
      mode: 'deck', cardCount: 99, tieCount: 47,
      mostConnected: { name: 'Skullclamp', ties: 12 },
    })).toBe('99 cards · 47 synergy ties · most connected: Skullclamp (12 ties)');
  });
  it('omits the hub segment when there is none, and singularises one tie', () => {
    expect(buildStatsLine({ mode: 'deck', cardCount: 100, tieCount: 1, mostConnected: null }))
      .toBe('100 cards · 1 synergy tie');
  });
  it('builds the candidate-mode line', () => {
    expect(buildStatsLine({ mode: 'candidates', bombCount: 23, clusterCount: 31 }))
      .toBe('23 high-lift finds · 31 clusters');
  });
  it('singularises one find / one cluster', () => {
    expect(buildStatsLine({ mode: 'candidates', bombCount: 1, clusterCount: 1 }))
      .toBe('1 high-lift find · 1 cluster');
  });
});

describe('shareFilename', () => {
  it('slugs the commander name', () => {
    expect(shareFilename('Meren of Clan Nel Toth')).toBe('manafoundry-lift-web-meren-of-clan-nel-toth.jpg');
  });
  it('drops apostrophes and appends the partner', () => {
    expect(shareFilename('Rograkh, Son of Rohgahh', 'Ardenn, Intrepid Archaeologist'))
      .toBe('manafoundry-lift-web-rograkh-son-of-rohgahh-ardenn-intrepid-archaeologist.jpg');
  });
  it('uses only the front face of a DFC name', () => {
    expect(shareFilename('Esika, God of the Tree // The Prismatic Bridge'))
      .toBe('manafoundry-lift-web-esika-god-of-the-tree.jpg');
  });
});

describe('fitTransform', () => {
  it('centres the bounds in the rect at the limiting scale', () => {
    const pts = [{ x: 0, y: 0, r: 10 }, { x: 100, y: 0, r: 10 }];        // bounds 120×20 around (50, 0)
    const { k, tx, ty } = fitTransform(pts, { x: 0, y: 100, w: 200, h: 100 }, 10);
    expect(k).toBeCloseTo(1.5);                                          // min(180/120, 80/20, 2)
    expect(50 * k + tx).toBeCloseTo(100);                                // bounds centre → rect centre x
    expect(0 * k + ty).toBeCloseTo(150);                                 // bounds centre → rect centre y
  });
  it('caps zoom at 2 for tiny graphs', () => {
    const { k } = fitTransform([{ x: 0, y: 0, r: 5 }], { x: 0, y: 0, w: 1000, h: 1000 }, 50);
    expect(k).toBe(2);
  });
  it('returns identity-ish transform for an empty node list', () => {
    expect(fitTransform([], { x: 0, y: 0, w: 100, h: 100 }, 10)).toEqual({ k: 1, tx: 50, ty: 50 });
  });
});
