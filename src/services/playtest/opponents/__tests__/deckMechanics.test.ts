import { describe, it, expect } from 'vitest';
import { takeTurn } from '@/services/playtest/opponents/engine';
import { botKeywords } from '@/services/playtest/opponents/stats';
import { applyDeathTriggers } from '@/services/playtest/opponents/deaths';
import type { PlayerBoardRead } from '@/services/playtest/opponents/evaluate';
import type { Opponent, OpponentPermanent, TurnFrame } from '@/components/playtest/opponentTypes';
import type { ScryfallCard } from '@/types';

/**
 * The mechanisms the two precons needed before their bots understood them.
 *
 * Each of these was a whole cluster of dead cards: attack triggers (both
 * commanders), reclaiming lands from the graveyard, cycling, casting out of
 * the graveyard, scaled drains, keywords granted from the graveyard, and
 * death triggers. What is asserted here is the DECISION in each case — that a
 * bot holding Teval home mills nothing, that it will not cycle for a land it
 * cannot use — because the effects themselves are the easy half.
 */

let n = 0;
function card(p: Partial<ScryfallCard> & { name: string }): ScryfallCard {
  return {
    id: `c${n++}`, type_line: p.type_line ?? 'Creature — Zombie',
    cmc: p.cmc ?? 1, oracle_text: p.oracle_text ?? '', keywords: p.keywords ?? [],
    color_identity: [], colors: [], legalities: {}, set: 'tst', rarity: 'common',
    ...p,
  } as unknown as ScryfallCard;
}
const SWAMP = () => card({ name: 'Swamp', type_line: 'Basic Land — Swamp', cmc: 0 });
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

/** Lands the bot can tap, already unsick so they pay on the turn they appear. */
const lands = (k: number) => Array.from({ length: k }, () => perm(SWAMP()));

const TEVAL = () => card({
  name: 'Teval, the Balanced Scale', cmc: 4, power: '4', toughness: '4',
  type_line: 'Legendary Creature — Spirit Dragon', keywords: ['Flying'],
});

describe('attack triggers', () => {
  it("fires Teval's mill-and-reclaim only when Teval actually attacks", () => {
    const teval = perm(TEVAL());
    const { frames } = takeTurn(
      {
        ...bot({
          battlefield: [teval, ...lands(4)],
          graveyard: [SWAMP()],
          library: [card({ name: 'Filler A' }), card({ name: 'Filler B' }), card({ name: 'Filler C' }), card({ name: 'Filler D' })],
        }),
        turnsTaken: 3,
      },
      board(),
    );
    expect(logsOf(frames)).toContain('Teval, the Balanced Scale attacks');
    expect(logsOf(frames)).toContain('mills 3');
    expect(logsOf(frames)).toContain('returns Swamp from the graveyard');
  });

  it('mills nothing when it holds Teval home as a blocker', () => {
    // A lethal board across the table: chooseAttackers keeps defence home, so
    // Teval never swings — and an attack trigger that fired anyway would be
    // the bot cheating.
    const teval = perm(TEVAL());
    const { frames } = takeTurn(
      { ...bot({ battlefield: [teval], graveyard: [SWAMP()], life: 3, library: [card({ name: 'Filler' })] }), turnsTaken: 3 },
      board({
        life: 40,
        untappedCreatures: [
          { instanceId: 'x1', name: 'Big', power: 9, toughness: 9, keywords: new Set() },
        ],
      }),
    );
    expect(logsOf(frames)).not.toContain('mills 3');
  });
});

describe('reclaiming lands from the graveyard', () => {
  it('puts them onto the battlefield tapped, and stops when the yard is dry', () => {
    const teval = perm(TEVAL());
    const before = bot({
      battlefield: [teval, ...lands(4)],
      graveyard: [SWAMP()],
      library: [card({ name: 'Filler A' }), card({ name: 'Filler B' }), card({ name: 'Filler C' })],
    });
    const { final } = takeTurn({ ...before, turnsTaken: 3 }, board());
    // One land back from the graveyard. Milling three can bury more, so this
    // asserts the reclaimed one arrived rather than a total.
    const swamps = final.battlefield.filter(p => p.card.name === 'Swamp');
    expect(swamps.length).toBeGreaterThanOrEqual(5);
    expect(swamps.some(p => p.tapped)).toBe(true);
  });
});

