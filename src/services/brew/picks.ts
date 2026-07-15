import type { BrewState, BrewPick, RouteType, BrewHistoryEntry, BrewCandidate, BrewContext } from './brewTypes';

/** Weight added to themeAffinity per tag per pick that carries that tag. */
export const AFFINITY_PER_PICK = 10;

/**
 * Weighted affinity model (see applyBrewOption). A commander's popular theme pages sit on nearly
 * every card, so crediting each of a pick's page memberships equally made the lean readout — AND the
 * theme packs offered next round (their priority is 1_000 + themeAffinity[slug]) — collapse onto the
 * commander's top two themes no matter which packs you cracked: those two blanket the pool, so every
 * card you take anywhere drips onto them until they out-climb whatever you're deliberately steering.
 *
 * So the weights are tiered to match how the direction should be shaped — MOSTLY by the packs you
 * choose to crack, then nudged by the cards you take, and only whispered at by incidental overlap:
 *  - cracking a theme pack is the high-level steer — a heavy one-off bonus, the choice itself is a direction,
 *  - a kept card's OWN defining theme (the pack's theme, or a draft card's signature) is a real nudge,
 *  - every incidental page the card merely also appears on barely counts, so populous themes can't
 *    silently climb into a lean on card volume alone.
 */
export const AFFINITY_SIGNATURE = 10;   // a defining membership: the pack's theme, or a card's own signature theme
export const AFFINITY_INCIDENTAL = 1;   // an incidental page the card merely also appears on — a whisper, not a driver
export const PACK_STEER_BONUS = 30;     // the act of cracking a theme pack — its theme, once per crack (the dominant signal)

/**
 * The weighted themeAffinity change a set of cards would add (slug -> amount). The single source of
 * truth for the affinity model, shared by the real commit (applyBrewOption) and the hover preview
 * (projectIdentityLean) so the dashed projection can never drift from what taking the cards does.
 *   - `packSlug` set (a cracked theme pack): that theme is the deliberate signal — every card's
 *     membership in it is SIGNATURE-weighted, every other page is incidental, plus a one-off steer bonus.
 *   - `packSlug` omitted (draft/combo/headliner): a card's OWN defining signature theme leads instead.
 * Subtypes are signature-weighted for functional-package cohesion (filtered from the theme readout).
 */
export function computeAffinityDelta(
  ctx: Pick<BrewContext, 'themeSignatures'>,
  cards: BrewCandidate[],
  packSlug?: string,
): Record<string, number> {
  const delta: Record<string, number> = {};
  const bump = (slug: string, amt: number) => { delta[slug] = (delta[slug] ?? 0) + amt; };
  for (const c of cards) {
    for (const slug of c.themeTags) {
      const leads = packSlug ? slug === packSlug : (ctx.themeSignatures[slug] ?? []).includes(c.name);
      bump(slug, leads ? AFFINITY_SIGNATURE : AFFINITY_INCIDENTAL);
    }
    if (c.subtype) bump(c.subtype, AFFINITY_SIGNATURE);
  }
  if (packSlug) bump(packSlug, PACK_STEER_BONUS);
  return delta;
}

// A decision counts toward the "on a roll" streak when it lands a card that advances the plan — a
// combo/lift/game-changer/role-fill, or an on-theme card. Pure filler (value packs with no such
// reason) breaks the streak. Drives the escalating HUD chip + milestone celebrations.
const STREAK_REASON_KINDS = new Set(['theme', 'role', 'combo', 'comboPiece', 'gameChanger', 'lift', 'discovery']);

