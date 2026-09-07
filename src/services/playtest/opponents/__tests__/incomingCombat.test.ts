import { describe, it, expect } from 'vitest';
import { incomingDamage, readIncomingCombat } from '@/services/playtest/opponents/incomingCombat';
import type { CombatState, Opponent, OpponentPermanent } from '@/components/playtest/opponentTypes';
import type { BattlefieldCard } from '@/components/playtest/types';
import type { ScryfallCard } from '@/types';

/**
 * The number on the "Take N" button, and who is actually still attacking.
 *
 * Both used to be read off the snapshot the bot declared from, computed a
 * different way from the resolution itself. So the button could lie twice over:
 * it summed unblocked power and ignored trample overflow, and it kept counting
 * an attacker you had already killed.
 */

let n = 0;
function card(p: Partial<ScryfallCard> & { name: string }): ScryfallCard {
  return {
    id: `card${n++}`, type_line: p.type_line ?? 'Creature — Beast',
    cmc: p.cmc ?? 1, oracle_text: '', keywords: p.keywords ?? [],
    color_identity: [], colors: [], legalities: {}, set: 'tst', rarity: 'common',
    ...p,
  } as unknown as ScryfallCard;
}

const botPerm = (c: ScryfallCard, over: Partial<OpponentPermanent> = {}): OpponentPermanent =>
  ({ instanceId: `bp${n++}`, card: c, tapped: false, summoningSick: false, counters: {}, ...over });

const myCard = (c: ScryfallCard, over: Partial<BattlefieldCard> = {}): BattlefieldCard =>
  ({
    instanceId: `mine${n++}`, card: c, x: 0, y: 0,
    tapped: false, faceDown: false, flipped: false, counters: {}, ...over,
  });

function bot(battlefield: OpponentPermanent[]): Opponent {
  return {
    id: 'bot1', name: 'Bot', stubId: null, blurb: '', colors: [], life: 40,
    library: [], hand: [], graveyard: [], exile: [], command: [],
    commanderName: null, commanderCasts: 0, tokens: [], battlefield,
    decked: false, resistance: false, aggression: 0.5, turnsTaken: 0,
  };
}

/** Build the combat state the store would, from a bot's permanents. */
function combatOf(attackers: OpponentPermanent[], blocks: Record<string, string[]> = {}): CombatState {
  return {
    opponentId: 'bot1',
    opponentName: 'Bot',
    attackers: attackers.map(p => ({
      instanceId: p.instanceId,
      card: p.card,
      power: parseInt(p.card.power ?? '0', 10),
      toughness: parseInt(p.card.toughness ?? '0', 10),
    })),
    blocks,
  };
}

describe('incomingDamage', () => {
  it('counts trample overflow past a chump block', () => {
    const trampler = botPerm(card({
      name: 'Wurm', power: '10', toughness: '10', keywords: ['Trample'],
    }));
    const chump = myCard(card({ name: 'Elf', power: '1', toughness: '1' }));
    const combat = combatOf([trampler], { [trampler.instanceId]: [chump.instanceId] });

    // The old sum-of-unblocked-power read this as zero and said "Resolve".
    expect(incomingDamage(combat, bot([trampler]), [chump])).toBe(9);
  });

  it('a blocked non-trampler still gets through for nothing', () => {
    const ogre = botPerm(card({ name: 'Ogre', power: '10', toughness: '10' }));
    const chump = myCard(card({ name: 'Elf', power: '1', toughness: '1' }));
    const combat = combatOf([ogre], { [ogre.instanceId]: [chump.instanceId] });
    expect(incomingDamage(combat, bot([ogre]), [chump])).toBe(0);
  });

  it('sums what is unblocked', () => {
    const a = botPerm(card({ name: 'Bear', power: '2', toughness: '2' }));
    const b = botPerm(card({ name: 'Bear', power: '3', toughness: '3' }));
    const combat = combatOf([a, b]);
    expect(incomingDamage(combat, bot([a, b]), [])).toBe(5);
  });

  it('stops counting an attacker that is no longer on their board', () => {
    const kept = botPerm(card({ name: 'Bear', power: '2', toughness: '2' }));
    const killed = botPerm(card({ name: 'Ogre', power: '7', toughness: '7' }));
    const combat = combatOf([kept, killed]);

    expect(incomingDamage(combat, bot([kept, killed]), [])).toBe(9);
    // You destroyed the Ogre while combat was open.
    expect(incomingDamage(combat, bot([kept]), [])).toBe(2);
  });

  it('reads the attacker\'s live power, not the declared snapshot', () => {
    const pumped = botPerm(
      card({ name: 'Bear', power: '2', toughness: '2' }),
      { counters: { '+1/+1': 3 } },
    );
    const combat = combatOf([pumped]);
    // The snapshot in `combat.attackers` says 2; the board says 5.
    expect(combat.attackers[0].power).toBe(2);
    expect(incomingDamage(combat, bot([pumped]), [])).toBe(5);
  });

  it('is zero when the whole attack is gone', () => {
    const gone = botPerm(card({ name: 'Bear', power: '4', toughness: '4' }));
    expect(incomingDamage(combatOf([gone]), bot([]), [])).toBe(0);
  });
});

describe('readIncomingCombat', () => {
  it('drops attackers that left the board from the render list', () => {
    const kept = botPerm(card({ name: 'Bear', power: '2', toughness: '2' }));
    const killed = botPerm(card({ name: 'Ogre', power: '7', toughness: '7' }));
    const { live } = readIncomingCombat(combatOf([kept, killed]), bot([kept]), []);
    expect(live.map(a => a.card.name)).toEqual(['Bear']);
  });

  it('drops blockers that left the board', () => {
    const atk = botPerm(card({ name: 'Bear', power: '2', toughness: '2' }));
    const blocker = myCard(card({ name: 'Wall', power: '0', toughness: '4' }));
    const combat = combatOf([atk], { [atk.instanceId]: [blocker.instanceId] });

    // Blocker present: nothing through.
    expect(incomingDamage(combat, bot([atk]), [blocker])).toBe(0);
    // Blocker gone (bounced, sacrificed): the attacker is still *blocked*, which
    // is the rule — an attacker with an assignment deals no damage to you even
    // if every creature in front of it has left.
    const { blocks } = readIncomingCombat(combat, bot([atk]), []);
    expect(blocks[atk.instanceId]).toEqual([]);
  });

  it('survives a missing opponent without throwing', () => {
    const atk = botPerm(card({ name: 'Bear', power: '2', toughness: '2' }));
    const { live, attackers } = readIncomingCombat(combatOf([atk]), undefined, []);
    expect(live).toEqual([]);
    expect(attackers).toEqual([]);
  });
});
