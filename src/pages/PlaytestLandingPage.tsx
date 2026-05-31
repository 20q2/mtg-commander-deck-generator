import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles, ChevronRight, BookOpen } from 'lucide-react';
import { useStore } from '@/store';
import { useUserLists } from '@/hooks/useUserLists';
import { CommanderIcon } from '@/components/ui/mtg-icons';
import { formatRelativeTime } from '@/lib/utils';

export function PlaytestLandingPage() {
  const navigate = useNavigate();
  const generatedDeck = useStore(s => s.generatedDeck);
  const commander = useStore(s => s.commander);
  const { lists } = useUserLists();

  const playableDecks = useMemo(
    () => lists.filter(l => l.type === 'deck' && l.cards.length > 0).sort((a, b) => b.updatedAt - a.updatedAt),
    [lists]
  );

  const hasGenerated = !!generatedDeck;
  const hasAny = hasGenerated || playableDecks.length > 0;

  return (
    <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
      <div className="aurora-bg" />

      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Home
      </button>

      <div className="space-y-2 mb-8">
        <h2 className="text-2xl font-bold">Playtest</h2>
        <p className="text-sm text-muted-foreground">
          Pick a deck to load into the playtest table.
        </p>
      </div>

      {hasGenerated && (
        <section className="mb-8">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Current generated deck
          </h3>
          <button
            onClick={() => navigate('/playtest/generated')}
            className="w-full flex items-center gap-4 p-4 rounded-xl border border-violet-500/30 bg-violet-500/5 hover:bg-violet-500/10 transition-colors text-left group"
          >
            <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-violet-300" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {commander?.name || generatedDeck?.commander?.name || 'Generated deck'}
              </p>
              <p className="text-xs text-muted-foreground">
                {generatedDeck.stats.totalCards} cards · just generated
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
          </button>
        </section>
      )}

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Saved decks
        </h3>

        {playableDecks.length > 0 ? (
          <div className="grid sm:grid-cols-2 gap-3">
            {playableDecks.map(list => (
              <button
                key={list.id}
                onClick={() => navigate(`/playtest/list/${list.id}`)}
                className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card/50 hover:bg-accent/40 hover:border-border transition-colors text-left group overflow-hidden"
              >
                {list.cachedCommanderArtUrl ? (
                  <div
                    className="w-12 h-12 rounded-md bg-cover bg-center shrink-0 border border-border/40"
                    style={{ backgroundImage: `url(${list.cachedCommanderArtUrl})` }}
                  />
                ) : (
                  <div className="w-12 h-12 rounded-md bg-accent/40 flex items-center justify-center shrink-0">
                    <CommanderIcon size={20} className="text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{list.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {list.commanderName ? `${list.commanderName} · ` : ''}{list.cards.length} cards · {formatRelativeTime(list.updatedAt)}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">No saved decks yet.</p>
            <button
              onClick={() => navigate('/lists')}
              className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <BookOpen className="w-3.5 h-3.5" />
              Go to My Lists
            </button>
          </div>
        )}
      </section>

      {!hasAny && (
        <aside className="mt-10 p-4 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm max-w-md">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Generate a deck from the home page or save one to your lists, then come back here to play.
          </p>
        </aside>
      )}
    </main>
  );
}
