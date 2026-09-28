/**
 * What the bots know how to do to you.
 *
 * Nothing in the playtest reads oracle text — this is a hand-curated map from
 * card name to a small set of scripted behaviours. Anything not listed here still
 * gets cast if it's a permanent; it just sits on their board as a body. The list
 * grows without the engine changing.
 *
 * Counterspells are deliberately absent: there is no stack to respond to, so
 * "counter target spell" has nothing to attach to. Leaving them unlisted means
 * they're simply never cast, which is better than pretending.
 */
import type { ScryfallCard } from '@/types';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';

import type { CombatKeyword } from '@/services/playtest/combat';
import type { DevotionColor } from '@/services/playtest/opponents/mana';

/**
 * The "target ..." clause narrowing what a removal spell may be pointed at.
 *
 * Every spot-removal spell here used to read as an unconditional "destroy
 * target creature", which is wrong on roughly a third of them and wrong in the
 * way a player notices immediately: a bot pointing Bone Shredder at a black
 * creature is not making a bad play, it is breaking a rule printed on the card
 * it just cast. Absent means genuinely unconditional — a Murder.
 *
 * Only the restrictions that change what a bot may target live here. A clause
 * about what happens AFTER it resolves — "it can't be regenerated", "you gain
 * life equal to its toughness" — is a different kind of fact and belongs with
 * the effect, not with the legality check.
 */
export interface TargetRestriction {
  /** Colours the target may not be — Doom Blade's "nonblack". */
  notColors?: DevotionColor[];
  /** Go for the Throat: "target nonartifact creature". */
  notArtifact?: boolean;
  /** Cut Down: "total power and toughness 5 or less". */
  maxTotalPT?: number;
  /** Terastodon: "target noncreature permanent". */
  noncreature?: boolean;
  /** Cast Out, Angel of Sanctions, a kicked Tear Asunder: "target nonland permanent". */
  nonland?: boolean;
  /** Goblin Trashmaster: "target artifact", and nothing else. */
  onlyArtifact?: boolean;
  /** Despark: "mana value 4 or greater". */
  minManaValue?: number;
}

export type BotEffectSpec =
  /** Destroy the best creature on the player's board. */
  | { kind: 'destroyCreature'; restrict?: TargetRestriction }
  /**
   * Same, but the card leaves for exile instead of the graveyard.
   *
   * `victimGainsPower` is Swords to Plowshares' price: the creature's
   * controller gains life equal to its power. Skipped, a Swords on your 8/8
   * was a strictly better card than the one printed.
   */
  | { kind: 'exileCreature'; restrict?: TargetRestriction; victimGainsPower?: boolean }
  /**
   * Destroy the best permanent — or, with `count`, the best several. `restrict`
   * narrows the pool exactly as it does for creatures, and matters more here:
   * Terastodon reads "noncreature", and a bot that pointed it at your commander
   * was casting a card that does not exist.
   *
   * `exile` sends it to exile instead, which also means indestructible does
   * not save it. `eachType` is Casualties of War — one artifact, one creature,
   * one enchantment, one land and one planeswalker, each its own target.
   *
   * `grants` names the token the VICTIM creates for each permanent removed:
   * Beast Within's Beast, Terastodon's Elephants. The drawback is the card, and
   * skipping it turned a Beast Within into a one-mana Vindicate.
   */
  | {
      kind: 'destroyPermanent';
      restrict?: TargetRestriction;
      count?: number;
      exile?: boolean;
      eachType?: boolean;
      grants?: string;
    }
  /**
   * Destroy creatures. `maxToughness` models a -X/-X sweeper like Languish,
   * which only kills what it is big enough to kill; omit it for an
   * unconditional wrath.
   *
   * `oneSided` is for the sweepers that only hit your opponents — a Massacre
   * Wurm. Without it the engine would kill the bot's own board too, which is
   * both wrong and the reason the bot would then refuse to cast it.
   */
  | {
      kind: 'boardWipe';
      maxToughness?: number;
      oneSided?: boolean;
      /** Necromantic Selection: after the wrath, the bot returns this many bodies. */
      thenReanimate?: number;
    }
  /**
   * Destroy every artifact on the player's board. `enchantments` takes those
   * too, and `symmetric` means the bot's own go with them — Bane of Progress
   * reads "destroy all", and a bot whose Sol Ring survived its own Bane was
   * getting a one-sided card the deck does not contain.
   */
  | { kind: 'artifactSweep'; enchantments?: boolean; symmetric?: boolean }
  /**
   * The player sacrifices — they'd pick their worst, so the bot takes the
   * worst. `symmetric` is "each player sacrifices": the bot gives one up too.
   */
  | { kind: 'edict'; symmetric?: boolean }
  /**
   * N damage: kills a creature it can, otherwise goes to the face — unless
   * `creatureOnly`, for the burn that reads "target creature" and cannot be
   * pointed at you at all. A Mizzium Mortars to the face was a rules break a
   * player notices on the spot.
   */
  | { kind: 'damage'; amount: number; creatureOnly?: boolean }
  /**
   * Straight life loss. `perSubtype` scales it by how many permanents with that
   * subtype the BOT controls — "each opponent loses X life, where X is the
   * number of Zombies you control". A fixed number would make The Scarab God a
   * 5-mana Lava Spike on a board of twelve zombies, which is the opposite of
   * what that card is feared for.
   *
   * `perDevotion` scales it by the bot's devotion to that colour instead —
   * Gray Merchant. Same reasoning: pinned at its floor of 2 it was a five-mana
   * Shock, when the whole reason a mono-black deck plays it is that by the time
   * it lands the board has made it a Lava Axe.
   *
   * `eachOpponent` bills every seat rather than the one worth hitting most.
   * That is what "each opponent loses 2 life" says, and at a four-player table
   * it is three times the card. Opt-in, because the default pick-a-victim
   * behaviour is right for the drains that really are single-target.
   *
   * `noGain` is for the half-drains: Deathrite Shaman's black mode takes two
   * off each opponent and gives its controller nothing. Without it the bot
   * quietly gained life the card does not give it.
   */
  | {
      kind: 'drain';
      amount: number;
      perSubtype?: string;
      perDevotion?: DevotionColor;
      eachOpponent?: boolean;
      noGain?: boolean;
      /**
       * Jarad: "each opponent loses life equal to the sacrificed creature's
       * power". The amount is read off the creature the ability eats — see
       * `BotActivatedEntry.sacrifices` — so `amount` is ignored.
       */
      perSacrificedPower?: boolean;
    }
  /**
   * The bot gains life and nobody else is touched.
   *
   * It lives with the player-facing effects rather than the self ones because
   * a bot's life total is the store's to write — the engine's own frames are
   * snapshots planned before you got to respond, so anything they said about
   * life would clobber the burn you just pointed at them. `AppliedEffect`
   * already carries a `lifeGain` that the store credits to the caster, and
   * this is the spec that produces one on its own.
   */
  | { kind: 'gainLife'; amount: number }
  /** Discard at random from the player's hand. */
  | { kind: 'discard'; count: number };

export interface BotEffectEntry {
  spec: BotEffectSpec;
  /**
   * True when the card is a permanent whose effect fires on arrival. It's cast
   * onto the bot's board AND resolves its effect, rather than going to their
   * graveyard like an instant or sorcery.
   */
  etb?: boolean;
}

export const BOT_EFFECTS: Record<string, BotEffectEntry> = {
  // ── Spot removal ──
  'Murder':                { spec: { kind: 'destroyCreature' } },
  // "Destroy target nonblack creature."
  'Doom Blade':            { spec: { kind: 'destroyCreature', restrict: { notColors: ['B'] } } },
  // "Destroy target nonartifact creature."
  'Go for the Throat':     { spec: { kind: 'destroyCreature', restrict: { notArtifact: true } } },
  "Hero's Downfall":       { spec: { kind: 'destroyCreature' } },
  'Swords to Plowshares':  { spec: { kind: 'exileCreature', victimGainsPower: true } },
  'Path to Exile':         { spec: { kind: 'exileCreature' } },
  // "Its controller creates a 3/3 green Beast creature token." You get the Beast.
  'Beast Within':          { spec: { kind: 'destroyPermanent', grants: 'Beast' } },
  "Assassin's Trophy":     { spec: { kind: 'destroyPermanent' } },
  'Putrefy':               { spec: { kind: 'destroyCreature' } },
  // Really shuffles it into the library and may flip a permanent back out.
  // The player-side move path has no library target, so it is a destroy.
  'Chaos Warp':            { spec: { kind: 'destroyPermanent' } },
  'Infernal Grasp':        { spec: { kind: 'destroyCreature' } },
  // "...target creature with total power and toughness 5 or less."
  'Cut Down':              { spec: { kind: 'destroyCreature', restrict: { maxTotalPT: 5 } } },
  // ── Eternal Might ──
  'Damn':                  { spec: { kind: 'destroyCreature' } },
  // "Exile target permanent with mana value 4 or greater."
  'Despark':               { spec: { kind: 'destroyPermanent', exile: true, restrict: { minManaValue: 4 } } },
  // Modelled as its Swift End half. The body comes with it, which is generous
  // — the real card is one or the other — but it is a 3-mana removal spell
  // either way and pretending it is a vanilla 2/3 was worse.
  // An Adventure: "Swift End" is an instant cast on its own, and the creature
  // half is cast later out of exile for its own price. `etb: true` collapsed
  // both into one cast — the bot got a 2/3 lifelink body stapled to its
  // removal. Modelled as the removal spell, which is what it is cast for.
  'Murderous Rider // Swift End': { spec: { kind: 'destroyCreature' } },
  'Never // Return':       { spec: { kind: 'destroyCreature' } },
  // ── Sultai Arisen ──
  // One of each: artifact, creature, enchantment, land, planeswalker.
  'Casualties of War':     { spec: { kind: 'destroyPermanent', eachType: true } },
  // Always kicked (see BOT_COSTS): "exile target nonland permanent".
  'Tear Asunder':          { spec: { kind: 'destroyPermanent', exile: true, restrict: { nonland: true } } },
  'Lethal Scheme':         { spec: { kind: 'destroyCreature' } },
  // Destroys everything, the bot's board included, then returns one creature
  // — the bot's own best, where the real card may take yours.
  'Necromantic Selection': { spec: { kind: 'boardWipe', thenReanimate: 1 } },
  'Living Death':          { spec: { kind: 'boardWipe', thenReanimate: 3 } },

  // ── Mirror Break (bracket 4) ──
  'Terminate':             { spec: { kind: 'destroyCreature' } },
  'Bedevil':               { spec: { kind: 'destroyPermanent' } },
  // ── Old-Growth Stampede (bracket 3) ──
  // "Up to three target noncreature permanents", and you get a 3/3 Elephant for
  // each. Lands are only ever a last resort — see `resolveEffect` — because a
  // player does not hand out three Elephants for three basics.
  'Terastodon':            { spec: { kind: 'destroyPermanent', count: 3, restrict: { noncreature: true }, grants: 'Elephant' }, etb: true },
  // "Destroy all artifacts and enchantments" — everyone's, the bot's Sol Ring
  // included. The +1/+1 counters it grows are not modelled.
  'Bane of Progress':      { spec: { kind: 'artifactSweep', enchantments: true, symmetric: true }, etb: true },

  // ── Burn ──
  'Lightning Bolt':        { spec: { kind: 'damage', amount: 3 } },
  'Shock':                 { spec: { kind: 'damage', amount: 2 } },
  // ── Prismari Performance (bracket 2) ──
  'Lightning Strike':      { spec: { kind: 'damage', amount: 3 } },
  'Fire Prophecy':         { spec: { kind: 'damage', amount: 3, creatureOnly: true } },
  // "3 damage to a creature, or destroy an artifact." The bot only ever wants
  // the first half, so that is the half it knows.
  'Abrade':                { spec: { kind: 'damage', amount: 3, creatureOnly: true } },
  // Also draws a card. BOT_EFFECTS is strictly player-facing and a card lives
  // in one map or the other, so the damage is the half modelled — it is the
  // half that decides whether the spell is worth casting.
  'Electrolyze':           { spec: { kind: 'damage', amount: 2 } },
  // X spells. See BOT_COSTS for what the bot actually pays; the amounts here
  // are written to match those numbers.
  'Crackle with Power':    { spec: { kind: 'damage', amount: 5 } },
  // {X}{R}{R} for the five in BOT_COSTS is X=3, one target.
  'Comet Storm':           { spec: { kind: 'damage', amount: 3 } },
  // "8 damage divided among X target creatures and/or planeswalkers" — all of
  // it into one creature, which is how the engine points damage anyway. Never
  // the face: the card cannot go there.
  'Meteor Swarm':          { spec: { kind: 'damage', amount: 8, creatureOnly: true } },
  // "4 damage to target creature you don't control" — damage, not a destroy:
  // it does not kill an 8/8, and it cannot be aimed at you.
  'Mizzium Mortars':       { spec: { kind: 'damage', amount: 4, creatureOnly: true } },

  // ── Sweepers ──
  'Blasphemous Act':       { spec: { kind: 'boardWipe' } },
  'Crux of Fate':          { spec: { kind: 'boardWipe' } },
  'Languish':              { spec: { kind: 'boardWipe', maxToughness: 4 } },
  'Vandalblast':           { spec: { kind: 'artifactSweep' } },

  // ── Attrition ──
  // Sign in Blood lives in BOT_SELF_EFFECTS now: it draws the bot two cards
  // rather than pinging you for two, which is what a player would do with it.
  'Agonizing Remorse':     { spec: { kind: 'discard', count: 1 } },
  'Mind Rot':              { spec: { kind: 'discard', count: 2 } },
  'Hymn to Tourach':       { spec: { kind: 'discard', count: 2 } },
  'Thought Erasure':       { spec: { kind: 'discard', count: 1 } },

  // ── Permanents that do something on arrival ──
  'Ravenous Chupacabra':   { spec: { kind: 'destroyCreature' }, etb: true },
  // Both of these are "destroy target nonartifact, nonblack creature" — the
  // Nekusar-era drawback that is the price of stapling removal to a body.
  'Bone Shredder':         { spec: { kind: 'destroyCreature', restrict: { notColors: ['B'], notArtifact: true } }, etb: true },
  'Gray Merchant of Asphodel': { spec: { kind: 'drain', amount: 1, perDevotion: 'B' }, etb: true },
  // Sheoldred and Goblin Trashmaster used to be here as one-shot ETBs — an
  // edict and a full artifact sweep on arrival, neither of which is on the
  // card. Sheoldred is a recurring edict (BOT_RECURRING_EFFECTS) plus an
  // upkeep reanimation (BOT_SELF_EFFECTS); Trashmaster is a lord
  // (BOT_STATICS) with a sacrifice-a-Goblin ability (BOT_ACTIVATED).
  'Shriekmaw':             { spec: { kind: 'destroyCreature', restrict: { notColors: ['B'], notArtifact: true } }, etb: true },
  // Both: "exile target nonland permanent an opponent controls until this
  // leaves the battlefield". The exile and the nonland clause are modelled; the
  // card coming back when you kill the source is not — it stays exiled.
  'Angel of Sanctions':    { spec: { kind: 'destroyPermanent', exile: true, restrict: { nonland: true } }, etb: true },
  'Cast Out':              { spec: { kind: 'destroyPermanent', exile: true, restrict: { nonland: true } }, etb: true },
  // "Each player sacrifices" — the bot gives one up too, the Marauder itself if
  // that is its worst creature, which is often exactly the play.
  'Fleshbag Marauder':     { spec: { kind: 'edict', symmetric: true }, etb: true },
  'Noxious Gearhulk':      { spec: { kind: 'destroyCreature' }, etb: true },
  'Amphin Mutineer':       { spec: { kind: 'exileCreature' }, etb: true },
  // -2/-2 to your side only. One-sided, so unlike a wrath it never eats the
  // bot's own board — which is why it is here and not with the sweepers.
  'Massacre Wurm':         { spec: { kind: 'boardWipe', maxToughness: 2, oneSided: true }, etb: true },
};

