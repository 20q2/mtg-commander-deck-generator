// src/components/deck/optimizer/dashboard/launchpad/cheaperSwaps.ts
//
// Which of the Cost Explorer's swaps the Overview puts its name to, shared by the tile, the panel and
// the panel art so all three agree on the number.
import { useEffect, useState } from 'react';
import { getGameChangerNames } from '@/services/scryfall/client';
import { LOW_FIT_INCLUSION } from '@/services/deckBuilder/cutRanking';
import type { CostPlan, SwapRow, SwapSuggestion } from '@/services/deckBuilder/costAnalyzer';
import type { LaunchPadDeps } from './types';

/** The player is aiming below what the deck's Game Changers allow. */
export interface GameChangerPressure {
  aim: number;
  /** How many the aimed bracket allows: none below 3, three at 3. */
  allowed: number;
  /** The deck's Game Changers, every one a candidate to come out. */
  names: Set<string>;
}

export interface CheaperSwap {
  row: SwapRow;
  /** The row's pick, or the first stand-in that isn't itself a Game Changer when that matters. */
  suggestion: SwapSuggestion;
  savings: number;
  /** Suggestion's mana value minus the current card's, when both are known. */
  manaDelta: number | null;
  /** Coming out because of the bracket aim, not only the price. */
  forAim: boolean;
}

export function gameChangerPressure(d: LaunchPadDeps): GameChangerPressure | null {
  const basis = d.bracketAim?.basis;
  if (!basis || basis.source === 'estimated' || basis.bracket >= 4) return null;
  const names = d.bracketEstimation?.breakdown.gameChangerNames ?? [];
  const allowed = basis.bracket >= 3 ? 3 : 0;
  return names.length > allowed ? { aim: basis.bracket, allowed, names: new Set(names) } : null;
}

/** The Game Changer list, fetched only while an aim makes it matter (cached by the client). */
export function useGameChangerNames(enabled: boolean): Set<string> | null {
  const [names, setNames] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!enabled || names) return;
    let live = true;
    getGameChangerNames().then(s => { if (live) setNames(s); }).catch(() => { if (live) setNames(new Set()); });
    return () => { live = false; };
  }, [enabled, names]);
  return names;
}

const manaDelta = (row: SwapRow, s: SwapSuggestion) =>
  row.current.cmc != null && s.cmc != null ? s.cmc - row.current.cmc : null;

/**
 * Two kinds of swap, the bracket's first:
 * - A Game Changer the aimed bracket doesn't allow, for any cheaper stand-in that isn't one too.
 *   These come out for the bracket, so a looser match still earns its place.
 * - A cheaper card EDHREC lists as similar that these decks also play. A "similar" card nobody runs
 *   here (The One Ring → Mazemind Tome) saves money by making the deck worse, so it stays in the
 *   Cost Explorer. A different mana value is allowed and labelled on the row, not hidden: Imperial
 *   Seal → Cruel Tutor costs two more and saves $139.
 */
export function cheaperSwaps(
  plan: CostPlan | null,
  pressure: GameChangerPressure | null,
  gameChangers: Set<string> | null,
): CheaperSwap[] {
  if (!plan) return [];
  const used = new Set<string>();
  const take = (row: SwapRow, suggestion: SwapSuggestion, forAim: boolean): CheaperSwap => {
    used.add(suggestion.name);
    return { row, suggestion, savings: row.currentPrice - suggestion.price, manaDelta: manaDelta(row, suggestion), forAim };
  };
  const bySavings = (a: SwapRow, b: SwapRow) => b.savings - a.savings;

  const forAim: CheaperSwap[] = [];
  if (pressure && gameChangers) {
    for (const row of [...plan.similarRows, ...plan.roleRows].filter(r => pressure.names.has(r.current.name)).sort(bySavings)) {
      const pick = [row.suggestion, ...row.alternatives].find(s => !gameChangers.has(s.name) && !used.has(s.name));
      if (pick) forAim.push(take(row, pick, true));
    }
  }
  const aimed = new Set(forAim.map(s => s.row.id));
  const played = plan.similarRows
    .filter(r => !aimed.has(r.id) && r.suggestion.inclusion >= LOW_FIT_INCLUSION && !used.has(r.suggestion.name))
    .sort(bySavings)
    .map(r => take(r, r.suggestion, false));
  return [...forAim, ...played];
}
