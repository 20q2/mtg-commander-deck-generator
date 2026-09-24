import { describe, it, expect } from 'vitest';
import { keywordsOf, resolveDamage, type Combatant } from '@/services/playtest/combat';
import { chooseAttackers, chooseBlocks, killsIt } from '@/services/playtest/opponents/combatChoices';
import { resolveEffect, type PlayerBoardRead, type PlayerCardRead } from '@/services/playtest/opponents/evaluate';
import type { BotEffectSpec } from '@/services/playtest/opponents/effects';
import type { ScryfallCard } from '@/types';

/**
 * Indestructible and hexproof, in the three places a bot meets them: the damage
 * maths, its combat decisions, and where it points its removal.
 *
 * The two fail differently, and every case below exists to hold that line.
 * Hexproof stops the spell being cast at all, so the bot has to look elsewhere
 * or hold the card. Indestructible lets it resolve and do nothing — but only
 * against *some* effects: exile, an edict and a -X/-X sweeper all still get the
 * creature, and a bot that treats indestructible as "untouchable" throws away
 * the answers it actually has.
 */

let n = 0;
const c = (o: Partial<Combatant> & { power: number; toughness: number }): Combatant => ({
  instanceId: `c${n++}`,
  name: 'creature',
  keywords: new Set(),
  ...o,
});
const kw = (...k: string[]) => new Set(k) as Combatant['keywords'];

const cardRead = (o: Partial<PlayerCardRead> & { name: string }): PlayerCardRead => ({
  instanceId: `r${n++}`,
  isCreature: true,
  isArtifact: false,
  isLand: false,
  power: 2,
  toughness: 2,
  isCommander: false,
  comboId: null,
  ...o,
});

const board = (cards: PlayerCardRead[], over: Partial<PlayerBoardRead> = {}): PlayerBoardRead => ({
  cards, life: 40, handSize: 3, untappedCreatures: [], ...over,
});

/** The name the spec landed on, or null if it found nothing worth doing. */
function hit(spec: BotEffectSpec, b: PlayerBoardRead): string | null {
  return resolveEffect(spec, b)?.target ?? null;
}

describe('resolveDamage — indestructible', () => {
  it('survives a blocker that would otherwise kill it outright', () => {
    const atk = c({ name: 'Avacyn', power: 6, toughness: 5, keywords: kw('indestructible') });
    const wall = c({ name: 'Titan', power: 8, toughness: 8 });
    const out = resolveDamage([atk], { [atk.instanceId]: [wall] });
    expect(out.deadAttackers).toEqual([]);
    expect(out.deadBlockers).toEqual([]);
  });

  it('shrugs off deathtouch', () => {
    // Deathtouch is the other way this function kills, so it needs its own case.
    const atk = c({ name: 'Ohran Viper', power: 1, toughness: 1, keywords: kw('deathtouch') });
    const wall = c({ name: 'Darksteel Myr', power: 0, toughness: 1, keywords: kw('indestructible') });
    const out = resolveDamage([atk], { [atk.instanceId]: [wall] });
    expect(out.deadBlockers).toEqual([]);
  });

  it('still lets a trampler through after assigning lethal to it', () => {
    // Trample checks toughness, not survival: the 3 that the indestructible
    // 3/3 soaks is gone whether or not it dies.
    const atk = c({ name: 'Ghalta', power: 12, toughness: 12, keywords: kw('trample') });
    const wall = c({ name: 'Wall', power: 0, toughness: 3, keywords: kw('indestructible') });
    const out = resolveDamage([atk], { [atk.instanceId]: [wall] });
    expect(out.damageToDefender).toBe(9);
    expect(out.deadBlockers).toEqual([]);
  });
});

describe('keywordsOf', () => {
  const card = (keywords: string[]) =>
    ({ name: 'x', keywords } as unknown as ScryfallCard);

  it('reads shroud as hexproof', () => {
    // The difference is whether the controller can target it, and nothing here
    // ever targets its own permanents.
    expect(keywordsOf(card(['Shroud'])).has('hexproof')).toBe(true);
  });

  it('does not read ward as hexproof', () => {
    expect(keywordsOf(card(['Ward'])).has('hexproof')).toBe(false);
  });

  it('loses both to a creature stripped of its abilities', () => {
    const stripped = keywordsOf(card(['Indestructible', 'Hexproof']), { loseAbilities: true });
    expect(stripped.size).toBe(0);
  });
});

