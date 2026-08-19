import type { ScryfallCard, EDHRECTag } from '@/types';
import type { MtgCatalogs } from '@/services/scryfall/client';
import { classifyTheme, themeKindMatches, type ThemeKind } from './themeKind';
import type { ThemeTableEntry } from './charTags';

/**
 * A theme resolved to everything needed to test a card against it. Built once per theme per session;
 * the test itself is then pure and cheap enough to run over ~400 themes × ~99 cards on every
 * keystroke in the debug page.
 */
export interface ThemeModel {
  slug: string;
  name: string;
  kind: ThemeKind;
  /** Characteristic oracle tags. Empty for deterministic kinds — they have a literal test instead. */
  charTags: string[];
  /** Share of all cards belonging to this theme; 0 when the table hasn't been generated. */
  baseRate: number;
  /** How many EDHREC decks carry this tag; used as a sanity signal against long-tail noise. */
  numDecks: number;
}

/** Why a card counted (or didn't), so every consumer can explain itself. */
export interface MembershipResult {
  member: boolean;
  basis: 'literal' | 'tag' | 'none';
  /** The concrete thing that matched: `["Elf"]`, or `["sacrifice-outlet", "death-trigger"]`. */
  matched: string[];
}

const NOT_A_MEMBER: MembershipResult = { member: false, basis: 'none', matched: [] };

/**
 * Resolve one EDHREC tag into a testable model. `catalogs` come from Scryfall's own vocabularies, so
 * no taxonomy is hand-maintained here; `charTagTable` is the committed archetype table.
 */
export function buildThemeModel(
  tag: EDHRECTag,
  catalogs: MtgCatalogs,
  table: Record<string, ThemeTableEntry>,
): ThemeModel {
  const kind = classifyTheme(
    tag.name, catalogs.mechanics, catalogs.creatureTypes, catalogs.permanentSubtypes,
  );
  const entry = table[tag.slug];
  return {
    slug: tag.slug,
    name: tag.name,
    kind,
    // Only archetypes consult the tag list: a deterministic kind that ALSO had tags would
    // double-count itself, and its literal test is strictly more precise anyway.
    charTags: kind.kind === 'archetype' ? (entry?.charTags ?? []) : [],
    baseRate: entry?.baseRate ?? 0,
    numDecks: tag.numDecks,
  };
}

/**
 * Does this card belong to this theme, and on what evidence?
 *
 * Deterministic kinds test the card itself (type line, keywords, oracle text) and so work for every
 * card ever printed, including ones EDHREC has never listed. Archetypes fall back to the statistical
 * tag signal. Role kinds ("Ramp", "Card Draw") are never members of anything: they name a job rather
 * than a strategy, and their EDHREC pages list what such decks PLAY rather than the role itself.
 *
 * @param cardTags oracle tag slugs for this card, from SpellChroma's index. Empty when the index
 *                 failed to load — archetype themes then simply find no members, which is the
 *                 documented soft-failure mode.
 */
export function testMembership(
  model: ThemeModel, card: ScryfallCard, cardTags: readonly string[],
): MembershipResult {
  if (model.kind.kind === 'role') return NOT_A_MEMBER;

  if (model.kind.kind !== 'archetype') {
    if (!themeKindMatches(model.kind, card)) return NOT_A_MEMBER;
    return { member: true, basis: 'literal', matched: [model.kind.match] };
  }

  if (model.charTags.length === 0 || cardTags.length === 0) return NOT_A_MEMBER;
  const matched = model.charTags.filter(t => cardTags.includes(t));
  if (matched.length === 0) return NOT_A_MEMBER;
  return { member: true, basis: 'tag', matched };
}
