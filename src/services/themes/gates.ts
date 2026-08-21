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
  /**
   * 'card' — this exact card must be in the deck.
   * 'tag'  — some card must carry this oracle tag.
   * 'text' — some card must mention this word in its name, type line or oracle text.
   */
  kind: 'card' | 'tag' | 'text';
  /** The card name, the tag slug, or the word. */
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

/**
 * Themes named after a thing that must literally appear on a card in the deck. Keyed by theme slug →
 * the word, matched against name, type line and oracle text of every card, lands included (a land
 * that makes the token counts).
 *
 * These are all TOKEN tribes, and they share a failure mode. Their creature type barely exists as a
 * printed card, so the build script's coverage check forces them onto the statistical path
 * (`forceArchetype`) — and the tags lift then learns for them are the generic token vocabulary:
 * `synergy-token`, `synergy-token-creature`, `creature-count-matters`, `free-sacrifice-outlet`. Every
 * token deck in the format has those. A Krenko goblins list scored Saprolings on exactly that basis
 * while containing not one Saproling.
 *
 * Matched on TEXT rather than on the `typal-<x>` tag deliberately. The tag covers the 24 printed
 * Saproling cards but none of the token MAKERS (Saproling Migration, Sporemound, Scatter the Seeds,
 * Verdant Force), so a token-centric build could run zero tagged cards and still plainly be a
 * Saproling deck. The word can't miss those.
 *
 * Curated, not derived: the name is only usable as a gate when it's real card vocabulary, and often
 * it isn't. Measured across all 25 forceArchetype themes, "Voting" finds 7 cards because they say
 * "vote"; "Eggs", "Paradigm", "Increment" and "Paradox" are EDHREC nicknames appearing on no card;
 * and substring matching makes "Opus" match Octopus. A derived rule would silence real themes.
 */
export const REQUIRED_WORDS: Readonly<Record<string, string>> = {
  saprolings: 'saproling',
  servos: 'servo',
  thopters: 'thopter',
};
