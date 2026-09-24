import { describe, it, expect } from 'vitest';
import { resolveDamage, type Combatant } from '@/services/playtest/combat';

/**
 * `damageByAttacker` exists so combat can be paced out one creature at a time,
 * and the store now takes life off per attacker rather than in one lump. That
 * makes the split load-bearing: if it stops summing to `damageToDefender`, the
 * life total silently stops matching the number the Deal button promised, and
 * nothing else in the app would notice.
 */

let n = 0;
const c = (o: Partial<Combatant> & { power: number; toughness: number }): Combatant => ({
  instanceId: `c${n++}`,
  name: 'creature',
  keywords: new Set(),
  ...o,
});
const kw = (...k: string[]) => new Set(k) as Combatant['keywords'];

const total = (by: Record<string, number>) => Object.values(by).reduce((a, b) => a + b, 0);

describe('damageByAttacker', () => {
  it('splits unblocked damage by the creature that dealt it', () => {
    const a = c({ power: 3, toughness: 3 });
    const b = c({ power: 5, toughness: 5 });
    const out = resolveDamage([a, b], {});

    expect(out.damageToDefender).toBe(8);
    expect(out.damageByAttacker).toEqual({ [a.instanceId]: 3, [b.instanceId]: 5 });
  });

  it('credits trample overflow to the trampler, not the blocker it went through', () => {
    const trampler = c({ power: 7, toughness: 7, keywords: kw('trample') });
    const clear = c({ power: 2, toughness: 2 });
    const chump = c({ power: 0, toughness: 2 });
    const out = resolveDamage([trampler, clear], { [trampler.instanceId]: [chump] });

    // 7 power, 2 eaten by the chump, 5 over the top — plus the unblocked 2.
    expect(out.damageByAttacker[trampler.instanceId]).toBe(5);
    expect(out.damageByAttacker[clear.instanceId]).toBe(2);
    expect(total(out.damageByAttacker)).toBe(out.damageToDefender);
  });

  it('gives a double striker both of its hits', () => {
    const a = c({ power: 4, toughness: 4, keywords: kw('doubleStrike') });
    const out = resolveDamage([a], {});

    expect(out.damageToDefender).toBe(8);
    expect(out.damageByAttacker[a.instanceId]).toBe(8);
  });

  it('leaves out an attacker that never reached the defender', () => {
    const blocked = c({ power: 3, toughness: 3 });
    const wall = c({ power: 0, toughness: 6 });
    const out = resolveDamage([blocked], { [blocked.instanceId]: [wall] });

    expect(out.damageToDefender).toBe(0);
    expect(out.damageByAttacker[blocked.instanceId]).toBeUndefined();
  });

  it('never credits negative damage to a shrunken attacker', () => {
    // A -3/-0 on a 2/2 leaves it with negative power. Nothing in MTG lets a
    // creature heal the player it is attacking, and the split must not either —
    // the aggregate used to go DOWN by 1 here, which quietly refunded the
    // defender a point of the other attacker's damage.
    const shrunk = c({ power: -1, toughness: 2 });
    const real = c({ power: 4, toughness: 4 });
    const out = resolveDamage([shrunk, real], {});

    expect(out.damageToDefender).toBe(4);
    expect(out.damageByAttacker[shrunk.instanceId]).toBeUndefined();
    expect(total(out.damageByAttacker)).toBe(out.damageToDefender);
  });
});
