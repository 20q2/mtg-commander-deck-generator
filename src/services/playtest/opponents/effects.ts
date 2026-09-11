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

import type { CombatKeyword } from '@/services/playtest/combat';

export type BotEffectSpec =
  /** Destroy the best creature on the player's board. */
  | { kind: 'destroyCreature' }
  /** Same, but the card leaves for exile instead of the graveyard. */
  | { kind: 'exileCreature' }
  /** Destroy the best permanent of any type. */
  | { kind: 'destroyPermanent' }
  /**
   * Destroy creatures. `maxToughness` models a -X/-X sweeper like Languish,
   * which only kills what it is big enough to kill; omit it for an
   * unconditional wrath.
   *
   * `oneSided` is for the sweepers that only hit your opponents — a Massacre
   * Wurm. Without it the engine would kill the bot's own board too, which is
   * both wrong and the reason the bot would then refuse to cast it.
   */
  | { kind: 'boardWipe'; maxToughness?: number; oneSided?: boolean }
  /** Destroy every artifact on the player's board. */
  | { kind: 'artifactSweep' }
  /** The player sacrifices — they'd pick their worst, so the bot takes the worst. */
  | { kind: 'edict' }
  /** N damage: kills a creature it can, otherwise goes to the face. */
  | { kind: 'damage'; amount: number }
  /**
   * Straight life loss. `perSubtype` scales it by how many permanents with that
   * subtype the BOT controls — "each opponent loses X life, where X is the
   * number of Zombies you control". A fixed number would make The Scarab God a
   * 5-mana Lava Spike on a board of twelve zombies, which is the opposite of
   * what that card is feared for.
   */
  | { kind: 'drain'; amount: number; perSubtype?: string }
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
  'Doom Blade':            { spec: { kind: 'destroyCreature' } },
  'Go for the Throat':     { spec: { kind: 'destroyCreature' } },
  "Hero's Downfall":       { spec: { kind: 'destroyCreature' } },
  'Swords to Plowshares':  { spec: { kind: 'exileCreature' } },
  'Path to Exile':         { spec: { kind: 'exileCreature' } },
  'Beast Within':          { spec: { kind: 'destroyPermanent' } },
  "Assassin's Trophy":     { spec: { kind: 'destroyPermanent' } },
  'Putrefy':               { spec: { kind: 'destroyCreature' } },
  'Chaos Warp':            { spec: { kind: 'destroyPermanent' } },
  'Infernal Grasp':        { spec: { kind: 'destroyCreature' } },
  'Cut Down':              { spec: { kind: 'destroyCreature' } },
  // ── Eternal Might ──
  'Damn':                  { spec: { kind: 'destroyCreature' } },
  'Despark':               { spec: { kind: 'destroyPermanent' } },
  // Modelled as its Swift End half. The body comes with it, which is generous
  // — the real card is one or the other — but it is a 3-mana removal spell
  // either way and pretending it is a vanilla 2/3 was worse.
  'Murderous Rider // Swift End': { spec: { kind: 'destroyCreature' }, etb: true },
  'Never // Return':       { spec: { kind: 'destroyCreature' } },
  // ── Sultai Arisen ──
  'Casualties of War':     { spec: { kind: 'destroyPermanent' } },
  'Tear Asunder':          { spec: { kind: 'destroyPermanent' } },
  'Lethal Scheme':         { spec: { kind: 'destroyCreature' } },
  // Destroys everything, the bot's board included, which the engine handles.
  'Necromantic Selection': { spec: { kind: 'boardWipe' } },

  // ── Mirror Break (bracket 4) ──
  'Terminate':             { spec: { kind: 'destroyCreature' } },
  'Bedevil':               { spec: { kind: 'destroyPermanent' } },
  // ── Old-Growth Stampede (bracket 3) ──
  // Destroys up to three noncreature permanents; the engine takes the best
  // one. The 3/3 Elephants it hands back are a drawback we skip.
  'Terastodon':            { spec: { kind: 'destroyPermanent' }, etb: true },
  // "Destroy all artifacts and enchantments" — the bot controls none, so this
  // is one-sided in practice and green's only real interaction here.
  'Bane of Progress':      { spec: { kind: 'artifactSweep' }, etb: true },

  // ── Burn ──
  'Lightning Bolt':        { spec: { kind: 'damage', amount: 3 } },
  'Shock':                 { spec: { kind: 'damage', amount: 2 } },

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
  'Bone Shredder':         { spec: { kind: 'destroyCreature' }, etb: true },
  'Gray Merchant of Asphodel': { spec: { kind: 'drain', amount: 2 }, etb: true },
  'Sheoldred, Whispering One':  { spec: { kind: 'edict' }, etb: true },
  'Goblin Trashmaster':    { spec: { kind: 'artifactSweep' }, etb: true },
  'Shriekmaw':             { spec: { kind: 'destroyCreature' }, etb: true },
  'Angel of Sanctions':    { spec: { kind: 'destroyPermanent' }, etb: true },
  'Cast Out':              { spec: { kind: 'destroyPermanent' }, etb: true },
  'Fleshbag Marauder':     { spec: { kind: 'edict' }, etb: true },
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
  | { kind: 'reanimate'; count: number }
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
  /** Return a card from the bot's graveyard to its HAND — Eternal Witness. */
  | { kind: 'regrow'; count: number }
  /**
   * Search out a land and put it straight onto the battlefield. Separate from
   * `tutor`, which deliberately never fetches lands: this one only fetches them.
   */
  | { kind: 'fetchLand'; count: number; tapped?: boolean }
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
  | { kind: 'reclaimLands'; count: number; to: 'hand' | 'battlefield'; tapped?: boolean };

