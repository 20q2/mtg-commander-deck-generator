import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/types';
import {
  areValidPartners,
  canBeCommander,
  combineColorIdentity,
  hasChosenColorIdentity,
  needsChosenColor,
} from './partnerUtils';

function card(partial: Partial<ScryfallCard> & { name: string }): ScryfallCard {
  return {
    id: partial.name,
    type_line: '',
    color_identity: [],
    keywords: [],
    ...partial,
  } as ScryfallCard;
}

// Real Scryfall shapes — all three "chosen color" legends print as colorless.
const clara = card({
  name: 'Clara Oswald',
  type_line: 'Legendary Creature — Human Advisor',
  color_identity: [],
  keywords: ['Impossible Girl', "Doctor's companion"],
  oracle_text:
    'Impossible Girl — If Clara Oswald is your commander, choose a color before the game begins. Clara Oswald is the chosen color.\n' +
    'If a triggered ability of a Doctor you control triggers, that ability triggers an additional time.\n' +
    "Doctor's companion (You can have two commanders if the other is the Doctor.)",
});

const fourteenthDoctor = card({
  name: 'The Fourteenth Doctor',
  type_line: 'Legendary Creature — Time Lord Doctor',
  color_identity: ['G', 'R', 'U', 'W'],
  oracle_text: 'When you cast this spell, reveal the top fourteen cards of your library.',
});

const thrasios = card({
  name: 'Thrasios, Triton Hero',
  type_line: 'Legendary Creature — Merfolk Wizard',
  color_identity: ['G', 'U'],
  keywords: ['Partner'],
  oracle_text: '{4}: Scry 1, then reveal the top card of your library. Partner',
});

// Real Scryfall shapes for every branch of Scryfall's `is:commander`.
describe('canBeCommander', () => {
  it('accepts legendary creatures', () => {
    expect(canBeCommander(thrasios)).toBe(true);
  });

  it('accepts planeswalkers that say "can be your commander"', () => {
    const tasha = card({
      name: 'Tasha, the Witch Queen',
      type_line: 'Legendary Planeswalker — Tasha',
      oracle_text: "+1: Draw a card.\nTasha, the Witch Queen can be your commander.",
    });
    expect(canBeCommander(tasha)).toBe(true);
  });

  it('rejects planeswalkers without that text', () => {
    const jace = card({
      name: 'Jace, the Mind Sculptor',
      type_line: 'Legendary Planeswalker — Jace',
      oracle_text: '+2: Look at the top card of target player\'s library.',
    });
    expect(canBeCommander(jace)).toBe(false);
  });

  it('accepts Grist, a creature everywhere but the battlefield', () => {
    const grist = card({
      name: 'Grist, the Hunger Tide',
      type_line: 'Legendary Planeswalker — Grist',
      oracle_text: "As long as Grist isn't on the battlefield, it's a 1/1 Insect creature in addition to its other types.",
    });
    expect(canBeCommander(grist)).toBe(true);
  });

  it('accepts legendary Vehicles and Spacecraft with power, not ones without', () => {
    const shorikai = card({ name: 'Shorikai, Genesis Engine', type_line: 'Legendary Artifact — Vehicle', power: '8', toughness: '8' });
    const deepSpace9 = card({ name: 'Deep Space 9', type_line: 'Legendary Artifact — Spacecraft' });
    expect(canBeCommander(shorikai)).toBe(true);
    expect(canBeCommander(deepSpace9)).toBe(false);
  });

  it('judges the front face only', () => {
    const akki = card({
      name: 'Akki Lavarunner // Tok-Tok, Volcano Born',
      type_line: 'Creature — Goblin Warrior // Legendary Creature — Goblin Shaman',
      power: '1',
      card_faces: [
        { name: 'Akki Lavarunner', type_line: 'Creature — Goblin Warrior', power: '1' },
        { name: 'Tok-Tok, Volcano Born', type_line: 'Legendary Creature — Goblin Shaman', power: '2' },
      ],
    });
    expect(canBeCommander(akki)).toBe(false);
  });

  it('rejects Backgrounds, which only lead alongside a Choose a Background commander', () => {
    const acolyte = card({ name: 'Acolyte of Bahamut', type_line: 'Legendary Enchantment — Background' });
    expect(canBeCommander(acolyte)).toBe(false);
  });
});

describe('chosen-color commanders', () => {
  it('detects the "choose a color before the game begins" template', () => {
    expect(hasChosenColorIdentity(clara)).toBe(true);
    expect(hasChosenColorIdentity(fourteenthDoctor)).toBe(false);
    expect(hasChosenColorIdentity(null)).toBe(false);
  });

  it('pairs Clara with a Doctor', () => {
    expect(areValidPartners(fourteenthDoctor, clara)).toBe(true);
    expect(needsChosenColor(fourteenthDoctor, clara)).toBe(true);
    expect(needsChosenColor(fourteenthDoctor, thrasios)).toBe(false);
  });
});

describe('combineColorIdentity', () => {
  it('unions both commanders when neither picks a color', () => {
    expect(combineColorIdentity(fourteenthDoctor, thrasios).sort()).toEqual(['G', 'R', 'U', 'W']);
  });

  it('folds the chosen color in — Fourteenth Doctor + Clara on black is WUBRG', () => {
    expect(combineColorIdentity(fourteenthDoctor, clara, 'B').sort())
      .toEqual(['B', 'G', 'R', 'U', 'W']);
  });

  it('leaves the pair at the Doctor’s colors until a color is picked', () => {
    expect(combineColorIdentity(fourteenthDoctor, clara).sort()).toEqual(['G', 'R', 'U', 'W']);
  });

  it('gives a solo chosen-color commander exactly its picked color', () => {
    expect(combineColorIdentity(clara, null, 'B')).toEqual(['B']);
  });

  it('ignores a stale chosen color when no such commander is in the zone', () => {
    expect(combineColorIdentity(fourteenthDoctor, thrasios, 'B').sort())
      .toEqual(['G', 'R', 'U', 'W']);
  });

  it('does not duplicate a chosen color already covered by the other commander', () => {
    expect(combineColorIdentity(fourteenthDoctor, clara, 'W').sort()).toEqual(['G', 'R', 'U', 'W']);
  });
});