export function lookupEffect(cardName: string): BotEffectEntry | undefined {
  return BOT_EFFECTS[cardName];
}

/**
 * What a card does to the BOT's own board. Kept apart from `BOT_EFFECTS`
 * because that map is strictly player-facing: the store applies those, and the
 * engine applies these. A card appears in at most one of the two.
 */

/** One kind of token a card makes. */
/**
 * What a restricted regrow is allowed to take back, as type-line words: any one
 * of them matching is enough, so ['instant', 'sorcery'] reads the way the cards
 * that say it do.
 */
export interface RegrowWant {
  types: string[];
}

/**
 * What a restricted reanimate may stand back up. Keyed on a subtype rather than
 * a card type, because the printed restrictions are tribal — "return up to X
 * target Zombie cards from your graveyard".
 */
export interface ReanimateWant {
  subtype?: string;
}

/** Is this card a legal pick for a reanimate? Creature-ness is checked separately. */
export function reanimateMatches(card: ScryfallCard, want?: ReanimateWant): boolean {
  if (!want?.subtype) return true;
  return getFrontFaceTypeLine(card).toLowerCase().includes(want.subtype.toLowerCase());
}

/**
 * Is this card a legal pick for a regrow?
 *
 * Unrestricted regrows still skip lands — a Witness that hands back a Mountain
 * has wasted the card — but a restriction that names lands overrides that,
 * because Grapple with the Past genuinely wants the option.
 */
export function regrowMatches(card: ScryfallCard, want?: RegrowWant): boolean {
  const line = getFrontFaceTypeLine(card).toLowerCase();
  if (!want) return !line.includes('land');
  return want.types.some(t => line.includes(t));
}

export interface TokenSpec {
  /** Token creature name, matched against the deck's fetched token pool. */
  name: string;
  /** How many copies. */
  count: number;
  /**
   * When set, `count` is ignored and the number made instead equals how many
   * permanents with this subtype the bot controls — Krenko's whole deal.
   */
  countPerSubtype?: string;
  /**
   * Which same-named token this spec means.
   *
   * A name is not a unique key. Old-Growth Stampede holds two Beast tokens —
   * Beast Within's 3/3, which the bot can never make, and Rampaging Baloths'
   * 4/4 — and matching on name alone handed Baloths the 3/3, which then failed
   * Goreclaw's "power 4 or greater" and missed both the pump and the trample.
   * Goblin decks have the same problem with Rabblemaster's hasty Goblin.
   */
  power?: string;
  toughness?: string;
  keyword?: string;
}

export type BotSelfSpec =
  /** Put token creatures onto the bot's battlefield. */
  | { kind: 'makeTokens'; tokens: TokenSpec[] }
  /** Draw cards. Approximates every "look at the top N and take some" too. */
  | { kind: 'draw'; count: number }
  /**
   * Copy a token already on the bot's board — populate. Does nothing with no
   * token to copy, which is exactly how the mechanic reads.
   */
  | { kind: 'populate'; count: number }
  /** Return creature cards from the bot's graveyard to its battlefield. */
  | { kind: 'reanimate'; count: number; want?: ReanimateWant; tapped?: boolean }
  /**
   * Mill the bot's own library into its own graveyard. Pure setup: it does
   * nothing on its own, it is what gives `reanimate` something to return.
   */
  | { kind: 'selfMill'; count: number }
  /**
   * Search the library. `want` narrows what is legal to find — leave it empty
   * for an unrestricted tutor. What it actually picks is decided in the engine,
   * and that choice is where a tutor earns its keep: a missing combo piece
   * first, then a card the bot knows how to use, then the biggest thing.
   */
  | {
      kind: 'tutor';
      /** `name` is an exact card — a Gate to the Afterlife knows what it wants. */
      want?: { subtype?: string; type?: string; name?: string };
      to: 'hand' | 'battlefield';
      count: number;
    }
  /**
   * Return a card from the bot's graveyard to its HAND — Eternal Witness.
   *
   * `want` is the printed restriction. Without it the pick is any nonland card,
   * which is right for the Witnesses ("return target card") and wrong for
   * everything else: an unrestricted regrow had Phyrexian Reclamation, which
   * reads "target creature card", buying back instants.
   */
  | { kind: 'regrow'; count: number; want?: RegrowWant }
  /**
   * "When this dies, return IT to its owner's hand" — The Scarab God.
   *
   * Distinct from `regrow` because the card it returns is the one that died,
   * not the best thing in the graveyard. As a `regrow` it was handing the deck
   * back whatever happened to be on top of the yard instead.
   */
  | { kind: 'returnSelf' }
  /**
   * The bot gains life from its own trigger — Pelakka Wurm's arrival.
   *
   * Distinct from the player-facing `gainLife` in `BotEffectSpec`, which is
   * routed through an AppliedEffect and therefore through the targeting rules:
   * a Pelakka Wurm registered there would be "held for a live target" forever
   * and never cast at all. This one bills straight onto the frame's
   * `selfLifeGain`, the channel a Wayward Servant already uses.
   */
  | { kind: 'gainLifeSelf'; amount: number }
  /**
   * The bot pays its own life — an Undead Augur's draw, a tutor's cost.
   *
   * There was no self-life-LOSS member at all, so every card that bills its
   * controller was strictly better for a bot than for a player: a Dreadhorde
   * Invasion amassed nine times across a game and cost nothing.
   */
  | { kind: 'payLife'; amount: number }
  /**
   * The bot discards. Temmet's "draw a card, then discard a card" and Champion
   * of Wits' rummage both modelled only the half that helps.
   */
  | {
      kind: 'selfDiscard';
      count: number;
      /**
       * What the discard is allowed to take. Floral Evoker's cost is "discard a
       * CREATURE card"; unrestricted, the picker pitched a land first — which in
       * a deck that returns lands from its graveyard is an upgrade, not a price.
       */
      want?: RegrowWant;
    }
  /**
   * Meren's end step: return a creature card from the graveyard to the
   * BATTLEFIELD if its mana value is at most the bot's experience counters,
   * otherwise to hand.
   *
   * A plain `reanimate` skipped the gate, so a turn-four Meren with no
   * experience was standing five-drops straight back up.
   */
  | { kind: 'recurExperience'; count: number }
  /**
   * Search out a land and put it straight onto the battlefield. Separate from
   * `tutor`, which deliberately never fetches lands: this one only fetches them.
   */
  | { kind: 'fetchLand'; count: number; tapped?: boolean; to?: 'hand' | 'battlefield' }
  /**
   * Amass N — put N +1/+1 counters on your Army, creating a 0/0 Zombie Army
   * token first if you have none.
   *
   * One spec for most of a deck: half of Eternal Might amasses, and the
   * mechanic needs nothing new underneath it. The Army is an ordinary token and
   * the counters are ordinary +1/+1 counters, both of which `botPower` already
   * reads — so a single growing threat falls out of machinery that exists.
   */
  | { kind: 'amass'; count: number }
  /**
   * Put land cards from the bot's own GRAVEYARD onto the battlefield.
   *
   * The mirror of `fetchLand`, which only ever reaches into the library. A
   * self-mill deck buries its own lands by the fistful, and until this existed
   * every card that dug them back out — Teval's attack trigger, Will of the
   * Sultai, Conduit of Worlds — was a blank. It is also the deck's real ramp:
   * milling five cards puts roughly two lands in the yard, and reclaiming them
   * is faster than drawing them.
   *
   * `to` matters more than it looks. Straight onto the battlefield is a burst
   * of mana this turn; back to hand is a land drop banked for each of the next
   * few turns. Life from the Loam is the second and Teval is the first, and
   * collapsing them into one would have made one of the two cards a lie.
   */
  | { kind: 'reclaimLands'; count: number; to: 'hand' | 'battlefield'; tapped?: boolean }
  /**
   * "…gets +1/+1 and gains trample until end of turn." A pump that expires,
   * which is the one thing none of the other stat machinery could express.
   *
   * The board already had three permanent ways to be bigger — counters,
   * anthems and a `CardEdit` — and a commander whose whole trigger is a
   * temporary buff could use none of them. An anthem is a static read off a
   * permanent that is always there; a counter never goes away. So this writes
   * a `tempBoost` onto each matching permanent and combat clears it.
   *
   * `minPower` is measured LIVE, against the power the creature has right now
   * with its counters and anthems counted — Goreclaw's "power 4 or greater"
   * is supposed to turn on for a 3/3 wearing a +1/+1 counter, and reading the
   * printed number would have quietly excluded half the board it exists for.
   */
  | {
      kind: 'pump';
      power: number;
      toughness: number;
      /** Only creatures whose live power is at least this. */
      minPower?: number;
      /** Only creatures of this subtype — Temmet pumps Zombies, not the board. */
      subtype?: string;
      /** Keywords granted for the turn alongside the stats. */
      keywords?: CombatKeyword[];
      /** Haste for the turn — see TempBoost.haste for why it is not a keyword. */
      haste?: boolean;
      /**
       * Pumps ONLY the permanent the trigger sits on, by `power` for each other
       * attacking creature of this subtype — Goblin Rabblemaster's "+1/+0 for
       * each other attacking Goblin". A board-wide pump cannot say that, which
       * is why the trigger was missing rather than approximated.
       */
      selfPerAttacking?: string;
    };

