# Playtest Area Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Moxfield-style solitaire goldfish playtest area accessible from the deck view (generated decks via BuilderPage, saved decks via ListDeckView).

**Architecture:** New routes `/playtest/list/:listId` and `/playtest/generated`, served by a new `PlaytestPage`. State lives in a dedicated Zustand store (`playtestStore`) isolated from the main app store. `@dnd-kit/core` powers drag-and-drop. Playtest module lives in `src/components/playtest/`. Free-position battlefield, hand fan, sidebar piles for library/graveyard/exile/command, life/turn/phase tracking, undo (snapshot stack capped at 20), counters, attachments, face-down, copies, tokens, scry/mill/surveil, search library, hotkeys.

**Tech Stack:** React 18, TypeScript, Vite, Zustand 5, React Router 7, Tailwind, shadcn/ui (Popover/Button/Input/Slider), `@dnd-kit/core` (NEW), Lucide icons, `crypto.randomUUID()` for instance IDs.

**Spec:** [docs/superpowers/specs/2026-05-03-playtest-area-design.md](../specs/2026-05-03-playtest-area-design.md)

---

## Verification Convention

The project does not have a unit test framework configured. Per the spec, every task verifies via:

1. `npm run lint` → must be green (no new errors).
2. `npm run build` → must succeed (TypeScript + Vite production build).
3. **Manual smoke** — task-specific behavior to exercise in `npm run dev`.
4. **Commit** with the message shown in the task.

When a task says "Run lint+build" or "Smoke" — do not skip these. They replace the automated test step.

---

## File Structure

**New files:**

```
public/
  card-back.png                                          # generic MTG-styled card back

src/
  pages/
    PlaytestPage.tsx                                     # route entry, hydrates store, mounts <DndContext>
  components/
    playtest/
      types.ts                                           # shared types: BattlefieldCard, Zones, Phase, Modal, etc.
      utils.ts                                           # helpers: makeInstanceId, isLand, isAuraOrEquipment, classifyZone
      PlaytestToolbar.tsx
      PlaytestSidebar.tsx
      Battlefield.tsx
      BattlefieldCard.tsx
      Hand.tsx
      GameLog.tsx
      PlaytestCardMenu.tsx                               # right-click context menu (zone/battlefield variants)
      modals/
        MulliganModal.tsx
        SearchLibraryModal.tsx
        ScryMillSurveilModal.tsx
        ZoneViewerModal.tsx
        TokenSpawnModal.tsx
      hooks/
        useHotkeys.ts
  services/
    playtest/
      libraryBuilder.ts                                  # builds shuffled library + command zone from a source
      tokens.ts                                          # resolves token list for a deck
  store/
    playtestStore.ts                                     # Zustand store, isolated from src/store/index.ts
```

**Files modified:**

```
package.json                                             # adds @dnd-kit/core
.gitignore                                               # already updated by brainstorming step
src/App.tsx                                              # adds two new <Route>s
src/pages/BuilderPage.tsx                                # adds Playtest button to deck toolbar
src/components/lists/ListDeckView.tsx                    # adds Playtest button to deck toolbar
src/data/patchNotes.json                                 # adds release entry
package.json (version bump)
```

---

## Task 1: Foundation — install `@dnd-kit/core`, add card-back asset, scaffold folders

**Files:**
- Modify: `package.json`
- Create: `public/card-back.png`
- Create: `src/components/playtest/.gitkeep`
- Create: `src/components/playtest/modals/.gitkeep`
- Create: `src/components/playtest/hooks/.gitkeep`
- Create: `src/services/playtest/.gitkeep`

- [ ] **Step 1.1: Install `@dnd-kit/core`**

```bash
npm install @dnd-kit/core@^6.3.0
```

Expected: `package.json` and `package-lock.json` updated. No peer-dep warnings (works fine with React 18.3).

- [ ] **Step 1.2: Add a generic card-back image at `public/card-back.png`**

Create or download a generic MTG-style card back image (240×340 PNG recommended). Avoid the trademarked Wizards of the Coast card back. A simple dark-purple abstract is fine — for example, a solid `#2a1f3d` with a centered ⌬ logo, exported from any image editor. The exact art is implementation detail; what matters is that `<img src="/card-back.png">` resolves correctly and looks like a card back.

- [ ] **Step 1.3: Create empty folder placeholders so git tracks the structure**

```bash
mkdir -p src/components/playtest/modals src/components/playtest/hooks src/services/playtest
touch src/components/playtest/.gitkeep src/components/playtest/modals/.gitkeep src/components/playtest/hooks/.gitkeep src/services/playtest/.gitkeep
```

- [ ] **Step 1.4: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: both green. (No source changes to fail on.)

- [ ] **Step 1.5: Commit**

```bash
git add package.json package-lock.json public/card-back.png src/components/playtest src/services/playtest
git commit -m "feat(playtest): scaffold playtest module — add @dnd-kit/core, card-back asset"
```

---

## Task 2: Types module — `src/components/playtest/types.ts`

**Files:**
- Create: `src/components/playtest/types.ts`

- [ ] **Step 2.1: Write `types.ts`**

```ts
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

export interface LogEntry {
  id: string;
  ts: number;
  text: string;
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
  | { kind: 'zone'; zone: 'graveyard' | 'exile' | 'hand' | 'command' }
  | { kind: 'library'; position: 'top' | 'bottom' }
  | { kind: 'battlefield'; x: number; y: number; arrived: boolean }; // arrived=true means apply snap rule

export interface MoveArgs {
  source: MoveSource;
  target: MoveTarget;
}
```

- [ ] **Step 2.2: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: green.

- [ ] **Step 2.3: Commit**

```bash
git add src/components/playtest/types.ts
git commit -m "feat(playtest): add types module"
```

---

## Task 3: Utilities — `src/components/playtest/utils.ts`

**Files:**
- Create: `src/components/playtest/utils.ts`

- [ ] **Step 3.1: Write `utils.ts`**

```ts
import type { ScryfallCard } from '@/types';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';

export function makeInstanceId(): string {
  // crypto.randomUUID is available in modern browsers; the Vite dev server runs on https/localhost.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Fallback (very unlikely path).
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isLand(card: ScryfallCard): boolean {
  return getFrontFaceTypeLine(card).toLowerCase().includes('land');
}

export function isAuraOrEquipment(card: ScryfallCard): boolean {
  const tl = getFrontFaceTypeLine(card).toLowerCase();
  return tl.includes('aura') || tl.includes('equipment');
}

export function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Snap rule for cards arriving on the battlefield from another zone. */
export function snapArrival(
  card: ScryfallCard,
  rawX: number,
  rawY: number,
  containerHeight: number,
  cardHeight = 140,
): { x: number; y: number } {
  const margin = 16;
  const y = isLand(card) ? Math.max(margin, containerHeight - cardHeight - margin) : margin;
  return { x: rawX, y };
}
```

- [ ] **Step 3.2: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: green.

- [ ] **Step 3.3: Commit**

```bash
git add src/components/playtest/utils.ts
git commit -m "feat(playtest): add util helpers"
```

---

## Task 4: Library builder — `src/services/playtest/libraryBuilder.ts`

**Files:**
- Create: `src/services/playtest/libraryBuilder.ts`

- [ ] **Step 4.1: Write `libraryBuilder.ts`**

```ts
import type { ScryfallCard, UserCardList, GeneratedDeck } from '@/types';
import { getCardsByNames } from '@/services/scryfall/client';
import { fisherYates } from '@/components/playtest/utils';
import type { SourceInput, Zones } from '@/components/playtest/types';

export interface BuildResult {
  zones: Zones;
  commanderNames: string[];
  name: string;
  kind: 'list' | 'generated';
}

const EMPTY_ZONES: Zones = { library: [], hand: [], graveyard: [], exile: [], command: [] };

export async function buildLibrary(input: SourceInput): Promise<BuildResult> {
  if (input.kind === 'generated') {
    return buildFromGenerated(input.deck);
  }
  return buildFromList(input.list);
}

function buildFromGenerated(deck: GeneratedDeck): BuildResult {
  const command: ScryfallCard[] = [];
  if (deck.commander) command.push(deck.commander);
  if (deck.partnerCommander) command.push(deck.partnerCommander);

  const all = Object.values(deck.categories).flat();
  // Defensive: if commander somehow leaked into categories, drop it
  const commanderNamesSet = new Set(command.map(c => c.name));
  const libraryPool = all.filter(c => !commanderNamesSet.has(c.name));

  const library = fisherYates(libraryPool);

  return {
    zones: { ...EMPTY_ZONES, library, command },
    commanderNames: command.map(c => c.name),
    name: deck.commander?.name ?? 'Generated Deck',
    kind: 'generated',
  };
}

async function buildFromList(list: UserCardList): Promise<BuildResult> {
  const commanderNames: string[] = [];
  if (list.commanderName) commanderNames.push(list.commanderName);
  if (list.partnerCommanderName) commanderNames.push(list.partnerCommanderName);

  const allNames = Array.from(new Set([...list.cards, ...commanderNames]));
  const cardMap = await getCardsByNames(allNames);

  const command: ScryfallCard[] = [];
  for (const name of commanderNames) {
    const c = cardMap.get(name);
    if (c) command.push(c);
  }

  const commanderSet = new Set(commanderNames);
  // list.cards stores card NAMES with duplicates as repeated entries (no quantity field)
  const libraryPool: ScryfallCard[] = [];
  for (const name of list.cards) {
    if (commanderSet.has(name)) continue; // commanders go to command zone, not library
    const c = cardMap.get(name);
    if (c) libraryPool.push(c);
  }

  const library = fisherYates(libraryPool);

  return {
    zones: { ...EMPTY_ZONES, library, command },
    commanderNames,
    name: list.name,
    kind: 'list',
  };
}
```

- [ ] **Step 4.2: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: green.

- [ ] **Step 4.3: Commit**

```bash
git add src/services/playtest/libraryBuilder.ts
git commit -m "feat(playtest): library builder service"
```

---

## Task 5: Token resolver — `src/services/playtest/tokens.ts`

**Files:**
- Create: `src/services/playtest/tokens.ts`

The Scryfall search for tokens by color identity uses query syntax `is:token id:c` (colorless), `is:token id<=wug` (within color identity), etc. Use the existing `searchCards` or direct `fetch` to Scryfall. The simplest approach is a single `fetch` to `/cards/search` since `searchCards` may not support `is:token` directly.

- [ ] **Step 5.1: Inspect available Scryfall client helpers**

Read `src/services/scryfall/client.ts`. If there's a `searchCards(query)` helper, use it. Otherwise call `https://api.scryfall.com/cards/search?q=...&unique=cards` directly with the same 100ms rate-limit pattern.

- [ ] **Step 5.2: Write `tokens.ts`**

```ts
import type { ScryfallCard } from '@/types';

const SCRYFALL_BASE = 'https://api.scryfall.com';
const tokenCache = new Map<string, ScryfallCard[]>();

/**
 * Resolves a list of Scryfall token cards filterable for the deck's color identity.
 * Returns up to ~60 of the most popular tokens within the color identity.
 *
 * `colorIdentity` is a string like 'WUB' (subset of WUBRG). Empty string means colorless.
 */
export async function resolveTokens(colorIdentity: string): Promise<ScryfallCard[]> {
  const key = colorIdentity.toLowerCase().split('').sort().join('') || 'c';
  if (tokenCache.has(key)) return tokenCache.get(key)!;

  const colorPart = colorIdentity ? `id<=${colorIdentity.toLowerCase()}` : 'id:c';
  const query = `is:token ${colorPart}`;
  const url = `${SCRYFALL_BASE}/cards/search?q=${encodeURIComponent(query)}&unique=cards&order=edhrec`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      tokenCache.set(key, []);
      return [];
    }
    const data = await res.json();
    const cards: ScryfallCard[] = (data.data ?? []).slice(0, 60);
    tokenCache.set(key, cards);
    return cards;
  } catch {
    tokenCache.set(key, []);
    return [];
  }
}

/** Derives a color-identity string ('WUBRG' subset) from the command zone cards. */
export function deriveColorIdentity(commanders: ScryfallCard[]): string {
  const set = new Set<string>();
  for (const c of commanders) {
    for (const ch of c.color_identity ?? []) set.add(ch.toUpperCase());
  }
  return ['W', 'U', 'B', 'R', 'G'].filter(c => set.has(c)).join('');
}
```

- [ ] **Step 5.3: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: green.

- [ ] **Step 5.4: Commit**

```bash
git add src/services/playtest/tokens.ts
git commit -m "feat(playtest): scryfall token resolver"
```

---

## Task 6: Playtest Zustand store — `src/store/playtestStore.ts`

This is the largest single file in the feature. Every UI piece reads/writes through it.

**Files:**
- Create: `src/store/playtestStore.ts`

