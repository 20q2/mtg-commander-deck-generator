import type { BrewContext, BrewState } from './brewTypes';

// AFFINITY_PER_PICK is 10 (picks.ts), so 20 ≈ two picks into a theme before we call it a "lean".
const LEANING_THRESHOLD = 20;
const MAX_LEANING = 2;

/** Affinity at which a theme reads as "committed" on the identity meter — matches CROSSROADS_COMMIT. */
export const IDENTITY_COMMIT_THRESHOLD = 40;

/** One row of the identity meter: a theme, its accumulated affinity, and whether it's committed. */
export interface IdentityBar {
  slug: string;
  label: string;
  value: number;
  committed: boolean;
}

/**
 * The top `n` themes the deck is leaning into, strongest first, for the identity meter. Only slugs
 * with a display name in ctx.themeNames count (filters out subtype affinity tags like 'spot-removal').
 * A theme is "committed" when the player committed to it at a Crossroads, or its affinity has crossed
 * the commit threshold organically.
 */
export function topIdentity(ctx: BrewContext, state: BrewState, n = 4): IdentityBar[] {
  return Object.entries(state.themeAffinity)
    .filter(([slug, weight]) => weight > 0 && ctx.themeNames[slug])
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([slug, value]) => ({
      slug,
      label: ctx.themeNames[slug],
      value,
      committed: state.committedTheme === slug || value >= IDENTITY_COMMIT_THRESHOLD,
    }));
}

/**
 * Display names of the themes the deck is leaning into, strongest first (max two, above the leaning
 * threshold). A thin wrapper over topIdentity so the fork readout and the meter never disagree.
 */
export function leaningThemes(ctx: BrewContext, state: BrewState): string[] {
  return topIdentity(ctx, state, 8)
    .filter(b => b.value >= LEANING_THRESHOLD)
    .slice(0, MAX_LEANING)
    .map(b => b.label);
}

/** Deterministic epithet pool for runs with no defining moment (varied by pick count, no RNG). */
const TITLE_EPITHETS = ['Brew', 'Empire', 'Crucible', 'Doctrine', 'Cabal', 'Machine'];

/**
 * A named title for the finished run, e.g. "The Treasure Empire" — built from the leading theme and
 * the run's character (a chased combo reads as an Engine, a trusted Strange Signal as a Gambit, an
 * explicit Crossroads commit as an Ascendancy). Falls back to the commander when nothing is leaning.
 * Pure + deterministic (no RNG — keeps session resume stable).
 */
export function generateRunTitle(ctx: BrewContext, state: BrewState): string {
  const lead = leaningThemes(ctx, state)[0];
  if (!lead) return `${ctx.commander.name}'s Brew`;
  const chasedCombo = state.moments.some(m => m.kind === 'comboFragment');
  const trustedSignal = state.moments.some(m => m.kind === 'strangeSignal' && m.label.startsWith('Trusted'));
  const epithet = chasedCombo ? 'Engine'
    : trustedSignal ? 'Gambit'
    : state.committedTheme ? 'Ascendancy'
    : TITLE_EPITHETS[state.picks.length % TITLE_EPITHETS.length];
  return `The ${lead} ${epithet}`;
}
