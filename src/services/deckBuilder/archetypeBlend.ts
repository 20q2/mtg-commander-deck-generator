import type { EDHRECCard, EDHRECCommanderData } from '@/types';
import { colorIdentityToSlug, type TagPageData } from '@/services/edhrec/client';

// ─── Adaptive weight ─────────────────────────────────────────────────
// How much an archetype-only card's inclusion % counts when injected into the
// commander-theme pool. Same philosophy as the adaptive lift floor: mainstream
// commander-theme pairings barely move; thin ones get real backfill.

export const ARCHETYPE_WEIGHT_MIN = 0.35;    // commander-theme data healthy (≥ HEALTHY_DECKS)
export const ARCHETYPE_WEIGHT_MAX = 0.9;     // commander-theme data thin (≤ THIN_DECKS) or unknown
export const ARCHETYPE_THIN_DECKS = 50;
export const ARCHETYPE_HEALTHY_DECKS = 500;
/** Max archetype-only cards injected per category, per tag pool. */
export const ARCHETYPE_INJECT_CAP = 15;

/**
 * Pseudo-decks of prior mass used to smooth a page's own inclusion percentages.
 *
 * A percentage is only as good as its denominator. EDHREC's page for Sapling of Colfenor +
 * Self-Damage is built from TWO decks, so every card on it reads 50% or 100% — a card in both decks
 * is indistinguishable from a format staple. Those figures feed the cut ranking, the misfit floor,
 * the deck score and the role targets, all of which treat them as fact.
 *
 * Additive (Laplace) smoothing fixes it without a threshold to tune: read the percentage back into
 * a deck count, add k decks that don't play the card, and divide again. Every card on the page is
 * scaled by the same pageConfidence factor, so ranking WITHIN the page is untouched — only its
 * authority against other sources changes.
 *
 * At 12: a 2-deck page keeps 14% of face value, a 33-deck page 73%, a 476-deck page 98%, and the
 * base commander page is unaffected. Reads as "a page needs about a dozen decks before its
 * percentages are taken at face value", and it leaves a 2-deck 100% at 14% — clear of the 5% misfit
 * floor, nowhere near the 70% auto-keep, and below the 18% threshold role targets count from.
 */
export const INCLUSION_PRIOR_DECKS = 12;

/** Shrink factor in (0, 1] for percentages coming off a page built from `pageDecks` decks. */
export function pageConfidence(pageDecks: number, priorDecks = INCLUSION_PRIOR_DECKS): number {
  const n = Math.max(0, pageDecks);
  return n / (n + priorDecks);
}

/** Log-interpolated inclusion weight for archetype-only cards. Unknown/0 deck count = thin. */
export function archetypeWeight(commanderThemeDeckCount: number): number {
  const n = commanderThemeDeckCount;
  if (!n || n <= ARCHETYPE_THIN_DECKS) return ARCHETYPE_WEIGHT_MAX;
  if (n >= ARCHETYPE_HEALTHY_DECKS) return ARCHETYPE_WEIGHT_MIN;
  const t = Math.log(n / ARCHETYPE_THIN_DECKS) / Math.log(ARCHETYPE_HEALTHY_DECKS / ARCHETYPE_THIN_DECKS);
  return ARCHETYPE_WEIGHT_MAX - (ARCHETYPE_WEIGHT_MAX - ARCHETYPE_WEIGHT_MIN) * t;
}

/** "Golgari · Pillow Fort (80 decks)" — data lineage for tooltips. */
export function buildArchetypeSourceLabel(
  colorIdentity: string[],
  themeName: string,
  potentialDecks: number
): string {
  const colorName = colorIdentityToSlug(colorIdentity)
    .split('-')
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join('-');
  return `${colorName} · ${themeName} (${potentialDecks.toLocaleString()} decks)`;
}

// ─── Blend ───────────────────────────────────────────────────────────

type Cardlists = EDHRECCommanderData['cardlists'];

export interface ArchetypePool {
  pool: TagPageData['cardlists'];
  sourceLabel: string;
}

const CATEGORY_KEYS = [
  'creatures', 'instants', 'sorceries', 'artifacts',
  'enchantments', 'planeswalkers', 'lands',
] as const;

/**
 * Cross-reference the merged commander-theme pool against archetype tag pools.
 * - Cards in BOTH get archetypeOverlap = true (commander inclusion/synergy untouched —
 *   commander data is ground truth; the flag feeds a priority bonus).
 * - Archetype-only cards are injected at inclusion × archetypeWeight(deckCount),
 *   capped per category per pool, marked fromArchetype + archetypeSource.
 * Mutates commanderPool in place. Null pools (failed fetches) are skipped.
 */
export function blendArchetypeData(
  commanderPool: Cardlists,
  tagPools: Array<ArchetypePool | null>,
  commanderThemeDeckCount: number
): { overlapCount: number; injectedCount: number } {
  const weight = archetypeWeight(commanderThemeDeckCount);
  let overlapCount = 0;
  let injectedCount = 0;

  // Every name already in the commander pool — overlap check + injection dedupe.
  const commanderNames = new Set<string>();
  for (const list of Object.values(commanderPool)) {
    for (const c of list) commanderNames.add(c.name);
  }

  for (const tagPool of tagPools) {
    if (!tagPool) continue;

    // 1. Mark overlap on commander cards.
    const tagNames = new Set<string>();
    for (const list of Object.values(tagPool.pool)) {
      for (const c of list) tagNames.add(c.name);
    }
    for (const list of Object.values(commanderPool)) {
      for (const c of list) {
        if (tagNames.has(c.name) && !c.archetypeOverlap) {
          c.archetypeOverlap = true;
          overlapCount++;
        }
      }
    }

    // 2. Inject archetype-only cards, capped per category. Tag-pool lists are
    //    already inclusion-sorted by parseCardlists, so taking the first N keeps
    //    the archetype's strongest cards.
    for (const key of CATEGORY_KEYS) {
      let taken = 0;
      for (const card of tagPool.pool[key]) {
        if (taken >= ARCHETYPE_INJECT_CAP) break;
        if (commanderNames.has(card.name)) continue;
        const copy: EDHRECCard = {
          ...card,
          inclusion: card.inclusion * weight,
          fromArchetype: true,
          archetypeSource: tagPool.sourceLabel,
        };
        commanderPool[key].push(copy);
        if (key !== 'lands') commanderPool.allNonLand.push(copy);
        commanderNames.add(card.name); // dedupe across multiple tag pools
        taken++;
        injectedCount++;
      }
    }
  }

  // Restore inclusion-descending order (parseCardlists invariant).
  for (const key of Object.keys(commanderPool) as (keyof Cardlists)[]) {
    commanderPool[key].sort((a, b) => b.inclusion - a.inclusion);
  }

  return { overlapCount, injectedCount };
}
