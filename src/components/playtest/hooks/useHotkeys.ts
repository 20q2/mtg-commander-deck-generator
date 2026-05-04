import { useEffect } from 'react';
import { usePlaytestStore } from '@/store/playtestStore';
import { PHASES } from '@/components/playtest/types';

export function usePlaytestHotkeys() {
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

      if (e.key.toLowerCase() === 'd') { e.preventDefault(); s.draw(1); return; }
      if (e.key.toLowerCase() === 'u') { e.preventDefault(); s.untapAll(); return; }
      if (e.key.toLowerCase() === 's') { e.preventDefault(); s.shuffle(); return; }
      if (e.key.toLowerCase() === 'm') { e.preventDefault(); s.beginMulligan(); return; }
      if (e.key.toLowerCase() === 't') {
        if (s.hovered) { e.preventDefault(); s.toggleTap(s.hovered); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        s.undo();
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
