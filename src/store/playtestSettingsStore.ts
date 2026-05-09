import { create } from 'zustand';
import type { LogCategory } from '@/components/playtest/types';

const STORAGE_KEY = 'mtg-playtest-settings';

export type BattlefieldBg = 'arena' | 'dark' | 'felt' | 'wood';

export const BG_STYLES: Record<BattlefieldBg, { label: string; background: string }> = {
  arena: { label: 'Arena',     background: 'radial-gradient(ellipse at center, rgba(40,60,100,0.18), transparent 70%)' },
  dark:  { label: 'Dark',      background: 'transparent' },
  felt:  { label: 'Green felt', background: 'radial-gradient(ellipse at center, rgba(20,80,40,0.22), rgba(20,40,25,0.05) 70%)' },
  wood:  { label: 'Warm wood',  background: 'radial-gradient(ellipse at center, rgba(120,80,40,0.20), rgba(60,40,20,0.05) 70%)' },
};

export type LogFilter = Record<LogCategory, boolean>;

const ALL_LOG_CATEGORIES_ON: LogFilter = {
  move: true, tap: true, library: true, counter: true, life: true, turn: true, system: true,
};

interface Settings {
  bg: BattlefieldBg;
  animations: boolean;
  logFilter: LogFilter;
}

interface SettingsActions {
  setBg: (bg: BattlefieldBg) => void;
  setAnimations: (v: boolean) => void;
  setLogFilter: (filter: LogFilter) => void;
  toggleLogCategory: (category: LogCategory) => void;
}

const defaults: Settings = {
  bg: 'arena',
  animations: true,
  logFilter: ALL_LOG_CATEGORIES_ON,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Merge stored logFilter with defaults so any newly-added categories default to true.
    return {
      ...defaults,
      ...parsed,
      logFilter: { ...ALL_LOG_CATEGORIES_ON, ...(parsed.logFilter ?? {}) },
    };
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
  setLogFilter: (logFilter) => { set({ logFilter }); save({ ...get(), logFilter }); },
  toggleLogCategory: (category) => {
    const next: LogFilter = { ...get().logFilter, [category]: !get().logFilter[category] };
    set({ logFilter: next });
    save({ ...get(), logFilter: next });
  },
}));
