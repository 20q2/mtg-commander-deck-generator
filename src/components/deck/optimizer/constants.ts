import {
  Sparkles, TrendingUp, Swords, Flame, BookOpen, Shield,
  LayoutDashboard, Mountain, BarChart3, Layers, Zap, Target, Crown,
} from 'lucide-react';
import type { Pacing } from '@/services/deckBuilder/themeDetector';
import type { CurvePhase } from '@/services/deckBuilder/deckAnalyzer';
import type { ScryfallCard, DeckCategory } from '@/types';
export type { UserCardList } from '@/types';
import type { ReactNode } from 'react';

// ─── Props & Tab Types ───────────────────────────────────────────────

export interface DeckOptimizerProps {
  commanderName: string;
  partnerCommanderName?: string;
  currentCards: ScryfallCard[];
  deckSize: number;
  roleCounts: Record<string, number>;
  roleTargets: Record<string, number>;
  categories: Record<DeckCategory, ScryfallCard[]>;
  cardInclusionMap?: Record<string, number>;
  onAddCards?: (cardNames: string[], destination: 'deck' | 'sideboard' | 'maybeboard') => void;
  onRemoveCards?: (cardNames: string[]) => void;
  onRemoveFromBoard?: (cardName: string, source: 'sideboard' | 'maybeboard') => void;
  onAddBasicLand?: (name: string) => void;
  onRemoveBasicLand?: (name: string) => void;
  sideboardNames?: string[];
  maybeboardNames?: string[];
}

export type TabKey = 'overview' | 'roles' | 'lands' | 'curve' | 'types';

export const TABS: { key: TabKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'roles',    label: 'Roles',    icon: Shield as typeof LayoutDashboard },
  { key: 'lands',    label: 'Mana',     icon: Mountain as typeof LayoutDashboard },
  { key: 'curve',    label: 'Curve',    icon: BarChart3 as typeof LayoutDashboard },
  { key: 'types',    label: 'Types',    icon: Layers as typeof LayoutDashboard },
];

// ─── Utility Functions ───────────────────────────────────────────────

/** HSL bar color: red (0%) → amber (50%) → green (100%) based on current/target ratio */
export function roleBarColor(current: number, target: number): string {
  if (target <= 0) return `hsl(120, 60%, 45%)`;
  const ratio = Math.min(current / target, 1);
  const hue = ratio * 120; // 0 = red, 60 = amber, 120 = green
  return `hsl(${hue}, 60%, 45%)`;
}

