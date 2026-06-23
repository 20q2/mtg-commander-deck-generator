/**
 * Tag slugs that are real Scryfall oracle tags but unhelpful for *discovery* —
 * they describe trivia (watermarks, format-power notes, vanilla-ness) rather than
 * what a card does. Ported from mtg-optimizer's `proper-words.ts` (`toIgnore`).
 * Used to demote (not delete) these in the deck top-tags and the tag picker.
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
]);

export function isIgnoredTag(slug: string): boolean {
  return IGNORED_TAGS.has(slug);
}
