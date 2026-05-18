import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, pointerWithin, rectIntersection, type CollisionDetection, type DragEndEvent, type DragMoveEvent, type DragStartEvent, type Modifier } from '@dnd-kit/core';
import { useStore } from '@/store';
import { useUserLists } from '@/hooks/useUserLists';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings, CARD_SIZES } from '@/store/playtestSettingsStore';
import type { CounterColor, DieSides, MoveSource } from '@/components/playtest/types';
import { COUNTER_COLORS } from '@/components/playtest/types';
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
import { PlaytestToast } from '@/components/playtest/PlaytestToast';
import { usePlaytestHotkeys } from '@/components/playtest/hooks/useHotkeys';

// For drags originating in the Create dialog: the active draggable is a large
// (~72px) tile, but the rendered overlay preview (chip/die) is much smaller.
// Default DragOverlay positions the overlay at the active node's translated
// origin, leaving the preview visibly offset from the cursor. This modifier
// re-centers the overlay box on the cursor for create drags only.
const centerCreateOnCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform, active }) => {
  const data = active?.data.current as { createCounter?: unknown; createDie?: unknown } | undefined;
  if (!data?.createCounter && !data?.createDie) return transform;
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

export function PlaytestPage({ kind }: { kind: 'list' | 'generated' }) {
  usePlaytestHotkeys();
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
  const moveCard = usePlaytestStore(s => s.moveCard);
  const spawnToken = usePlaytestStore(s => s.spawnToken);
  const cardSize = usePlaytestSettings(s => s.cardSize);

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
  const [mobileSideOpen, setMobileSideOpen] = useState(false);
  const [activeCreate, setActiveCreate] = useState<
    | { kind: 'counter'; color: CounterColor }
    | { kind: 'die'; sides: DieSides; color: CounterColor }
    | null
  >(null);

  function onDragStart(event: DragStartEvent) {
    const data = event.active.data.current as {
      source?: MoveSource | { kind: 'freecounter'; id: string } | { kind: 'freedie'; id: string };
      tokenCard?: ScryfallCard;
      createCounter?: { color: CounterColor };
      createDie?: { sides: DieSides; color: CounterColor };
    } | undefined;
    if (data?.createCounter) {
      setActiveCreate({ kind: 'counter', color: data.createCounter.color });
      return;
    }
    if (data?.createDie) {
      setActiveCreate({ kind: 'die', sides: data.createDie.sides, color: data.createDie.color });
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
    } else {
      const bf = state.battlefield.find(b => b.instanceId === moveSource.instanceId);
      card = bf?.card;
      faceDown = bf?.faceDown ?? false;
      tapped = bf?.tapped ?? false;
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
    const data = event.active.data.current as { source?: MoveSource | { kind: string } } | undefined;
    const source = data?.source as { kind?: string } | undefined;
    if (!source) return;
    if (source.kind !== 'battlefield' && source.kind !== 'freecounter' && source.kind !== 'freedie') return;
    const { x, y } = event.delta;
    usePlaytestStore.getState().setDragDelta({ x, y });
  }

  function clearDragTracking() {
    const state = usePlaytestStore.getState();
    state.setDragActive(null);
    state.setDragDelta(null);
  }

  function onDragEnd(event: DragEndEvent) {
    try { onDragEndInner(event); } finally { clearDragTracking(); }
  }

  function onDragEndInner(event: DragEndEvent) {
    setActiveCard(null);
    setActiveFaceDown(false);
    setActiveTapped(false);
    setActiveCreate(null);
    const { active, over } = event;
    if (!over) return;
    const sourceData = active.data.current as
      | {
          source?: MoveSource | { kind: 'freecounter'; id: string } | { kind: 'freedie'; id: string };
          tokenCard?: ScryfallCard;
          createCounter?: { color: CounterColor };
          createDie?: { sides: DieSides; color: CounterColor };
        }
      | undefined;
    const overData   = over.data.current   as { kind?: string; zone?: string; position?: 'top' | 'bottom'; instanceId?: string; index?: number } | undefined;

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
            phase: state.phase,
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
      let insertIndex = overData.index;
      const overRect = over.rect as DOMRect | undefined;
      const draggedRect = event.active.rect.current.translated;
      if (overRect && draggedRect) {
        const pointerX = draggedRect.left + draggedRect.width / 2;
        if (pointerX >= overRect.left + overRect.width / 2) {
          insertIndex += 1;
        }
      }
      // If reordering within the hand, removing the source first shifts later indices
      if (source.kind === 'zone' && source.zone === 'hand' && source.index < insertIndex) {
        insertIndex--;
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
        const draggedRect = event.active.rect.current.translated;
        const pointerX = draggedRect ? draggedRect.left + draggedRect.width / 2 : null;
        if (pointerX !== null) {
          const cardEls = Array.from(document.querySelectorAll<HTMLElement>('[data-hand-index]'));
          let insertIndex = cardEls.length;
          for (const el of cardEls) {
            const r = el.getBoundingClientRect();
            if (pointerX < r.left + r.width / 2) {
              insertIndex = Number(el.dataset.handIndex);
              break;
            }
          }
          if (source.kind === 'zone' && source.zone === 'hand' && source.index < insertIndex) {
            insertIndex--;
          }
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
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={() => { setActiveCard(null); setActiveFaceDown(false); setActiveTapped(false); setActiveCreate(null); clearDragTracking(); }}>
      <div className="h-screen w-screen flex flex-col bg-background overflow-hidden">
        <PlaytestToolbar onExit={() => navigate(-1)} onToggleSidePanel={() => setMobileSideOpen(o => !o)} />
        <div className="flex-1 flex min-h-0 relative">
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
        <PlaytestToast />
      </div>
      <DragOverlay dropAnimation={null} zIndex={9999} modifiers={[centerCreateOnCursor]}>
        {activeCard ? (
          <img
            src={activeFaceDown ? `${import.meta.env.BASE_URL}card-back.png` : getCardImageUrl(activeCard, 'normal')}
            alt={activeCard.name}
            className="rounded-[5px] shadow-2xl ring-2 ring-primary/40"
            style={{
              width: CARD_SIZES[cardSize].width + 10,
              cursor: 'grabbing',
              transform: activeTapped ? 'rotate(90deg)' : undefined,
              transformOrigin: 'center',
              filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.5))',
            }}
            draggable={false}
          />
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
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