describe('bot combat decisions', () => {
  it('killsIt says no against indestructible, deathtouch included', () => {
    const dealer = c({ name: 'Snake', power: 1, toughness: 1, keywords: kw('deathtouch') });
    const target = c({ name: 'Avacyn', power: 6, toughness: 5, keywords: kw('indestructible') });
    expect(killsIt(dealer, target)).toBe(false);
  });

  it('blocks a huge attacker with an indestructible wall for free', () => {
    const atk = c({ name: 'Ghalta', power: 12, toughness: 12 });
    const wall = c({ name: 'Darksteel Myr', power: 0, toughness: 1, keywords: kw('indestructible') });
    const blocks = chooseBlocks({ attackers: [atk], blockers: [wall], life: 40 });
    // A 0/1 in front of a 12/12 is a chump block for any other creature; this
    // one walks away, so it is the free block in pass 1's sense.
    expect(blocks[atk.instanceId]).toEqual([wall.instanceId]);
  });

  it('will not spend a creature trading with an indestructible attacker', () => {
    // A 5/5 into a 3/3 indestructible is pure loss: the bot dies, the attacker
    // does not. Before `killsIt` knew the keyword this read as a fine trade.
    const atk = c({ name: 'Stuffy Doll', power: 5, toughness: 5, keywords: kw('indestructible') });
    const body = c({ name: 'Bear', power: 5, toughness: 2 });
    const blocks = chooseBlocks({ attackers: [atk], blockers: [body], life: 40, aggression: 1 });
    expect(blocks[atk.instanceId] ?? []).toEqual([]);
  });

  it('still chumps an indestructible attacker when the alternative is dying', () => {
    const atk = c({ name: 'Ghalta', power: 12, toughness: 12, keywords: kw('indestructible') });
    const body = c({ name: 'Bear', power: 2, toughness: 2 });
    const blocks = chooseBlocks({ attackers: [atk], blockers: [body], life: 5 });
    expect(blocks[atk.instanceId]).toEqual([body.instanceId]);
  });

  it('attacks into a bigger blocker with an indestructible creature', () => {
    const me = c({ name: 'Avacyn', power: 3, toughness: 3, keywords: kw('indestructible') });
    const theirs = c({ name: 'Titan', power: 8, toughness: 8 });
    const ids = chooseAttackers({
      candidates: [me], blockers: [theirs], playerLife: 40, aggression: 0, botLife: 40,
    });
    expect(ids).toEqual([me.instanceId]);
  });
});

describe('bot targeting — hexproof', () => {
  const murder: BotEffectSpec = { kind: 'destroyCreature' };

  it('skips a hexproof creature for the next best target', () => {
    const b = board([
      cardRead({ name: 'Sigarda', power: 5, toughness: 5, hexproof: true }),
      cardRead({ name: 'Bear', power: 2, toughness: 2 }),
    ]);
    expect(hit(murder, b)).toBe('Bear');
  });

  it('holds the card when every creature is hexproof', () => {
    const b = board([cardRead({ name: 'Sigarda', power: 5, toughness: 5, hexproof: true })]);
    expect(hit(murder, b)).toBeNull();
  });

  it('does not exile one either — hexproof is about targeting, not destruction', () => {
    const b = board([cardRead({ name: 'Sigarda', power: 5, toughness: 5, hexproof: true })]);
    expect(hit({ kind: 'exileCreature' }, b)).toBeNull();
  });

  it('sends a burn spell upstairs rather than at an untargetable creature', () => {
    const b = board([cardRead({ name: 'Sigarda', power: 5, toughness: 1, hexproof: true })]);
    expect(hit({ kind: 'damage', amount: 3 }, b)).toBe('you');
  });

  it('breaks a combo through its untargetable half', () => {
    // The two-piece rule counts the real board: a hexproof piece must not hide
    // the piece the bot can actually answer.
    const b = board([
      cardRead({ name: 'Thassa', power: 1, toughness: 1, comboId: 'k', hexproof: true }),
      cardRead({ name: 'Peregrine Drake', power: 2, toughness: 3, comboId: 'k' }),
      cardRead({ name: 'Titan', power: 9, toughness: 9 }),
    ]);
    expect(hit(murder, b)).toBe('Peregrine Drake');
  });
});

describe('bot targeting — indestructible', () => {
  it('destroy skips it, exile takes it', () => {
    const b = board([cardRead({ name: 'Avacyn', power: 8, toughness: 8, indestructible: true })]);
    expect(hit({ kind: 'destroyCreature' }, b)).toBeNull();
    expect(hit({ kind: 'exileCreature' }, b)).toBe('Avacyn');
  });

  it('destroyPermanent leaves an indestructible artifact alone', () => {
    const b = board([
      cardRead({ name: 'Darksteel Forge', isCreature: false, isArtifact: true, power: 0, toughness: 0, indestructible: true }),
      cardRead({ name: 'Sol Ring', isCreature: false, isArtifact: true, power: 0, toughness: 0 }),
    ]);
    expect(hit({ kind: 'destroyPermanent' }, b)).toBe('Sol Ring');
    expect(hit({ kind: 'artifactSweep' }, b)).toBe('1 artifact');
  });

  it('a plain wrath passes it by; a -X/-X wrath does not', () => {
    const b = board([
      cardRead({ name: 'Avacyn', power: 8, toughness: 8, indestructible: true }),
      cardRead({ name: 'Myr', power: 1, toughness: 2, indestructible: true }),
      cardRead({ name: 'Bear', power: 2, toughness: 2 }),
    ]);
    // Damnation only gets the Bear.
    expect(hit({ kind: 'boardWipe' }, b)).toBe('1 creature');
    // Languish gets the Myr and the Bear: zero toughness is not destruction.
    expect(hit({ kind: 'boardWipe', maxToughness: 4 }, b)).toBe('2 creatures');
  });

  it('an edict gets through both protections', () => {
    // This is the reason an edict is the right card against such a board, and
    // the reason nothing is filtered out of that branch.
    const b = board([
      cardRead({ name: 'Avacyn', power: 8, toughness: 8, indestructible: true, hexproof: true }),
    ]);
    expect(hit({ kind: 'edict' }, b)).toBe('Avacyn');
  });

  it('burn picks the creature it can actually kill', () => {
    const b = board([
      cardRead({ name: 'Myr', power: 4, toughness: 1, indestructible: true }),
      cardRead({ name: 'Bear', power: 2, toughness: 2 }),
    ]);
    expect(hit({ kind: 'damage', amount: 3 }, b)).toBe('Bear');
  });
});