export interface BotSelfEntry {
  /**
   * What it does. A list when one trigger does several things at once — Teval
   * mills three AND returns a land, and splitting that across two registry
   * entries would mean the card could only ever be half-understood.
   *
   * Optional only so a card whose ONLY trigger is `onAttack` — Emmara, who does
   * nothing until she is tapped — can say that without inventing a no-op spec.
   */
  spec?: BotSelfSpec | BotSelfSpec[];
  /**
   * 'cast'   — fires as the card resolves. This is the default.
   * 'combat' — fires from the battlefield at the start of every combat, so a
   *            Rabblemaster keeps producing rather than doing it once.
   * 'attack' — fires only when the source itself attacks. The distinction from
   *            'combat' is the whole card for an attack trigger: a bot holding
   *            Teval home as a blocker should not be milling as if it swung.
   */
  timing?: 'cast' | 'combat' | 'attack';
  /**
   * Skip the turn this permanent arrived.
   *
   * Several upkeep triggers are mapped onto the combat beat because the engine
   * has no upkeep — close enough in cadence, but an upkeep has already passed
   * by the time you cast the card, so firing on the arrival turn is a free
   * extra activation the real card never gets. `tapsSource` entries are already
   * covered by the summoning-sickness rule; this is for the rest.
   */
  skipArrivalTurn?: boolean;
  /**
   * A second trigger on the same card, fired when it attacks.
   *
   * `timing` picks one beat, and a card like Goblin Rabblemaster genuinely has
   * two triggers — a token at the beginning of combat and a pump when it
   * attacks. Registering it twice is impossible: this map is keyed by name.
   */
  onAttack?: BotSelfSpec | BotSelfSpec[];
  /**
   * Where the spell itself goes once it resolves. Blue Sun's Zenith shuffles
   * back into its library, so nothing in the deck can regrow it — left in the
   * graveyard it became a repeatable draw-3 the deck does not contain.
   */
  selfDestination?: 'library';
  /** A 'combat' source that taps to do this — Krenko does, Rabblemaster does not. */
  tapsSource?: boolean;
  /**
   * Battalion and friends: an 'attack' trigger that only fires when the seat
   * swung with at least this many creatures, counting the source.
   *
   * Worth checking rather than assuming, because the ability it hands out is
   * usually first strike — and a first striker its blocker cannot kill first
   * takes no damage at all. A trigger that fires when it should not therefore
   * does not merely overstate the bot's board, it silently eats the blocker
   * the player put in front of it.
   */
  requiresAttackers?: number;
  /**
   * An additional cost paid on cast. 'creature' sacrifices the bot's cheapest
   * creature — Diabolic Intent — and the card is held while there is nothing
   * to sacrifice, because a bot casting it onto an empty board on turn three
   * was reading the tutor and ignoring the price.
   */
  sacrifice?: 'creature';
}

/** Every spec an entry carries, whether it was written as one or as a list. */
export function specsOf(entry: { spec?: BotSelfSpec | BotSelfSpec[] }): BotSelfSpec[] {
  if (!entry.spec) return [];
  return Array.isArray(entry.spec) ? entry.spec : [entry.spec];
}

