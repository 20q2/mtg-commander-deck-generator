/**
 * Declaration gates: hard requirements a deck must meet before a theme may be DECLARED as its
 * strategy, independent of how well the theme scores.
 *
 * A gated theme is still scored and still visible everywhere the scores are shown. Its data is
 * genuinely informative — an all-creature pile really does satisfy Umori's restriction, and a
 * sacrifice-heavy deck really does look like a pod deck — it just can't be the answer.
 *
 * Deliberately dependency-free so the same gates apply in the browser, in the build script, and in
 * tests. Nothing here imports the generated table or anything browser-coupled.
 */

/** What a deck was missing when a gate blocked declaration. */
export interface ThemeGate {
  /** 'card' — this exact card must be in the deck. 'tag' — some card must carry this oracle tag. */
  kind: 'card' | 'tag';
  /** The card name, or the tag slug. */
  subject: string;
}

/**
 * Themes named after an EFFECT rather than a strategy, gated on that effect actually being present.
 *
 * The distinction from an anchor CARD matters: "Birthing Pod" the theme doesn't need Birthing Pod
 * the card, because Prime Speaker Vannifar, Neoform, Eldritch Evolution, Pyre of Heroes, Fiend
 * Artisan and eleven others do the same job — but without one of those sixteen, the deck has no pod
 * engine and simply isn't a pod deck, however much it sacrifices creatures. Left ungated, a Krenko
 * goblins list scored Birthing Pod at 17.8 on eight members, none of which was a pod effect: they
 * matched through `sacrifice-outlet` and friends, which is what a pod deck's SUPPORT looks like
 * rather than the engine itself.
 *
 * Curated rather than derived, and so kept in source rather than in the generated table: no
 * measurement tells you that a theme names a specific effect. Keyed by theme slug → the oracle tag
 * that effect carries. Adding one is a line; the tag must exist in SpellChroma's dictionary.
 */
export const REQUIRED_TAGS: Readonly<Record<string, string>> = {
  'birthing-pod': 'birthing-pod',
};
