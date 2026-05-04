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
