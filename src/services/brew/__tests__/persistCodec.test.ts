import { describe, it, expect } from 'vitest';
import { serializeBrew, deserializeBrew } from '../persistCodec';

describe('brew persist codec', () => {
  it('round-trips Set and Map fields (which plain JSON drops)', () => {
    const obj = {
      name: 'x',
      tags: new Set(['a', 'b']),
      counts: new Map<string, number>([['k', 1]]),
      nested: { s: new Set([1, 2]) },
      list: [3, 4],
    };
    const back = deserializeBrew<typeof obj>(serializeBrew(obj));
    expect(back.tags).toBeInstanceOf(Set);
    expect([...back.tags]).toEqual(['a', 'b']);
    expect(back.counts).toBeInstanceOf(Map);
    expect(back.counts.get('k')).toBe(1);
    expect(back.nested.s).toBeInstanceOf(Set);
    expect([...back.nested.s]).toEqual([1, 2]);
    expect(back.list).toEqual([3, 4]);
    expect(back.name).toBe('x');
  });

  it('plain JSON drops a Set (the bug this avoids)', () => {
    const plain = JSON.parse(JSON.stringify({ s: new Set([1]) }));
    expect(plain.s).toEqual({});
  });
});
