import { describe, it, expect } from 'vitest';
import { parseDeckLines, matchesTarget, type DeckLine, type BinderEntries } from './deckExportFilter';

const entries: BinderEntries = new Map([
  ['Sol Ring', [{ id: 'b1', name: 'Collection1' }, { id: 'b2', name: 'Cube' }]],
  ['Nazgûl', [{ id: 'b1', name: 'Collection1' }]],
  ['Kessig Naturalist', [{ id: 'b2', name: 'Cube' }]],
]);

const line = (name: string, quantity = 1): DeckLine => ({ quantity, name });

describe('parseDeckLines', () => {
  it('parses quantity-prefixed lines', () => {
    expect(parseDeckLines('1 Sol Ring\n9 Nazgûl')).toEqual([
      { quantity: 1, name: 'Sol Ring' },
      { quantity: 9, name: 'Nazgûl' },
    ]);
  });

  it('treats a bare name as quantity 1', () => {
    expect(parseDeckLines('Sol Ring')).toEqual([{ quantity: 1, name: 'Sol Ring' }]);
  });

  it('skips blank lines', () => {
    expect(parseDeckLines('1 Sol Ring\n\n   \n1 Arcane Signet')).toEqual([
      { quantity: 1, name: 'Sol Ring' },
      { quantity: 1, name: 'Arcane Signet' },
    ]);
  });

  it('keeps digits inside a card name', () => {
    expect(parseDeckLines('1 Borrowing 100,000 Arrows')).toEqual([
      { quantity: 1, name: 'Borrowing 100,000 Arrows' },
    ]);
  });

  it('keeps double-faced names intact', () => {
    expect(parseDeckLines('1 Kessig Naturalist // Lord of the Ulvenwald')).toEqual([
      { quantity: 1, name: 'Kessig Naturalist // Lord of the Ulvenwald' },
    ]);
  });
});

describe('matchesTarget', () => {
  it('matches everything for the all target', () => {
    expect(matchesTarget(line('Ancient Tomb'), { kind: 'all' }, entries)).toBe(true);
  });

  it('matches a card held in the named collection', () => {
    expect(matchesTarget(line('Nazgûl'), { kind: 'collection', binderId: 'b1' }, entries)).toBe(true);
  });

  it('rejects a card held only in another collection', () => {
    expect(matchesTarget(line('Nazgûl'), { kind: 'collection', binderId: 'b2' }, entries)).toBe(false);
  });

  it('matches a card held in two collections from either', () => {
    expect(matchesTarget(line('Sol Ring'), { kind: 'collection', binderId: 'b1' }, entries)).toBe(true);
    expect(matchesTarget(line('Sol Ring'), { kind: 'collection', binderId: 'b2' }, entries)).toBe(true);
  });

  it('matches a double-faced card on its front face', () => {
    const dfc = line('Kessig Naturalist // Lord of the Ulvenwald');
    expect(matchesTarget(dfc, { kind: 'collection', binderId: 'b2' }, entries)).toBe(true);
    expect(matchesTarget(dfc, { kind: 'missing' }, entries)).toBe(false);
  });

  it('puts an unowned non-basic in the missing bucket', () => {
    expect(matchesTarget(line('Ancient Tomb'), { kind: 'missing' }, entries)).toBe(true);
  });

  it('keeps basic lands out of the missing bucket', () => {
    expect(matchesTarget(line('Swamp', 12), { kind: 'missing' }, entries)).toBe(false);
    expect(matchesTarget(line('Wastes'), { kind: 'missing' }, entries)).toBe(false);
  });

  it('treats snow-covered basics as ordinary cards', () => {
    // BASIC_LAND_NAMES holds only the six true basics, so a snow-covered basic you do not
    // own lands in the missing bucket — same as the deck view's owned checkmarks today.
    expect(matchesTarget(line('Snow-Covered Swamp'), { kind: 'missing' }, entries)).toBe(true);
  });

  it('keeps an owned card out of the missing bucket', () => {
    expect(matchesTarget(line('Sol Ring'), { kind: 'missing' }, entries)).toBe(false);
  });
});
