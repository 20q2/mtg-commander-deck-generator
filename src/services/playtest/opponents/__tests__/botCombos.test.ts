import { describe, it, expect } from 'vitest';
import { takeTurn } from '@/services/playtest/opponents/engine';
import { comboIsLive, liveCombos, type BotCombo } from '@/services/playtest/opponents/botCombos';
import type { PlayerBoardRead } from '@/services/playtest/opponents/evaluate';
import type { Opponent, OpponentPermanent, TurnFrame } from '@/components/playtest/opponentTypes';
import type { ScryfallCard } from '@/types';

/**
 * Combo assembly, the telegraph, and the shot.
 *
 * The telegraph is the load-bearing behaviour: a combo arms on the turn its
 * pieces come together and fires on the next one, so there is always exactly
 * one window in which killing a piece is an out. A bot that assembled and won
 * in the same turn would be a loss screen.
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
    // Combos are gated on resistance: a passive threat dummy does not go off.
    decked: false, resistance: true, aggression: 0.5, turnsTaken: 0, ...over,
  };
}
const board = (over: Partial<PlayerBoardRead> = {}): PlayerBoardRead =>
  ({ cards: [], life: 40, handSize: 0, untappedCreatures: [], ...over });

const logsOf = (frames: TurnFrame[]) => frames.flatMap(f => f.logs).join(' | ');
const damageOf = (frames: TurnFrame[]) =>
  frames.flatMap(f => f.effects).reduce((sum, e) => sum + e.lifeLoss, 0);
const lethalIn = (frames: TurnFrame[]) =>
  frames.flatMap(f => f.effects).some(e => e.lethal);

/** Kiki-Jiki + Zealous Conscripts, the mono-red line in BOT_COMBOS. */
const kikiBoard = () => [
  perm(card({ name: 'Kiki-Jiki, Mirror Breaker', cmc: 5, power: '2', toughness: '2' })),
  perm(card({ name: 'Zealous Conscripts', cmc: 5, power: '3', toughness: '3' })),
];

describe('comboIsLive', () => {
  const combo: BotCombo = {
    id: 't', name: 'Test', onBattlefield: ['A', 'B'], mana: 2,
    outcome: { kind: 'damage', amount: 10 }, how: '',
  };

  it('needs every piece', () => {
    expect(comboIsLive(combo, { battlefield: ['A', 'B'], hand: [], mana: 2 })).toBe(true);
    expect(comboIsLive(combo, { battlefield: ['A'], hand: [], mana: 2 })).toBe(false);
  });

  it('needs the mana', () => {
    expect(comboIsLive(combo, { battlefield: ['A', 'B'], hand: [], mana: 1 })).toBe(false);
  });

  it('counts duplicates rather than just checking presence', () => {
    const twoCopies: BotCombo = { ...combo, onBattlefield: ['A', 'A'] };
    expect(comboIsLive(twoCopies, { battlefield: ['A'], hand: [], mana: 2 })).toBe(false);
    expect(comboIsLive(twoCopies, { battlefield: ['A', 'A'], hand: [], mana: 2 })).toBe(true);
  });

  it('looks in hand for a finisher', () => {
    const withHand: BotCombo = { ...combo, onBattlefield: ['A'], inHand: ['Finisher'] };
    expect(comboIsLive(withHand, { battlefield: ['A'], hand: [], mana: 2 })).toBe(false);
    expect(comboIsLive(withHand, { battlefield: ['A'], hand: ['Finisher'], mana: 2 })).toBe(true);
  });
});

describe('liveCombos', () => {
  it('puts a game-ending line ahead of a damage one', () => {
    const decks: BotCombo[] = [
      { id: 'dmg', name: 'D', onBattlefield: ['A'], mana: 0, outcome: { kind: 'damage', amount: 5 }, how: '' },
      { id: 'win', name: 'W', onBattlefield: ['A'], mana: 0, outcome: { kind: 'winTheGame' }, how: '' },
    ];
    const live = liveCombos({ battlefield: ['A'], hand: [], mana: 0 }, decks);
    expect(live.map(c => c.id)).toEqual(['win', 'dmg']);
  });
});

