// src/services/deckBuilder/bracketBlend.ts
import type { EDHRECCard, EDHRECCommanderData, IntendedBracket } from '@/types';
import { pageConfidence } from './archetypeBlend';
import { computeEdhrecRoleTargets } from './roleTargets';

/**
 * Pseudo-decks of prior mass when weighting a commander's bracket page against its all-brackets
 * page: the bracket page counts for n / (n + 50) of each card's figures. For The Mycotyrant that is
 * 0.94 at bracket 3 (764 decks), 0.69 at bracket 4 (111) and 0.15 at bracket 5 (9) — a handful of
 * decks nudges the all-brackets numbers rather than replacing them.
 */
export const BRACKET_PRIOR_DECKS = 50;
/** Below this many decks a bracket page isn't worth a request. */
export const MIN_BRACKET_DECKS = 5;

/** Decks on the commander's page that declared `bracket` — each bracket page is built from exactly these. */
export function declaredBracketDecks(allBrackets: EDHRECCommanderData, bracket: number): number {
  return allBrackets.stats.bracketCounts?.[String(bracket)] ?? 0;
}

/** Weight on the bracket page's figures; 0 means don't fetch it. */
export function bracketPageWeight(bracketDecks: number): number {
  return bracketDecks < MIN_BRACKET_DECKS ? 0 : pageConfidence(bracketDecks, BRACKET_PRIOR_DECKS);
}

/** The bracket a deck is judged at, and where that number came from. */
export interface BracketBasis {
  bracket: IntendedBracket;
  source: 'set' | 'generated' | 'estimated';
}

export interface BracketBlend {
  bracket: IntendedBracket;
  /** Decks behind the bracket page. */
  bracketDecks: number;
  /** Share of each card's figures taken from the bracket page. */
  weight: number;
  /** The all-brackets payload with every cardlist blended. Stats, themes and similar commanders are
   *  the all-brackets page's, so curve, type and role targets don't move with the bracket. */
  data: EDHRECCommanderData;
  /** Blended inclusion / synergy keyed by card name (and DFC front face), for the deck's own cards. */
  inclusionMap: Record<string, number>;
  synergyMap: Record<string, number>;
  /** Non-land cards the bracket's decks play far more than the commander's decks overall, biggest
   *  rise first — what a deck aiming at this bracket is most likely missing. Raw page figures. */
  rising: RisingCard[];
  /** Per role: how much more (or less) of it the bracket's decks run than the commander's decks
   *  overall, as a multiplier for role targets. A bracket 4 deck holds more tutors and fast
   *  interaction than the average deck, which is mostly bracket 2; judging it on the average reads
   *  its strongest cards as surplus. */
  roleScale: Record<string, number>;
}

/** Bounds on roleScale — a role's target moves by at most half again, or a third down. */
const ROLE_SCALE_MIN = 0.67;
const ROLE_SCALE_MAX = 1.5;
/** A role averaging under this many slots overall is too small to scale meaningfully. */
const ROLE_SCALE_MIN_SLOTS = 0.5;

/** Inclusion % by card name (and DFC front face) across every list on a page. */
export function indexInclusion(data: EDHRECCommanderData): Record<string, number> {
  const out: Record<string, number> = {};
  for (const list of Object.values(data.cardlists)) {
    for (const c of list ?? []) {
      out[c.name] = c.inclusion;
      if (c.name.includes(' // ')) out[c.name.split(' // ')[0]] = c.inclusion;
    }
  }
  return out;
}

export interface RisingCard {
  name: string;
  /** % of this bracket's decks. */
  bracketInclusion: number;
  /** % of the commander's decks across all brackets. */
  allInclusion: number;
}

/** A rise smaller than this is noise between two samples of the same population. */
const RISING_MIN_POINTS = 15;
const RISING_MAX = 40;

type Cardlists = EDHRECCommanderData['cardlists'];

/**
 * Blend a commander's bracket page into its all-brackets page, card by card:
 * `blended = w·bracket + (1 − w)·all`, with w = bracketPageWeight(deck count). A card missing from
 * one page counts as 0% there — both pages list hundreds of cards, so absence means rarely played,
 * and thin pages are already held down by w. The result is the union of both pages, so cards only
 * the bracket's decks play become candidates too.
 */