export const BOT_SELF_EFFECTS: Record<string, BotSelfEntry> = {
  // ── Goblins ──
  'Krenko, Mob Boss':     { spec: { kind: 'makeTokens', tokens: [{ name: 'Goblin', count: 1, countPerSubtype: 'goblin' }] }, timing: 'combat', tapsSource: true },
  // Two triggers on one card. The token is the beginning-of-combat half; the
  // pump is "whenever this attacks, it gets +1/+0 for each OTHER attacking
  // Goblin", which on this deck's boards is +20 or more on an unblocked body
  // and was missing entirely because one entry could only name one beat.
  'Goblin Rabblemaster':  {
    // "create a 1/1 red Goblin creature token WITH HASTE" — a different token
    // from the plain Goblins the rest of the deck makes.
    spec: { kind: 'makeTokens', tokens: [{ name: 'Goblin', count: 1, keyword: 'haste' }] },
    timing: 'combat',
    onAttack: { kind: 'pump', power: 1, toughness: 0, selfPerAttacking: 'goblin' },
  },
  "Krenko's Command":     { spec: { kind: 'makeTokens', tokens: [{ name: 'Goblin', count: 2 }] } },
  /*
   * "Battalion — whenever this and at least two other creatures attack,
   * creatures you control gain first strike and trample until end of turn."
   *
   * First strike across a goblin swarm is the card: it turns every even trade
   * into a free one. Which is exactly why the count is now checked — granting
   * it off a two-creature swing does not just overstate the board, it makes
   * the bot's attacker survive a block that should have killed it, with
   * nothing on screen to say why.
   */
  'Legion Loyalist':      {
    spec: { kind: 'pump', power: 0, toughness: 0, keywords: ['firstStrike', 'trample'] },
    timing: 'attack',
    requiresAttackers: 3,
  },
  /*
   * "Kicker {R}. When this enters, if it was kicked, creatures you control get
   * +1/+0 and gain haste until end of turn."
   *
   * Always cast kicked — the price is in BOT_COSTS, and nobody plays this card
   * for the 1/1 body. Both halves are modelled; `TempBoost.haste` is where an
   * until-end-of-turn grant lives.
   */
  'Goblin Bushwhacker':   { spec: { kind: 'pump', power: 1, toughness: 0, haste: true } },
  'Dragon Fodder':        { spec: { kind: 'makeTokens', tokens: [{ name: 'Goblin', count: 2 }] } },
  'Mogg War Marshal':     { spec: { kind: 'makeTokens', tokens: [{ name: 'Goblin', count: 1 }] } },
  'Goblin Instigator':    { spec: { kind: 'makeTokens', tokens: [{ name: 'Goblin', count: 1 }] } },
  'Beetleback Chief':     { spec: { kind: 'makeTokens', tokens: [{ name: 'Goblin', count: 2 }] } },
  'Siege-Gang Commander': { spec: { kind: 'makeTokens', tokens: [{ name: 'Goblin', count: 3 }] } },
  'Goblin Ringleader':    { spec: { kind: 'draw', count: 2 } },
  // "Search your library for a Goblin card" — the reason a goblin deck ever
  // assembles anything. Unhandled, this was a 3-mana do-nothing.
  'Goblin Matron':        { spec: { kind: 'tutor', want: { subtype: 'goblin' }, to: 'hand', count: 1 } },

  // ── Selesnya tokens ──
  'Raise the Alarm':      { spec: { kind: 'makeTokens', tokens: [{ name: 'Soldier', count: 2 }] } },
  'Call the Cavalry':     { spec: { kind: 'makeTokens', tokens: [{ name: 'Knight', count: 2 }] } },
  // X spells: X is fixed by the cost override in BOT_COSTS, and these counts match it.
  'Secure the Wastes':    { spec: { kind: 'makeTokens', tokens: [{ name: 'Warrior', count: 4 }] } },
  'March of the Multitudes': { spec: { kind: 'makeTokens', tokens: [{ name: 'Soldier', count: 4 }] } },
  'Advent of the Wurm':   { spec: { kind: 'makeTokens', tokens: [{ name: 'Wurm', count: 1 }] } },
  'Armada Wurm':          { spec: { kind: 'makeTokens', tokens: [{ name: 'Wurm', count: 1 }] } },
  "Trostani's Summoner":  { spec: { kind: 'makeTokens', tokens: [
    { name: 'Knight', count: 1 }, { name: 'Centaur', count: 1 }, { name: 'Rhino', count: 1 },
  ] } },
  'Wall of Blossoms':     { spec: { kind: 'draw', count: 1 } },
  // "Whenever Emmara becomes tapped" — attacking taps it, so combat timing with
  // tapsSource is close enough to the real trigger without modelling taps.
  // "Whenever Emmara becomes tapped, create a 1/1 Soldier with lifelink." She
  // has no tap ability of her own, so `tapsSource` on the combat beat tapped
  // her before attackers were even chosen — she made her token with certainty
  // and then never attacked in any game. Attacking is what taps her.
  'Emmara, Soul of the Accord': { onAttack: { kind: 'makeTokens', tokens: [{ name: 'Soldier', count: 1 }] } },

  // ── Golgari ──
  // "Whenever this creature ENTERS OR ATTACKS, create two 2/2 Zombies."
  'Grave Titan':          {
    spec:     { kind: 'makeTokens', tokens: [{ name: 'Zombie', count: 2 }] },
    onAttack: { kind: 'makeTokens', tokens: [{ name: 'Zombie', count: 2 }] },
  },
  // Really "X insects for creatures in your graveyard". A flat three is close
  // to what a self-milling deck actually has by the time it casts this.
  'Izoni, Thousand-Eyed': { spec: { kind: 'makeTokens', tokens: [{ name: 'Insect', count: 3 }] } },
  // A creature in, two back out — held while there is nothing to sacrifice.
  'Victimize':            { spec: { kind: 'reanimate', count: 2, tapped: true }, sacrifice: 'creature' },
  // "Reveal five, one to hand, the rest to the graveyard." Four milled and one
  // drawn, so the card it keeps is not also a card it lost.
  'Grisly Salvage':       { spec: [{ kind: 'selfMill', count: 4 }, { kind: 'draw', count: 1 }] },
  'Eternal Witness':      { spec: { kind: 'regrow', count: 1 } },
  'Worldly Tutor':        { spec: { kind: 'tutor', want: { type: 'creature' }, to: 'hand', count: 1 } },
  // "Reveal four, a land to hand, the rest to the graveyard." Same shape.
  'Satyr Wayfinder':      { spec: [{ kind: 'selfMill', count: 3 }, { kind: 'draw', count: 1 }] },
  "Stitcher's Supplier":  { spec: { kind: 'selfMill', count: 3 } },

  // ── Eternal Might: amass ──
  // Dreadhorde Invasion amasses every upkeep. Combat timing is the closest beat
  // the engine has to an upkeep trigger, and it fires once a turn either way.
  // "At the beginning of your upkeep, YOU LOSE 1 LIFE and amass Zombies 1."
  'Dreadhorde Invasion':  { spec: [{ kind: 'amass', count: 1 }, { kind: 'payLife', amount: 1 }], timing: 'combat', skipArrivalTurn: true },
  'Gleaming Overseer':    { spec: { kind: 'amass', count: 1 } },
  'Eternal Skylord':      { spec: { kind: 'amass', count: 2 } },
  // "Draw two, then amass X where X is your hand size" — the cost override
  // below fixes X, and four is about what a hand looks like after the draw.
  'Commence the Endgame': { spec: [{ kind: 'draw', count: 2 }, { kind: 'amass', count: 4 }] },

  /*
   * The commander, and half of it was missing. Vigilance means it attacks every
   * turn without giving up its blocking, so the loot trigger is close to
   * guaranteed once it lands — but the card is TWO triggers, and only the first
   * was here: "whenever you attack, draw a card, then discard a card" AND
   * "whenever you draw a card, Zombies you control get +1/+1 until end of turn".
   * Authored as the draw alone, the deck's commander was a 4/4 that cantripped,
   * with no hint of why a zombie deck wants it.
   *
   * Both halves now, as one attack trigger. Two honest shortcuts: the discard is
   * what the hand limit already does at end of turn, and the pump is fired off
   * this draw rather than off every draw the deck makes. The second one
   * undersells the card in a deck with this much card draw, but it fires on the
   * turn it matters — the one where the zombies are swinging.
   */
  "Temmet, Naktamun's Will": {
    spec: [
      { kind: 'draw', count: 1 },
      // "draw a card, THEN DISCARD A CARD". The old comment argued the
      // end-of-turn hand limit collected this anyway; the bot sits on one to
      // three cards most turns, so it never did.
      { kind: 'selfDiscard', count: 1 },
      { kind: 'pump', power: 1, toughness: 1, subtype: 'zombie' },
    ],
    timing: 'attack',
  },
  // "At the beginning of your second main phase, if a player was dealt combat
  // damage by a Zombie this turn, mill three, then return a creature card from
  // your graveyard to your hand." In a deck of zombies, attacking is that
  // condition — so 'attack' timing is the trigger, near enough.
  'Lost Monarch of Ifnir': {
    spec: [
      { kind: 'selfMill', count: 3 },
      // "return a CREATURE card from your graveyard to your hand" — it was
      // taking back Commence the Endgame.
      { kind: 'regrow', count: 1, want: { types: ['creature'] } },
    ],
    timing: 'attack',
  },

  // ── Eternal Might: the horde ──
  // A planeswalker ticking up every turn, which combat timing models exactly.
  // "+1: Create a 2/2 black Zombie creature token. MILL TWO CARDS." The mill
  // matters in a deck whose Rot Hulk and Scarab God eat the graveyard.
  "Liliana, Death's Majesty": { spec: [{ kind: 'makeTokens', tokens: [{ name: 'Zombie', count: 1 }] }, { kind: 'selfMill', count: 2 }], timing: 'combat' },
  // Really one token per creature spell cast; once a turn is the honest average.
  'Dread Summons':        { spec: { kind: 'makeTokens', tokens: [{ name: 'Zombie', count: 3 }] } },
  // "return up to X target ZOMBIE cards from your graveyard, where X is the
  // number of opponents you have". Unrestricted, this was standing the deck's
  // two best non-Zombie bombs back up instead — the picker takes the biggest
  // body, and in this deck that is a Demon and a God. The count stays at two
  // because the engine has no seat count to read X from.
  'Rot Hulk':             { spec: { kind: 'reanimate', count: 2, want: { subtype: 'zombie' } } },
  // The deck's marquee seven-drop: every combat it exiles a creature from the
  // graveyard and gets a hasty 4/4 copy. Reanimation is the honest model — the
  // body comes back and can attack — and 'combat' timing makes it recur, which
  // is the only reason it is worth seven mana.
  "God-Pharaoh's Gift":   { spec: { kind: 'reanimate', count: 1 }, timing: 'combat' },
  // "Zombies you control or Zombie cards in your graveyard, whichever is
  // greater." By the time a six-drop lands in this deck that is comfortably
  // into double figures; five is a closer flat stand-in than three.
  'Prophet of the Scarab': { spec: { kind: 'draw', count: 5 } },
  // "Draw two cards, then discard two cards."
  'Champion of Wits':     { spec: [{ kind: 'draw', count: 2 }, { kind: 'selfDiscard', count: 2 }] },
  // {X}{U}{U} for the five in BOT_COSTS is X=3; the discard is the hand limit's.
  'Pull from Tomorrow':   { spec: { kind: 'draw', count: 3 } },

  // ── Sultai Arisen: filling the graveyard ──
  // A self-mill deck needs its graveyard stocked before anything else it does
  // means anything. The recurring ones use combat timing, the closest beat the
  // engine has to an upkeep trigger.
  'Nyx Weaver':           { spec: { kind: 'selfMill', count: 2 }, timing: 'combat', skipArrivalTurn: true },
  'Crawling Sensation':   { spec: { kind: 'selfMill', count: 2 }, timing: 'combat', skipArrivalTurn: true },
  'Colossal Grave-Reaver': { spec: { kind: 'selfMill', count: 3 }, timing: 'combat' },
  'Diviner of Mist':      { spec: { kind: 'selfMill', count: 4 }, timing: 'combat' },
  'Essence Anchor':       { spec: { kind: 'selfMill', count: 1 }, timing: 'combat' },
  // "Mill three, then you may return a creature or land card to your hand."
  'Grapple with the Past': { spec: [
    { kind: 'selfMill', count: 3 },
    { kind: 'regrow', count: 1, want: { types: ['creature', 'land'] } },
  ] },
  // "Look at four, one to hand, the rest to the graveyard."
  'Forbidden Alchemy':    { spec: [{ kind: 'selfMill', count: 3 }, { kind: 'draw', count: 1 }] },

  // The commander, and it was doing nothing but flying for 4. Its attack
  // trigger is the deck in miniature: mill three, then drag a land back out of
  // the yard. Both halves in one entry, because half of Teval is not Teval.
  'Teval, the Balanced Scale': {
    spec: [{ kind: 'selfMill', count: 3 }, { kind: 'reclaimLands', count: 1, to: 'battlefield', tapped: true }],
    timing: 'attack',
  },

  // ── Sultai Arisen: buying it back ──
  // Lives in BOT_EFFECTS beside Necromantic Selection: "each player exiles all
  // creature cards from their graveyard, THEN SACRIFICES ALL CREATURES THEY
  // CONTROL, then puts all cards they exiled this way onto the battlefield."
  // As a one-sided reanimate the player kept a board they should have lost.
  'Timeless Witness':     { spec: { kind: 'regrow', count: 1 } },
  // Delve, so the real price is the override in BOT_COSTS. "For each player,
  // choose up to one target creature card in that player's graveyard" — so at
  // most ONE may come from the caster's own, which is the only graveyard the
  // engine models. The comment here already said one; the entry said two.
  'Afterlife from the Loam': { spec: { kind: 'reanimate', count: 1 } },
  // Both modes, which is what "you may choose both" means with a commander out
  // — and this deck's commander is a 4-drop that is usually on the board.
  'Will of the Sultai':   { spec: [{ kind: 'selfMill', count: 3 }, { kind: 'reclaimLands', count: 3, to: 'battlefield', tapped: true }] },
  // Exactly what it says. Dredge isn't modelled, so this is the front half of
  // the card only — but the front half is three land drops banked, which is
  // what makes it ramp.
  'Life from the Loam':   { spec: { kind: 'reclaimLands', count: 3, to: 'hand' } },

  // ── Sultai Arisen: ramp ──
  // Five land-fetchers, all the same shape, all previously doing nothing at all.
  // Tapped, and the second basic to hand is not modelled — same card as
  // Kodama's Reach, and it should read the same.
  'Cultivate':            { spec: { kind: 'fetchLand', count: 1, tapped: true } },
  'Rampant Growth':       { spec: { kind: 'fetchLand', count: 1, tapped: true } },
  'Farseek':              { spec: { kind: 'fetchLand', count: 1, tapped: true } },
  // Sacrifices a land for two untapped — net one, which is what is written.
  'Harrow':               { spec: { kind: 'fetchLand', count: 1 } },
  // Same shape as Harrow, tapped: sacrifice one, find two, net one.
  'Springbloom Druid':    { spec: { kind: 'fetchLand', count: 1, tapped: true } },

  // ── Sultai Arisen: cards and bodies ──
  'Treasure Cruise':      { spec: { kind: 'draw', count: 3 } },
  // "Sacrifice another creature, draw X" — the sacrifice is paid; three is
  // about what the bodies in this deck are worth. The life is not modelled.
  // "Sacrifice another creature. You GAIN X LIFE and draw X cards, where X is
  // that creature's power." The sacrifice picker gives up the worst body it
  // controls — reliably a 1-power chump — so a flat three overdrew by two.
  'Disciple of Bolas':    { spec: [{ kind: 'draw', count: 1 }, { kind: 'gainLifeSelf', amount: 1 }], sacrifice: 'creature' },
  'River Kelpie':         { spec: { kind: 'draw', count: 1 }, timing: 'combat' },
  'Kishla Skimmer':       { spec: { kind: 'draw', count: 1 }, timing: 'combat' },
  'Welcome the Dead':     { spec: { kind: 'makeTokens', tokens: [{ name: 'Zombie', count: 2 }] } },
  'Woe Strider':          { spec: { kind: 'makeTokens', tokens: [{ name: 'Goat', count: 1 }] } },
  // "A Plant for each land you control" — `countPerSubtype` already counts
  // permanents by type line, and a land's type line says Land.
  'Avenger of Zendikar':  { spec: { kind: 'makeTokens', tokens: [{ name: 'Plant', count: 1, countPerSubtype: 'land' }] } },

  // ── Old-Growth Stampede (bracket 3) ──
  // Nine ways to find a land, which is the whole deck: the threats are all
  // six-plus and the only question is whether it reaches them a turn early.
  'Wood Elves':           { spec: { kind: 'fetchLand', count: 1 } },
  'Farhaven Elf':         { spec: { kind: 'fetchLand', count: 1, tapped: true } },
  "Kodama's Reach":       { spec: { kind: 'fetchLand', count: 1, tapped: true } },
  "Nature's Lore":        { spec: { kind: 'fetchLand', count: 1 } },
  'Explosive Vegetation': { spec: { kind: 'fetchLand', count: 2, tapped: true } },
  // Untapped, unlike the others — that is what the card is paying for.
  'Skyshroud Claim':      { spec: { kind: 'fetchLand', count: 2 } },
  // "Whenever this enters OR attacks." An entry carries one timing, so this is
  // the ETB, which is the trigger that always happens.
  // "Whenever this creature ENTERS OR ATTACKS, search for up to two lands."
  // Nine attacks in one game fetched nothing until `onAttack` existed.
  'Primeval Titan':       {
    spec:     { kind: 'fetchLand', count: 2, tapped: true },
    onAttack: { kind: 'fetchLand', count: 2, tapped: true },
  },
  'Hornet Queen':         { spec: { kind: 'makeTokens', tokens: [{ name: 'Insect', count: 4 }] } },
  'Harmonize':            { spec: { kind: 'draw', count: 3 } },

  // ── Prismari Performance ──
  // Cantrips are here rather than left unlisted because a non-permanent with no
  // entry is a card the develop step will not cast at all — it would sit in
  // hand forever and the payoffs would never fire.
  'Opt':                  { spec: { kind: 'draw', count: 1 } },
  'Ponder':               { spec: { kind: 'draw', count: 1 } },
  // Draws three and puts two back. Net one card, which is what the bot gets.
  'Brainstorm':           { spec: { kind: 'draw', count: 1 } },
  'Think Twice':          { spec: { kind: 'draw', count: 1 } },
  'Behold the Multiverse': { spec: { kind: 'draw', count: 2 } },
  'Expressive Iteration': { spec: { kind: 'draw', count: 2 } },
  "Chemister's Insight":  { spec: { kind: 'draw', count: 2 } },
  // "Shuffle Blue Sun's Zenith into its owner's library" — it never reaches the
  // graveyard, so the deck's three regrow effects cannot rebuy it every turn.
  "Blue Sun's Zenith":    { spec: { kind: 'draw', count: 3 }, selfDestination: 'library' },
  // Buying a spell back out of the yard is how the deck keeps casting after it
  // has emptied its hand, which is the turn a spellslinger deck usually stalls.
  // All three say "instant or sorcery"; the Gearhulk casts it rather than
  // drawing it, which the engine has nowhere to put, so the card comes back.
  'Ardent Elementalist':  { spec: { kind: 'regrow', count: 1, want: { types: ['instant', 'sorcery'] } } },
  'Mystic Retrieval':     { spec: { kind: 'regrow', count: 1, want: { types: ['instant', 'sorcery'] } } },
  'Torrential Gearhulk':  { spec: { kind: 'regrow', count: 1, want: { types: ['instant'] } } },
  // "Draw a card for each green creature you control" — in this deck, most of
  // the board. Four is what it looks like on the turn a seven-drop resolves.
  // "When this enters, you gain 7 life." The dies-half is in BOT_DEATH_TRIGGERS.
  'Pelakka Wurm':         { spec: { kind: 'gainLifeSelf', amount: 7 } },
  // "Draw a card for each green creature you control" — in a mono-green deck
  // that has just paid seven, most of the board. Six is nearer than four.
  'Regal Force':          { spec: { kind: 'draw', count: 6 } },

  /*
   * The commander's attack trigger: "each creature you control with power 4 or
   * greater gets +1/+1 and gains trample until end of turn."
   *
   * Only its cost-reduction half was modelled, which made it a 4/3 that
   * discounted things — and the discount is the boring half. This deck is
   * nothing but creatures with power 4 or greater, so the trigger is a
   * board-wide anthem plus trample on every turn Goreclaw swings, which is the
   * difference between chump-blocking it and taking the whole attack.
   */
  'Goreclaw, Terror of Qal Sisma': {
    spec: { kind: 'pump', power: 1, toughness: 1, minPower: 4, keywords: ['trample'] },
    timing: 'attack',
  },

  // ── Mirror Break (bracket 4) ──
  // Four tutors, because a two-card combo deck is only as fast as its ability
  // to find the half it is missing — and the tutor logic already prefers a
  // combo piece it is one short of over anything else.
  'Diabolic Intent':      { spec: { kind: 'tutor', to: 'hand', count: 1 }, sacrifice: 'creature' },
  'Grim Tutor':           { spec: [{ kind: 'tutor', to: 'hand', count: 1 }, { kind: 'payLife', amount: 3 }] },
  'Imperial Seal':        { spec: [{ kind: 'tutor', to: 'hand', count: 1 }, { kind: 'payLife', amount: 2 }] },
  // Really puts it on top of the library; the next draw step gets it either
  // way, and the engine has no "top of library" zone to model.
  'Vampiric Tutor':       { spec: [{ kind: 'tutor', to: 'hand', count: 1 }, { kind: 'payLife', amount: 2 }] },
  // "Scry 2, then draw two cards. YOU LOSE 2 LIFE." The scry is not modelled.
  'Read the Bones':       { spec: [{ kind: 'draw', count: 2 }, { kind: 'payLife', amount: 2 }] },
  // An upkeep draw every turn. 'combat' is the closest recurring beat.
  // "you draw a card AND LOSE 1 LIFE" — 142 free triggers across 24 games.
  'Phyrexian Arena':      { spec: [{ kind: 'draw', count: 1 }, { kind: 'payLife', amount: 1 }], timing: 'combat', skipArrivalTurn: true },
  'Solemn Simulacrum':    { spec: { kind: 'fetchLand', count: 1, tapped: true } },

  // ── Dimir ──
  'Baleful Strix':        { spec: { kind: 'draw', count: 1 } },
  'Demonic Tutor':        { spec: { kind: 'tutor', to: 'hand', count: 1 } },
  'Divination':           { spec: { kind: 'draw', count: 2 } },
  "Night's Whisper":      { spec: [{ kind: 'draw', count: 2 }, { kind: 'payLife', amount: 2 }] },
  'Fact or Fiction':      { spec: { kind: 'draw', count: 2 } },
  // Targets itself, as any player would: two cards beats two damage. It used to
  // be a player-facing drain, which handed the bot's own card draw to nobody.
  'Sign in Blood':        { spec: [{ kind: 'draw', count: 2 }, { kind: 'payLife', amount: 2 }] },

  // ── Golgari: Sheoldred ──
  // "At the beginning of your upkeep, return target creature card from your
  // graveyard to the battlefield." Combat timing is the once-a-turn beat; the
  // edict on your upkeep is in BOT_RECURRING_EFFECTS.
  'Sheoldred, Whispering One': { spec: { kind: 'reanimate', count: 1 }, timing: 'combat', skipArrivalTurn: true },
};