- [ ] **Step 6.1: Write `playtestStore.ts`**

```ts
import { create } from 'zustand';
import type { ScryfallCard } from '@/types';
import { buildLibrary } from '@/services/playtest/libraryBuilder';
import {
  type BattlefieldCard,
  type LogEntry,
  type Modal,
  type MoveArgs,
  type Phase,
  type PlaytestSnapshot,
  type SourceInput,
  type SourceMeta,
  type Zones,
  type ZoneKey,
  PHASES,
} from '@/components/playtest/types';
import { fisherYates, isLand, makeInstanceId, snapArrival } from '@/components/playtest/utils';

const HISTORY_CAP = 20;
const STARTING_LIFE = 40;

const emptyZones = (): Zones => ({ library: [], hand: [], graveyard: [], exile: [], command: [] });

interface PlaytestState {
  ready: boolean;                                          // false until hydrate completes
  loading: boolean;                                        // true while hydrate is in-flight
  error: string | null;
  source: SourceMeta | null;
  zones: Zones;
  battlefield: BattlefieldCard[];
  life: number;
  turn: number;
  phase: Phase;
  log: LogEntry[];
  history: PlaytestSnapshot[];
  modal: Modal;
  hovered: string | null;
  battlefieldRect: { width: number; height: number };     // updated by Battlefield component on mount/resize
  // Mulligan state machine
  mulliganCount: number;
}

interface PlaytestActions {
  hydrate: (input: SourceInput) => Promise<void>;
  reset: () => void;
  exit: () => void;                                        // clears all state (for unmount)
  setBattlefieldRect: (w: number, h: number) => void;

  dealOpeningHand: () => void;
  draw: (n?: number) => void;
  shuffle: () => void;
  beginMulligan: () => void;                               // shuffle hand back, draw 7, increment mulliganCount, open mulligan modal
  keepHandSendToBottom: (handIndices: number[]) => void;   // resolves the bottom-N step
  keepHand: () => void;                                    // confirms current 7

  untapAll: () => void;
  setLife: (n: number) => void;
  adjustLife: (delta: number) => void;
  setPhase: (phase: Phase) => void;
  advancePhase: () => void;

  moveCard: (args: MoveArgs) => void;
  toggleTap: (instanceId: string) => void;
  toggleFaceDown: (instanceId: string) => void;
  setCounter: (instanceId: string, type: string, value: number) => void;
  adjustCounter: (instanceId: string, type: string, delta: number) => void;
  copyCard: (instanceId: string) => void;
  attach: (childId: string, parentId: string) => void;
  unattach: (instanceId: string) => void;
  spawnToken: (card: ScryfallCard) => void;

  scryConfirm: (decisions: ('top' | 'bottom')[]) => void;
  surveilConfirm: (decisions: ('top' | 'graveyard')[]) => void;
  millConfirm: (n: number) => void;
  searchLibraryTakeToHand: (cardId: string) => void;

  undo: () => void;
  openModal: (modal: Modal) => void;
  closeModal: () => void;
  setHovered: (id: string | null) => void;

  appendLog: (text: string) => void;
}

type Store = PlaytestState & PlaytestActions;

const initial: PlaytestState = {
  ready: false,
  loading: false,
  error: null,
  source: null,
  zones: emptyZones(),
  battlefield: [],
  life: STARTING_LIFE,
  turn: 1,
  phase: 'main1',
  log: [],
  history: [],
  modal: null,
  hovered: null,
  battlefieldRect: { width: 0, height: 0 },
  mulliganCount: 0,
};

function snapshotOf(s: PlaytestState): PlaytestSnapshot {
  return {
    zones: {
      library: [...s.zones.library],
      hand: [...s.zones.hand],
      graveyard: [...s.zones.graveyard],
      exile: [...s.zones.exile],
      command: [...s.zones.command],
    },
    battlefield: s.battlefield.map(b => ({ ...b, counters: { ...b.counters } })),
    life: s.life,
    turn: s.turn,
    phase: s.phase,
  };
}

function pushHistory(history: PlaytestSnapshot[], snap: PlaytestSnapshot): PlaytestSnapshot[] {
  const next = [...history, snap];
  if (next.length > HISTORY_CAP) next.shift();
  return next;
}

function makeLogEntry(text: string): LogEntry {
  return { id: makeInstanceId(), ts: Date.now(), text };
}

export const usePlaytestStore = create<Store>((set, get) => ({
  ...initial,

  // ─────────────────────── lifecycle ───────────────────────

  hydrate: async (input) => {
    set({ loading: true, error: null });
    try {
      const built = await buildLibrary(input);
      set({
        ...initial,
        ready: true,
        loading: false,
        source: { kind: built.kind, name: built.name, commanderNames: built.commanderNames },
        zones: built.zones,
        log: [makeLogEntry(`Loaded "${built.name}" (${built.zones.library.length} cards in library)`)],
      });
      get().dealOpeningHand();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      set({ loading: false, error: msg });
    }
  },

  reset: () => {
    const { source } = get();
    if (!source) return;
    // Re-shuffle current cards (don't re-fetch). Combine all zones + battlefield back into library.
    set(state => {
      const allCards = [
        ...state.zones.library,
        ...state.zones.hand,
        ...state.zones.graveyard,
        ...state.zones.exile,
        ...state.battlefield.map(b => b.card),
      ];
      // Filter tokens (cards that don't appear in commander or original library) — tokens have no place to go.
      // Simpler approach: tokens are typed `Token` in card.type_line — drop them.
      const nonTokens = allCards.filter(c => !c.type_line.toLowerCase().includes('token'));
      const reshuffled = fisherYates(nonTokens);
      return {
        ...initial,
        ready: true,
        loading: false,
        source,
        zones: { ...emptyZones(), library: reshuffled, command: [...state.zones.command] },
        log: [makeLogEntry('Reset')],
      };
    });
    get().dealOpeningHand();
  },

  exit: () => set({ ...initial }),

  setBattlefieldRect: (width, height) => set({ battlefieldRect: { width, height } }),

  // ─────────────────────── mulligan / draw / shuffle ───────────────────────

  dealOpeningHand: () => set(state => {
    const draw = state.zones.library.slice(0, 7);
    const rest = state.zones.library.slice(7);
    return {
      zones: { ...state.zones, hand: draw, library: rest },
      modal: { kind: 'mulligan', mulliganCount: state.mulliganCount },
      log: [...state.log, makeLogEntry(`Drew opening hand (${draw.length})`)],
    };
  }),

  draw: (n = 1) => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const drawn = state.zones.library.slice(0, n);
    if (drawn.length === 0) {
      return { log: [...state.log, makeLogEntry('Library is empty')] };
    }
    return {
      history,
      zones: {
        ...state.zones,
        hand: [...state.zones.hand, ...drawn],
        library: state.zones.library.slice(drawn.length),
      },
      log: [...state.log, makeLogEntry(drawn.length === 1 ? `Drew ${drawn[0].name}` : `Drew ${drawn.length} cards`)],
    };
  }),

  shuffle: () => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    return {
      history,
      zones: { ...state.zones, library: fisherYates(state.zones.library) },
      log: [...state.log, makeLogEntry('Shuffled library')],
    };
  }),

  beginMulligan: () => set(state => {
    // London mulligan: shuffle hand back into library, draw 7, then bottom N at confirmation step.
    const combined = [...state.zones.hand, ...state.zones.library];
    const shuffled = fisherYates(combined);
    const draw = shuffled.slice(0, 7);
    const rest = shuffled.slice(7);
    const newCount = state.mulliganCount + 1;
    return {
      mulliganCount: newCount,
      zones: { ...state.zones, hand: draw, library: rest },
      modal: { kind: 'mulligan', mulliganCount: newCount },
      log: [...state.log, makeLogEntry(`Mulligan to ${Math.max(0, 7 - newCount)} (drew 7)`)],
    };
  }),

  keepHandSendToBottom: (handIndices) => set(state => {
    const indices = new Set(handIndices);
    const sentDown: ScryfallCard[] = [];
    const newHand: ScryfallCard[] = [];
    state.zones.hand.forEach((c, i) => {
      if (indices.has(i)) sentDown.push(c);
      else newHand.push(c);
    });
    return {
      zones: { ...state.zones, hand: newHand, library: [...state.zones.library, ...sentDown] },
      modal: null,
      log: [...state.log, makeLogEntry(`Sent ${sentDown.length} card(s) to bottom of library`)],
    };
  }),

  keepHand: () => set(state => {
    if (state.mulliganCount > 0) {
      // user must pick N to send to bottom — keep the modal open in "bottom-pick" sub-mode
      // Implementation note: the modal's bottom-pick flag is derived from mulliganCount > 0; the modal handles UI.
      return {};
    }
    return {
      modal: null,
      log: [...state.log, makeLogEntry(`Kept opening hand`)],
    };
  }),

  // ─────────────────────── life / turn / phase ───────────────────────

  setLife: (n) => set(state => ({
    history: pushHistory(state.history, snapshotOf(state)),
    life: n,
    log: [...state.log, makeLogEntry(`Life set to ${n}`)],
  })),

  adjustLife: (delta) => set(state => ({
    history: pushHistory(state.history, snapshotOf(state)),
    life: state.life + delta,
    log: [...state.log, makeLogEntry(`${delta >= 0 ? '+' : ''}${delta} life (now ${state.life + delta})`)],
  })),

  setPhase: (phase) => set(state => ({ phase, log: [...state.log, makeLogEntry(`Phase: ${phase}`)] })),

  advancePhase: () => set(state => {
    const idx = PHASES.indexOf(state.phase);
    const nextIdx = (idx + 1) % PHASES.length;
    const wrapped = nextIdx === 0;
    const nextPhase = PHASES[nextIdx];
    const nextTurn = wrapped ? state.turn + 1 : state.turn;
    return {
      phase: nextPhase,
      turn: nextTurn,
      log: [...state.log, makeLogEntry(wrapped ? `Turn ${nextTurn} — ${nextPhase}` : `Phase: ${nextPhase}`)],
    };
  }),

  // ─────────────────────── moveCard (the big one) ───────────────────────

  moveCard: (args) => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const { source, target } = args;
    const next = {
      zones: { ...state.zones,
        library: [...state.zones.library],
        hand: [...state.zones.hand],
        graveyard: [...state.zones.graveyard],
        exile: [...state.zones.exile],
        command: [...state.zones.command],
      },
      battlefield: [...state.battlefield],
      log: [...state.log],
    };

    // 1) extract card from source
    let card: ScryfallCard | null = null;
    let sourceLabel = '';

    if (source.kind === 'zone') {
      const arr = next.zones[source.zone];
      if (source.index < 0 || source.index >= arr.length) return {};
      [card] = arr.splice(source.index, 1);
      sourceLabel = source.zone;
    } else {
      const idx = next.battlefield.findIndex(b => b.instanceId === source.instanceId);
      if (idx === -1) return {};
      const removed = next.battlefield.splice(idx, 1)[0];
      // also detach any children attached to this card → they fall off
      next.battlefield = next.battlefield.map(b =>
        b.attachedTo === removed.instanceId ? { ...b, attachedTo: undefined } : b
      );
      card = removed.card;
      sourceLabel = 'battlefield';
    }
    if (!card) return {};

    // 2) insert into target
    let targetLabel = '';
    if (target.kind === 'zone') {
      next.zones[target.zone].push(card);
      targetLabel = target.zone;
    } else if (target.kind === 'library') {
      if (target.position === 'top') next.zones.library.unshift(card);
      else next.zones.library.push(card);
      targetLabel = `library ${target.position}`;
    } else {
      // battlefield drop
      let { x, y } = target;
      if (target.arrived) {
        const snapped = snapArrival(card, x, y, state.battlefieldRect.height);
        x = snapped.x;
        y = snapped.y;
      }
      next.battlefield.push({
        instanceId: makeInstanceId(),
        card,
        x,
        y,
        tapped: false,
        faceDown: false,
        counters: {},
      });
      targetLabel = 'battlefield';
    }

    next.log.push(makeLogEntry(`${card.name}: ${sourceLabel} → ${targetLabel}`));
    return { ...next, history };
  }),

  // ─────────────────────── battlefield card actions ───────────────────────

  toggleTap: (instanceId) => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const battlefield = state.battlefield.map(b =>
      b.instanceId === instanceId ? { ...b, tapped: !b.tapped } : b
    );
    const target = state.battlefield.find(b => b.instanceId === instanceId);
    return {
      history,
      battlefield,
      log: [...state.log, makeLogEntry(target ? `${target.tapped ? 'Untapped' : 'Tapped'} ${target.card.name}` : '')],
    };
  }),

  toggleFaceDown: (instanceId) => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const battlefield = state.battlefield.map(b =>
      b.instanceId === instanceId ? { ...b, faceDown: !b.faceDown } : b
    );
    const target = state.battlefield.find(b => b.instanceId === instanceId);
    return {
      history,
      battlefield,
      log: [...state.log, makeLogEntry(target ? `Flipped ${target.card.name} ${target.faceDown ? 'face up' : 'face down'}` : '')],
    };
  }),

  setCounter: (instanceId, type, value) => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const battlefield = state.battlefield.map(b => {
      if (b.instanceId !== instanceId) return b;
      const counters = { ...b.counters };
      if (value <= 0) delete counters[type];
      else counters[type] = value;
      return { ...b, counters };
    });
    return { history, battlefield };
  }),

  adjustCounter: (instanceId, type, delta) => {
    const card = get().battlefield.find(b => b.instanceId === instanceId);
    if (!card) return;
    const current = card.counters[type] ?? 0;
    get().setCounter(instanceId, type, current + delta);
    set(state => ({
      log: [...state.log, makeLogEntry(`${delta >= 0 ? '+' : ''}${delta} ${type} on ${card.card.name}`)],
    }));
  },

  copyCard: (instanceId) => set(state => {
    const original = state.battlefield.find(b => b.instanceId === instanceId);
    if (!original) return {};
    const history = pushHistory(state.history, snapshotOf(state));
    const copy: BattlefieldCard = {
      ...original,
      counters: {},
      attachedTo: undefined,
      instanceId: makeInstanceId(),
      x: original.x + 16,
      y: original.y + 16,
      tapped: false,
    };
    return {
      history,
      battlefield: [...state.battlefield, copy],
      log: [...state.log, makeLogEntry(`Created copy of ${original.card.name}`)],
    };
  }),

  attach: (childId, parentId) => set(state => {
    if (childId === parentId) return {};
    const history = pushHistory(state.history, snapshotOf(state));
    const child = state.battlefield.find(b => b.instanceId === childId);
    const parent = state.battlefield.find(b => b.instanceId === parentId);
    if (!child || !parent) return {};
    const battlefield = state.battlefield.map(b =>
      b.instanceId === childId ? { ...b, attachedTo: parentId } : b
    );
    return {
      history,
      battlefield,
      log: [...state.log, makeLogEntry(`Attached ${child.card.name} to ${parent.card.name}`)],
    };
  }),

  unattach: (instanceId) => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const battlefield = state.battlefield.map(b =>
      b.instanceId === instanceId ? { ...b, attachedTo: undefined } : b
    );
    const target = state.battlefield.find(b => b.instanceId === instanceId);
    return {
      history,
      battlefield,
      log: [...state.log, makeLogEntry(target ? `Unattached ${target.card.name}` : '')],
    };
  }),

  spawnToken: (card) => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const cx = Math.floor(state.battlefieldRect.width / 2 - 50);
    const cy = Math.floor(state.battlefieldRect.height / 2 - 70);
    const token: BattlefieldCard = {
      instanceId: makeInstanceId(),
      card,
      x: cx,
      y: cy,
      tapped: false,
      faceDown: false,
      counters: {},
    };
    return {
      history,
      battlefield: [...state.battlefield, token],
      log: [...state.log, makeLogEntry(`Spawned ${card.name} token`)],
    };
  }),

  // ─────────────────────── scry / mill / surveil / search ───────────────────────

  scryConfirm: (decisions) => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const top = state.zones.library.slice(0, decisions.length);
    const rest = state.zones.library.slice(decisions.length);
    const tops: ScryfallCard[] = [];
    const bottoms: ScryfallCard[] = [];
    decisions.forEach((d, i) => {
      if (d === 'top') tops.push(top[i]);
      else bottoms.push(top[i]);
    });
    return {
      history,
      zones: { ...state.zones, library: [...tops, ...rest, ...bottoms] },
      modal: null,
      log: [...state.log, makeLogEntry(`Scry ${decisions.length}: ${tops.length} top, ${bottoms.length} bottom`)],
    };
  }),

  surveilConfirm: (decisions) => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const top = state.zones.library.slice(0, decisions.length);
    const rest = state.zones.library.slice(decisions.length);
    const keepTop: ScryfallCard[] = [];
    const toGrave: ScryfallCard[] = [];
    decisions.forEach((d, i) => {
      if (d === 'top') keepTop.push(top[i]);
      else toGrave.push(top[i]);
    });
    return {
      history,
      zones: {
        ...state.zones,
        library: [...keepTop, ...rest],
        graveyard: [...state.zones.graveyard, ...toGrave],
      },
      modal: null,
      log: [...state.log, makeLogEntry(`Surveil ${decisions.length}: ${keepTop.length} top, ${toGrave.length} graveyard`)],
    };
  }),

  millConfirm: (n) => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const milled = state.zones.library.slice(0, n);
    const rest = state.zones.library.slice(n);
    return {
      history,
      zones: { ...state.zones, library: rest, graveyard: [...state.zones.graveyard, ...milled] },
      modal: null,
      log: [...state.log, makeLogEntry(`Milled ${milled.length} card(s)`)],
    };
  }),

  searchLibraryTakeToHand: (cardId) => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const idx = state.zones.library.findIndex(c => c.id === cardId);
    if (idx === -1) return {};
    const card = state.zones.library[idx];
    const newLib = [...state.zones.library.slice(0, idx), ...state.zones.library.slice(idx + 1)];
    const shuffled = fisherYates(newLib);
    return {
      history,
      zones: { ...state.zones, library: shuffled, hand: [...state.zones.hand, card] },
      modal: null,
      log: [...state.log, makeLogEntry(`Searched library: took ${card.name} (and shuffled)`)],
    };
  }),

  // ─────────────────────── untap / undo / modal ───────────────────────

  untapAll: () => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    return {
      history,
      battlefield: state.battlefield.map(b => ({ ...b, tapped: false })),
      log: [...state.log, makeLogEntry('Untapped all')],
    };
  }),

  undo: () => set(state => {
    if (state.history.length === 0) return {};
    const prev = state.history[state.history.length - 1];
    return {
      history: state.history.slice(0, -1),
      zones: prev.zones,
      battlefield: prev.battlefield,
      life: prev.life,
      turn: prev.turn,
      phase: prev.phase,
      log: [...state.log, makeLogEntry('Undo')],
    };
  }),

  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
  setHovered: (id) => set({ hovered: id }),

  appendLog: (text) => set(state => ({ log: [...state.log, makeLogEntry(text)] })),
}));

// Helper: serializable selector for zone counts (used by Sidebar to avoid re-rendering on every change)
export function zoneCount(s: PlaytestState, zone: ZoneKey): number {
  return s.zones[zone].length;
}
```

