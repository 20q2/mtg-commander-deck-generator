// src/components/deck/optimizer/dashboard/launchpad/types.ts
import type { ScryfallCard, PlanScore, IntendedBracket } from '@/types';
import type { BracketBasis } from '@/services/deckBuilder/bracketBlend';
import type { DeckAnalysis, OptimizeSwaps } from '@/services/deckBuilder/deckAnalyzer';
import type { BracketEstimation } from '@/services/deckBuilder/bracketEstimator';
import type { PointsToGain } from '@/services/deckBuilder/planScore';
import type { TabKey } from '../../constants';
import type { ReasonContext, SwapPair } from './jobs';
import type { CardMenuWiring } from './cardMenu';

export type LaunchNavigate = (
  tab: TabKey,
  opts?: { cardName: string; side: 'add' | 'remove'; pairs?: { out: string; in: string }[] },
) => void;

/** One change made from the launch pad this visit — the session strip lists these and undoes them. */
export interface LaunchChange {
  id: string;
  /** "Thought Vessel → Brightstone Ritual", "Cut Fireball", "Add Goblin-town Flunkies". */
  label: string;
  removals: string[];
  additions: string[];
}

/** What DeckOptimizer wires in beyond what the dashboard already holds. */
export interface LaunchPadWiring {
  commanderName: string;
  partnerCommanderName?: string;
  /** The deck's colour identity as the tabs read it (the store's), so the lift scan and the New
   *  Cards pipeline ask exactly what their tabs ask and share the tabs' caches. */
  colorIdentity?: string[];
  currency: 'USD' | 'EUR';
  mustIncludeNames: Set<string>;
  /** Sideboard + maybeboard: never offered as a cheaper stand-in. */
  excludeFromSuggestions: Set<string>;
  /** Same inputs the New Cards tab gets, so the preview and the tab answer the same question. */
  newCards: {
    intendedThemes?: string[];
    themeRefs?: { slug: string; name: string }[];
    listId?: string;
    lastEditedAt?: number;
  };
  /** The bracket the player is aiming for — the Bracket tab's own state and setter, so changing it
   *  here re-aims Card Fit and every suggestion exactly as the tab's picker does. */
  bracketAim?: {
    basis: BracketBasis | null;
    refreshing: boolean;
    onChange: (bracket: IntendedBracket | null) => void;
  };
  /** Card Fit's own apply path: removals leave the deck, additions join it. */
  onApplySwap: (removals: string[], additions: string[]) => void;
  onPreviewCard: (name: string) => void;
  /** The Inspector's card actions, for the right-click menu on every card the launch pad shows. */
  cardMenu?: CardMenuWiring;
}

/** Everything a job preview reads. Built once per render by LaunchPad. */
export interface LaunchPadDeps extends LaunchPadWiring {
  planScore: PlanScore;
  analysis: DeckAnalysis;
  cards: ScryfallCard[];
  commander: ScryfallCard;
  partnerCommander?: ScryfallCard;
  colorIdentity?: string[];
  baseSwaps: OptimizeSwaps | null;
  /** Cards over target (positive) or under it (negative). */
  deckExcess: number;
  deckTarget?: number;
  bracketEstimation?: BracketEstimation;
  /** Decklists behind the comparison, for "how is this scored?". */
  sampleSize?: number | null;
  gains: PointsToGain[];
  reasonCtx: ReasonContext;
  onNavigate: LaunchNavigate;

  // ── Built by LaunchPad ──
  /** The swaps the upgrades job shows (Card Fit's columns, minus kept cards), paired by role. */
  pairs: SwapPair[];
  /** Projected overall score after each prefix of `pairs` (see projectSwaps). */
  pairProjection: number[];
  /** Cards the player chose to keep — never offered as a cut here again for this deck. */
  kept: Set<string>;
  keep: (name: string) => void;
  unkeep: (name: string) => void;
  isApplied: (id: string) => boolean;
  apply: (change: LaunchChange) => void;
  undo: (id: string) => void;
}
