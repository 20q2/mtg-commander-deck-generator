import { describe, it, expect } from 'vitest';
import { takeTurn } from '@/services/playtest/opponents/engine';
import { chooseAttackers, chooseBlocks } from '@/services/playtest/opponents/combatChoices';
import { botPower } from '@/services/playtest/opponents/stats';
import type { PlayerBoardRead } from '@/services/playtest/opponents/evaluate';
import type { Opponent, OpponentPermanent } from '@/components/playtest/opponentTypes';
import type { ScryfallCard } from '@/types';
import type { Combatant } from '@/services/playtest/combat';

/**
 * Behaviour checks for the bot engine, covering the sixteen fixes that turned
 * these bots from mana-and-bodies into decks that play themselves.
 *
 * Everything here drives the pure core with synthetic cards, so there is no
 * network and no store. Tuning numbers (the aggression threshold, the hand
 * limit) are asserted deliberately: they are the behaviour, and a change to
 * one should be a change you meant to make.
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
const perm = (c: ScryfallCard, over: Partial<OpponentPermanent> = {}): OpponentPermanent =>
  ({ instanceId: `p${n++}`, card: c, tapped: false, summoningSick: false, counters: {}, ...over });

function bot(over: Partial<Opponent> = {}): Opponent {
  return {
    id: 'b1', name: 'Bot', stubId: null, blurb: '', colors: ['R'], life: 40,
    library: [], hand: [], graveyard: [], exile: [], command: [],
    commanderName: null, commanderCasts: 0, tokens: [], battlefield: [],
    decked: false, resistance: false, aggression: 0.5, turnsTaken: 0, ...over,
  };
}
function board(over: Partial<PlayerBoardRead> = {}): PlayerBoardRead {
  return { cards: [], life: 40, handSize: 0, untappedCreatures: [], ...over };
}
const combatant = (o: Partial<Combatant> & { instanceId: string }): Combatant =>
  ({ name: 'x', power: 1, toughness: 1, keywords: new Set(), ...o });

const names = (o: Opponent) => o.battlefield.map(p => p.card.name);

describe('bot engine smoke', () => {
  it('casts its commander, then pays {2} more the next time', () => {
    const krenko = card({ name: 'Krenko, Mob Boss', cmc: 4, type_line: 'Legendary Creature — Goblin Warrior', power: '3', toughness: '3' });
    const lands = Array.from({ length: 4 }, () => perm(MOUNTAIN()));
    const r1 = takeTurn(bot({ command: [krenko], commanderName: 'Krenko, Mob Boss', battlefield: lands }), board());
    expect(names(r1.final)).toContain('Krenko, Mob Boss');
    expect(r1.final.commanderCasts).toBe(1);

    // Recast at 4 mana must fail once taxed to 6; at 6 it lands.
    const taxed = (landCount: number) => takeTurn(bot({
      command: [krenko], commanderName: 'Krenko, Mob Boss', commanderCasts: 1,
      battlefield: Array.from({ length: landCount }, () => perm(MOUNTAIN())),
    }), board());
    expect(names(taxed(4).final)).not.toContain('Krenko, Mob Boss');
    expect(names(taxed(6).final)).toContain('Krenko, Mob Boss');
  });

  it('casts a token spell and makes the tokens, doubled by a doubler', () => {
    const goblinToken = card({ name: 'Goblin', type_line: 'Token Creature — Goblin', power: '1', toughness: '1', cmc: 0 });
    const fodder = card({ name: 'Dragon Fodder', type_line: 'Sorcery', cmc: 2 });
    const base = takeTurn(bot({
      hand: [fodder], tokens: [goblinToken],
      battlefield: [perm(MOUNTAIN()), perm(MOUNTAIN())],
    }), board());
    expect(names(base.final).filter(x => x === 'Goblin')).toHaveLength(2);
    // Sorcery went to the graveyard rather than sitting on the battlefield.
    expect(base.final.graveyard.map(c => c.name)).toContain('Dragon Fodder');

    const doubled = takeTurn(bot({
      hand: [fodder], tokens: [goblinToken],
      battlefield: [perm(MOUNTAIN()), perm(MOUNTAIN()),
        perm(card({ name: 'Parallel Lives', type_line: 'Enchantment', cmc: 4 }))],
    }), board());
    expect(names(doubled.final).filter(x => x === 'Goblin')).toHaveLength(4);
  });

  it('taps Krenko at combat for a goblin per goblin', () => {
    const goblinToken = card({ name: 'Goblin', type_line: 'Token Creature — Goblin', power: '1', toughness: '1', cmc: 0 });
    const krenko = perm(card({ name: 'Krenko, Mob Boss', cmc: 4, type_line: 'Legendary Creature — Goblin Warrior', power: '3', toughness: '3' }));
    const res = takeTurn(bot({
      tokens: [goblinToken],
      battlefield: [krenko, perm(goblinToken), perm(goblinToken)],
    }), board());
    // Three goblins on board (Krenko counts) -> three new tokens, five total.
    expect(names(res.final).filter(x => x === 'Goblin')).toHaveLength(5);
    expect(res.final.battlefield.find(p => p.instanceId === krenko.instanceId)?.tapped).toBe(true);
  });

  it('anthems raise power, and the lord does not pump itself', () => {
    const chief = perm(card({ name: 'Goblin Chieftain', type_line: 'Creature — Goblin', power: '2', toughness: '2' }));
    const grunt = perm(card({ name: 'Mogg', type_line: 'Creature — Goblin', power: '1', toughness: '1' }));
    const bf = [chief, grunt];
    expect(botPower(grunt, bf)).toBe(2);
    expect(botPower(chief, bf)).toBe(2);
  });

  it('bills Impact Tremors once per creature that arrives', () => {
    const goblinToken = card({ name: 'Goblin', type_line: 'Token Creature — Goblin', power: '1', toughness: '1', cmc: 0 });
    const res = takeTurn(bot({
      hand: [card({ name: 'Dragon Fodder', type_line: 'Sorcery', cmc: 2 })],
      tokens: [goblinToken],
      battlefield: [perm(MOUNTAIN()), perm(MOUNTAIN()),
        perm(card({ name: 'Impact Tremors', type_line: 'Enchantment', cmc: 2 }))],
    }), board());
    expect(res.frames.reduce((n, f) => n + (f.selfDamage ?? 0), 0)).toBe(2);
  });

  it('discards down to seven at end of turn', () => {
    const junk = (i: number) => card({ name: `Counterspell ${i}`, type_line: 'Instant', cmc: 2 });
    const res = takeTurn(bot({ hand: Array.from({ length: 11 }, (_, i) => junk(i)) }), board());
    expect(res.final.hand).toHaveLength(7);
    expect(res.final.graveyard.length).toBeGreaterThan(0);
  });

  it('a permanent with no tap ability makes no mana', () => {
    // Skirk Prospector: sacrifice a Goblin, not {T}. Two lands + it = 2 mana,
    // so a 3-drop must stay in hand.
    const skirk = perm(card({
      name: 'Skirk Prospector', type_line: 'Creature — Goblin',
      oracle_text: 'Sacrifice a Goblin: Add {R}.', produced_mana: ['R'], power: '1', toughness: '1',
    } as Partial<ScryfallCard> & { name: string }));
    const res = takeTurn(bot({
      hand: [card({ name: 'Three Drop', type_line: 'Creature — Ogre', cmc: 3, power: '3', toughness: '3' })],
      battlefield: [perm(MOUNTAIN()), perm(MOUNTAIN()), skirk],
    }), board());
    expect(names(res.final)).not.toContain('Three Drop');
  });

  it('dies to its own board wipe, and declines one that costs it more', () => {
    const act = card({ name: 'Blasphemous Act', type_line: 'Sorcery', cmc: 9 });
    const mine = () => perm(card({ name: 'My Guy', type_line: 'Creature — Goblin', power: '2', toughness: '2' }));
    const theirs = (i: number) => ({
      instanceId: `t${i}`, name: `Yours ${i}`, isCreature: true, isArtifact: false,
      power: 2, toughness: 2, isCommander: false, comboId: null,
    });
    // Four of yours, one of its own: worth it, and its own creature dies too.
    const good = takeTurn(
      bot({ resistance: true, hand: [act], battlefield: [...Array.from({ length: 5 }, () => perm(MOUNTAIN())), mine()] }),
      board({ cards: [0, 1, 2, 3].map(theirs) }),
    );
    expect(good.final.graveyard.map(c => c.name)).toContain('Blasphemous Act');
    expect(names(good.final)).not.toContain('My Guy');

    // One of yours, three of its own: a bad wrath, so it stays in hand.
    const bad = takeTurn(
      bot({ resistance: true, hand: [act], battlefield: [...Array.from({ length: 5 }, () => perm(MOUNTAIN())), mine(), mine(), mine()] }),
      board({ cards: [theirs(0)] }),
    );
    expect(bad.final.hand.map(c => c.name)).toContain('Blasphemous Act');
  });

  it('does not attack into a blocker that eats it for free', () => {
    const goblin = combatant({ instanceId: 'g', power: 1, toughness: 1 });
    const wall = combatant({ instanceId: 'w', power: 5, toughness: 5 });
    expect(chooseAttackers({ candidates: [goblin], blockers: [wall], playerLife: 40, aggression: 0.5 })).toEqual([]);
    // Nothing to block it: swing.
    expect(chooseAttackers({ candidates: [goblin], blockers: [], playerLife: 40, aggression: 0.5 })).toEqual(['g']);
    // Lethal on the swing goes anyway.
    expect(chooseAttackers({ candidates: [goblin], blockers: [], playerLife: 1, aggression: 0 })).toEqual(['g']);
  });

  it('takes an even trade only when aggressive', () => {
    const a = combatant({ instanceId: 'a', power: 2, toughness: 2 });
    const b = combatant({ instanceId: 'b', power: 2, toughness: 2 });
    expect(chooseAttackers({ candidates: [a], blockers: [b], playerLife: 40, aggression: 0.9 })).toEqual(['a']);
    expect(chooseAttackers({ candidates: [a], blockers: [b], playerLife: 40, aggression: 0.1 })).toEqual([]);
  });

  it('keeps a vigilant attacker untapped', () => {
    const vig = perm(card({ name: 'Vigilant', type_line: 'Creature — Knight', power: '3', toughness: '3', keywords: ['Vigilance'] }));
    const plain = perm(card({ name: 'Plain', type_line: 'Creature — Bear', power: '3', toughness: '3' }));
    const res = takeTurn(bot({ battlefield: [vig, plain] }), board());
    const final = res.frames[res.frames.length - 1].opponent;
    expect(final.battlefield.find(p => p.instanceId === vig.instanceId)?.tapped).toBe(false);
    expect(final.battlefield.find(p => p.instanceId === plain.instanceId)?.tapped).toBe(true);
  });

  it('blocks even at maximum aggression, since blocking does not tap', () => {
    const attacker = combatant({ instanceId: 'atk', power: 1, toughness: 1 });
    const blockers = ['x', 'y', 'z'].map(id => combatant({ instanceId: id, power: 3, toughness: 3 }));
    const blocks = chooseBlocks({ attackers: [attacker], blockers, life: 40 });
    expect(blocks['atk']).toHaveLength(1);
  });

  it('points two removal spells at two different creatures in one turn', () => {
    const murder = () => card({ name: 'Murder', type_line: 'Instant', cmc: 3 });
    const yours = (instanceId: string, power: number) => ({
      instanceId, name: instanceId, isCreature: true, isArtifact: false,
      power, toughness: power, isCommander: false, comboId: null,
    });
    const r = takeTurn(
      bot({
        resistance: true, hand: [murder(), murder()], turnsTaken: 6,
        battlefield: Array.from({ length: 6 }, () => perm(MOUNTAIN())),
      }),
      board({ cards: [yours('big', 6), yours('small', 3)] }),
    );
    // The first Murder takes the 6/6. The second has to see a board without
    // it, or it aims at the same corpse and fizzles.
    const destroyed = r.frames.flatMap(f => f.effects).flatMap(e => e.destroy);
    expect(destroyed).toEqual(['big', 'small']);
  });
});
