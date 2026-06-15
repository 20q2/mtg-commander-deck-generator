import type { BrewContext, BrewState } from './brewTypes';

// AFFINITY_PER_PICK is 10 (picks.ts), so 20 ≈ two picks into a theme before we call it a "lean".
const LEANING_THRESHOLD = 20;
const MAX_LEANING = 2;

/**
 * Display names of the themes the deck is leaning into, strongest first.
 * Only theme slugs that have a display name in ctx.themeNames count — this filters out
 * subtype affinity tags (e.g. 'spot-removal') that share the affinity map.
 */
export function leaningThemes(ctx: BrewContext, state: BrewState): string[] {
  return Object.entries(state.themeAffinity)
    .filter(([slug, weight]) => weight >= LEANING_THRESHOLD && ctx.themeNames[slug])
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_LEANING)
    .map(([slug]) => ctx.themeNames[slug]);
}
