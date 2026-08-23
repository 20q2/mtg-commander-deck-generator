import type { EDHRECCommanderData, EDHRECTheme, ScryfallCard } from '@/types';
import { getMtgCatalogs } from '@/services/scryfall/client';
import { fetchAllTags } from '@/services/edhrec/client';
import { loadTagIndex, tagsForOracleId } from '@/services/spellchroma/tagIndex';
import {
  buildThemeModel, scoreThemesForDeck, survivingThemes, loadThemeCharTags,
  SHORTLIST_SIZE, type ThemeScore,
} from '@/services/themes';
import { detectThemes, type DetectedThemeResult } from './themeDetector';
import type { CurveSlot } from './deckAnalyzer';

/** Commander themes evaluated by default. The classifier promotes off-list themes on top. */
export const DEFAULT_CANDIDATE_LIMIT = 8;

export interface DetectDeckThemesOptions {
  cards: ScryfallCard[];
  commanderName: string;
  /** The commander's own EDHREC themes, in EDHREC's order (its page taglinks). */
  commanderThemes: EDHRECTheme[];
  /**
   * Fetches one theme's card pool. Injected rather than done here so each caller keeps its own
   * caching: the Inspector hands in a memoized fetcher that also warms its theme-data ref.
   * `archetypeOnly` is set for themes the commander has no page for — asking anyway is a guaranteed
   * 403.
   */
  fetchThemeData: (
    slug: string,
    opts?: { archetypeOnly?: boolean },
  ) => Promise<EDHRECCommanderData>;
  /** Curve slots for pacing detection. Pass [] when the caller has no analysis yet. */
  curveAnalysis?: CurveSlot[];
  /** How many of `commanderThemes` to evaluate. */
  candidateLimit?: number;
  /** Label for console warnings. */
  logLabel?: string;
}

export interface DetectDeckThemesResult {
  detection: DetectedThemeResult | null;
  /** Phase A scores by slug — undefined when the local classifier was unavailable. */
  membershipScores?: Map<string, ThemeScore>;
  /** Pages actually resolved, keyed by slug. Empty when every fetch failed. */
  themeDataMap: Map<string, EDHRECCommanderData>;
  /** Off-list themes the classifier promoted into the shortlist. */
  extraThemes: EDHRECTheme[];
}

/**
 * Detect a deck's themes: local classifier pass, off-list promotion, page fetches, then the
 * composite detector.
 *
 * One implementation on purpose. This ran in two places with different arguments — the Inspector
 * passed membershipScores and the deck view's picker did not, which silently selected a different
 * scoring path. scoreThemeMatch renormalizes when membership is absent, so overlap went from 40% of
 * the composite to 62% (0.40 of 0.65) and, with theme pages overlapping most decks almost entirely,
 * both surfaces reported different numbers for the same deck — the picker pinning several themes at
 * 100. The picker also evaluated five commander taglinks with no promotion, so it could not name a
 * theme outside the commander's top five at all, which is the whole case the classifier exists for.
 */
export async function detectDeckThemes(
  opts: DetectDeckThemesOptions,
): Promise<DetectDeckThemesResult> {
  const {
    cards, commanderName, commanderThemes, fetchThemeData,
    curveAnalysis = [], candidateLimit = DEFAULT_CANDIDATE_LIMIT,
    logLabel = 'ThemeDetection',
  } = opts;

  const topThemes = commanderThemes.slice(0, candidateLimit);
  const empty: DetectDeckThemesResult = {
    detection: null, themeDataMap: new Map(), extraThemes: [],
  };
  if (topThemes.length === 0) return empty;

  // ── Phase A: derived membership, entirely local ──
  // Scores the WHOLE ~400-tag EDHREC taxonomy against the deck without a single page fetch, because
  // the membership test reads the cards themselves. That's what lets a theme outside the commander's
  // own list be found at all — and it decides which pages are worth fetching below, instead of the
  // fetch list being fixed in advance.
  //
  // Entirely best-effort: any failure leaves membershipScores undefined and detection falls back to
  // the two EDHREC signals. See /theme-lab (dev) to inspect these numbers.
  let membershipScores: Map<string, ThemeScore> | undefined;
  let extraThemes: EDHRECTheme[] = [];
  try {
    const [allTags, catalogs] = await Promise.all([
      fetchAllTags(), getMtgCatalogs(), loadTagIndex(),
    ]);
    if (allTags.length > 0 && catalogs.creatureTypes.size > 0) {
      const table = loadThemeCharTags();
      const live = new Set(table.forceArchetype ?? []);
      const models = allTags.map(t => buildThemeModel(t, catalogs, table.themes, live));
      const commanderSlugs = new Set(commanderThemes.map(t => t.slug));
      const scored = scoreThemesForDeck(
        cards, models,
        c => (c.oracle_id ? tagsForOracleId(c.oracle_id) : []),
        commanderSlugs, undefined,
        // Format staples are neutral evidence for archetypes. Without this a goodstuff pile
        // reported Tron at 61% confidence off nothing but mana rocks.
        new Set(table.staples ?? []),
        // The commander carries extra weight: the deck is built around it. Matched by name because
        // `cards` is the deck list and the commander is one of its entries.
        cards.find(c => c.name === commanderName) ?? null,
      );
      membershipScores = new Map(scored.map(s => [s.model.slug, s]));

      // Off-list themes strong enough to deserve a page fetch. SHORTLIST_SIZE is the budget for
      // Phase A promotions specifically (see its docstring), NOT a combined cap with the commander's
      // own themes — that reading made this dead code and a deck whose real archetype isn't on its
      // commander's page could never be detected.
      const known = new Set(topThemes.map(t => t.slug));
      extraThemes = survivingThemes(scored)
        .filter(s => !known.has(s.model.slug))
        .slice(0, SHORTLIST_SIZE)
        .map(s => ({ name: s.model.name, slug: s.model.slug, count: s.model.numDecks, url: '' }));
    }
  } catch (err) {
    console.warn(`[${logLabel}] membership scoring unavailable — EDHREC signals only:`, err);
  }

  // Fetch each theme's pool (sequential — the EDHREC client rate-limits).
  //
  // archetypeOnly is decided against the commander's FULL theme list, not topThemes: a theme can be
  // on the commander's page yet outside the evaluated slice (Self-Damage on Sapling of Colfenor is),
  // and those do have a commander+theme page worth preferring over the archetype-wide one. Only
  // genuinely off-list themes skip straight to the archetype pool.
  const commanderOwnSlugs = new Set(commanderThemes.map(t => t.slug));
  const themeDataMap = new Map<string, EDHRECCommanderData>();
  const shortlist = [...topThemes, ...extraThemes];
  for (const theme of shortlist) {
    try {
      themeDataMap.set(theme.slug, await fetchThemeData(theme.slug, {
        archetypeOnly: !commanderOwnSlugs.has(theme.slug),
      }));
    } catch (err) {
      console.warn(`[${logLabel}] Failed to fetch theme data for ${theme.slug}:`, err);
    }
  }
  if (themeDataMap.size === 0) return { ...empty, membershipScores, extraThemes };

  const detection = detectThemes(
    shortlist, themeDataMap, cards, curveAnalysis, commanderName, membershipScores,
  );
  return { detection, membershipScores, themeDataMap, extraThemes };
}
