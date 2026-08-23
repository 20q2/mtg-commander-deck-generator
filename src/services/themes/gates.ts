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
   * 'text' — enough cards must mention this word in name, type line or oracle text.
   */
  kind: 'card' | 'tag' | 'text';
  /** The card name, the tag slug, or the word. */
  subject: string;
  /** Tag and text gates: how many cards were required, and how many the deck has. */
  need?: number;
  have?: number;
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
/**
 * Themes that are ONE named card, gated on that exact card. Keyed by theme slug → card name.
 *
 * The distinction from REQUIRED_TAGS is whether the theme has substitutes. A pod deck has sixteen
 * cards that can be its engine, so gating Birthing Pod on the card would be wrong. Shadowborn
 * Apostles has none: exactly one card in the format contains the phrase, and the deck is thirty
 * copies of it. Gating on the effect tag instead would be the loose version of a tight requirement.
 *
 * Left ungated it was pure Aristocrats noise. Nothing about the theme's name makes it inert, so it
 * classifies as an archetype and lift hands it the vocabulary of the decks that play it:
 * `blood-artist-ability`, `drain-life`, `opponent-loses-life`, `removal-sacrifice`, `typal-demon`.
 * That's a description of every black sacrifice deck ever built.
 *
 * Merged with the companion anchors the build script derives from Scryfall's `Companion` keyword —
 * those are measured, these are judgement, and both end up in ThemeModel.anchor.
 */
export const REQUIRED_CARDS: Readonly<Record<string, string>> = {
  'shadowborn-apostles': 'Shadowborn Apostle',
  // The rest of the "deck is thirty copies of one card" family, found by intersecting the taxonomy
  // with Scryfall's card-name catalog: 46 themes share a name with a real card, and these are the
  // ones with no substitute. Each was matching any deck of its colour or strategy — Persistent
  // Petitioners on `mill`/`mill-self`/`synergy-blue` would ride along on every mill deck built,
  // Slime Against Humanity on `counter-doubler`/`counters-matter` on every +1/+1 deck, Sunforger on
  // `synergy-equipment`/`combat-trick` on every equipment deck.
  'rat-colony': 'Rat Colony',
  'relentless-rats': 'Relentless Rats',
  'persistent-petitioners': 'Persistent Petitioners',
  'dragons-approach': "Dragon's Approach",
  'slime-against-humanity': 'Slime Against Humanity',
  'hare-apparent': 'Hare Apparent',
  'sunforger': 'Sunforger',
  'primal-surge': 'Primal Surge',
  // Deliberately NOT gated, though they also share a name with a card: Sneak Attack, Ad Nauseam,
  // Polymorph, Donate and Fling name EFFECTS with real substitutes (Through the Breach, Bolas's
  // Citadel, Proteus Staff, Harmless Offering, Thud), so a card gate would be too tight — they
  // belong in REQUIRED_TAGS if they need anything. Blink, Clones, Sacrifice, Exile, Dredge, Crime,
  // Deserts and Counterspells merely happen to collide with a card name; gating them would be
  // nonsense.
};

export const REQUIRED_TAGS: Readonly<Record<string, { tag: string; min: number }>> = {
  // A COUNT, not mere presence — the same correction `deserts` needed below, for the same reason.
  //
  // Presence alone let one pod effect qualify a whole deck. On a Nath of the Gilt-Leaf stax list
  // holding a single pod card, Birthing Pod was promoted ahead of Stax and Discard: the gate opened
  // on that one card, and the eight members it then claimed came through `sacrifice-outlet`,
  // `repeatable-sacrifice-outlet` and `reanimate-creature` — generic vocabulary any elves-and-sac
  // deck carries. The engine was one card; the evidence was borrowed.
  //
  // Two, not three. A pod deck's engine has sixteen possible cards but a real one runs more than a
  // lone copy — Pod plus Vannifar, or Pod plus Neoform — while a single pod effect in a sacrifice
  // deck is a good card, not a plan. Deserts needs three because manabases hold one or two
  // incidentally; nothing incidentally holds two pod effects.
  'birthing-pod': { tag: 'birthing-pod', min: 2 },
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
export const REQUIRED_WORDS: Readonly<Record<string, { word: string; min: number }>> = {
  // Saprolings has one printed creature in the pool, so it can only be found statistically — and its
  // definition is half generic token vocabulary (synergy-token, creature-count-matters), which every
  // token deck in the format carries. A Krenko goblins list scored it on exactly that.
  saprolings: { word: 'saproling', min: 1 },

  // A count, not mere presence. Deserts' definition is generic lands vocabulary
  // (crucible-of-worlds, reanimate-land, landfall, lands-matter) plus synergy-desert, so it scores on
  // any lands deck — it beat Lands Matter on a Titania list holding no Desert at all. And one
  // incidental Desert in a manabase still isn't a Deserts deck; a theme that's really the plan shows
  // up on more than one card.
  deserts: { word: 'desert', min: 3 },

  // Dredge, Thopters and Servos were here and no longer need to be. Lowering the build script's
  // literal-coverage bar from 10 to 3 gave Dredge and Thopters back their precise literal tests, and
  // the own-vocabulary check left Servos inert, so none of the three can match on borrowed
  // vocabulary any more. The durable guard is in the build script, not here.
};