export interface BotSelfEntry {
  /**
   * What it does. A list when one trigger does several things at once — Teval
   * mills three AND returns a land, and splitting that across two registry
   * entries would mean the card could only ever be half-understood.
   */
  spec: BotSelfSpec | BotSelfSpec[];
  /**
   * 'cast'   — fires as the card resolves. This is the default.
   * 'combat' — fires from the battlefield at the start of every combat, so a
   *            Rabblemaster keeps producing rather than doing it once.
   * 'attack' — fires only when the source itself attacks. The distinction from
   *            'combat' is the whole card for an attack trigger: a bot holding
   *            Teval home as a blocker should not be milling as if it swung.
   */
  timing?: 'cast' | 'combat' | 'attack';
  /** A 'combat' source that taps to do this — Krenko does, Rabblemaster does not. */
  tapsSource?: boolean;
}

/** Every spec an entry carries, whether it was written as one or as a list. */
export function specsOf(entry: { spec: BotSelfSpec | BotSelfSpec[] }): BotSelfSpec[] {
  return Array.isArray(entry.spec) ? entry.spec : [entry.spec];
}

export const BOT_SELF_EFFECTS: Record<string, BotSelfEntry> = {
  // ── Goblins ──
  'Krenko, Mob Boss':     { spec: { kind: 'makeTokens', tokens: [{ name: 'Goblin', count: 1, countPerSubtype: 'goblin' }] }, timing: 'combat', tapsSource: true },
  'Goblin Rabblemaster':  { spec: { kind: 'makeTokens', tokens: [{ name: 'Goblin', count: 1 }] }, timing: 'combat' },
  "Krenko's Command":     { spec: { kind: 'makeTokens', tokens: [{ name: 'Goblin', count: 2 }] } },
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
  'Call the Cavalry':     { spec: { kind: 'makeTokens', tokens: [{ name: 'Knight', count: 1 }] } },
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
  'Emmara, Soul of the Accord': { spec: { kind: 'makeTokens', tokens: [{ name: 'Soldier', count: 1 }] }, timing: 'combat', tapsSource: true },

  // ── Golgari ──
  'Grave Titan':          { spec: { kind: 'makeTokens', tokens: [{ name: 'Zombie', count: 2 }] } },
  // Really "X insects for creatures in your graveyard". A flat three is close
  // to what a self-milling deck actually has by the time it casts this.
  'Izoni, Thousand-Eyed': { spec: { kind: 'makeTokens', tokens: [{ name: 'Insect', count: 3 }] } },
  // The sacrifice is not modelled; the two bodies back are the point of the card.
  'Victimize':            { spec: { kind: 'reanimate', count: 2 } },
  'Grisly Salvage':       { spec: { kind: 'selfMill', count: 5 } },
  'Eternal Witness':      { spec: { kind: 'regrow', count: 1 } },
  'Worldly Tutor':        { spec: { kind: 'tutor', want: { type: 'creature' }, to: 'hand', count: 1 } },
  'Satyr Wayfinder':      { spec: { kind: 'selfMill', count: 4 } },
  "Stitcher's Supplier":  { spec: { kind: 'selfMill', count: 3 } },

  // ── Eternal Might: amass ──
  // Dreadhorde Invasion amasses every upkeep. Combat timing is the closest beat
  // the engine has to an upkeep trigger, and it fires once a turn either way.
  'Dreadhorde Invasion':  { spec: { kind: 'amass', count: 1 }, timing: 'combat' },
  'Gleaming Overseer':    { spec: { kind: 'amass', count: 1 } },
  'Eternal Skylord':      { spec: { kind: 'amass', count: 2 } },
  // "Amass X where X is your hand size" — the cost override below fixes X, and
  // four is about what a hand looks like when a six-drop resolves.
  'Commence the Endgame': { spec: { kind: 'amass', count: 4 } },

  // The commander. Vigilance means it attacks every turn without giving up its
  // blocking, so the loot trigger is close to guaranteed once it lands — which
  // is exactly why leaving the deck's own commander unauthored was the single
  // worst gap in it. Modelled as the draw; the discard is what the hand limit
  // already does at end of turn.
  "Temmet, Naktamun's Will": { spec: { kind: 'draw', count: 1 }, timing: 'attack' },
  // "At the beginning of your second main phase, if a player was dealt combat
  // damage by a Zombie this turn, mill three, then return a creature card from
  // your graveyard to your hand." In a deck of zombies, attacking is that
  // condition — so 'attack' timing is the trigger, near enough.
  'Lost Monarch of Ifnir': {
    spec: [{ kind: 'selfMill', count: 3 }, { kind: 'regrow', count: 1 }],
    timing: 'attack',
  },

  // ── Eternal Might: the horde ──
  // A planeswalker ticking up every turn, which combat timing models exactly.
  "Liliana, Death's Majesty": { spec: { kind: 'makeTokens', tokens: [{ name: 'Zombie', count: 1 }] }, timing: 'combat' },
  // Really one token per creature spell cast; once a turn is the honest average.
  'God-Eternal Oketra':   { spec: { kind: 'makeTokens', tokens: [{ name: 'Zombie Warrior', count: 1 }] }, timing: 'combat' },
  'Dread Summons':        { spec: { kind: 'makeTokens', tokens: [{ name: 'Zombie', count: 3 }] } },
  'Rot Hulk':             { spec: { kind: 'reanimate', count: 2 } },
  // The deck's marquee seven-drop: every combat it exiles a creature from the
  // graveyard and gets a hasty 4/4 copy. Reanimation is the honest model — the
  // body comes back and can attack — and 'combat' timing makes it recur, which
  // is the only reason it is worth seven mana.
  "God-Pharaoh's Gift":   { spec: { kind: 'reanimate', count: 1 }, timing: 'combat' },
  'Prophet of the Scarab': { spec: { kind: 'draw', count: 3 } },
  'Champion of Wits':     { spec: { kind: 'draw', count: 2 } },
  'Pull from Tomorrow':   { spec: { kind: 'draw', count: 4 } },

  // ── Sultai Arisen: filling the graveyard ──
  // A self-mill deck needs its graveyard stocked before anything else it does
  // means anything. The recurring ones use combat timing, the closest beat the
  // engine has to an upkeep trigger.
  'Nyx Weaver':           { spec: { kind: 'selfMill', count: 2 }, timing: 'combat' },
  'Crawling Sensation':   { spec: { kind: 'selfMill', count: 2 }, timing: 'combat' },
  'Hedron Crab':          { spec: { kind: 'selfMill', count: 3 }, timing: 'combat' },
  'Colossal Grave-Reaver': { spec: { kind: 'selfMill', count: 3 }, timing: 'combat' },
  'Diviner of Mist':      { spec: { kind: 'selfMill', count: 4 }, timing: 'combat' },
  'Essence Anchor':       { spec: { kind: 'selfMill', count: 1 }, timing: 'combat' },
  'Grapple with the Past': { spec: { kind: 'selfMill', count: 3 } },
  'Forbidden Alchemy':    { spec: { kind: 'selfMill', count: 3 } },

  // The commander, and it was doing nothing but flying for 4. Its attack
  // trigger is the deck in miniature: mill three, then drag a land back out of
  // the yard. Both halves in one entry, because half of Teval is not Teval.
  'Teval, the Balanced Scale': {
    spec: [{ kind: 'selfMill', count: 3 }, { kind: 'reclaimLands', count: 1, to: 'battlefield', tapped: true }],
    timing: 'attack',
  },

  // ── Sultai Arisen: buying it back ──
  'Living Death':         { spec: { kind: 'reanimate', count: 3 } },
  'Timeless Witness':     { spec: { kind: 'regrow', count: 1 } },
  // Delve, so the real price is the override in BOT_COSTS. Reanimates one
  // creature out of each graveyard; the bot's own is the one it knows about.
  'Afterlife from the Loam': { spec: { kind: 'reanimate', count: 2 } },
  // Both modes, which is what "you may choose both" means with a commander out
  // — and this deck's commander is a 4-drop that is usually on the board.
  'Will of the Sultai':   { spec: [{ kind: 'selfMill', count: 3 }, { kind: 'reclaimLands', count: 3, to: 'battlefield', tapped: true }] },
  // Exactly what it says. Dredge isn't modelled, so this is the front half of
  // the card only — but the front half is three land drops banked, which is
  // what makes it ramp.
  'Life from the Loam':   { spec: { kind: 'reclaimLands', count: 3, to: 'hand' } },

  // ── Sultai Arisen: ramp ──
  // Five land-fetchers, all the same shape, all previously doing nothing at all.
  'Cultivate':            { spec: { kind: 'fetchLand', count: 1 } },
  'Rampant Growth':       { spec: { kind: 'fetchLand', count: 1, tapped: true } },
  'Farseek':              { spec: { kind: 'fetchLand', count: 1, tapped: true } },
  'Harrow':               { spec: { kind: 'fetchLand', count: 2 } },
  'Springbloom Druid':    { spec: { kind: 'fetchLand', count: 2, tapped: true } },

  // ── Sultai Arisen: cards and bodies ──
  'Treasure Cruise':      { spec: { kind: 'draw', count: 3 } },
  'Disciple of Bolas':    { spec: { kind: 'draw', count: 3 } },
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
  'Primeval Titan':       { spec: { kind: 'fetchLand', count: 2, tapped: true } },
  'Hornet Queen':         { spec: { kind: 'makeTokens', tokens: [{ name: 'Insect', count: 4 }] } },
  'Harmonize':            { spec: { kind: 'draw', count: 3 } },
  // "Draw a card for each green creature you control" — in this deck, most of
  // the board. Four is what it looks like on the turn a seven-drop resolves.
  'Regal Force':          { spec: { kind: 'draw', count: 4 } },
  // Really one card per nontoken creature that arrives. Once a turn is the
  // honest average for a deck casting roughly a creature a turn.
  'Soul of the Harvest':  { spec: { kind: 'draw', count: 1 }, timing: 'combat' },

  // ── Mirror Break (bracket 4) ──
  // Four tutors, because a two-card combo deck is only as fast as its ability
  // to find the half it is missing — and the tutor logic already prefers a
  // combo piece it is one short of over anything else.
  'Diabolic Intent':      { spec: { kind: 'tutor', to: 'hand', count: 1 } },
  'Grim Tutor':           { spec: { kind: 'tutor', to: 'hand', count: 1 } },
  'Imperial Seal':        { spec: { kind: 'tutor', to: 'hand', count: 1 } },
  // Really puts it on top of the library; the next draw step gets it either
  // way, and the engine has no "top of library" zone to model.
  'Vampiric Tutor':       { spec: { kind: 'tutor', to: 'hand', count: 1 } },
  'Read the Bones':       { spec: { kind: 'draw', count: 2 } },
  // An upkeep draw every turn. 'combat' is the closest recurring beat.
  'Phyrexian Arena':      { spec: { kind: 'draw', count: 1 }, timing: 'combat' },
  'Solemn Simulacrum':    { spec: { kind: 'fetchLand', count: 1, tapped: true } },

  // ── Dimir ──
  'Baleful Strix':        { spec: { kind: 'draw', count: 1 } },
  'Demonic Tutor':        { spec: { kind: 'tutor', to: 'hand', count: 1 } },
  'Divination':           { spec: { kind: 'draw', count: 2 } },
  "Night's Whisper":      { spec: { kind: 'draw', count: 2 } },
  'Fact or Fiction':      { spec: { kind: 'draw', count: 2 } },
  // Targets itself, as any player would: two cards beats two damage. It used to
  // be a player-facing drain, which handed the bot's own card draw to nobody.
  'Sign in Blood':        { spec: { kind: 'draw', count: 2 } },
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
   */
  only?: 'behindOnLands' | 'graveyardStocked';
}