- [ ] **Step 6.2: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: green. (TypeScript will catch any signature mismatches.)

- [ ] **Step 6.3: Commit**

```bash
git add src/store/playtestStore.ts
git commit -m "feat(playtest): zustand store with state, actions, undo, modal control"
```

---

## Task 7: Routes + entry buttons + empty `PlaytestPage`

**Files:**
- Create: `src/pages/PlaytestPage.tsx` (minimal stub for now — Task 8 fleshes it out)
- Modify: `src/App.tsx` (add 2 routes; the route does NOT use the `<Layout>` wrapper because playtest uses the full viewport)
- Modify: `src/pages/BuilderPage.tsx` (add Playtest button)
- Modify: `src/components/lists/ListDeckView.tsx` (add Playtest button)

- [ ] **Step 7.1: Create stub `PlaytestPage.tsx`**

```tsx
// src/pages/PlaytestPage.tsx
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '@/store';
import { useUserLists } from '@/hooks/useUserLists';
import { usePlaytestStore } from '@/store/playtestStore';

export function PlaytestPage({ kind }: { kind: 'list' | 'generated' }) {
  const navigate = useNavigate();
  const params = useParams<{ listId: string }>();
  const generatedDeck = useStore(s => s.generatedDeck);
  const { getListById } = useUserLists();
  const hydrate = usePlaytestStore(s => s.hydrate);
  const exit = usePlaytestStore(s => s.exit);
  const ready = usePlaytestStore(s => s.ready);
  const loading = usePlaytestStore(s => s.loading);
  const error = usePlaytestStore(s => s.error);
  const sourceName = usePlaytestStore(s => s.source?.name ?? '');
  const libCount = usePlaytestStore(s => s.zones.library.length);
  const handCount = usePlaytestStore(s => s.zones.hand.length);

  useEffect(() => {
    if (kind === 'generated') {
      if (!generatedDeck) {
        navigate('/');
        return;
      }
      hydrate({ kind: 'generated', deck: generatedDeck });
    } else {
      const list = params.listId ? getListById(params.listId) : null;
      if (!list) {
        navigate('/lists');
        return;
      }
      hydrate({ kind: 'list', list });
    }
    return () => exit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, params.listId]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  if (error) return <div className="min-h-screen flex items-center justify-center text-red-400">Error: {error}</div>;
  if (!ready) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="p-4 text-sm">
        Playtest: <strong>{sourceName}</strong> · Library {libCount} · Hand {handCount}
        <button className="ml-4 underline" onClick={() => navigate(-1)}>Exit</button>
      </div>
      <div className="flex-1 grid place-items-center text-muted-foreground">
        Playtest UI lands in the next tasks.
      </div>
    </div>
  );
}
```

- [ ] **Step 7.2: Add routes in `src/App.tsx`**

Find the `<Routes>` block (around line 405) and add the two playtest routes. They are NOT wrapped in `<Layout>` (no header/footer).

```tsx
// import at top
import { PlaytestPage } from '@/pages/PlaytestPage';
```

```tsx
// inside <Routes> — add after the /lists route
<Route path="/playtest/list/:listId" element={<PlaytestPage kind="list" />} />
<Route path="/playtest/generated" element={<PlaytestPage kind="generated" />} />
```

- [ ] **Step 7.3: Add Playtest button to `BuilderPage`**

Open `src/pages/BuilderPage.tsx`. Locate the toolbar block where the Export button lives (around line 1134, inside `<DeckDisplay toolbarExtra={…}>`). Add a Playtest button just BEFORE the Export button.

```tsx
import { Swords } from 'lucide-react'; // already imported elsewhere — verify; if not, add it
```

In the toolbarExtra JSX (next to the Export button):

```tsx
<Button
  variant="outline"
  size="sm"
  onClick={() => navigate('/playtest/generated')}
  disabled={!generatedDeck}
>
  <Swords className="w-4 h-4 mr-1.5" />
  Playtest
</Button>
```

(Confirm `useNavigate` is already in scope as `navigate` — if not, add `const navigate = useNavigate();` near the top of the component.)

- [ ] **Step 7.4: Add Playtest button to `ListDeckView`**

Open `src/components/lists/ListDeckView.tsx`. Find the toolbar slot where the Export button is rendered (search for `Export` to locate it). Add a Playtest button next to it:

```tsx
<Button
  variant="outline"
  size="sm"
  onClick={() => navigate(`/playtest/list/${list.id}`)}
>
  <Swords className="w-4 h-4 mr-1.5" />
  Playtest
</Button>
```

Ensure `Swords` is imported from `lucide-react` and `useNavigate` is already imported (it is — `import { useNavigate } from 'react-router-dom'`).

- [ ] **Step 7.5: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: green.

- [ ] **Step 7.6: Manual smoke**

Run `npm run dev`. Build a deck, click Playtest → should land on `/playtest/generated` and show `Playtest: <name> · Library 99 · Hand 7 · Exit`. Click Exit → returns to the build page. From `/lists`, open a deck, click Playtest → lands on `/playtest/list/<id>` with the same readout.

- [ ] **Step 7.7: Commit**

```bash
git add src/pages/PlaytestPage.tsx src/App.tsx src/pages/BuilderPage.tsx src/components/lists/ListDeckView.tsx
git commit -m "feat(playtest): routes + entry buttons + page stub"
```

---

## Task 8: PlaytestPage shell layout (no DnD yet)

Replace the stub UI with the real chrome: a top toolbar, left sidebar, central battlefield, bottom hand, right log. All four panels are placeholders for now — they'll be filled in by later tasks.

**Files:**
- Modify: `src/pages/PlaytestPage.tsx`

- [ ] **Step 8.1: Replace `PlaytestPage` UI with chrome layout**