describe('cycling', () => {
  it('pitches a preferred cycler rather than hard-casting it', () => {
    // Gempalm Polluter costs 6 and cycles for 2. With eight lands the bot can
    // afford either; a player always cycles it.
    const { final, frames } = takeTurn(
      {
        ...bot({
          battlefield: lands(8),
          hand: [card({ name: 'Gempalm Polluter', cmc: 6, power: '4', toughness: '3' })],
          // Deep enough that the draw step leaves something to cantrip into —
          // cycling a cantrip off an empty library does nothing, and the bot
          // correctly hard-casts instead.
          library: [SWAMP(), card({ name: 'Filler A' }), card({ name: 'Filler B' })],
        }),
        turnsTaken: 5,
      },
      board(),
    );
    expect(logsOf(frames)).toContain('cycles Gempalm Polluter');
    expect(final.battlefield.some(p => p.card.name === 'Gempalm Polluter')).toBe(false);
    expect(final.graveyard.some(c => c.name === 'Gempalm Polluter')).toBe(true);
  });

  it('scales the cycled drain by how many zombies are out', () => {
    const zombies = [perm(card({ name: 'Z1' })), perm(card({ name: 'Z2' })), perm(card({ name: 'Z3' }))];
    const { frames } = takeTurn(
      {
        ...bot({
          battlefield: [...zombies, ...lands(3)],
          hand: [card({ name: 'Gempalm Polluter', cmc: 6, power: '4', toughness: '3' })],
          library: [card({ name: 'Filler' })],
        }),
        turnsTaken: 3,
      },
      board(),
    );
    const drain = frames.flatMap(f => f.effects).reduce((n, e) => n + e.lifeLoss, 0);
    expect(drain).toBe(3);
  });

  it('does not landcycle when the library has no land to find', () => {
    const { frames } = takeTurn(
      {
        ...bot({
          battlefield: lands(3),
          hand: [card({ name: 'Twisted Abomination', cmc: 6, power: '5', toughness: '3' })],
          library: [card({ name: 'Not A Land' })],
        }),
        turnsTaken: 3,
      },
      board(),
    );
    expect(logsOf(frames)).not.toContain('cycles Twisted Abomination');
  });
});

describe('casting from the graveyard', () => {
  it('brings Gravecrawler back only while a zombie is out', () => {
    const withZombie = takeTurn(
      {
        ...bot({
          battlefield: [perm(card({ name: 'Some Zombie' })), ...lands(3)],
          graveyard: [card({ name: 'Gravecrawler', cmc: 1, power: '2', toughness: '1' })],
          library: [card({ name: 'Filler' })],
        }),
        turnsTaken: 3,
      },
      board(),
    );
    expect(logsOf(withZombie.frames)).toContain('returns Gravecrawler from the graveyard');

    const withoutZombie = takeTurn(
      {
        ...bot({
          battlefield: [perm(card({ name: 'An Elf', type_line: 'Creature — Elf' })), ...lands(3)],
          graveyard: [card({ name: 'Gravecrawler', cmc: 1, power: '2', toughness: '1' })],
          library: [card({ name: 'Filler' })],
        }),
        turnsTaken: 3,
      },
      board(),
    );
    expect(logsOf(withoutZombie.frames)).not.toContain('returns Gravecrawler');
  });
});

describe('recurring player-facing effects', () => {
  it("scales The Scarab God's upkeep drain with the horde", () => {
    const drainWith = (zombieCount: number) => {
      const zombies = Array.from({ length: zombieCount }, (_, i) => perm(card({ name: `Z${i}` })));
      const { frames } = takeTurn(
        {
          ...bot({
            battlefield: [perm(card({ name: 'The Scarab God', cmc: 5, power: '5', toughness: '5', type_line: 'Legendary Creature — God' })), ...zombies],
            library: [card({ name: 'Filler' })],
          }),
          turnsTaken: 5,
        },
        board(),
      );
      return frames.flatMap(f => f.effects).reduce((n, e) => n + e.lifeLoss, 0);
    };
    // The Scarab God is itself a God, not a Zombie, so it counts only the horde.
    expect(drainWith(0)).toBe(0);
    expect(drainWith(4)).toBe(4);
  });

  it('drains 3 on the land drop from Ob Nixilis', () => {
    const { frames } = takeTurn(
      {
        ...bot({
          battlefield: [perm(card({ name: 'Ob Nixilis, the Fallen', cmc: 5, power: '3', toughness: '3' }))],
          hand: [SWAMP()],
          library: [card({ name: 'Filler' })],
        }),
        turnsTaken: 4,
      },
      board(),
    );
    expect(frames.flatMap(f => f.effects).reduce((n, e) => n + e.lifeLoss, 0)).toBe(3);
  });
});

