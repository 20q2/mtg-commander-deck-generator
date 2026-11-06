import type { BracketBlend, RisingCard } from '@/services/deckBuilder/bracketBlend';
import type { OverBracketGroup } from '@/services/deckBuilder/overBracket';
import type { BracketViewModel } from './bracketViewModel';

export type BracketGap =
  /** Aim and reading agree. */
  | { kind: 'none' }
  /** 4 vs 5: the same cards, told apart by intent — nothing on the list to change. */
  | { kind: 'intent'; aim: number; reads: number }
  /** `reasons` is overBracketGroups — the same list Card Fit cuts from. */
  | { kind: 'over'; aim: number; reads: number; reasons: OverBracketGroup[] }
  /** `rising` is null when the aimed bracket's page wasn't loaded or is too thin to read. */
  | { kind: 'under'; aim: number; reads: number; rising: RisingCard[] | null; bracketDecks: number };

/** Fewer decks than this and a bracket page's "plays far more" list is a few players' taste. */
export const RISING_MIN_DECKS = 20;

export function buildBracketGap(
  vm: BracketViewModel,
  aim: number,
  blend: BracketBlend | null,
  deckNames: Set<string>,
  /** overBracketGroups(estimation, combos, aim). */
  overGroups: OverBracketGroup[],
): BracketGap {
  if (aim >= vm.bracket && aim <= vm.bracketMax) return { kind: 'none' };
  // A deck that trips a Bracket 4 floor can be a 5 and vice versa — the estimator can't separate
  // them, so neither direction is a gap. (1 vs 2 is the same, and the estimate already reads as a
  // range there, so it never reaches this line.)
  if (aim >= 4 && vm.bracket >= 4) return { kind: 'intent', aim, reads: vm.bracket };

  if (aim < vm.bracket) return { kind: 'over', aim, reads: vm.bracket, reasons: overGroups };

  const loaded = blend && blend.bracket === aim ? blend : null;
  return {
    kind: 'under',
    aim,
    reads: vm.bracketMax,
    bracketDecks: loaded?.bracketDecks ?? 0,
    rising: loaded && loaded.bracketDecks >= RISING_MIN_DECKS
      ? loaded.rising.filter(r => !deckNames.has(r.name)).slice(0, 12)
      : null,
  };
}