export interface ApplyPickMeta {
  routeType: RouteType;
  passed: string[];                    // names shown but not taken in this decision
  tags: Record<string, string[]>;      // pickedCardName -> synergy tags (drives identityLean + reason chips)
  /**
   * The pre-weighted themeAffinity change to apply (slug -> amount). When present it is authoritative:
   * the caller (applyBrewOption) has already decided how much the cracked pack's theme dominates vs.
   * incidental page overlap. Omit it and affinity falls back to the flat per-tag model below.
   */
  affinityDelta?: Record<string, number>;
  moment?: BrewHistoryEntry['moment']; // set when this pick came from an event → locks it from undo
  rival?: BrewHistoryEntry['rival'];   // set when the player diverged from the engine's top-ranked option
}

/** Pure state transition: add one decision's worth of picks. Bundles/lightning pass multiple picks. */
export function applyPick(state: BrewState, picks: BrewPick[], meta: ApplyPickMeta): BrewState {
  const addedNames = picks.map(p => p.name);
  // A pre-weighted delta wins; otherwise fall back to the flat per-tag model (drafts/events).
  const affinityDelta = meta.affinityDelta ?? (() => {
    const d: Record<string, number> = {};
    for (const p of picks) for (const tag of meta.tags[p.name] ?? []) d[tag] = (d[tag] ?? 0) + AFFINITY_PER_PICK;
    return d;
  })();
  const themeAffinity = { ...state.themeAffinity };
  for (const [tag, amt] of Object.entries(affinityDelta)) themeAffinity[tag] = (themeAffinity[tag] ?? 0) + amt;
  const pickNumber = state.history.length + 1;
  // "On a roll": this decision extends the streak if any picked card advances the plan; pure filler resets it.
  const synergyPositive = picks.some(p => (p.reasons ?? []).some(r => STREAK_REASON_KINDS.has(r.kind)));
  const synergyStreak = synergyPositive ? (state.synergyStreak ?? 0) + 1 : 0;
  return {
    ...state,
    picks: [...state.picks, ...picks],
    usedNames: [...state.usedNames, ...addedNames],
    themeAffinity,
    synergyStreak,
    history: [...state.history, {
      pickNumber,
      routeId: picks[0]?.viaRouteId ?? '',
      routeType: meta.routeType,
      added: addedNames,
      passed: meta.passed,
      tags: meta.tags,
      affinityDelta,
      ...(meta.moment ? { moment: meta.moment } : {}),
      ...(meta.rival ? { rival: meta.rival } : {}),
    }],
  };
}

/** True when the most recent decision is locked in (came from an event) and can't be undone. */
export function isLastPickLocked(state: BrewState): boolean {
  const last = state.history[state.history.length - 1];
  return !!last?.moment;
}

/**
 * Undo the most recent decision. Event-sourced picks are committed — once you hit one, undo stops
 * there (the "accept fate" beat), so ordinary picks stay reversible but a trusted Strange Signal or
 * a finished combo's pieces are permanent.
 */
export function undoLast(state: BrewState): BrewState {
  if (state.history.length === 0) return state;
  if (isLastPickLocked(state)) return state;
  const last = state.history[state.history.length - 1];
  const removeCount = last.added.length;
  const picks = state.picks.slice(0, state.picks.length - removeCount);
  const themeAffinity = { ...state.themeAffinity };
  // Subtract exactly what this decision added. Prefer the recorded delta (the weighted model); fall
  // back to the flat per-tag reversal for any legacy entry that predates affinityDelta.
  if (last.affinityDelta) {
    for (const [tag, amt] of Object.entries(last.affinityDelta)) themeAffinity[tag] = Math.max(0, (themeAffinity[tag] ?? 0) - amt);
  } else {
    for (const [name, tags] of Object.entries(last.tags ?? {})) {
      if (!last.added.includes(name)) continue;
      for (const tag of tags) themeAffinity[tag] = Math.max(0, (themeAffinity[tag] ?? 0) - AFFINITY_PER_PICK);
    }
  }
  return {
    ...state,
    picks,
    usedNames: state.usedNames.slice(0, state.usedNames.length - removeCount),
    history: state.history.slice(0, -1),
    themeAffinity,
  };
}
