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

export interface LogEntry {
  id: string;
  ts: number;
  text: string;
  category: LogCategory;
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
  | { kind: 'search' }
  | { kind: 'scry' | 'mill' | 'surveil'; n: number }
  | { kind: 'zoneViewer'; zone: Exclude<ZoneKey, 'hand'> }
  | { kind: 'tokens' }
  | { kind: 'mulligan'; mulliganCount: number };

export type MoveSource =
  | { kind: 'zone'; zone: ZoneKey; index: number }
  | { kind: 'battlefield'; instanceId: string };

export type MoveTarget =
  | { kind: 'zone'; zone: 'graveyard' | 'exile' | 'hand' | 'command'; index?: number }
  | { kind: 'library'; position: 'top' | 'bottom' }
  | { kind: 'battlefield'; x: number; y: number; arrived: boolean }; // arrived=true means apply snap rule

export interface MoveArgs {
  source: MoveSource;
  target: MoveTarget;
}
