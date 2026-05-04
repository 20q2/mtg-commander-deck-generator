import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DndContext, PointerSensor, KeyboardSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { useStore } from '@/store';
import { useUserLists } from '@/hooks/useUserLists';
import { usePlaytestStore } from '@/store/playtestStore';
import type { MoveSource } from '@/components/playtest/types';
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
  const moveCard = usePlaytestStore(s => s.moveCard);
  const attach = usePlaytestStore(s => s.attach);

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

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const sourceData = active.data.current as { source?: MoveSource } | undefined;
    const overData   = over.data.current   as { kind?: string; zone?: string; position?: 'top' | 'bottom'; instanceId?: string } | undefined;
    const source = sourceData?.source;
    if (!source) return;

    // Attachment: dropped onto a battlefield card?
    if (overData?.kind === 'battlefield-card' && overData.instanceId) {
      if (source.kind === 'battlefield' && source.instanceId === overData.instanceId) return; // self-drop
      if (source.kind === 'battlefield') {
        attach(source.instanceId, overData.instanceId);
        return;
      }
      // From hand → battlefield (drop the card normally; user can drag-attach as a separate step)
      if (source.kind === 'zone' && source.zone === 'hand') {
        moveCard({ source, target: { kind: 'battlefield', x: 0, y: 0, arrived: true } });
        return;
      }
    }

    // Battlefield container: position drop
    if (over.id === 'battlefield' && overData?.kind === 'battlefield') {
      const rect = over.rect as DOMRect | undefined;
      const x = (active.rect.current.translated?.left ?? 0) - (rect?.left ?? 0);
      const y = (active.rect.current.translated?.top  ?? 0) - (rect?.top  ?? 0);
      if (source.kind === 'battlefield') {
        // Reposition existing battlefield card — bypass moveCard (no zone change)
        const state = usePlaytestStore.getState();
        const updated = state.battlefield.map(b =>
          b.instanceId === source.instanceId ? { ...b, x, y } : b
        );
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
        moveCard({ source, target: { kind: 'battlefield', x, y, arrived: true } });
      }
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
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
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
    </DndContext>
  );
}
