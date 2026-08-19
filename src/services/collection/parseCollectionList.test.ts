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

describe('parseCollectionList — #hashtag tags', () => {
  it('strips trailing #Tags with and without set codes', () => {
    const input = [
      'Access Tunnel #Evade #Land',
      'Aggressive Mammoth (FDN) #Evade #Overrun',
      "Alrund's Epiphany (KHM) #Extra",
      "An Offer You Can't Refuse (SNC) #Removal",
      'Arcane Denial (SOC) #Removal',
      'Arcane Signet #Ramp',
      'Beastmaster Ascension (NCC) #Overrun',
      'Brainstorm (5ED) #Draw',
      'Breeding Pool (EOE) #Land',
    ].join('\n');

    expect(names(input)).toEqual([
      'Access Tunnel',
      'Aggressive Mammoth',
      "Alrund's Epiphany",
      "An Offer You Can't Refuse",
      'Arcane Denial',
      'Arcane Signet',
      'Beastmaster Ascension',
      'Brainstorm',
      'Breeding Pool',
    ]);
  });

  it('strips #Tags alongside a quantity prefix and collector number', () => {
    expect(names('2x Sol Ring (cmm) 368 #Ramp #Artifact')).toEqual(['Sol Ring']);
    expect(parseCollectionList('2x Sol Ring (cmm) 368 #Ramp').cards[0].quantity).toBe(2);
  });

  it('mixes #Tags and [Category] annotations', () => {
    expect(names('Cyclonic Rift (mm3) 43 [Removal] #Wincon')).toEqual(['Cyclonic Rift']);
  });

  it('keeps a bare #collector number', () => {
    expect(names('Sol Ring #472')).toEqual(['Sol Ring']);
  });

  it('leaves names without tags untouched', () => {
    expect(names('Korvold, Fae-Cursed King (eld) 329')).toEqual(['Korvold, Fae-Cursed King']);
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

describe('parseCollectionList — "//" inside a real card name', () => {
  it('keeps a bare "//" that is part of the name (SP//dr)', () => {
    expect(names('SP//dr, Piloted by Peni')).toEqual(['SP//dr, Piloted by Peni']);
  });

  it('keeps it with a quantity prefix and set/collector suffix', () => {
    expect(names('1 SP//dr, Piloted by Peni (SPM) 12')).toEqual(['SP//dr, Piloted by Peni']);
  });

  it('still strips a spaced back face', () => {
    expect(names('Delver of Secrets // Insectile Aberration')).toEqual(['Delver of Secrets']);
    expect(names('Tithing Blade / Consuming Sepulcher')).toEqual(['Tithing Blade']);
  });

  // Scryfall's /cards/collection endpoint does NOT resolve full multi-face names
  // (not even the canonical " // " form), so every layout below must reduce to its
  // front face. A Scryfall regex sweep confirms SP//dr is the ONLY card in the game
  // whose name has an unspaced "//", so requiring whitespace is safe for all of them.
  it('strips the back face for every multi-face layout', () => {
    const cases: [string, string][] = [
      ['Fire // Ice', 'Fire'],                                                             // split
      ['Aberrant Researcher // Perfected Form', 'Aberrant Researcher'],                    // transform
      ["Agadeem's Awakening // Agadeem, the Undercrypt", "Agadeem's Awakening"],           // modal_dfc
      ['Bonecrusher Giant // Stomp', 'Bonecrusher Giant'],                                 // adventure
      ['Akki Lavarunner // Tok-Tok, Volcano Born', 'Akki Lavarunner'],                     // flip
      ['Brisela, Voice of Nightmares', 'Brisela, Voice of Nightmares'],                    // meld (no "//")
    ];
    for (const [input, expected] of cases) {
      expect(names(input), input).toEqual([expected]);
    }
  });

  it('tolerates exporters that drop a space around the back-face separator', () => {
    expect(names('Fire// Ice')).toEqual(['Fire']);
    expect(names('Fire //Ice')).toEqual(['Fire']);
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
