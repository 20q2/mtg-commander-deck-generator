import { useEffect, useRef } from 'react';
import { usePlaytestStore } from '@/store/playtestStore';
import { useOpponentStore } from '@/store/opponentStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import type { ZoneKey } from '@/components/playtest/types';

type PileZone = Exclude<ZoneKey, 'hand'>;

/**
 * How long a typed digit waits to see whether another one follows. Long enough
 * to type a second digit without hurrying, short enough that a single-digit
 * draw doesn't read as a dropped keystroke.
 */
const DIGIT_BUFFER_MS = 450;
/** Ninety-nine cards is more than any pile-draw needs, and two digits keeps the wait to one. */
const DIGIT_MAX_LEN = 2;

export function usePlaytestHotkeys() {
  // Track the most recent cursor position so Ctrl+V can paste at the cursor.
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => { cursorRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  useEffect(() => {
    // Digits typed over a pile accumulate here until you stop typing, so "20"
    // draws twenty rather than two-then-zero. The zone is captured on the first
    // digit: moving the mouse mid-number doesn't redirect the draw.
    let digitBuf: { zone: PileZone; digits: string; timer: number } | null = null;

    const clearDigits = () => {
      if (!digitBuf) return;
      window.clearTimeout(digitBuf.timer);
      digitBuf = null;
      usePlaytestStore.getState().setPileDrawPending(null);
    };

    const flushDigits = () => {
      const buf = digitBuf;
      if (!buf) return;
      clearDigits();
      usePlaytestStore.getState().takeFromPile(buf.zone, Number(buf.digits));
    };

    const pushDigit = (zone: PileZone, digit: string) => {
      // Pointing at a different pile part-way through a number means the old
      // number was meant for the old pile. Honour it rather than dropping the
      // keystrokes on the floor.
      if (digitBuf && digitBuf.zone !== zone) flushDigits();
      // A leading zero has nothing to say — "draw 0" isn't an action — and
      // allowing it would make "05" a two-digit number that fires as five.
      if (!digitBuf && digit === '0') return;
      const digits = (digitBuf?.digits ?? '') + digit;
      clearDigits();
      // Two digits is the cap, and reaching it fires straight away: "20" lands
      // the instant the 0 does, so only single-digit draws ever wait.
      if (digits.length >= DIGIT_MAX_LEN) {
        usePlaytestStore.getState().takeFromPile(zone, Number(digits));
        return;
      }
      digitBuf = { zone, digits, timer: window.setTimeout(flushDigits, DIGIT_BUFFER_MS) };
      usePlaytestStore.getState().setPileDrawPending({ zone, n: Number(digits) });
    };

    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing in an input/textarea/contenteditable
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      const s = usePlaytestStore.getState();
      // If a modal is open, only Esc is meaningful
      if (s.modal) {
        if (e.key === 'Escape') s.closeModal();
        return;
      }

      // Enter (main or numpad — both report e.key === 'Enter'): advance the
      // turn and draw, matching the Next Turn button.
      if (e.key === 'Enter') {
        e.preventDefault();
        const bots = useOpponentStore.getState();
        // Same lock the Next Turn button holds. Advancing while a bot's turn is
        // in flight, or while a confirmed attack is waiting on damage, drops
        // that turn on the floor and desyncs the game with nothing said.
        if (bots.running || bots.combat || bots.playerCombat) return;
        // An unconfirmed declaration never happened — untap and forget it.
        bots.exitCombat();
        // Fresh turn, fresh combat — same reset the Next Turn button does.
        bots.beginTurn();
        s.nextTurn();
        s.draw(1);
        if (usePlaytestSettings.getState().opponentAutoTurns) bots.runAllTurns();
        return;
      }
      // Backspace: reset the playtest, matching the Reset button. preventDefault
      // also stops the browser's back-navigation behaviour.
      //
      // The bots reset with you. Resetting only your own side left you on a
      // fresh opening hand facing three developed turn-nine boards, which is
      // not a reset so much as a concession.
      if (e.key === 'Backspace') {
        e.preventDefault();
        s.reset();
        useOpponentStore.getState().resetAll();
        return;
      }

      // Esc backs out of a half-typed number instead of drawing it.
      if (e.key === 'Escape' && digitBuf) { clearDigits(); return; }

      const k = e.key.toLowerCase();
      if (k === 'd') { e.preventDefault(); s.draw(1); return; }
      if (k === 'u') { e.preventDefault(); s.untapAll(); return; }
      if (k === 's') { e.preventDefault(); s.shuffle(); return; }
      if (k === 'm') { e.preventDefault(); s.beginMulligan(); return; }
      // Selection-aware: if any battlefield cards are marquee-selected, the
      // group is the target; otherwise fall back to whatever the cursor is
      // hovering over.
      const targetCardIds = s.selectedIds.length > 0
        ? s.selectedIds
        : (s.hovered ? [s.hovered] : []);

      // Delete: send whatever the cursor is over to the graveyard. Anything that
      // can't exist there — a token, a counter, a die — just goes away.
      //
      // Deliberately NOT bound to Backspace as well: that's already Reset, and a
      // stray Backspace wiping the game would be a nasty way to find that out.
      if (e.key === 'Delete') {
        e.preventDefault();
        // Resolution order is "whatever the cursor is actually on". Counters and
        // dice render above cards, so they win. A hovered hand card beats a
        // battlefield marquee selection: the selection is the fallback for when
        // you aren't pointing at anything, and binning a whole board because a
        // stale selection outranked the card under the cursor would be worse than
        // the reverse.
        if (s.hoveredCounter) { s.removeFreeCounter(s.hoveredCounter); s.setHoveredCounter(null); return; }
        if (s.hoveredDie) { s.removeFreeDie(s.hoveredDie); s.setHoveredDie(null); return; }
        if (s.hoveredHandIndex !== null) {
          s.moveCard({
            source: { kind: 'zone', zone: 'hand', index: s.hoveredHandIndex },
            target: { kind: 'zone', zone: 'graveyard' },
          });
          // Every later card shifted down one, so the stored index is now stale.
          s.setHoveredHandIndex(null);
          return;
        }
        if (targetCardIds.length === 0) return;
        // moveCard already encodes MTG 111.8 — a token leaving the battlefield
        // ceases to exist instead of landing in the graveyard — so route through
        // it rather than keeping a second copy of that rule here.
        for (const id of targetCardIds) {
          s.moveCard({
            source: { kind: 'battlefield', instanceId: id },
            target: { kind: 'zone', zone: 'graveyard' },
          });
        }
        // The cards are gone; leaving them hovered/selected would let a second
        // Delete act on ids that no longer exist.
        s.setHovered(null);
        s.clearSelection();
        return;
      }

      if (k === 't') {
        if (targetCardIds.length > 0) { e.preventDefault(); s.toggleTapMany(targetCardIds); }
        return;
      }
      if (k === 'q') {
        if (targetCardIds.length > 0) { e.preventDefault(); s.rotateCards(targetCardIds, -90); }
        return;
      }
      if (k === 'e') {
        if (targetCardIds.length > 0) { e.preventDefault(); s.rotateCards(targetCardIds, 90); }
        return;
      }
      if (k === 'f') {
        // A hovered hand card turns over instead — same resolution order Delete
        // uses, where the card under the cursor beats a stale board selection.
        if (s.hoveredHandIndex !== null) {
          const inHand = s.zones.hand[s.hoveredHandIndex];
          if (inHand) { e.preventDefault(); s.toggleHandFlipped(inHand.id); }
          return;
        }
        if (targetCardIds.length > 0) { e.preventDefault(); s.toggleFaceDownMany(targetCardIds); }
        return;
      }
      if (k === 'r') {
        if (s.hoveredPile) { e.preventDefault(); s.shufflePile(s.hoveredPile); }
        return;
      }
      // Digits: "draw that many". Over a pile they buffer briefly so a 2 can
      // still turn into a 20, then pull that many cards off the top into your
      // hand. Over the battlefield, 1 pulls the card under the cursor (or the
      // whole marquee selection) back to hand — drawing a card you already own.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[0-9]$/.test(e.key)) {
        if (s.hoveredPile) {
          e.preventDefault();
          pushDigit(s.hoveredPile, e.key);
          return;
        }
        const n = Number(e.key);
        // Only 1 works on the battlefield: the count is the cards you're
        // pointing at, not a number you pick, so 2-9 would be a lie.
        if (n === 1 && targetCardIds.length > 0) {
          e.preventDefault();
          for (const id of targetCardIds) {
            s.moveCard({
              source: { kind: 'battlefield', instanceId: id },
              target: { kind: 'zone', zone: 'hand' },
            });
          }
          // Those cards aren't on the battlefield any more, so a second 1 must
          // not act on their stale ids.
          s.setHovered(null);
          s.clearSelection();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        s.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        s.copyToClipboard();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        // If the cursor is over the battlefield, paste centred on the cursor.
        // Otherwise fall back to the cascading offset behaviour.
        const cursor = cursorRef.current;
        let target: { x: number; y: number } | undefined;
        if (cursor) {
          const bf = document.querySelector('[data-battlefield]') as HTMLElement | null;
          if (bf) {
            const r = bf.getBoundingClientRect();
            const lx = cursor.x - r.left;
            const ly = cursor.y - r.top;
            if (lx >= 0 && ly >= 0 && lx <= r.width && ly <= r.height) {
              target = { x: lx, y: ly };
            }
          }
        }
        s.pasteClipboard(target);
        return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Don't let a pending draw fire into a store the view has left.
      clearDigits();
    };
  }, []);
}
