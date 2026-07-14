import type { ScryfallCard, EDHRECCard, EDHRECCombo, Customization } from '@/types';
import type { RoleKey } from '@/services/tagger/client';
import type { ThemeKind } from './themeKind';

/** A single scored card in the brew candidate pool. */
export interface BrewCandidate {
  name: string;
  edhrec: EDHRECCard;          // EDHREC record (inclusion, synergy, primary_type)
  scryfall: ScryfallCard;      // Resolved Scryfall card (cmc, type_line, prices, color_identity)
  role: RoleKey | null;        // From getCardRole()
  subtype: string | null;      // From getCardSubtype()
  inclusion: number;           // EDHREC inclusion % (mirror of edhrec.inclusion)
  isLand: boolean;             // type_line includes 'land'
  themeTags: string[];         // EDHREC theme slugs this card belongs to (∩ the deck's selected themes)
  discoveredVia?: string;      // seed card display name this candidate was discovered through
  coSynergy?: number;          // 0-100 co-occurrence % with the seed (display + scoring)
  discoverySource?: 'lift' | 'coplay' | 'similar';
  connectionCount?: number;    // (cluster discovery) how many of YOUR cards lift this — "N of your cards want this"
  clusterScore?: number;       // (cluster discovery) summed edge strength across those cards (ranking)
  chromaTags?: string[];       // SpellChroma mechanical tag slugs (oracle-text derived), from the tag index; undefined if the index didn't load
}

/** Immutable per-session data: the scored pool + targets. Built once by prepareBrewContext(). */
export interface BrewContext {
  commander: ScryfallCard;
  partnerCommander: ScryfallCard | null;
  colorIdentity: string[];
  customization: Customization;
  candidates: BrewCandidate[];           // Non-land candidate pool (lands handled in mana-base node, Plan 3)
  roleTargets: Record<RoleKey, number>;  // From getDynamicRoleTargets / base targets
  typeTargets: Record<string, number>;   // creature/instant/sorcery/... counts
  curveTargets: Record<number, number>;  // CMC bucket -> count
  landTarget: number;                    // Number of land slots
  nonLandTarget: number;                 // Sum of typeTargets
  combos: EDHRECCombo[];                 // Commander-source combos, for combo routes (Plan 3)
  comboPieceCounts: Record<string, number>; // card name -> how many of `combos` it appears in (≥2 = "combo piece" / glue)
  // Every card name (+ DFC front face) appearing in ANY known combo — commander OR color-identity.
  // The "is this an actual combo piece?" oracle used by the combo pack + combo tagging. `combos`
  // above stays commander-only (near-miss fork), so this is a superset kept separate on purpose.
  comboPieceNames: Set<string>;
  // name -> best payoffRank across the combos it appears in (see combos.ts payoffRank). Orders the
  // combo pack so the exciting enablers (infinite mana/damage) lead.
  comboPiecePayoff: Record<string, number>;
  themeNames: Record<string, string>;    // theme slug -> display name (for leaning readout + reasons)
  themeSignatures: Record<string, string[]>; // theme slug -> card names ranked by EDHREC theme-synergy (the cards that DEFINE the theme, not staples played in it)
  gameChangerNames?: Set<string>;        // WotC "game changer" list — surfaced as a pick reason
  themeCharTags?: Record<string, string[]>;  // theme slug -> its CHARACTERISTIC chroma tags (over-represented in that theme's pool vs. the whole pool). Absent if the tag index didn't load.
  chromaTagLabels?: Record<string, string>;  // chroma tag slug -> human label, for reason chips. Absent if the tag index didn't load.
  themeKinds?: Record<string, ThemeKind>;    // theme slug -> how it's defined (mechanic/tribal/curated/archetype). Absent if the Scryfall catalogs didn't load → all themes treated as archetype.
}

export type ReasonKind = 'synergy' | 'role' | 'theme' | 'curve' | 'combo' | 'comboPiece' | 'discovery' | 'lift' | 'gameChanger' | 'tag';

export interface PickReason {
  kind: ReasonKind;
  label: string;     // e.g. "Synergy 88", "Fills Removal", "On-theme: Tokens"
  value?: number;    // optional numeric magnitude for sorting/display
}

