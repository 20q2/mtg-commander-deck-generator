import type { ScryfallCard, EDHRECCard, EDHRECCombo, Customization } from '@/types';
import type { RoleKey } from '@/services/tagger/client';

/** A single scored card in the brew candidate pool. */
export interface BrewCandidate {
  name: string;
  edhrec: EDHRECCard;          // EDHREC record (inclusion, synergy, primary_type)
  scryfall: ScryfallCard;      // Resolved Scryfall card (cmc, type_line, prices, color_identity)
  role: RoleKey | null;        // From getCardRole()
  subtype: string | null;      // From getCardSubtype()
  inclusion: number;           // EDHREC inclusion % (mirror of edhrec.inclusion)
  isLand: boolean;             // type_line includes 'land'
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
}

export type ReasonKind = 'synergy' | 'role' | 'theme' | 'curve' | 'combo';

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

export type RouteType = 'draft' | 'bundle' | 'lightning' | 'gamble' | 'combo' | 'manabase';
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
}

/** A pickable option inside a node: one card (draft/lightning/gamble) or several (bundle/combo). */
export interface BrewOption {
  id: string;
  label?: string;             // bundle theme name, e.g. "Sacrifice Synergy"
  cards: BrewCandidate[];     // 1 for draft/lightning/gamble, 3-5 for bundle, 1-3 for combo
  reasons: PickReason[][];    // reasons[i] corresponds to cards[i]
}

export interface BrewNode {
  routeId: string;
  type: RouteType;
  prompt: string;             // node heading
  options: BrewOption[];      // draft/bundle: pick 1 of options; lightning: see picksRemaining
  picksRemaining?: number;    // lightning round: how many single picks remain (starts at 5)
  canPass: boolean;           // gamble allows passing
}

export type BrewPhase = 'nonland' | 'lands' | 'done';

export interface BrewHistoryEntry {
  pickNumber: number;
  routeId: string;
  routeType: RouteType;
  added: string[];            // card names added in this decision
  passed: string[];           // names shown-but-not-taken (for Plan 3 Build History)
  tags?: Record<string, string[]>; // picked card name -> synergy tags (lets undo subtract affinity precisely)
}

/** Mutable session progress. */
export interface BrewState {
  picks: BrewPick[];
  usedNames: string[];                  // names already in the deck (excludes them from future packs)
  themeAffinity: Record<string, number>; // synergy-tag -> accumulated weight from picks
  rerollsUsed: Record<string, number>;   // fork/node id -> count
  phase: BrewPhase;
  history: BrewHistoryEntry[];
}

export interface BrewHealth {
  cardCount: number;          // total cards picked (includes lands once the mana-base node runs in Plan 3)
  nonLandTarget: number;
  deckScore: number;          // sum of EDHREC inclusion % across picks (mirrors GeneratedDeck.deckScore)
  roleCounts: Record<RoleKey, number>;
  roleTargets: Record<RoleKey, number>;
  typeCounts: Record<string, number>;
  typeTargets: Record<string, number>;
  estCostUsd: number;         // sum of pick prices
  themeDensity: number;       // 0-100, share of picks that are theme-synergy cards
  curveVerdict: 'low' | 'healthy' | 'high';
}
