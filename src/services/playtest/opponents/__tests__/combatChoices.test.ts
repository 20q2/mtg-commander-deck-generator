import { describe, it, expect } from 'vitest';
import {
  chooseAttackTarget, chooseAttackers, chooseBlocks,
  type AttackCandidate,
} from '@/services/playtest/opponents/combatChoices';
import type { Combatant } from '@/services/playtest/combat';

/**
 * Combat decisions, in both directions.
 *
 * Every case here is something a real game showed going wrong. The blocking
 * ones especially: the original single pass took a block only when the blocker
 * killed the attacker AND survived it, so an untapped deathtouch flier watched
 * a 6/6 walk past it and a 2/5 took three to the face rather than blocking a
 * 3/3 it comfortably lived through.
 *
 * Thresholds are asserted on purpose — they are the behaviour, and moving one
 * should be a change somebody meant to make.
 */

let n = 0;
const c = (o: Partial<Combatant> & { power: number; toughness: number }): Combatant => ({
  instanceId: `c${n++}`,
  name: 'creature',
  keywords: new Set(),
  ...o,
});
const kw = (...k: string[]) => new Set(k) as Combatant['keywords'];

/** Which attackers ended up blocked, by name. */
const blockedNames = (blocks: Record<string, string[]>, attackers: Combatant[]) =>
  attackers.filter(a => (blocks[a.instanceId] ?? []).length > 0).map(a => a.name);

describe('chooseBlocks', () => {
  it('takes the free block: kills the attacker and lives', () => {
    const atk = c({ name: 'Bear', power: 2, toughness: 2 });
    const wall = c({ name: 'Guard', power: 4, toughness: 4 });
    const blocks = chooseBlocks({ attackers: [atk], blockers: [wall], life: 40 });
    expect(blocks[atk.instanceId]).toEqual([wall.instanceId]);
  });

  it('trades a deathtouch blocker for a much bigger attacker', () => {
    // The exact board from a real game: Dimir held an untapped Nighthawk
    // Scavenger and took six to the face from a 6/6 instead of eating it.
    const morophon = c({ name: 'Morophon', power: 6, toughness: 6 });
    const nighthawk = c({
      name: 'Nighthawk Scavenger', power: 1, toughness: 3,
      keywords: kw('flying', 'deathtouch'),
    });
    const blocks = chooseBlocks({ attackers: [morophon], blockers: [nighthawk], life: 40 });
    expect(blocks[morophon.instanceId]).toEqual([nighthawk.instanceId]);
  });

  it('refuses a trade that loses value', () => {
    // A 5/5 eating a 1/1's block is the player's dream, not the bot's.
    const small = c({ name: 'Pest', power: 1, toughness: 1 });
    const big = c({ name: 'Titan', power: 5, toughness: 5 });
    const blocks = chooseBlocks({ attackers: [small], blockers: [big], life: 40 });
    // The 5/5 survives, so it should absorb rather than be spent — but either
    // way it must not die for a 1/1.
    expect(blocks[small.instanceId]).toEqual([big.instanceId]);

    const doomed = c({ name: 'Squire', power: 1, toughness: 1 });
    const bigAtk = c({ name: 'Wurm', power: 5, toughness: 5 });
    const b2 = chooseBlocks({ attackers: [bigAtk], blockers: [doomed], life: 40 });
    expect(b2[bigAtk.instanceId] ?? []).toEqual([]);
  });

  it('absorbs with a blocker that survives but kills nothing', () => {
    const atk = c({ name: 'Knight', power: 3, toughness: 3 });
    const trostani = c({ name: 'Trostani', power: 2, toughness: 5 });
    const blocks = chooseBlocks({ attackers: [atk], blockers: [trostani], life: 40 });
    expect(blocks[atk.instanceId]).toEqual([trostani.instanceId]);
  });

  it('aggression moves the bar on a marginal trade', () => {
    // Attacker worth 6, blocker worth 4. Reckless takes it (needs 1.3x),
    // cautious does not (needs 2.7x).
    const atk = c({ name: 'Brute', power: 3, toughness: 3 });
    const blocker = () => c({ name: 'Scout', power: 3, toughness: 1 });

    const reckless = blocker();
    expect(chooseBlocks({
      attackers: [atk], blockers: [reckless], life: 40, aggression: 0.85,
    })[atk.instanceId]).toEqual([reckless.instanceId]);

    const cautious = blocker();
    expect(chooseBlocks({
      attackers: [atk], blockers: [cautious], life: 40, aggression: 0.15,
    })[atk.instanceId] ?? []).toEqual([]);
  });

  it('chumps only when the damage coming is lethal', () => {
    const atk = c({ name: 'Wurm', power: 9, toughness: 9 });
    const chump = () => c({ name: 'Elf', power: 1, toughness: 1 });

    const safe = chump();
    expect(chooseBlocks({ attackers: [atk], blockers: [safe], life: 40 })[atk.instanceId] ?? [])
      .toEqual([]);

    const desperate = chump();
    expect(chooseBlocks({ attackers: [atk], blockers: [desperate], life: 5 })[atk.instanceId])
      .toEqual([desperate.instanceId]);
  });

  it('spends the cheapest body that does the job', () => {
    const atk = c({ name: 'Bear', power: 2, toughness: 2 });
    const cheap = c({ name: 'Cheap', power: 2, toughness: 3 });
    const dear = c({ name: 'Dear', power: 8, toughness: 8 });
    const blocks = chooseBlocks({ attackers: [atk], blockers: [dear, cheap], life: 40 });
    expect(blocks[atk.instanceId]).toEqual([cheap.instanceId]);
  });

  it('does not block a creature with no power', () => {
    const atk = c({ name: 'Ornithopter', power: 0, toughness: 2 });
    const wall = c({ name: 'Wall', power: 0, toughness: 6 });
    const blocks = chooseBlocks({ attackers: [atk], blockers: [wall], life: 40 });
    expect(blockedNames(blocks, [atk])).toEqual([]);
  });
});