export function lookupSelfEffect(cardName: string): BotSelfEntry | undefined {
  return BOT_SELF_EFFECTS[cardName];
}

/**
 * Abilities a bot activates from its own board in its main phase.
 *
 * This is the map that made the slow decks play. Rhys sat on the table for six
 * turns without once making an elf, Trostani never populated, and Meren never
 * recurred anything — so three of the four decks flat-lined the moment they
 * ran out of spells to cast, while goblins doubled every combat.
 *
 * A card may list several abilities; the bot activates the most expensive one
 * it can afford, and each permanent activates at most once per turn.
 */
export interface BotActivatedEntry {
  /** Total mana paid. Colours are ignored here as everywhere else. */
  cost: number;
  /**
   * What it does to the bot's own board. Mutually exclusive with `effect`, and
   * a list when one ability does several things.
   */
  spec?: BotSelfSpec | BotSelfSpec[];
  /**
   * What it does to YOU. Activated abilities used to be self-only, which meant
   * a Necropolis Fiend — a repeatable removal engine, and the best card in its
   * deck — sat on the board as a 4/5 flier and never pointed at anything.
   */
  effect?: BotEffectSpec;
  /** True when activating taps the source, which also stops it attacking. */
  tapsSource?: boolean;
  /** The ability eats its own source — a Sakura-Tribe Elder cashing itself in. */
  sacrificesSelf?: boolean;
  /**
   * Returning the source to hand is part of the cost — Shigeki, Jukai
   * Visionary. Without it the once-per-turn rule made a one-shot ability a
   * permanent engine: a free land and three self-mill every single turn.
   */
  bouncesSelf?: boolean;
  /**
   * The ability eats ANOTHER creature the bot controls. 'creature' gives up
   * the worst, the way a Goblin Trashmaster feeds a token to its ability.
   * 'biggestCreature' gives up the best, because for Jarad the sacrificed
   * creature's power IS the effect, and a player fires it with the fattest
   * thing on the board or not at all — the ability is held until something
   * worth four is there to feed it.
   */
  sacrifices?: 'creature' | 'biggestCreature';
  /**
   * A card the ability exiles from the graveyard as a cost.
   *
   * Two things at once, and both were missing. It GATES the ability — a
   * Deathrite Shaman with no instant or sorcery in a graveyard cannot pick its
   * black mode, and a bot that fired it anyway was drinking from an empty cup
   * on turn two. And it is PAID: the card named here leaves the graveyard for
   * exile, so the fuel runs out the way it does at a real table.
   *
   * 'a graveyard' on these cards means any graveyard. Only the bot's own is
   * modelled — the engine has no read of yours, and no way to move a card out
   * of it if it did — which is the honest shortcut here: in the decks that
   * play these cards the bot's own yard is where the fuel is anyway.
   */
  exiles?: GraveyardCost;
  /**
   * Hold the ability until it is worth using.
   *
   * 'behindOnLands' is for the ramp-on-legs creatures. A player keeps a
   * Sakura-Tribe Elder around as a blocker and only cracks it when they need
   * the land, so a bot that sacrificed it the moment it could would be throwing
   * away a body for nothing.
   *
   * 'graveyardStocked' is for the payoffs that are only worth their cost once
   * the yard is deep — Gate to the Afterlife's real condition is six creature
   * cards in the graveyard, and a bot that ignored it would trade its Gate for
   * a God-Pharaoh's Gift with nothing to reanimate.
   *
   * 'lowLife' is for the mode you only reach for when you are the one under
   * pressure. Gaining two at 40 is not a play; gaining two at 6 can be the
   * turn. It also settles the tie between two modes of the same card — see
   * Deathrite Shaman, where the choice between draining and gaining is
   * exactly "who is closer to dying".
   */
  only?: 'behindOnLands' | 'graveyardStocked' | 'lowLife';
}

/**
 * What an ability eats out of the graveyard to pay for itself.
 *
 * The three Deathrite Shaman modes, which is also every shape the engine has
 * needed so far: a land, a creature card, or an instant or sorcery.
 */
export type GraveyardCost = 'land' | 'creature' | 'instantOrSorcery';