```tsx
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '@/store';
import { useUserLists } from '@/hooks/useUserLists';
import { usePlaytestStore } from '@/store/playtestStore';
import { PlaytestToolbar } from '@/components/playtest/PlaytestToolbar';
import { PlaytestSidebar } from '@/components/playtest/PlaytestSidebar';
import { Battlefield } from '@/components/playtest/Battlefield';
import { Hand } from '@/components/playtest/Hand';
import { GameLog } from '@/components/playtest/GameLog';
import { MulliganModal } from '@/components/playtest/modals/MulliganModal';
import { SearchLibraryModal } from '@/components/playtest/modals/SearchLibraryModal';
import { ScryMillSurveilModal } from '@/components/playtest/modals/ScryMillSurveilModal';
import { ZoneViewerModal } from '@/components/playtest/modals/ZoneViewerModal';
import { TokenSpawnModal } from '@/components/playtest/modals/TokenSpawnModal';

export function PlaytestPage({ kind }: { kind: 'list' | 'generated' }) {
  const navigate = useNavigate();
  const params = useParams<{ listId: string }>();
  const generatedDeck = useStore(s => s.generatedDeck);
  const { getListById } = useUserLists();
  const hydrate = usePlaytestStore(s => s.hydrate);
  const exit = usePlaytestStore(s => s.exit);
  const ready = usePlaytestStore(s => s.ready);
  const loading = usePlaytestStore(s => s.loading);
  const error = usePlaytestStore(s => s.error);
  const modal = usePlaytestStore(s => s.modal);

  useEffect(() => {
    if (kind === 'generated') {
      if (!generatedDeck) { navigate('/'); return; }
      hydrate({ kind: 'generated', deck: generatedDeck });
    } else {
      const list = params.listId ? getListById(params.listId) : null;
      if (!list) { navigate('/lists'); return; }
      hydrate({ kind: 'list', list });
    }
    return () => exit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, params.listId]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  if (error) return <div className="min-h-screen flex items-center justify-center text-red-400">Error: {error}</div>;
  if (!ready) return null;

  return (
    <div className="h-screen w-screen flex flex-col bg-background overflow-hidden">
      <PlaytestToolbar onExit={() => navigate(-1)} />
      <div className="flex-1 flex min-h-0">
        <PlaytestSidebar />
        <main className="flex-1 flex flex-col min-w-0">
          <Battlefield />
          <Hand />
        </main>
        <GameLog />
      </div>
      {modal?.kind === 'mulligan' && <MulliganModal />}
      {modal?.kind === 'search' && <SearchLibraryModal />}
      {(modal?.kind === 'scry' || modal?.kind === 'mill' || modal?.kind === 'surveil') && <ScryMillSurveilModal />}
      {modal?.kind === 'zoneViewer' && <ZoneViewerModal />}
      {modal?.kind === 'tokens' && <TokenSpawnModal />}
    </div>
  );
}
```

- [ ] **Step 8.2: Stub all child components**

Until subsequent tasks fill them in, create minimal stubs so the build passes. **All of the stubs are temporary — they will be replaced in tasks 9–17.**

Create each of the following with this exact content (one component per file):

`src/components/playtest/PlaytestToolbar.tsx`:
```tsx
export function PlaytestToolbar({ onExit }: { onExit: () => void }) {
  return <div className="border-b border-border/50 px-4 py-2 text-sm flex items-center gap-3">
    <button onClick={onExit} className="underline">← Exit</button>
    <span>Playtest</span>
  </div>;
}
```

`src/components/playtest/PlaytestSidebar.tsx`:
```tsx
export function PlaytestSidebar() {
  return <aside className="w-32 border-r border-border/50 p-2 text-xs">Sidebar</aside>;
}
```

`src/components/playtest/Battlefield.tsx`:
```tsx
export function Battlefield() {
  return <div className="flex-1 border-b border-border/50 grid place-items-center text-muted-foreground">Battlefield</div>;
}
```

`src/components/playtest/Hand.tsx`:
```tsx
export function Hand() {
  return <div className="h-44 grid place-items-center text-muted-foreground">Hand</div>;
}
```

`src/components/playtest/GameLog.tsx`:
```tsx
export function GameLog() {
  return <aside className="w-48 border-l border-border/50 p-2 text-xs hidden md:block">Log</aside>;
}
```

`src/components/playtest/modals/MulliganModal.tsx`:
```tsx
export function MulliganModal() { return null; }
```

`src/components/playtest/modals/SearchLibraryModal.tsx`:
```tsx
export function SearchLibraryModal() { return null; }
```

`src/components/playtest/modals/ScryMillSurveilModal.tsx`:
```tsx
export function ScryMillSurveilModal() { return null; }
```

`src/components/playtest/modals/ZoneViewerModal.tsx`:
```tsx
export function ZoneViewerModal() { return null; }
```

`src/components/playtest/modals/TokenSpawnModal.tsx`:
```tsx
export function TokenSpawnModal() { return null; }
```

- [ ] **Step 8.3: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: green.

- [ ] **Step 8.4: Manual smoke**

Run `npm run dev`. Navigate to `/playtest/generated` (after building a deck). Confirm: Toolbar at top, Sidebar left, Battlefield center, Hand bottom, Log right. Layout takes the full viewport. Exit button works.

- [ ] **Step 8.5: Commit**

```bash
git add src/pages/PlaytestPage.tsx src/components/playtest
git commit -m "feat(playtest): page shell with toolbar/sidebar/battlefield/hand/log layout"
```

---

## Task 9: PlaytestSidebar — life total + zone piles

**Files:**
- Modify: `src/components/playtest/PlaytestSidebar.tsx`

- [ ] **Step 9.1: Implement Sidebar**

```tsx
import { useState } from 'react';
import { Plus, Minus, Sparkles, BookOpen, Trash2, Wand2, Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardImageUrl } from '@/services/scryfall/client';
import type { ZoneKey } from '@/components/playtest/types';

interface PileSpec {
  zone: Exclude<ZoneKey, 'hand'>;
  label: string;
  Icon: typeof Crown;
  bgClass: string;
  faceUp: boolean; // library renders face-down
}

const PILES: PileSpec[] = [
  { zone: 'command',   label: 'Command',   Icon: Crown,    bgClass: 'bg-purple-500/10 border-purple-400/30',  faceUp: true },
  { zone: 'library',   label: 'Library',   Icon: BookOpen, bgClass: 'bg-blue-500/10 border-blue-400/30',      faceUp: false },
  { zone: 'graveyard', label: 'Graveyard', Icon: Trash2,   bgClass: 'bg-zinc-500/15 border-zinc-400/30',      faceUp: true },
  { zone: 'exile',     label: 'Exile',     Icon: Sparkles, bgClass: 'bg-amber-500/10 border-amber-400/30',    faceUp: true },
];

export function PlaytestSidebar() {
  const life = usePlaytestStore(s => s.life);
  const adjustLife = usePlaytestStore(s => s.adjustLife);
  const setLife = usePlaytestStore(s => s.setLife);

  return (
    <aside className="w-36 border-r border-border/50 p-3 flex flex-col gap-3 overflow-y-auto bg-card/30">
      <LifePanel life={life} onAdjust={adjustLife} onSet={setLife} />
      {PILES.map(p => <Pile key={p.zone} spec={p} />)}
    </aside>
  );
}

function LifePanel({ life, onAdjust, onSet }: { life: number; onAdjust: (d: number) => void; onSet: (n: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(life));
  return (
    <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-2 text-center">
      <div className="text-[9px] uppercase opacity-60 tracking-wide">Life</div>
      {editing ? (
        <input
          autoFocus
          type="number"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { setEditing(false); const n = parseInt(draft, 10); if (!isNaN(n)) onSet(n); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="w-full text-2xl font-bold bg-transparent text-center outline-none"
        />
      ) : (
        <button className="block w-full text-2xl font-bold" onClick={() => { setDraft(String(life)); setEditing(true); }}>
          {life}
        </button>
      )}
      <div className="grid grid-cols-2 gap-1 mt-1">
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onAdjust(-1)}><Minus className="w-3 h-3" />1</Button>
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onAdjust(1)}><Plus className="w-3 h-3" />1</Button>
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onAdjust(-5)}><Minus className="w-3 h-3" />5</Button>
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onAdjust(5)}><Plus className="w-3 h-3" />5</Button>
      </div>
    </div>
  );
}

function Pile({ spec }: { spec: PileSpec }) {
  const cards = usePlaytestStore(s => s.zones[spec.zone]);
  const openModal = usePlaytestStore(s => s.openModal);
  const top = cards[0];
  const Icon = spec.Icon;
  const onClick = () => openModal({ kind: 'zoneViewer', zone: spec.zone });

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-lg border ${spec.bgClass} p-2 text-center hover:brightness-125 transition-all`}
    >
      <div className="aspect-[5/7] w-full rounded-md overflow-hidden bg-black/20 flex items-center justify-center">
        {top && spec.faceUp
          ? <img src={getCardImageUrl(top, 'small')} alt={top.name} className="w-full h-full object-cover" />
          : <Icon className="w-6 h-6 opacity-60" />}
      </div>
      <div className="mt-1 text-[10px] flex items-center justify-between">
        <span>{spec.label}</span>
        <span className="font-bold">{cards.length}</span>
      </div>
    </button>
  );
}
```

- [ ] **Step 9.2: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: green.

- [ ] **Step 9.3: Manual smoke**

Run dev, enter playtest. Confirm: life shows 40, ±1/±5 buttons adjust life, clicking the number lets you type a value. The four piles render (command top card visible, library face-down icon, graveyard/exile empty icon). Clicking a pile triggers `openModal` (no UI yet — modal will be Task 16).

- [ ] **Step 9.4: Commit**

```bash
git add src/components/playtest/PlaytestSidebar.tsx
git commit -m "feat(playtest): sidebar with life panel and zone piles"
```

---

## Task 10: Hand component (drag-aware, no DnD context yet)

The Hand renders a fan of cards. For this task, build the visual + click-to-preview behavior. The drag wiring is added in Task 13 once `<DndContext>` is mounted on the page.

**Files:**
- Modify: `src/components/playtest/Hand.tsx`

- [ ] **Step 10.1: Implement Hand**

```tsx
import { useRef, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { ChevronDown } from 'lucide-react';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardImageUrl, getFrontFaceTypeLine } from '@/services/scryfall/client';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import type { ScryfallCard } from '@/types';

type SortMode = 'none' | 'cmc' | 'type';

export function Hand() {
  const hand = usePlaytestStore(s => s.zones.hand);
  const [sort, setSort] = useState<SortMode>('none');
  const [preview, setPreview] = useState<ScryfallCard | null>(null);

  const display = sortedHand(hand, sort);

  return (
    <div className="border-t border-border/50 bg-card/30 px-4 py-3 flex flex-col">
      <div className="flex items-center justify-between mb-2 text-[10px] uppercase opacity-60">
        <span>Hand · {hand.length}</span>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortMode)}
          className="bg-transparent border border-border/50 rounded px-1.5 py-0.5"
        >
          <option value="none">None</option>
          <option value="cmc">CMC</option>
          <option value="type">Type</option>
        </select>
      </div>
      <div className="flex justify-center min-h-[160px]">
        <div className="flex items-end">
          {display.map(({ card, originalIndex }, i) => (
            <HandCard
              key={`${card.id}-${originalIndex}`}
              card={card}
              indexInHand={originalIndex}
              fanIndex={i}
              total={display.length}
              onClickPreview={() => setPreview(card)}
            />
          ))}
        </div>
      </div>
      <CardPreviewModal card={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function sortedHand(hand: ScryfallCard[], mode: SortMode) {
  const indexed = hand.map((card, originalIndex) => ({ card, originalIndex }));
  if (mode === 'cmc') indexed.sort((a, b) => a.card.cmc - b.card.cmc);
  else if (mode === 'type') indexed.sort((a, b) => getFrontFaceTypeLine(a.card).localeCompare(getFrontFaceTypeLine(b.card)));
  return indexed;
}

interface HandCardProps {
  card: ScryfallCard;
  indexInHand: number;     // index in the underlying zones.hand array (used by drag payload)
  fanIndex: number;
  total: number;
  onClickPreview: () => void;
}

function HandCard({ card, indexInHand, fanIndex, total, onClickPreview }: HandCardProps) {
  const dragId = `hand:${indexInHand}:${card.id}`;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: dragId,
    data: { source: { kind: 'zone', zone: 'hand', index: indexInHand } },
  });

  // Suppress click when a drag actually moved the pointer
  const movedRef = useRef(false);
  const overlap = total <= 7 ? 24 : Math.min(24 + (total - 7) * 6, 88);
  const style: React.CSSProperties = {
    marginLeft: fanIndex === 0 ? 0 : `-${overlap}px`,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0) scale(1.05)` : undefined,
    zIndex: isDragging ? 50 : fanIndex,
    transition: isDragging ? 'none' : 'transform 200ms ease',
    width: 'clamp(80px, 11vw, 130px)',
    cursor: isDragging ? 'grabbing' : 'grab',
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onPointerDown={() => { movedRef.current = false; }}
      onPointerMove={() => { movedRef.current = true; }}
      onClick={() => { if (!movedRef.current) onClickPreview(); }}
      className={`relative shrink-0 rounded-lg select-none touch-none transition-transform ${
        isDragging ? '' : 'hover:-translate-y-2 hover:z-20'
      }`}
      style={style}
    >
      <img
        src={getCardImageUrl(card, 'normal')}
        alt={card.name}
        className="w-full rounded-lg shadow-md pointer-events-none"
        loading="lazy"
        draggable={false}
      />
    </div>
  );
}
```

