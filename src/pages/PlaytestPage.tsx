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
