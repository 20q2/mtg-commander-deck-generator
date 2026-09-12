import { create } from 'zustand';
import type { DetectedCombo, ScryfallCard } from '@/types';
import { buildLibrary } from '@/services/playtest/libraryBuilder';
import { resolveCombos } from '@/services/playtest/combos';
import { applyTrialPins } from '@/services/playtest/trialPins';
import {
  type BattlefieldCard,
  type CardEdit,
  type CardSticker,
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
  type TrialPin,
  type Zones,
  type ZoneKey,
} from '@/components/playtest/types';
import { fisherYates, isLand as _isLand, makeInstanceId, snapArrival, findArrivalSlot } from '@/components/playtest/utils';
import { usePlaytestSettings, CARD_SIZES } from '@/store/playtestSettingsStore';
import { floatDelta, useFloatingText } from '@/store/floatingTextStore';
import { useDamageFlash } from '@/store/damageFlashStore';
import { describeEdit } from '@/services/playtest/powerToughness';
import { captureAll, restoreAll } from '@/store/undoBridge';

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
  // Digits typed over a pile buffer for a moment so "2" can still become "20".
  // Purely transient feedback — the pile shows the number building up. Not in
  // snapshotOf(), so it never lands in undo history.
  pileDrawPending: { zone: Exclude<ZoneKey, 'hand'>; n: number } | null;
  // Free counters, dice and hand cards track their own hover so Delete knows
  // what's under the cursor — battlefield cards use `hovered` above. Hand is an
  // index rather than an id because a hand holds duplicate cards.
  hoveredCounter: string | null;
  hoveredDie: string | null;
  hoveredHandIndex: number | null;
  /**
   * Hand cards turned over with F — the back face of a double-faced card, the
   * card back for anything else. Keyed by card id rather than hand index
   * because every draw, discard and re-sort shifts the indices; the price is
   * that two copies of one printing turn over together, which shows the same
   * face twice either way.
   */
  flippedHandIds: string[];
  // New Card Trial: force chosen cards to show up so they can actually be tested.
  // Pins only ever name cards already in the deck, so no card data is stored here.
  trialPins: TrialPin[];
  battlefieldRect: { width: number; height: number };     // updated by Battlefield component on mount/resize
  // Measured height of the opponent seats overlaying the top of the canvas.
  // Arriving cards snap below it so nothing lands underneath them. 0 when no
  // bots are seated.
  seatBandHeight: number;
  /**
   * While a card is being dragged over the hand, the row position it would
   * land at. The hand fan parts around it so you can see where the card is
   * going before you let go. Null whenever nothing is hovering the hand.
   */
  handDropFanPos: number | null;
  /**
   * Set for one commit when a card lands in the hand: the hand index it landed
   * at, and the viewport point it was released from. The hand replays that as
   * a short flight into the slot, so a drop settles instead of snapping.
   */
  handLanding: { index: number; x: number; y: number } | null;
  // Mulligan state machine
  mulliganCount: number;
  // Increments any time the library is shuffled — UI hooks observe this for animations
  shuffleTick: number;
  // Increments any time a card is placed on TOP of the library — UI hooks
  // observe this to play a slide-up animation of the card-back on the pile.
  libraryTopPushTick: number;
  // Increments any time cards are drawn off the top of the library — the
  // mirror of libraryTopPushTick. The pile plays a card-back sliding *down*
  // off the deck while the drawn card deals into the hand.
  libraryDrawTick: number;
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
  /**
   * Set when stackSelection has just rewritten a group's positions, so each
   * card can be animated in from where it came from instead of appearing in
   * its new spot. Offsets are old-minus-new — where the flight starts — and
   * the tick is what tells a card this is a fresh stack and not the one it
   * already played. Ephemeral; never snapshotted.
   */
  stackFlight: { tick: number; offsets: Record<string, StackFlightOffset> } | null;
  /**
   * True while a drag that has already stacked its selection is still holding
   * it. From that moment the pile — not the one card — is the thing in your
   * hand, so the dragged card drops its floating ghost and takes its place in
   * the stack instead of hovering above it.
   */
  stackedDrag: boolean;
  // Ephemeral feedback toast — incrementing tick triggers a fresh display in
  // the UI. Cleared automatically after the toast fades.
  toast: { text: string; tick: number } | null;
}

interface PlaytestActions {
  hydrate: (input: SourceInput) => Promise<void>;
  reset: () => void;
  exit: () => void;                                        // clears all state (for unmount)
  setBattlefieldRect: (w: number, h: number) => void;
  setSeatBandHeight: (h: number) => void;
  setHandDropFanPos: (pos: number | null) => void;
  setHandLanding: (landing: { index: number; x: number; y: number } | null) => void;

