import { describe, it, expect } from 'vitest';
import { takeTurn } from '@/services/playtest/opponents/engine';
import { applyTaps, genericCost, manaFrom, planPayment, requirementFor } from '@/services/playtest/opponents/mana';
import type { PlayerBoardRead } from '@/services/playtest/opponents/evaluate';
import type { Opponent, OpponentPermanent } from '@/components/playtest/opponentTypes';
import type { ScryfallCard } from '@/types';

/**
 * Coloured mana. The bug these exist for was visible at the table: a Dimir bot
 * tapping two Islands to cast a black spell.
 *
 * Synthetic cards, deliberately without `produced_mana` on the basics, because
 * that is the shape trimmed card data arrives in — the type line has to be
 * enough to tell a Swamp from an Island.
 */

let n = 0;
function card(p: Partial<ScryfallCard> & { name: string }): ScryfallCard {
  return {
    id: `c${n++}`, type_line: p.type_line ?? 'Creature — Zombie',
    cmc: p.cmc ?? 1, oracle_text: p.oracle_text ?? '', keywords: [],
    color_identity: [], colors: [], legalities: {}, set: 'tst', rarity: 'common',
    ...p,
  } as unknown as ScryfallCard;
}
const basic = (name: string) => card({ name, type_line: `Basic Land — ${name}`, cmc: 0 });
const perm = (c: ScryfallCard, over: Partial<OpponentPermanent> = {}): OpponentPermanent =>
  ({ instanceId: `p${n++}`, card: c, tapped: false, summoningSick: false, counters: {}, ...over });

const tappedNames = (bf: OpponentPermanent[], taps: number[]) =>
  applyTaps(bf, taps).filter(p => p.tapped).map(p => p.card.name).sort();

function bot(over: Partial<Opponent> = {}): Opponent {
  return {
    id: 'b1', name: 'Bot', stubId: null, blurb: '', colors: ['B'], life: 40,
    library: [], hand: [], graveyard: [], exile: [], command: [],
    commanderName: null, commanderCasts: 0, tokens: [], battlefield: [],
    decked: false, resistance: false, aggression: 0.5, turnsTaken: 0, ...over,
  };
}
const board = (): PlayerBoardRead => ({ cards: [], life: 40, handSize: 0, untappedCreatures: [] });

describe('coloured mana', () => {
  it('will not pay a black pip with Islands', () => {
    const bf = [perm(basic('Island')), perm(basic('Island')), perm(basic('Island'))];
    const spell = card({ name: 'Doom Blade', type_line: 'Instant', cmc: 2, mana_cost: '{1}{B}' });
    expect(planPayment(bf, requirementFor(spell, 2)).paid).toBe(false);
  });

  it('pays it once a Swamp is down, tapping the Swamp for the pip', () => {
    const bf = [perm(basic('Island')), perm(basic('Swamp'))];
    const spell = card({ name: 'Doom Blade', type_line: 'Instant', cmc: 2, mana_cost: '{1}{B}' });
    const plan = planPayment(bf, requirementFor(spell, 2));
    expect(plan.paid).toBe(true);
    expect(tappedNames(bf, plan.taps)).toEqual(['Island', 'Swamp']);
  });

  it('spends the basic and keeps the dual up for the pip that needs it', () => {
    const tower = card({
      name: 'Command Tower', type_line: 'Land', cmc: 0,
      produced_mana: ['W', 'U', 'B', 'R', 'G'],
    });
    const bf = [perm(basic('Swamp')), perm(tower), perm(basic('Island'))];
    const plan = planPayment(bf, requirementFor(
      card({ name: 'Sign in Blood', type_line: 'Sorcery', cmc: 2, mana_cost: '{B}{B}' }), 2,
    ));
    expect(plan.paid).toBe(true);
    expect(tappedNames(bf, plan.taps)).toEqual(['Command Tower', 'Swamp']);
  });

  it('counts a colourless rock for generic and never for a pip', () => {
    const solRing = card({
      name: 'Sol Ring', type_line: 'Artifact', cmc: 1,
      oracle_text: '{T}: Add {C}{C}.', produced_mana: ['C'],
    });
    const bf = [perm(solRing), perm(basic('Swamp'))];
    // {2}{B} — two generic off the ring, the pip off the Swamp.
    expect(planPayment(bf, requirementFor(
      card({ name: 'Gravedigger', cmc: 3, mana_cost: '{2}{B}' }), 3,
    )).paid).toBe(true);
    // {B}{B} is not payable: the ring makes colourless, whatever else is left.
    expect(planPayment(bf, requirementFor(
      card({ name: 'Sign in Blood', type_line: 'Sorcery', cmc: 2, mana_cost: '{B}{B}' }), 2,
    )).paid).toBe(false);
  });

  it('takes either half of a hybrid pip', () => {
    const spell = card({ name: 'Hybrid', type_line: 'Instant', cmc: 1, mana_cost: '{B/R}' });
    expect(planPayment([perm(basic('Mountain'))], requirementFor(spell, 1)).paid).toBe(true);
    expect(planPayment([perm(basic('Swamp'))], requirementFor(spell, 1)).paid).toBe(true);
    expect(planPayment([perm(basic('Island'))], requirementFor(spell, 1)).paid).toBe(false);
  });

  it('treats {X} and phyrexian as generic, since neither can be colour-screwed', () => {
    expect(requirementFor(card({ name: 'Fireball', cmc: 1, mana_cost: '{X}{R}' }), 3))
      .toEqual({ generic: 2, pips: [8] });
    expect(requirementFor(card({ name: 'Gitaxian Probe', cmc: 1, mana_cost: '{U/P}' }), 1))
      .toEqual({ generic: 1, pips: [] });
  });

  it('a cost reducer eats the generic half first', () => {
    const spell = card({ name: 'Big Zombie', cmc: 5, mana_cost: '{3}{B}{B}' });
    expect(requirementFor(spell, 3)).toEqual({ generic: 1, pips: [4, 4] });
  });

  it('pays a bare number with the least flexible sources it has', () => {
    const tower = card({
      name: 'Command Tower', type_line: 'Land', cmc: 0,
      produced_mana: ['W', 'U', 'B', 'R', 'G'],
    });
    const bf = [perm(tower), perm(basic('Swamp'))];
    expect(tappedNames(bf, planPayment(bf, genericCost(1)).taps)).toEqual(['Swamp']);
  });

  it('holds a spell it cannot make the colours for, and casts it once it can', () => {
    const spell = card({ name: 'Gravedigger', cmc: 3, mana_cost: '{2}{B}', type_line: 'Creature — Zombie', power: '2', toughness: '2' });
    const screwed = takeTurn(bot({
      hand: [spell], battlefield: [perm(basic('Island')), perm(basic('Island')), perm(basic('Island'))],
    }), board());
    expect(screwed.final.hand.map(c => c.name)).toContain('Gravedigger');

    const fixed = takeTurn(bot({
      hand: [spell], battlefield: [perm(basic('Island')), perm(basic('Island')), perm(basic('Swamp'))],
    }), board());
    expect(fixed.final.battlefield.map(p => p.card.name)).toContain('Gravedigger');
  });
});