/** Scryfall direct image redirect — works as <img src> */
export function scryfallImg(name: string, version: 'small' | 'normal' = 'small'): string {
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=${version}`;
}

/** Convert Scryfall edhrec_rank (lower = more popular) to a pseudo-inclusion % (0-99). Returns null if rank is missing. */
export function edhrecRankToInclusion(rank?: number): number | null {
  if (rank == null) return null;
  return Math.max(1, 100 - Math.floor(rank / 100));
}

// ─── Role Meta & Style Constants ─────────────────────────────────────

export const ROLE_META: Record<string, { icon: typeof Sparkles; color: string; barColor: string }> = {
  ramp:      { icon: TrendingUp as typeof Sparkles, color: 'text-emerald-400', barColor: 'bg-emerald-500' },
  removal:   { icon: Swords as typeof Sparkles,     color: 'text-rose-400',    barColor: 'bg-rose-500' },
  boardwipe: { icon: Flame as typeof Sparkles,      color: 'text-orange-400',  barColor: 'bg-orange-500' },
  cardDraw:  { icon: BookOpen as typeof Sparkles,   color: 'text-sky-400',     barColor: 'bg-sky-500' },
};

export const RANK_STYLES = [
  { bg: 'bg-amber-500/10', border: 'border-amber-500/30', badge: 'bg-amber-500 text-amber-950', label: '1st' },
  { bg: 'bg-slate-300/10', border: 'border-slate-400/30', badge: 'bg-slate-400 text-slate-950', label: '2nd' },
  { bg: 'bg-orange-700/10', border: 'border-orange-600/30', badge: 'bg-orange-700 text-orange-100', label: '3rd' },
];

export const ROLE_LABELS: Record<string, string> = {
  ramp: 'Ramp', removal: 'Removal', boardwipe: 'Board Wipes', cardDraw: 'Card Advantage',
};

export const ROLE_BADGE_COLORS: Record<string, string> = {
  Ramp: 'bg-emerald-500/20 text-emerald-400',
  Removal: 'bg-rose-500/20 text-rose-400',
  'Board Wipes': 'bg-orange-500/20 text-orange-400',
  'Card Advantage': 'bg-sky-500/20 text-sky-400',
};

export const ROLE_ICON_COLORS: Record<string, string> = {
  Ramp: 'text-emerald-400',
  Removal: 'text-rose-400',
  'Board Wipes': 'text-orange-400',
  'Card Advantage': 'text-sky-400',
};

export const VERDICT_STYLES: Record<string, { border: string; bg: string; icon: string; titleColor: string }> = {
  'critically-low': { border: 'border-red-500/40', bg: 'bg-red-500/10', icon: '🚨', titleColor: 'text-red-400' },
  'low':            { border: 'border-amber-500/40', bg: 'bg-amber-500/10', icon: '⚠️', titleColor: 'text-amber-400' },
  'slightly-low':   { border: 'border-amber-500/30', bg: 'bg-amber-500/5', icon: '📉', titleColor: 'text-amber-400/80' },
  'high':           { border: 'border-sky-500/30', bg: 'bg-sky-500/5', icon: '📈', titleColor: 'text-sky-400' },
  'ok':             { border: 'border-emerald-500/30', bg: 'bg-emerald-500/5', icon: '✅', titleColor: 'text-emerald-400' },
};

export const SUBTYPE_BADGE_COLORS: Record<string, string> = {
  'Mana Dork': 'bg-emerald-500/15 text-emerald-400/80',
  'Mana Rock': 'bg-emerald-500/15 text-emerald-400/80',
  'Cost Reducer': 'bg-emerald-500/15 text-emerald-400/80',
  'Ramp': 'bg-emerald-500/15 text-emerald-400/80',
  'Counter': 'bg-rose-500/15 text-rose-400/80',
  'Bounce': 'bg-rose-500/15 text-rose-400/80',
  'Spot Removal': 'bg-rose-500/15 text-rose-400/80',
  'Removal': 'bg-rose-500/15 text-rose-400/80',
  'Bounce Wipe': 'bg-orange-500/15 text-orange-400/80',
  'Board Wipe': 'bg-orange-500/15 text-orange-400/80',
  'Tutor': 'bg-sky-500/15 text-sky-400/80',
  'Wheel': 'bg-sky-500/15 text-sky-400/80',
  'Cantrip': 'bg-sky-500/15 text-sky-400/80',
  'Card Draw': 'bg-sky-500/15 text-sky-400/80',
  'Card Advantage': 'bg-sky-500/15 text-sky-400/80',
};

export const ROLE_LABEL_ICONS: Record<string, typeof Sparkles> = {
  // Role-level
  'Ramp': TrendingUp as typeof Sparkles,
  'Removal': Swords as typeof Sparkles,
  'Board Wipes': Flame as typeof Sparkles,
  'Card Advantage': BookOpen as typeof Sparkles,
  // Ramp subtypes
  'Mana Dork': TrendingUp as typeof Sparkles,
  'Mana Rock': TrendingUp as typeof Sparkles,
  'Cost Reducer': TrendingUp as typeof Sparkles,
  // Removal subtypes
  'Counter': Swords as typeof Sparkles,
  'Bounce': Swords as typeof Sparkles,
  'Spot Removal': Swords as typeof Sparkles,
  // Boardwipe subtypes
  'Bounce Wipe': Flame as typeof Sparkles,
  'Board Wipe': Flame as typeof Sparkles,
  // Card draw subtypes
  'Tutor': BookOpen as typeof Sparkles,
  'Wheel': BookOpen as typeof Sparkles,
  'Cantrip': BookOpen as typeof Sparkles,
  'Card Draw': BookOpen as typeof Sparkles,
};

// ─── Suggestion Sort ─────────────────────────────────────────────────

export type SuggestionSortMode = 'relevance' | 'popularity' | 'none';
export const SORT_KEY = 'suggestion-sort';
export const sortListeners = new Set<(mode: SuggestionSortMode) => void>();

// ─── Health Grade Styles ─────────────────────────────────────────────

export const HEALTH_GRADE_STYLES: Record<string, { color: string; badgeBg: string }> = {
  A: { color: 'text-emerald-400', badgeBg: 'bg-emerald-500/15' },
  B: { color: 'text-sky-400', badgeBg: 'bg-sky-500/15' },
  C: { color: 'text-amber-400', badgeBg: 'bg-amber-500/15' },
  D: { color: 'text-orange-400', badgeBg: 'bg-orange-500/15' },
  F: { color: 'text-red-400', badgeBg: 'bg-red-500/15' },
};

// ─── Tempo Options ───────────────────────────────────────────────────

export const TEMPO_OPTIONS: { value: Pacing; label: string; short: string; detail: string; examples: string }[] = [
  { value: 'aggressive-early', label: 'Aggressive', short: 'Win fast with cheap threats',
    detail: 'Heavily weighted toward 1–2 CMC. Aims to win or establish a dominant position before opponents stabilize. Prioritizes speed over card advantage.',
    examples: 'e.g. Najeela, Winota, Rograkh — flood the board early and close out fast' },
  { value: 'fast-tempo', label: 'Fast', short: 'Low curve, quick pressure',
    detail: 'Peaks at 2 CMC with a lean curve. Gets on board quickly and uses efficient interaction to stay ahead. Still runs some mid-cost payoffs.',
    examples: 'e.g. Yuriko, Tymna/Kraum, Raffine — cheap creatures backed by disruption' },
  { value: 'midrange', label: 'Midrange', short: 'Balanced 3–4 CMC core',
    detail: 'Curve centers around 3–4 CMC with flexible answers and value engines. Adapts between aggro and control depending on the matchup.',
    examples: 'e.g. Meren, Prossh, Korvold — grind value and win with synergy over time' },
  { value: 'late-game', label: 'Late-Game', short: 'Big finishers, slow build',
    detail: 'Invests heavily in ramp and card draw early, then takes over with high-impact 6+ CMC spells. Needs enough early interaction to survive.',
    examples: 'e.g. Ur-Dragon, Omnath Locus of Creation, Vial Smasher — ramp into game-ending threats' },
  { value: 'balanced', label: 'Balanced', short: 'Even spread across costs',
    detail: 'Smooth distribution from 1–6+ CMC with no sharp peaks. Plays well at every stage of the game without committing to a specific speed.',
    examples: 'e.g. Atraxa, Kenrith, Sisay — toolbox decks that need answers at every mana cost' },
];

// ─── Land Section ────────────────────────────────────────────────────

export type LandSection = 'landCount' | 'manaSources' | 'fixing' | 'mdfc';

// ─── Fixing Grade Styles & Color Bars ────────────────────────────────

export const FIXING_GRADE_STYLES: Record<string, { color: string; bgColor: string; border: string; bg: string }> = {
  A: { color: 'text-emerald-400', bgColor: 'bg-emerald-500/15', border: 'border-emerald-500/30', bg: 'bg-emerald-500/5' },
  B: { color: 'text-sky-400', bgColor: 'bg-sky-500/15', border: 'border-sky-500/30', bg: 'bg-sky-500/5' },
  C: { color: 'text-amber-400', bgColor: 'bg-amber-500/15', border: 'border-amber-500/30', bg: 'bg-amber-500/5' },
  D: { color: 'text-orange-400', bgColor: 'bg-orange-500/15', border: 'border-orange-500/30', bg: 'bg-orange-500/5' },
  F: { color: 'text-red-400', bgColor: 'bg-red-500/15', border: 'border-red-500/30', bg: 'bg-red-500/5' },
};

export const COLOR_BARS: Record<string, string> = {
  W: 'bg-amber-200', U: 'bg-blue-500', B: 'bg-violet-500', R: 'bg-red-500', G: 'bg-green-500',
};

export function tileGradeStyles(letter: string) {
  return FIXING_GRADE_STYLES[letter] || FIXING_GRADE_STYLES.C;
}

// ─── Role Known Subtypes ─────────────────────────────────────────────

export const ROLE_KNOWN_SUBTYPES: Record<string, Set<string>> = {
  ramp: new Set(['Mana Dork', 'Mana Rock', 'Cost Reducer', 'Ramp']),
  removal: new Set(['Counter', 'Bounce', 'Spot Removal', 'Removal']),
  boardwipe: new Set(['Bounce Wipe', 'Board Wipe']),
  cardDraw: new Set(['Tutor', 'Wheel', 'Cantrip', 'Card Draw', 'Card Advantage']),
};

// ─── Collapsible Group Interface ─────────────────────────────────────

export interface CollapsibleGroup {
  key: string;
  label: string;
  count: number;
  content: ReactNode;
}

// ─── Curve Tab Constants ─────────────────────────────────────────────

export const PACING_LABELS: Record<string, string> = {
  'aggressive-early': 'Aggressive',
  'fast-tempo': 'Fast',
  'midrange': 'Midrange',
  'late-game': 'Late-Game',
  'balanced': 'Balanced',
};

export const PHASE_META: Record<CurvePhase, { icon: typeof Zap; label: string }> = {
  early: { icon: Zap, label: 'Early Game' },
  mid:   { icon: Target as typeof Zap, label: 'Mid Game' },
  late:  { icon: Crown as typeof Zap, label: 'Late Game' },
};
