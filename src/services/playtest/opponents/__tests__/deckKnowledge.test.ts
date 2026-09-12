import { describe, it, expect } from 'vitest';
import { takeTurn } from '@/services/playtest/opponents/engine';
import { botPower, effectiveCost, hasHaste } from '@/services/playtest/opponents/stats';
import type { PlayerBoardRead } from '@/services/playtest/opponents/evaluate';
import type { Opponent, OpponentPermanent, TurnFrame } from '@/components/playtest/opponentTypes';
import type { ScryfallCard } from '@/types';

/**
 * The recurring card shapes a deck needs its bot to understand.
 *
 * These are the five patterns the coverage report kept surfacing across the
 * stub decks, and the ones a precon roster will keep meeting: cost reducers,
 * haste granters, regrow, ramp-on-legs, and a `*` in the printed stats. None of
 * them is exotic; all of them were previously invisible to the bot, which is
 * the difference between a deck that plays its plan and one that plays a
 * worse deck for reasons you cannot see.
 */

let n = 0;
function card(p: Partial<ScryfallCard> & { name: string }): ScryfallCard {
  return {
    id: `c${n++}`, type_line: p.type_line ?? 'Creature — Goblin',
    cmc: p.cmc ?? 1, oracle_text: p.oracle_text ?? '', keywords: p.keywords ?? [],
    color_identity: [], colors: [], legalities: {}, set: 'tst', rarity: 'common',
    ...p,
  } as unknown as ScryfallCard;
}
const MOUNTAIN = () => card({ name: 'Mountain', type_line: 'Basic Land — Mountain', cmc: 0 });
const FOREST = () => card({ name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0 });
const perm = (c: ScryfallCard, over: Partial<OpponentPermanent> = {}): OpponentPermanent =>
  ({ instanceId: `p${n++}`, card: c, tapped: false, summoningSick: false, counters: {}, ...over });

function bot(over: Partial<Opponent> = {}): Opponent {
  return {
    id: 'b1', name: 'Bot', stubId: null, blurb: '', colors: [], life: 40,
    library: [], hand: [], graveyard: [], exile: [], command: [],
    commanderName: null, commanderCasts: 0, tokens: [], battlefield: [],
    decked: false, resistance: false, aggression: 0.5, turnsTaken: 0, ...over,
  };
}
const board = (over: Partial<PlayerBoardRead> = {}): PlayerBoardRead =>
  ({ cards: [], life: 40, handSize: 0, untappedCreatures: [], ...over });
const logsOf = (frames: TurnFrame[]) => frames.flatMap(f => f.logs).join(' | ');
const names = (o: Opponent) => o.battlefield.map(p => p.card.name);

const WARCHIEF = () => card({ name: 'Goblin Warchief', cmc: 3, power: '2', toughness: '2' });
const CHIEFTAIN = () => card({ name: 'Goblin Chieftain', cmc: 3, power: '2', toughness: '2' });

describe('cost reducers', () => {
  it('discounts only the matching subtype', () => {
    const bf = [perm(WARCHIEF())];
    const goblin = card({ name: 'Some Goblin', cmc: 4 });
    const elf = card({ name: 'Some Elf', cmc: 4, type_line: 'Creature — Elf' });
    expect(effectiveCost(goblin, bf)).toBe(3);
    expect(effectiveCost(elf, bf)).toBe(4);
  });

  it('stacks and never goes below zero', () => {
    const bf = [perm(WARCHIEF()), perm(WARCHIEF())];
    expect(effectiveCost(card({ name: 'Some Goblin', cmc: 5 }), bf)).toBe(3);
    expect(effectiveCost(card({ name: 'Cheap Goblin', cmc: 1 }), bf)).toBe(0);
  });

  it('lets the bot cast a spell it could not otherwise afford', () => {
    const four = card({ name: 'Costly Goblin', cmc: 4, power: '4', toughness: '4' });
    const lands = () => Array.from({ length: 3 }, () => perm(MOUNTAIN()));

    // Three mana, a 4-drop: without the discount it stays in hand.
    const without = takeTurn(bot({ battlefield: lands(), hand: [four] }), board());
    expect(names(without.final)).not.toContain('Costly Goblin');

    const withIt = takeTurn(
      bot({ battlefield: [...lands(), perm(WARCHIEF())], hand: [four] }),
      board(),
    );
    expect(names(withIt.final)).toContain('Costly Goblin');
  });
});