describe('chooseAttackers', () => {
  const swarm = (count: number) =>
    Array.from({ length: count }, () => c({ name: 'Goblin', power: 1, toughness: 1 }));

  it('sends everything when the swarm is lethal through any block', () => {
    const ids = chooseAttackers({
      candidates: swarm(30),
      blockers: [c({ name: 'Guard', power: 2, toughness: 2 })],
      playerLife: 10, aggression: 0.5, botLife: 40,
    });
    expect(ids).toHaveLength(30);
  });

  it('keeps defence home when the swing back would hurt', () => {
    // 4/4s happily attack into 3/3s, so they all want to go. Twelve power
    // coming back at a bot on 20 is what makes it keep some of them home.
    const mine = Array.from({ length: 4 }, () => c({ name: 'Ogre', power: 4, toughness: 4 }));
    const theirs = Array.from({ length: 4 }, () => c({ name: 'Bear', power: 3, toughness: 3 }));
    const ids = chooseAttackers({
      candidates: mine, blockers: theirs, playerLife: 40, aggression: 0.5, botLife: 20,
    });
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThan(mine.length);
  });

  it('sends everything when nothing is coming back', () => {
    const mine = Array.from({ length: 4 }, () => c({ name: 'Ogre', power: 4, toughness: 4 }));
    const ids = chooseAttackers({
      candidates: mine, blockers: [], playerLife: 40, aggression: 0.5, botLife: 20,
    });
    expect(ids).toHaveLength(4);
  });

  it('never holds back a vigilant creature', () => {
    const vigilant = c({ name: 'Sentry', power: 4, toughness: 4, keywords: kw('vigilance') });
    const plain = () => c({ name: 'Ogre', power: 4, toughness: 4 });
    const mine = [vigilant, plain(), plain(), plain()];
    const theirs = Array.from({ length: 4 }, () => c({ name: 'Bear', power: 3, toughness: 3 }));
    const ids = chooseAttackers({
      candidates: mine, blockers: theirs, playerLife: 40, aggression: 0.5, botLife: 20,
    });
    expect(ids).toContain(vigilant.instanceId);
  });

  it('a reckless bot holds back less than a cautious one', () => {
    const mine = () => Array.from({ length: 6 }, () => c({ name: 'Ogre', power: 4, toughness: 4 }));
    const theirs = () => Array.from({ length: 4 }, () => c({ name: 'Bear', power: 3, toughness: 3 }));
    const at = (aggression: number) => chooseAttackers({
      candidates: mine(), blockers: theirs(), playerLife: 40, aggression, botLife: 20,
    }).length;
    expect(at(0.85)).toBeGreaterThan(at(0.15));
  });
});

