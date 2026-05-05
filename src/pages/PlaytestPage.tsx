import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, TouchSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { useStore } from '@/store';
import { useUserLists } from '@/hooks/useUserLists';
import { usePlaytestStore } from '@/store/playtestStore';
import type { MoveSource } from '@/components/playtest/types';
import { getCardImageUrl } from '@/services/scryfall/client';
import type { ScryfallCard } from '@/types';
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
import { usePlaytestHotkeys } from '@/components/playtest/hooks/useHotkeys';

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 120, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const [activeCard, setActiveCard] = useState<ScryfallCard | null>(null);
  const [activeFaceDown, setActiveFaceDown] = useState(false);
  const [activeTapped, setActiveTapped] = useState(false);

  function onDragStart(event: DragStartEvent) {
    const data = event.active.data.current as { source?: MoveSource } | undefined;
    const source = data?.source;
    if (!source) return;
    const state = usePlaytestStore.getState();
    let card: ScryfallCard | undefined;
    let faceDown = false;
    let tapped = false;
    if (source.kind === 'zone') {
      card = state.zones[source.zone][source.index];
      if (source.zone === 'library') faceDown = true;
    } else {
      const bf = state.battlefield.find(b => b.instanceId === source.instanceId);
      card = bf?.card;
      faceDown = bf?.faceDown ?? false;
      tapped = bf?.tapped ?? false;
    }
    if (card) {
      setActiveCard(card);
      setActiveFaceDown(faceDown);
      setActiveTapped(tapped);
    }
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    setActiveFaceDown(false);
    setActiveTapped(false);
    const { active, over } = event;
    if (!over) return;
    const sourceData = active.data.current as { source?: MoveSource } | undefined;
    const overData   = over.data.current   as { kind?: string; zone?: string; position?: 'top' | 'bottom'; instanceId?: string; index?: number } | undefined;
    const source = sourceData?.source;
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
      } else {
        moveCard({ source, target: { kind: 'battlefield', x, y, arrived: false } });
      }
      return;
    }

    // Drop on a specific hand slot — insert at that position
    if (overData?.kind === 'hand-slot' && typeof overData.index === 'number') {
      let insertIndex = overData.index;
      // If reordering within the hand, removing the source first shifts later indices
      if (source.kind === 'zone' && source.zone === 'hand' && source.index < insertIndex) {
        insertIndex--;
      }
      moveCard({ source, target: { kind: 'zone', zone: 'hand', index: insertIndex } });
      return;
    }

    // Sidebar pile drops
    if (overData?.kind === 'pile' && overData.zone) {
      const zone = overData.zone as 'graveyard' | 'exile' | 'hand' | 'command';
      moveCard({ source, target: { kind: 'zone', zone } });
      return;
    }

    // Library top/bottom
    if (overData?.kind === 'library' && overData.position) {
      moveCard({ source, target: { kind: 'library', position: overData.position } });
      return;
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  if (error) return <div className="min-h-screen flex items-center justify-center text-red-400">Error: {error}</div>;
  if (!ready) return null;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => { setActiveCard(null); setActiveFaceDown(false); setActiveTapped(false); }}>
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
      <DragOverlay dropAnimation={null} zIndex={9999}>
        {activeCard ? (
          <img
            src={activeFaceDown ? `${import.meta.env.BASE_URL}card-back.png` : getCardImageUrl(activeCard, 'normal')}
            alt={activeCard.name}
            className="rounded-[4px] shadow-2xl ring-2 ring-primary/40"
            style={{
              width: 110,
              cursor: 'grabbing',
              transform: activeTapped ? 'rotate(90deg)' : undefined,
              transformOrigin: 'center',
              filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.5))',
            }}
            draggable={false}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