describe('haste', () => {
  it('is read off the card itself', () => {
    const hasty = perm(card({ name: 'Hasty Thing', keywords: ['Haste'] }), { summoningSick: true });
    expect(hasHaste(hasty, [hasty])).toBe(true);
    const slow = perm(card({ name: 'Slow Thing' }), { summoningSick: true });
    expect(hasHaste(slow, [slow])).toBe(false);
  });

  it('is granted by a lord, to the matching subtype only', () => {
    const chieftain = perm(CHIEFTAIN());
    const goblin = perm(card({ name: 'Plain Goblin' }), { summoningSick: true });
    const elf = perm(card({ name: 'Plain Elf', type_line: 'Creature — Elf' }), { summoningSick: true });
    expect(hasHaste(goblin, [chieftain, goblin, elf])).toBe(true);
    expect(hasHaste(elf, [chieftain, goblin, elf])).toBe(false);
  });

  it('lets a creature attack the turn it lands', () => {
    // The creature has to ARRIVE this turn to be summoning-sick: the untap step
    // clears sickness on anything that was already there, so a pre-placed sick
    // creature is not a test of haste at all.
    const brute = () => card({ name: 'Brute', cmc: 3, power: '3', toughness: '3' });
    const lands = () => Array.from({ length: 3 }, () => perm(MOUNTAIN()));

    const slow = takeTurn(bot({ battlefield: lands(), hand: [brute()] }), board());
    expect(names(slow.final)).toContain('Brute');
    expect(logsOf(slow.frames)).not.toContain('attacks');

    const quick = takeTurn(
      bot({ battlefield: [...lands(), perm(CHIEFTAIN())], hand: [brute()] }),
      board(),
    );
    expect(logsOf(quick.frames)).toContain('Brute');
    expect(logsOf(quick.frames)).toContain('attacks you with');
  });

  it('a Chieftain is still a lord as well as a haste granter', () => {
    const chieftain = perm(CHIEFTAIN());
    const goblin = perm(card({ name: 'Plain Goblin', power: '1', toughness: '1' }));
    // Anthem and haste come off the same card; the list form must keep both.
    expect(botPower(goblin, [chieftain, goblin])).toBe(2);
    expect(hasHaste(goblin, [chieftain, goblin])).toBe(true);
  });
});

describe('regrow', () => {
  it('takes back the best card, never a land', () => {
    const witness = card({ name: 'Eternal Witness', cmc: 3, power: '2', toughness: '1' });
    const r = takeTurn(bot({
      battlefield: Array.from({ length: 3 }, () => perm(FOREST())),
      hand: [witness],
      // Registry-known beats bigger, and the land is not a candidate at all.
      graveyard: [FOREST(), card({ name: 'Vanilla Beast', cmc: 8 }), card({ name: 'Murder', cmc: 3, type_line: 'Instant' })],
    }), board());
    expect(logsOf(r.frames)).toContain('takes back Murder');
    expect(r.final.hand.map(c => c.name)).toContain('Murder');
  });

  it('is silent with an empty graveyard but still lands the body', () => {
    const witness = card({ name: 'Eternal Witness', cmc: 3, power: '2', toughness: '1' });
    const r = takeTurn(bot({
      battlefield: Array.from({ length: 3 }, () => perm(FOREST())),
      hand: [witness],
    }), board());
    expect(names(r.final)).toContain('Eternal Witness');
    expect(logsOf(r.frames)).not.toContain('takes back');
  });
});

describe('ramp on legs', () => {
  const ELDER = () => card({ name: 'Sakura-Tribe Elder', cmc: 2, power: '1', toughness: '1' });

  it('is cashed in when the bot is behind on lands', () => {
    // Turn 6 with two lands out: well behind, so crack it.
    const r = takeTurn(bot({
      turnsTaken: 5,
      battlefield: [perm(ELDER()), perm(FOREST()), perm(FOREST())],
      library: [FOREST(), FOREST()],
    }), board());
    expect(logsOf(r.frames)).toContain('fetches 1 land');
    expect(names(r.final)).not.toContain('Sakura-Tribe Elder');
    expect(r.final.graveyard.map(c => c.name)).toContain('Sakura-Tribe Elder');
  });

  it('is kept as a blocker when the bot is on curve', () => {
    const r = takeTurn(bot({
      turnsTaken: 1,
      battlefield: [perm(ELDER()), perm(FOREST()), perm(FOREST())],
      library: [FOREST()],
    }), board());
    expect(logsOf(r.frames)).not.toContain('fetches');
    expect(names(r.final)).toContain('Sakura-Tribe Elder');
  });

  it('the fetched land arrives tapped, so it is not mana this turn', () => {
    const r = takeTurn(bot({
      turnsTaken: 5,
      battlefield: [perm(ELDER()), perm(FOREST()), perm(FOREST())],
      library: [FOREST(), FOREST()],
    }), board());
    const fetched = r.final.battlefield.filter(p => p.card.name === 'Forest');
    expect(fetched.some(p => p.tapped)).toBe(true);
  });
});

