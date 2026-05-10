import { create } from 'zustand';
import type { DetectedCombo, ScryfallCard } from '@/types';
import { buildLibrary } from '@/services/playtest/libraryBuilder';
import { resolveCombos } from '@/services/playtest/combos';
import {
  type BattlefieldCard,
  type CounterColor,
  type FreeCounter,
  type LogCategory,
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
import { fisherYates, isLand as _isLand, makeInstanceId, snapArrival, findArrivalSlot } from '@/components/playtest/utils';

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
  // Increments any time the library is shuffled — UI hooks observe this for animations
  shuffleTick: number;
  // Hand-index range of cards added by the most recent draw() call. The hand
  // component checks this at HandCard mount-time to play the deal-in animation
  // only on freshly drawn cards (not on cards returned from other zones).
  lastDrawRange: { start: number; end: number };
  // Free-floating counter objects on the battlefield (separate from per-card counters).
  freeCounters: FreeCounter[];
  // Combos detected in the deck (static — populated at hydrate time).
  combos: DetectedCombo[];
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
  nextTurn: () => void;

  moveCard: (args: MoveArgs) => void;
  toggleTap: (instanceId: string) => void;
  toggleFaceDown: (instanceId: string) => void;
  toggleFlipped: (instanceId: string) => void;
  setCounter: (instanceId: string, type: string, value: number) => void;
  adjustCounter: (instanceId: string, type: string, delta: number) => void;
  copyCard: (instanceId: string) => void;
  attach: (childId: string, parentId: string) => void;
  unattach: (instanceId: string) => void;
  spawnToken: (card: ScryfallCard, position?: { x: number; y: number }) => void;

  scryConfirm: (decisions: ('top' | 'bottom')[]) => void;
  surveilConfirm: (decisions: ('top' | 'graveyard')[]) => void;
  millConfirm: (n: number) => void;
  searchLibraryTakeToHand: (cardId: string) => void;

  undo: () => void;
  openModal: (modal: Modal) => void;
  closeModal: () => void;
  setHovered: (id: string | null) => void;

  appendLog: (text: string) => void;
  clearLog: () => void;

  addFreeCounter: (color?: CounterColor, position?: { x: number; y: number }) => void;
  adjustFreeCounter: (id: string, delta: number) => void;
  removeFreeCounter: (id: string) => void;
  setFreeCounterColor: (id: string, color: CounterColor) => void;
  moveFreeCounter: (id: string, x: number, y: number) => void;
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
  shuffleTick: 0,
  lastDrawRange: { start: -1, end: -1 },
  freeCounters: [],
  combos: [],
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

function makeLogEntry(text: string, category: LogCategory = 'system'): LogEntry {
  return { id: makeInstanceId(), ts: Date.now(), text, category };
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

  // ─────────────────────── life / turn / phase ───────────────────────

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

  setPhase: (phase) => set(state => ({ phase, log: [...state.log, makeLogEntry(`Phase: ${phase}`, 'turn')] })),

  nextTurn: () => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const nextTurn = state.turn + 1;
    return {
      history,
      turn: nextTurn,
      phase: PHASES[0],
      log: [...state.log, makeLogEntry(`Turn ${nextTurn} — ${PHASES[0]}`, 'turn')],
    };
  }),

  advancePhase: () => set(state => {
    const idx = PHASES.indexOf(state.phase);
    const nextIdx = (idx + 1) % PHASES.length;
    const wrapped = nextIdx === 0;
    const nextPhase = PHASES[nextIdx];
    const nextTurn = wrapped ? state.turn + 1 : state.turn;
    return {
      phase: nextPhase,
      turn: nextTurn,
      log: [...state.log, makeLogEntry(wrapped ? `Turn ${nextTurn} — ${nextPhase}` : `Phase: ${nextPhase}`, 'turn')],
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
      const arr = next.zones[target.zone];
      if (typeof target.index === 'number') {
        // Explicit position requested (e.g. drop between hand cards)
        const idx = Math.max(0, Math.min(target.index, arr.length));
        arr.splice(idx, 0, card);
      } else if (target.zone === 'hand') {
        // Default for hand: append (e.g. draw, return-to-hand without position)
        arr.push(card);
      } else {
        // Face-up piles (command, graveyard, exile) show the most recently
        // added card on top → insert at the front.
        arr.unshift(card);
      }
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
        const slot = findArrivalSlot(
          next.battlefield,
          snapped.x,
          snapped.y,
          state.battlefieldRect.width,
          state.battlefieldRect.height,
          _isLand(card),
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
    return { ...next, history, lastDrawRange: { start: -1, end: -1 } };
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
    const slot = findArrivalSlot(
      state.battlefield,
      cx,
      cy,
      state.battlefieldRect.width,
      state.battlefieldRect.height,
      false,
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
      log: [...state.log, makeLogEntry(`Scry ${decisions.length}: ${tops.length} top, ${bottoms.length} bottom`, 'library')],
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
      log: [...state.log, makeLogEntry(`Surveil ${decisions.length}: ${keepTop.length} top, ${toGrave.length} graveyard`, 'library')],
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
      battlefield: state.battlefield.map(b => ({ ...b, tapped: false })),
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
      phase: prev.phase,
      log,
    };
  }),

  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
  setHovered: (id) => set({ hovered: id }),

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
      c.id === id ? { ...c, value: Math.max(0, c.value + delta) } : c
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
}));

// Helper: serializable selector for zone counts (used by Sidebar to avoid re-rendering on every change)
export function zoneCount(s: PlaytestState, zone: ZoneKey): number {
  return s.zones[zone].length;
}