/**
 * Cards that arrive sideways. The bug: a bot cast Worn Powerstone and tapped it
 * for two the same turn, because nothing on the bot's side of the table had ever
 * read the words "enters tapped".
 */
describe('entering tapped', () => {
  const powerstone = card({
    name: 'Worn Powerstone', type_line: 'Artifact', cmc: 3, mana_cost: '{3}',
    oracle_text: 'Worn Powerstone enters tapped.\n{T}: Add {C}{C}.',
    produced_mana: ['C'],
  });
  const played = (c: ScryfallCard, lands = 3) => takeTurn(bot({
    hand: [c], battlefield: Array.from({ length: lands }, () => perm(basic('Swamp'))),
  }), board()).final.battlefield.find(p => p.card.name === c.name);

  it('lays a Worn Powerstone down tapped', () => {
    expect(played(powerstone)?.tapped).toBe(true);
  });

  it('makes no mana the turn it arrives, and two the turn after', () => {
    const arrived = played(powerstone)!;
    expect(manaFrom(arrived)).toBe(0);
    expect(manaFrom({ ...arrived, tapped: false })).toBe(2);
  });

  it('lays a tapland down tapped', () => {
    const gate = card({
      name: 'Azorius Guildgate', type_line: 'Land — Gate', cmc: 0,
      oracle_text: 'Azorius Guildgate enters tapped.\n{T}: Add {W} or {U}.',
      produced_mana: ['W', 'U'],
    });
    expect(played(gate, 0)?.tapped).toBe(true);
  });

  it('still reads the old "enters the battlefield tapped" wording', () => {
    const old = card({
      name: 'Dimir Aqueduct', type_line: 'Land', cmc: 0,
      oracle_text: 'Dimir Aqueduct enters the battlefield tapped.\n{T}: Add {U}{B}.',
      produced_mana: ['U', 'B'],
    });
    expect(played(old, 0)?.tapped).toBe(true);
  });

  it('takes the good half of an "unless" clause', () => {
    const shock = card({
      name: 'Watery Grave', type_line: 'Land — Island Swamp', cmc: 0,
      oracle_text: '({T}: Add {U} or {B}.)\nAs Watery Grave enters, you may pay 2 life. If you don\'t, it enters tapped.',
      produced_mana: ['U', 'B'],
    });
    expect(played(shock, 0)?.tapped).toBe(false);
  });

  it('does not tap a card that only talks about OTHER things entering tapped', () => {
    const amulet = card({
      name: 'Amulet of Vigor', type_line: 'Artifact', cmc: 1, mana_cost: '{1}',
      oracle_text: 'Whenever a permanent you control enters tapped, untap it.',
    });
    expect(played(amulet, 1)?.tapped).toBe(false);
  });
});