export function blendBracketData(
  allBrackets: EDHRECCommanderData,
  bracketPage: EDHRECCommanderData,
  bracket: IntendedBracket,
): BracketBlend {
  const bracketDecks = bracketPage.stats.numDecks || declaredBracketDecks(allBrackets, bracket);
  const w = bracketPageWeight(bracketDecks);

  const index = (data: EDHRECCommanderData) => {
    const byName = new Map<string, EDHRECCard>();
    for (const list of Object.values(data.cardlists)) for (const c of list ?? []) byName.set(c.name, c);
    return byName;
  };
  const allByName = index(allBrackets);
  const pageByName = index(bracketPage);

  // One blended object per name, shared by its type list and allNonLand.
  const blended = new Map<string, EDHRECCard>();
  const blendCard = (name: string): EDHRECCard => {
    const hit = blended.get(name);
    if (hit) return hit;
    const a = allByName.get(name);
    const b = pageByName.get(name);
    const synergy = a?.synergy != null || b?.synergy != null
      ? w * (b?.synergy ?? 0) + (1 - w) * (a?.synergy ?? 0)
      : undefined;
    const card: EDHRECCard = {
      ...(b ?? {}),
      ...(a ?? {}),
      name,
      inclusion: w * (b?.inclusion ?? 0) + (1 - w) * (a?.inclusion ?? 0),
      synergy,
      isThemeSynergyCard: a?.isThemeSynergyCard || b?.isThemeSynergyCard || undefined,
      isGameChanger: a?.isGameChanger || b?.isGameChanger || undefined,
      isNewCard: a?.isNewCard || b?.isNewCard || undefined,
    } as EDHRECCard;
    blended.set(name, card);
    return card;
  };
  const blendList = (all: EDHRECCard[], page: EDHRECCard[]): EDHRECCard[] => {
    const names = new Set([...all.map(c => c.name), ...page.map(c => c.name)]);
    return [...names].map(blendCard).sort((x, y) => y.inclusion - x.inclusion);
  };

  const cardlists = {} as Cardlists;
  for (const key of Object.keys(allBrackets.cardlists) as (keyof Cardlists)[]) {
    cardlists[key] = blendList(allBrackets.cardlists[key] ?? [], bracketPage.cardlists[key] ?? []);
  }

  const data: EDHRECCommanderData = { ...allBrackets, cardlists };
  const inclusionMap = indexInclusion(data);
  const synergyMap: Record<string, number> = {};
  for (const c of blended.values()) {
    if (c.synergy == null) continue;
    synergyMap[c.name] = c.synergy;
    if (c.name.includes(' // ')) synergyMap[c.name.split(' // ')[0]] = c.synergy;
  }

  // Role averages are inclusion summed per role (computeEdhrecRoleTargets), so the blended pool's
  // sums against the all-brackets pool's give the bracket's lean — already shrunk by w.
  const allRoles = computeEdhrecRoleTargets(allBrackets);
  const blendRoles = computeEdhrecRoleTargets(data);
  const roleScale: Record<string, number> = {};
  for (const role of Object.keys(allRoles) as (keyof typeof allRoles)[]) {
    roleScale[role] = allRoles[role] < ROLE_SCALE_MIN_SLOTS
      ? 1
      : Math.min(ROLE_SCALE_MAX, Math.max(ROLE_SCALE_MIN, blendRoles[role] / allRoles[role]));
  }

  const rising: RisingCard[] = (bracketPage.cardlists.allNonLand ?? [])
    .map(b => ({ name: b.name, bracketInclusion: b.inclusion, allInclusion: allByName.get(b.name)?.inclusion ?? 0 }))
    .filter(r => r.bracketInclusion - r.allInclusion >= RISING_MIN_POINTS)
    .sort((x, y) => (y.bracketInclusion - y.allInclusion) - (x.bracketInclusion - x.allInclusion))
    .slice(0, RISING_MAX);

  return {
    bracket,
    bracketDecks,
    weight: w,
    data,
    inclusionMap,
    synergyMap,
    rising,
    roleScale,
  };
}
