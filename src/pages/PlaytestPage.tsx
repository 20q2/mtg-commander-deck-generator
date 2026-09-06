import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, pointerWithin, rectIntersection, type CollisionDetection, type DragEndEvent, type DragMoveEvent, type DragStartEvent, type Modifier } from '@dnd-kit/core';
import { useStore } from '@/store';
import { useUserLists } from '@/hooks/useUserLists';
import { usePageTitle } from '@/hooks/usePageTitle';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings, CARD_SIZES } from '@/store/playtestSettingsStore';
import type { BattlefieldCard as BfCard, CounterColor, DieSides, MoveSource } from '@/components/playtest/types';
import { COUNTER_COLORS } from '@/components/playtest/types';
import { battlefieldCardAt, handInsertAt } from '@/components/playtest/utils';
import { CardOverlays, CardCounterChip } from '@/components/playtest/CardOverlays';
import { getCardImageUrl } from '@/services/scryfall/client';
import type { ScryfallCard } from '@/types';
import { PlaytestToolbar } from '@/components/playtest/PlaytestToolbar';
import { Battlefield } from '@/components/playtest/Battlefield';
import { Hand } from '@/components/playtest/Hand';
import { GameLog } from '@/components/playtest/GameLog';
import { MulliganModal } from '@/components/playtest/modals/MulliganModal';
import { ScryMillSurveilModal } from '@/components/playtest/modals/ScryMillSurveilModal';
import { ZoneViewerModal } from '@/components/playtest/modals/ZoneViewerModal';
import { TokenSpawnModal } from '@/components/playtest/modals/TokenSpawnModal';
import { CreateModal } from '@/components/playtest/modals/CreateModal';
import { NewCardTrialModal } from '@/components/playtest/modals/NewCardTrialModal';
import { useOpponentStore } from '@/store/opponentStore';
import { captureAll } from '@/store/undoBridge';
import { AddOpponentModal } from '@/components/playtest/opponents/AddOpponentModal';
import { OpponentZoneModal } from '@/components/playtest/opponents/OpponentZoneModal';
import { PlaytestToast } from '@/components/playtest/PlaytestToast';
import { FloatingTextLayer } from '@/components/playtest/FloatingTextLayer';
import { trackEvent } from '@/services/analytics';
import { usePlaytestHotkeys } from '@/components/playtest/hooks/useHotkeys';

// For drags originating in the Create dialog: the active draggable is a large
// (~72px) tile, but the rendered overlay preview (chip/die) is much smaller.
// Default DragOverlay positions the overlay at the active node's translated
// origin, leaving the preview visibly offset from the cursor. This modifier
// re-centers the overlay box on the cursor for create drags only.
const centerCreateOnCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform, active }) => {
  const data = active?.data.current as {
    createCounter?: unknown; createDie?: unknown; createCardCounter?: unknown; createSticker?: unknown;
  } | undefined;
  if (!data?.createCounter && !data?.createDie && !data?.createCardCounter && !data?.createSticker) return transform;
  if (!draggingNodeRect || !activatorEvent) return transform;
  const ev = activatorEvent as MouseEvent | PointerEvent;
  if (typeof ev.clientX !== 'number' || typeof ev.clientY !== 'number') return transform;
  const offsetX = ev.clientX - draggingNodeRect.left;
  const offsetY = ev.clientY - draggingNodeRect.top;
  return {
    ...transform,
    x: transform.x + offsetX - draggingNodeRect.width / 2,
    y: transform.y + offsetY - draggingNodeRect.height / 2,
  };
};

/**
 * Where the dragged card actually sits at the moment of release, in viewport
 * coordinates.
 *
 * Derived from the drag's own initial rect plus its total delta rather than
 * read off `rect.current.translated`, which is not dependable once the drag
 * has ended. Both the hand's insertion point and the flight the card makes
 * into its slot are measured from this, so they cannot disagree.
 */
function releaseRect(event: DragEndEvent): { left: number; top: number; width: number } | null {
  const initial = event.active.rect.current.initial;
  if (!initial) return null;
  return {
    left: initial.left + event.delta.x,
    top: initial.top + event.delta.y,
    width: initial.width,
  };
}

/**
 * A pasted deck exists only in the history entry that launched it — nothing is
 * saved. `history.state` survives a reload, so a refresh on /playtest/pasted keeps
 * the deck (the game itself restarts, same as a generated deck).
 */
export interface PastedPlaytestDeck {
  cardNames: string[];
  commanderName?: string;
  partnerCommanderName?: string;
  /** How the deck got here — hand-pasted, or decoded from a "#d=" share link. */
  origin?: 'paste' | 'shared';
}

