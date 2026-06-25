import { create } from 'zustand';
import type { DetectedCombo, ScryfallCard } from '@/types';
import { buildLibrary } from '@/services/playtest/libraryBuilder';
import { resolveCombos } from '@/services/playtest/combos';
import {
  type BattlefieldCard,
  type CounterColor,
  type DieSides,
  type FreeCounter,
  type FreeDie,
  type LogCategory,
  type LogEntry,
  type Modal,
  type MoveArgs,
  type PlaytestSnapshot,
  type SourceInput,
  type SourceMeta,
  type Zones,
  type ZoneKey,
} from '@/components/playtest/types';
import { fisherYates, isLand as _isLand, makeInstanceId, snapArrival, findArrivalSlot } from '@/components/playtest/utils';
import { usePlaytestSettings, CARD_SIZES } from '@/store/playtestSettingsStore';

const HISTORY_CAP = 20;
const STARTING_LIFE = 40;

const emptyZones = (): Zones => ({ library: [], hand: [], graveyard: [], exile: [], command: [] });

interface PlaytestState {
  ready: boolean;                                          // false until hydrate completes
  loading: boolean;                                        // true while hydrate is in-flight
  error: string | null;
  source: SourceMeta | null;
  // Deck color identity (WUBRG letters) derived once at hydrate — drives the
  // "Auto" battlefield background. Stable even if the commander leaves the zone.
  colorIdentity: string[];
  zones: Zones;
  battlefield: BattlefieldCard[];
  life: number;
  turn: number;
  log: LogEntry[];
  history: PlaytestSnapshot[];
  modal: Modal;
  hovered: string | null;
  hoveredPile: Exclude<ZoneKey, 'hand'> | null;
  battlefieldRect: { width: number; height: number };     // updated by Battlefield component on mount/resize
  // Mulligan state machine
  mulliganCount: number;
  // Increments any time the library is shuffled — UI hooks observe this for animations
  shuffleTick: number;
  // Increments any time a card is placed on TOP of the library — UI hooks
  // observe this to play a slide-up animation of the card-back on the pile.
  libraryTopPushTick: number;
  // Increments any time a card is added to the graveyard / exile pile —
  // the sidebar Pile uses this to play an overlay animation of the new card.
  graveyardPushTick: number;
  exilePushTick: number;
  // Hand-index range of cards added by the most recent draw() call. The hand
  // component checks this at HandCard mount-time to play the deal-in animation
  // only on freshly drawn cards (not on cards returned from other zones).
  lastDrawRange: { start: number; end: number };
  // Hand-index range of cards returned to hand from the battlefield by the most
  // recent moveCard() call. Hand component checks this at mount-time to play
  // the slide-in-from-top animation only on freshly returned cards.
  lastReturnRange: { start: number; end: number };
  // Free-floating counter objects on the battlefield (separate from per-card counters).
  freeCounters: FreeCounter[];
  // Free-floating dice on the battlefield — created from the Create dialog,
  // can be rolled or manually set.
  freeDice: FreeDie[];
  // Combos detected in the deck (static — populated at hydrate time).
  combos: DetectedCombo[];
  // Battlefield instanceIds currently selected via marquee (rectangle) selection.
  selectedIds: string[];
  selectedCounterIds: string[];
  selectedDieIds: string[];
  // Active multi-drag tracking — used so non-active selected cards visually follow.
  dragActiveId: { kind: 'card' | 'counter' | 'die'; id: string } | null;
  dragDelta: { x: number; y: number } | null;
  // In-memory clipboard for Ctrl+C / Ctrl+V — stores snapshots of cards,
  // counters, and dice along with their absolute positions plus a cumulative
  // paste offset so chained pastes cascade rather than stacking.
  clipboard: {
    cards: BattlefieldCard[];
    counters: FreeCounter[];
    dice: FreeDie[];
    pasteOffset: { x: number; y: number };
  } | null;
  // Ephemeral feedback toast — incrementing tick triggers a fresh display in
  // the UI. Cleared automatically after the toast fades.
  toast: { text: string; tick: number } | null;
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
  nextTurn: () => void;

  moveCard: (args: MoveArgs) => void;
  toggleTap: (instanceId: string) => void;
  toggleFaceDown: (instanceId: string) => void;
  toggleFlipped: (instanceId: string) => void;
  rotateCard: (instanceId: string, delta: number) => void;
  rotateCards: (instanceIds: string[], delta: number) => void;
  toggleTapMany: (instanceIds: string[]) => void;
  toggleFaceDownMany: (instanceIds: string[]) => void;
  shufflePile: (zone: Exclude<ZoneKey, 'hand'>) => void;
  setCounter: (instanceId: string, type: string, value: number) => void;
  adjustCounter: (instanceId: string, type: string, delta: number) => void;
  copyCard: (instanceId: string) => void;
  attach: (childId: string, parentId: string) => void;
  unattach: (instanceId: string) => void;
  spawnToken: (card: ScryfallCard, position?: { x: number; y: number }) => void;

