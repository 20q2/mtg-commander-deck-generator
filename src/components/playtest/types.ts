import type { ScryfallCard, UserCardList, GeneratedDeck } from '@/types';

export type Phase = 'untap' | 'upkeep' | 'draw' | 'main1' | 'combat' | 'main2' | 'end';

export const PHASES: Phase[] = ['untap', 'upkeep', 'draw', 'main1', 'combat', 'main2', 'end'];

export const PHASE_LABELS: Record<Phase, string> = {
  untap: 'Untap',
  upkeep: 'Upkeep',
  draw: 'Draw',
  main1: 'Main 1',
  combat: 'Combat',
  main2: 'Main 2',
  end: 'End',
};

export type ZoneKey = 'library' | 'hand' | 'graveyard' | 'exile' | 'command';

export interface BattlefieldCard {
  instanceId: string;
  card: ScryfallCard;
  x: number;
  y: number;
  tapped: boolean;
  faceDown: boolean;
  /** For double-faced / transform / MDFC / battle cards: show the back face when true. */
  flipped: boolean;
  /** Free rotation in degrees (multiples of 90), independent of `tapped`. */
  rotation?: number;
  counters: Record<string, number>;
  attachedTo?: string;
}

export type LogCategory = 'move' | 'tap' | 'library' | 'counter' | 'life' | 'turn' | 'system';

export const LOG_CATEGORIES: { key: LogCategory; label: string; chip: string }[] = [
  { key: 'move',    label: 'Movement', chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/40' },
  { key: 'tap',     label: 'Tap',      chip: 'bg-amber-500/15 text-amber-300 border-amber-400/40' },
  { key: 'library', label: 'Library',  chip: 'bg-blue-500/15 text-blue-300 border-blue-400/40' },
  { key: 'counter', label: 'Counters', chip: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-400/40' },
  { key: 'life',    label: 'Life',     chip: 'bg-rose-500/15 text-rose-300 border-rose-400/40' },
  { key: 'turn',    label: 'Turn',     chip: 'bg-purple-500/15 text-purple-300 border-purple-400/40' },
  { key: 'system',  label: 'System',   chip: 'bg-zinc-500/15 text-zinc-300 border-zinc-400/40' },
];

export type CounterColor = 'emerald' | 'red' | 'blue' | 'amber' | 'purple' | 'zinc';

export const COUNTER_COLORS: { key: CounterColor; label: string; chip: string; ring: string }[] = [
  { key: 'emerald', label: 'Green',  chip: 'bg-emerald-600 text-white', ring: 'ring-emerald-300' },
  { key: 'red',     label: 'Red',    chip: 'bg-red-600 text-white',     ring: 'ring-red-300' },
  { key: 'blue',    label: 'Blue',   chip: 'bg-blue-600 text-white',    ring: 'ring-blue-300' },
  { key: 'amber',   label: 'Yellow', chip: 'bg-amber-500 text-black',   ring: 'ring-amber-200' },
  { key: 'purple',  label: 'Purple', chip: 'bg-purple-600 text-white',  ring: 'ring-purple-300' },
  { key: 'zinc',    label: 'Gray',   chip: 'bg-zinc-600 text-white',    ring: 'ring-zinc-300' },
];

export interface FreeCounter {
  id: string;
  x: number;
  y: number;
  value: number;
  color: CounterColor;
}

export type DieSides = 4 | 6 | 8 | 10 | 12 | 20;
export const DIE_SIDES: DieSides[] = [4, 6, 8, 10, 12, 20];

export interface FreeDie {
  id: string;
  x: number;
  y: number;
  sides: DieSides;
  value: number;
  color: CounterColor;
}

export interface LogEntry {
  id: string;
  ts: number;
  text: string;
  category: LogCategory;
  /** Marked true when undo() reverses the action that produced this entry. */
  undone?: boolean;
}

export interface Zones {
  library: ScryfallCard[];
  hand: ScryfallCard[];
  graveyard: ScryfallCard[];
  exile: ScryfallCard[];
  command: ScryfallCard[];
}

export interface PlaytestSnapshot {
  zones: Zones;
  battlefield: BattlefieldCard[];
  life: number;
  turn: number;
  phase: Phase;
}

export type SourceInput =
  | { kind: 'list'; list: UserCardList }
  | { kind: 'generated'; deck: GeneratedDeck };

export interface SourceMeta {
  kind: 'list' | 'generated';
  name: string;
  commanderNames: string[];
}

export type Modal =
  | null
  | { kind: 'scry' | 'mill' | 'surveil'; n: number }
  | { kind: 'zoneViewer'; zone: Exclude<ZoneKey, 'hand'> }
  | { kind: 'tokens' }
  | { kind: 'create' }
  | { kind: 'mulligan'; mulliganCount: number };

export type MoveSource =
  | { kind: 'zone'; zone: ZoneKey; index: number }
  | { kind: 'battlefield'; instanceId: string };

export type MoveTarget =
  | { kind: 'zone'; zone: 'graveyard' | 'exile' | 'hand' | 'command'; index?: number }
  | { kind: 'library'; position: 'top' | 'bottom' | number }
  | { kind: 'battlefield'; x: number; y: number; arrived: boolean }; // arrived=true means apply snap rule

export interface MoveArgs {
  source: MoveSource;
  target: MoveTarget;
}
