import { create } from 'zustand';

/** How long one flash lives. Must match the animation duration in index.css. */
export const DAMAGE_FLASH_MS = 850;

export interface DamageFlash {
  id: string;
  /** 0–1. Drives opacity and how far the glow reaches in from the edges. */
  intensity: number;
}

interface State {
  flash: DamageFlash | null;
}

interface Actions {
  /**
   * Bloom red at the edges of the screen. `lifeBefore` is what scales it: four
   * damage at 40 life is a nudge, four damage at 5 life is a panic.
   */
  hit: (amount: number, lifeBefore: number) => void;
  clear: () => void;
}

let seq = 0;

export const useDamageFlash = create<State & Actions>((set) => ({
  flash: null,

  hit: (amount, lifeBefore) => {
    if (amount <= 0) return;
    // Two readings of "how bad was that", whichever is worse: the absolute size of
    // the hit (a Craterhoof swing registers at any life total) and the fraction of
    // your remaining life it took (a small hit at 3 life still deserves alarm).
    const bySize = Math.min(1, amount / 12);
    const byShare = lifeBefore > 0 ? Math.min(1, amount / lifeBefore) : 1;
    const intensity = Math.max(0.2, bySize, byShare);
    const id = `hit-${++seq}`;
    // A fresh id remounts the layer, which is what restarts the CSS animation —
    // a second hit mid-glow starts over rather than stacking opacity.
    set({ flash: { id, intensity } });
    setTimeout(() => set(s => (s.flash?.id === id ? { flash: null } : s)), DAMAGE_FLASH_MS);
  },

  clear: () => set({ flash: null }),
}));