export const BOT_ACTIVATED: Record<string, BotActivatedEntry[]> = {
  // Both of Rhys's abilities. With six mana up it doubles the board instead of
  // making a single elf, which is what the card is actually for.
  'Rhys the Redeemed': [
    { cost: 3, spec: { kind: 'makeTokens', tokens: [{ name: 'Elf Warrior', count: 1 }] }, tapsSource: true },
    { cost: 6, spec: { kind: 'populate', count: 99 }, tapsSource: true },
  ],
  "Trostani, Selesnya's Voice": [
    { cost: 3, spec: { kind: 'populate', count: 1 }, tapsSource: true },
  ],
  // Free and once a turn, which is close enough to "at the beginning of your
  // end step" without needing an end step.
  'Meren of Clan Nel Toth': [
    { cost: 0, spec: { kind: 'reanimate', count: 1 } },
  ],
  // Ramp on legs. Free, but only cashed in when the bot is actually behind on
  // mana — otherwise it is a blocker worth keeping.
  'Sakura-Tribe Elder': [
    { cost: 0, spec: { kind: 'fetchLand', count: 1, tapped: true }, sacrificesSelf: true, only: 'behindOnLands' },
  ],
  // {1}{B}, {T}, discard: make a 2/2 Zombie. The discard is not modelled.
  'Cryptbreaker': [
    { cost: 2, spec: { kind: 'makeTokens', tokens: [{ name: 'Zombie', count: 1 }] }, tapsSource: true },
  ],
  // "Once each turn you may cast a creature spell from your graveyard."
  'Kotis, Sibsig Champion': [
    { cost: 3, spec: { kind: 'reanimate', count: 1 } },
  ],
  'Phyrexian Reclamation': [
    { cost: 1, spec: { kind: 'regrow', count: 1 } },
  ],
  'Shigeki, Jukai Visionary': [
    { cost: 2, spec: { kind: 'regrow', count: 1 }, tapsSource: true },
  ],
  'Jarad, Golgari Lich Lord': [
    { cost: 3, spec: { kind: 'reanimate', count: 1 } },
  ],

  // ── Golgari ──
  // Three modes; the one that matters to you is "{B}, {T}: exile an instant or
  // sorcery from a graveyard, each opponent loses 2." A one-drop that bills you
  // two a turn forever, and until activated abilities could reach the player it
  // was a 1/2 that never did anything.
  'Deathrite Shaman': [
    { cost: 1, effect: { kind: 'drain', amount: 2 }, tapsSource: true },
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
  // "{G}, discard a creature card: return a land card from your graveyard to
  // the battlefield tapped." The discard is not modelled; the ramp is the card.
  'Floral Evoker': [
    { cost: 1, spec: { kind: 'reclaimLands', count: 1, to: 'battlefield', tapped: true } },
  ],
  // "You may play lands from your graveyard", plus casting a permanent out of
  // it once a turn. Both are graveyard recursion, and in a self-mill deck the
  // graveyard is the better library.
  'Conduit of Worlds': [
    { cost: 0, spec: { kind: 'reclaimLands', count: 1, to: 'hand' } },
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
  | { kind: 'costReducer'; amount: number; subtype?: string }
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
  // "Other Goblins get +1/+1" — includeSelf stays off, so the lord is a 2/2.
  'Goblin King':         { kind: 'anthem', power: 1, toughness: 1, subtype: 'goblin' },
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
  // and a zombie deck's tokens are zombies.
  'On Wings of Gold':    { kind: 'anthem', power: 1, toughness: 1, subtype: 'zombie', includeSelf: true },
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
  'Goreclaw, Terror of Qal Sisma': { kind: 'costReducer', amount: 2, subtype: 'creature' },
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
  'Corpse Augur': { kind: 'draw', count: 3 },
  // Two modes; the bot always wants the body back off a stocked graveyard.
  'Junji, the Midnight Sky': { kind: 'reanimate', count: 1 },
  // Both of these are cards you are happy to see traded off.
  'Pelakka Wurm':      { kind: 'draw', count: 1 },
  'Solemn Simulacrum': { kind: 'draw', count: 1 },
  // "Return it to its owner's hand at the beginning of the next end step" —
  // a recursion the engine models as simply getting the card back.
  'The Scarab God': { kind: 'regrow', count: 1 },
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
  spec?: BotSelfSpec | BotSelfSpec[];
  /** Player-facing half, e.g. Plague Belcher billing you a life per zombie. */
  effect?: BotEffectSpec;
}

export const BOT_DEATH_WATCHERS: Record<string, BotDeathWatcher> = {
  'Midnight Reaper':  { nontokenOnly: true, spec: { kind: 'draw', count: 1 } },
  'Undead Augur':     { subtype: 'zombie', spec: { kind: 'draw', count: 1 } },
  // The life loss is on the bot, not you — but a card for a life is a trade a
  // zombie deck makes happily, and the engine only tracks what it draws.
  'Gate to the Afterlife': { nontokenOnly: true, spec: { kind: 'draw', count: 1 } },
  'Plague Belcher':   { subtype: 'zombie', effect: { kind: 'drain', amount: 1 } },
  // Judith turns every trade and every chump block into reach. With the
  // anthem above it is why this deck kills through a board rather than around it.
  'Judith, the Scourge Diva': { nontokenOnly: true, effect: { kind: 'damage', amount: 1 } },
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
  // Landcycling. A two-mana Rampant Growth stapled to a card the bot would
  // otherwise never reach, which is exactly how both of these get played.
  'Twisted Abomination': { cost: 2, spec: { kind: 'fetchLand', count: 1 }, preferred: true },
  'Timeless Dragon':     { cost: 2, spec: { kind: 'fetchLand', count: 1 } },
  // "Target player loses life equal to the number of Zombies on the
  // battlefield" — on a developed board this is the deck's reach, and it costs
  // two. Hard-casting it for six is strictly worse.
  // Cycling draws, and the trigger drains on top — with no zombies out it is
  // still a two-mana cantrip, which is why it gets pitched either way.
  'Gempalm Polluter':    {
    cost: 2,
    spec: { kind: 'draw', count: 1 },
    effect: { kind: 'drain', amount: 1, perSubtype: 'zombie' },
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
  'Rampaging Baloths': { kind: 'makeTokens', tokens: [{ name: 'Beast', count: 1 }] },
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
  'The Scarab God': { kind: 'drain', amount: 1, perSubtype: 'zombie' },
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
   */
  kind: 'ownGraveyardCreatures' | 'ownGraveyardCards' | 'ownLands';
  power: number;
  toughness: number;
};

export const BOT_DYNAMIC_STATS: Record<string, BotDynamicStat> = {
  'Jarad, Golgari Lich Lord': { kind: 'ownGraveyardCreatures', power: 1, toughness: 1 },
  'Lord of Extinction':       { kind: 'ownGraveyardCards', power: 1, toughness: 1 },
  'Consuming Aberration':     { kind: 'ownGraveyardCards', power: 1, toughness: 1 },
  "Multani, Yavimaya's Avatar": { kind: 'ownLands', power: 1, toughness: 1 },
};

/**
 * "Whenever a creature you control enters...". Checked every time the bot puts
 * a creature onto its battlefield, including each token, which is what makes a
 * goblin deck with a Purphoros out genuinely frightening.
 */
export type BotTriggerSpec = { kind: 'creatureEtbDamage'; amount: number };

export const BOT_TRIGGERS: Record<string, BotTriggerSpec> = {
  'Impact Tremors':              { kind: 'creatureEtbDamage', amount: 1 },
  // The reason a zombie deck's tokens are a clock and not just a board: every
  // body that arrives bills you. Deliberately NOT including Bontu's Monument,
  // which triggers on casting a creature SPELL — tokens are not cast, and
  // treating it as an arrival trigger would over-drain by a mile.
  'Corpse Knight':               { kind: 'creatureEtbDamage', amount: 1 },
  'Wayward Servant':             { kind: 'creatureEtbDamage', amount: 1 },
  'Purphoros, God of the Forge': { kind: 'creatureEtbDamage', amount: 2 },
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
  'Tear Asunder':            4,
  // X spell.
  'Welcome the Dead':        4,
  'March of the Multitudes': 6,
  'Blasphemous Act':         5,
  // "Costs {X} less, where X is the total power of creatures you control." A
  // printed twelve is a price this deck never pays — by the time it casts
  // Ghalta the board is already enormous, which is the point of the card.
  'Ghalta, Primal Hunger':   6,
};

/** What the bot pays for a card. Use this everywhere instead of reading `cmc`. */
export function costOf(card: { name: string; cmc?: number }): number {
  return BOT_COSTS[card.name] ?? card.cmc ?? 0;
}
