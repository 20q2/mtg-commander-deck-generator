/**
 * Tag slugs that are real Scryfall oracle tags but unhelpful for *discovery* —
 * they describe trivia (watermarks, format-power notes, vanilla-ness) or the
 * card's name/type-line rather than what a card does. Used to demote/hide these
 * in the deck top-tags and the tag picker.
 * Grow this set freely as noisy tags surface during playtesting.
 */
export const IGNORED_TAGS: ReadonlySet<string> = new Set([
  'watermark-matters',
  'weaker-in-singleton-formats',
  'stronger-in-singleton-formats',
  'french-vanilla',
  'vanilla',
  'cycle',
  'reprint',
  'has-art-variants',
  'cmc-matters',
  'gold-bordered',
  'mtgo-only',
  // Cosmetic / linguistic trivia — describe the card's name or type line, not what it does.
  'unique-type-line',
  'single-english-word-name',
  'eponymous',
  'alliteration',
  'tutored-by-name',
  // Too generic to be useful discovery tags (nearly every permanent carries one).
  'activated-ability',
  'triggered-ability',
]);

// Prefix families that are always trivia (e.g. cycle-lea-basic-land, cycle-*).
const IGNORED_PREFIXES = ['cycle-'];

export function isIgnoredTag(slug: string): boolean {
  if (IGNORED_TAGS.has(slug)) return true;
  return IGNORED_PREFIXES.some(p => slug.startsWith(p));
}