- [ ] **Step 10.2: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: green. **Note:** `useDraggable` is imported but won't actually do anything visually until `<DndContext>` is mounted — that's Task 13. The hooks gracefully no-op in that state (the dnd-kit lib documents this).

- [ ] **Step 10.3: Manual smoke**

Enter playtest. Hand fan renders 7 cards. Click a card → CardPreviewModal opens. Sort dropdown works. **Drag is non-functional** (expected — no DndContext yet).

- [ ] **Step 10.4: Commit**

```bash
git add src/components/playtest/Hand.tsx
git commit -m "feat(playtest): hand fan with sort + preview (drag wiring deferred)"
```

---

## Task 11: Battlefield + BattlefieldCard (no DnD; tap, counters, face-down)

**Files:**
- Modify: `src/components/playtest/Battlefield.tsx`
- Create: `src/components/playtest/BattlefieldCard.tsx`

- [ ] **Step 11.1: Implement Battlefield**

```tsx
// src/components/playtest/Battlefield.tsx
import { useEffect, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { usePlaytestStore } from '@/store/playtestStore';
import { BattlefieldCard } from '@/components/playtest/BattlefieldCard';

export function Battlefield() {
  const cards = usePlaytestStore(s => s.battlefield);
  const setRect = usePlaytestStore(s => s.setBattlefieldRect);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track size for arrival snap
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setRect(r.width, r.height);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [setRect]);

  const { setNodeRef, isOver } = useDroppable({ id: 'battlefield', data: { kind: 'battlefield' } });
  const composedRef = (node: HTMLDivElement | null) => {
    containerRef.current = node;
    setNodeRef(node);
  };

  // Render parents first, attached children after parents (z-order)
  const sorted = [...cards].sort((a, b) => {
    if (!a.attachedTo && b.attachedTo) return -1;
    if (a.attachedTo && !b.attachedTo) return 1;
    return 0;
  });

  return (
    <div
      ref={composedRef}
      className={`flex-1 relative border-b border-border/50 bg-radial-fade overflow-hidden ${isOver ? 'ring-2 ring-primary/40 ring-inset' : ''}`}
      style={{ background: 'radial-gradient(ellipse at center, rgba(40,60,100,0.12), transparent 70%)' }}
    >
      {sorted.map(b => <BattlefieldCard key={b.instanceId} card={b} />)}
    </div>
  );
}
```

- [ ] **Step 11.2: Implement BattlefieldCard**

```tsx
// src/components/playtest/BattlefieldCard.tsx
import { useDraggable } from '@dnd-kit/core';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardImageUrl } from '@/services/scryfall/client';
import type { BattlefieldCard as BfCard } from '@/components/playtest/types';

const COUNTER_COLOR: Record<string, string> = {
  '+1/+1': 'bg-emerald-500/80 text-white',
  '-1/-1': 'bg-red-500/80 text-white',
  loyalty: 'bg-blue-500/80 text-white',
  charge: 'bg-yellow-500/80 text-black',
  storage: 'bg-zinc-500/80 text-white',
};

export function BattlefieldCard({ card }: { card: BfCard }) {
  const toggleTap = usePlaytestStore(s => s.toggleTap);
  const adjustCounter = usePlaytestStore(s => s.adjustCounter);
  const setHovered = usePlaytestStore(s => s.setHovered);
  const battlefield = usePlaytestStore(s => s.battlefield);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `bf:${card.instanceId}`,
    data: { source: { kind: 'battlefield', instanceId: card.instanceId } },
  });

  // Compute attachment offset: how many cards are attached above us in the stack?
  let yOffset = 0;
  if (card.attachedTo) {
    const parent = battlefield.find(b => b.instanceId === card.attachedTo);
    if (parent) {
      const siblings = battlefield.filter(b => b.attachedTo === card.attachedTo);
      const myIdx = siblings.findIndex(b => b.instanceId === card.instanceId);
      yOffset = (myIdx + 1) * 28;
      return (
        <PositionedCard
          ref={setNodeRef}
          attributes={attributes}
          listeners={listeners}
          card={card}
          xPx={parent.x + (myIdx + 1) * 8}
          yPx={parent.y + yOffset}
          transform={transform}
          isDragging={isDragging}
          onTap={() => toggleTap(card.instanceId)}
          onAdjust={(t, d) => adjustCounter(card.instanceId, t, d)}
          onHover={(v) => setHovered(v ? card.instanceId : null)}
        />
      );
    }
  }

  return (
    <PositionedCard
      ref={setNodeRef}
      attributes={attributes}
      listeners={listeners}
      card={card}
      xPx={card.x}
      yPx={card.y}
      transform={transform}
      isDragging={isDragging}
      onTap={() => toggleTap(card.instanceId)}
      onAdjust={(t, d) => adjustCounter(card.instanceId, t, d)}
      onHover={(v) => setHovered(v ? card.instanceId : null)}
    />
  );
}

interface PositionedProps {
  card: BfCard;
  xPx: number;
  yPx: number;
  transform: { x: number; y: number } | null;
  isDragging: boolean;
  attributes: Record<string, unknown>;
  listeners: Record<string, unknown> | undefined;
  onTap: () => void;
  onAdjust: (type: string, delta: number) => void;
  onHover: (v: boolean) => void;
}

const PositionedCard = (() => {
  const Component = (
    { card, xPx, yPx, transform, isDragging, attributes, listeners, onTap, onAdjust, onHover }: PositionedProps,
    ref: React.Ref<HTMLDivElement>
  ) => {
    const cardWidth = 100;
    const counterEntries = Object.entries(card.counters).filter(([, v]) => v > 0);
    const tx = transform?.x ?? 0;
    const ty = transform?.y ?? 0;

    const movedRef = { current: false };

    return (
      <div
        ref={ref}
        {...attributes}
        {...(listeners as Record<string, unknown>)}
        onPointerDown={() => { movedRef.current = false; }}
        onPointerMove={() => { movedRef.current = true; }}
        onClick={(e) => { e.stopPropagation(); if (!movedRef.current) onTap(); }}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        className={`absolute select-none touch-none ${isDragging ? 'opacity-80 z-50' : 'z-10'}`}
        style={{
          left: xPx,
          top: yPx,
          transform: `translate3d(${tx}px, ${ty}px, 0)`,
          width: cardWidth,
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
      >
        <div
          className="relative w-full"
          style={{ transform: card.tapped ? 'rotate(90deg)' : undefined, transformOrigin: 'center', transition: 'transform 150ms ease' }}
        >
          <img
            src={card.faceDown ? '/card-back.png' : getCardImageUrl(card.card, 'normal')}
            alt={card.faceDown ? 'Face-down' : card.card.name}
            className="w-full rounded-md shadow-lg pointer-events-none"
            draggable={false}
          />
          {/* Counter chips, counter-rotated to stay upright when card is tapped */}
          {counterEntries.length > 0 && (
            <div
              className="absolute bottom-1 left-0 right-0 flex flex-wrap justify-center gap-1 pointer-events-auto"
              style={{ transform: card.tapped ? 'rotate(-90deg)' : undefined }}
            >
              {counterEntries.map(([type, n]) => (
                <button
                  key={type}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.altKey) onAdjust(type, -n);              // remove all
                    else if (e.shiftKey) onAdjust(type, -1);
                    else onAdjust(type, 1);
                  }}
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${COUNTER_COLOR[type] ?? 'bg-zinc-600/80 text-white'}`}
                  title={`${type} (click +1, shift -1, alt remove)`}
                >
                  {n} {type}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };
  return Object.assign(Component, { displayName: 'PositionedCard' }) as unknown as
    React.ForwardRefExoticComponent<PositionedProps & React.RefAttributes<HTMLDivElement>>;
})();
```

**Note on the `PositionedCard` definition:** The IIFE is awkward; cleaner alternative for the implementer is to use `React.forwardRef` directly:

```tsx
const PositionedCard = React.forwardRef<HTMLDivElement, PositionedProps>(function PositionedCard(props, ref) { /* same body */ });
```

Use the `forwardRef` form. The IIFE was just to keep the listing inline.

- [ ] **Step 11.3: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: green.

- [ ] **Step 11.4: Manual smoke**

Enter playtest. Battlefield is empty initially (good — cards arrive in Task 13). For now, manually trigger a state change in the browser console:

```js
// In DevTools:
const s = window.__playtest = (await import('/src/store/playtestStore.ts')).usePlaytestStore.getState();
s.spawnToken({ id:'t1', name:'Test', cmc:1, type_line:'Creature', color_identity:[], rarity:'common', set:'tst', set_name:'Test', keywords:[], legalities:{commander:'legal'}, prices:{} });
```

(Or skip this — Battlefield will get cards via DnD in Task 13. This task only verifies it builds and renders the empty container with the radial gradient.)

- [ ] **Step 11.5: Commit**

```bash
git add src/components/playtest/Battlefield.tsx src/components/playtest/BattlefieldCard.tsx
git commit -m "feat(playtest): battlefield container + battlefield card with tap/counters/face-down"
```

---

## Task 12: PlaytestToolbar — full action bar

**Files:**
- Modify: `src/components/playtest/PlaytestToolbar.tsx`

- [ ] **Step 12.1: Implement Toolbar**

```tsx
import { useState } from 'react';
import { Hand as HandIcon, Shuffle, RotateCcw, ChevronsRight, Search, Eye, Sparkles, Plus, Undo2, RefreshCw, X, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { usePlaytestStore } from '@/store/playtestStore';
import { PHASE_LABELS } from '@/components/playtest/types';

export function PlaytestToolbar({ onExit }: { onExit: () => void }) {
  const sourceName = usePlaytestStore(s => s.source?.name ?? '');
  const turn = usePlaytestStore(s => s.turn);
  const phase = usePlaytestStore(s => s.phase);
  const advancePhase = usePlaytestStore(s => s.advancePhase);
  const draw = usePlaytestStore(s => s.draw);
  const untapAll = usePlaytestStore(s => s.untapAll);
  const shuffle = usePlaytestStore(s => s.shuffle);
  const beginMulligan = usePlaytestStore(s => s.beginMulligan);
  const undo = usePlaytestStore(s => s.undo);
  const reset = usePlaytestStore(s => s.reset);
  const openModal = usePlaytestStore(s => s.openModal);
  const historyLen = usePlaytestStore(s => s.history.length);

  const [scryN, setScryN] = useState(1);

  return (
    <div className="border-b border-border/50 bg-card/50 backdrop-blur px-4 py-2 flex items-center gap-2 text-sm flex-wrap">
      <Button variant="ghost" size="sm" onClick={onExit}><X className="w-4 h-4 mr-1" />Exit</Button>
      <span className="text-muted-foreground/60">|</span>
      <span className="font-semibold">{sourceName}</span>
      <span className="text-muted-foreground/60">·</span>
      <button
        onClick={advancePhase}
        className="px-2 py-0.5 rounded bg-accent/40 hover:bg-accent text-xs font-medium"
        title="Advance phase"
      >
        {PHASE_LABELS[phase]}
      </button>
      <span className="text-xs opacity-60">Turn {turn}</span>

      <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
        <Button variant="outline" size="sm" onClick={() => draw(1)}><Plus className="w-3.5 h-3.5 mr-1" />Draw</Button>
        <Button variant="outline" size="sm" onClick={untapAll}><RotateCcw className="w-3.5 h-3.5 mr-1" />Untap</Button>
        <Button variant="outline" size="sm" onClick={shuffle}><Shuffle className="w-3.5 h-3.5 mr-1" />Shuffle</Button>
        <Button variant="outline" size="sm" onClick={beginMulligan}><HandIcon className="w-3.5 h-3.5 mr-1" />Mulligan</Button>
        <Button variant="outline" size="sm" onClick={() => openModal({ kind: 'search' })}><Search className="w-3.5 h-3.5 mr-1" />Search</Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm"><Eye className="w-3.5 h-3.5 mr-1" />Scry/Mill/Surveil</Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-44 p-2 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs">N:</span>
              <input type="number" min={1} max={20} value={scryN} onChange={e => setScryN(Math.max(1, parseInt(e.target.value, 10) || 1))} className="w-12 bg-transparent border border-border/50 rounded px-1 py-0.5 text-xs" />
            </div>
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => openModal({ kind: 'scry', n: scryN })}>Scry {scryN}</Button>
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => openModal({ kind: 'mill', n: scryN })}>Mill {scryN}</Button>
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => openModal({ kind: 'surveil', n: scryN })}>Surveil {scryN}</Button>
          </PopoverContent>
        </Popover>
        <Button variant="outline" size="sm" onClick={() => openModal({ kind: 'tokens' })}><Sparkles className="w-3.5 h-3.5 mr-1" />Tokens</Button>
        <Button variant="ghost" size="sm" disabled={historyLen === 0} onClick={undo}><Undo2 className="w-3.5 h-3.5 mr-1" />Undo</Button>
        <Button variant="ghost" size="sm" onClick={reset}><RefreshCw className="w-3.5 h-3.5 mr-1" />Reset</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 12.2: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: green.

