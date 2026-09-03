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
  /** Destroy every creature on the player's board. */
  | { kind: 'boardWipe' }
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

  // ── Burn ──
  'Lightning Bolt':        { spec: { kind: 'damage', amount: 3 } },
  'Shock':                 { spec: { kind: 'damage', amount: 2 } },

  // ── Sweepers ──
  'Blasphemous Act':       { spec: { kind: 'boardWipe' } },
  'Crux of Fate':          { spec: { kind: 'boardWipe' } },
  'Languish':              { spec: { kind: 'boardWipe' } },
  'Vandalblast':           { spec: { kind: 'artifactSweep' } },

  // ── Attrition ──
  'Agonizing Remorse':     { spec: { kind: 'discard', count: 1 } },
  'Sign in Blood':         { spec: { kind: 'drain', amount: 2 } },

  // ── Permanents that do something on arrival ──
  'Ravenous Chupacabra':   { spec: { kind: 'destroyCreature' }, etb: true },
  'Bone Shredder':         { spec: { kind: 'destroyCreature' }, etb: true },
  'Gray Merchant of Asphodel': { spec: { kind: 'drain', amount: 2 }, etb: true },
  'Sheoldred, Whispering One':  { spec: { kind: 'edict' }, etb: true },
  'Goblin Trashmaster':    { spec: { kind: 'artifactSweep' }, etb: true },
  'Purphoros, God of the Forge': { spec: { kind: 'drain', amount: 2 }, etb: true },
};

export function lookupEffect(cardName: string): BotEffectEntry | undefined {
  return BOT_EFFECTS[cardName];
}