  dealOpeningHand: () => void;
  draw: (n?: number) => void;
  shuffle: () => void;
  beginMulligan: () => void;                               // shuffle hand back, draw 7, increment mulliganCount, open mulligan modal
  freeMulligan: () => void;                                // shuffle hand back, draw 7, no penalty (no count change, no bottoming)
  keepHandSendToBottom: (handIndices: number[]) => void;   // resolves the bottom-N step
  keepHand: () => void;                                    // confirms current 7

  /**
   * Whole hand to the graveyard. Returns the hand indices that left, so the
   * caller can fly them there — it cannot work that out afterwards, because
   * by then they are gone.
   */
  discardHand: () => number[];
  /** Wheel of Fortune: discard your hand, then draw seven. Returns what went. */
  wheel: () => number[];
  /** Hymn-style: `n` cards chosen at random go to the graveyard. Returns which. */
  discardAtRandom: (n: number) => number[];
  /** Timetwister-style: hand back into the library, shuffle, redraw that many. */
  shuffleHandIntoLibrary: () => void;
  /** Discard specific hand indices — the cleanup step's picker resolves here. */
  discardFromHand: (handIndices: number[]) => void;

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
  toggleHandFlipped: (cardId: string) => void;
  shufflePile: (zone: Exclude<ZoneKey, 'hand'>) => void;
  takeFromPile: (zone: Exclude<ZoneKey, 'hand'>, n?: number) => void;
  /**
   * Empty one zone into another in a single step — Elixir of Immortality,
   * Tormod's Crypt, Riftsweeper. One action rather than one per pairing,
   * because every combination is the same move with different labels.
   */
  emptyZoneInto: (
    from: Exclude<ZoneKey, 'hand'>,
    to: ZoneKey,
    opts?: { shuffle?: boolean },
  ) => void;
  setCounter: (instanceId: string, type: string, value: number) => void;
  /** Rewrite one of your creatures — Lignify and friends. `null` clears it. */
  setCardEdit: (instanceId: string, edit: CardEdit | null) => void;
  /**
   * `anchor` is viewport coords for the floating "+1" to pop from. Pass the
   * badge's own rect when the click came from a badge; without it the text
   * comes off the middle of the card.
   */
  adjustCounter: (instanceId: string, type: string, delta: number, anchor?: { x: number; y: number }) => void;
  moveCounterBadge: (instanceId: string, type: string, x: number, y: number) => void;
  addSticker: (instanceId: string, text: string, position?: { x: number; y: number }) => void;
  setStickerText: (instanceId: string, stickerId: string, text: string) => void;
  moveSticker: (instanceId: string, stickerId: string, x: number, y: number) => void;
  removeSticker: (instanceId: string, stickerId: string) => void;
  copyCard: (instanceId: string) => void;
  attach: (childId: string, parentId: string) => void;
  unattach: (instanceId: string) => void;
  spawnToken: (card: ScryfallCard, position?: { x: number; y: number }) => void;
  /**
   * `arrival` carries state the card is bringing with it. Stealing a bot's
   * permanent used to drop its counters on the floor — a Krenko with three
   * +1/+1 counters arrived on your side as a vanilla copy.
   */
  addPermanent: (
    card: ScryfallCard,
    position?: { x: number; y: number },
    logText?: string,
    arrival?: { tapped?: boolean; counters?: Record<string, number>; edit?: CardEdit },
  ) => void;
  /** Hands back the whole entry, so a donated permanent keeps its counters. */
  releasePermanent: (instanceId: string) => BattlefieldCard | null;

  scryConfirm: (topOrder: number[], bottomOrder: number[]) => void;
  surveilConfirm: (topOrder: number[], graveyardOrder: number[]) => void;
  millConfirm: (n: number) => void;
  searchLibraryTakeToHand: (cardId: string) => void;

  undo: () => void;
  openModal: (modal: Modal) => void;
  closeModal: () => void;
  setHovered: (id: string | null) => void;
  setHoveredPile: (zone: Exclude<ZoneKey, 'hand'> | null) => void;
  setPileDrawPending: (pending: { zone: Exclude<ZoneKey, 'hand'>; n: number } | null) => void;
  setHoveredCounter: (id: string | null) => void;
  setHoveredDie: (id: string | null) => void;
  setHoveredHandIndex: (index: number | null) => void;
  setTrialPins: (pins: TrialPin[]) => void;

  appendLog: (text: string) => void;
  clearLog: () => void;
  /**
   * Flash a short message at the top of the table. For the moments where an
   * action simply does not happen — a card dropped somewhere it cannot go —
   * and silence reads as the app being broken rather than as a refusal.
   */
  showToast: (text: string) => void;