export const BOT_ACTIVATED: Record<string, BotActivatedEntry[]> = {
  // Both of Rhys's abilities. With six mana up it doubles the board instead of
  // making a single elf, which is what the card is actually for.
  'Rhys the Redeemed': [
    { cost: 2, spec: { kind: 'makeTokens', tokens: [{ name: 'Elf Warrior', count: 1 }] }, tapsSource: true },
    { cost: 6, spec: { kind: 'populate', count: 99 }, tapsSource: true },
  ],
  "Trostani, Selesnya's Voice": [
    { cost: 3, spec: { kind: 'populate', count: 1 }, tapsSource: true },
  ],
  // Free and once a turn, which is close enough to "at the beginning of your
  // end step" without needing an end step.
  'Meren of Clan Nel Toth': [
    { cost: 0, spec: { kind: 'recurExperience', count: 1 } },
  ],
  // Ramp on legs. Free, but only cashed in when the bot is actually behind on
  // mana — otherwise it is a blocker worth keeping.
  'Sakura-Tribe Elder': [
    { cost: 0, spec: { kind: 'fetchLand', count: 1, tapped: true }, sacrificesSelf: true, only: 'behindOnLands' },
  ],
  // "{1}{B}, {T}, DISCARD A CARD: create a 2/2 Zombie." The discard is the
  // cost, and a free token every turn is a different card.
  'Cryptbreaker': [
    { cost: 2, spec: [{ kind: 'makeTokens', tokens: [{ name: 'Zombie', count: 1 }] }, { kind: 'selfDiscard', count: 1 }], tapsSource: true },
  ],
  // "Once each turn you may cast a creature spell from your graveyard."
  'Kotis, Sibsig Champion': [
    { cost: 3, spec: { kind: 'reanimate', count: 1 } },
  ],
  // "{1}{B}, PAY 2 LIFE: Return target CREATURE card from your graveyard to
  // your hand." Both the restriction and the cost: unrestricted it was buying
  // back instants, and free it was a rebuy engine with no downside.
  'Phyrexian Reclamation': [
    { cost: 2, spec: [{ kind: 'regrow', count: 1, want: { types: ['creature'] } }, { kind: 'payLife', amount: 2 }] },
  ],
  // "{1}{G}, {T}, return Shigeki to hand: reveal four, a land to the
  // battlefield tapped, the rest to the graveyard." Fetch plus mill; the
  // bounce that makes it replayable is not modelled.
  // "{1}{G}, {T}, RETURN SHIGEKI TO ITS OWNER'S HAND" — the bounce is a cost,
  // which is what makes this once per cast rather than a permanent engine.
  'Shigeki, Jukai Visionary': [
    { cost: 2, spec: [{ kind: 'fetchLand', count: 1, tapped: true }, { kind: 'selfMill', count: 3 }], bouncesSelf: true, tapsSource: true },
  ],
  /*
   * "{1}{B}{G}, sacrifice another creature: each opponent loses life equal to
   * the sacrificed creature's power."
   *
   * This was written as a reanimation, which Jarad does not do. It is the
   * deck's finisher: a Lord of Extinction fed to it is the game. The fodder
   * is the biggest creature and the drain is its power, and the ability waits
   * for a body worth at least four rather than trading a 2/2 for two life.
   */
  'Jarad, Golgari Lich Lord': [
    {
      cost: 3,
      effect: { kind: 'drain', amount: 0, eachOpponent: true, noGain: true, perSacrificedPower: true },
      sacrifices: 'biggestCreature',
    },
  ],

  // ── Golgari ──
  /*
   * Three modes, and the card is the CHOICE between them — it is played as a
   * toolbox, not as a drain that happens to be on a body:
   *
   *   {T}: exile a land from a graveyard → add one mana of any colour.
   *   {B}, {T}: exile an instant or sorcery → each opponent loses 2.
   *   {G}, {T}: exile a creature card → you gain 2.
   *
   * Only the middle one was written down, unconditionally: the bot drained you
   * for 2 every turn whatever was in the graveyard, exiled nothing, and gained
   * 2 life the card does not give it. It could not ramp — the mana mode is in
   * GRAVEYARD_MANA in mana.ts, since a source of mana is not an ability the
   * main phase activates — and it could not stabilise.
   *
   * All three now, each gated on the card it eats. The order here settles a
   * tie between two modes that cost the same: gaining comes first but only
   * fires under 'lowLife', so a healthy bot drains and a bot that is being
   * killed reaches for the other half of its own card.
   */
  'Deathrite Shaman': [
    { cost: 1, effect: { kind: 'gainLife', amount: 2 }, tapsSource: true, exiles: 'creature', only: 'lowLife' },
    {
      cost: 1,
      effect: { kind: 'drain', amount: 2, eachOpponent: true, noGain: true },
      tapsSource: true,
      exiles: 'instantOrSorcery',
    },
  ],

  // ── Eternal Might ──
  // "{2}{U}{B}: Exile a creature card from a graveyard, make a 4/4 Zombie copy
  // of it." Reanimation with extra steps, and the reason this card ends games:
  // left alone it turns every corpse on the table into a 4/4 every turn.
  'The Scarab God': [
    { cost: 4, spec: { kind: 'reanimate', count: 1 } },
  ],
  // Sacrifices itself to fetch God-Pharaoh's Gift straight onto the battlefield
  // — the deck's whole top end for {2}. The real card demands six creature
  // cards in the yard; `only` enforces that, or the bot would cash in its Gate
  // on turn three for a Gift with nothing to reanimate.
  'Gate to the Afterlife': [
    {
      cost: 2,
      spec: { kind: 'tutor', want: { name: "God-Pharaoh's Gift" }, to: 'battlefield', count: 1 },
      tapsSource: true,
      sacrificesSelf: true,
      only: 'graveyardStocked',
    },
  ],

  // ── Sultai Arisen ──
  // "{X}, {T}, exile X cards from your graveyard: target creature gets -X/-X."
  // In a deck that mills itself every turn X is however big it needs to be, so
  // this is simply removal that never runs out.
  'Necropolis Fiend': [
    { cost: 2, effect: { kind: 'destroyCreature' }, tapsSource: true },
  ],
  // "Mill two, then return a nonland card from your graveyard to your hand."
  // The opponent picks which, so the bot gets its worst card back — but a card
  // is a card, and the mill feeds everything else the deck is doing.
  'Tasigur, the Golden Fang': [
    { cost: 4, spec: [{ kind: 'selfMill', count: 2 }, { kind: 'regrow', count: 1 }] },
  ],
  // "{G}, DISCARD A CREATURE CARD: return a land card from your graveyard to
  // the battlefield tapped." The restriction matters as much as the cost: an
  // unrestricted discard pitched a LAND first, which in a deck that returns
  // lands from the graveyard is an upgrade rather than a price.
  'Floral Evoker': [
    { cost: 1, spec: [{ kind: 'reclaimLands', count: 1, to: 'battlefield', tapped: true }, { kind: 'selfDiscard', count: 1, want: { types: ['creature'] } }] },
  ],
  // "You may play lands from your graveyard", plus casting a permanent out of
  // it once a turn. Both are graveyard recursion, and in a self-mill deck the
  // graveyard is the better library.
  'Conduit of Worlds': [
    { cost: 0, spec: { kind: 'reclaimLands', count: 1, to: 'hand' } },
  ],

  // ── Goblins ──
  // "Sacrifice a Goblin: destroy target artifact." Free, one artifact, one
  // goblin — and once a turn, which is the engine's rule for every ability.
  'Goblin Trashmaster': [
    { cost: 0, effect: { kind: 'destroyPermanent', restrict: { onlyArtifact: true } }, sacrifices: 'creature' },
  ],

  // ── Eternal Might ──
  // "{2}{B}, {T}: exile target creature card from a graveyard, make a 2/2
  // Zombie." The bot's own yard, as with Deathrite; gated on there being a
  // creature card in it, and that card is paid.
  'Cemetery Reaper': [
    { cost: 3, spec: { kind: 'makeTokens', tokens: [{ name: 'Zombie', count: 1 }] }, tapsSource: true, exiles: 'creature' },
  ],
};

export function lookupActivated(cardName: string): BotActivatedEntry[] {
  return BOT_ACTIVATED[cardName] ?? [];
}

/**
 * Permanents that change the board just by being there. These are read fresh
 * every time a stat is needed rather than baked into the permanent, so a lord
 * dying immediately shrinks everything it was pumping.
 */
export type BotStaticSpec =
  /** A lord. `subtype` is matched as a substring of the type line. */
  | { kind: 'anthem'; power: number; toughness: number; subtype?: string; includeSelf?: boolean }
  /** Doubles every token the bot makes. Two doublers quadruple, as they should. */
  | { kind: 'tokenDoubler' }
  /**
   * "Goblin spells you cast cost {1} less." Without this a deck built around
   * its cost reducer plays a whole turn behind the curve it was designed for.
   */
  | {
      kind: 'costReducer';
      amount: number;
      subtype?: string;
      /**
       * Only discounts creature spells with at least this much PRINTED power —
       * Goreclaw's "power 4 or greater". Printed, because a spell's power is
       * whatever the card says while it is still on the stack: Multani is a 0/0
       * there however many lands are out.
       */
      minPower?: number;
    }
  /**
   * Grants haste to the bot's creatures. Matters more than it sounds: the attack
   * step skips summoning-sick creatures, so a haste granter is the difference
   * between a threat landing and a threat landing a turn late.
   */
  | { kind: 'grantsHaste'; subtype?: string }
  /**
   * "Creatures you control are every creature type" — a Maskwood Nexus. Every
   * subtype test the bot makes then passes, so its tribal lords pump the whole
   * board instead of half of it. One card, but it changes what every other card
   * in the deck is worth, which is exactly what a bot understanding its own
   * deck has to know.
   */
  | { kind: 'allCreatureTypes' }
  /**
   * Gives every creature the bot controls a combat keyword.
   *
   * Written for Wonder, which grants flying from the GRAVEYARD — see
   * `BOT_GRAVEYARD_STATICS`. An unblockable board is the difference between a
   * self-mill deck durdling and a self-mill deck killing you, and it was
   * invisible: the card was in the yard doing exactly nothing.
   */
  | { kind: 'grantsKeyword'; keyword: CombatKeyword; subtype?: string };

/**
 * A card may carry several statics: Goblin Chieftain is a lord AND a haste
 * granter, Goblin Warchief reduces costs AND grants haste. Values are a single
 * spec or a list of them; read them through `staticsOf`.
 */
export const BOT_STATICS: Record<string, BotStaticSpec | BotStaticSpec[]> = {
  // Reduces instants and sorceries only; `costReducer` without a subtype
  // reduces everything, so this over-applies to the handful of creature spells
  // in the deck. Left as-is deliberately: casting one more spell a turn is the
  // entire reason the card is in a spellslinger deck, and the alternative was
  // not modelling it at all.
  'Goblin Electromancer': { kind: 'costReducer', amount: 1 },
  // "Other Goblins get +1/+1" — includeSelf stays off, so the lord is a 2/2.
  'Goblin King':         { kind: 'anthem', power: 1, toughness: 1, subtype: 'goblin' },
  // "Other Goblins you control get +1/+1" — the sacrifice ability is in BOT_ACTIVATED.
  'Goblin Trashmaster':  { kind: 'anthem', power: 1, toughness: 1, subtype: 'goblin' },
  // "Other Goblins you control get +1/+1 and have haste" — both halves.
  'Goblin Chieftain': [
    { kind: 'anthem', power: 1, toughness: 1, subtype: 'goblin' },
    { kind: 'grantsHaste', subtype: 'goblin' },
  ],
  // Token type lines read "Token Creature — Soldier", so 'token' matches them all.
  // It is an enchantment, not a creature, so includeSelf is harmless and honest.
  'Intangible Virtue':   { kind: 'anthem', power: 1, toughness: 1, subtype: 'token', includeSelf: true },
  'Anointed Procession': { kind: 'tokenDoubler' },
  'Parallel Lives':      { kind: 'tokenDoubler' },
  // ── Eternal Might ──
  'Cemetery Reaper':     { kind: 'anthem', power: 1, toughness: 1, subtype: 'zombie' },
  'Lord of the Accursed': { kind: 'anthem', power: 1, toughness: 1, subtype: 'zombie' },
  // An enchantment, so includeSelf is harmless; it pumps zombies AND tokens,
  // and a zombie deck's tokens are zombies. "...and have flying" is the half
  // that turns the horde into a clock, and it was missing.
  'On Wings of Gold': [
    { kind: 'anthem', power: 1, toughness: 1, subtype: 'zombie', includeSelf: true },
    { kind: 'grantsKeyword', keyword: 'flying', subtype: 'zombie' },
  ],
  // "Zombie tokens you control have flying." A two-word subtype means both
  // words — see `hasSubtype` — so a nontoken Zombie stays on the ground.
  'Eternal Skylord':     { kind: 'grantsKeyword', keyword: 'flying', subtype: 'zombie token' },
  // "Zombie tokens you control have hexproof and menace."
  'Gleaming Overseer': [
    { kind: 'grantsKeyword', keyword: 'hexproof', subtype: 'zombie token' },
    { kind: 'grantsKeyword', keyword: 'menace', subtype: 'zombie token' },
  ],
  // "Choose a creature type" — in this deck that is always Zombie.
  'Renewed Solidarity':  { kind: 'anthem', power: 1, toughness: 0, subtype: 'zombie', includeSelf: true },
  // Black creature spells cost {1} less. There is no colour model, so this is
  // scoped to creatures by matching the type line — near enough in a deck whose
  // creatures are all black.
  "Bontu's Monument":    { kind: 'costReducer', amount: 1, subtype: 'creature' },
  // Turns every one of the lords above into a board-wide anthem.
  'Maskwood Nexus':      { kind: 'allCreatureTypes' },

  // ── Bracket 3 / 4 commanders ──
  // Goreclaw reduces creature spells with power 4+. There is no power test in
  // the cost model, but this deck's creatures are all enormous, so scoping it
  // to creatures is accurate here and nowhere near a blanket discount.
  // "Creature spells you cast WITH POWER 4 OR GREATER cost {2} less." The
  // comment here used to claim the deck's creatures are all enormous, so
  // scoping it to creatures was close enough — 14 of its 25 creatures have
  // printed power under 4, mana dorks included, so the deck was casting its
  // whole early curve two mana light.
  'Goreclaw, Terror of Qal Sisma': { kind: 'costReducer', amount: 2, subtype: 'creature', minPower: 4 },
  // "Other creatures you control get +1/+0" — the death half is a watcher.
  'Judith, the Scourge Diva': { kind: 'anthem', power: 1, toughness: 0 },

  // Does two things, and both of them matter to how the deck curves out.
  'Goblin Warchief': [
    { kind: 'costReducer', amount: 1, subtype: 'goblin' },
    { kind: 'grantsHaste', subtype: 'goblin' },
  ],
};