describe('a * in the printed stats', () => {
  const JARAD = () => card({
    name: 'Jarad, Golgari Lich Lord', cmc: 4, power: '2', toughness: '2',
    type_line: 'Legendary Creature — Zombie Elf',
  });

  it('scales with the bot\'s own graveyard', () => {
    const jarad = perm(JARAD());
    const creatures = Array.from({ length: 5 }, () => card({ name: 'Dead Thing', power: '1', toughness: '1' }));
    expect(botPower(jarad, [jarad])).toBe(2);
    expect(botPower(jarad, [jarad], creatures)).toBe(7);
  });

  it('counts only creature cards', () => {
    const jarad = perm(JARAD());
    const junk = [
      card({ name: 'Murder', type_line: 'Instant' }),
      card({ name: 'Forest', type_line: 'Basic Land — Forest' }),
    ];
    expect(botPower(jarad, [jarad], junk)).toBe(2);
  });

  it('attacks at its real size', () => {
    const jarad = perm(JARAD());
    const r = takeTurn(bot({
      battlefield: [jarad],
      graveyard: Array.from({ length: 4 }, () => card({ name: 'Dead Thing', power: '1', toughness: '1' })),
      // A blocker it only beats once the graveyard is counted.
    }), board({
      untappedCreatures: [{
        instanceId: 'wall', name: 'Wall', power: 0, toughness: 5, keywords: new Set(),
      }],
    }));
    // A printed 2/2 would refuse this attack; a 6/6 takes it.
    expect(logsOf(r.frames)).toContain('attacks you with Jarad');
  });
});

describe('amass', () => {
  const ARMY = () => card({
    name: 'Zombie Army', type_line: 'Token Creature — Zombie Army',
    power: '0', toughness: '0', cmc: 0,
  });
  const OVERSEER = () => card({ name: 'Gleaming Overseer', cmc: 3, power: '1', toughness: '4' });
  const SKYLORD = () => card({ name: 'Eternal Skylord', cmc: 5, power: '3', toughness: '3' });

  const amassBot = (hand: ScryfallCard[], over: Partial<Opponent> = {}) => bot({
    battlefield: Array.from({ length: 6 }, () => perm(MOUNTAIN())),
    tokens: [ARMY()],
    hand,
    ...over,
  });

  it('creates one Army and puts counters on it', () => {
    const r = takeTurn(amassBot([OVERSEER()]), board());
    const army = r.final.battlefield.filter(p => p.card.name === 'Zombie Army');
    expect(army).toHaveLength(1);
    expect(army[0].counters['+1/+1']).toBe(1);
    expect(logsOf(r.frames)).toContain('amasses 1 (Army is 1/1)');
  });

  it('grows the same Army rather than making a second one', () => {
    // One Army is the whole point of the mechanic: a single big threat.
    const first = takeTurn(amassBot([OVERSEER()]), board());
    const second = takeTurn({ ...first.final, hand: [SKYLORD()] }, board());
    const army = second.final.battlefield.filter(p => p.card.name === 'Zombie Army');
    expect(army).toHaveLength(1);
    expect(army[0].counters['+1/+1']).toBe(3);
  });

  it('the Army fights at the size its counters say', () => {
    const army = perm(ARMY(), { counters: { '+1/+1': 5 } });
    expect(botPower(army, [army])).toBe(5);
  });

  it('does nothing without an Army token in the pool', () => {
    const r = takeTurn(amassBot([OVERSEER()], { tokens: [] }), board());
    expect(logsOf(r.frames)).not.toContain('amasses');
    // The body still lands — it is a 1/4 either way.
    expect(names(r.final)).toContain('Gleaming Overseer');
  });
});

describe('every creature type', () => {
  it('makes a tribal lord pump the whole board', () => {
    const reaper = perm(card({ name: 'Cemetery Reaper', cmc: 3, power: '2', toughness: '2', type_line: 'Creature — Zombie' }));
    const elf = perm(card({ name: 'Some Elf', type_line: 'Creature — Elf', power: '1', toughness: '1' }));
    const nexus = perm(card({ name: 'Maskwood Nexus', type_line: 'Artifact', cmc: 4 }));

    // Without the Nexus the elf is not a Zombie and gets nothing.
    expect(botPower(elf, [reaper, elf])).toBe(1);
    expect(botPower(elf, [reaper, elf, nexus])).toBe(2);
  });
});

