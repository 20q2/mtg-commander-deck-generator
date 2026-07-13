import type { BrewCandidate } from './brewTypes';

// A tag counts as "characteristic" of a theme when it appears in the theme's pool at least this many
// times MORE than its baseline rate across the whole candidate pool, AND enough distinct cards carry
// it that it isn't a one-off. Tuned so mechanical identities (infect, proliferate) clear the bar while
// universal staples (tutor, card-draw) — common everywhere, so ~1.0 lift — never do.
export const CHAR_TAG_MIN_LIFT = 2.5;
export const CHAR_TAG_MIN_CARRIERS = 3;
export const CHAR_TAG_MAX_PER_THEME = 8;

/** Fraction of `cards` carrying `tag` (0 when the list is empty). */
function freq(tag: string, cards: BrewCandidate[]): number {
  if (cards.length === 0) return 0;
  let n = 0;
  for (const c of cards) if (c.chromaTags?.includes(tag)) n++;
  return n / cards.length;
}

/**
 * Compute each theme's CHARACTERISTIC chroma tags by pool-local lift: how much more often a tag shows
 * up among the theme's pool members than across the whole candidate pool. Over-representation, not raw
 * frequency, is what separates a theme's mechanics from the staples every pool shares.
 *
 * @param candidates the whole (non-land) candidate pool, already stamped with `chromaTags`
 * @param themeSlugs the theme slugs to compute for (ctx.themeNames keys)
 * @returns slug -> characteristic tag slugs, ordered by lift desc, capped. Themes with no qualifying
 *          tag get an empty array (caller treats empty like "no data for this theme").
 */
export function computeThemeCharTags(
  candidates: BrewCandidate[],
  themeSlugs: string[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (candidates.length === 0) return out;

  // Baseline tag frequency across the whole pool, plus the tag universe to iterate.
  const baseFreq = new Map<string, number>();
  const poolCarriers = new Map<string, number>();
  for (const c of candidates) {
    for (const t of c.chromaTags ?? []) poolCarriers.set(t, (poolCarriers.get(t) ?? 0) + 1);
  }
  for (const [t, carriers] of poolCarriers) baseFreq.set(t, carriers / candidates.length);

  for (const slug of themeSlugs) {
    const members = candidates.filter(c => c.themeTags.includes(slug));
    if (members.length === 0) { out[slug] = []; continue; }
    const memberCarriers = new Map<string, number>();
    for (const c of members) {
      for (const t of c.chromaTags ?? []) memberCarriers.set(t, (memberCarriers.get(t) ?? 0) + 1);
    }
    const scored: { tag: string; lift: number }[] = [];
    for (const [tag, carriers] of memberCarriers) {
      if (carriers < CHAR_TAG_MIN_CARRIERS) continue;
      const base = baseFreq.get(tag) ?? 0;
      if (base <= 0) continue;
      const lift = freq(tag, members) / base;
      if (lift >= CHAR_TAG_MIN_LIFT) scored.push({ tag, lift });
    }
    scored.sort((a, b) => b.lift - a.lift);
    out[slug] = scored.slice(0, CHAR_TAG_MAX_PER_THEME).map(s => s.tag);
  }
  return out;
}