  /**
   * Push one history entry capturing the current state, without mutating
   * anything. Lets a multi-step sequence — declare attackers, confirm, resolve
   * — collapse into a single Undo rather than unwinding one card at a time.
   */
  pushCheckpoint: () => void;
  /**
   * Set tapped on many cards without pushing history or logging. For steps
   * that sit inside a sequence already covered by a pushCheckpoint, where
   * `toggleTap` would fragment the undo and spam the log with one line per
   * attacker.
   */
  setTappedQuiet: (instanceIds: string[], tapped: boolean) => void;

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
  /**
   * Throw a loose counter or die away — what the battlefield's trash corner
   * does. Takes the whole selection of that kind when the dragged one is part
   * of it, so binning a marquee'd handful is one gesture and one undo.
   */
  trashLoose: (active: { kind: 'counter' | 'die'; id: string }) => void;

  setSelectedIds: (ids: string[]) => void;
  setMarqueeSelection: (sel: { cards: string[]; counters: string[]; dice: string[] }) => void;
  toggleSelect: (kind: 'card' | 'counter' | 'die', id: string) => void;
  clearSelection: () => void;

  setDragActive: (active: { kind: 'card' | 'counter' | 'die'; id: string } | null) => void;
  setDragDelta: (delta: { x: number; y: number } | null) => void;
  applyGroupMove: (active: { kind: 'card' | 'counter' | 'die'; id: string }, dx: number, dy: number) => void;
  /**
   * Tidy the selected cards into one staggered pile, Tabletop-Simulator style:
   * every card shares an x, each one sits a title-row below the last, so you
   * read the pile as a list of names. `anchorInstanceId` (the card being
   * dragged, when a shake triggered this) leads the pile and keeps its own
   * position, since mid-drag it's the one under the cursor and can't be moved.
   */
  stackSelection: (anchorInstanceId?: string) => void;

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
  pileDrawPending: null,
  hoveredCounter: null,
  hoveredDie: null,
  hoveredHandIndex: null,
  flippedHandIds: [],
  trialPins: [],
  battlefieldRect: { width: 0, height: 0 },
  stackFlight: null,
  stackedDrag: false,
  seatBandHeight: 0,
  handDropFanPos: null,
  handLanding: null,
  mulliganCount: 0,
  shuffleTick: 0,
  libraryTopPushTick: 0,
  libraryDrawTick: 0,
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
    battlefield: s.battlefield.map(b => ({
      ...b,
      counters: { ...b.counters },
      counterPositions: b.counterPositions ? { ...b.counterPositions } : undefined,
      stickers: b.stickers?.map(st => ({ ...st })),
    })),
    life: s.life,
    turn: s.turn,
    participants: captureAll(),
  };
}

/** How far back to start a card's flight into a pile. */
export interface StackFlightOffset {
  dx: number;
  dy: number;
}

/** How long a card takes to fly into its slot. They all leave together. */
export const STACK_FLIGHT_MS = 240;

/**
 * Vertical gap between cards in a tidy pile. A card's title row is about 13% of
 * its height, so that's all a pile shows of every card but the bottom one.
 * Tall piles tighten the step rather than run off the table: names go from
 * readable to merely countable, which beats vanishing under the hand row.
 */
const PILE_STEP_RATIO = 0.13;

function pileStep(cardHeight: number, count: number, tableHeight: number): number {
  const ideal = Math.round(cardHeight * PILE_STEP_RATIO);
  // Fit-check against the whole table, not the pile's actual y — a pile you
  // deliberately parked near the bottom edge is your business, the same as any
  // card dragged down there.
  const room = tableHeight - cardHeight - 16;
  if (count < 2 || room <= 0) return ideal;
  return Math.max(6, Math.min(ideal, Math.floor(room / (count - 1))));
}

function pushHistory(history: PlaytestSnapshot[], snap: PlaytestSnapshot): PlaytestSnapshot[] {
  const next = [...history, snap];
  if (next.length > HISTORY_CAP) next.shift();
  return next;
}

function makeLogEntry(text: string, category: LogCategory = 'system'): LogEntry {
  return { id: makeInstanceId(), ts: Date.now(), text, category };
}

/**
 * The canvas size to place an arriving card in.
 *
 * The store's copy is zeroed by every `set({ ...initial })` — exit, load,
 * reset — and Battlefield's ResizeObserver only fires on a size CHANGE, so
 * after a reload the store can sit at 0×0 for a whole game. `findArrivalSlot`
 * then returns its start point untouched, and every card played by clicking
 * piled onto the same spot: a Krenko landed exactly on top of a Mountain, and
 * the creature underneath could not be grabbed to attack. Read the live
 * element when the store's copy is unusable.
 */