- [ ] **Step 12.3: Manual smoke**

Enter playtest. Toolbar shows: Exit, deck name, phase pill, Turn 1, then action buttons. Click Draw → log entry appears (will see in Task 18 once GameLog is real, but library count in sidebar should decrement, hand count increments). Click Untap, Shuffle. Click Mulligan → modal flag set (no UI yet — Task 14). Click phase pill to advance.

- [ ] **Step 12.4: Commit**

```bash
git add src/components/playtest/PlaytestToolbar.tsx
git commit -m "feat(playtest): toolbar with all action buttons"
```

---

## Task 13: DnD wiring — `<DndContext>`, sensors, onDragEnd routing

This task connects the existing `useDraggable`/`useDroppable` calls in Hand and Battlefield/Sidebar so dragging actually moves cards.

**Files:**
- Modify: `src/pages/PlaytestPage.tsx` (wrap content in `<DndContext>`, handle `onDragEnd`)
- Modify: `src/components/playtest/PlaytestSidebar.tsx` (make piles droppable)
- Modify: `src/components/playtest/BattlefieldCard.tsx` (make each card a nested droppable for attachment)

- [ ] **Step 13.1: Wrap PlaytestPage content with `<DndContext>`**

Add to top of file:

```tsx
import { DndContext, PointerSensor, KeyboardSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
```

Inside `PlaytestPage`, after the `useEffect`:

```tsx
const moveCard = usePlaytestStore(s => s.moveCard);
const attach = usePlaytestStore(s => s.attach);

const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  useSensor(TouchSensor,   { activationConstraint: { delay: 120, tolerance: 5 } }),
  useSensor(KeyboardSensor),
);

function onDragEnd(event: DragEndEvent) {
  const { active, over } = event;
  if (!over) return;
  const sourceData = active.data.current as { source?: { kind: string; zone?: string; index?: number; instanceId?: string } } | undefined;
  const overData   = over.data.current   as { kind?: string; zone?: string; position?: 'top' | 'bottom'; instanceId?: string } | undefined;
  const source = sourceData?.source;
  if (!source) return;

  // Attachment: dropped onto a battlefield card?
  if (overData?.kind === 'battlefield-card' && overData.instanceId) {
    if (source.kind === 'battlefield' && source.instanceId) {
      attach(source.instanceId, overData.instanceId);
      return;
    }
    // From hand → battlefield + auto-attach
    if (source.kind === 'zone' && source.zone === 'hand' && typeof source.index === 'number') {
      // First put it on the battlefield, then attach. We need the new instanceId, so we move + then read store.
      // Simpler: drop normally; the user can drag-attach in a second step.
      moveCard({ source: source as any, target: { kind: 'battlefield', x: 0, y: 0, arrived: true } });
      return;
    }
  }

  // Battlefield container: position drop
  if (over.id === 'battlefield' && overData?.kind === 'battlefield') {
    const rect = (over.rect as DOMRect | undefined);
    const x = (active.rect.current.translated?.left ?? 0) - (rect?.left ?? 0);
    const y = (active.rect.current.translated?.top  ?? 0) - (rect?.top  ?? 0);
    if (source.kind === 'battlefield' && source.instanceId) {
      // Reposition existing battlefield card — bypass moveCard (no zone change)
      const repositionBattlefield = usePlaytestStore.getState().battlefield;
      const updated = repositionBattlefield.map(b =>
        b.instanceId === source.instanceId ? { ...b, x, y } : b
      );
      usePlaytestStore.setState(state => ({
        history: [...state.history, { zones: state.zones, battlefield: state.battlefield, life: state.life, turn: state.turn, phase: state.phase }].slice(-20),
        battlefield: updated,
      }));
    } else {
      moveCard({ source: source as any, target: { kind: 'battlefield', x, y, arrived: true } });
    }
    return;
  }

  // Sidebar pile drops
  if (overData?.kind === 'pile' && overData.zone) {
    const zone = overData.zone as 'graveyard' | 'exile' | 'hand' | 'command';
    if (zone === 'hand') moveCard({ source: source as any, target: { kind: 'zone', zone: 'hand' } });
    else moveCard({ source: source as any, target: { kind: 'zone', zone } });
    return;
  }

  // Library top/bottom
  if (overData?.kind === 'library' && overData.position) {
    moveCard({ source: source as any, target: { kind: 'library', position: overData.position } });
    return;
  }
}
```

Wrap the layout JSX:

```tsx
<DndContext sensors={sensors} onDragEnd={onDragEnd}>
  {/* existing layout */}
</DndContext>
```

- [ ] **Step 13.2: Make sidebar piles droppable**

In `PlaytestSidebar.tsx`, wrap each `<Pile>` with `useDroppable`. Update `Pile` to:

```tsx
import { useDroppable } from '@dnd-kit/core';

function Pile({ spec }: { spec: PileSpec }) {
  const cards = usePlaytestStore(s => s.zones[spec.zone]);
  const openModal = usePlaytestStore(s => s.openModal);
  const { setNodeRef, isOver } = useDroppable({
    id: `pile:${spec.zone}`,
    data: { kind: 'pile', zone: spec.zone },
  });
  const top = cards[0];
  const Icon = spec.Icon;
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => openModal({ kind: 'zoneViewer', zone: spec.zone })}
      className={`relative rounded-lg border ${spec.bgClass} p-2 text-center hover:brightness-125 transition-all ${isOver ? 'ring-2 ring-primary' : ''}`}
    >
      {/* … unchanged inner content … */}
    </button>
  );
}
```

- [ ] **Step 13.3: Make BattlefieldCard a droppable for attachment**

In `BattlefieldCard.tsx`, the `PositionedCard` component should expose a nested droppable so other cards can be attached to it. Adjust the wrapper so the outer `div` is the draggable; add a sibling droppable `div` overlaid on top via `useDroppable`. Simplest: inside `PositionedCard`, attach a separate droppable ref to a transparent overlay element.

Replace the `<div>` content with:

```tsx
import { useDroppable } from '@dnd-kit/core';
// ...
const dropTarget = useDroppable({
  id: `bf-card:${card.instanceId}`,
  data: { kind: 'battlefield-card', instanceId: card.instanceId },
});
// inside the JSX, add as a child overlay:
<div ref={dropTarget.setNodeRef} className={`absolute inset-0 pointer-events-none ${dropTarget.isOver ? 'ring-2 ring-emerald-400 rounded-md' : ''}`} />
```

Note: the droppable should remain "interceptable" by dnd-kit. `pointer-events-none` is fine — dnd-kit uses its own collision detection that doesn't rely on pointer-events.

- [ ] **Step 13.4: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: green.

- [ ] **Step 13.5: Manual smoke**

Enter playtest. Drag a card from hand to the battlefield → it appears at the drop position with the arrival snap (lands snap to bottom band, others to top). Drag a battlefield card → it repositions. Drag a hand card to the graveyard pile → it moves to graveyard and the count updates. Drag a battlefield aura/equipment onto a creature → it attaches (visually nested below the parent).

- [ ] **Step 13.6: Commit**

```bash
git add src/pages/PlaytestPage.tsx src/components/playtest/PlaytestSidebar.tsx src/components/playtest/BattlefieldCard.tsx
git commit -m "feat(playtest): wire @dnd-kit — hand→battlefield, repositioning, pile drops, attachment"
```

---

## Task 14: MulliganModal

**Files:**
- Modify: `src/components/playtest/modals/MulliganModal.tsx`

- [ ] **Step 14.1: Implement Mulligan flow**

```tsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardImageUrl } from '@/services/scryfall/client';

export function MulliganModal() {
  const hand = usePlaytestStore(s => s.zones.hand);
  const mulliganCount = usePlaytestStore(s => s.mulliganCount);
  const beginMulligan = usePlaytestStore(s => s.beginMulligan);
  const keepHandSendToBottom = usePlaytestStore(s => s.keepHandSendToBottom);
  const closeModal = usePlaytestStore(s => s.closeModal);

  // Sub-mode: choosing the bottom-N cards
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const handSize = Math.max(0, 7 - mulliganCount);
  const toBottomCount = Math.min(mulliganCount, hand.length);

  useEffect(() => { setPicked(new Set()); }, [picking]);

  const togglePick = (i: number) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else if (next.size < toBottomCount) next.add(i);
      return next;
    });
  };

  const confirmKeep = () => {
    if (toBottomCount === 0) {
      closeModal();
      return;
    }
    setPicking(true);
  };

  const confirmBottom = () => {
    keepHandSendToBottom(Array.from(picked));
    setPicking(false);
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-background/85 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-card border border-border rounded-lg shadow-2xl max-w-4xl w-full p-6">
        <h2 className="text-lg font-semibold mb-1">
          {picking ? `Send ${toBottomCount - picked.size} more to bottom` : `Opening hand · keeping ${handSize}`}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {picking
            ? `Click cards to mark them for the bottom of the library.`
            : mulliganCount === 0
              ? 'Mulligan is free this time.'
              : `London mulligan: ${mulliganCount} card(s) will go to the bottom of the library if you keep.`}
        </p>
        <div className="grid grid-cols-7 gap-2 mb-5">
          {hand.map((card, i) => {
            const sel = picked.has(i);
            return (
              <button
                key={`${card.id}-${i}`}
                onClick={() => picking && togglePick(i)}
                className={`relative rounded transition-all ${picking ? 'cursor-pointer' : 'cursor-default'} ${sel ? 'ring-4 ring-amber-400' : ''}`}
              >
                <img src={getCardImageUrl(card, 'normal')} alt={card.name} className="w-full rounded shadow" />
                {sel && <span className="absolute top-1 right-1 bg-amber-500 text-black text-[10px] font-bold px-1.5 py-0.5 rounded">↓ bottom</span>}
              </button>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          {!picking ? (
            <>
              <Button variant="outline" onClick={beginMulligan}>Mulligan again</Button>
              <Button onClick={confirmKeep}>Keep this hand</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setPicking(false)}>Back</Button>
              <Button onClick={confirmBottom} disabled={picked.size !== toBottomCount}>Send to bottom</Button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 14.2: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: green.

- [ ] **Step 14.3: Manual smoke**

Enter playtest. The MulliganModal opens automatically with the 7-card opening hand. Click "Keep this hand" → modal closes (mulliganCount is 0, no bottom-pick needed). Restart deck (Reset), trigger mulligan from toolbar → opens the modal again with mulliganCount=1. Click "Mulligan again" → 7 new cards. Click "Keep" → bottom-pick mode: select 1 card → "Send to bottom" → modal closes, library count went up by 1.

- [ ] **Step 14.4: Commit**

```bash
git add src/components/playtest/modals/MulliganModal.tsx
git commit -m "feat(playtest): mulligan modal with London bottom-pick"
```

---

## Task 15: SearchLibraryModal

**Files:**
- Modify: `src/components/playtest/modals/SearchLibraryModal.tsx`

- [ ] **Step 15.1: Implement Search Library**

```tsx
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardImageUrl } from '@/services/scryfall/client';

