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

/**
 * How an opponent's card reveals itself. `ctrl` matches your own battlefield;
 * `hover` is the impatient option; `off` suits anyone who finds the popup noisy.
 */
export type OpponentPreviewMode = 'follow' | 'ctrl' | 'hover' | 'off';

/**
 * The same choice for your own cards, minus `off` — a hand card is 130px wide
 * and the preview is the only way to read one, so there always has to be a
 * gesture that opens it.
 */
export type CardPreviewMode = 'ctrl' | 'hover';

export type LogFilter = Record<LogCategory, boolean>;

const ALL_LOG_CATEGORIES_ON: LogFilter = {
  move: true, tap: true, library: true, counter: true, life: true, turn: true, bot: true, system: true,
};

interface Settings {
  bg: BgChoice;
  cardSize: BattlefieldCardSize;
  /** How your own cards open their magnified preview. */
  cardPreview: CardPreviewMode;
  animations: boolean;
  /**
   * Quiet synthesized table sounds — shuffle, draw, counter click, card landing, tap — plus the
   * chime that fires when the bots finish their turns and control comes back to you.
   */
  sounds: boolean;
  dotGrid: boolean;
  logFilter: LogFilter;
  /**
   * How the bots' cards open their preview. `follow` — the default — means
   * "whatever `cardPreview` says": one choice for the whole table, because a
   * preview gesture is a habit of the hand and having it change depending on
   * whose card you point at is the thing nobody asks for. The other three are
   * a deliberate override for their side only.
   */
  opponentPreview: OpponentPreviewMode;
  /**
   * Whether the stored `opponentPreview` is a choice somebody made, rather
   * than the old default being carried along. See `migrateOpponentPreview`.
   */
  opponentPreviewExplicit: boolean;
  /** Whether newly seated bots cast interaction at you. */
  opponentResistanceDefault: boolean;
  /** Whether bots take their turns automatically on Next Turn. */
  opponentAutoTurns: boolean;
  /** How much of a bot's turn stops and waits for you. See `StackMode`. */
  stackMode: StackMode;
}

interface SettingsActions {
  setBg: (bg: BgChoice) => void;
  setCardSize: (size: BattlefieldCardSize) => void;
  setCardPreview: (mode: CardPreviewMode) => void;
  setAnimations: (v: boolean) => void;
  setSounds: (v: boolean) => void;
  setDotGrid: (v: boolean) => void;
  setLogFilter: (filter: LogFilter) => void;
  toggleLogCategory: (category: LogCategory) => void;
  setOpponentPreview: (mode: OpponentPreviewMode) => void;
  setOpponentResistanceDefault: (v: boolean) => void;
  setOpponentAutoTurns: (v: boolean) => void;
  setStackMode: (mode: StackMode) => void;
}

const defaults: Settings = {
  bg: { kind: 'preset', id: 'arena' },
  cardSize: 'medium',
  cardPreview: 'ctrl',
  animations: true,
  sounds: true,
  dotGrid: true,
  logFilter: ALL_LOG_CATEGORIES_ON,
  opponentPreview: 'follow',
  opponentPreviewExplicit: false,
  opponentResistanceDefault: true,
  opponentAutoTurns: true,
  stackMode: 'targeted',
};

/**
 * How much of a bot's turn stops and waits for you.
 *
 * - `auto` — nothing waits. A spell aimed at you shows on the stack for a beat
 *   and then resolves itself, so the panel is a play-by-play rather than a
 *   decision point.
 * - `targeted` — anything a bot points AT YOU parks until you resolve or
 *   counter it. Their own development runs at speed. The default, and what the
 *   old boolean `stackHold: true` meant.
 * - `everything` — every spell a bot casts parks, including the ones that never
 *   touch your board. This is the mode for playing with counterspells and
 *   instant-speed removal, where the question is not "does this hit me" but "do
 *   I let them have it at all".
 *
 * Land drops are excluded from `everything` on purpose: playing a land is not
 * casting a spell and there is no window to respond to one, so parking on it
 * would be three extra clicks a turn that can never change anything.
 */
export type StackMode = 'auto' | 'targeted' | 'everything';

/** Migrate the boolean this setting used to be. */
function migrateStackMode(raw: unknown, legacyHold: unknown): StackMode {
  if (raw === 'auto' || raw === 'targeted' || raw === 'everything') return raw;
  if (typeof legacyHold === 'boolean') return legacyHold ? 'targeted' : 'auto';
  return defaults.stackMode;
}

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

/**
 * The bots' preview mode used to default to `ctrl` while your own cards were a
 * separate setting, and every setter writes the whole settings object — so a
 * stored `ctrl` is nearly always that default being carried along rather than
 * a decision anybody made, and picking "On hover" for your own cards left the
 * bots' board still asking for a key.
 *
 * So a stored `ctrl` from before the change is read as `follow`. A `ctrl`
 * chosen since is marked and kept: `opponentPreviewExplicit` rides along in
 * the same object and is written by the next save.
 */
function migrateOpponentPreview(parsed: Partial<Settings>): OpponentPreviewMode {
  const stored = parsed.opponentPreview;
  if (!stored) return defaults.opponentPreview;
  if (parsed.opponentPreviewExplicit) return stored;
  return stored === 'ctrl' ? 'follow' : stored;
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
      stackMode: migrateStackMode(parsed.stackMode, (parsed as { stackHold?: unknown }).stackHold),
      opponentPreview: migrateOpponentPreview(parsed),
      // From here on, whatever is in storage was put there deliberately.
      opponentPreviewExplicit: true,
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
  setCardPreview: (cardPreview) => { set({ cardPreview }); save({ ...get(), cardPreview }); },
  setAnimations: (animations) => { set({ animations }); save({ ...get(), animations }); },
  setSounds: (sounds) => { set({ sounds }); save({ ...get(), sounds }); },
  setDotGrid: (dotGrid) => { set({ dotGrid }); save({ ...get(), dotGrid }); },
  setLogFilter: (logFilter) => { set({ logFilter }); save({ ...get(), logFilter }); },
  setOpponentPreview: (opponentPreview) => {
    set({ opponentPreview, opponentPreviewExplicit: true });
    save({ ...get(), opponentPreview, opponentPreviewExplicit: true });
  },
  setOpponentResistanceDefault: (opponentResistanceDefault) => { set({ opponentResistanceDefault }); save({ ...get(), opponentResistanceDefault }); },
  setOpponentAutoTurns: (opponentAutoTurns) => { set({ opponentAutoTurns }); save({ ...get(), opponentAutoTurns }); },
  setStackMode: (stackMode) => { set({ stackMode }); save({ ...get(), stackMode }); },
  toggleLogCategory: (category) => {
    const next: LogFilter = { ...get().logFilter, [category]: !get().logFilter[category] };
    set({ logFilter: next });
    save({ ...get(), logFilter: next });
  },
}));
