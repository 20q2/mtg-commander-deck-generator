import {
  fetchCommanderData,
  fetchPartnerCommanderData,
  fetchCommanderThemeData,
  fetchPartnerThemeData,
  edhrecColorSegment,
  fetchCardLiftPool,
  fetchSimilarCards,
} from '@/services/edhrec/client';
import { searchCards, getCardsByNames, isAnyLand } from '@/services/scryfall/client';
import { isFormatStaple } from '@/lib/constants/staples';
import { loadTaggerData } from '@/services/tagger/client';
import { findUpgradePair, type PairReceipt } from './upgradePairing';
import type { EDHRECTheme, ScryfallCard } from '@/types';
import {
  deckLiftEdges,
  liftEdgeScore,
  rankUpgradeCandidates,
  themeCredit,
  type RankedCard,
  type UpgradeCandidate,
} from './deckUpgrades';
import {
  buildThemeFit,
  matchedThemeNames,
  resolveThemeRefsByName,
  themeMatchFor,
  EMPTY_THEME_FIT,
} from '@/services/deckBuilder/themeFit';

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
/** Widened newness (old decks): synergy pre-rank size before the released_at filter. */
const WIDEN_PRERANK = 100;
/** Widened newness: extra lift-pool lookups budgeted for since-baseline cards. */
const MAX_WIDENED_LOOKUPS = 12;

export interface RelevantCardsArgs {
  commanderName: string;
  partnerName?: string;
  /** Every card name in the deck, commander(s) included — lift-fit evidence + exclusion. */
  deckCardNames: string[];
  /** Intended theme names (persisted at save time, or recovered from the generation summary). */
  themes?: string[];
  /**
   * The same themes as `{slug, name}` when the caller already has them resolved — the Inspector's
   * live selection, which can differ from what the list was saved with. Preferred over `themes`
   * for the classifier because it needs no name lookup and it carries off-list themes, which a
   * name match against the commander's own theme list would silently drop.
   */
  themeRefs?: { slug: string; name: string }[];
  /** Deck color identity — enables the Scryfall recent-set backfill when present. */
  colorIdentity?: string[];
  /** Color picked for a "choose a color before the game begins" commander (Clara Oswald &c),
   *  which selects EDHREC's per-identity page instead of the variant-aggregating base page. */
  chosenColor?: string | null;
  /** "Since when" (ms epoch). When older than the recent-set window, newness widens from
   *  EDHREC's rolling isNewCard flag to `released_at > baseline` over the full page lists —
   *  a ten-year-old deck gets its decade of tech, not just the last two sets. */
  baselineDate?: number;
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
  const details = await getUpgradeDetails(args);
  return details.map(c => ({ name: c.name, inclusion: c.inclusion, synergy: c.synergy, isNew: true }));
}

/** Where a candidate was discovered. */
export type UpgradeSource = 'commander' | 'theme' | 'recent-set' | 'since-baseline';

/** A fully-explained upgrade candidate — the "New Cards" inspector tab's row data. */
export interface UpgradeDetail extends UpgradeCandidate {
  sources: UpgradeSource[];
  /**
   * Intended theme names this card belongs to — the union of two independent sources: EDHREC's
   * theme page flagged it as new, and/or the classifier matched the card itself.
   * `classifierThemes` says which of these came from the card's own text.
   */
  matchedThemes: string[];
  /** Subset of `matchedThemes` established from the card itself rather than from a page listing. */
  classifierThemes: string[];
  /** Summed lift evidence against this deck (0 = no data). */
  liftFit: number;
  /** Strongest deck cards backing the recommendation, best first. */
  topEdges: { deckCard: string; lift: number; coPct: number; numDecks: number }[];
  /** Conservative "possible upgrade of your X" pairing, when one clears every gate. */
  pairedWith?: PairReceipt;
  /** ISO release date of the candidate's cached printing (era chip in the tab). */
  releasedAt?: string;
}

const MAX_TOP_EDGES = 4;

type DetailDraft = UpgradeCandidate & { sources: UpgradeSource[]; matchedThemes: string[] };

/**
 * The full ranked pipeline with its reasoning attached (sources, matched themes,
 * lift edges). getRelevantCards is a thin wrapper over this; the "New Cards"
 * inspector tab consumes it directly. Same caching + failure behavior.
 */
