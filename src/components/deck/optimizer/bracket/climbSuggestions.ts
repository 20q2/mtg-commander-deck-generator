// src/components/deck/optimizer/bracket/climbSuggestions.ts
//
// What would raise each tuning row: cards this commander's decks play that this deck doesn't, sorted
// by how often they're played. The pool is the commander's EDHREC page, which only lists cards legal
// in the deck's colours, so nothing here needs its own identity check.
import type { EDHRECCard, ScryfallCard } from '@/types';
import { isFastMana } from '@/services/deckBuilder/bracketEstimator';
import { getCardRole, hasTag } from '@/services/tagger/client';
import type { SoftKey } from './bracketViewModel';

export interface ClimbCard {
  name: string;
  /** "In 41% of decks", or the mana value for the curve row. */
  note: string;
  /** On the Game Changers list: raises the floor to 3, or to 4 past three of them. */
  gameChanger?: boolean;
}

const SHOWN = 6;

const isInteraction = (name: string) => {
  const role = getCardRole(name);
  return role === 'removal' || role === 'boardwipe' || role === 'protection';
};
// The estimator's own tutor test, minus its land check: only non-land cards are searched here.
const isTutor = (name: string) => hasTag(name, 'tutor') && getCardRole(name) === 'cardDraw';

function fromPool(pool: EDHRECCard[], inDeck: Set<string>, decksLabel: string, test: (c: EDHRECCard) => boolean): ClimbCard[] {
  // A card can sit in more than one of the page's lists; keep one entry per name.
  const unique = [...new Map(pool.map(c => [c.name, c])).values()];
  return unique
    .filter(c => !inDeck.has(c.name) && test(c))
    .sort((a, b) => b.inclusion - a.inclusion)
    .slice(0, SHOWN)
    .map(c => ({ name: c.name, note: `In ${Math.round(c.inclusion)}% of ${decksLabel}`, gameChanger: c.isGameChanger }));
}

export function climbSuggestions(
  /** The commander's all-brackets page. Not the bracket blend: its figures are a weighted mix, so
   *  "in 56% of decks" would describe no real set of decks, and the number would move with the aim. */
  page: { cardlists: { allNonLand: EDHRECCard[]; lands: EDHRECCard[] } } | null,
  inDeck: Set<string>,
  deckCards: ScryfallCard[],
  /** "Krenko" → "Krenko decks". */
  commanderShort: string,
): Record<SoftKey, ClimbCard[]> {
  const decks = `${commanderShort} decks`;
  const nonLand = page?.cardlists.allNonLand ?? [];
  const lands = page?.cardlists.lands ?? [];
  // The curve row has no card to add: what lowers it is cutting the heaviest spells.
  const heaviest = deckCards
    .filter(c => !c.type_line.toLowerCase().includes('land'))
    .sort((a, b) => b.cmc - a.cmc)
    .slice(0, 4)
    .map(c => ({ name: c.name, note: `${c.cmc} mana` }));
  return {
    // Ancient Tomb is fast mana and a land, so lands are searched too.
    fastMana: fromPool([...nonLand, ...lands], inDeck, decks, c => isFastMana(c.name)),
    tutors: fromPool(nonLand, inDeck, decks, c => isTutor(c.name)),
    interaction: fromPool(nonLand, inDeck, decks, c => isInteraction(c.name)),
    cmc: heaviest,
  };
}