function canvasRect(state: { battlefieldRect: { width: number; height: number } }): { width: number; height: number } {
  const { width, height } = state.battlefieldRect;
  if (width > 0 && height > 0) return { width, height };
  const el = typeof document !== 'undefined' ? document.querySelector('[data-battlefield]') : null;
  const r = el?.getBoundingClientRect();
  return r && r.width > 0 && r.height > 0 ? { width: r.width, height: r.height } : { width, height };
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
      resolveCombos(input, colorIdentity)
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
        // Trial pins are a session rule, not game state: they must survive reset
        // so "reset and look again" stays a one-click loop. The `...initial`
        // above would otherwise clear them.
        trialPins: state.trialPins,
        zones: { ...emptyZones(), library: reshuffled, command: [...state.zones.command] },
        log: [makeLogEntry('Reset', 'system')],
      };
    });
    get().dealOpeningHand();
  },

  exit: () => set({ ...initial }),

  setBattlefieldRect: (width, height) => set({ battlefieldRect: { width, height } }),
  setSeatBandHeight: (h) => set({ seatBandHeight: h }),
  setHandDropFanPos: (handDropFanPos) => set(s => (
    s.handDropFanPos === handDropFanPos ? {} : { handDropFanPos }
  )),
  setHandLanding: (handLanding) => set({ handLanding }),

  // ─────────────────────── mulligan / draw / shuffle ───────────────────────

  dealOpeningHand: () => set(state => {
    const { library, forcedHand, notes } = applyTrialPins(state.zones.library, state.trialPins);
    // Pinned-to-hand cards are part of the seven, not extra.
    const need = Math.max(0, 7 - forcedHand.length);
    const drawn = library.slice(0, need);
    const hand = [...forcedHand, ...drawn];
    return {
      zones: { ...state.zones, hand, library: library.slice(need) },
      lastDrawRange: { start: 0, end: hand.length },
      log: [
        ...state.log,
        makeLogEntry(`Drew opening hand (${hand.length})`, 'library'),
        ...notes.map(n => makeLogEntry(n, 'system')),
      ],
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
      libraryDrawTick: state.libraryDrawTick + 1,
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

  freeMulligan: () => set(state => {
    const combined = [...state.zones.hand, ...state.zones.library];
    const shuffled = fisherYates(combined);
    const draw = shuffled.slice(0, 7);
    const rest = shuffled.slice(7);
    return {
      zones: { ...state.zones, hand: draw, library: rest },
      shuffleTick: state.shuffleTick + 1,
      log: [...state.log, makeLogEntry(`Free mulligan (drew 7)`, 'library')],
    };
  }),

  discardHand: () => {
    const state = get();
    const n = state.zones.hand.length;
    if (n === 0) return [];
    set({
      history: pushHistory(state.history, snapshotOf(state)),
      zones: { ...state.zones, hand: [], graveyard: [...state.zones.graveyard, ...state.zones.hand] },
      graveyardPushTick: state.graveyardPushTick + 1,
      log: [...state.log, makeLogEntry(`Discarded hand (${n})`, 'move')],
    });
    return state.zones.hand.map((_, i) => i);
  },

  wheel: () => {
    const state = get();
    const history = pushHistory(state.history, snapshotOf(state));
    const discarded = state.zones.hand;
    const hand = state.zones.library.slice(0, 7);
    const library = state.zones.library.slice(hand.length);
    set({
      history,
      zones: { ...state.zones, hand, library, graveyard: [...state.zones.graveyard, ...discarded] },
      graveyardPushTick: discarded.length > 0 ? state.graveyardPushTick + 1 : state.graveyardPushTick,
      // Deal-in covers the whole new hand, the same as an opening draw.
      lastDrawRange: { start: 0, end: hand.length },
      lastReturnRange: { start: -1, end: -1 },
      libraryDrawTick: state.libraryDrawTick + 1,
      log: [...state.log, makeLogEntry(`Wheel: discarded ${discarded.length}, drew ${hand.length}`, 'library')],
    });
    return discarded.map((_, i) => i);
  },

  discardAtRandom: (n) => {
    const state = get();
    const take = Math.min(n, state.zones.hand.length);
    if (take <= 0) return [];
    const history = pushHistory(state.history, snapshotOf(state));
    // Shuffle the indices rather than the cards, so the survivors keep their
    // order in hand — a random discard shouldn't quietly reorder your hand.
    const picked = new Set(fisherYates(state.zones.hand.map((_, i) => i)).slice(0, take));
    const discarded = state.zones.hand.filter((_, i) => picked.has(i));
    set({
      history,
      zones: {
        ...state.zones,
        hand: state.zones.hand.filter((_, i) => !picked.has(i)),
        graveyard: [...state.zones.graveyard, ...discarded],
      },
      graveyardPushTick: state.graveyardPushTick + 1,
      log: [...state.log, makeLogEntry(
        `Discarded ${take} at random: ${discarded.map(c => c.name).join(', ')}`, 'move',
      )],
    });
    return [...picked];
  },

  shuffleHandIntoLibrary: () => set(state => {
    const n = state.zones.hand.length;
    if (n === 0) return {};
    const history = pushHistory(state.history, snapshotOf(state));
    const shuffled = fisherYates([...state.zones.hand, ...state.zones.library]);
    return {
      history,
      zones: { ...state.zones, hand: shuffled.slice(0, n), library: shuffled.slice(n) },
      shuffleTick: state.shuffleTick + 1,
      lastDrawRange: { start: 0, end: n },
      lastReturnRange: { start: -1, end: -1 },
      log: [...state.log, makeLogEntry(`Shuffled ${n} back and redrew ${n}`, 'library')],
    };
  }),

  discardFromHand: (handIndices) => set(state => {
    const picked = new Set(handIndices);
    if (picked.size === 0) return { modal: null };
    const history = pushHistory(state.history, snapshotOf(state));
    const discarded = state.zones.hand.filter((_, i) => picked.has(i));
    return {
      history,
      modal: null,
      zones: {
        ...state.zones,
        hand: state.zones.hand.filter((_, i) => !picked.has(i)),
        graveyard: [...state.zones.graveyard, ...discarded],
      },
      graveyardPushTick: state.graveyardPushTick + 1,
      log: [...state.log, makeLogEntry(`Discarded ${discarded.length} to hand size`, 'move')],
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

  adjustLife: (delta) => {
    // Pops "−4" off the life counter. Fired here rather than at the call sites so
    // combat, drain and the toolbar buttons all get it for free.
    floatDelta(delta, 'player-life');
    // Same reasoning for the "ouch" glow: every way you can lose life — a bot's
    // combat damage, a drain, your own Phyrexian mana — funnels through here.
    if (delta < 0) useDamageFlash.getState().hit(-delta, get().life);
    set(state => {
      const life = state.life + delta;
      // A bot crossing zero has always been announced; yours never was, so a
      // game could run to −260 with nobody saying anything. Announced on the
      // crossing only, so nudging the counter afterwards stays quiet.
      const died = state.life > 0 && life <= 0;
      return {
        history: pushHistory(state.history, snapshotOf(state)),
        life,
        log: [
          ...state.log,
          makeLogEntry(`${delta >= 0 ? '+' : ''}${delta} life (now ${life})`, 'life'),
          ...(died ? [makeLogEntry('You have been defeated', 'life')] : []),
        ],
      };
    });
  },

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
        const rect = canvasRect(state);
        const snapped = snapArrival(card, x, y, rect.height, ch, state.seatBandHeight);
        const slot = findArrivalSlot(
          next.battlefield,
          snapped.x,
          snapped.y,
          rect.width,
          rect.height,
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

  pushCheckpoint: () => set(state => ({
    history: pushHistory(state.history, snapshotOf(state)),
  })),

  setTappedQuiet: (instanceIds, tapped) => set(state => {
    const ids = new Set(instanceIds);
    return {
      battlefield: state.battlefield.map(b =>
        ids.has(b.instanceId) ? { ...b, tapped } : b,
      ),
    };
  }),

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

  // Turning a card over in hand is a look at the card, not a play: it changes
  // nothing about the game, so it stays out of the history and the log.
  //
  // Ids whose card has since left the hand are dropped on the next toggle, so a
  // card discarded while flipped doesn't come back turned over later.
  toggleHandFlipped: (cardId) => set(state => {
    const flipped = state.flippedHandIds.includes(cardId)
      ? state.flippedHandIds.filter(id => id !== cardId)
      : [...state.flippedHandIds, cardId];
    return { flippedHandIds: flipped.filter(id => state.zones.hand.some(c => c.id === id)) };
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

  emptyZoneInto: (from, to, opts) => set(state => {
    const moving = state.zones[from];
    if (moving.length === 0) return {};
    const history = pushHistory(state.history, snapshotOf(state));
    const merged = [...state.zones[to], ...moving];
    const zones = {
      ...state.zones,
      [from]: [],
      [to]: opts?.shuffle ? fisherYates(merged) : merged,
    };
    const n = moving.length;
    return {
      history,
      zones,
      shuffleTick: opts?.shuffle ? state.shuffleTick + 1 : state.shuffleTick,
      graveyardPushTick: to === 'graveyard' ? state.graveyardPushTick + 1 : state.graveyardPushTick,
      exilePushTick: to === 'exile' ? state.exilePushTick + 1 : state.exilePushTick,
      // Cards arriving in hand deal in, the same as a draw would.
      lastDrawRange: to === 'hand'
        ? { start: state.zones.hand.length, end: state.zones.hand.length + n }
        : { start: -1, end: -1 },
      lastReturnRange: { start: -1, end: -1 },
      log: [...state.log, makeLogEntry(
        `${n} card${n === 1 ? '' : 's'}: ${from} → ${to}${opts?.shuffle ? ' (shuffled)' : ''}`,
        'move',
      )],
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

  // Pull the top n cards off a pile into your hand — "drawing" from whichever
  // pile the cursor is on. The library routes through draw() so it keeps the
  // flight animation and the empty-library message; the other piles take one
  // history entry for the whole batch, so a mis-typed digit is a single undo.
  takeFromPile: (zone, n = 1) => {
    if (zone === 'library') { get().draw(n); return; }
    set(state => {
      const pile = state.zones[zone];
      const taken = pile.slice(0, n);
      if (taken.length === 0) {
        return { log: [...state.log, makeLogEntry(`${zone} is empty`, 'move')] };
      }
      const history = pushHistory(state.history, snapshotOf(state));
      const before = state.zones.hand.length;
      const zones = { ...state.zones, hand: [...state.zones.hand, ...taken] };
      zones[zone] = pile.slice(taken.length);
      return {
        history,
        zones,
        // Cards arriving from a face-up pile slide in from the top, same as a
        // card returned from the battlefield — they were never in the library.
        lastReturnRange: { start: before, end: before + taken.length },
        lastDrawRange: { start: -1, end: -1 },
        log: [...state.log, makeLogEntry(
          taken.length === 1
            ? `${taken[0].name}: ${zone} → hand`
            : `Took ${taken.length} cards: ${zone} → hand`,
          'move',
        )],
      };
    });
  },

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

  setCardEdit: (instanceId, edit) => set(state => {
    const hit = state.battlefield.find(b => b.instanceId === instanceId);
    if (!hit) return {};
    return {
      history: pushHistory(state.history, snapshotOf(state)),
      battlefield: state.battlefield.map(b =>
        b.instanceId === instanceId
          // Dropped rather than set to undefined, so a cleared edit leaves no
          // trace in the snapshots the undo stack keeps.
          ? (edit ? { ...b, edit } : (({ edit: _drop, ...rest }) => rest)(b))
          : b,
      ),
      log: [...state.log, makeLogEntry(describeEdit(hit.card.name, edit), 'counter')],
    };
  }),

  adjustCounter: (instanceId, type, delta, anchor) => {
    const card = get().battlefield.find(b => b.instanceId === instanceId);
    if (!card) return;
    useFloatingText.getState().float(
      `${delta > 0 ? '+' : '−'}${Math.abs(delta)} ${type}`,
      delta > 0 ? 'buff' : 'debuff',
      anchor ?? instanceId,
    );
    const current = card.counters[type] ?? 0;
    get().setCounter(instanceId, type, current + delta);
    set(state => ({
      log: [...state.log, makeLogEntry(`${delta >= 0 ? '+' : ''}${delta} ${type} on ${card.card.name}`, 'counter')],
    }));
  },

  // No history push: a drag fires this many times per second and would flood undo.
  moveCounterBadge: (instanceId, type, x, y) => set(state => ({
    battlefield: state.battlefield.map(b =>
      b.instanceId === instanceId
        ? { ...b, counterPositions: { ...(b.counterPositions ?? {}), [type]: { x, y } } }
        : b,
    ),
  })),

  addSticker: (instanceId, text, position) => set(state => {
    const trimmed = text.trim();
    if (!trimmed) return {};
    const history = pushHistory(state.history, snapshotOf(state));
    const sticker: CardSticker = {
      id: makeInstanceId(),
      text: trimmed,
      x: position?.x ?? 8,
      y: position?.y ?? 8,
    };
    const card = state.battlefield.find(b => b.instanceId === instanceId);
    return {
      history,
      battlefield: state.battlefield.map(b =>
        b.instanceId === instanceId ? { ...b, stickers: [...(b.stickers ?? []), sticker] } : b,
      ),
      log: [...state.log, makeLogEntry(`Stickered ${card?.card.name ?? 'card'} "${trimmed}"`, 'counter')],
    };
  }),

  setStickerText: (instanceId, stickerId, text) => set(state => {
    const trimmed = text.trim();
    // An emptied sticker is a deleted sticker — no separate confirm step.
    if (!trimmed) {
      return {
        battlefield: state.battlefield.map(b =>
          b.instanceId === instanceId
            ? { ...b, stickers: (b.stickers ?? []).filter(st => st.id !== stickerId) }
            : b,
        ),
      };
    }
    return {
      battlefield: state.battlefield.map(b =>
        b.instanceId === instanceId
          ? { ...b, stickers: (b.stickers ?? []).map(st => (st.id === stickerId ? { ...st, text: trimmed } : st)) }
          : b,
      ),
    };
  }),

  // No history push: a drag fires this many times per second and would flood undo.
  moveSticker: (instanceId, stickerId, x, y) => set(state => ({
    battlefield: state.battlefield.map(b =>
      b.instanceId === instanceId
        ? { ...b, stickers: (b.stickers ?? []).map(st => (st.id === stickerId ? { ...st, x, y } : st)) }
        : b,
    ),
  })),

  removeSticker: (instanceId, stickerId) => set(state => ({
    battlefield: state.battlefield.map(b =>
      b.instanceId === instanceId
        ? { ...b, stickers: (b.stickers ?? []).filter(st => st.id !== stickerId) }
        : b,
    ),
  })),

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

  // Theft's landing point: put an arbitrary card onto the battlefield without it
  // having come from one of your zones. Same arrival maths as spawnToken.
  addPermanent: (card, position, logText, arrival) => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const rect = canvasRect(state);
    const cx = position?.x ?? Math.floor(rect.width / 2 - 50);
    const cy = position?.y ?? Math.floor(rect.height / 2 - 70);
    const { width: cw, height: ch } = CARD_SIZES[usePlaytestSettings.getState().cardSize];
    const slot = findArrivalSlot(
      state.battlefield, cx, cy,
      rect.width, rect.height,
      false, cw, ch,
    );
    const entry: BattlefieldCard = {
      instanceId: makeInstanceId(),
      card,
      x: slot.x,
      y: slot.y,
      tapped: arrival?.tapped ?? false,
      faceDown: false,
      flipped: false,
      counters: { ...(arrival?.counters ?? {}) },
      // A stolen Lignified creature is still Lignified — the aura didn't move.
      ...(arrival?.edit ? { edit: arrival.edit } : {}),
    };
    return {
      history,
      battlefield: [...state.battlefield, entry],
      log: [...state.log, makeLogEntry(logText ?? `${card.name} entered the battlefield`, 'move')],
    };
  }),

  // The inverse: take a card off the battlefield entirely rather than routing it
  // to a zone, because its next home is an opponent's board.
  releasePermanent: (instanceId) => {
    const entry = get().battlefield.find(b => b.instanceId === instanceId);
    if (!entry) return null;
    set(state => ({
      history: pushHistory(state.history, snapshotOf(state)),
      battlefield: state.battlefield.filter(b => b.instanceId !== instanceId),
    }));
    return entry;
  },

  spawnToken: (card, position) => set(state => {
    const history = pushHistory(state.history, snapshotOf(state));
    const rect = canvasRect(state);
    const cx = position?.x ?? Math.floor(rect.width / 2 - 50);
    const cy = position?.y ?? Math.floor(rect.height / 2 - 70);
    const { width: cw, height: ch } = CARD_SIZES[usePlaytestSettings.getState().cardSize];
    const slot = findArrivalSlot(
      state.battlefield,
      cx,
      cy,
      rect.width,
      rect.height,
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

  undo: () => {
    const state = get();
    if (state.history.length === 0) return;
    const prev = state.history[state.history.length - 1];

    // Other stores first: they're independent of the log rewrite below, and
    // doing them outside the set updater keeps that updater pure.
    restoreAll(prev.participants);

    set(s => {
      // Walk back through the log and mark the most recent non-undone, non-meta
      // entry as undone. "Undo" entries themselves are skipped so re-undoing
      // strikes out a real action each time, not a previous undo line.
      const log = [...s.log];
      for (let i = log.length - 1; i >= 0; i--) {
        const e = log[i];
        if (e.undone) continue;
        if (e.text === 'Undo') continue;
        log[i] = { ...e, undone: true };
        break;
      }
      log.push(makeLogEntry('Undo', 'system'));
      return {
        history: s.history.slice(0, -1),
        zones: prev.zones,
        battlefield: prev.battlefield,
        life: prev.life,
        turn: prev.turn,
        log,
      };
    });
  },

  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
  setHovered: (id) => set({ hovered: id }),
  setHoveredPile: (zone) => set({ hoveredPile: zone }),
  setPileDrawPending: (pending) => set({ pileDrawPending: pending }),
  setHoveredCounter: (id) => set({ hoveredCounter: id }),
  setHoveredDie: (id) => set({ hoveredDie: id }),
  setHoveredHandIndex: (index) => set({ hoveredHandIndex: index }),

  setTrialPins: (trialPins) => set(state => ({
    trialPins,
    log: [...state.log, makeLogEntry(
      trialPins.length === 0
        ? 'Cleared New Card Trial'
        : `New Card Trial set for ${trialPins.map(p => p.cardName).join(', ')}`,
      'system',
    )],
  })),

  appendLog: (text) => set(state => ({ log: [...state.log, makeLogEntry(text)] })),
  clearLog: () => set({ log: [] }),
  showToast: (text) => set(state => ({
    // The tick is what re-triggers the display, so a repeated message still shows.
    toast: { text, tick: (state.toast?.tick ?? 0) + 1 },
  })),

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

  trashLoose: ({ kind, id }) => set(state => {
    const selected = kind === 'counter' ? state.selectedCounterIds : state.selectedDieIds;
    // Only sweep the selection up if the thing being dragged is in it — dragging
    // an unselected counter must not take a stale selection down with it.
    const doomed = new Set(selected.includes(id) ? selected : [id]);
    const noun = kind === 'counter' ? 'counter' : 'die';
    return {
      history: pushHistory(state.history, snapshotOf(state)),
      freeCounters: kind === 'counter'
        ? state.freeCounters.filter(c => !doomed.has(c.id))
        : state.freeCounters,
      freeDice: kind === 'die'
        ? state.freeDice.filter(d => !doomed.has(d.id))
        : state.freeDice,
      selectedCounterIds: kind === 'counter'
        ? state.selectedCounterIds.filter(x => !doomed.has(x))
        : state.selectedCounterIds,
      selectedDieIds: kind === 'die'
        ? state.selectedDieIds.filter(x => !doomed.has(x))
        : state.selectedDieIds,
      log: [...state.log, makeLogEntry(
        doomed.size > 1 ? `Removed ${doomed.size} ${noun}s` : `Removed a ${noun}`,
        'counter',
      )],
    };
  }),

  setSelectedIds: (ids) => set({ selectedIds: ids }),
  setMarqueeSelection: (sel) => set({
    selectedIds: sel.cards,
    selectedCounterIds: sel.counters,
    selectedDieIds: sel.dice,
  }),
  // Ctrl/Cmd-click on a single item: add it to — or remove it from — whatever
  // the marquee already selected, rather than replacing the selection.
  toggleSelect: (kind, id) => set(state => {
    const flip = (list: string[]) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
    if (kind === 'card') return { selectedIds: flip(state.selectedIds) };
    if (kind === 'counter') return { selectedCounterIds: flip(state.selectedCounterIds) };
    return { selectedDieIds: flip(state.selectedDieIds) };
  }),
  clearSelection: () => set(state => (
    state.selectedIds.length === 0 && state.selectedCounterIds.length === 0 && state.selectedDieIds.length === 0
      ? {}
      : { selectedIds: [], selectedCounterIds: [], selectedDieIds: [] }
  )),

  // Clearing the active drag also clears stackedDrag: the flag only describes a
  // drag in progress, and every end-of-drag path already comes through here.
  setDragActive: (active) => set(active ? { dragActiveId: active } : { dragActiveId: null, stackedDrag: false }),
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

  stackSelection: (anchorInstanceId) => set(state => {
    const ids = new Set(state.selectedIds);
    const inPile = state.battlefield.filter(b => ids.has(b.instanceId));
    if (inPile.length < 2) return {};
    // Pile order follows the battlefield array, which is paint order — except
    // the anchor, pulled to the front so the pile only ever grows downwards
    // from the card in your hand and never off the top edge of the table.
    const anchor = inPile.find(b => b.instanceId === anchorInstanceId) ?? inPile[0];
    const order = [anchor, ...inPile.filter(b => b.instanceId !== anchor.instanceId)];

    const { height } = CARD_SIZES[usePlaytestSettings.getState().cardSize];
    const step = pileStep(height, order.length, state.battlefieldRect.height);
    const offsets: Record<string, StackFlightOffset> = {};
    const positioned = order.map((b, i) => {
      const x = anchor.x;
      const y = anchor.y + i * step;
      // Where it was, relative to where it's going — the card renders at this
      // offset for one frame, then transitions it away. See useStackFlight.
      offsets[b.instanceId] = { dx: b.x - x, dy: b.y - y };
      return {
        ...b,
        x,
        y,
        // A card in a pile isn't strapped to anything, and an attached card
        // draws at its parent's offset — it would ignore the spot we just
        // gave it.
        attachedTo: undefined,
      };
    });

    // The pile goes to the end of the array (later = painted on top) so it
    // reads as one object sitting above the rest of the board, each card
    // covering all but the title row of the one before it.
    const rest = state.battlefield.filter(b => !ids.has(b.instanceId));
    const text = `Stacked ${positioned.length} cards`;
    return {
      history: pushHistory(state.history, snapshotOf(state)),
      battlefield: [...rest, ...positioned],
      stackFlight: { tick: (state.stackFlight?.tick ?? 0) + 1, offsets },
      // A drag is holding this pile if one is in progress — the menu path
      // stacks with nothing in hand, and must not claim otherwise.
      stackedDrag: state.dragActiveId !== null,
      toast: { text, tick: (state.toast?.tick ?? 0) + 1 },
      log: [...state.log, makeLogEntry(text, 'move')],
    };
  }),
}));

// Helper: serializable selector for zone counts (used by Sidebar to avoid re-rendering on every change)
export function zoneCount(s: PlaytestState, zone: ZoneKey): number {
  return s.zones[zone].length;
}
