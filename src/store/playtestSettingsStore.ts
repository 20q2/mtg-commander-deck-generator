import { create } from 'zustand';

const STORAGE_KEY = 'mtg-playtest-settings';

export type BattlefieldBg = 'arena' | 'dark' | 'felt' | 'wood';

export const BG_STYLES: Record<BattlefieldBg, { label: string; background: string }> = {
  arena: { label: 'Arena',     background: 'radial-gradient(ellipse at center, rgba(40,60,100,0.18), transparent 70%)' },
  dark:  { label: 'Dark',      background: 'transparent' },
  felt:  { label: 'Green felt', background: 'radial-gradient(ellipse at center, rgba(20,80,40,0.22), rgba(20,40,25,0.05) 70%)' },
  wood:  { label: 'Warm wood',  background: 'radial-gradient(ellipse at center, rgba(120,80,40,0.20), rgba(60,40,20,0.05) 70%)' },
};

interface Settings {
  bg: BattlefieldBg;
  animations: boolean;
}

interface SettingsActions {
  setBg: (bg: BattlefieldBg) => void;
  setAnimations: (v: boolean) => void;
}

const defaults: Settings = {
  bg: 'arena',
  animations: true,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

function save(s: Settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export const usePlaytestSettings = create<Settings & SettingsActions>((set, get) => ({
  ...load(),
  setBg: (bg) => { set({ bg }); save({ ...get(), bg }); },
  setAnimations: (animations) => { set({ animations }); save({ ...get(), animations }); },
}));