describe('keywords granted from the graveyard', () => {
  it('gives the whole board flying while Wonder is in the yard', () => {
    const zombie = perm(card({ name: 'Ground Pounder' }));
    const bf = [zombie];
    expect(botKeywords(zombie, bf, []).has('flying')).toBe(false);
    expect(botKeywords(zombie, bf, [card({ name: 'Wonder' })]).has('flying')).toBe(true);
  });

  it('grants nothing to a creature that has lost its abilities', () => {
    const zombie = perm(card({ name: 'Ground Pounder' }), { edit: { loseAbilities: true } as never });
    expect(botKeywords(zombie, [zombie], [card({ name: 'Wonder' })]).has('flying')).toBe(false);
  });
});

describe('death triggers', () => {
  it('draws for a watcher, once per creature that died', () => {
    const reaper = perm(card({ name: 'Midnight Reaper', cmc: 3, power: '3', toughness: '2' }));
    const dead = [perm(card({ name: 'Corpse A' })), perm(card({ name: 'Corpse B' }))];
    const o = bot({
      battlefield: [reaper],
      library: [card({ name: 'D1' }), card({ name: 'D2' }), card({ name: 'D3' })],
    });
    const { opponent } = applyDeathTriggers(o, dead);
    expect(opponent.hand).toHaveLength(2);
  });

  it('bills you a life per zombie that dies under a Plague Belcher', () => {
    const belcher = perm(card({ name: 'Plague Belcher', cmc: 3, power: '5', toughness: '4' }));
    const o = bot({ battlefield: [belcher], library: [] });
    const zombies = [perm(card({ name: 'Z1' })), perm(card({ name: 'Z2' }))];
    expect(applyDeathTriggers(o, zombies).lifeLoss).toBe(2);
    // Not a zombie, so the watcher stays quiet.
    const elf = [perm(card({ name: 'An Elf', type_line: 'Creature — Elf' }))];
    expect(applyDeathTriggers(o, elf).lifeLoss).toBe(0);
  });

  it('ignores tokens for a nontoken watcher', () => {
    const reaper = perm(card({ name: 'Midnight Reaper', cmc: 3, power: '3', toughness: '2' }));
    const o = bot({ battlefield: [reaper], library: [card({ name: 'D1' })] });
    const token = [perm(card({ name: 'Zombie', type_line: 'Token Creature — Zombie' }))];
    expect(applyDeathTriggers(o, token).opponent.hand).toHaveLength(0);
  });

  it("reanimates off Junji's own death, taking the biggest body", () => {
    const o = bot({
      graveyard: [
        card({ name: 'Small', cmc: 1, power: '1', toughness: '1' }),
        card({ name: 'Huge', cmc: 7, power: '7', toughness: '7' }),
      ],
    });
    const junji = [perm(card({ name: 'Junji, the Midnight Sky', cmc: 5, power: '5', toughness: '5' }))];
    const { opponent } = applyDeathTriggers(o, junji);
    expect(opponent.battlefield.map(p => p.card.name)).toEqual(['Huge']);
  });

  it('does nothing at all when no trigger is watching', () => {
    const o = bot({ battlefield: [perm(card({ name: 'Nobody' }))], library: [card({ name: 'D1' })] });
    const result = applyDeathTriggers(o, [perm(card({ name: 'Corpse' }))]);
    expect(result.lifeLoss).toBe(0);
    expect(result.logs).toEqual([]);
    expect(result.opponent.hand).toHaveLength(0);
  });
});

describe('activated abilities that reach the player', () => {
  it('taps Necropolis Fiend to kill the biggest thing you have', () => {
    const { frames } = takeTurn(
      {
        ...bot({
          battlefield: [perm(card({ name: 'Necropolis Fiend', cmc: 9, power: '4', toughness: '5' })), ...lands(3)],
          library: [card({ name: 'Filler' })],
        }),
        turnsTaken: 5,
      },
      board({
        cards: [
          { instanceId: 'v1', name: 'Big Threat', power: 6, toughness: 6, isCreature: true, isArtifact: false, isCommander: false, comboId: null },
          { instanceId: 'v2', name: 'Small', power: 1, toughness: 1, isCreature: true, isArtifact: false, isCommander: false, comboId: null },
        ],
      }),
    );
    const destroyed = frames.flatMap(f => f.effects).flatMap(e => e.destroy);
    expect(destroyed).toContain('v1');
  });

  it('leaves the Fiend untapped when you have no creatures to point it at', () => {
    const { frames } = takeTurn(
      {
        ...bot({
          battlefield: [perm(card({ name: 'Necropolis Fiend', cmc: 9, power: '4', toughness: '5' })), ...lands(3)],
          library: [card({ name: 'Filler' })],
        }),
        turnsTaken: 5,
      },
      board(),
    );
    expect(logsOf(frames)).not.toContain('activates Necropolis Fiend');
  });
});
