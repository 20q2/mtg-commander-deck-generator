import { describe, it, expect } from 'vitest';
import { takeTurn } from '@/services/playtest/opponents/engine';
import type { PlayerBoardRead } from '@/services/playtest/opponents/evaluate';
import type { Opponent, OpponentPermanent } from '@/components/playtest/opponentTypes';
import type { ScryfallCard } from '@/types';

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
    decked: false, resistance: true, aggression: 0.5, turnsTaken: 0, ...over,
  };
}
const board = (over: Partial<PlayerBoardRead> = {}): PlayerBoardRead =>
  ({ cards: [], life: 40, handSize: 0, untappedCreatures: [], ...over });

describe('which beats are a cast', () => {
  it('marks the commander, which never passes through hand', () => {
    const commander = card({ name: 'Krenko, Mob Boss', cmc: 4, power: '3', toughness: '3' });
    const grizzly = card({ name: 'Grizzly Bears', cmc: 2, power: '2', toughness: '2' });
    const seat = bot({
      commanderName: 'Krenko, Mob Boss',
      command: [commander],
      hand: [grizzly, MOUNTAIN()],
      battlefield: [perm(MOUNTAIN()), perm(MOUNTAIN()), perm(MOUNTAIN()), perm(MOUNTAIN()), perm(MOUNTAIN())],
      library: [MOUNTAIN(), MOUNTAIN(), MOUNTAIN()],
      turnsTaken: 3,
    });

    const { frames } = takeTurn(seat, board());
    const castNames = frames.filter(f => f.moved).map(f => f.moved!.card.name);
    const commanderBeat = frames.find(f => f.moved?.card.name === 'Krenko, Mob Boss');

    expect(castNames).toContain('Krenko, Mob Boss');
    expect(castNames).toContain('Grizzly Bears');
    // A land moves out of hand like anything else — it gets the flight — but it
    // never uses the stack, so it must not park the turn.
    const land = frames.find(f => f.moved?.card.name === 'Mountain');
    expect(land, 'the bot should have played a land').toBeDefined();
    expect(land!.moved!.onStack).toBe(false);
    expect(frames.filter(f => f.moved?.onStack).map(f => f.moved!.card.name))
      .not.toContain('Mountain');
    // It leaves the command zone, which is the whole reason the hand-size
    // proxy could not see it — and the flight has to start from the right pile.
    expect(commanderBeat!.moved!.from).toBe('command');
  });

  it('counts what came off the library, not what the hand netted out to', () => {
    // Divination is one card out of hand and two in. The hand nets to +1, which
    // is what the seat used to animate: a single card hopping off the library
    // for a spell that drew two.
    const seat = bot({
      hand: [card({ name: 'Divination', type_line: 'Sorcery', cmc: 3 })],
      battlefield: [perm(MOUNTAIN()), perm(MOUNTAIN()), perm(MOUNTAIN())],
      library: [MOUNTAIN(), MOUNTAIN(), MOUNTAIN(), MOUNTAIN()],
      turnsTaken: 3,
    });

    const { frames } = takeTurn(seat, board());

    const drawStep = frames[0];
    expect(drawStep.drew, 'the draw step draws one').toBe(1);

    const cantrip = frames.find(f => f.moved?.card.name === 'Divination');
    expect(cantrip, 'the bot should have cast Divination').toBeDefined();
    expect(cantrip!.drew, 'two cards came off the library').toBe(2);
    expect(cantrip!.moved!.from).toBe('hand');
    // A sorcery leaves nothing on the board to fly out of the hand.
    expect(cantrip!.opponent.battlefield.some(p => p.card.name === 'Divination')).toBe(false);
  });

  it('does not mark the cleanup discard, which also shrinks the hand', () => {
    const filler = () => card({ name: `Filler ${n++}`, cmc: 9, power: '1', toughness: '1' });
    const seat = bot({
      hand: [filler(), filler(), filler(), filler(), filler(), filler(), filler(), filler()],
      library: [MOUNTAIN(), MOUNTAIN()],
      turnsTaken: 3,
    });

    const { frames } = takeTurn(seat, board());
    const discardBeat = frames.find(f => f.logs.some(l => l.includes('discards')));
    expect(discardBeat, 'the bot should have discarded to hand size').toBeDefined();
    expect(discardBeat!.moved).toBeUndefined();
  });
});
