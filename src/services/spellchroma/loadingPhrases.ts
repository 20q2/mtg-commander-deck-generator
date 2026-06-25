// Flavor shown while the explorer is searching. Ported from the original
// SpellChroma (with its rare ~1% easter-egg quote kept intact).
export const LOADING_PHRASES = [
  'Tapping mana',
  'Summoning Saprolings',
  'Unstacking the stack',
  'Holding 2 blue mana',
  'Planeshifting',
  'Drawing a new hand',
  'Finding your new favorite',
  'Moving to main phase',
  'Shuffling Kozilek',
  'Rolling up the elves',
  'Flinging goblins',
  'Searching through grandpa\'s deck',
  'Bolting the 🐓',
  'Flying through the storm',
  'Blocking with squirrels',
  'Cooking with Asmoranomardicadaistinaculdacar',
  'Cooking with Gyome',
  'Cutting lands',
  'Paying the 1',
  'Hating bears',
  'Discovering something new',
  'Traversing the outlands',
  'Plowing the swords',
  'Mulliganing to six',
  'Scrying to the bottom',
  'Counting your devotion',
  'Tutoring for answers',
  'Goldfishing the matchup',
  'Convoking the masses',
  'Milling the library',
  'Untapping the Islands',
  'Proliferating counters',
  'Cracking a fetchland',
  'Phasing out politely',
  'Resolving the trigger',
  'Asking if it resolves',
  'Checking for responses',
  'Reading the card',
  'Explaining the card',
  'Stacking triggers',
  'Cascading into a land',
  'Equipping the squirrels',
  'Politely declining the trade',
  'Reanimating something gross',
  'Drowning in card advantage',
  'Untapping under protest',
  'Almost there',
];

const RARE_PHRASES = [
  'Drawing 7 lands',
  'Topdecking the out',
  'Misplaying in silence',
  'Stepping on a Lego',
  'Pile shuffling for 4 minutes',
  'Forgetting a landfall trigger',
  'Tapping the wrong land',
  'Conceding to a goblin',
];

/** A random flavor phrase — ~1% of the time it's a rare easter-egg quote. */
export function randomLoadingPhrase(): string {
  if (Math.floor(Math.random() * 100) === 0) {
    return RARE_PHRASES[Math.floor(Math.random() * RARE_PHRASES.length)];
  }
  return LOADING_PHRASES[Math.floor(Math.random() * LOADING_PHRASES.length)];
}