/** Every static a card carries, whether it was written as one or as a list. */
export function staticsOf(cardName: string): BotStaticSpec[] {
  const entry = BOT_STATICS[cardName];
  if (!entry) return [];
  return Array.isArray(entry) ? entry : [entry];
}

/**
 * Statics that work from the GRAVEYARD.
 *
 * A separate map rather than a flag, because the zone is the whole point: a
 * card here is doing its job precisely when it is dead, and a self-mill deck
 * puts it there on purpose. Wonder is the archetypal one — mill it on turn
 * three and the rest of the deck flies for the rest of the game.
 *
 * The real Wonder also wants an Island in play. Every land in that deck taps
 * for blue and the engine has no colour model, so the condition is dropped
 * rather than faked.
 */
export const BOT_GRAVEYARD_STATICS: Record<string, BotStaticSpec | BotStaticSpec[]> = {
  'Wonder': { kind: 'grantsKeyword', keyword: 'flying' },
};

export function graveyardStaticsOf(cardName: string): BotStaticSpec[] {
  const entry = BOT_GRAVEYARD_STATICS[cardName];
  if (!entry) return [];
  return Array.isArray(entry) ? entry : [entry];
}

/**
 * "When this dies…" — read off the card that died.
 *
 * A deck built on its own creatures dying has to get paid when they do, or its
 * whole plan reads as the bot throwing bodies away for nothing. Junji is the
 * clearest case: a 5/5 flier nobody wants to block, whose death is supposed to
 * be the good half of the card.
 */
export const BOT_DEATH_TRIGGERS: Record<string, BotSelfSpec | BotSelfSpec[]> = {
  // "Draw X where X is the creature cards in target player's graveyard." Its
  // own controller's yard is the deep one in this deck; three is about right
  // by the time a 4-drop is trading.
  // "draw X cards AND YOU LOSE X LIFE" — flattened to three either way, so the
  // life it costs is flattened to match.
  'Corpse Augur': [{ kind: 'draw', count: 3 }, { kind: 'payLife', amount: 3 }],
  // Two modes; the bot always wants the body back off a stocked graveyard.
  // "Choose one — each opponent discards two cards and loses 2 life; or return
  // target NON-DRAGON creature card from a graveyard to the battlefield under
  // your control." The body back is the mode the bot wants; the non-Dragon
  // restriction is not expressible (the want filter matches, it cannot exclude),
  // and this deck's only Dragon is Junji itself, which is in the graveyard.
  'Junji, the Midnight Sky': [{ kind: 'reanimate', count: 1 }, { kind: 'payLife', amount: 2 }],
  // Both of these are cards you are happy to see traded off.
  'Pelakka Wurm':      { kind: 'draw', count: 1 },
  'Solemn Simulacrum': { kind: 'draw', count: 1 },
  // "When this enters OR dies" — the arrival half is in BOT_SELF_EFFECTS.
  'Mogg War Marshal':  { kind: 'makeTokens', tokens: [{ name: 'Goblin', count: 1 }] },
  "Stitcher's Supplier": { kind: 'selfMill', count: 3 },
  // "Return it to its owner's hand at the beginning of the next end step" —
  // a recursion the engine models as simply getting the card back.
  'The Scarab God': { kind: 'returnSelf' },
};

/**
 * "Whenever a creature you control dies…" — read off a permanent that is
 * WATCHING, not off the one that died.
 *
 * The distinction matters: these fire once per death, and a board with two of
 * them fires both. Together they are why a zombie deck's chump blocks are not
 * a concession — every trade draws it a card or bills you a life.
 */
export interface BotDeathWatcher {
  /** Fires only for deaths of creatures matching this subtype, if set. */
  subtype?: string;
  /** Tokens don't count for the "nontoken creature" watchers. */
  nontokenOnly?: boolean;
  /**
   * The watcher sees its own death too. Judith reads "whenever a nontoken
   * creature YOU CONTROL dies" — she qualifies, and a leaves-the-battlefield
   * trigger uses last-known information, so her own death fires it.
   */
  includeSelf?: boolean;
  spec?: BotSelfSpec | BotSelfSpec[];
  /** Player-facing half, e.g. Plague Belcher billing you a life per zombie. */
  effect?: BotEffectSpec;
}

/**
 * "Whenever another creature you control dies, you get an experience counter."
 *
 * A player counter rather than a permanent's, so it lives on the Opponent and
 * survives its source dying — which is the whole point of the mechanic, and why
 * a late Meren reanimates where an early one only draws the card back.
 */
export const BOT_EXPERIENCE_SOURCES = new Set<string>(['Meren of Clan Nel Toth']);

export const BOT_DEATH_WATCHERS: Record<string, BotDeathWatcher> = {
  // "this creature DEALS 1 DAMAGE TO YOU and you draw a card."
  'Midnight Reaper':  { nontokenOnly: true, spec: [{ kind: 'draw', count: 1 }, { kind: 'payLife', amount: 1 }] },
  // "you draw a card AND YOU LOSE 1 LIFE."
  'Undead Augur':     { subtype: 'zombie', spec: [{ kind: 'draw', count: 1 }, { kind: 'payLife', amount: 1 }] },
  // The life loss is on the bot, not you — but a card for a life is a trade a
  // zombie deck makes happily, and the engine only tracks what it draws.
  'Gate to the Afterlife': { nontokenOnly: true, spec: { kind: 'draw', count: 1 } },
  'Plague Belcher':   { subtype: 'zombie', effect: { kind: 'drain', amount: 1, noGain: true } },
  // Judith turns every trade and every chump block into reach. With the
  // anthem above it is why this deck kills through a board rather than around it.
  'Judith, the Scourge Diva': { nontokenOnly: true, includeSelf: true, effect: { kind: 'damage', amount: 1 } },
};

/**
 * Cards the bot may cast straight out of its own graveyard.
 *
 * A recurring threat is one of the most "this player knows their deck" things
 * a bot can do: kill the Gravecrawler and it comes back next turn, and the
 * only way to stop it is to change the board condition. Both entries here are
 * cheap creatures, which is the point — they turn a stocked graveyard into a
 * board that will not stay clear.
 */
export interface BotRecursionEntry {
  /** What it costs to bring back. Gravecrawler is simply recast. */
  cost: number;
  /** Only castable while the bot controls a permanent of this subtype. */
  requiresSubtype?: string;
  /** It returns tapped, so it can't attack or block the turn it comes back. */
  tapped?: boolean;
}

export const BOT_RECURSION: Record<string, BotRecursionEntry> = {
  'Gravecrawler':         { cost: 1, requiresSubtype: 'zombie' },
  'Reassembling Skeleton': { cost: 2, tapped: true },
};

/**
 * Cycling — pay a small cost, pitch the card, get something.
 *
 * Worth a hook of its own because the alternative is a lie in both directions:
 * a six-mana 4/3 that the bot dutifully hard-casts on turn six, when every
 * real player pitches it for two on turn two. Cycling is also what makes the
 * back half of Eternal Might work — a third of the deck would rather be
 * discarded than cast.
 *
 * The bot cycles a card when it can afford the cycling cost and either can't
 * afford to cast it or the cycled mode is simply better.
 */
export interface BotCyclingEntry {
  /** Mana to cycle. Always well under the card's own cost. */
  cost: number;
  /**
   * What cycling gets the bot. Plain cycling draws, so say so explicitly;
   * LANDcycling fetches instead of drawing, which is why this is not defaulted.
   */
  spec?: BotSelfSpec | BotSelfSpec[];
  /** What cycling does to you — Gempalm Polluter's whole reason to exist. */
  effect?: BotEffectSpec;
  /**
   * Prefer cycling even when the card is affordable. True for the ones whose
   * cycled mode IS the card: nobody casts a six-mana Gempalm Polluter.
   */
  preferred?: boolean;
}

export const BOT_CYCLING: Record<string, BotCyclingEntry> = {
  // Landcycling puts the land in HAND, not onto the battlefield — it is a
  // guaranteed land drop, not a Rampant Growth, and modelled as ramp it put
  // the bot a land ahead every time it pitched one.
  'Twisted Abomination': { cost: 2, spec: { kind: 'fetchLand', count: 1, to: 'hand' }, preferred: true },
  'Timeless Dragon':     { cost: 2, spec: { kind: 'fetchLand', count: 1, to: 'hand' } },
  // "Target player loses life equal to the number of Zombies on the
  // battlefield" — on a developed board this is the deck's reach, and it costs
  // two. Hard-casting it for six is strictly worse.
  // Cycling draws, and the trigger drains on top — with no zombies out it is
  // still a two-mana cantrip, which is why it gets pitched either way.
  'Gempalm Polluter':    {
    cost: 2,
    spec: { kind: 'draw', count: 1 },
    effect: { kind: 'drain', amount: 1, perSubtype: 'zombie', noGain: true },
    preferred: true,
  },
  'Archfiend of Ifnir':  { cost: 2, spec: { kind: 'draw', count: 1 } },
};

/**
 * "Whenever a land you control enters" — checked on the bot's land drop.
 *
 * The engine plays one land a turn, so a landfall trigger is close to a
 * once-a-turn upkeep trigger. That is enough to make Ob Nixilis what it is:
 * three life a turn, every turn, from a card that was previously a 3/3.
 */
export const BOT_LANDFALL_EFFECTS: Record<string, BotEffectSpec> = {
  'Ob Nixilis, the Fallen': { kind: 'drain', amount: 3 },
};

/**
 * Landfall that pays the BOT rather than hitting you.
 *
 * The mirror of `BOT_LANDFALL_EFFECTS`, and the reason a ramp deck's ramp is
 * also its threat: every land Old-Growth Stampede finds is another 4/4. One
 * land a turn, so this is a once-a-turn trigger like the rest.
 */
export const BOT_LANDFALL_SELF: Record<string, BotSelfSpec | BotSelfSpec[]> = {
  // "Landfall — whenever a land you control enters, target player mills three."
  // The mill lands on the bot's own library, which is what this deck wants
  // anyway. It was on the combat beat, where it fired once a turn whether or
  // not a land had entered — including off a land played before it arrived.
  'Hedron Crab':         { kind: 'selfMill', count: 3 },
  'Rampaging Baloths': { kind: 'makeTokens', tokens: [{ name: 'Beast', count: 1, power: '4', toughness: '4' }] },
};

/**
 * Effects that fire from the battlefield every turn, aimed at YOU.
 *
 * `BOT_SELF_EFFECTS` already had recurring timings, but they could only ever
 * touch the bot's own board — so the one card in either precon whose whole
 * text is "each opponent loses X life every upkeep" was a 5/5 vanilla. This is
 * the other half of that.
 */
