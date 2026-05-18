import { useEffect, useRef } from 'react';
import { usePlaytestStore } from '@/store/playtestStore';
import { PHASES } from '@/components/playtest/types';

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
      if (/^[1-7]$/.test(e.key)) {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        s.setPhase(PHASES[idx]);
        return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