export function PlaytestPage({ kind }: { kind: 'list' | 'generated' | 'pasted' }) {
  usePlaytestHotkeys();
  const navigate = useNavigate();
  const params = useParams<{ listId: string }>();
  const location = useLocation();
  const generatedDeck = useStore(s => s.generatedDeck);
  const { getListById } = useUserLists();

  const pastedDeck = (location.state as { pastedDeck?: PastedPlaytestDeck } | null)?.pastedDeck ?? null;

  const playtestDeckName = kind === 'list'
    ? getListById(params.listId ?? '')?.name
    : kind === 'pasted'
    ? pastedDeck?.commanderName ?? (pastedDeck?.origin === 'shared' ? 'Shared deck' : 'Pasted deck')
    : generatedDeck?.commander?.name;
  usePageTitle([playtestDeckName, 'Playtest']);

  const hydrate = usePlaytestStore(s => s.hydrate);
  const exit = usePlaytestStore(s => s.exit);
  const ready = usePlaytestStore(s => s.ready);
  const loading = usePlaytestStore(s => s.loading);
  const error = usePlaytestStore(s => s.error);
  const modal = usePlaytestStore(s => s.modal);
  const moveCard = usePlaytestStore(s => s.moveCard);
  const spawnToken = usePlaytestStore(s => s.spawnToken);
  const cardSize = usePlaytestSettings(s => s.cardSize);

  useEffect(() => {
    if (kind === 'generated') {
      if (!generatedDeck) { navigate('/'); return; }
      hydrate({ kind: 'generated', deck: generatedDeck });
    } else if (kind === 'pasted') {
      // No deck in history state means the URL was opened cold — send them back to
      // the hub to paste again rather than showing an empty table.
      if (!pastedDeck || pastedDeck.cardNames.length === 0) { navigate('/playtest'); return; }
      hydrate({ kind: 'pasted', ...pastedDeck });
    } else {
      const list = params.listId ? getListById(params.listId) : null;
      if (!list) { navigate('/lists'); return; }
      hydrate({ kind: 'list', list });
    }
    // Opponents belong to the table you're sitting at, not to the app — leaving
    // or loading a different deck clears them rather than seating them again
    // across an unrelated game.
    useOpponentStore.getState().clearAll();
    return () => { exit(); useOpponentStore.getState().clearAll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, params.listId]);

  // Fire a playtest_started event once the hydrate completes, so we can track
  // adoption of the playtest feature.
  useEffect(() => {
    if (!ready) return;
    const state = usePlaytestStore.getState();
    const src = state.source;
    if (!src) return;
    const zones = state.zones;
    const totalCards =
      zones.library.length + zones.hand.length + zones.command.length +
      zones.graveyard.length + zones.exile.length;
    trackEvent('playtest_started', {
      source: src.kind,
      deckName: src.name,
      commanderName: src.commanderNames?.join(' // ') || undefined,
      libraryCount: zones.library.length,
      totalCards,
    });
    // Only fire on the rising edge of `ready`; if user re-hydrates we'll see a
    // new mount via the route change.
  }, [ready]);

  // Single PointerSensor handles mouse + touch + pen via Pointer Events. A
  // small 5px activation distance lets a quick tap pass through as a click
  // (to play the top card / open a popover) while any drag motion starts a
  // drag without the 120ms hold that TouchSensor would have required.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // Custom collision detection: when the pointer is over multiple droppables,
  // prefer ones marked `floating: true` (e.g. the zone viewer popup) so they
  // visually-on-top droppables also win the drop logically.
  const collisionDetection: CollisionDetection = (args) => {
    const pointerHits = pointerWithin(args);
    const floating = pointerHits.filter((c) => {
      const d = args.droppableContainers.find((x) => x.id === c.id);
      return d?.data.current?.floating === true;
    });
    if (floating.length > 0) return floating;
    if (pointerHits.length > 0) return pointerHits;
    return rectIntersection(args);
  };

  const [activeCard, setActiveCard] = useState<ScryfallCard | null>(null);
  const [activeFaceDown, setActiveFaceDown] = useState(false);
  const [activeTapped, setActiveTapped] = useState(false);
  // The full battlefield entry behind the drag, when there is one. The live card
  // is hidden at opacity-0 while dragging, so without this the ghost would shed
  // its counters and stickers for the duration of the drag.
  const [activeBfCard, setActiveBfCard] = useState<BfCard | null>(null);
  // Battlefield drags carry the card's own tap + free rotation; drags out of a
  // zone have neither, so they fall back to the flat tapped flag (always 0 there).
  const ghostRotation = activeBfCard
    ? (activeBfCard.tapped ? 90 : 0) + (activeBfCard.rotation ?? 0)
    : (activeTapped ? 90 : 0);
  const [mobileSideOpen, setMobileSideOpen] = useState(false);
  const [activeCreate, setActiveCreate] = useState<
    | { kind: 'counter'; color: CounterColor }
    | { kind: 'die'; sides: DieSides; color: CounterColor }
    | { kind: 'cardCounter'; type: string }
    | { kind: 'sticker'; text: string }
    | null
  >(null);

  function onDragStart(event: DragStartEvent) {
    const data = event.active.data.current as {
      source?: MoveSource | { kind: 'freecounter'; id: string } | { kind: 'freedie'; id: string };
      tokenCard?: ScryfallCard;
      opponentSource?: { opponentId: string; instanceId: string };
      card?: ScryfallCard;
      createCounter?: { color: CounterColor };
      createDie?: { sides: DieSides; color: CounterColor };
      createCardCounter?: { type: string };
      createSticker?: { text: string };
    } | undefined;
    // Stealing off a bot's board: the ghost is just the card, no battlefield entry.
    if (data?.opponentSource && data.card) {
      setActiveCard(data.card);
      setActiveFaceDown(false);
      setActiveTapped(false);
      setActiveBfCard(null);
      return;
    }
    if (data?.createCounter) {
      setActiveCreate({ kind: 'counter', color: data.createCounter.color });
      return;
    }
    if (data?.createDie) {
      setActiveCreate({ kind: 'die', sides: data.createDie.sides, color: data.createDie.color });
      return;
    }
    if (data?.createCardCounter) {
      setActiveCreate({ kind: 'cardCounter', type: data.createCardCounter.type });
      return;
    }
    if (data?.createSticker) {
      setActiveCreate({ kind: 'sticker', text: data.createSticker.text });
      return;
    }
    if (data?.tokenCard) {
      setActiveCard(data.tokenCard);
      setActiveFaceDown(false);
      setActiveTapped(false);
      return;
    }
    const source = data?.source;
    if (!source) return;
    const state = usePlaytestStore.getState();

    // If the user grabs something that isn't part of the current marquee
    // selection, clear that selection — they're starting a fresh interaction.
    const srcKind = (source as { kind: string }).kind;
    const srcId =
      srcKind === 'battlefield' ? (source as { instanceId: string }).instanceId
    : srcKind === 'freecounter' || srcKind === 'freedie' ? (source as { id: string }).id
    : null;
    if (srcId) {
      const inSel =
        srcKind === 'battlefield' ? state.selectedIds.includes(srcId)
      : srcKind === 'freecounter' ? state.selectedCounterIds.includes(srcId)
      : srcKind === 'freedie'     ? state.selectedDieIds.includes(srcId)
      :                             false;
      const hasSel =
        state.selectedIds.length > 0 ||
        state.selectedCounterIds.length > 0 ||
        state.selectedDieIds.length > 0;
      if (hasSel && !inSel) state.clearSelection();
    }

    // Free counter / free die drags participate in group movement.
    if (srcKind === 'freecounter') {
      state.setDragActive({ kind: 'counter', id: (source as { id: string }).id });
      state.setDragDelta({ x: 0, y: 0 });
      return;
    }
    if (srcKind === 'freedie') {
      state.setDragActive({ kind: 'die', id: (source as { id: string }).id });
      state.setDragDelta({ x: 0, y: 0 });
      return;
    }

    const moveSource = source as MoveSource;
    let card: ScryfallCard | undefined;
    let faceDown = false;
    let tapped = false;
    if (moveSource.kind === 'zone') {
      card = state.zones[moveSource.zone][moveSource.index];
      if (moveSource.zone === 'library') faceDown = true;
      setActiveBfCard(null);
    } else {
      const bf = state.battlefield.find(b => b.instanceId === moveSource.instanceId);
      card = bf?.card;
      faceDown = bf?.faceDown ?? false;
      tapped = bf?.tapped ?? false;
      setActiveBfCard(bf ?? null);
      // Track active battlefield card for group-drag follow rendering.
      state.setDragActive({ kind: 'card', id: moveSource.instanceId });
      state.setDragDelta({ x: 0, y: 0 });
    }
    if (card) {
      setActiveCard(card);
      setActiveFaceDown(faceDown);
      setActiveTapped(tapped);
    }
  }

  function onDragMove(event: DragMoveEvent) {
    trackHandParting(event);
    const data = event.active.data.current as { source?: MoveSource | { kind: string } } | undefined;
    const source = data?.source as { kind?: string } | undefined;
    if (!source) return;
    if (source.kind !== 'battlefield' && source.kind !== 'freecounter' && source.kind !== 'freedie') return;
    const { x, y } = event.delta;
    usePlaytestStore.getState().setDragDelta({ x, y });
  }

  /**
   * Live feedback for a card heading into the hand: work out where it would
   * land and let the fan part around that spot. Runs for any card that could
   * end up in the hand, not just hand-to-hand reorders, so a card coming back
   * from the battlefield opens a gap too.
   */
  function trackHandParting(event: DragMoveEvent) {
    const set = usePlaytestStore.getState().setHandDropFanPos;
    const overKind = (event.over?.data.current as { kind?: string; zone?: string } | undefined);
    const overHand = overKind?.kind === 'hand-slot'
      || (overKind?.kind === 'pile' && overKind.zone === 'hand');
    if (!overHand) { set(null); return; }
    // Same initial-plus-delta the drop uses, so the gap the fan opens is never
    // a slot away from where the card actually lands.
    const initial = event.active.rect.current.initial;
    if (!initial) { set(null); return; }
    set(handInsertAt(initial.left + event.delta.x + initial.width / 2).fanPos);
  }

  function clearDragTracking() {
    const state = usePlaytestStore.getState();
    state.setDragActive(null);
    state.setDragDelta(null);
    state.setHandDropFanPos(null);
  }

  function onDragEnd(event: DragEndEvent) {
    try { onDragEndInner(event); } finally { clearDragTracking(); }
  }

  function onDragEndInner(event: DragEndEvent) {
    setActiveCard(null);
    setActiveFaceDown(false);
    setActiveTapped(false);
    setActiveBfCard(null);
    setActiveCreate(null);
    const { active, over } = event;
    if (!over) return;
    const sourceData = active.data.current as
      | {
          source?: MoveSource | { kind: 'freecounter'; id: string } | { kind: 'freedie'; id: string };
          tokenCard?: ScryfallCard;
          opponentSource?: { opponentId: string; instanceId: string };
          card?: ScryfallCard;
          createCounter?: { color: CounterColor };
          createDie?: { sides: DieSides; color: CounterColor };
          createCardCounter?: { type: string };
          createSticker?: { text: string };
        }
      | undefined;
    const overData   = over.data.current   as { kind?: string; zone?: string; position?: 'top' | 'bottom'; instanceId?: string; index?: number; opponentId?: string; attackerId?: string } | undefined;

    // ── Attack: one of your creatures dropped into a seat's combat strip ──
    // Legality — creature, untapped, not already declared — lives in
    // declareAttacker, so this stays a thin router like the branches below.
    if (overData?.kind === 'combatStrip' && overData.opponentId) {
      const src = sourceData?.source;
      if (!src || (src as { kind: string }).kind !== 'battlefield') return;
      const instanceId = (src as { instanceId: string }).instanceId;
      useOpponentStore.getState().declareAttacker(overData.opponentId, instanceId);
      return;
    }

    // ── Block: one of your creatures dropped onto an attacker ──
    if (overData?.kind === 'combatAttacker' && overData.attackerId) {
      const src = sourceData?.source;
      if (!src || (src as { kind: string }).kind !== 'battlefield') return;
      const instanceId = (src as { instanceId: string }).instanceId;
      // Tapped creatures can't block and neither can non-creatures, but that
      // check lives in assignBlocker so the targeting arrow obeys it too.
      useOpponentStore.getState().assignBlocker(overData.attackerId, instanceId);
      return;
    }

    // ── Theft: a bot's permanent dropped on your battlefield ──
    if (sourceData?.opponentSource) {
      if (overData?.kind !== 'battlefield') return;
      const { opponentId, instanceId } = sourceData.opponentSource;
      const card = useOpponentStore.getState().takePermanent(opponentId, instanceId);
      if (!card) return;
      const rect = document.querySelector('[data-battlefield]')?.getBoundingClientRect();
      const x = (active.rect.current.translated?.left ?? 0) - (rect?.left ?? 0);
      const y = (active.rect.current.translated?.top ?? 0) - (rect?.top ?? 0);
      usePlaytestStore.getState().addPermanent(card, { x, y }, `You stole ${card.name}`);
      return;
    }

    // ── Donate: one of your permanents dropped on a bot's lane ──
    if (overData?.kind === 'opponentLane' && overData.opponentId) {
      const src = sourceData?.source;
      if (!src || (src as { kind: string }).kind !== 'battlefield') return;
      const instanceId = (src as { instanceId: string }).instanceId;
      const card = usePlaytestStore.getState().releasePermanent(instanceId);
      if (!card) return;
      useOpponentStore.getState().givePermanent(overData.opponentId, card);
      return;
    }

    // Counter/die spawn from the Create dialog → spawn centered under the cursor.
    // The drag handle is a large tile (~72px), but the spawned chip is much
    // smaller (counter 34, die 44). Using the tile's translated origin would
    // leave the new piece offset from the cursor, so derive the actual cursor
    // position from the original pointer event + the drag delta.
    if (sourceData?.createCounter || sourceData?.createDie) {
      if (over.id === 'battlefield' && overData?.kind === 'battlefield') {
        const rect = over.rect as DOMRect | undefined;
        const activator = event.activatorEvent as { clientX?: number; clientY?: number } | undefined;
        const cursorX = (activator?.clientX ?? 0) + event.delta.x;
        const cursorY = (activator?.clientY ?? 0) + event.delta.y;
        const state = usePlaytestStore.getState();
        if (sourceData.createCounter) {
          // FreeCounter is 34×34 → center under cursor.
          const x = cursorX - (rect?.left ?? 0) - 17;
          const y = cursorY - (rect?.top  ?? 0) - 17;
          state.addFreeCounter(sourceData.createCounter.color, { x, y });
        } else if (sourceData.createDie) {
          // FreeDie is 44×44 → center under cursor.
          const x = cursorX - (rect?.left ?? 0) - 22;
          const y = cursorY - (rect?.top  ?? 0) - 22;
          state.addFreeDie(sourceData.createDie.sides, { x, y }, sourceData.createDie.color);
        }
      }
      return;
    }

    // Card counter / text sticker from the Create dialog → these belong ON a
    // card, so the drop only lands if the cursor is over one. Battlefield cards
    // aren't droppables (the container is), so hit-test the cursor against the
    // card boxes ourselves.
    if (sourceData?.createCardCounter || sourceData?.createSticker) {
      if (over.id === 'battlefield' && overData?.kind === 'battlefield') {
        const rect = over.rect as DOMRect | undefined;
        const activator = event.activatorEvent as { clientX?: number; clientY?: number } | undefined;
        const bx = (activator?.clientX ?? 0) + event.delta.x - (rect?.left ?? 0);
        const by = (activator?.clientY ?? 0) + event.delta.y - (rect?.top  ?? 0);
        const { width: cw, height: ch } = CARD_SIZES[cardSize];
        const state = usePlaytestStore.getState();
        const hit = battlefieldCardAt(state.battlefield, bx, by, cw, ch);
        if (!hit) {
          usePlaytestStore.setState(s => ({
            toast: { text: 'Drop that on a card', tick: (s.toast?.tick ?? 0) + 1 },
          }));
          return;
        }
        if (sourceData.createCardCounter) {
          state.adjustCounter(hit.card.instanceId, sourceData.createCardCounter.type, 1);
        } else if (sourceData.createSticker) {
          // Land it where it was dropped, kept far enough inside the card that
          // the label stays on the art.
          const x = Math.min(Math.max(hit.localX, 0), Math.max(0, cw - 30));
          const y = Math.min(Math.max(hit.localY, 0), Math.max(0, ch - 16));
          state.addSticker(hit.card.instanceId, sourceData.createSticker.text.trim() || 'New sticker', { x, y });
        }
      }
      return;
    }

    // Token spawn from the token dialog → only valid drop is the battlefield
    if (sourceData?.tokenCard) {
      if (over.id === 'battlefield' && overData?.kind === 'battlefield') {
        const rect = over.rect as DOMRect | undefined;
        const x = (active.rect.current.translated?.left ?? 0) - (rect?.left ?? 0);
        const y = (active.rect.current.translated?.top  ?? 0) - (rect?.top  ?? 0);
        spawnToken(sourceData.tokenCard, { x, y });
      }
      return;
    }

    // Free counter drag → reposition on the battlefield (or no-op if dropped elsewhere)
    if (sourceData?.source && (sourceData.source as { kind: string }).kind === 'freecounter') {
      const cs = sourceData.source as { kind: 'freecounter'; id: string };
      if (over.id === 'battlefield' && overData?.kind === 'battlefield') {
        const rect = over.rect as DOMRect | undefined;
        const x = (active.rect.current.translated?.left ?? 0) - (rect?.left ?? 0);
        const y = (active.rect.current.translated?.top  ?? 0) - (rect?.top  ?? 0);
        const state = usePlaytestStore.getState();
        const existing = state.freeCounters.find(c => c.id === cs.id);
        const dx = existing ? x - existing.x : 0;
        const dy = existing ? y - existing.y : 0;
        state.moveFreeCounter(cs.id, x, y);
        state.applyGroupMove({ kind: 'counter', id: cs.id }, dx, dy);
      }
      return;
    }

    // Free die drag → reposition on the battlefield
    if (sourceData?.source && (sourceData.source as { kind: string }).kind === 'freedie') {
      const ds = sourceData.source as { kind: 'freedie'; id: string };
      if (over.id === 'battlefield' && overData?.kind === 'battlefield') {
        const rect = over.rect as DOMRect | undefined;
        const x = (active.rect.current.translated?.left ?? 0) - (rect?.left ?? 0);
        const y = (active.rect.current.translated?.top  ?? 0) - (rect?.top  ?? 0);
        const state = usePlaytestStore.getState();
        const existing = state.freeDice.find(d => d.id === ds.id);
        const dx = existing ? x - existing.x : 0;
        const dy = existing ? y - existing.y : 0;
        state.moveFreeDie(ds.id, x, y);
        state.applyGroupMove({ kind: 'die', id: ds.id }, dx, dy);
      }
      return;
    }

    const source = sourceData?.source as MoveSource | undefined;
    if (!source) return;

    // Battlefield container: position drop
    if (over.id === 'battlefield' && overData?.kind === 'battlefield') {
      const rect = over.rect as DOMRect | undefined;
      const x = (active.rect.current.translated?.left ?? 0) - (rect?.left ?? 0);
      const y = (active.rect.current.translated?.top  ?? 0) - (rect?.top  ?? 0);
      if (source.kind === 'battlefield') {
        // Reposition existing battlefield card — bypass moveCard (no zone change).
        // Move the card to the END of the array so later DOM order paints it
        // on top of the other battlefield cards.
        const state = usePlaytestStore.getState();
        const target = state.battlefield.find(b => b.instanceId === source.instanceId);
        if (!target) return;
        const dx = x - target.x;
        const dy = y - target.y;
        // Move only the active card here; other selected cards (plus selected
        // counters & dice) are repositioned by applyGroupMove. Doing both
        // here would double-apply the delta to followers.
        const others = state.battlefield.filter(b => b.instanceId !== source.instanceId);
        const updated = [...others, { ...target, x, y }];
        usePlaytestStore.setState({
          history: [...state.history, {
            zones: state.zones,
            battlefield: state.battlefield,
            life: state.life,
            turn: state.turn,
            participants: captureAll(),
          }].slice(-20),
          battlefield: updated,
        });
        usePlaytestStore.getState().applyGroupMove({ kind: 'card', id: source.instanceId }, dx, dy);
      } else {
        moveCard({ source, target: { kind: 'battlefield', x, y, arrived: false } });
      }
      return;
    }

    // Reorder within a zone viewer grid — dropping a card onto another card's
    // slot reorders the zone array. Currently meaningful for library only.
    if (overData?.kind === 'zone-card-slot' && typeof overData.index === 'number' && overData.zone) {
      const targetZone = overData.zone;
      let insertIndex = overData.index;
      if (source.kind === 'zone' && source.zone === targetZone) {
        if (source.index === insertIndex) return;
        if (source.index < insertIndex) insertIndex--;
      }
      if (targetZone === 'library') {
        moveCard({ source, target: { kind: 'library', position: insertIndex } });
      } else {
        moveCard({ source, target: { kind: 'zone', zone: targetZone as 'graveyard' | 'exile' | 'command' | 'hand', index: insertIndex } });
      }
      return;
    }

    // Drop on a specific hand slot — insert before or after based on which
    // side of the hovered card's midpoint the cursor is on.
    if (overData?.kind === 'hand-slot' && typeof overData.index === 'number') {
      const release = releaseRect(event);
      // Prefer the shared helper, so the slot matches the gap the fan opened.
      // Falling back to the hovered slot's own index only matters if the drag
      // never reported a rect, which in practice it always does.
      let insertIndex = release
        ? handInsertAt(release.left + release.width / 2).index
        : overData.index;
      // If reordering within the hand, removing the source first shifts later indices
      if (source.kind === 'zone' && source.zone === 'hand' && source.index < insertIndex) {
        insertIndex--;
      }
      if (release) {
        usePlaytestStore.getState().setHandLanding({
          index: insertIndex, x: release.left, y: release.top,
        });
      }
      moveCard({ source, target: { kind: 'zone', zone: 'hand', index: insertIndex } });
      return;
    }

    // Sidebar pile drops
    if (overData?.kind === 'pile' && overData.zone) {
      // No-op when dragging within a zone viewer back onto itself — prevents
      // the entry animation from firing on a same-zone drop.
      if (source.kind === 'zone' && source.zone === overData.zone) {
        return;
      }
      // Dropping onto the library pile = "put on top of library"; route through
      // the typed library target so the top-push animation fires.
      if (overData.zone === 'library') {
        moveCard({ source, target: { kind: 'library', position: 'top' } });
        return;
      }
      const zone = overData.zone as 'graveyard' | 'exile' | 'hand' | 'command';
      // For the hand, infer insertion index from pointer X relative to existing
      // hand cards so drops on the left side go to the left, not the end.
      if (zone === 'hand') {
        const release = releaseRect(event);
        if (release) {
          // Same helper the parting animation uses, so the gap you were shown
          // is the slot the card actually takes.
          let insertIndex = handInsertAt(release.left + release.width / 2).index;
          if (source.kind === 'zone' && source.zone === 'hand' && source.index < insertIndex) {
            insertIndex--;
          }
          // Hand the release point over so the card can fly from where you let
          // go down into its slot, rather than appearing there.
          usePlaytestStore.getState().setHandLanding({
            index: insertIndex, x: release.left, y: release.top,
          });
          moveCard({ source, target: { kind: 'zone', zone: 'hand', index: insertIndex } });
          return;
        }
      }
      moveCard({ source, target: { kind: 'zone', zone } });
      return;
    }

    // Library top/bottom
    if (overData?.kind === 'library' && overData.position) {
      moveCard({ source, target: { kind: 'library', position: overData.position } });
      return;
    }
  }

  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-7 bg-background">
      <div className="relative" style={{ width: 110, height: 154 }}>
        {[0, 1, 2].map(i => (
          <img
            key={i}
            src={`${import.meta.env.BASE_URL}card-back.png`}
            alt=""
            aria-hidden
            draggable={false}
            className="absolute inset-0 w-full h-full rounded-[6px] shadow-[0_10px_30px_rgba(0,0,0,0.55)] ring-1 ring-white/10 animate-shuffle"
            style={{ animationDelay: `${i * 0.18}s`, zIndex: 3 - i }}
          />
        ))}
      </div>
      <div className="text-sm text-muted-foreground/80 tracking-wide animate-pulse">
        Shuffling library…
      </div>
    </div>
  );
  if (error) return <div className="min-h-screen flex items-center justify-center text-red-400">Error: {error}</div>;
  if (!ready) return null;

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={() => { setActiveCard(null); setActiveFaceDown(false); setActiveTapped(false); setActiveBfCard(null); setActiveCreate(null); clearDragTracking(); }}>
      <div className="h-screen w-screen flex flex-col bg-background overflow-hidden">
        <PlaytestToolbar onExit={() => navigate(-1)} onToggleSidePanel={() => setMobileSideOpen(o => !o)} />
        <div className="flex-1 flex min-h-0 relative">
          {/* Opponents are seated across the top of the table, inside
              <Battlefield /> — see OpponentSeats. Each seat owns its own
              combat strip, so there is no full-width combat band any more. */}
          <main className="flex-1 flex flex-col min-w-0">
            <Battlefield />
            <Hand />
          </main>
          {/* Desktop / tablet: inline side panel */}
          <div className="hidden md:flex">
            <GameLog />
          </div>
          {/* Mobile: slide-over overlay. `flex` so the aside child stretches
              to fill the height — otherwise its inner `flex-1 overflow-y-auto`
              has no bounded height and scroll silently fails. */}
          <div
            className={`md:hidden absolute inset-y-0 right-0 z-40 flex transition-transform duration-200 ${mobileSideOpen ? 'translate-x-0' : 'translate-x-full'}`}
          >
            <GameLog />
          </div>
          {mobileSideOpen && (
            <button
              className="md:hidden absolute inset-0 bg-background/40 z-30"
              aria-label="Close side panel"
              onClick={() => setMobileSideOpen(false)}
            />
          )}
        </div>
        {modal?.kind === 'mulligan' && <MulliganModal />}
        {(modal?.kind === 'scry' || modal?.kind === 'mill' || modal?.kind === 'surveil') && <ScryMillSurveilModal />}
        {modal?.kind === 'zoneViewer' && <ZoneViewerModal />}
        {modal?.kind === 'tokens' && <TokenSpawnModal />}
        {modal?.kind === 'create' && <CreateModal />}
        {modal?.kind === 'newCardTrial' && <NewCardTrialModal />}
        {modal?.kind === 'opponents' && <AddOpponentModal />}
        {modal?.kind === 'opponentZone' && (
          <OpponentZoneModal opponentId={modal.opponentId} zone={modal.zone} />
        )}
        <PlaytestToast />
        <FloatingTextLayer />
      </div>
      <DragOverlay dropAnimation={null} zIndex={9999} modifiers={[centerCreateOnCursor]}>
        {activeCard ? (
          // Mirror the battlefield card's box model: an upright outer wrapper at
          // the real card width (this is the node dnd-kit measures for the drop
          // position) with the tap rotation on the INNER image. If the rotation
          // lived on the measured node, dnd-kit would read the rotated (wide-
          // short) bounding box and the dropped card — re-rendered as an upright
          // box that rotates about its center — would land left-and-down of where
          // it was released. Keeping the outer box upright makes the overlay and
          // the dropped card share the exact same center, so it lands where shown.
          // No scale/size bump: the drag preview is the same size as on the field.
          <div style={{ width: CARD_SIZES[cardSize].width, cursor: 'grabbing' }}>
            {/* The rotation moved off the <img> and onto this wrapper so the
                overlays turn with the card. Still not the measured node — that's
                the upright div above — so the drop position is unaffected.

                Uses the card's TOTAL rotation, not just `tapped`: Q/E set a free
                `rotation` on top of the tap, and reading only `tapped` snapped a
                sideways card back upright the moment you picked it up. */}
            <div
              className="relative"
              style={{
                transform: ghostRotation ? `rotate(${ghostRotation}deg)` : undefined,
                transformOrigin: 'center',
              }}
            >
              <img
                src={activeFaceDown ? `${import.meta.env.BASE_URL}card-back.png` : getCardImageUrl(activeCard, 'normal')}
                alt={activeCard.name}
                className="block w-full rounded-[5px] shadow-2xl ring-2 ring-primary/40"
                style={{ filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.5))' }}
                draggable={false}
              />
              {activeBfCard && !activeFaceDown && (
                <CardOverlays
                  card={activeBfCard}
                  cardWidth={CARD_SIZES[cardSize].width}
                  cardHeight={CARD_SIZES[cardSize].height}
                  interactive={false}
                />
              )}
            </div>
          </div>
        ) : activeCreate?.kind === 'counter' ? (
          (() => {
            const cfg = COUNTER_COLORS.find(c => c.key === activeCreate.color) ?? COUNTER_COLORS[0];
            return (
              <div className="w-full h-full flex items-center justify-center pointer-events-none">
                <div
                  className={`flex items-center justify-center rounded-md font-bold text-sm shadow-lg ring-2 ${cfg.chip} ${cfg.ring}`}
                  style={{ width: 34, height: 34, cursor: 'grabbing' }}
                >
                  1
                </div>
              </div>
            );
          })()
        ) : activeCreate?.kind === 'die' ? (
          (() => {
            const cfg = COUNTER_COLORS.find(c => c.key === activeCreate.color) ?? COUNTER_COLORS[2];
            return (
              <div className="w-full h-full flex items-center justify-center pointer-events-none">
                <div
                  className={`flex flex-col items-center justify-center rounded-md font-bold shadow-lg ring-2 ${cfg.chip} ${cfg.ring}`}
                  style={{ width: 44, height: 44, cursor: 'grabbing' }}
                >
                  <span className="text-base leading-none tabular-nums">?</span>
                  <span className="text-[8px] uppercase tracking-wider opacity-80 leading-none mt-0.5">d{activeCreate.sides}</span>
                </div>
              </div>
            );
          })()
        ) : activeCreate?.kind === 'cardCounter' ? (
          <div className="w-full h-full flex items-center justify-center pointer-events-none" style={{ cursor: 'grabbing' }}>
            <CardCounterChip type={activeCreate.type} />
          </div>
        ) : activeCreate?.kind === 'sticker' ? (
          <div className="w-full h-full flex items-center justify-center pointer-events-none">
            <span
              className="inline-block max-w-[110px] truncate px-1.5 py-0.5 rounded bg-teal-500/90 text-white text-[10px] font-bold shadow-md ring-1 ring-teal-200/50"
              style={{ cursor: 'grabbing' }}
            >
              {activeCreate.text.trim() || 'New sticker'}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
