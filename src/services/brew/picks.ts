import type { BrewState, BrewPick, RouteType, BrewHistoryEntry } from './brewTypes';

/** Weight added to themeAffinity per tag per pick that carries that tag. */
export const AFFINITY_PER_PICK = 10;

export interface ApplyPickMeta {
  routeType: RouteType;
  passed: string[];                    // names shown but not taken in this decision
  tags: Record<string, string[]>;      // pickedCardName -> synergy tags (drives affinity)
  moment?: BrewHistoryEntry['moment']; // set when this pick came from an event → locks it from undo
}

/** Pure state transition: add one decision's worth of picks. Bundles/lightning pass multiple picks. */
export function applyPick(state: BrewState, picks: BrewPick[], meta: ApplyPickMeta): BrewState {
  const addedNames = picks.map(p => p.name);
  const themeAffinity = { ...state.themeAffinity };
  for (const p of picks) {
    for (const tag of meta.tags[p.name] ?? []) {
      themeAffinity[tag] = (themeAffinity[tag] ?? 0) + AFFINITY_PER_PICK;
    }
  }
  const pickNumber = state.history.length + 1;
  return {
    ...state,
    picks: [...state.picks, ...picks],
    usedNames: [...state.usedNames, ...addedNames],
    themeAffinity,
    history: [...state.history, {
      pickNumber,
      routeId: picks[0]?.viaRouteId ?? '',
      routeType: meta.routeType,
      added: addedNames,
      passed: meta.passed,
      tags: meta.tags,
      ...(meta.moment ? { moment: meta.moment } : {}),
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
  for (const [name, tags] of Object.entries(last.tags ?? {})) {
    if (!last.added.includes(name)) continue;
    for (const tag of tags) themeAffinity[tag] = Math.max(0, (themeAffinity[tag] ?? 0) - AFFINITY_PER_PICK);
  }
  return {
    ...state,
    picks,
    usedNames: state.usedNames.slice(0, state.usedNames.length - removeCount),
    history: state.history.slice(0, -1),
    themeAffinity,
  };
}
