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
  /** Straight life loss. */
  | { kind: 'drain'; amount: number }
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
  | { kind: 'selfMill'; count: number };

export interface BotSelfEntry {
  spec: BotSelfSpec;
  /**
   * 'cast'   — fires as the card resolves. This is the default.
   * 'combat' — fires from the battlefield at the start of every combat, so a
   *            Rabblemaster keeps producing rather than doing it once.
   */
  timing?: 'cast' | 'combat';
  /** A 'combat' source that taps to do this — Krenko does, Rabblemaster does not. */
  tapsSource?: boolean;
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

  // ── Golgari ──
  'Grave Titan':          { spec: { kind: 'makeTokens', tokens: [{ name: 'Zombie', count: 2 }] } },
  // Really "X insects for creatures in your graveyard". A flat three is close
  // to what a self-milling deck actually has by the time it casts this.
  'Izoni, Thousand-Eyed': { spec: { kind: 'makeTokens', tokens: [{ name: 'Insect', count: 3 }] } },
  // The sacrifice is not modelled; the two bodies back are the point of the card.
  'Victimize':            { spec: { kind: 'reanimate', count: 2 } },
  'Grisly Salvage':       { spec: { kind: 'selfMill', count: 5 } },
  'Satyr Wayfinder':      { spec: { kind: 'selfMill', count: 4 } },
  "Stitcher's Supplier":  { spec: { kind: 'selfMill', count: 3 } },

  // ── Dimir ──
  'Baleful Strix':        { spec: { kind: 'draw', count: 1 } },
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
  spec: BotSelfSpec;
  /** True when activating taps the source, which also stops it attacking. */
  tapsSource?: boolean;
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
  | { kind: 'tokenDoubler' };

export const BOT_STATICS: Record<string, BotStaticSpec> = {
  // "Other Goblins get +1/+1" — includeSelf stays off, so the lord is a 2/2.
  'Goblin King':         { kind: 'anthem', power: 1, toughness: 1, subtype: 'goblin' },
  'Goblin Chieftain':    { kind: 'anthem', power: 1, toughness: 1, subtype: 'goblin' },
  // Token type lines read "Token Creature — Soldier", so 'token' matches them all.
  // It is an enchantment, not a creature, so includeSelf is harmless and honest.
  'Intangible Virtue':   { kind: 'anthem', power: 1, toughness: 1, subtype: 'token', includeSelf: true },
  'Anointed Procession': { kind: 'tokenDoubler' },
  'Parallel Lives':      { kind: 'tokenDoubler' },
};

/**
 * "Whenever a creature you control enters...". Checked every time the bot puts
 * a creature onto its battlefield, including each token, which is what makes a
 * goblin deck with a Purphoros out genuinely frightening.
 */
export type BotTriggerSpec = { kind: 'creatureEtbDamage'; amount: number };

export const BOT_TRIGGERS: Record<string, BotTriggerSpec> = {
  'Impact Tremors':              { kind: 'creatureEtbDamage', amount: 1 },
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
  'March of the Multitudes': 6,
  'Blasphemous Act':         5,
};

/** What the bot pays for a card. Use this everywhere instead of reading `cmc`. */
export function costOf(card: { name: string; cmc?: number }): number {
  return BOT_COSTS[card.name] ?? card.cmc ?? 0;
}
