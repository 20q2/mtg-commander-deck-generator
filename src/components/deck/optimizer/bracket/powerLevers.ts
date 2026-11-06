// src/components/deck/optimizer/bracket/powerLevers.ts
//
// The power score's gap to the next bracket, said in cards: "Two more fast mana pieces or three tutors".
// Shared by the Overview's power panel and the Bracket tab so both say the same thing.
import { cardsToNextBracket, type BracketBreakdown, type PowerLever } from '@/services/deckBuilder/bracketEstimator';

const NUMBER_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five'];
const LEVER_WORDS: Record<PowerLever, [string, string]> = {
  fastMana: ['fast mana piece', 'fast mana pieces'],
  tutors: ['tutor', 'tutors'],
  interaction: ['piece of interaction', 'pieces of interaction'],
};

/** Null when no single kind of card can close the gap within five cards. */
export function nextBracketLine(breakdown: BracketBreakdown, pointsShort: number): string | null {
  const said = cardsToNextBracket(breakdown, pointsShort)
    .filter(l => l.cards <= 5)
    .slice(0, 2)
    .map(({ lever, cards }, i) => {
      const count = NUMBER_WORDS[cards];
      const noun = LEVER_WORDS[lever][cards === 1 ? 0 : 1];
      return `${i === 0 ? count : count.toLowerCase()}${i === 0 ? ' more' : ''} ${noun}`;
    });
  return said.length ? said.join(' or ') : null;
}
