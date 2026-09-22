import { describe, it, expect } from 'vitest';
import { segmentLogText, type CardIndex } from '@/components/playtest/LogCardText';
import type { ScryfallCard } from '@/types';

/**
 * The log finds card names in prose it did not write, so the matching rules are
 * the whole risk: a name that isn't lit is a missed preview, a word lit by
 * accident is a lie about what is in the game.
 */

const card = (name: string) => ({ id: name, name } as unknown as ScryfallCard);

function index(names: string[], opponents: string[] = []): CardIndex {
  const byName = new Map(names.map(n => [n, card(n)]));
  const escaped = [...byName.keys()]
    .sort((a, b) => b.length - a.length)
    .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return {
    byName,
    pattern: new RegExp(escaped.join('|'), 'g'),
    skip: opponents.map(name => ({ name, opponent: true })),
  };
}

/** Just the names a line lit up, in order. */
const hits = (text: string, idx: CardIndex) =>
  segmentLogText(text, idx).filter(s => s.card).map(s => s.text);

describe('segmentLogText', () => {
  it('finds a card name in a log sentence', () => {
    expect(hits('Drew Sol Ring', index(['Sol Ring']))).toEqual(['Sol Ring']);
  });

  it('keeps the surrounding text intact', () => {
    expect(segmentLogText('Sol Ring: hand → battlefield', index(['Sol Ring']))).toEqual([
      { text: 'Sol Ring', card: expect.objectContaining({ name: 'Sol Ring' }) },
      { text: ': hand → battlefield' },
    ]);
  });

  it('takes the longest name, not the token inside it', () => {
    const idx = index(['Goblin', 'Goblin Chieftain']);
    expect(hits('Krenko makes a Goblin Chieftain', idx)).toEqual(['Goblin Chieftain']);
    expect(hits('Goblin attacks you', idx)).toEqual(['Goblin']);
  });

  it('matches names with commas and punctuation', () => {
    expect(hits('Goblin Aggro casts Krenko, Mob Boss', index(['Krenko, Mob Boss'])))
      .toEqual(['Krenko, Mob Boss']);
    expect(hits("Sol Ring's ability", index(['Sol Ring']))).toEqual(['Sol Ring']);
  });

  it('finds every name on a line', () => {
    expect(hits('Attached Lightning Greaves to Krenko', index(['Lightning Greaves', 'Krenko'])))
      .toEqual(['Lightning Greaves', 'Krenko']);
  });

  it('will not light a name buried inside a longer word', () => {
    expect(hits('Uncounterable', index(['Counter']))).toEqual([]);
    expect(hits('Islands everywhere', index(['Island']))).toEqual([]);
  });

  it('is case-sensitive, so prose words stay prose', () => {
    expect(hits('Toggled tap on 3 cards', index(['Tap']))).toEqual([]);
  });

  it('leaves a line alone when nothing is in the game yet', () => {
    expect(segmentLogText('Turn 1', { byName: new Map(), pattern: null, skip: [] }))
      .toEqual([{ text: 'Turn 1' }]);
  });

  it("does not light a card name sitting inside a seated deck's name", () => {
    const idx = index(['Goblin', 'Goblin Chieftain'], ['Goblin Aggro']);
    expect(hits('Goblin Aggro casts Goblin Chieftain', idx)).toEqual(['Goblin Chieftain']);
  });

  it("marks a seat's name so the line reads as someone else's doing", () => {
    const idx = index(['Goblin Chieftain'], ['Goblin Aggro']);
    expect(segmentLogText('Goblin Aggro casts Goblin Chieftain', idx)).toEqual([
      { text: 'Goblin Aggro', card: undefined, opponent: true },
      { text: ' casts ' },
      {
        text: 'Goblin Chieftain',
        card: expect.objectContaining({ name: 'Goblin Chieftain' }),
        opponent: undefined,
      },
    ]);
  });

  it('marks the seat every time the line names it', () => {
    const idx = index([], ['Goblin Aggro']);
    const marked = segmentLogText("Goblin Aggro's attack on Goblin Aggro", idx)
      .filter(s => s.opponent);
    expect(marked).toHaveLength(2);
  });

  it('leaves your own deck name untinted', () => {
    const idx: CardIndex = {
      byName: new Map(),
      pattern: null,
      skip: [{ name: 'My Deck', opponent: false }],
    };
    expect(segmentLogText('My Deck draws a card', idx).some(s => s.opponent)).toBe(false);
  });
});