describe('chooseAttackTarget', () => {
  const seat = (o: Partial<AttackCandidate>): AttackCandidate => ({
    id: 'r1', name: 'Rival', life: 40, untappedCreatures: [], threat: 0, ...o,
  });
  const you = (o: Partial<AttackCandidate> = {}) => seat({ id: null, name: 'you', ...o });

  it('attacks the player when no rival is threatening or killable', () => {
    expect(chooseAttackTarget(you({ threat: 4 }), [seat({})]).id).toBeNull();
  });

  it('turns on the biggest threat at the table', () => {
    // This is the case that matters most. Three bots building unopposed boards
    // used to gang the player forever — twenty attacks out of twenty in a real
    // game — because the player was permanently the softest seat. Threat is what
    // makes them turn on each other instead.
    const menace = seat({ id: 'big', threat: 30 });
    expect(chooseAttackTarget(you({ threat: 4 }), [menace]).id).toBe('big');
  });

  it('finishes off a seat it can kill', () => {
    // Ten power available against a rival on four life: take the win.
    const nearlyDead = seat({ id: 'weak', life: 4, threat: 0 });
    expect(chooseAttackTarget(you({ life: 40, threat: 6 }), [nearlyDead], 10).id).toBe('weak');
  });

  it('does not chase a low-life seat it cannot actually kill', () => {
    const nearlyDead = seat({ id: 'weak', life: 4, threat: 0 });
    // No attackers, so no kill on offer, and an empty board is no threat.
    expect(chooseAttackTarget(you({ life: 40, threat: 6 }), [nearlyDead], 0).id).toBeNull();
  });

  it('comes back for the player once the player is the threat', () => {
    const quiet = seat({ id: 'quiet', threat: 2 });
    expect(chooseAttackTarget(you({ threat: 25 }), [quiet]).id).toBeNull();
  });

  it('treats blockers as a reason to look elsewhere', () => {
    const guarded = seat({
      id: 'guarded', threat: 20,
      untappedCreatures: Array.from({ length: 10 }, () => c({ name: 'Guard', power: 2, toughness: 2 })),
    });
    const open = seat({ id: 'open', threat: 14 });
    expect(chooseAttackTarget(you({ threat: 2 }), [guarded, open]).id).toBe('open');
  });

  it('never swings at a seat already at zero', () => {
    const dead = seat({ id: 'dead', life: 0, threat: 40 });
    const alive = seat({ id: 'alive', life: 30, threat: 10 });
    expect(chooseAttackTarget(you({ threat: 2 }), [dead, alive]).id).toBe('alive');
  });

  it('stops beating the player once the player is dead', () => {
    // The other half of the same problem: a player two hundred life down was
    // still being attacked every turn, which is both pointless and absurd.
    const rival = seat({ id: 'r', life: 30, threat: 8 });
    expect(chooseAttackTarget(you({ life: -12, threat: 0 }), [rival]).id).toBe('r');
  });

  it('picks the most threatening of several rivals', () => {
    const target = chooseAttackTarget(you({ threat: 3 }), [
      seat({ id: 'a', threat: 6 }),
      seat({ id: 'b', threat: 22 }),
      seat({ id: 'c', threat: 11 }),
    ]);
    expect(target.id).toBe('b');
  });
});
