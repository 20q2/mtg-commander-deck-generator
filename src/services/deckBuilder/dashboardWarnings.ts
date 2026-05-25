// src/services/deckBuilder/dashboardWarnings.ts
import type { DashboardWarning, ScryfallCard } from '@/types';
import type { DeckAnalysis } from './deckAnalyzer';

export interface WarningInputs {
  analysis: DeckAnalysis;
  cards: ScryfallCard[];
  /** Deck-size target excluding commander (e.g. 99 for standard Commander). */
  deckTarget: number;
}

export function buildDashboardWarnings(inputs: WarningInputs): DashboardWarning[] {
  const { analysis, cards, deckTarget } = inputs;
  const out: DashboardWarning[] = [];

  // Card count
  const total = cards.length;
  if (total > deckTarget) {
    out.push({
      id: 'count-over',
      severity: 'warn',
      message: `${total - deckTarget} cards over target — trim from Card Fit.`,
      navigateTo: 'optimize',
    });
  } else if (total < deckTarget) {
    out.push({
      id: 'count-under',
      severity: 'warn',
      message: `${deckTarget - total} cards under target — add from Card Fit gaps.`,
      navigateTo: 'optimize',
    });
  }

  // Mana base
  const verdict = analysis.manaBase.verdict;
  if (verdict === 'critically-low') {
    out.push({
      id: 'mana-starved',
      severity: 'error',
      message: `Mana base is starved — ${analysis.manaBase.currentLands} lands, deck wants ${analysis.manaBase.adjustedSuggestion}+.`,
      navigateTo: 'lands',
    });
  } else if (verdict === 'low' || verdict === 'slightly-low') {
    out.push({
      id: 'mana-low',
      severity: 'warn',
      message: `Mana may be light — ${analysis.manaBase.currentLands} lands vs target ${analysis.manaBase.adjustedSuggestion}.`,
      navigateTo: 'lands',
    });
  } else if (verdict === 'high') {
    out.push({
      id: 'mana-high',
      severity: 'info',
      message: `Running heavy on lands (${analysis.manaBase.currentLands}, deck wants ~${analysis.manaBase.adjustedSuggestion}).`,
      navigateTo: 'lands',
    });
  }

  // Limited data
  if (analysis.planScore?.limitedData) {
    out.push({
      id: 'limited-data',
      severity: 'info',
      message: 'Limited EDHREC data for this commander — some sub-scores excluded.',
    });
  }

  return out;
}