/** A card the player has chosen, with the reasoning shown at pick time. */
export interface BrewPick {
  name: string;
  card: ScryfallCard;
  role: RoleKey | null;
  subtype: string | null;
  inclusion: number;
  viaRouteId: string;
  reasons: PickReason[];
}

/**
 * A transient "what if I took these?" preview: the cards you've selected/hovered in a pack but not
 * yet committed. The deck-stats charts read this (from the store) and draw a faint dashed projection
 * of where each chart WOULD land, so you can see a pick's effect before taking it. Never persisted.
 */
export interface BrewPreview {
  cards: BrewCandidate[];   // the cards that would be added (your kept selection ∪ the hovered card)
  packSlug?: string;        // the cracked pack's theme slug, for an affinity projection that matches the real commit
}

/** A preview card as a throwaway BrewPick, so the stats functions can treat it like a real pick. */
export function previewPick(c: BrewCandidate): BrewPick {
  return { name: c.name, card: c.scryfall, role: c.role, subtype: c.subtype, inclusion: c.inclusion, viaRouteId: '', reasons: [] };
}

export type RouteType = 'draft' | 'bundle' | 'lightning' | 'gamble' | 'combo' | 'manabase' | 'seal';
export type RouteTone = 'need' | 'theme' | 'neutral';

/** One fork option: a kind of next move. */
export interface BrewRoute {
  id: string;                 // stable within a fork, e.g. "draft:removal"
  type: RouteType;
  title: string;              // "Add Removal"
  description: string;        // one-line flavor/explanation
  targetRole: RoleKey | null; // role this route addresses, if any
  targetType: string | null;  // card type this route addresses, if any
  tone: RouteTone;            // drives the ribbon color
  tag?: string;               // ribbon text, e.g. "Deck needs this", "+5 cards"
  fills: number;              // expected slots filled
  comboMissing?: string[];   // for type 'combo': the missing piece card names to draft
  comboResults?: string[];   // for type 'combo': what the combo does (display)
}

/** A combo piece the player already owns — shown for context, not added to the deck. */
export interface ComboPiece {
  name: string;
  scryfall: ScryfallCard;
}

/** A pickable option inside a node: one card (draft/lightning/gamble) or several (bundle/combo). */
export interface BrewOption {
  id: string;
  label?: string;             // bundle theme name, e.g. "Sacrifice Synergy"
  cards: BrewCandidate[];     // 1 for gamble, 3-5 for a pack/lightning, 1-3 for combo
  reasons: PickReason[][];    // reasons[i] corresponds to cards[i]
  spicy?: boolean;            // a wildcard slot: underutilized / off-theme, flagged in the UI
  comboHave?: ComboPiece[];   // for type 'combo': owned pieces this card combos with (display-only)
  comboId?: string;           // for type 'combo': EDHREC combo id (for on-demand fetchComboDetails)
  comboResults?: string[];    // for type 'combo': the FULL payoff lines (label only shows the first)
  comboDeckCount?: number;    // for type 'combo': popularity (number of EDHREC decks running it)
  /** What this pack represents — drives its header tint in a multi-pack round. */
  flavor?: 'need' | 'theme' | 'discovery' | 'combo' | 'value' | 'power';
  /** Subjects (theme/role names) of the OTHER bundles on screen — what taking this one walks away from. */
  closing?: string[];
  /**
   * The card in this (theme) pack that DEFINES its theme — the top EDHREC signature present. Marked in
   * the UI so the pack's name is anchored to a real payoff (a "Drain the Table" pack shows which card
   * is the drain). Undefined when the theme had no draftable signature (the pack then drops its
   * evocative name for the plain theme label, so it never promises a strategy its cards don't deliver).
   */
  hallmarkName?: string;
  /**
   * A secret bonus card hidden in this (theme) pack: a small, seeded chance surfaces the theme's
   * defining payoff as a free windfall, revealed only after the player takes the pack. Theme packs
   * only; undefined on every other pack and on most theme packs.
   */
  goldCard?: BrewCandidate;
  /**
   * The rarity tier of `goldCard` — drives the reveal ceremony. `gold` is the common windfall (the
   * theme's next-best signature); `rainbow` is the rare upgrade (a Game Changer / the theme's very
   * top payoff) that earns a longer, prismatic reveal. Undefined when there's no windfall.
   */
  windfallTier?: 'gold' | 'rainbow';
  /**
   * DEPRECATED / no longer set (2026-07-13). Windfalls are now a BLIND surprise: a sealed pack never
   * advertises that it hides a bonus (the old glinting-seam "something glints inside" tease was
   * removed as off-key). The reward reveals only after the crack, as a sunburst bonus card. Field kept
   * for back-compat with persisted sessions; nothing sets it and no surface reads it as true.
   */
  windfallTease?: boolean;
  /**
   * The engine's mean offerScore for this option — the Rival's private ranking of the same choice
   * you're making. Display-only bookkeeping for the recap's divergence readout; never shown as a
   * number and never fed back into scoring.
   */
  engineScore?: number;
  /**
   * Per-card offerScores, aligned with `cards` — the same numbers engineScore averages. Drives the
   * fan's opt-in "Suggested" highlights (the top-scored card or two per cracked pack). Display-only;
   * never shown as a number and never fed back into scoring.
   */
  cardScores?: number[];
  /**
   * Double-or-nothing stakes: two face-down signature cards (the theme's next-best after the gold)
   * the player may trade the revealed gold card for, sight unseen. Attached to at most one gold
   * windfall per run (never rainbow — you don't gamble away the jackpot). Both outcomes are real
   * signatures, so the wager stakes opportunity, never deck quality.
   */
  wagerTrade?: BrewCandidate[];
}