  scryConfirm: (topOrder: number[], bottomOrder: number[]) => void;
  surveilConfirm: (topOrder: number[], graveyardOrder: number[]) => void;
  millConfirm: (n: number) => void;
  searchLibraryTakeToHand: (cardId: string) => void;

  undo: () => void;
  openModal: (modal: Modal) => void;
  closeModal: () => void;
  setHovered: (id: string | null) => void;
  setHoveredPile: (zone: Exclude<ZoneKey, 'hand'> | null) => void;

  appendLog: (text: string) => void;
  clearLog: () => void;

  addFreeCounter: (color?: CounterColor, position?: { x: number; y: number }) => void;
  adjustFreeCounter: (id: string, delta: number) => void;
  removeFreeCounter: (id: string) => void;
  setFreeCounterColor: (id: string, color: CounterColor) => void;
  moveFreeCounter: (id: string, x: number, y: number) => void;

  addFreeDie: (sides: DieSides, position?: { x: number; y: number }, color?: CounterColor) => void;
  rollFreeDie: (id: string) => void;
  setFreeDieValue: (id: string, value: number) => void;
  setFreeDieColor: (id: string, color: CounterColor) => void;
  removeFreeDie: (id: string) => void;
  moveFreeDie: (id: string, x: number, y: number) => void;

  setSelectedIds: (ids: string[]) => void;
  setMarqueeSelection: (sel: { cards: string[]; counters: string[]; dice: string[] }) => void;
  clearSelection: () => void;

  setDragActive: (active: { kind: 'card' | 'counter' | 'die'; id: string } | null) => void;
  setDragDelta: (delta: { x: number; y: number } | null) => void;
  applyGroupMove: (active: { kind: 'card' | 'counter' | 'die'; id: string }, dx: number, dy: number) => void;

  copyToClipboard: () => void;
  pasteClipboard: (target?: { x: number; y: number }) => void;
}

type Store = PlaytestState & PlaytestActions;

const initial: PlaytestState = {
  ready: false,
  loading: false,
  error: null,
  source: null,
  colorIdentity: [],
  zones: emptyZones(),
  battlefield: [],
  life: STARTING_LIFE,
  turn: 1,
  log: [],
  history: [],
  modal: null,
  hovered: null,
  hoveredPile: null,
  battlefieldRect: { width: 0, height: 0 },
  mulliganCount: 0,
  shuffleTick: 0,
  libraryTopPushTick: 0,
  graveyardPushTick: 0,
  exilePushTick: 0,
  lastDrawRange: { start: -1, end: -1 },
  lastReturnRange: { start: -1, end: -1 },
  freeCounters: [],
  freeDice: [],
  combos: [],
  selectedIds: [],
  selectedCounterIds: [],
  selectedDieIds: [],
  dragActiveId: null,
  dragDelta: null,
  clipboard: null,
  toast: null,
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
  };
}

function pushHistory(history: PlaytestSnapshot[], snap: PlaytestSnapshot): PlaytestSnapshot[] {
  const next = [...history, snap];
  if (next.length > HISTORY_CAP) next.shift();
  return next;
}

function makeLogEntry(text: string, category: LogCategory = 'system'): LogEntry {
  return { id: makeInstanceId(), ts: Date.now(), text, category };
}

// Snap an accumulated rotation back to its nearest upright orientation. Untapping
// straightens cards turned sideways with Q/E, and snapping to the closest multiple
// of 360 keeps already-upright cards in place while spinning the short way home.
function uprightRotation(rotation: number | undefined): number {
  return Math.round((rotation ?? 0) / 360) * 360;
}

