import type { BrewContext, BrewState } from './brewTypes';

/**
 * The Brew Journal & Treasury — cross-run MEMORY, never meta-power. localStorage only: the Journal
 * keeps each finished run's story facts; the Treasury is the binder of every windfall ever revealed.
 * Nothing here unlocks, gates, or strengthens future runs — the game records, it never escalates
 * (the explicit line the user drew when approving this against the "no meta-progression" non-goal).
 */

const JOURNAL_KEY = 'mtg-brew-journal-v1';
/** Cap so a devoted brewer never blows the localStorage quota; oldest runs fall off. */
const MAX_RUNS = 50;

export interface TreasuryEntry {
  cardName: string;
  tier: 'gold' | 'rainbow';
  art?: string;
}

export interface JournalRun {
  id: string;             // the ?b= session id
  date: string;           // ISO timestamp of the finish
  title: string;          // the generated run title
  commanderName: string;
  philosophy?: string;    // chosen deck philosophy, if any
  goalLabel: string;
  goalDone: boolean;
  picks: number;
  treasury: TreasuryEntry[];   // windfalls this run revealed
}

export function loadJournal(): JournalRun[] {
  try {
    const raw = localStorage.getItem(JOURNAL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Prepend the finished run (newest first), capped; quota/serialization failures are non-fatal. */
export function recordRun(run: JournalRun): void {
  try {
    const runs = [run, ...loadJournal().filter(r => r.id !== run.id)].slice(0, MAX_RUNS);
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(runs));
  } catch {
    /* recording memory must never break finishing a deck */
  }
}

/** The windfalls a run actually revealed, from its structured goldCard moments. */
export function treasuryFromState(state: BrewState): TreasuryEntry[] {
  return state.moments
    .filter(m => m.kind === 'goldCard' && m.cardName)
    .map(m => ({ cardName: m.cardName!, tier: m.windfallTier ?? 'gold', art: m.art }));
}

/** Every Treasury pull across all recorded runs, newest first, tagged with its run. */
export function allTreasury(runs: JournalRun[]): (TreasuryEntry & { runTitle: string; date: string })[] {
  return runs.flatMap(r => r.treasury.map(t => ({ ...t, runTitle: r.title, date: r.date })));
}

/** Build the journal entry for a finished run. Pure aside from the timestamp. */
export function buildJournalRun(
  ctx: BrewContext, state: BrewState,
  extras: { id: string; title: string; goalLabel: string; goalDone: boolean },
): JournalRun {
  return {
    id: extras.id,
    date: new Date().toISOString(),
    title: extras.title,
    commanderName: ctx.commander.name,
    philosophy: state.relics[0]?.name,
    goalLabel: extras.goalLabel,
    goalDone: extras.goalDone,
    picks: state.picks.length,
    treasury: treasuryFromState(state),
  };
}