export async function getUpgradeDetails(args: RelevantCardsArgs): Promise<UpgradeDetail[]> {
  const { commanderName, partnerName, deckCardNames, themes, colorIdentity, chosenColor, baselineDate } = args;
  // cachedColorIdentity is the union of the deck's card colors, so a chosen color with no
  // cards yet would be missing from it — add it back before resolving EDHREC's color page.
  // It's also populated asynchronously after a first save; without it the union would be the
  // chosen color alone and would resolve to the wrong mono page, so fall back to the aggregate.
  const colorSeg = colorIdentity?.length
    ? edhrecColorSegment([...colorIdentity, ...(chosenColor ? [chosenColor] : [])], chosenColor)
    : '';
  try {
    const deckSet = new Set(deckCardNames);
    // Deck card types (cached from the deck view) — used only to strip lands from
    // the lift-evidence set below. Kicked off in parallel; failures fall back to
    // "no lands identified" (names-only), which is safe — worst case a land or two
    // slips back into the evidence set.
    const deckTypesPromise = getCardsByNames(deckCardNames).catch(() => new Map());
    // Tagger tags back the upgrade-pairing "shared role" gate; failures degrade to
    // theme-lift-only pairing (hasTag returns false when data is absent).
    const taggerPromise = loadTaggerData().catch(() => null);
    const data = partnerName
      ? await fetchPartnerCommanderData(commanderName, partnerName, undefined, undefined, colorSeg)
      : await fetchCommanderData(commanderName, undefined, undefined, colorSeg);

    // Scryfall recent-set backfill kicks off in parallel with the theme fetches below.
    const backfillPromise = colorIdentity && colorIdentity.length > 0
      ? fetchRecentSetCandidates(colorIdentity, deckSet)
      : Promise.resolve([] as UpgradeCandidate[]);

    // 1. Commander-page new cards. The same pass collects commander-page stats for
    // cards already IN the deck — the upgrade pairing's incumbent side.
    const byName = new Map<string, DetailDraft>();
    const incumbentStats = new Map<string, { synergy?: number; inclusion: number }>();
    for (const c of data.cardlists.allNonLand) {
      if (deckSet.has(c.name)) incumbentStats.set(c.name, { synergy: c.synergy, inclusion: c.inclusion });
      if (!c.isNewCard) continue;
      byName.set(c.name, {
        name: c.name,
        inclusion: c.inclusion,
        synergy: c.synergy,
        fromTheme: c.isThemeSynergyCard,
        sources: ['commander'],
        matchedThemes: [],
      });
    }

    // 2. Intended-theme pages' new cards (merged, deduped; failures skipped).
    const slugs = resolveThemeSlugs(themes, data.themes);
    const themeDatas = await Promise.all(slugs.map(async slug => {
      const themeName = data.themes.find(t => t.slug === slug)?.name ?? slug;
      const themeData = await (partnerName
        ? fetchPartnerThemeData(commanderName, partnerName, slug, undefined, undefined, colorSeg)
        : fetchCommanderThemeData(commanderName, slug, undefined, undefined, colorSeg)
      ).catch(() => null);
      return { themeName, themeData };
    }));
    // Full theme membership (every card the page lists, not just new ones) — feeds the
    // pairing's "same plan" gate for both candidates and incumbents.
    const themeMembership = new Map<string, string[]>();
    for (const { themeName, themeData } of themeDatas) {
      if (!themeData) continue;
      for (const c of themeData.cardlists.allNonLand) {
        const membered = themeMembership.get(c.name);
        if (membered) { if (!membered.includes(themeName)) membered.push(themeName); }
        else themeMembership.set(c.name, [themeName]);
        if (!c.isNewCard) continue;
        const prev = byName.get(c.name);
        if (prev) {
          prev.fromTheme = true;
          prev.synergy = Math.max(prev.synergy ?? 0, c.synergy ?? 0);
          if (!prev.sources.includes('theme')) prev.sources.push('theme');
          prev.matchedThemes.push(themeName);
        } else {
          byName.set(c.name, {
            name: c.name,
            inclusion: c.inclusion,
            synergy: c.synergy,
            fromTheme: true,
            sources: ['theme'],
            matchedThemes: [themeName],
          });
        }
      }
    }

    // 2.5. Classifier fit over the new-card pool.
    //
    // Resolved BEFORE the lookup cap below, deliberately: theme evidence has to be able to decide
    // WHICH candidates earn a lift lookup, not merely how the survivors get ordered. A new card
    // whose rules text carries the deck's theme but whose commander-page synergy is near zero —
    // the normal state of affairs for a card printed last month — would otherwise be cut here and
    // never reach the ranker at all.
    const themeRefs = args.themeRefs?.length
      ? args.themeRefs
      : await resolveThemeRefsByName(themes ?? []);
    const poolNames = [...byName.keys()].filter(n => !deckSet.has(n));
    const poolCards = themeRefs.length > 0
      ? await getCardsByNames(poolNames).catch(() => new Map<string, ScryfallCard>())
      : new Map<string, ScryfallCard>();
    const poolFit = themeRefs.length > 0
      ? await buildThemeFit([...poolCards.values()], themeRefs)
      : EMPTY_THEME_FIT;

    /** The classifier's verdict on one candidate, as the ranker's optional field. */
    const basisFor = (name: string): 'literal' | 'tag' | undefined =>
      themeMatchFor(poolFit, name)?.basis;

    // 3. Drop cards already in the deck BEFORE spending lift lookups, then cap the lookup budget
    // on a synergy+theme pre-rank so the likeliest fits get scored. Theme credit comes from the
    // shared themeCredit() the final ranking uses, so the two passes cannot drift apart.
    const prerankScore = (c: DetailDraft) => (c.synergy ?? 0) + themeCredit(c);
    const edhrecCandidates = [...byName.values()]
      .map(c => ({ ...c, themeBasis: basisFor(c.name) }))
      .filter(c => !deckSet.has(c.name))
      .sort((a, b) => prerankScore(b) - prerankScore(a))
      .slice(0, MAX_LIFT_LOOKUPS);

    // 3.5. Widened newness for old decks: when the baseline predates the recent-set
    // window, EDHREC's rolling isNewCard flag misses almost everything that matters —
    // a ten-year-old deck needs "printed since the baseline" over the FULL page lists.
    // Pre-rank by synergy so the one batch card fetch spends on the likeliest fits;
    // the reprint flag guards a late printing of an old card from reading as new.
    let widened: DetailDraft[] = [];
    // Hoisted so the final classifier fit below can cover these cards too.
    let eraCards = new Map<string, ScryfallCard>();
    if (baselineDate && Date.now() - baselineDate > BACKFILL_WINDOW_DAYS * 86400000) {
      const baselineISO = new Date(baselineDate).toISOString().slice(0, 10);
      const eraPool = new Map<string, DetailDraft>();
      const consider = (c: { name: string; inclusion: number; synergy?: number; isNewCard?: boolean }, themeName?: string) => {
        if (c.isNewCard || deckSet.has(c.name) || byName.has(c.name)) return;
        const prev = eraPool.get(c.name);
        if (prev) {
          prev.synergy = Math.max(prev.synergy ?? 0, c.synergy ?? 0);
          if (themeName) {
            prev.fromTheme = true;
            if (!prev.matchedThemes.includes(themeName)) prev.matchedThemes.push(themeName);
          }
        } else {
          eraPool.set(c.name, {
            name: c.name, inclusion: c.inclusion, synergy: c.synergy, fromTheme: !!themeName,
            sources: ['since-baseline'], matchedThemes: themeName ? [themeName] : [],
          });
        }
      };
      for (const c of data.cardlists.allNonLand) consider(c);
      for (const { themeName, themeData } of themeDatas) {
        if (!themeData) continue;
        for (const c of themeData.cardlists.allNonLand) consider(c, themeName);
      }
      const preranked = [...eraPool.values()]
        .sort((a, b) => prerankScore(b) - prerankScore(a))
        .slice(0, WIDEN_PRERANK);
      eraCards = await getCardsByNames(preranked.map(c => c.name))
        .catch(() => new Map<string, ScryfallCard>());
      const eraFit = themeRefs.length > 0
        ? await buildThemeFit([...eraCards.values()], themeRefs)
        : EMPTY_THEME_FIT;
      widened = preranked.filter(c => {
        const card = eraCards.get(c.name);
        return !!card?.released_at && card.released_at > baselineISO && card.reprint !== true;
      })
        // Classifier evidence is only available now — the era cards had to be fetched to check
        // their print dates anyway, so re-ranking here is free and decides which 12 survive.
        .map(c => ({ ...c, themeBasis: themeMatchFor(eraFit, c.name)?.basis }))
        .sort((a, b) => prerankScore(b) - prerankScore(a))
        .slice(0, MAX_WIDENED_LOOKUPS);
    }
    const widenedNames = new Set(widened.map(c => c.name));

    // 4. Merge the backfill (deduped against EDHREC's picks and the widened pool) and
    // remember which candidates carry no EDHREC signal — they must prove themselves via lift.
    const backfill: DetailDraft[] = (await backfillPromise)
      .filter(c => !byName.has(c.name) && !widenedNames.has(c.name))
      .map(c => ({ ...c, sources: ['recent-set' as const], matchedThemes: [] }));
    const backfillNames = new Set(backfill.map(c => c.name));
    const candidates = [...edhrecCandidates, ...widened, ...backfill];

    // 5. Deck-fit lift evidence per candidate.
    // Two kinds of card are mana-base/universal noise as lift evidence rather than
    // deck-specific fit, so they're excluded from the evidence set (but kept in
    // deckSet, so they're still deduped out of the recommendations themselves):
    //   - Format staples (Sol Ring, Arcane Signet, …) — sit in nearly every deck.
    //   - Lands — co-occur with nearly everything in the color identity, so they
    //     dominated the "plays with" evidence with pure mana-base overlap.
    const deckTypes = await deckTypesPromise;
    const liftDeckSet = new Set(
      [...deckSet].filter(n => {
        if (isFormatStaple(n)) return false;
        const card = deckTypes.get(n);
        return !(card && isAnyLand(card));
      }),
    );
    // Candidate card objects back the pairing (type class, price, release date) and the
    // era chip. One cached batch fetch — the tab re-requests the same names for art.
    const candidateCards = await getCardsByNames(candidates.map(c => c.name))
      .catch(() => new Map<string, ScryfallCard>());
    // The fit that backs the surfaced evidence, over every card that actually made the cut — the
    // pool, the widened era pass, and the Scryfall backfill (whose cards appear only here, and
    // which carry NO EDHREC signal at all, so the classifier is their only theme evidence).
    const candidateFit = themeRefs.length > 0
      ? await buildThemeFit(
        [...poolCards.values(), ...eraCards.values(), ...candidateCards.values()],
        themeRefs,
      )
      : EMPTY_THEME_FIT;
    // Commanders are excluded as pairing incumbents — "an upgrade of your commander"
    // is a different deck, not an upgrade.
    const deckCardObjs = [...new Set(deckCardNames)]
      .filter(n => n !== commanderName && n !== partnerName)
      .map(n => deckTypes.get(n))
      .filter((c): c is ScryfallCard => !!c);
    await taggerPromise;

    const scored = await Promise.all(candidates.map(async draft => {
      // Same EDHREC card page backs both — the similar list rides the pool's cache.
      const [pool, similar] = await Promise.all([
        fetchCardLiftPool(draft.name),
        fetchSimilarCards(draft.name),
      ]);
      const edges = deckLiftEdges(pool, liftDeckSet);
      const card = candidateCards.get(draft.name);
      const classifierThemes = matchedThemeNames(candidateFit, draft.name);
      const candidate: UpgradeDetail = {
        ...draft,
        themeBasis: themeMatchFor(candidateFit, draft.name)?.basis,
        classifierThemes,
        // Union of the two evidence sources. This is what the tab's chips render and what its
        // "Slots into your build" partition tests, so a card the classifier matched now lands
        // there even when no EDHREC theme page has caught up to it yet.
        matchedThemes: [...new Set([...draft.matchedThemes, ...classifierThemes])],
        liftFit: edges.reduce((s, e) => s + liftEdgeScore(e), 0),
        topEdges: edges.slice(0, MAX_TOP_EDGES).map(e => ({
          deckCard: e.name, lift: e.lift, coPct: e.coPct, numDecks: e.numDecks,
        })),
        pairedWith: findUpgradePair({
          candidate: {
            name: draft.name, card, synergy: draft.synergy, inclusion: draft.inclusion,
            themes: draft.matchedThemes.length > 0 ? draft.matchedThemes : (themeMembership.get(draft.name) ?? []),
          },
          candidatePool: pool,
          similarNames: new Set(similar),
          deckCards: deckCardObjs,
          incumbentStats,
          themeMembership,
        }) ?? undefined,
        releasedAt: card?.released_at,
      };
      return { candidate, liftFit: candidate.liftFit };
    }));

    // Backfill cards with zero lift evidence have zero signal of any kind — cut them.
    const kept = scored.filter(s => !backfillNames.has(s.candidate.name) || s.liftFit > 0);

    // One pair per incumbent: several candidates can independently claim the same deck
    // card ("3 upgrades for Reyhan") — only the best-ranked candidate keeps the claim.
    const ranked = rankUpgradeCandidates(kept).slice(0, MAX_RECOMMENDATIONS);
    const claimedIncumbents = new Set<string>();
    for (const c of ranked) {
      if (!c.pairedWith) continue;
      if (claimedIncumbents.has(c.pairedWith.deckCard)) c.pairedWith = undefined;
      else claimedIncumbents.add(c.pairedWith.deckCard);
    }
    return ranked;
  } catch {
    return [];
  }
}
