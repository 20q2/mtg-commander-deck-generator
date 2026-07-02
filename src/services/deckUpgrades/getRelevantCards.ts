import {
  fetchCommanderData,
  fetchPartnerCommanderData,
  fetchCommanderThemeData,
  fetchPartnerThemeData,
  fetchCardLiftPool,
} from '@/services/edhrec/client';
import type { EDHRECTheme } from '@/types';
import {
  liftFitScore,
  rankUpgradeCandidates,
  type RankedCard,
  type UpgradeCandidate,
} from './deckUpgrades';

/** Cap on how many new cards to track per deck. */
const MAX_RECOMMENDATIONS = 40;
/** Cap on candidate lift-pool fetches per refresh (one EDHREC page each, 14-day cached). */
const MAX_LIFT_LOOKUPS = 20;
/** EDHREC theme pages to merge in (mirrors the builder's two-theme limit). */
const MAX_THEMES = 2;

export interface RelevantCardsArgs {
  commanderName: string;
  partnerName?: string;
  /** Every card name in the deck, commander(s) included — lift-fit evidence + exclusion. */
  deckCardNames: string[];
  /** Intended theme names (persisted at save time, or recovered from the generation summary). */
  themes?: string[];
}

/** Match the deck's intended theme names against the commander page's theme list. */
function resolveThemeSlugs(themes: string[] | undefined, available: EDHRECTheme[]): string[] {
  if (!themes || themes.length === 0) return [];
  const slugs: string[] = [];
  for (const wanted of themes) {
    const norm = wanted.trim().toLowerCase();
    const hit = available.find(t => t.name.toLowerCase() === norm || t.slug === norm);
    if (hit && !slugs.includes(hit.slug)) slugs.push(hit.slug);
  }
  return slugs.slice(0, MAX_THEMES);
}

/**
 * Producer: genuinely NEW cards for this deck, ranked by how well they fit it.
 *
 * Sources (newness only — never the generic top-synergy gap pool):
 * 1. The commander page's `isNewCard` pool.
 * 2. Each intended theme's page (`/commanders/<name>/<theme>.json`) — theme pages
 *    flag their own new cards, so a new tokens payoff surfaces for a tokens deck
 *    even when it doesn't crack the commander-wide list.
 *
 * Ranking blends three signals (see rankUpgradeCandidates): per-candidate lift fit
 * against the cards actually in THIS deck (one cached card-page fetch per candidate,
 * capped), EDHREC synergy, and intended-theme membership.
 *
 * All EDHREC fetches are 14-day cached (in-memory + IndexedDB), so re-opening an
 * already-viewed deck is effectively free.
 *
 * Returns [] on any failure (fire-and-forget, never throws to the caller).
 *
 * NOTE: newness is read from EDHREC's `isNewCard` flag. A brand-new card that also
 * appears in a typed list with higher inclusion can lose the flag during
 * EDHREC-side dedupe; acceptable for now.
 */
export async function getRelevantCards(args: RelevantCardsArgs): Promise<RankedCard[]> {
  const { commanderName, partnerName, deckCardNames, themes } = args;
  try {
    const data = partnerName
      ? await fetchPartnerCommanderData(commanderName, partnerName)
      : await fetchCommanderData(commanderName);

    // 1. Commander-page new cards.
    const byName = new Map<string, UpgradeCandidate>();
    for (const c of data.cardlists.allNonLand) {
      if (!c.isNewCard) continue;
      byName.set(c.name, {
        name: c.name,
        inclusion: c.inclusion,
        synergy: c.synergy,
        fromTheme: c.isThemeSynergyCard,
      });
    }

    // 2. Intended-theme pages' new cards (merged, deduped; failures skipped).
    const slugs = resolveThemeSlugs(themes, data.themes);
    const themeDatas = await Promise.all(slugs.map(slug =>
      (partnerName
        ? fetchPartnerThemeData(commanderName, partnerName, slug)
        : fetchCommanderThemeData(commanderName, slug)
      ).catch(() => null)
    ));
    for (const themeData of themeDatas) {
      if (!themeData) continue;
      for (const c of themeData.cardlists.allNonLand) {
        if (!c.isNewCard) continue;
        const prev = byName.get(c.name);
        if (prev) {
          prev.fromTheme = true;
          prev.synergy = Math.max(prev.synergy ?? 0, c.synergy ?? 0);
        } else {
          byName.set(c.name, { name: c.name, inclusion: c.inclusion, synergy: c.synergy, fromTheme: true });
        }
      }
    }

    // 3. Drop cards already in the deck BEFORE spending lift lookups, then cap the
    // lookup budget on a synergy+theme pre-rank so the likeliest fits get scored.
    const deckSet = new Set(deckCardNames);
    const candidates = [...byName.values()]
      .filter(c => !deckSet.has(c.name))
      .sort((a, b) =>
        ((b.synergy ?? 0) + (b.fromTheme ? 0.5 : 0)) - ((a.synergy ?? 0) + (a.fromTheme ? 0.5 : 0)))
      .slice(0, MAX_LIFT_LOOKUPS);

    // 4. Deck-fit lift evidence per candidate.
    const scored = await Promise.all(candidates.map(async candidate => ({
      candidate,
      liftFit: liftFitScore(await fetchCardLiftPool(candidate.name), deckSet),
    })));

    return rankUpgradeCandidates(scored)
      .slice(0, MAX_RECOMMENDATIONS)
      .map(c => ({ name: c.name, inclusion: c.inclusion, synergy: c.synergy, isNew: true }));
  } catch {
    return [];
  }
}
