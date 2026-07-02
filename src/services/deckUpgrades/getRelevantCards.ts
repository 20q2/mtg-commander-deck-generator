import {
  fetchCommanderData,
  fetchPartnerCommanderData,
  fetchCommanderThemeData,
  fetchPartnerThemeData,
  fetchCardLiftPool,
} from '@/services/edhrec/client';
import { searchCards } from '@/services/scryfall/client';
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
/** Scryfall backfill: how far back a printing counts as "recent". */
const BACKFILL_WINDOW_DAYS = 120;
/** Scryfall backfill: extra lift-pool lookups budgeted for recent-set cards. */
const MAX_BACKFILL_LOOKUPS = 8;

export interface RelevantCardsArgs {
  commanderName: string;
  partnerName?: string;
  /** Every card name in the deck, commander(s) included — lift-fit evidence + exclusion. */
  deckCardNames: string[];
  /** Intended theme names (persisted at save time, or recovered from the generation summary). */
  themes?: string[];
  /** Deck color identity — enables the Scryfall recent-set backfill when present. */
  colorIdentity?: string[];
}

/**
 * Backfill: recent-set commander-legal cards in the deck's identity that EDHREC
 * hasn't flagged as new for this commander (fell off the list, or too niche to
 * crack it). These arrive with NO synergy/inclusion signal, so downstream they
 * must earn a nonzero lift fit against the deck to be kept at all — lift is the
 * relevance filter here. Most-played first (order: edhrec). [] on any failure.
 */
async function fetchRecentSetCandidates(
  colorIdentity: string[],
  exclude: Set<string>,
): Promise<UpgradeCandidate[]> {
  const cutoff = new Date(Date.now() - BACKFILL_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  try {
    const res = await searchCards(`date>=${cutoff} -is:reprint -t:land`, colorIdentity, { order: 'edhrec' });
    return res.data
      .filter(c => !exclude.has(c.name))
      .slice(0, MAX_BACKFILL_LOOKUPS)
      .map(c => ({ name: c.name, inclusion: 0 }));
  } catch {
    return [];
  }
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
  const { commanderName, partnerName, deckCardNames, themes, colorIdentity } = args;
  try {
    const deckSet = new Set(deckCardNames);
    const data = partnerName
      ? await fetchPartnerCommanderData(commanderName, partnerName)
      : await fetchCommanderData(commanderName);

    // Scryfall recent-set backfill kicks off in parallel with the theme fetches below.
    const backfillPromise = colorIdentity && colorIdentity.length > 0
      ? fetchRecentSetCandidates(colorIdentity, deckSet)
      : Promise.resolve([] as UpgradeCandidate[]);

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
    const edhrecCandidates = [...byName.values()]
      .filter(c => !deckSet.has(c.name))
      .sort((a, b) =>
        ((b.synergy ?? 0) + (b.fromTheme ? 0.5 : 0)) - ((a.synergy ?? 0) + (a.fromTheme ? 0.5 : 0)))
      .slice(0, MAX_LIFT_LOOKUPS);

    // 4. Merge the backfill (deduped against EDHREC's picks) and remember which
    // candidates carry no EDHREC signal — they must prove themselves via lift.
    const backfill = (await backfillPromise).filter(c => !byName.has(c.name));
    const backfillNames = new Set(backfill.map(c => c.name));
    const candidates = [...edhrecCandidates, ...backfill];

    // 5. Deck-fit lift evidence per candidate.
    const scored = await Promise.all(candidates.map(async candidate => ({
      candidate,
      liftFit: liftFitScore(await fetchCardLiftPool(candidate.name), deckSet),
    })));

    // Backfill cards with zero lift evidence have zero signal of any kind — cut them.
    const kept = scored.filter(s => !backfillNames.has(s.candidate.name) || s.liftFit > 0);

    return rankUpgradeCandidates(kept)
      .slice(0, MAX_RECOMMENDATIONS)
      .map(c => ({ name: c.name, inclusion: c.inclusion, synergy: c.synergy, isNew: true }));
  } catch {
    return [];
  }
}
