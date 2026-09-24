/**
 * The one way a turn advances. Both entry points — the Next Turn button and the Enter hotkey —
 * come through here.
 *
 * They used to hold separate copies of this sequence, and the copies disagreed about the order:
 * the hotkey advanced your turn and drew you a card first, then let the bots play. The log read
 * "Turn 5 / Drew Sol Ring" followed by three bots casting, as if the whole table had acted inside
 * your turn. It also didn't await the bots, so a second Enter landed while the first cycle was
 * still in flight — the `running` guard caught it, but only after your own turn had already moved.
 */
import { usePlaytestStore } from '@/store/playtestStore';
import { useOpponentStore } from '@/store/opponentStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';

/**
 * Whether advancing is refused right now. Written as a plain function over the opponent state so
 * the button can subscribe to it as a selector and this module can check it directly — one rule,
 * not one for the disabled attribute and another for the click.
 *
 * Blocked while a bot's turn is in flight: advancing then moves YOUR turn and drops the bots' on
 * the floor, desyncing the game with nothing said. Blocked the same way on a confirmed attack of
 * your own, where blocks are chosen but damage hasn't happened yet.
 */
export function isTurnBlocked(s: {
  running: boolean;
  combat: unknown;
  playerCombat: unknown;
}): boolean {
  return s.running || !!s.combat || !!s.playerCombat;
}

/**
 * End your turn, let the table play, then begin your next one. Resolves once your new turn has
 * started — or early, if the advance was refused or the game was thrown away mid-cycle.
 */
export async function advanceTurn(): Promise<void> {
  if (isTurnBlocked(useOpponentStore.getState())) return;

  // Leave combat on the way out: an unconfirmed declaration never happened, so untap and forget it
  // rather than carrying a half-built attack — or an open combat phase — into the bots' turn.
  useOpponentStore.getState().exitCombat();

  const { opponentAutoTurns } = usePlaytestSettings.getState();
  if (opponentAutoTurns && useOpponentStore.getState().opponents.length > 0) {
    const completed = await useOpponentStore.getState().runAllTurns();
    // A reset or an exit while the bots were playing threw this game away.
    if (!completed) return;
  }

  // A fresh turn gets a fresh combat, so the phase readout goes back to offering one.
  useOpponentStore.getState().beginTurn();
  usePlaytestStore.getState().nextTurn();
  usePlaytestStore.getState().draw(1);
}