describe('the other kinds of *', () => {
  it('counts every card in the graveyard, not just creatures', () => {
    const lord = perm(card({
      name: 'Lord of Extinction', cmc: 6, power: '*', toughness: '*',
      type_line: 'Creature — Elemental',
    }));
    const gy = [
      card({ name: 'Dead Thing', power: '1', toughness: '1' }),
      card({ name: 'Murder', type_line: 'Instant' }),
      card({ name: 'Forest', type_line: 'Basic Land — Forest' }),
    ];
    // A `*` reads as 0 printed, so this is the whole of its size.
    expect(botPower(lord, [lord])).toBe(0);
    expect(botPower(lord, [lord], gy)).toBe(3);
  });

  it('counts lands on the battlefield', () => {
    const multani = perm(card({
      name: "Multani, Yavimaya's Avatar", cmc: 6, power: '*', toughness: '*',
      type_line: 'Legendary Creature — Elemental',
    }));
    const lands = Array.from({ length: 5 }, () => perm(FOREST()));
    expect(botPower(multani, [multani])).toBe(0);
    expect(botPower(multani, [multani, ...lands])).toBe(5);
  });
});

describe('land fetchers', () => {
  it('ramp a deck that would otherwise miss its drops', () => {
    // The library leads with a non-land so the draw step cannot hand the bot a
    // land drop as well — otherwise this counts the land drop and the fetch
    // together and proves neither.
    const r = takeTurn(bot({
      battlefield: [perm(FOREST()), perm(FOREST())],
      hand: [card({ name: 'Rampant Growth', type_line: 'Sorcery', cmc: 2 })],
      library: [card({ name: 'Filler Instant', type_line: 'Instant', cmc: 9 }), FOREST()],
    }), board());
    expect(logsOf(r.frames)).toContain('fetches 1 land');
    // Two lands became three, and the third came out of the library.
    expect(r.final.battlefield.filter(p => p.card.name === 'Forest')).toHaveLength(3);
    expect(r.final.library).toHaveLength(0);
  });

  it('are held rather than wasted with no land left to find', () => {
    const r = takeTurn(bot({
      battlefield: [perm(FOREST()), perm(FOREST())],
      hand: [card({ name: 'Rampant Growth', type_line: 'Sorcery', cmc: 2 })],
      library: [card({ name: 'Some Creature', power: '2', toughness: '2' })],
    }), board());
    expect(r.final.hand.map(c => c.name)).toContain('Rampant Growth');
  });
});

describe('additional costs', () => {
  // This file's land helpers are local to their own tests; these two need a
  // black source and a count, so they get their own.
  const SWAMP = () => card({ name: 'Swamp', type_line: 'Basic Land — Swamp', cmc: 0 });
  const lands = (k: number) => Array.from({ length: k }, () => perm(SWAMP()));
  const INTENT = () => card({ name: 'Diabolic Intent', type_line: 'Sorcery', cmc: 2 });
  it('holds Diabolic Intent with nothing to sacrifice', () => {
    const r = takeTurn(bot({ hand: [INTENT()], battlefield: lands(2), library: [card({ name: 'Drawn' }), card({ name: 'Prize', cmc: 5 })] }), board());
    expect(r.final.hand.map(c => c.name)).toContain('Diabolic Intent');
  });
  it('sacrifices its cheapest creature to cast it', () => {
    const fodder = perm(card({ name: 'Fodder', cmc: 1, power: '1', toughness: '1' }));
    const keeper = perm(card({ name: 'Keeper', cmc: 5, power: '5', toughness: '5' }));
    const r = takeTurn(
      bot({ hand: [INTENT()], battlefield: [fodder, keeper, ...lands(2)], library: [card({ name: 'Drawn' }), card({ name: 'Prize', cmc: 5 })] }),
      board(),
    );
    expect(logsOf(r.frames)).toContain('sacrifices Fodder');
    expect(r.final.graveyard.map(c => c.name)).toEqual(expect.arrayContaining(['Fodder', 'Diabolic Intent']));
    expect(r.final.battlefield.map(p => p.card.name)).toContain('Keeper');
    expect(r.final.hand.map(c => c.name)).toContain('Prize');
  });
});