export function SearchLibraryModal() {
  const library = usePlaytestStore(s => s.zones.library);
  const closeModal = usePlaytestStore(s => s.closeModal);
  const searchLibraryTakeToHand = usePlaytestStore(s => s.searchLibraryTakeToHand);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    if (!needle) return library;
    return library.filter(c =>
      c.name.toLowerCase().includes(needle) ||
      c.type_line.toLowerCase().includes(needle),
    );
  }, [library, q]);

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-background/90 backdrop-blur-sm flex flex-col p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Search Library ({filtered.length} of {library.length})</h2>
        <Button variant="ghost" size="icon" onClick={closeModal}><X className="w-4 h-4" /></Button>
      </div>
      <Input autoFocus placeholder="Search by name or type…" value={q} onChange={e => setQ(e.target.value)} className="mb-4" />
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
          {filtered.map(card => (
            <button
              key={card.id}
              onClick={() => searchLibraryTakeToHand(card.id)}
              className="rounded transition-all hover:ring-2 hover:ring-primary"
              title={`Take ${card.name} (and shuffle)`}
            >
              <img src={getCardImageUrl(card, 'small')} alt={card.name} className="w-full rounded shadow" />
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 15.2: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: green.

- [ ] **Step 15.3: Manual smoke**

Enter playtest, click Search in toolbar. Modal shows the full library (~92 cards if commander is in command zone). Type a card name → list filters. Click a card → it goes to hand, library is shuffled, modal closes.

- [ ] **Step 15.4: Commit**

```bash
git add src/components/playtest/modals/SearchLibraryModal.tsx
git commit -m "feat(playtest): search library modal"
```

---

## Task 16: ScryMillSurveilModal

**Files:**
- Modify: `src/components/playtest/modals/ScryMillSurveilModal.tsx`

- [ ] **Step 16.1: Implement combined modal**

```tsx
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardImageUrl } from '@/services/scryfall/client';

export function ScryMillSurveilModal() {
  const modal = usePlaytestStore(s => s.modal);
  const library = usePlaytestStore(s => s.zones.library);
  const closeModal = usePlaytestStore(s => s.closeModal);
  const scryConfirm = usePlaytestStore(s => s.scryConfirm);
  const surveilConfirm = usePlaytestStore(s => s.surveilConfirm);
  const millConfirm = usePlaytestStore(s => s.millConfirm);

  if (!modal || (modal.kind !== 'scry' && modal.kind !== 'mill' && modal.kind !== 'surveil')) return null;

  const n = Math.min(modal.n, library.length);
  const top = library.slice(0, n);

  if (modal.kind === 'mill') {
    return (
      <ModalShell title={`Mill ${n}`} onClose={closeModal}>
        <p className="text-sm text-muted-foreground mb-3">These {n} cards will be moved from library to graveyard:</p>
        <div className="grid grid-cols-7 gap-2 mb-5">
          {top.map((c, i) => <img key={`${c.id}-${i}`} src={getCardImageUrl(c, 'normal')} alt={c.name} className="w-full rounded shadow" />)}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={closeModal}>Cancel</Button>
          <Button onClick={() => millConfirm(n)}>Mill {n}</Button>
        </div>
      </ModalShell>
    );
  }

  if (modal.kind === 'scry') return <ScryUI top={top} onConfirm={scryConfirm} onClose={closeModal} title={`Scry ${n}`} />;
  return <SurveilUI top={top} onConfirm={surveilConfirm} onClose={closeModal} title={`Surveil ${n}`} />;
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-background/85 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-card border border-border rounded-lg shadow-2xl max-w-4xl w-full p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function ScryUI({ top, onConfirm, onClose, title }: { top: any[]; onConfirm: (decisions: ('top' | 'bottom')[]) => void; onClose: () => void; title: string }) {
  const [decisions, setDecisions] = useState<('top' | 'bottom')[]>(() => top.map(() => 'top'));
  useEffect(() => { setDecisions(top.map(() => 'top')); }, [top.length]);
  return (
    <ModalShell title={title} onClose={onClose}>
      <p className="text-sm text-muted-foreground mb-3">Click a card to toggle Top ↔ Bottom of library.</p>
      <div className="grid grid-cols-7 gap-2 mb-5">
        {top.map((c, i) => (
          <button key={`${c.id}-${i}`} onClick={() => setDecisions(d => d.map((x, j) => j === i ? (x === 'top' ? 'bottom' : 'top') : x))}
            className={`relative rounded ${decisions[i] === 'bottom' ? 'opacity-60 ring-2 ring-amber-400' : 'ring-2 ring-emerald-400'}`}>
            <img src={getCardImageUrl(c, 'normal')} alt={c.name} className="w-full rounded shadow" />
            <span className={`absolute top-1 right-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${decisions[i] === 'bottom' ? 'bg-amber-500 text-black' : 'bg-emerald-500 text-black'}`}>{decisions[i]}</span>
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onConfirm(decisions)}>Confirm</Button>
      </div>
    </ModalShell>
  );
}

function SurveilUI({ top, onConfirm, onClose, title }: { top: any[]; onConfirm: (decisions: ('top' | 'graveyard')[]) => void; onClose: () => void; title: string }) {
  const [decisions, setDecisions] = useState<('top' | 'graveyard')[]>(() => top.map(() => 'top'));
  useEffect(() => { setDecisions(top.map(() => 'top')); }, [top.length]);
  return (
    <ModalShell title={title} onClose={onClose}>
      <p className="text-sm text-muted-foreground mb-3">Click a card to toggle Top ↔ Graveyard.</p>
      <div className="grid grid-cols-7 gap-2 mb-5">
        {top.map((c, i) => (
          <button key={`${c.id}-${i}`} onClick={() => setDecisions(d => d.map((x, j) => j === i ? (x === 'top' ? 'graveyard' : 'top') : x))}
            className={`relative rounded ${decisions[i] === 'graveyard' ? 'opacity-60 ring-2 ring-zinc-400' : 'ring-2 ring-emerald-400'}`}>
            <img src={getCardImageUrl(c, 'normal')} alt={c.name} className="w-full rounded shadow" />
            <span className={`absolute top-1 right-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${decisions[i] === 'graveyard' ? 'bg-zinc-500 text-white' : 'bg-emerald-500 text-black'}`}>{decisions[i] === 'graveyard' ? 'GY' : 'top'}</span>
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onConfirm(decisions)}>Confirm</Button>
      </div>
    </ModalShell>
  );
}
```

- [ ] **Step 16.2: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: green.

- [ ] **Step 16.3: Manual smoke**

Enter playtest. Toolbar → Scry/Mill/Surveil → set N=3 → Scry 3 → 3 cards shown, click one to mark bottom, confirm → library order updated. Repeat for Mill (3 cards go to graveyard) and Surveil (mark some for graveyard).

- [ ] **Step 16.4: Commit**

```bash
git add src/components/playtest/modals/ScryMillSurveilModal.tsx
git commit -m "feat(playtest): scry/mill/surveil modals"
```

---

## Task 17: ZoneViewerModal

**Files:**
- Modify: `src/components/playtest/modals/ZoneViewerModal.tsx`

- [ ] **Step 17.1: Implement Zone Viewer**

```tsx
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardImageUrl } from '@/services/scryfall/client';

const ZONE_LABEL: Record<string, string> = { library: 'Library', graveyard: 'Graveyard', exile: 'Exile', command: 'Command Zone' };

export function ZoneViewerModal() {
  const modal = usePlaytestStore(s => s.modal);
  const zones = usePlaytestStore(s => s.zones);
  const closeModal = usePlaytestStore(s => s.closeModal);
  const moveCard = usePlaytestStore(s => s.moveCard);

  if (!modal || modal.kind !== 'zoneViewer') return null;
  const zone = modal.zone;
  const cards = zones[zone];

  const moveTo = (idx: number, target: 'hand' | 'graveyard' | 'exile' | 'command' | 'libtop' | 'libbot') => {
    const source = { kind: 'zone' as const, zone, index: idx };
    if (target === 'libtop') moveCard({ source, target: { kind: 'library', position: 'top' } });
    else if (target === 'libbot') moveCard({ source, target: { kind: 'library', position: 'bottom' } });
    else moveCard({ source, target: { kind: 'zone', zone: target } });
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-background/90 backdrop-blur-sm flex flex-col p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">{ZONE_LABEL[zone]} ({cards.length})</h2>
        <Button variant="ghost" size="icon" onClick={closeModal}><X className="w-4 h-4" /></Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
          {cards.map((card, i) => (
            <Popover key={`${card.id}-${i}`}>
              <PopoverTrigger asChild>
                <button className="rounded hover:ring-2 hover:ring-primary transition-all">
                  <img src={getCardImageUrl(card, 'small')} alt={card.name} className="w-full rounded shadow" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-44 p-1">
                <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => moveTo(i, 'hand')}>To Hand</Button>
                {zone !== 'library' && <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => moveTo(i, 'libtop')}>To Library Top</Button>}
                {zone !== 'library' && <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => moveTo(i, 'libbot')}>To Library Bottom</Button>}
                {zone !== 'graveyard' && <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => moveTo(i, 'graveyard')}>To Graveyard</Button>}
                {zone !== 'exile' && <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => moveTo(i, 'exile')}>To Exile</Button>}
                {zone !== 'command' && <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => moveTo(i, 'command')}>To Command Zone</Button>}
              </PopoverContent>
            </Popover>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 17.2: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: green.

- [ ] **Step 17.3: Manual smoke**

Enter playtest. Click the graveyard pile in sidebar → modal opens (empty if nothing's there yet). Move a card to graveyard via drag, then re-open the modal — it shows the card. Click the card → popover with "To Hand / To Library Top / …" — pick one, card moves accordingly.

- [ ] **Step 17.4: Commit**

```bash
git add src/components/playtest/modals/ZoneViewerModal.tsx
git commit -m "feat(playtest): zone viewer modal with per-card move actions"
```

---

## Task 18: TokenSpawnModal

**Files:**
- Modify: `src/components/playtest/modals/TokenSpawnModal.tsx`

- [ ] **Step 18.1: Implement Token Spawn**

```tsx
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardImageUrl } from '@/services/scryfall/client';
import { resolveTokens, deriveColorIdentity } from '@/services/playtest/tokens';
import type { ScryfallCard } from '@/types';

export function TokenSpawnModal() {
  const command = usePlaytestStore(s => s.zones.command);
  const closeModal = usePlaytestStore(s => s.closeModal);
  const spawnToken = usePlaytestStore(s => s.spawnToken);

  const [tokens, setTokens] = useState<ScryfallCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    const ci = deriveColorIdentity(command);
    setLoading(true);
    resolveTokens(ci).then(t => {
      if (alive) {
        setTokens(t);
        setLoading(false);
      }
    });
    return () => { alive = false; };
  }, [command]);

  const filtered = tokens.filter(t => !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.type_line.toLowerCase().includes(q.toLowerCase()));

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-background/90 backdrop-blur-sm flex flex-col p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Spawn Token</h2>
        <Button variant="ghost" size="icon" onClick={closeModal}><X className="w-4 h-4" /></Button>
      </div>
      <Input autoFocus placeholder="Filter tokens…" value={q} onChange={e => setQ(e.target.value)} className="mb-4" />
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading tokens…</div>
        ) : filtered.length === 0 ? (
          <div className="text-muted-foreground">No tokens found.</div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
            {filtered.map(t => (
              <button
                key={t.id}
                onClick={() => { spawnToken(t); closeModal(); }}
                className="rounded hover:ring-2 hover:ring-primary transition-all"
                title={`Spawn ${t.name}`}
              >
                <img src={getCardImageUrl(t, 'small')} alt={t.name} className="w-full rounded shadow" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 18.2: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: green.

- [ ] **Step 18.3: Manual smoke**

Enter playtest with a colored commander deck. Toolbar → Tokens → modal opens, after a brief load shows tokens within the commander's color identity. Filter input works. Click a token → it appears on the battlefield at center.

- [ ] **Step 18.4: Commit**

```bash
git add src/components/playtest/modals/TokenSpawnModal.tsx
git commit -m "feat(playtest): token spawn modal (scryfall search by color identity)"
```

---

## Task 19: GameLog

**Files:**
- Modify: `src/components/playtest/GameLog.tsx`

- [ ] **Step 19.1: Implement Game Log**

```tsx
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';

export function GameLog() {
  const log = usePlaytestStore(s => s.log);
  const [open, setOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [log.length]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-6 border-l border-border/50 bg-card/30 hover:bg-card/60 flex items-center justify-center"
        title="Open log"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
    );
  }

  return (
    <aside className="w-56 border-l border-border/50 bg-card/30 flex flex-col">
      <div className="px-3 py-2 border-b border-border/50 flex items-center justify-between text-xs">
        <span className="font-semibold">Log</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen(false)}><ChevronRight className="w-3.5 h-3.5" /></Button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1 text-[11px] leading-snug">
        {log.length === 0
          ? <div className="text-muted-foreground italic">Nothing yet.</div>
          : log.map(e => <div key={e.id} className="text-muted-foreground/90">· {e.text}</div>)}
      </div>
    </aside>
  );
}
```

- [ ] **Step 19.2: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: green.

- [ ] **Step 19.3: Manual smoke**

Enter playtest. Log shows the initial entries (loaded, drew opening hand). Take any action (draw, untap, drag a card to battlefield) → new log entry appears, log auto-scrolls to bottom. Click chevron to collapse / re-expand.

- [ ] **Step 19.4: Commit**

```bash
git add src/components/playtest/GameLog.tsx
git commit -m "feat(playtest): game log sidebar with collapse"
```

---

## Task 20: Right-click context menu (PlaytestCardMenu)

The menu is launched on right-click from any card surface (hand, battlefield, zone viewer). Different surfaces show different action sets.

**Files:**
- Create: `src/components/playtest/PlaytestCardMenu.tsx`
- Modify: `src/components/playtest/Hand.tsx` (wire onContextMenu)
- Modify: `src/components/playtest/BattlefieldCard.tsx` (wire onContextMenu)

- [ ] **Step 20.1: Create the menu component**

```tsx
// src/components/playtest/PlaytestCardMenu.tsx
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { usePlaytestStore } from '@/store/playtestStore';
import type { ScryfallCard } from '@/types';

export interface CardMenuTarget {
  // Either a battlefield card (instanceId set) or a hand card (handIndex set)
  kind: 'battlefield' | 'hand';
  instanceId?: string;
  handIndex?: number;
  card: ScryfallCard;
  x: number;
  y: number;
}

interface Props {
  target: CardMenuTarget | null;
  onClose: () => void;
}

const COUNTER_TYPES = ['+1/+1', '-1/-1', 'loyalty', 'charge', 'storage'];

export function PlaytestCardMenu({ target, onClose }: Props) {
  const moveCard = usePlaytestStore(s => s.moveCard);
  const toggleTap = usePlaytestStore(s => s.toggleTap);
  const toggleFaceDown = usePlaytestStore(s => s.toggleFaceDown);
  const adjustCounter = usePlaytestStore(s => s.adjustCounter);
  const copyCard = usePlaytestStore(s => s.copyCard);
  const unattach = usePlaytestStore(s => s.unattach);
  const battlefield = usePlaytestStore(s => s.battlefield);

  useEffect(() => {
    if (!target) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [target, onClose]);

  if (!target) return null;

  const onBattlefield = target.kind === 'battlefield';
  const bfCard = onBattlefield && target.instanceId ? battlefield.find(b => b.instanceId === target.instanceId) : null;
  const isAttached = !!bfCard?.attachedTo;

  const move = (dest: 'hand' | 'graveyard' | 'exile' | 'command' | 'libtop' | 'libbot') => {
    const source = onBattlefield && target.instanceId
      ? { kind: 'battlefield' as const, instanceId: target.instanceId }
      : { kind: 'zone' as const, zone: 'hand' as const, index: target.handIndex! };
    if (dest === 'libtop') moveCard({ source, target: { kind: 'library', position: 'top' } });
    else if (dest === 'libbot') moveCard({ source, target: { kind: 'library', position: 'bottom' } });
    else moveCard({ source, target: { kind: 'zone', zone: dest } });
    onClose();
  };

  return createPortal(
    <div
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-[200] min-w-[180px] bg-popover border border-border rounded-md shadow-2xl text-xs py-1"
      style={{ left: target.x, top: target.y }}
    >
      <div className="px-3 py-1.5 text-[10px] uppercase opacity-50">{target.card.name}</div>
      <Item onClick={() => move('hand')}>→ Hand</Item>
      <Item onClick={() => move('libtop')}>→ Library Top</Item>
      <Item onClick={() => move('libbot')}>→ Library Bottom</Item>
      <Item onClick={() => move('graveyard')}>→ Graveyard</Item>
      <Item onClick={() => move('exile')}>→ Exile</Item>
      <Item onClick={() => move('command')}>→ Command Zone</Item>

      {onBattlefield && bfCard && (
        <>
          <Sep />
          <Item onClick={() => { toggleTap(bfCard.instanceId); onClose(); }}>{bfCard.tapped ? 'Untap' : 'Tap'}</Item>
          <Item onClick={() => { toggleFaceDown(bfCard.instanceId); onClose(); }}>{bfCard.faceDown ? 'Flip face up' : 'Flip face down'}</Item>
          <Item onClick={() => { copyCard(bfCard.instanceId); onClose(); }}>Create copy</Item>
          {isAttached && <Item onClick={() => { unattach(bfCard.instanceId); onClose(); }}>Unattach</Item>}
          <Sep />
          <div className="px-3 py-1.5 text-[10px] uppercase opacity-50">Add counter</div>
          {COUNTER_TYPES.map(t => (
            <Item key={t} onClick={() => { adjustCounter(bfCard.instanceId, t, 1); onClose(); }}>+1 {t}</Item>
          ))}
        </>
      )}
    </div>,
    document.body,
  );
}

function Item({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors">{children}</button>;
}
function Sep() { return <div className="h-px bg-border/60 my-1" />; }
```

- [ ] **Step 20.2: Wire `onContextMenu` in `Hand.tsx`**

In `Hand`, add menu state and pass to each `HandCard`:

```tsx
import { PlaytestCardMenu, type CardMenuTarget } from '@/components/playtest/PlaytestCardMenu';
// ...
const [menu, setMenu] = useState<CardMenuTarget | null>(null);
// In render: pass an onContextMenu handler that sets menu
// Around HandCard:
<HandCard
  /* existing props */
  onContextMenu={(e) => {
    e.preventDefault();
    setMenu({ kind: 'hand', handIndex: originalIndex, card, x: e.clientX, y: e.clientY });
  }}
/>
// At the bottom of the JSX, alongside CardPreviewModal:
<PlaytestCardMenu target={menu} onClose={() => setMenu(null)} />
```

Add `onContextMenu` to `HandCardProps` and forward it onto the outer `<div>`.

- [ ] **Step 20.3: Wire `onContextMenu` in `BattlefieldCard.tsx`**

In `BattlefieldCard`, add a menu state at the component (each card owns its own menu state — simpler than a shared one for now):

```tsx
const [menu, setMenu] = useState<CardMenuTarget | null>(null);

// in the wrapper <div> props:
onContextMenu: (e: React.MouseEvent) => {
  e.preventDefault();
  setMenu({ kind: 'battlefield', instanceId: card.instanceId, card: card.card, x: e.clientX, y: e.clientY });
},

// at the end of JSX:
<PlaytestCardMenu target={menu} onClose={() => setMenu(null)} />
```

- [ ] **Step 20.4: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: green.

- [ ] **Step 20.5: Manual smoke**

Right-click a card in hand → menu opens with destination options. Right-click a card on battlefield → full menu (move, tap, flip, counter, copy). Click outside / press Escape → closes. Add a +1/+1 counter → chip appears on the card.

- [ ] **Step 20.6: Commit**

```bash
git add src/components/playtest/PlaytestCardMenu.tsx src/components/playtest/Hand.tsx src/components/playtest/BattlefieldCard.tsx
git commit -m "feat(playtest): right-click context menu for hand and battlefield cards"
```

---

## Task 21: Hotkeys

**Files:**
- Create: `src/components/playtest/hooks/useHotkeys.ts`
- Modify: `src/pages/PlaytestPage.tsx` (call the hook)

- [ ] **Step 21.1: Implement hotkeys hook**

```ts
// src/components/playtest/hooks/useHotkeys.ts
import { useEffect } from 'react';
import { usePlaytestStore } from '@/store/playtestStore';
import { PHASES } from '@/components/playtest/types';

export function usePlaytestHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing in an input/textarea/contenteditable
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t as HTMLElement).isContentEditable)) return;

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
```

- [ ] **Step 21.2: Use hook in PlaytestPage**

In `src/pages/PlaytestPage.tsx`:

```tsx
import { usePlaytestHotkeys } from '@/components/playtest/hooks/useHotkeys';
// inside the component:
usePlaytestHotkeys();
```

- [ ] **Step 21.3: Run lint+build**

```bash
npm run lint && npm run build
```

Expected: green.

- [ ] **Step 21.4: Manual smoke**

Enter playtest. Press D → draw. Press U → untap. Press S → shuffle. Press M → mulligan. Hover a battlefield card and press T → tap toggles. Press Esc when a modal is open → closes. Press Ctrl+Z → undo last action.

- [ ] **Step 21.5: Commit**

```bash
git add src/components/playtest/hooks/useHotkeys.ts src/pages/PlaytestPage.tsx
git commit -m "feat(playtest): hotkeys (D, U, S, M, T, 1-7, Esc, Ctrl+Z)"
```

---

## Task 22: Final polish — bump version + patch notes

**Files:**
- Modify: `package.json` (version bump)
- Modify: `src/data/patchNotes.json` (add entry at top)

- [ ] **Step 22.1: Run full smoke from the spec**

Per the spec's verification section:

1. Open generated deck → click Playtest → mulligan once → keep 7 → draw 5 → drag two lands and a creature to battlefield → tap a land → add `+1/+1` counter to creature → drag aura onto creature → confirm visual nesting → move creature to graveyard → undo → confirm state restored → reset → confirm fresh state.
2. Open saved list → click Playtest → repeat the smoke flow.
3. Mobile spot-check (browser dev tools → device toolbar): drag works via touch, modals close via tap-outside.

Fix any bugs that surface; commit fixes individually with descriptive messages.

- [ ] **Step 22.2: Bump version**

```bash
npm version patch --no-git-tag-version
```

This updates `package.json` and `package-lock.json` from `1.2.24` to `1.2.25`.

- [ ] **Step 22.3: Add patch notes entry**

Edit `src/data/patchNotes.json`. Add a new entry at the **top** of the array (most recent first):

```json
{
  "version": "1.2.25",
  "notes": [
    "Playtest area — drag cards onto a free-position battlefield, tap, add counters, mulligan, scry/mill/surveil, search library, spawn tokens. Open from any deck via the new Playtest button.",
    "Hotkeys in playtest: D draw, U untap all, S shuffle, M mulligan, 1-7 phases, Ctrl+Z undo."
  ]
}
```

- [ ] **Step 22.4: Final lint+build**

```bash
npm run lint && npm run build
```

Expected: green.

- [ ] **Step 22.5: Commit**

```bash
git add package.json package-lock.json src/data/patchNotes.json
git commit -m "1.2.25 — playtest area"
```

---

## Self-Review

Cross-checked each spec section against the tasks:

| Spec section | Covered by |
|---|---|
| Routes (`/playtest/list/:listId`, `/playtest/generated`) | Task 7 |
| Entry buttons (BuilderPage + ListDeckView) | Task 7 |
| Module layout (`src/components/playtest/`, `src/services/playtest/`, `src/store/playtestStore.ts`) | Tasks 1, 4, 5, 6, 8–21 |
| Dependencies (`@dnd-kit/core`, generic card-back image, `crypto.randomUUID`) | Tasks 1, 3 |
| Data model (BattlefieldCard, Zones, Phase, Modal, MoveSource, MoveTarget) | Task 2 |
| Library hydration | Task 4 |
| Store actions (full list) | Task 6 |
| Drag & drop wiring | Tasks 10, 11, 13 |
| Battlefield rendering (positioning, tap rotation, counter chips, attachments) | Task 11, 13 |
| Right-click context menu | Task 20 |
| Mulligan / Search / Scry-Mill-Surveil / Zone Viewer / Token Spawn modals | Tasks 14–18 |
| Hand fan + sort | Task 10 |
| Sidebar piles | Task 9 |
| Toolbar | Task 12 |
| Life total | Task 9 (LifePanel inside Sidebar) |
| Game log | Task 19 |
| Hotkeys | Task 21 |
| Edge cases (empty library, DFC handling, saved-list quantities, sideboard ignored, commander handling, /playtest/generated refresh) | Tasks 4 (libraryBuilder), 6 (store edge cases), 7 (route guards) |
| Verification convention (lint, build, smoke) | Every task ends with these steps |
| Out of scope | Not implemented (no multiplayer, no save state, no Vitest) |

**Type consistency check:**
- `MoveSource.kind`: `'zone' | 'battlefield'` — used identically in store and UI
- `MoveTarget.kind`: `'zone' | 'library' | 'battlefield'` — consistent
- `ZoneKey` exhaustive: `'library' | 'hand' | 'graveyard' | 'exile' | 'command'`
- Modal kinds: `'mulligan' | 'search' | 'scry' | 'mill' | 'surveil' | 'zoneViewer' | 'tokens'`
- Store actions all have stable signatures; no rename between tasks
- `BattlefieldCard.instanceId` (string) used everywhere (drag IDs, attachment IDs, hovered state, undo)

**No-placeholder check:** every step contains either complete code, an exact command, or a concrete edit instruction. The two places marked "Note for the implementer" (forwardRef pattern in Task 11, dnd-kit drag-end edge cases in Task 13) are guidance about how to write the code shown — not unfilled placeholders.

**Open-question carry-overs from spec:**
- Collision algorithm choice: defaults to `closestCenter` (dnd-kit default). Acceptable for the battlefield use case; if attachment collisions feel wrong, swap to `pointerWithin` in `<DndContext collisionDetection={pointerWithin}>` later.
- `nanoid` vs `crypto.randomUUID`: chose `crypto.randomUUID()` — no extra dep. Documented in Task 3.
- Battlefield perf at 50+ cards: not yet a concern; selectors are scoped per card. If perf issues arise, swap `useStore(s => s.battlefield)` for `shallow` selectors in BattlefieldCard.
- Card-back asset: implementer creates a simple non-trademarked image (Task 1.2).

---

## Plan complete

Saved to `docs/superpowers/plans/2026-05-03-playtest-area.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
