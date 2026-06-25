import { create } from 'zustand';
import type { LogCategory } from '@/components/playtest/types';
import { artUrl, backgroundUrlForIdentity } from '@/services/spellchroma/colorBackground';

const STORAGE_KEY = 'mtg-playtest-settings';

export type BattlefieldPreset = 'arena' | 'dark' | 'felt' | 'wood';

export const BG_STYLES: Record<BattlefieldPreset, { label: string; background: string }> = {
  arena: { label: 'Arena',     background: 'radial-gradient(ellipse at center, rgba(40,60,100,0.18), transparent 70%)' },
  dark:  { label: 'Dark',      background: 'transparent' },
  felt:  { label: 'Green felt', background: 'radial-gradient(ellipse at center, rgba(20,80,40,0.22), rgba(20,40,25,0.05) 70%)' },
  wood:  { label: 'Warm wood',  background: 'radial-gradient(ellipse at center, rgba(120,80,40,0.20), rgba(60,40,20,0.05) 70%)' },
};

/**
 * The battlefield background can be one of four kinds: auto (art matched to the
 * loaded deck's color identity — the default), a gradient preset, a solid color,
 * or a specific SpellChroma art.
 */
export type BgChoice =
  | { kind: 'auto' }
  | { kind: 'preset'; id: BattlefieldPreset }
  | { kind: 'color'; hex: string }
  | { kind: 'art'; name: string };

export interface BgLayers {
  /** CSS `background` for the container (gradient presets / solid color). */
  base?: string;
  /** Cover-fit art image URL — rendered with a dark scrim for legibility. */
  image?: string;
}

/** Resolve a background choice (+ the deck's color identity, for auto) to render layers. */
export function resolveBgLayers(choice: BgChoice, colorIdentity: string[]): BgLayers {
  switch (choice.kind) {
    case 'preset': return { base: BG_STYLES[choice.id].background };
    case 'color':  return { base: choice.hex };
    case 'art':    return { image: artUrl(choice.name) };
    case 'auto':   return { image: backgroundUrlForIdentity(colorIdentity) };
  }
}

export type BattlefieldCardSize = 'small' | 'medium' | 'large';

export const CARD_SIZES: Record<BattlefieldCardSize, { label: string; width: number; height: number }> = {
  small:  { label: 'Small',  width: 100, height: 140 },
  medium: { label: 'Medium', width: 130, height: 182 },
  large:  { label: 'Large',  width: 165, height: 231 },
};

export type LogFilter = Record<LogCategory, boolean>;

const ALL_LOG_CATEGORIES_ON: LogFilter = {
  move: true, tap: true, library: true, counter: true, life: true, turn: true, system: true,
};

interface Settings {
  bg: BgChoice;
  cardSize: BattlefieldCardSize;
  animations: boolean;
  dotGrid: boolean;
  logFilter: LogFilter;
}

interface SettingsActions {
  setBg: (bg: BgChoice) => void;
  setCardSize: (size: BattlefieldCardSize) => void;
  setAnimations: (v: boolean) => void;
  setDotGrid: (v: boolean) => void;
  setLogFilter: (filter: LogFilter) => void;
  toggleLogCategory: (category: LogCategory) => void;
}

const defaults: Settings = {
  bg: { kind: 'preset', id: 'arena' },
  cardSize: 'medium',
  animations: true,
  dotGrid: true,
  logFilter: ALL_LOG_CATEGORIES_ON,
};

const PRESET_IDS: BattlefieldPreset[] = ['arena', 'dark', 'felt', 'wood'];

/** Migrate a stored `bg` value to the current BgChoice shape. */
function migrateBg(bg: unknown): BgChoice {
  // Legacy: bg was one of the preset id strings.
  if (typeof bg === 'string') {
    return PRESET_IDS.includes(bg as BattlefieldPreset)
      ? { kind: 'preset', id: bg as BattlefieldPreset }
      : defaults.bg;
  }
  if (bg && typeof bg === 'object' && 'kind' in bg) return bg as BgChoice;
  return defaults.bg;
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Merge stored logFilter with defaults so any newly-added categories default to true.
    return {
      ...defaults,
      ...parsed,
      bg: migrateBg(parsed.bg),
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
  setCardSize: (cardSize) => { set({ cardSize }); save({ ...get(), cardSize }); },
  setAnimations: (animations) => { set({ animations }); save({ ...get(), animations }); },
  setDotGrid: (dotGrid) => { set({ dotGrid }); save({ ...get(), dotGrid }); },
  setLogFilter: (logFilter) => { set({ logFilter }); save({ ...get(), logFilter }); },
  toggleLogCategory: (category) => {
    const next: LogFilter = { ...get().logFilter, [category]: !get().logFilter[category] };
    set({ logFilter: next });
    save({ ...get(), logFilter: next });
  },
}));