describe('the telegraph', () => {
  it('announces on the turn it assembles and deals nothing', () => {
    const r = takeTurn(bot({ battlefield: [...kikiBoard(), perm(MOUNTAIN())] }), board());
    expect(logsOf(r.frames)).toContain('Kiki-Jiki + Zealous Conscripts assembled');
    expect(logsOf(r.frames)).toContain('goes off next turn');
    expect(damageOf(r.frames)).toBe(0);
    expect(r.final.armedCombos).toEqual(['kiki-conscripts']);
  });

  it('fires on the following turn', () => {
    const first = takeTurn(bot({ battlefield: [...kikiBoard(), perm(MOUNTAIN())] }), board());
    const second = takeTurn(first.final, board());
    expect(logsOf(second.frames)).toContain('goes off: Kiki-Jiki + Zealous Conscripts');
    // The `how` line is logged too, so losing to it teaches you what happened.
    expect(logsOf(second.frames)).toContain('infinite hasty copies');
    expect(damageOf(second.frames)).toBe(40);
    // Spent: it does not fire again every turn forever.
    expect(second.final.armedCombos).toEqual([]);
  });

  it('killing a piece in the window disarms it', () => {
    const first = takeTurn(bot({ battlefield: [...kikiBoard(), perm(MOUNTAIN())] }), board());
    expect(first.final.armedCombos).toEqual(['kiki-conscripts']);

    // You destroy Zealous Conscripts before their next turn.
    const broken: Opponent = {
      ...first.final,
      battlefield: first.final.battlefield.filter(p => p.card.name !== 'Zealous Conscripts'),
    };
    const second = takeTurn(broken, board());
    expect(logsOf(second.frames)).toContain('is broken up');
    expect(damageOf(second.frames)).toBe(0);
    expect(second.final.armedCombos).toEqual([]);
  });

  it('a passive bot never goes off', () => {
    const first = takeTurn(
      bot({ resistance: false, battlefield: [...kikiBoard(), perm(MOUNTAIN())] }),
      board(),
    );
    expect(first.final.armedCombos ?? []).toEqual([]);
    const second = takeTurn(first.final, board());
    expect(damageOf(second.frames)).toBe(0);
  });

  it('a game-ending line comes through as lethal, not as a big number', () => {
    const pieces = [
      perm(card({ name: 'Sanguine Bond', type_line: 'Enchantment', cmc: 5 })),
      perm(card({ name: 'Exquisite Blood', type_line: 'Enchantment', cmc: 5 })),
    ];
    const first = takeTurn(bot({ battlefield: pieces }), board());
    const second = takeTurn(first.final, board());
    expect(lethalIn(second.frames)).toBe(true);
    expect(damageOf(second.frames)).toBe(0);
  });

  it('spends the finisher out of hand', () => {
    const oracle = perm(card({ name: "Thassa's Oracle", cmc: 2, power: '1', toughness: '3' }));
    const consult = card({ name: 'Demonic Consultation', type_line: 'Instant', cmc: 1 });
    const start = bot({
      battlefield: [oracle, perm(MOUNTAIN()), perm(MOUNTAIN())],
      hand: [consult],
    });
    const first = takeTurn(start, board());
    expect(first.final.armedCombos).toEqual(['thoracle-consult']);
    // Still in hand while armed — it is cast as the line resolves, not before.
    expect(first.final.hand.map(c => c.name)).toContain('Demonic Consultation');

    const second = takeTurn(first.final, board());
    expect(lethalIn(second.frames)).toBe(true);
    expect(second.final.hand.map(c => c.name)).not.toContain('Demonic Consultation');
    expect(second.final.graveyard.map(c => c.name)).toContain('Demonic Consultation');
  });
});

