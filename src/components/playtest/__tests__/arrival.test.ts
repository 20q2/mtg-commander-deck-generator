import { describe, it, expect } from 'vitest';
import { findArrivalSlot, snapArrival } from '@/components/playtest/utils';
import type { ScryfallCard } from '@/types';

const land = { name: 'Mountain', type_line: 'Basic Land — Mountain' } as unknown as ScryfallCard;
const dude = { name: 'Goblin', type_line: 'Creature — Goblin' } as unknown as ScryfallCard;

describe('arrival placement', () => {
  it('six click-played cards never share a spot on a real-sized canvas', () => {
    const W = 1200, H = 600, cw = 130, ch = 182;
    const placed: { x: number; y: number }[] = [];
    for (const c of [land, land, land, dude, land, dude]) {
      const s = snapArrival(c, 50, 0, H, ch);
      const slot = findArrivalSlot(placed, s.x, s.y, W, H, c === land, cw, ch);
      placed.push(slot);
    }
    const keys = new Set(placed.map(p => `${p.x},${p.y}`));
    expect(keys.size).toBe(6);
    // Non-lands start at the top margin, lands on the bottom row.
    expect(placed[3].y).toBe(16);
    expect(placed[0].y).toBe(H - ch - 16);
  });

  it('places a creature at the top whatever the opponents are doing', () => {
    // The whole point of the decoupling: arrival reads the canvas and nothing
    // else. There is no seat measurement left to pass in, and a creature lands
    // in the same place with three bots on the table as with none.
    expect(snapArrival(dude, 50, 0, 600, 182)).toEqual({ x: 50, y: 16 });
  });

  it('a zero-sized canvas is the failure mode that piles cards up', () => {
    // Documents the trap Task 1 guards against in the store: with no rect the
    // slot finder has nothing to work with and hands back its start point.
    const a = findArrivalSlot([], 50, 120, 0, 0, false, 130, 182);
    const b = findArrivalSlot([a], 50, 120, 0, 0, false, 130, 182);
    expect(b).toEqual(a);
  });
});