export interface BrewNode {
  routeId: string;
  type: RouteType;
  prompt: string;             // node heading
  options: BrewOption[];      // pick one option; lightning/combo/bundle options can hold several cards
  canPass: boolean;           // gamble allows passing
  /**
   * A rare "god pack" round (seeded, ~1-in-140 pack rounds): every theme pack is guaranteed to hide a
   * windfall, so whichever pack the player takes pays out. The UI glows all crates gold. A pool
   * upgrade — never a power grant — so deck-quality honesty holds.
   */
  godPack?: boolean;
}

/** One answer to a personality question — a playstyle that leans the named theme(s). */
export interface BrewAnswer {
  id: string;
  label: string;              // playstyle phrasing, e.g. "Go wide"
  blurb: string;              // one-line description of the playstyle
  themeSlugs: string[];       // theme slug(s) this answer leans
  card?: ScryfallCard;        // when present, the question screen renders this card's art
  lean?: number;              // affinity added per slug (defaults to QUESTION_LEAN); opening commits harder
}

/** A personality round: a prompt with playstyle answers drawn from the commander's themes. */
export interface BrewQuestion {
  id: string;
  prompt: string;
  answers: BrewAnswer[];
}

export type BrewPhase = 'nonland' | 'lands' | 'done';

export interface BrewHistoryEntry {
  pickNumber: number;
  routeId: string;
  routeType: RouteType;
  added: string[];            // card names added in this decision
  passed: string[];           // names shown-but-not-taken (for Plan 3 Build History)
  tags?: Record<string, string[]>; // picked card name -> synergy tags (drives identityLean + reason chips)
  /**
   * The exact themeAffinity change this decision applied (theme/subtype slug -> amount). The weighting
   * is decided at pick time (a cracked pack's own theme dominates; incidental page overlap counts far
   * less), so undo just subtracts this back rather than re-deriving from tags. Absent on legacy entries.
   */
  affinityDelta?: Record<string, number>;
  moment?: { kind: BrewEventKind; label: string }; // set when this pick came from an event → locked from undo
  /**
   * The Rival's ledger: set when the player took an option the engine ranked BELOW its top pick
   * (by engineScore). Logged, never judged — the recap turns the diffs into "you built this deck,
   * YOUR way". Lives on the history entry so undo reverts it for free.
   */
  rival?: { chosen: string; top: string; gap: number };
}

