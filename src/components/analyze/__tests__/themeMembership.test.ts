import { describe, it, expect } from 'vitest';
import type { EDHRECCommanderData } from '@/types';
import { buildThemeMembership, isLiteralThemeMember } from '../themeMembership';
import type { ThemeFit } from '@/services/deckBuilder/themeFit';

const LANDFALL = { slug: 'landfall', name: 'Landfall' };
const ELVES = { slug: 'elves', name: 'Elves' };

/** An EDHREC theme page listing exactly these non-land cards. */
function pageWith(names: string[]): EDHRECCommanderData {
  return {
    cardlists: { allNonLand: names.map(name => ({ name })), lands: [] },
  } as unknown as EDHRECCommanderData;
}

/** Classifier fit for Landfall: Scute Swarm proved membership from its own keyword. */
const landfallFit: ThemeFit = {
  themes: [LANDFALL],
  byCard: new Map([
    ['scute swarm', { indices: [0], basis: 'literal' as const, matched: ['landfall'] }],
  ]),
};

describe('buildThemeMembership', () => {
  it('keeps EDHREC page membership when no classifier fit is supplied', () => {
    const m = buildThemeMembership(LANDFALL, null,
      new Map([['landfall', pageWith(['Loot, Exuberant Explorer'])]]));

    expect(m.byCard.get('loot, exuberant explorer')).toEqual([0]);
    expect(m.basisByCard.get('loot, exuberant explorer')).toBe('edhrec');
  });

  it('adds classifier members the EDHREC page never listed', () => {
    const m = buildThemeMembership(LANDFALL, null,
      new Map([['landfall', pageWith(['Loot, Exuberant Explorer'])]]), landfallFit);

    expect(m.byCard.get('scute swarm')).toEqual([0]);
    expect(m.basisByCard.get('scute swarm')).toBe('literal');
    // Union, not replacement: the enabler EDHREC knows about is still a member.
    expect(m.byCard.get('loot, exuberant explorer')).toEqual([0]);
  });

  it('lets literal evidence win for a card present in both sources', () => {
    const m = buildThemeMembership(LANDFALL, null,
      new Map([['landfall', pageWith(['Scute Swarm'])]]), landfallFit);

    expect(m.byCard.get('scute swarm')).toEqual([0]);
    expect(m.basisByCard.get('scute swarm')).toBe('literal');
  });

  it('does not duplicate a theme index for a card in both sources', () => {
    const m = buildThemeMembership(LANDFALL, null,
      new Map([['landfall', pageWith(['Scute Swarm'])]]), landfallFit);
    expect(m.byCard.get('scute swarm')).toEqual([0]);
  });

  it('maps classifier indices through to the selected-theme order', () => {
    // The fit knows only Elves (its own index 0), but Elves is the SECONDARY theme here, so the
    // membership index must be 1. Matching on slug rather than index is what makes this hold.
    const elfFit: ThemeFit = {
      themes: [ELVES],
      byCard: new Map([
        ['llanowar elves', { indices: [0], basis: 'literal' as const, matched: ['elf'] }],
      ]),
    };
    const m = buildThemeMembership(LANDFALL, ELVES, new Map(), elfFit);

    expect(m.themes).toEqual([LANDFALL, ELVES]);
    expect(m.byCard.get('llanowar elves')).toEqual([1]);
  });

  it('ignores a fit whose theme is not selected', () => {
    const m = buildThemeMembership(ELVES, null, new Map(), landfallFit);
    expect(m.byCard.size).toBe(0);
  });
});

describe('isLiteralThemeMember', () => {
  const m = buildThemeMembership(LANDFALL, null,
    new Map([['landfall', pageWith(['Loot, Exuberant Explorer'])]]), landfallFit);

  it('is true for a literal member', () => {
    expect(isLiteralThemeMember(m, 'Scute Swarm')).toBe(true);
  });

  it('is false for an EDHREC-only member — page presence is not proof', () => {
    expect(isLiteralThemeMember(m, 'Loot, Exuberant Explorer')).toBe(false);
  });

  it('is false for a card in no theme, and for a null membership', () => {
    expect(isLiteralThemeMember(m, 'Random Card')).toBe(false);
    expect(isLiteralThemeMember(null, 'Scute Swarm')).toBe(false);
  });

  it('resolves a DFC written as either face', () => {
    const dfcFit: ThemeFit = {
      themes: [LANDFALL],
      byCard: new Map([
        ['front // back', { indices: [0], basis: 'literal' as const, matched: ['landfall'] }],
        ['front', { indices: [0], basis: 'literal' as const, matched: ['landfall'] }],
      ]),
    };
    const dfc = buildThemeMembership(LANDFALL, null, new Map(), dfcFit);
    expect(isLiteralThemeMember(dfc, 'Front // Back')).toBe(true);
    expect(isLiteralThemeMember(dfc, 'Front')).toBe(true);
  });
});