export const BOT_RECURRING_EFFECTS: Record<string, BotEffectSpec> = {
  // X = zombies the bot controls, which in this deck is the whole board.
  'The Scarab God': { kind: 'drain', amount: 1, perSubtype: 'zombie', noGain: true },
  // "At the beginning of each opponent's upkeep, that player sacrifices a
  // creature." Once a turn cycle here rather than once per opponent upkeep —
  // the same count at a two-player table, which is most of them.
  'Sheoldred, Whispering One': { kind: 'edict' },
};

/**
 * Creatures whose printed power is a `*`, plus what it counts.
 *
 * Scryfall prints these as "1+*" or "*", which `parseInt` reads as 1 and 0 —
 * so a Jarad that should be a 7/7 attacks as a 2/2 and reads as a bot that
 * cannot do arithmetic.
 */
export type BotDynamicStat = {
  /**
   * What the `*` counts.
   *
   * `ownGraveyardCreatures` — Jarad.
   * `ownGraveyardCards`     — Lord of Extinction, Consuming Aberration. Both
   *   really count cards in ALL graveyards, or the opponents'; the bot only
   *   knows its own, which under-counts rather than over-counts. In a deck that
   *   mills itself every turn its own graveyard is the big one anyway.
   * `ownLands`              — Multani, which also counts lands in the graveyard.
   * `flat`                   — a straight bonus, for a `*` the engine has no
   *   way to count at all. Honest as a stand-in, unlike counting the wrong pile.
   */
  kind: 'ownGraveyardCreatures' | 'ownGraveyardCards' | 'ownLands' | 'flat';
  power: number;
  toughness: number;
  /**
   * Ceiling on what gets counted.
   *
   * Consuming Aberration counts cards in your OPPONENTS' graveyards, which the
   * engine does not model — and the bot's own graveyard, in the deck that mills
   * itself every turn, is the one pile that is nothing like it. Uncapped it
   * attacked as a 22/22. The cap is a stand-in until rival graveyards exist.
   */
  max?: number;
};

export const BOT_DYNAMIC_STATS: Record<string, BotDynamicStat> = {
  'Jarad, Golgari Lich Lord': { kind: 'ownGraveyardCreatures', power: 1, toughness: 1 },
  // "1 plus the number of card types among cards in your opponents' graveyards."
  // Printed as `1+*`, which parseInt reads as 1, so it attacked as a 1/3. Three
  // card types is what a real graveyard holds by the midgame.
  'Nighthawk Scavenger':      { kind: 'flat', power: 3, toughness: 0 },
  'Lord of Extinction':       { kind: 'ownGraveyardCards', power: 1, toughness: 1 },
  // "equal to the number of cards in your OPPONENTS' graveyards" — not its own,
  // which is the pile this deck spends the game filling. Capped rather than
  // counted off the wrong graveyard; see BotDynamicStat.max.
  'Consuming Aberration':     { kind: 'ownGraveyardCards', power: 1, toughness: 1, max: 8 },
  "Multani, Yavimaya's Avatar": { kind: 'ownLands', power: 1, toughness: 1 },
};

/**
 * "Whenever a creature you control enters...". Checked every time the bot puts
 * a creature onto its battlefield, including each token, which is what makes a
 * goblin deck with a Purphoros out genuinely frightening.
 */
export type BotTriggerSpec =
  | {
      kind: 'creatureEtbDamage';
      amount: number;
      /** Life the BOT gains each time it fires — the other half of a drain. */
      lifeGain?: number;
      /** Only arrivals whose type line contains this word count. */
      subtype?: string;
    }
  /** "Whenever another nontoken creature you control enters, draw a card." */
  | { kind: 'creatureEtbDraw'; count: number; nontokenOnly?: boolean };

export const BOT_TRIGGERS: Record<string, BotTriggerSpec> = {
  'Impact Tremors':              { kind: 'creatureEtbDamage', amount: 1 },
  // The reason a zombie deck's tokens are a clock and not just a board: every
  // body that arrives bills you. Deliberately NOT including Bontu's Monument,
  // which triggers on casting a creature SPELL — tokens are not cast, and
  // treating it as an arrival trigger would over-drain by a mile.
  'Corpse Knight':               { kind: 'creatureEtbDamage', amount: 1 },
  // "Whenever another ZOMBIE you control enters, each opponent loses 1 life and
  // YOU GAIN 1." Both halves matter in a deck that amasses: the drain is the
  // clock and the life is why racing it does not work.
  'Wayward Servant':             { kind: 'creatureEtbDamage', amount: 1, lifeGain: 1, subtype: 'zombie' },
  'Purphoros, God of the Forge': { kind: 'creatureEtbDamage', amount: 2 },
  // Moved here from BOT_SELF_EFFECTS, where it was a once-a-turn draw on the
  // combat beat: it fired off land-fetch sorceries and only once on a turn that
  // cast two creatures. It is an arrival trigger and now reads as one.
  'Soul of the Harvest':         { kind: 'creatureEtbDraw', count: 1, nontokenOnly: true },
};

/**
 * "Whenever you cast an instant or sorcery spell, …" — magecraft, and the
 * Young Pyromancer / Talrand / Guttersnipe family.
 *
 * The one thing a spellslinger deck IS, and until this existed the registry
 * could not say it. Every other archetype's payoff hangs off a permanent
 * arriving, a creature dying or a land dropping; this one hangs off the act of
 * casting, and without it a deck of burn and cantrips leaves the bot with an
 * empty board and nothing to attack with — which is not a spellslinger deck,
 * it is a deck that does nothing.
 *
 * Fires on every instant and sorcery the bot casts, from the develop step and
 * the interaction step alike: a Lightning Bolt pointed at your blocker feeds
 * the engine exactly as a cantrip does, which is the whole reason the deck
 * plays removal.
 */
export interface BotSpellTrigger {
  /** What it does to the BOT's own board — a token, a card. */
  spec?: BotSelfSpec | BotSelfSpec[];
  /**
   * Life the player loses each time it fires. Billed through the same per-beat
   * channel as death and ETB triggers, so a turn that casts three spells with a
   * Guttersnipe out reads as one number rather than three stray log lines.
   */
  damage?: number;
  /**
   * Fires for any NONCREATURE spell, not just instants and sorceries.
   *
   * The default is the magecraft reading, which is what most of this map wants.
   * Third Path Iconoclast says "noncreature spell", so without this it sat out
   * every artifact and enchantment its deck cast.
   */
  noncreature?: boolean;
  /**
   * Fires only for CREATURE spells — God-Eternal Oketra. The mirror image of
   * `noncreature`, and the reason both exist rather than one tri-state: most of
   * this map is magecraft, which is neither.
   */
  creatureOnly?: boolean;
  /**
   * Only fires for spells of at least this mana value, measured by `costOf` —
   * what the bot actually pays, not the printed cmc, so an X spell counts for
   * the number it was really cast for.
   *
   * Written for Zaffai, whose magecraft is tiered and whose 4/4 half is the
   * only tier worth modelling. Firing it on every cantrip would be a different
   * and much better card.
   */
  minMana?: number;
}

export const BOT_SPELL_TRIGGERS: Record<string, BotSpellTrigger> = {
  // ── Prismari Performance ──
  // The scry tier is dropped — the engine has no library manipulation to point
  // it at — and the double-strike tier with it. The 4/4 is the card.
  'Zaffai, Thunder Conductor': { spec: { kind: 'makeTokens', tokens: [{ name: 'Elemental', count: 1 }] }, minMana: 5 },
  // Each of these makes a DIFFERENT token name on purpose: tokens are matched
  // out of the deck's fetched pool by name, so two payoffs making "Elemental"
  // would be indistinguishable and the smaller one would win. That is also why
  // Young Pyromancer is not in this deck.
  'Talrand, Sky Summoner':     { spec: { kind: 'makeTokens', tokens: [{ name: 'Drake', count: 1 }] } },
  'Murmuring Mystic':          { spec: { kind: 'makeTokens', tokens: [{ name: 'Bird', count: 1 }] } },
  // "Whenever you cast a CREATURE spell, create a 4/4 Zombie Warrior." It was on
  // the combat beat, which made it one token a turn however many creatures were
  // cast — and handed it one on the turn Oketra itself landed, which the real
  // card cannot do: it is not on the battlefield when its own spell is cast.
  'God-Eternal Oketra':        { spec: { kind: 'makeTokens', tokens: [{ name: 'Zombie Warrior', count: 1 }] }, creatureOnly: true },
  // "Whenever you cast a noncreature spell" — artifacts and enchantments
  // included, which is what `noncreature` buys.
  'Third Path Iconoclast':     { spec: { kind: 'makeTokens', tokens: [{ name: 'Soldier', count: 1 }] }, noncreature: true },
  'Archmage Emeritus':         { spec: { kind: 'draw', count: 1 } },
  'Guttersnipe':               { damage: 2 },
  'Electrostatic Field':       { damage: 1 },
};

/**
 * What a card really costs the bot, when raw CMC lies.
 *
 * Two cases. An X spell has a near-zero CMC, so without an override the bot
 * casts it on turn one for nothing — the number here is the total it pays, and
 * the token counts in BOT_SELF_EFFECTS are written to match. A cost-reducing
 * card like Blasphemous Act has a huge CMC it never actually pays, so without
 * an override it is never castable at all; the flat number below is roughly
 * the price on a board worth wiping.
 */
export const BOT_COSTS: Record<string, number> = {
  'Secure the Wastes':       5,
  // Always cast kicked, which is the only way this card is worth casting.
  'Goblin Bushwhacker':      2,
  // X spells: the number here is what the bot pays, and the counts above match.
  'Dread Summons':           5,
  'Pull from Tomorrow':      5,
  'Commence the Endgame':    6,
  // Split cards carry the SUM of both halves as their cmc, so Never // Return
  // reads as a 7-drop and never gets cast. This is the half the bot uses.
  'Never // Return':         3,
  'Dusk // Dawn':            4,
  /*
   * Delve. Each card exiled from the graveyard pays for {1}, so a printed cmc of
   * eight or nine is a price nobody ever pays — and at that price the bot never
   * cast any of these. In a deck that mills itself every turn the graveyard is
   * deep, so these numbers are what delve actually costs there.
   */
  'Treasure Cruise':         2,
  'Tasigur, the Golden Fang': 3,
  'Necropolis Fiend':        5,
  'Afterlife from the Loam': 3,
  // Kicker, and the kicked mode is the one worth having.
  'Meteor Swarm':            4,
  'Tear Asunder':            4,
  // X spell.
  'Welcome the Dead':        4,
  'March of the Multitudes': 6,
  'Blasphemous Act':         5,
  // Modelled as its overload — "each artifact you don't control" — so it has
  // to be priced as its overload. At its printed one mana the bot was casting
  // a one-sided artifact wrath on turn one.
  'Vandalblast':             5,
  // X spells, priced at the point the bot is willing to cast them. The damage
  // and draw counts in the maps above are written against these numbers, and
  // they are also what decides whether Zaffai's magecraft tier is reached.
  'Crackle with Power':      5,
  'Comet Storm':             5,
  "Blue Sun's Zenith":       6,
  // "Costs {X} less, where X is the total power of creatures you control." A
  // printed twelve is a price this deck never pays — by the time it casts
  // Ghalta the board is already enormous, which is the point of the card.
  'Ghalta, Primal Hunger':   6,
};

/** What the bot pays for a card. Use this everywhere instead of reading `cmc`. */
export function costOf(card: { name: string; cmc?: number }): number {
  return BOT_COSTS[card.name] ?? card.cmc ?? 0;
}
