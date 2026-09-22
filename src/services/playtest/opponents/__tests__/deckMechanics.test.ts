import { describe, it, expect } from 'vitest';
import { takeTurn } from '@/services/playtest/opponents/engine';
import { botKeywords, botPower, clearTempBoosts } from '@/services/playtest/opponents/stats';
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

describe('until-end-of-turn pumps', () => {
  const GORECLAW = () => card({
    name: 'Goreclaw, Terror of Qal Sisma', cmc: 4, power: '4', toughness: '3',
    type_line: 'Legendary Creature — Bear',
  });
  const BEAST = (power: string) => card({
    name: `Beast ${power}`, cmc: 5, power, toughness: '4',
    type_line: 'Creature — Beast',
  });

  it('pumps only the creatures big enough, and grants them trample', () => {
    const goreclaw = perm(GORECLAW());
    const big = perm(BEAST('5'));
    const small = perm(BEAST('2'));
    const { final, frames } = takeTurn(
      {
        ...bot({
          battlefield: [goreclaw, big, small, ...lands(4)],
          library: [card({ name: 'Filler' })],
        }),
        turnsTaken: 3,
      },
      board(),
    );
    expect(logsOf(frames)).toContain('trample');

    const after = (id: string) => final.battlefield.find(p => p.instanceId === id)!;
    // Goreclaw is a 4/3, so it clears its own bar and pumps itself.
    expect(after(goreclaw.instanceId).tempBoost).toEqual({ power: 1, toughness: 1, keywords: ['trample'] });
    expect(after(big.instanceId).tempBoost).toEqual({ power: 1, toughness: 1, keywords: ['trample'] });
    // A 2/4 is under the bar and gets nothing — the "power 4 or greater" half.
    expect(after(small.instanceId).tempBoost).toBeUndefined();

    // The boost has to be in the number the combat maths and the seat both read,
    // or it is a field nobody looks at.
    expect(botPower(after(big.instanceId), final.battlefield, final.graveyard)).toBe(6);
    expect(botKeywords(after(big.instanceId), final.battlefield, final.graveyard).has('trample')).toBe(true);
  });

  it('counts counters and anthems towards the power bar, not the printed number', () => {
    // A printed 3/4 wearing a +1/+1 counter is a 4/5, so Goreclaw sees it.
    const goreclaw = perm(GORECLAW());
    const counted = perm(BEAST('3'), { counters: { '+1/+1': 1 } });
    const { final } = takeTurn(
      { ...bot({ battlefield: [goreclaw, counted, ...lands(4)], library: [card({ name: 'Filler' })] }), turnsTaken: 3 },
      board(),
    );
    expect(final.battlefield.find(p => p.instanceId === counted.instanceId)!.tempBoost).toBeDefined();
  });

  it('ends the pump when combat resolves', () => {
    const goreclaw = perm(GORECLAW(), { tempBoost: { power: 1, toughness: 1, keywords: ['trample'] } });
    const cleared = clearTempBoosts(bot({ battlefield: [goreclaw] }));
    expect(cleared.battlefield[0].tempBoost).toBeUndefined();
    expect(botPower(cleared.battlefield[0], cleared.battlefield, [])).toBe(4);
  });

  it('carries no pump into the next turn even if combat never resolved', () => {
    // The untap-step backstop. Without it a bot whose attack was abandoned —
    // the tab closed on an unresolved block — keeps the buff for the rest of
    // the game. A plain Beast, so nothing re-pumps it this turn and what is
    // asserted is the clearing rather than the trigger.
    const stale = perm(BEAST('5'), { tempBoost: { power: 9, toughness: 9, keywords: ['trample'] } });
    const { final } = takeTurn(
      { ...bot({ battlefield: [stale], library: [card({ name: 'Filler' })] }), turnsTaken: 3 },
      board(),
    );
    expect(final.battlefield[0].tempBoost).toBeUndefined();
    expect(botPower(final.battlefield[0], final.battlefield, [])).toBe(5);
  });

  it("pumps only Zombies off Temmet's trigger", () => {
    const temmet = perm(card({
      name: "Temmet, Naktamun's Will", cmc: 5, power: '4', toughness: '4',
      type_line: 'Legendary Creature — Zombie Wizard', keywords: ['Vigilance', 'Menace'],
    }));
    const zombie = perm(card({ name: 'Zombie Body', power: '2', toughness: '2' }));
    const bear = perm(card({ name: 'Plain Bear', power: '2', toughness: '2', type_line: 'Creature — Bear' }));
    const { final, frames } = takeTurn(
      {
        ...bot({ battlefield: [temmet, zombie, bear, ...lands(5)], library: [card({ name: 'Filler' }), card({ name: 'Filler B' })] }),
        turnsTaken: 4,
      },
      board(),
    );
    // Both halves of the card in one trigger: the loot AND the anthem it feeds.
    expect(logsOf(frames)).toContain('draws 1');
    const after = (id: string) => final.battlefield.find(p => p.instanceId === id)!;
    expect(after(zombie.instanceId).tempBoost).toEqual({ power: 1, toughness: 1, keywords: [] });
    expect(after(bear.instanceId).tempBoost).toBeUndefined();
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

describe('devotion', () => {
  const GARY = () => card({
    name: 'Gray Merchant of Asphodel', cmc: 5, mana_cost: '{3}{B}{B}',
    power: '2', toughness: '4', type_line: 'Creature — Zombie',
  });
  const drainFrom = (extra: OpponentPermanent[]) => {
    const { frames } = takeTurn(
      {
        ...bot({
          resistance: true,
          battlefield: [...extra, ...lands(5)],
          hand: [GARY()],
          library: [card({ name: 'Filler' })],
        }),
        turnsTaken: 5,
      },
      board(),
    );
    return frames.flatMap(f => f.effects).reduce((n, e) => n + e.lifeLoss, 0);
  };

  // Gray Merchant is on the battlefield when its own trigger resolves, so the
  // floor is the 2 its own {3}{B}{B} is worth — never 0, and never a flat 2
  // once the rest of the board has pips of its own.
  it('counts the Merchant itself when nothing else is black', () => {
    expect(drainFrom([])).toBe(2);
  });

  it('counts black pips across the rest of the board', () => {
    expect(drainFrom([
      perm(card({ name: 'Two Pips', mana_cost: '{B}{B}' })),
      perm(card({ name: 'One Pip', mana_cost: '{1}{B}' })),
    ])).toBe(5);
  });

  it('ignores permanents with no black pips', () => {
    expect(drainFrom([
      perm(card({ name: 'Rock', type_line: 'Artifact', mana_cost: '{2}' })),
      perm(card({ name: 'Elf', mana_cost: '{G}{G}' })),
    ])).toBe(2);
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

  it("Judith bills you a life for every nontoken creature of hers that dies", () => {
    const judith = perm(card({
      name: 'Judith, the Scourge Diva', cmc: 3, power: '2', toughness: '2',
      type_line: 'Legendary Creature — Human Shaman',
    }));
    const dead = perm(card({ name: 'Footlight Fiend', cmc: 1, power: '1', toughness: '1', type_line: 'Creature — Devil' }));
    const token = perm(card({ name: 'Devil', cmc: 0, power: '1', toughness: '1', type_line: 'Token Creature — Devil' }));
    const r = applyDeathTriggers(bot({ battlefield: [judith] }), [dead, token]);
    // One real creature died, one token: Judith says nontoken, so one damage.
    expect(r.lifeLoss).toBe(1);
    expect(r.logs.join(' | ')).toContain('Judith, the Scourge Diva deals 1 to you');
  });
});

describe('creatures that would arrive as a 0/0', () => {
  it('holds an unauthored 0/0 rather than paying for permanent clutter', () => {
    // Vizier of Many Faces is printed 0/0 and enters as a copy of something.
    // With no copy support the copy never happens, and with no state-based
    // actions nothing kills it — so it would sit there all game attacking for
    // nothing. Four mana for that is worse than holding the card.
    const { final, frames } = takeTurn(
      {
        ...bot({
          battlefield: lands(6),
          hand: [card({ name: 'Vizier of Many Faces', cmc: 4, power: '0', toughness: '0' })],
          library: [card({ name: 'Filler A' }), card({ name: 'Filler B' })],
        }),
        turnsTaken: 5,
      },
      board(),
    );
    expect(logsOf(frames)).not.toContain('casts Vizier of Many Faces');
    expect(final.hand.some(c => c.name === 'Vizier of Many Faces')).toBe(true);
  });

  it('casts it once an anthem makes it a real body', () => {
    const { frames } = takeTurn(
      {
        ...bot({
          battlefield: [perm(card({ name: 'Cemetery Reaper', cmc: 3, power: '2', toughness: '2' })), ...lands(6)],
          hand: [card({ name: 'Vizier of Many Faces', cmc: 4, power: '0', toughness: '0' })],
          library: [card({ name: 'Filler A' }), card({ name: 'Filler B' })],
        }),
        turnsTaken: 5,
      },
      board(),
    );
    expect(logsOf(frames)).toContain('casts Vizier of Many Faces');
  });

  it('still casts a 0/0 whose size the registry defines', () => {
    // Multani's power is a `*` off lands, so it is a real creature.
    const { frames } = takeTurn(
      {
        ...bot({
          battlefield: lands(7),
          hand: [card({ name: "Multani, Yavimaya's Avatar", cmc: 6, power: '0', toughness: '0' })],
          library: [card({ name: 'Filler A' }), card({ name: 'Filler B' })],
        }),
        turnsTaken: 6,
      },
      board(),
    );
    expect(logsOf(frames)).toContain("casts Multani, Yavimaya's Avatar");
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

describe('deaths the engine causes itself', () => {
  const ELDER = () => card({ name: 'Sakura-Tribe Elder', cmc: 2, power: '1', toughness: '1', type_line: 'Creature — Snake Shaman' });
  const REAPER = () => card({ name: 'Midnight Reaper', cmc: 3, power: '3', toughness: '2', type_line: 'Creature — Zombie Knight' });

  it('a sacrificed Sakura-Tribe Elder still feeds a Midnight Reaper', () => {
    // One land against three turns taken: behind, so the Elder gets cracked.
    // Library order matters, and it is the order a real game would give you:
    // sacrificing the Elder is a cost, so the Reaper's trigger resolves before
    // the fetch it paid for. The first Swamp is the turn's draw and land drop,
    // Filler A is what the Reaper draws off the death, and the last Swamp is
    // what the fetch finally finds.
    const r = takeTurn(
      bot({
        battlefield: [perm(ELDER()), perm(REAPER()), perm(SWAMP())],
        library: [SWAMP(), card({ name: 'Filler A' }), SWAMP()],
        turnsTaken: 3,
      }),
      board(),
    );
    expect(logsOf(r.frames)).toContain('Midnight Reaper sees Sakura-Tribe Elder die');
    expect(r.final.hand.map(c => c.name)).toContain('Filler A');
  });

  it("a Solemn Simulacrum caught in the bot's own wrath still draws", () => {
    const act = card({ name: 'Blasphemous Act', type_line: 'Sorcery', cmc: 9 });
    const solemn = perm(card({ name: 'Solemn Simulacrum', cmc: 4, power: '2', toughness: '2', type_line: 'Artifact Creature — Golem' }));
    const yours = Array.from({ length: 4 }, (_, i) => ({
      instanceId: `y${i}`, name: `Yours ${i}`, isCreature: true, isArtifact: false,
      power: 3, toughness: 3, isCommander: false, comboId: null,
    }));
    const r = takeTurn(
      bot({
        resistance: true, hand: [act], turnsTaken: 6,
        battlefield: [solemn, ...lands(5)],
        library: [card({ name: 'Drawn for turn' }), card({ name: 'Drawn by Solemn' })],
      }),
      board({ cards: yours }),
    );
    expect(logsOf(r.frames)).toContain('Solemn Simulacrum dies — Bot draws 1');
    expect(r.final.hand.map(c => c.name)).toContain('Drawn by Solemn');
    expect(r.final.battlefield.map(p => p.card.name)).not.toContain('Solemn Simulacrum');
  });
});
