import { create } from 'zustand';

export type FloatTone = 'damage' | 'heal' | 'buff' | 'debuff' | 'neutral';

export interface FloatItem {
  id: string;
  text: string;
  tone: FloatTone;
  /** Viewport coordinates — the layer renders fixed, so it survives scrolling. */
  x: number;
  y: number;
}

/** How long each pop lives. Must match the animation duration in index.css. */
export const FLOAT_MS = 900;

interface State {
  items: FloatItem[];
}

interface Actions {
  /**
   * Pop a bit of text off something. `target` is either explicit viewport
   * coordinates or a `data-float-id` value to look the element up by — the
   * lookup keeps callers from having to thread refs through the tree.
   */
  float: (text: string, tone: FloatTone, target: string | { x: number; y: number }) => void;
  remove: (id: string) => void;
  clear: () => void;
}

let seq = 0;

function resolve(target: string | { x: number; y: number }): { x: number; y: number } | null {
  if (typeof target !== 'string') return target;
  // Guarded: float() is called from store actions like adjustLife, which must
  // not blow up when there's no DOM to anchor to.
  if (typeof document === 'undefined') return null;
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(target) : target;
  const el = document.querySelector(`[data-float-id="${escaped}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // Slightly above centre, so the text clears the card as it rises.
  return { x: r.left + r.width / 2, y: r.top + r.height * 0.35 };
}

export const useFloatingText = create<State & Actions>((set) => ({
  items: [],

  float: (text, tone, target) => {
    const at = resolve(target);
    // A missing anchor means the card already left the screen; silently skip
    // rather than piling text in the top-left corner.
    if (!at) return;
    const id = `float-${++seq}`;
    set(s => ({ items: [...s.items, { id, text, tone, x: at.x, y: at.y }] }));
    setTimeout(() => set(s => ({ items: s.items.filter(i => i.id !== id) })), FLOAT_MS);
  },

  remove: (id) => set(s => ({ items: s.items.filter(i => i.id !== id) })),
  clear: () => set({ items: [] }),
}));

/** Convenience for the common case: a signed number. */
export function floatDelta(delta: number, target: string | { x: number; y: number }, suffix = '') {
  if (delta === 0) return;
  useFloatingText.getState().float(
    `${delta > 0 ? '+' : '−'}${Math.abs(delta)}${suffix}`,
    delta > 0 ? 'heal' : 'damage',
    target,
  );
}
