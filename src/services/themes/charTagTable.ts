import charTagTable from '@/data/themeCharTags.json';

export interface ThemeTableEntry {
  /** Characteristic tag slugs. Populated for ARCHETYPE themes only — deterministic kinds have a
   *  literal card-attribute test and would double-count themselves if they also carried tags. */
  charTags: string[];
  /**
   * Fraction of all commander-legal cards that belong to this theme, measured over Scryfall's bulk
   * data. This is the denominator for observed-over-expected: 10 Humans in a deck is unremarkable
   * because Humans' base rate is enormous, while 6 Praetors is not.
   *
   * Caveat, deliberately accepted for v1: this is measured across ALL colors, so it slightly
   * over-penalizes themes concentrated in a deck's own colors. `/theme-lab` shows the raw ratio
   * alongside the lift so the effect is visible rather than hidden.
   */
  baseRate: number;
}

export interface ThemeCharTagTable {
  /** ISO timestamp of the build run, or null when the table has never been generated. */
  generatedAt: string | null;
  /** theme slug → entry. Missing slugs are normal and degrade softly. */
  themes: Record<string, ThemeTableEntry>;
}

/**
 * The precomputed archetype definitions, built by `npm run build:theme-tags` and committed to the
 * repo. Bundled rather than fetched: it's a few KB, it never goes stale on its own (theme
 * definitions don't drift — new cards get classified BY them), and unlike the S3 tag index it works
 * in local dev and offline.
 *
 * An empty `themes` map is a valid, expected state: every consumer degrades to "archetype themes
 * have no tag signal, and every theme falls back to the expected-rate floor" while deterministic
 * themes keep working.
 */
export function loadThemeCharTags(): ThemeCharTagTable {
  return charTagTable as ThemeCharTagTable;
}