export const usePlaytestStore = create<Store>((set, get) => ({
  ...initial,

  // ─────────────────────── lifecycle ───────────────────────

  hydrate: async (input) => {
    set({ loading: true, error: null });
    try {
      const built = await buildLibrary(input);
      // Color identity for the Auto background: the commander defines it, but
      // fall back to the union across all cards for lists with no command zone.
      const ciPool = built.zones.command.length
        ? built.zones.command
        : Object.values(built.zones).flat();
      const colorIdentity = Array.from(new Set(ciPool.flatMap(c => c.color_identity ?? [])));
      set({
        ...initial,
        ready: true,
        loading: false,
        source: { kind: built.kind, name: built.name, commanderNames: built.commanderNames },
        colorIdentity,
        zones: built.zones,
        log: [makeLogEntry(`Loaded "${built.name}" (${built.zones.library.length} cards in library)`, 'system')],
      });
      get().dealOpeningHand();
      // Resolve combos in the background — don't block initial render.
      resolveCombos(input)
        .then((combos) => {
          // Only apply if the user hasn't navigated away to another deck since.
          if (get().source?.name === built.name) set({ combos });
        })
        .catch(() => { /* swallow */ });
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
        colorIdentity: state.colorIdentity,
        zones: { ...emptyZones(), library: reshuffled, command: [...state.zones.command] },
        log: [makeLogEntry('Reset', 'system')],
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
      lastDrawRange: { start: 0, end: draw.length },
      log: [...state.log, makeLogEntry(`Drew opening hand (${draw.length})`, 'library')],
    };
  }),

  draw: (n = 1) => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const drawn = state.zones.library.slice(0, n);
    if (drawn.length === 0) {
      return { log: [...state.log, makeLogEntry('Library is empty', 'library')] };
    }
    const before = state.zones.hand.length;
    return {
      history,
      zones: {
        ...state.zones,
        hand: [...state.zones.hand, ...drawn],
        library: state.zones.library.slice(drawn.length),
      },
      lastDrawRange: { start: before, end: before + drawn.length },
      lastReturnRange: { start: -1, end: -1 },
      log: [...state.log, makeLogEntry(drawn.length === 1 ? `Drew ${drawn[0].name}` : `Drew ${drawn.length} cards`, 'library')],
    };
  }),

  shuffle: () => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    return {
      history,
      zones: { ...state.zones, library: fisherYates(state.zones.library) },
      shuffleTick: state.shuffleTick + 1,
      log: [...state.log, makeLogEntry('Shuffled library', 'library')],
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
      shuffleTick: state.shuffleTick + 1,
      modal: { kind: 'mulligan', mulliganCount: newCount },
      log: [...state.log, makeLogEntry(`Mulligan to ${Math.max(0, 7 - newCount)} (drew 7)`, 'library')],
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
      log: [...state.log, makeLogEntry(`Sent ${sentDown.length} card(s) to bottom of library`, 'library')],
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
      log: [...state.log, makeLogEntry(`Kept opening hand`, 'library')],
    };
  }),

  // ─────────────────────── life / turn ───────────────────────

  setLife: (n) => set(state => ({
    history: pushHistory(state.history, snapshotOf(state)),
    life: n,
    log: [...state.log, makeLogEntry(`Life set to ${n}`, 'life')],
  })),

  adjustLife: (delta) => set(state => ({
    history: pushHistory(state.history, snapshotOf(state)),
    life: state.life + delta,
    log: [...state.log, makeLogEntry(`${delta >= 0 ? '+' : ''}${delta} life (now ${state.life + delta})`, 'life')],
  })),

  nextTurn: () => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const nextTurn = state.turn + 1;
    const needsUntap = state.battlefield.some(b => b.tapped || uprightRotation(b.rotation) !== (b.rotation ?? 0));
    return {
      history,
      turn: nextTurn,
      battlefield: needsUntap ? state.battlefield.map(b => ({ ...b, tapped: false, rotation: uprightRotation(b.rotation) })) : state.battlefield,
      log: [
        ...state.log,
        makeLogEntry(`Turn ${nextTurn}`, 'turn'),
        ...(needsUntap ? [makeLogEntry('Untapped all', 'tap')] : []),
      ],
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

    // Tokens cease to exist the moment they leave the battlefield (MTG rule
    // 111.8 / 704.5d). When the source is the battlefield and the card is a
    // token, drop it on the floor instead of routing it into the target zone.
    const isToken = sourceLabel === 'battlefield' && card.type_line.toLowerCase().includes('token');
    if (isToken && target.kind !== 'battlefield') {
      next.log.push(makeLogEntry(`${card.name} ceased to exist`, 'move'));
      return {
        ...next,
        history,
        lastDrawRange: { start: -1, end: -1 },
        lastReturnRange: { start: -1, end: -1 },
      };
    }

    // 2) insert into target
    let targetLabel = '';
    let handInsertIndex = -1;
    if (target.kind === 'zone') {
      const arr = next.zones[target.zone];
      if (typeof target.index === 'number') {
        // Explicit position requested (e.g. drop between hand cards)
        const idx = Math.max(0, Math.min(target.index, arr.length));
        arr.splice(idx, 0, card);
        if (target.zone === 'hand') handInsertIndex = idx;
      } else if (target.zone === 'hand') {
        // Default for hand: append (e.g. draw, return-to-hand without position)
        arr.push(card);
        handInsertIndex = arr.length - 1;
      } else {
        // Face-up piles (command, graveyard, exile) show the most recently
        // added card on top → insert at the front.
        arr.unshift(card);
      }
      targetLabel = target.zone;
    } else if (target.kind === 'library') {
      if (target.position === 'top') {
        next.zones.library.unshift(card);
        targetLabel = 'library top';
      } else if (target.position === 'bottom') {
        next.zones.library.push(card);
        targetLabel = 'library bottom';
      } else {
        // Numeric depth: 0 = top, 1 = 2nd from top, etc. Clamp to valid range.
        const depth = Math.max(0, Math.min(next.zones.library.length, target.position));
        next.zones.library.splice(depth, 0, card);
        targetLabel = `library #${depth + 1} from top`;
      }
    } else {
      // battlefield drop
      let { x, y } = target;
      if (target.arrived) {
        const { width: cw, height: ch } = CARD_SIZES[usePlaytestSettings.getState().cardSize];
        const snapped = snapArrival(card, x, y, state.battlefieldRect.height, ch);
        const slot = findArrivalSlot(
          next.battlefield,
          snapped.x,
          snapped.y,
          state.battlefieldRect.width,
          state.battlefieldRect.height,
          _isLand(card),
          cw,
          ch,
        );
        x = slot.x;
        y = slot.y;
      }
      const counters: Record<string, number> = {};
      // Planeswalkers arrive with starting loyalty. Check the front face's
      // type/loyalty first so DFCs where the front is a planeswalker work,
      // then fall back to the top-level fields (single-faced cards).
      const frontFace = card.card_faces?.[0] as { type_line?: string; loyalty?: string } | undefined;
      const playedTypeLine = (frontFace?.type_line ?? card.type_line ?? '').toLowerCase();
      const loyaltyStr = frontFace?.loyalty ?? card.loyalty;
      if (playedTypeLine.includes('planeswalker') && loyaltyStr) {
        const n = parseInt(loyaltyStr, 10);
        if (!isNaN(n)) counters.loyalty = Math.max(0, n);
      }
      next.battlefield.push({
        instanceId: makeInstanceId(),
        card,
        x,
        y,
        tapped: false,
        faceDown: false,
        flipped: false,
        counters,
      });
      targetLabel = 'battlefield';
    }

    // Skip the log entry when the move is just hand reordering (hand → hand).
    if (sourceLabel !== 'hand' || targetLabel !== 'hand') {
      next.log.push(makeLogEntry(`${card.name}: ${sourceLabel} → ${targetLabel}`, 'move'));
    }
    // Any move invalidates the deal-in window — only freshly drawn cards
    // (set by the draw() action) should ever play that animation.
    // If a card was returned to hand from the battlefield, mark a 1-card return
    // range so that hand card plays the slide-in-from-top animation at mount.
    const lastReturnRange =
      sourceLabel === 'battlefield' && targetLabel === 'hand' && handInsertIndex >= 0
        ? { start: handInsertIndex, end: handInsertIndex + 1 }
        : { start: -1, end: -1 };
    // Dragging from the library into the hand should feel like drawing the
    // card — mark a 1-card draw range so the new hand card plays the deal-in
    // animation at mount, same as draw().
    const lastDrawRange =
      sourceLabel === 'library' && targetLabel === 'hand' && handInsertIndex >= 0
        ? { start: handInsertIndex, end: handInsertIndex + 1 }
        : { start: -1, end: -1 };
    // Library push happens via two pipelines: explicit { kind: 'library', position: 'top' }
    // (right-click actions) and the generic zone drop { kind: 'zone', zone: 'library' }
    // used by drag-onto-pile (which unshifts to the top in the zone branch above).
    const droppedOnLibraryTop = target.kind === 'library' && (target.position === 'top' || target.position === 0);
    const libraryTopPushTick = droppedOnLibraryTop
      ? state.libraryTopPushTick + 1
      : state.libraryTopPushTick;
    const graveyardPushTick =
      target.kind === 'zone' && target.zone === 'graveyard'
        ? state.graveyardPushTick + 1
        : state.graveyardPushTick;
    const exilePushTick =
      target.kind === 'zone' && target.zone === 'exile'
        ? state.exilePushTick + 1
        : state.exilePushTick;
    return {
      ...next,
      history,
      lastDrawRange,
      lastReturnRange,
      libraryTopPushTick,
      graveyardPushTick,
      exilePushTick,
    };
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
      log: [...state.log, makeLogEntry(target ? `${target.tapped ? 'Untapped' : 'Tapped'} ${target.card.name}` : '', 'tap')],
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
      log: [...state.log, makeLogEntry(target ? `Flipped ${target.card.name} ${target.faceDown ? 'face up' : 'face down'}` : '', 'move')],
    };
  }),

  toggleFlipped: (instanceId) => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const battlefield = state.battlefield.map(b =>
      b.instanceId === instanceId ? { ...b, flipped: !b.flipped } : b
    );
    const target = state.battlefield.find(b => b.instanceId === instanceId);
    const willShowBack = target ? !target.flipped : false;
    return {
      history,
      battlefield,
      log: [...state.log, makeLogEntry(target ? `${willShowBack ? 'Transformed' : 'Reverted'} ${target.card.name}` : '', 'move')],
    };
  }),

  rotateCard: (instanceId, delta) => set(state => {
    // Accumulate without modulo so CSS transition spins the short way the user
    // intended (e.g. 270 → 360 spins clockwise, not 270 → 0 counter-clockwise).
    const battlefield = state.battlefield.map(b =>
      b.instanceId === instanceId ? { ...b, rotation: (b.rotation ?? 0) + delta } : b
    );
    return { battlefield };
  }),

  rotateCards: (instanceIds, delta) => set(state => {
    const ids = new Set(instanceIds);
    if (ids.size === 0) return {};
    return {
      battlefield: state.battlefield.map(b =>
        ids.has(b.instanceId) ? { ...b, rotation: (b.rotation ?? 0) + delta } : b
      ),
    };
  }),

  toggleTapMany: (instanceIds) => set(state => {
    const ids = new Set(instanceIds);
    if (ids.size === 0) return {};
    const history = pushHistory(state.history, snapshotOf(state));
    return {
      history,
      battlefield: state.battlefield.map(b =>
        ids.has(b.instanceId) ? { ...b, tapped: !b.tapped } : b
      ),
      log: [...state.log, makeLogEntry(`Toggled tap on ${ids.size} card${ids.size === 1 ? '' : 's'}`, 'tap')],
    };
  }),

  toggleFaceDownMany: (instanceIds) => set(state => {
    const ids = new Set(instanceIds);
    if (ids.size === 0) return {};
    const history = pushHistory(state.history, snapshotOf(state));
    return {
      history,
      battlefield: state.battlefield.map(b =>
        ids.has(b.instanceId) ? { ...b, faceDown: !b.faceDown } : b
      ),
      log: [...state.log, makeLogEntry(`Toggled face-down on ${ids.size} card${ids.size === 1 ? '' : 's'}`, 'move')],
    };
  }),

  shufflePile: (zone) => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const next = fisherYates(state.zones[zone]);
    return {
      history,
      zones: { ...state.zones, [zone]: next },
      shuffleTick: zone === 'library' ? state.shuffleTick + 1 : state.shuffleTick,
      log: [...state.log, makeLogEntry(`Shuffled ${zone}`, 'library')],
    };
  }),

  setCounter: (instanceId, type, value) => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const battlefield = state.battlefield.map(b => {
      if (b.instanceId !== instanceId) return b;
      const counters = { ...b.counters };
      if (value <= 0) delete counters[type];
      else counters[type] = value;
      // MTG state-based action: +1/+1 and -1/-1 counters cancel pairwise.
      const plus = counters['+1/+1'] ?? 0;
      const minus = counters['-1/-1'] ?? 0;
      if (plus > 0 && minus > 0) {
        const cancel = Math.min(plus, minus);
        const np = plus - cancel;
        const nm = minus - cancel;
        if (np > 0) counters['+1/+1'] = np; else delete counters['+1/+1'];
        if (nm > 0) counters['-1/-1'] = nm; else delete counters['-1/-1'];
      }
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
      log: [...state.log, makeLogEntry(`${delta >= 0 ? '+' : ''}${delta} ${type} on ${card.card.name}`, 'counter')],
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
      log: [...state.log, makeLogEntry(`Created copy of ${original.card.name}`, 'move')],
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
      log: [...state.log, makeLogEntry(`Attached ${child.card.name} to ${parent.card.name}`, 'move')],
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
      log: [...state.log, makeLogEntry(target ? `Unattached ${target.card.name}` : '', 'move')],
    };
  }),

  spawnToken: (card, position) => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const cx = position?.x ?? Math.floor(state.battlefieldRect.width / 2 - 50);
    const cy = position?.y ?? Math.floor(state.battlefieldRect.height / 2 - 70);
    const { width: cw, height: ch } = CARD_SIZES[usePlaytestSettings.getState().cardSize];
    const slot = findArrivalSlot(
      state.battlefield,
      cx,
      cy,
      state.battlefieldRect.width,
      state.battlefieldRect.height,
      false,
      cw,
      ch,
    );
    const token: BattlefieldCard = {
      instanceId: makeInstanceId(),
      card,
      x: slot.x,
      y: slot.y,
      tapped: false,
      faceDown: false,
      flipped: false,
      counters: {},
    };
    return {
      history,
      battlefield: [...state.battlefield, token],
      log: [...state.log, makeLogEntry(`Spawned ${card.name} token`, 'move')],
    };
  }),

  // ─────────────────────── scry / mill / surveil / search ───────────────────────

  scryConfirm: (topOrder, bottomOrder) => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const total = topOrder.length + bottomOrder.length;
    const revealed = state.zones.library.slice(0, total);
    const rest = state.zones.library.slice(total);
    const tops = topOrder.map(i => revealed[i]).filter(Boolean);
    const bottoms = bottomOrder.map(i => revealed[i]).filter(Boolean);
    return {
      history,
      zones: { ...state.zones, library: [...tops, ...rest, ...bottoms] },
      modal: null,
      log: [...state.log, makeLogEntry(`Scry ${total}: ${tops.length} top, ${bottoms.length} bottom`, 'library')],
    };
  }),

  surveilConfirm: (topOrder, graveyardOrder) => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const total = topOrder.length + graveyardOrder.length;
    const revealed = state.zones.library.slice(0, total);
    const rest = state.zones.library.slice(total);
    const keepTop = topOrder.map(i => revealed[i]).filter(Boolean);
    const toGrave = graveyardOrder.map(i => revealed[i]).filter(Boolean);
    return {
      history,
      zones: {
        ...state.zones,
        library: [...keepTop, ...rest],
        graveyard: [...state.zones.graveyard, ...toGrave],
      },
      modal: null,
      log: [...state.log, makeLogEntry(`Surveil ${total}: ${keepTop.length} top, ${toGrave.length} graveyard`, 'library')],
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
      log: [...state.log, makeLogEntry(`Milled ${milled.length} card(s)`, 'library')],
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
      shuffleTick: state.shuffleTick + 1,
      log: [...state.log, makeLogEntry(`Searched library: took ${card.name} (and shuffled)`, 'library')],
      modal: null,
    };
  }),

  // ─────────────────────── untap / undo / modal ───────────────────────

  untapAll: () => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    return {
      history,
      battlefield: state.battlefield.map(b => ({ ...b, tapped: false, rotation: uprightRotation(b.rotation) })),
      log: [...state.log, makeLogEntry('Untapped all', 'tap')],
    };
  }),

  undo: () => set(state => {
    if (state.history.length === 0) return {};
    const prev = state.history[state.history.length - 1];
    // Walk back through the log and mark the most recent non-undone, non-meta
    // entry as undone. "Undo" entries themselves are skipped so re-undoing
    // strikes out a real action each time, not a previous undo line.
    const log = [...state.log];
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (e.undone) continue;
      if (e.text === 'Undo') continue;
      log[i] = { ...e, undone: true };
      break;
    }
    log.push(makeLogEntry('Undo', 'system'));
    return {
      history: state.history.slice(0, -1),
      zones: prev.zones,
      battlefield: prev.battlefield,
      life: prev.life,
      turn: prev.turn,
      log,
    };
  }),

  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
  setHovered: (id) => set({ hovered: id }),
  setHoveredPile: (zone) => set({ hoveredPile: zone }),

  appendLog: (text) => set(state => ({ log: [...state.log, makeLogEntry(text)] })),
  clearLog: () => set({ log: [] }),

  addFreeCounter: (color = 'emerald', position) => set(state => {
    const cx = position ? Math.round(position.x - 22) : Math.floor(state.battlefieldRect.width / 2 - 22);
    const cy = position ? Math.round(position.y - 22) : Math.floor(state.battlefieldRect.height / 2 - 22);
    return {
      freeCounters: [
        ...state.freeCounters,
        { id: makeInstanceId(), x: cx, y: cy, value: 1, color },
      ],
      log: [...state.log, makeLogEntry('Added a counter', 'counter')],
    };
  }),

  adjustFreeCounter: (id, delta) => set(state => ({
    freeCounters: state.freeCounters.map(c =>
      c.id === id ? { ...c, value: c.value + delta } : c
    ),
  })),

  removeFreeCounter: (id) => set(state => ({
    freeCounters: state.freeCounters.filter(c => c.id !== id),
    log: [...state.log, makeLogEntry('Removed a counter', 'counter')],
  })),

  setFreeCounterColor: (id, color) => set(state => ({
    freeCounters: state.freeCounters.map(c => (c.id === id ? { ...c, color } : c)),
  })),

  moveFreeCounter: (id, x, y) => set(state => ({
    freeCounters: state.freeCounters.map(c => (c.id === id ? { ...c, x, y } : c)),
  })),

  addFreeDie: (sides, position, color = 'blue') => set(state => {
    const cx = position?.x ?? Math.floor(state.battlefieldRect.width / 2 - 22);
    const cy = position?.y ?? Math.floor(state.battlefieldRect.height / 2 - 22);
    const initial = 1 + Math.floor(Math.random() * sides);
    return {
      freeDice: [
        ...state.freeDice,
        { id: makeInstanceId(), x: cx, y: cy, sides, value: initial, color },
      ],
      log: [...state.log, makeLogEntry(`Added a d${sides} (rolled ${initial})`, 'counter')],
    };
  }),

  rollFreeDie: (id) => set(state => {
    const die = state.freeDice.find(d => d.id === id);
    if (!die) return {};
    const next = 1 + Math.floor(Math.random() * die.sides);
    return {
      freeDice: state.freeDice.map(d => (d.id === id ? { ...d, value: next } : d)),
      log: [...state.log, makeLogEntry(`Rolled d${die.sides} → ${next}`, 'counter')],
    };
  }),

  setFreeDieValue: (id, value) => set(state => ({
    freeDice: state.freeDice.map(d => {
      if (d.id !== id) return d;
      const clamped = Math.max(1, Math.min(d.sides, Math.round(value)));
      return { ...d, value: clamped };
    }),
  })),

  setFreeDieColor: (id, color) => set(state => ({
    freeDice: state.freeDice.map(d => (d.id === id ? { ...d, color } : d)),
  })),

  removeFreeDie: (id) => set(state => ({
    freeDice: state.freeDice.filter(d => d.id !== id),
    log: [...state.log, makeLogEntry('Removed a die', 'counter')],
  })),

  moveFreeDie: (id, x, y) => set(state => ({
    freeDice: state.freeDice.map(d => (d.id === id ? { ...d, x, y } : d)),
  })),

  setSelectedIds: (ids) => set({ selectedIds: ids }),
  setMarqueeSelection: (sel) => set({
    selectedIds: sel.cards,
    selectedCounterIds: sel.counters,
    selectedDieIds: sel.dice,
  }),
  clearSelection: () => set(state => (
    state.selectedIds.length === 0 && state.selectedCounterIds.length === 0 && state.selectedDieIds.length === 0
      ? {}
      : { selectedIds: [], selectedCounterIds: [], selectedDieIds: [] }
  )),

  setDragActive: (active) => set({ dragActiveId: active }),
  setDragDelta: (delta) => set({ dragDelta: delta }),

  // Apply (dx, dy) to every selected battlefield card, free counter, and free
  // die except the active draggable itself. Used at drop time to keep a
  // marquee-selected group moving together regardless of which item the user
  // grabbed to start the drag.
  copyToClipboard: () => set(state => {
    // Prefer the marquee selection. If nothing's selected, fall back to the
    // hovered battlefield card (single-item copy).
    const hasSelection =
      state.selectedIds.length > 0 ||
      state.selectedCounterIds.length > 0 ||
      state.selectedDieIds.length > 0;

    let cards: BattlefieldCard[] = [];
    let counters: FreeCounter[] = [];
    let dice: FreeDie[] = [];

    if (hasSelection) {
      const cardSet = new Set(state.selectedIds);
      const ctrSet  = new Set(state.selectedCounterIds);
      const dieSet  = new Set(state.selectedDieIds);
      cards    = state.battlefield.filter(b  => cardSet.has(b.instanceId)).map(b => ({ ...b, counters: { ...b.counters } }));
      counters = state.freeCounters.filter(c => ctrSet.has(c.id)).map(c => ({ ...c }));
      dice     = state.freeDice.filter(d     => dieSet.has(d.id)).map(d => ({ ...d }));
    } else if (state.hovered) {
      const bf = state.battlefield.find(b => b.instanceId === state.hovered);
      if (bf) cards = [{ ...bf, counters: { ...bf.counters } }];
    }

    if (cards.length === 0 && counters.length === 0 && dice.length === 0) return {};

    const total = cards.length + counters.length + dice.length;
    return {
      clipboard: { cards, counters, dice, pasteOffset: { x: 24, y: 24 } },
      toast: { text: `Copied ${total} item${total === 1 ? '' : 's'}`, tick: (state.toast?.tick ?? 0) + 1 },
      log: [...state.log, makeLogEntry(`Copied ${total} item${total === 1 ? '' : 's'}`, 'system')],
    };
  }),

  pasteClipboard: (target) => set(state => {
    const cb = state.clipboard;
    if (!cb) return {};

    // Determine the offset to apply to every clipboard item:
    //   • If a target was provided (e.g. cursor on battlefield), shift the
    //     centroid of the copied group's CENTERS (not top-left corners) to it
    //     so the cursor lands at the middle of the pasted card/group.
    //   • Otherwise cascade by the cumulative pasteOffset.
    let dx: number, dy: number;
    const { width: cw, height: ch } = CARD_SIZES[usePlaytestSettings.getState().cardSize];
    const centers = [
      ...cb.cards.map(c    => ({ x: c.x + cw / 2,  y: c.y + ch / 2  })),
      ...cb.counters.map(c => ({ x: c.x + 17,      y: c.y + 17      })), // 34px / 2
      ...cb.dice.map(d     => ({ x: d.x + 22,      y: d.y + 22      })), // 44px / 2
    ];
    if (target && centers.length > 0) {
      const cx = centers.reduce((s, p) => s + p.x, 0) / centers.length;
      const cy = centers.reduce((s, p) => s + p.y, 0) / centers.length;
      dx = target.x - cx;
      dy = target.y - cy;
    } else {
      dx = cb.pasteOffset.x;
      dy = cb.pasteOffset.y;
    }

    const newCards: BattlefieldCard[] = cb.cards.map(c => ({
      ...c,
      counters: { ...c.counters },
      instanceId: makeInstanceId(),
      x: c.x + dx,
      y: c.y + dy,
      attachedTo: undefined,
    }));
    const newCounters: FreeCounter[] = cb.counters.map(c => ({
      ...c,
      id: makeInstanceId(),
      x: c.x + dx,
      y: c.y + dy,
    }));
    const newDice: FreeDie[] = cb.dice.map(d => ({
      ...d,
      id: makeInstanceId(),
      x: d.x + dx,
      y: d.y + dy,
    }));

    const total = newCards.length + newCounters.length + newDice.length;
    return {
      history: pushHistory(state.history, snapshotOf(state)),
      battlefield: [...state.battlefield, ...newCards],
      freeCounters: [...state.freeCounters, ...newCounters],
      freeDice: [...state.freeDice, ...newDice],
      // Re-select the newly pasted items so the user can immediately drag the
      // pasted group around or paste again with cascading offset.
      selectedIds: newCards.map(c => c.instanceId),
      selectedCounterIds: newCounters.map(c => c.id),
      selectedDieIds: newDice.map(d => d.id),
      // Reset cascading offset when pasted at a specific cursor target so the
      // next plain Ctrl+V starts a fresh cascade from the new spot.
      clipboard: target ? { ...cb, pasteOffset: { x: 24, y: 24 } } : { ...cb, pasteOffset: { x: cb.pasteOffset.x + 24, y: cb.pasteOffset.y + 24 } },
      log: [...state.log, makeLogEntry(`Pasted ${total} item${total === 1 ? '' : 's'}`, 'system')],
    };
  }),

  applyGroupMove: (active, dx, dy) => set(state => {
    // Confirm the active item is in the selection of its own kind.
    const inSel =
      active.kind === 'card'    ? state.selectedIds.includes(active.id)
    : active.kind === 'counter' ? state.selectedCounterIds.includes(active.id)
    :                             state.selectedDieIds.includes(active.id);
    if (!inSel) return {};
    const moveCards    = new Set(state.selectedIds.filter(id => !(active.kind === 'card' && id === active.id)));
    const moveCounters = new Set(state.selectedCounterIds.filter(id => !(active.kind === 'counter' && id === active.id)));
    const moveDice     = new Set(state.selectedDieIds.filter(id => !(active.kind === 'die' && id === active.id)));
    if (moveCards.size === 0 && moveCounters.size === 0 && moveDice.size === 0) return {};
    return {
      battlefield: state.battlefield.map(b =>
        moveCards.has(b.instanceId) ? { ...b, x: b.x + dx, y: b.y + dy } : b
      ),
      freeCounters: state.freeCounters.map(c =>
        moveCounters.has(c.id) ? { ...c, x: c.x + dx, y: c.y + dy } : c
      ),
      freeDice: state.freeDice.map(d =>
        moveDice.has(d.id) ? { ...d, x: d.x + dx, y: d.y + dy } : d
      ),
    };
  }),
}));

// Helper: serializable selector for zone counts (used by Sidebar to avoid re-rendering on every change)
export function zoneCount(s: PlaytestState, zone: ZoneKey): number {
  return s.zones[zone].length;
}