/** Mutable session progress. */
export interface BrewState {
  picks: BrewPick[];
  usedNames: string[];                  // names already in the deck (excludes them from future packs)
  themeAffinity: Record<string, number>; // synergy-tag -> accumulated weight from picks
  rerollsUsed: Record<string, number>;   // fork/node id -> count
  seed?: number;                          // per-run jitter seed (minted once at session start); falsy = deterministic/no jitter
  clusterScanPicks?: number;              // picks.length at the last whole-deck lift-cluster scan (re-scans as the deck grows)
  phase: BrewPhase;
  history: BrewHistoryEntry[];
  discovered: BrewCandidate[];          // cards pulled in via card-to-card discovery (blended into the pool)
  seededNames: string[];                // pick names already used as discovery seeds (no refetch)
  committedTheme?: string;              // theme slug the player committed to at a Crossroads (Slice A: drives soft-remove + meter marker)
  pinnedNames?: string[];               // cards the player pinned "for later" — boosted so they resurface in future offers
  vetoedThemes?: string[];              // theme slugs the player muted — no theme packs / no exploration / zero affinity for them (steer-away, not a card ban)
  questionsAsked: number;               // personality questions answered/skipped so far (caps re-prompts)
  lastPackKeys?: string[];              // option ids (cluster keys) of the previous pack round — held back so the same pack never shows twice in a row
  prevPackKeys?: string[];              // the pack round before lastPackKeys — held back too, so packs rotate across a 2-round window (less "same 3 themes every time")
  lastPackCardNames?: string[];         // every card shown in the previous pack round — held out of the next round so a passed card never reappears back-to-back (even under a different pack theme)
  wagerResolved?: boolean;              // the once-per-run double-or-nothing has been offered (kept OR traded) — never offered again this run
  sealedGold?: boolean;                 // "Seal the Pack" armed: theme packs roll windfalls at 100% until one actually fires (then cleared)
  sealUsed?: boolean;                   // the once-per-run Seal the Pack has been taken — the route never surfaces again this run
  // --- The "fun layer": events, relics & the run story ---
  relics: BrewRelic[];                  // acquired deckbuilding modifiers (bias future offers/scoring)
  comboWatch: string[];                 // missing combo-piece names to bias toward (set by "Investigate")
  firedEventIds: string[];              // event ids already surfaced this run (dedupe)
  lastMomentPick: number;               // picks.length at the last event/relic — enforces a min gap
  moments: BrewMoment[];                // story log for the end-of-run recap (decoupled from undo history)
  synergyStreak?: number;               // consecutive synergy-positive decisions — drives the "on a roll" HUD chip + milestone celebrations
  goalDone?: boolean;                   // the run's Brewer's Goal has been completed (latches, so we celebrate once)
}

/** The run's objective — a soft goal to chase, derived deterministically from the commander (see goals.ts). */
export interface BrewGoal {
  id: 'combo' | 'wide' | 'identity';
  label: string;        // short HUD label, e.g. "Assemble a combo"
  description: string;  // recap/tooltip line
  target: number;       // completion threshold (combos completed / creatures drafted / theme affinity)
}

/** A brief celebratory toast fired at an earned beat (goal complete, hot streak, combo online). */
export interface BrewCelebration {
  kind: 'goal' | 'streak' | 'combo';
  title: string;
  subtitle?: string;
  /**
   * Combo takeover only: the pieces that just clicked (owned pieces first, then the ones you added),
   * as art-crop URLs. When present, the combo celebration graduates from a corner toast to a centered
   * "the engine comes online" spectacle — the run's high, given the spotlight it earns.
   */
  cards?: { name: string; art?: string }[];
}

export interface BrewHealth {
  cardCount: number;          // total cards picked (includes lands once the mana-base node runs in Plan 3)
  nonLandTarget: number;
  roleCounts: Record<RoleKey, number>;
  roleTargets: Record<RoleKey, number>;
  typeCounts: Record<string, number>;
  typeTargets: Record<string, number>;
  estCostUsd: number;         // sum of pick prices
  themeDensity: number;       // 0-100, share of picks that are theme-synergy cards
  curveVerdict: 'low' | 'healthy' | 'high';
}

