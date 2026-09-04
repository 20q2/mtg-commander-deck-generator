/**
 * Undo has to cover more than the playtest store. A bot's board and an open
 * combat are part of the same game state, and a snapshot that misses them lets
 * a card exist on two boards at once — drag a creature onto an opponent's lane,
 * undo, and it comes back to yours while staying on theirs.
 *
 * playtestStore owns undo but can't import opponentStore: opponentStore already
 * imports playtestStore, and the cycle would break module init. So participants
 * register themselves here, and playtestStore calls through this module.
 */

export interface UndoParticipant {
  capture: () => unknown;
  restore: (snapshot: unknown) => void;
}

const participants: UndoParticipant[] = [];

export function registerUndoParticipant(p: UndoParticipant): void {
  participants.push(p);
}

/** One snapshot per participant, in registration order. Pairs with restoreAll by index. */
export function captureAll(): unknown[] {
  return participants.map(p => p.capture());
}

/**
 * Restore each participant from its matching snapshot. Tolerates a short array:
 * a snapshot taken before a participant registered simply leaves it alone.
 */
export function restoreAll(snapshots: unknown[]): void {
  participants.forEach((p, i) => {
    if (i < snapshots.length) p.restore(snapshots[i]);
  });
}
