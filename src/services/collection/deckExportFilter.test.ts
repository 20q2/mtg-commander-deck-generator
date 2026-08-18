import { describe, it, expect } from 'vitest';
import { parseDeckLines, matchesTarget, buildExportChips, filterDeckLines, type DeckLine, type BinderEntries } from './deckExportFilter';

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

describe('buildExportChips', () => {
  it('counts deck quantities, not distinct cards', () => {
    const lines = parseDeckLines('9 Nazgûl\n1 Sol Ring');
    const chips = buildExportChips(lines, entries);
    expect(chips.find(c => c.label === 'Collection1')?.count).toBe(10);
  });

  it('counts a card held in two collections under both', () => {
    const chips = buildExportChips(parseDeckLines('1 Sol Ring'), entries);
    expect(chips.find(c => c.label === 'Collection1')?.count).toBe(1);
    expect(chips.find(c => c.label === 'Cube')?.count).toBe(1);
  });

  it('sorts collection chips by count descending, missing last', () => {
    const lines = parseDeckLines('9 Nazgûl\n1 Sol Ring\n1 Ancient Tomb');
    expect(buildExportChips(lines, entries).map(c => c.label)).toEqual([
      'Collection1',
      'Cube',
      'Not in a collection',
    ]);
  });

  it('omits the missing chip when every card is owned', () => {
    const chips = buildExportChips(parseDeckLines('1 Sol Ring'), entries);
    expect(chips.some(c => c.target.kind === 'missing')).toBe(false);
  });

  it('excludes basics from every chip', () => {
    const chips = buildExportChips(parseDeckLines('1 Sol Ring\n12 Swamp'), entries);
    expect(chips.find(c => c.label === 'Collection1')?.count).toBe(1);
    expect(chips.some(c => c.target.kind === 'missing')).toBe(false);
  });

  it('returns no chips when no collection holds a deck card', () => {
    expect(buildExportChips(parseDeckLines('1 Ancient Tomb\n1 Cabal Coffers'), entries)).toEqual([]);
  });

  it('returns no chips when there are no collections at all', () => {
    expect(buildExportChips(parseDeckLines('1 Sol Ring'), new Map())).toEqual([]);
  });
});

describe('filterDeckLines', () => {
  const lines = parseDeckLines('9 Nazgûl\n1 Sol Ring\n1 Ancient Tomb\n12 Swamp');

  it('keeps only cards in the named collection, at deck quantity', () => {
    expect(filterDeckLines(lines, { kind: 'collection', binderId: 'b1' }, entries)).toBe(
      '9 Nazgûl\n1 Sol Ring'
    );
  });

  it('keeps only unowned non-basics for the missing target', () => {
    expect(filterDeckLines(lines, { kind: 'missing' }, entries)).toBe('1 Ancient Tomb');
  });

  it('preserves the original line order', () => {
    expect(filterDeckLines(lines, { kind: 'collection', binderId: 'b2' }, entries)).toBe('1 Sol Ring');
  });

  it('returns every line for the all target', () => {
    expect(filterDeckLines(lines, { kind: 'all' }, entries)).toBe(
      '9 Nazgûl\n1 Sol Ring\n1 Ancient Tomb\n12 Swamp'
    );
  });

  it('returns an empty string when nothing matches', () => {
    expect(filterDeckLines(lines, { kind: 'collection', binderId: 'nope' }, entries)).toBe('');
  });
});