// ---------------------------------------------------------------------------
// The "fun layer": events, relics & the run story
//
// Events are framed, emotional decisions generated from the runtime data the engine already
// holds (discovery / near-miss combos / theme affinity) and surfaced at steering milestones.
// Relics are persistent modifiers that bias future offers and scoring. Moments form the
// end-of-run story recap. None of these require new network calls.
// ---------------------------------------------------------------------------

export type BrewEventKind = 'strangeSignal' | 'comboFragment' | 'crossroads' | 'signaturePick' | 'gamble';

/** One choice button on an event screen. */
export interface BrewEventChoice {
  id: string;
  label: string;       // button text: "Trust it", "Investigate", "Commit to Tokens"
  blurb: string;       // one-line consequence framing
  tone?: RouteTone;    // optional accent (drives the button color)
}

/** A competing emerging theme presented at a Crossroads. */
export interface BrewCrossroadsPath {
  slug: string;                 // theme slug (the affinity key to commit)
  name: string;                 // display name
  sampleCards: BrewCandidate[]; // 2-3 signature cards to preview the direction
}

/** A generated "moment": a framed decision surfaced at a steering milestone. */
export interface BrewEvent {
  id: string;                   // stable dedupe key, e.g. "signal:Pitiless Plunderer"
  kind: BrewEventKind;
  title: string;                // "Strange Signal" | "Combo Fragment" | "Crossroads"
  flavor: string;               // the intrigue line shown under the title
  card?: BrewCandidate;         // strangeSignal: the surprising card (shown face-up, no stat badges)
  combo?: {                     // comboFragment: the interaction this fragment belongs to
    comboId: string;
    results: string[];          // what the combo does
    missing: BrewCandidate[];   // pieces still needed (in the pool)
    have: ComboPiece[];         // pieces already owned (shown dimmed for context)
  };
  paths?: BrewCrossroadsPath[]; // crossroads: the competing directions
  choices: BrewEventChoice[];
  canPass: boolean;             // a non-committal "stay open" / "ignore" exit
  passLabel?: string;           // wording for the pass button ("Not this time", "Abandon", "Stay open")
}

/** A relic's mechanical effect. All are small, additive reads consumed where offers are generated. */
export type BrewRelicEffect =
  | { type: 'themeWeight'; slug: string; mult: number }   // boost a theme's scoring contribution
  | { type: 'discoveryRate'; mult: number }               // seed more card-to-card discoveries
  | { type: 'spiceRate'; mult: number }                   // (legacy) more wildcard appearances — unused
  | { type: 'efficiency'; mult: number }                  // favor proven staples, dampen speculative discovery
  | { type: 'comboBias'; mult: number }                   // combo-watch pieces float up harder
  | { type: 'packBonus'; role: RoleKey; extra: number }   // +N cards in that role's packs
  | { type: 'budgetCap'; maxUsd: number };                // cards over this price stop appearing

/** A persistent deckbuilding modifier acquired mid-run. */
export interface BrewRelic {
  id: string;
  name: string;
  description: string; // player-facing effect line
  glyph?: string;      // lucide icon key for the relic tray
  effect: BrewRelicEffect;
}

/** Transient banner shown right after a Crossroads commit: how the run just changed. */
export interface BrewCommitFlash {
  theme: string;      // display name of the committed theme
  injected: number;   // new on-theme cards pulled into the pool (0 until the async fetch resolves)
  suppressed: number; // off-theme, non-urgent cards now set aside
}

/** Story-log entry for the end-of-run recap (decoupled from pick history/undo). */
export interface BrewMoment {
  atPick: number;                              // picks.length when it happened
  kind: BrewEventKind | 'relic' | 'opening' | 'goldCard';
  label: string;                               // short headline
  detail?: string;                             // optional secondary line
  // goldCard moments only — the structured windfall, so the Treasury (the cross-run binder) can
  // record the actual card rather than parse the headline. Meta-MEMORY, never meta-power.
  cardName?: string;
  windfallTier?: 'gold' | 'rainbow';
  art?: string;                                // art-crop URL for the Treasury/recap render
}
