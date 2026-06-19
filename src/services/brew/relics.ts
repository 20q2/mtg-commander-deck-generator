import type { RoleKey } from '@/services/tagger/client';
import type { BrewContext, BrewState, BrewRelic, BrewMoment } from './brewTypes';

/**
 * Deck philosophies — a once-per-run deckbuilding stance (The Efficient / Spicy / Combo Brew) that
 * biases every later offer. Chosen as 1-of-3, no take-back (the commitment beat). Each maps to a
 * single live scoring lever, read where offers are generated (scoring / discovery). The legacy
 * relic effect-readers below (pack bonus, budget cap, theme weight) are retained for callers but
 * unused by the current philosophies.
 */

// --- Cadence ----------------------------------------------------------------
/** A deck philosophy is a once-per-run stance, offered early so it shapes most of the brew. */
export const FIRST_PHILOSOPHY_AT = 6;

export function shouldOfferRelic(state: BrewState): boolean {
  return state.relics.length === 0 && state.picks.length >= FIRST_PHILOSOPHY_AT;
}

// --- The philosophies -------------------------------------------------------
// Three broad deckbuilding stances, each mapped to a single live scoring lever. Chosen once.
const PHILOSOPHIES: BrewRelic[] = [
  { id: 'philosophy:efficient', name: 'The Efficient Brew', glyph: 'book-open',
    description: 'Lean on proven staples — fewer wild cards, more consistency.',
    effect: { type: 'efficiency', mult: 2 } },
  { id: 'philosophy:spicy', name: 'The Spicy Brew', glyph: 'flame',
    description: 'Chase the off-radar — more hidden synergies surface, higher variance.',
    effect: { type: 'discoveryRate', mult: 1.8 } },
  { id: 'philosophy:combo', name: 'The Combo Brew', glyph: 'gem',
    description: 'Hunt the kill — combo pieces you’re chasing show up far more often.',
    effect: { type: 'comboBias', mult: 1.8 } },
];

/**
 * The deck philosophies to choose from (the player picks one, once). Deterministic — the same
 * three every time, so a sessionStorage resume is stable. Never re-offers an already-chosen stance.
 */
export function offerRelics(_ctx: BrewContext, state: BrewState): BrewRelic[] {
  const owned = new Set(state.relics.map(r => r.id));
  return PHILOSOPHIES.filter(p => !owned.has(p.id));
}

/** Apply a philosophy: append it, log a story moment, and mark a moment-gap so an event doesn't pile on. */
export function applyRelic(state: BrewState, relic: BrewRelic): BrewState {
  if (state.relics.some(r => r.id === relic.id)) return state;
  const moment: BrewMoment = { atPick: state.picks.length, kind: 'relic', label: `Embraced ${relic.name}`, detail: relic.description };
  return {
    ...state,
    relics: [...state.relics, relic],
    lastMomentPick: state.picks.length,
    moments: [...state.moments, moment],
  };
}

// --- Effect readers (shared by scoring / nodes / discovery / budget) --------

/** Product of all relic multipliers of a given multiplicative kind (1 when none apply). */
export function relicMult(relics: BrewRelic[], kind: 'comboBias' | 'discoveryRate' | 'efficiency'): number {
  let mult = 1;
  for (const r of relics) if (r.effect.type === kind) mult *= r.effect.mult;
  return mult;
}

/** Extra multiplier on a specific theme's affinity contribution (themeWeight relics). */
export function relicThemeMult(relics: BrewRelic[], slug: string): number {
  let mult = 1;
  for (const r of relics) if (r.effect.type === 'themeWeight' && r.effect.slug === slug) mult *= r.effect.mult;
  return mult;
}

/** Total bonus pack slots for a role across packBonus relics. */
export function relicPackBonus(relics: BrewRelic[], role: RoleKey): number {
  let extra = 0;
  for (const r of relics) if (r.effect.type === 'packBonus' && r.effect.role === role) extra += r.effect.extra;
  return extra;
}

/** The tightest budget cap imposed by any budgetCap relic (null when none). */
export function relicBudgetCap(relics: BrewRelic[]): number | null {
  let cap: number | null = null;
  for (const r of relics) if (r.effect.type === 'budgetCap') cap = cap == null ? r.effect.maxUsd : Math.min(cap, r.effect.maxUsd);
  return cap;
}
