import { describe, it, expect } from 'vitest';
import { parseDeckLines } from './deckExportFilter';

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