describe('tutors', () => {
  const MATRON = () => card({ name: 'Goblin Matron', cmc: 3, power: '1', toughness: '1' });
  /**
   * The bot draws for turn before it casts anything, so every library here
   * leads with a card meant to be drawn — otherwise the draw step eats the very
   * card the test is about.
   */
  const FILLER = () => card({ name: 'Filler Wastes', type_line: 'Land', cmc: 0 });

  /** Kiki-Jiki down, three Mountains up, and a Matron ready to cast. */
  const goblinBot = (library: ScryfallCard[]) => bot({
    battlefield: [
      perm(card({ name: 'Kiki-Jiki, Mirror Breaker', cmc: 5, power: '2', toughness: '2' })),
      ...Array.from({ length: 3 }, () => perm(MOUNTAIN())),
    ],
    hand: [MATRON()],
    library: [FILLER(), ...library],
  });

  it('fetches the piece that completes a line over a bigger card', () => {
    const r = takeTurn(goblinBot([
      // Strictly bigger and also a goblin, so cost alone would take it.
      card({ name: 'Big Goblin', cmc: 9, power: '9', toughness: '9' }),
      card({ name: 'Zealous Conscripts', cmc: 5, power: '3', toughness: '3' }),
    ]), board());
    expect(logsOf(r.frames)).toContain('searches up Zealous Conscripts');
  });

  it('otherwise prefers a card it knows how to use', () => {
    const r = takeTurn(goblinBot([
      card({ name: 'Vanilla Goblin', cmc: 6, power: '6', toughness: '6' }),
      // Registry-known: the bot can actually do something with this one.
      card({ name: 'Goblin Rabblemaster', cmc: 3, power: '2', toughness: '2' }),
    ]), board());
    expect(logsOf(r.frames)).toContain('searches up Goblin Rabblemaster');
  });

  it('falls back to the most expensive legal card', () => {
    const r = takeTurn(goblinBot([
      card({ name: 'Small Goblin', cmc: 1, power: '1', toughness: '1' }),
      card({ name: 'Large Goblin', cmc: 7, power: '7', toughness: '7' }),
    ]), board());
    expect(logsOf(r.frames)).toContain('searches up Large Goblin');
  });

  it('respects the subtype restriction', () => {
    const r = takeTurn(goblinBot([
      card({ name: 'Huge Dragon', cmc: 9, type_line: 'Creature — Dragon', power: '9', toughness: '9' }),
      card({ name: 'Small Goblin', cmc: 1, power: '1', toughness: '1' }),
    ]), board());
    expect(logsOf(r.frames)).toContain('searches up Small Goblin');
    expect(r.final.hand.map(c => c.name)).not.toContain('Huge Dragon');
  });

  it('never fetches a land', () => {
    const r = takeTurn(goblinBot([
      card({ name: 'Goblin Hideout', type_line: 'Land', cmc: 0 }),
      card({ name: 'Small Goblin', cmc: 1, power: '1', toughness: '1' }),
    ]), board());
    expect(logsOf(r.frames)).toContain('searches up Small Goblin');
    expect(logsOf(r.frames)).not.toContain('Goblin Hideout');
  });

  it('still casts the body when there is nothing to find', () => {
    // A Matron with an empty library is a 1/1 that should still hit the table —
    // holding it forever would read as a bot that had stopped playing.
    const r = takeTurn(goblinBot([]), board());
    expect(r.final.battlefield.map(p => p.card.name)).toContain('Goblin Matron');
    expect(logsOf(r.frames)).not.toContain('searches up');
  });

  it('does not waste a sorcery-speed tutor with nothing legal to find', () => {
    // Demonic Tutor is not a body, so casting it into an empty library is pure
    // loss — the guard that holds Victimize back holds this back too.
    const r = takeTurn(bot({
      battlefield: Array.from({ length: 3 }, () => perm(MOUNTAIN())),
      hand: [card({ name: 'Demonic Tutor', type_line: 'Sorcery', cmc: 2 })],
      library: [],
    }), board());
    expect(r.final.hand.map(c => c.name)).toContain('Demonic Tutor');
  });
});

describe('deploying pieces', () => {
  it('casts a combo piece ahead of a bigger spell', () => {
    const kiki = card({ name: 'Kiki-Jiki, Mirror Breaker', cmc: 5, power: '2', toughness: '2' });
    const fatty = card({ name: 'Big Dumb Dragon', cmc: 6, power: '6', toughness: '6' });
    // Six mana: one of these, not both. Interaction already stands aside for
    // an affordable piece; develop has to actually cast it.
    const r = takeTurn(
      bot({ hand: [kiki, fatty], battlefield: Array.from({ length: 6 }, () => perm(MOUNTAIN())) }),
      board(),
    );
    expect(r.final.battlefield.map(p => p.card.name)).toContain('Kiki-Jiki, Mirror Breaker');
    expect(r.final.hand.map(c => c.name)).toContain('Big Dumb Dragon');
  });
});
