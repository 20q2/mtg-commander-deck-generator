import { describe, it, expect } from 'vitest';
import { parseCollectionList } from './parseCollectionList';

const names = (input: string) => parseCollectionList(input).cards.map(c => c.name);

describe('parseCollectionList — Archidekt category annotations', () => {
  it('strips trailing [Category] labels alongside set/collector info', () => {
    const input = [
      'Abyssal Gorestalker (lci) 87 [Removal]',
      'Arcane Signet (tmc) 57 [Ramp]',
      'Baleful Strix (fic) 318 [Draw]',
      'Arena of Glory (mh3) 215 [Land]',
    ].join('\n');

    expect(names(input)).toEqual([
      'Abyssal Gorestalker',
      'Arcane Signet',
      'Baleful Strix',
      'Arena of Glory',
    ]);
  });

  it('strips a [Category] with no set/collector info', () => {
    expect(names('Sol Ring [Ramp]')).toEqual(['Sol Ring']);
  });

  it('strips multiple bracket groups and quantity prefix', () => {
    expect(names('1x Sol Ring (cmm) 368 [Ramp,Artifact] [Maybeboard]')).toEqual(['Sol Ring']);
  });

  it('leaves plain names untouched', () => {
    expect(names('Korvold, Fae-Cursed King')).toEqual(['Korvold, Fae-Cursed King']);
  });
});

describe('parseCollectionList — non-numeric collector numbers', () => {
  it('strips The List / promo collector numbers (alphanumeric + hyphen)', () => {
    const input = [
      'Carrion Feeder (plst) MH1-81',
      'Garbage Elemental (ust) 82b',
      'Mark of Mutiny (plst) PCA-47',
      'Nevermaker (plst) MOR-44',
      'Profaner of the Dead (plst) DTK-70',
      'Unspeakable Symbol (plst) SCG-79',
    ].join('\n');

    expect(names(input)).toEqual([
      'Carrion Feeder',
      'Garbage Elemental',
      'Mark of Mutiny',
      'Nevermaker',
      'Profaner of the Dead',
      'Unspeakable Symbol',
    ]);
  });

  it('strips a star/foil collector suffix', () => {
    expect(names('Sol Ring (sld) 1429★')).toEqual(['Sol Ring']);
  });
});

describe('parseCollectionList — MTGO/paper export with (SET) collector + sideboard', () => {
  it('parses set codes, hyphenated collector numbers, DFCs, and skips section headers', () => {
    const input = [
      '2 Blood Fountain (VOW) 95',
      '4 Cast Down (2XM) 79',
      '3 Ephemerate (PLST) MH1-7',
      '2 Reckoner\'s Bargain (PLST) NEO-120',
      '4 Tithing Blade / Consuming Sepulcher (LCI) 128',
      '3 Troll of Khazad-dûm (LTR) 111',
      '8 Swamp (J25) 89',
      '',
      'SIDEBOARD:',
      '3 Duress (PLST) EMA-86',
      '3 God-Pharaoh\'s Faithful (HOU) 14',
    ].join('\n');

    const cards = parseCollectionList(input).cards;
    expect(cards.map(c => c.name)).toEqual([
      'Blood Fountain',
      'Cast Down',
      'Ephemerate',
      "Reckoner's Bargain",
      'Tithing Blade',
      'Troll of Khazad-dûm',
      'Swamp',
      'Duress',
      "God-Pharaoh's Faithful",
    ]);
    // Quantities preserved
    expect(cards.find(c => c.name === 'Swamp')?.quantity).toBe(8);
    expect(cards.find(c => c.name === 'Cast Down')?.quantity).toBe(4);
  });
});
