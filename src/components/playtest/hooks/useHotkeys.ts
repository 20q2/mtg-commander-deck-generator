import { useEffect, useRef } from 'react';
import { usePlaytestStore } from '@/store/playtestStore';
import { useOpponentStore } from '@/store/opponentStore';

export function usePlaytestHotkeys() {
  // Track the most recent cursor position so Ctrl+V can paste at the cursor.
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => { cursorRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  useEffect(() => {
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
        // An unconfirmed declaration never happened — untap and forget it.
        useOpponentStore.getState().exitCombat();
        s.nextTurn();
        s.draw(1);
        return;
      }
      // Backspace: reset the playtest, matching the Reset button. preventDefault
      // also stops the browser's back-navigation behaviour.
      if (e.key === 'Backspace') { e.preventDefault(); s.reset(); return; }

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
        if (targetCardIds.length > 0) { e.preventDefault(); s.toggleFaceDownMany(targetCardIds); }
        return;
      }
      if (k === 'r') {
        if (s.hoveredPile) { e.preventDefault(); s.shufflePile(s.hoveredPile); }
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
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
