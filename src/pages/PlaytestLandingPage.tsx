import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Swords, ChevronRight, Loader2 } from 'lucide-react';
import { useStore } from '@/store';
import { useUserLists } from '@/hooks/useUserLists';
import { usePageTitle } from '@/hooks/usePageTitle';
import { LaneTabs, PLAYTEST_LANES, type PlaytestLaneKey } from '@/components/deck-source/LaneTabs';
import { PasteLane, type PasteLaneResult } from '@/components/deck-source/PasteLane';
import { ListsLane } from '@/components/deck-source/ListsLane';
import { readDeckHash, decodeDeckPayload, shareLinkErrorMessage } from '@/services/share/deckLink';
import type { PastedPlaytestDeck } from '@/pages/PlaytestPage';
import type { UserCardList } from '@/types';

const LANE_STORAGE_KEY = 'playtest-active-lane';

// Anything with cards to shuffle. Unlike the Inspector a commander isn't required —
// an empty command zone is a legal way to goldfish.
const PLAYABLE = (l: UserCardList) => l.type === 'deck' && l.cards.length > 0;

export function PlaytestLandingPage() {
  usePageTitle('Playtest');
  const navigate = useNavigate();
  const generatedDeck = useStore(s => s.generatedDeck);
  const commander = useStore(s => s.commander);
  const { lists } = useUserLists();

  const playableDecks = useMemo(() => lists.filter(PLAYABLE), [lists]);

  // ── Shared-link load ──
  // "#d=<payload>" carries a whole decklist, so a link can drop someone straight
  // onto the table with no server involved — the same fragment the Inspector reads.
  // Read at first render, not in the effect, so the very first paint is already the
  // loading view: a recipient must never see the hub flash before their deck loads.
  const [sharedHash] = useState(() => readDeckHash(window.location.hash));
  const [shareError, setShareError] = useState<string | null>(null);
  const loadedShareHash = useRef<string | null>(null);

  const [activeLane, setActiveLane] = useState<PlaytestLaneKey>(() => {
    const stored = localStorage.getItem(LANE_STORAGE_KEY);
    if (stored === 'paste' || stored === 'lists') return stored;
    // First visit: show what they already have, if they have anything.
    return playableDecks.length > 0 ? 'lists' : 'paste';
  });

  const handleLaneChange = useCallback((lane: PlaytestLaneKey) => {
    setActiveLane(lane);
    localStorage.setItem(LANE_STORAGE_KEY, lane);
  }, []);

  const handlePaste = useCallback((result: PasteLaneResult) => {
    const pastedDeck: PastedPlaytestDeck = {
      cardNames: result.cardNames,
      commanderName: result.commanderName,
      partnerCommanderName: result.partnerCommanderName,
      origin: 'paste',
    };
    navigate('/playtest/pasted', { state: { pastedDeck } });
  }, [navigate]);

  const handleListPick = useCallback((list: UserCardList) => {
    navigate(`/playtest/list/${list.id}`);
  }, [navigate]);

  useEffect(() => {
    if (!sharedHash || loadedShareHash.current === sharedHash) return;
    // Ref-guarded rather than cancelled on cleanup: StrictMode mounts effects twice,
    // and cancelling would throw away the only real attempt.
    loadedShareHash.current = sharedHash;
    decodeDeckPayload(sharedHash)
      .then(payload => {
        const pastedDeck: PastedPlaytestDeck = {
          cardNames: payload.cardNames,
          commanderName: payload.commanderName,
          partnerCommanderName: payload.partnerCommanderName,
          origin: 'shared',
        };
        // Replace, so Back leaves for wherever the link was clicked instead of
        // landing on the fragment URL and immediately forwarding here again.
        navigate('/playtest/pasted', { state: { pastedDeck }, replace: true });
      })
      .catch(e => {
        console.error('[PlaytestLandingPage] shared-link decode failed', e);
        setShareError(shareLinkErrorMessage(e, 'Could not load this deck. Check the card names and try again.'));
      });
  }, [sharedHash, navigate]);

  // A share fragment is an explicit request for a specific deck, so show the load
  // rather than the hub — until it fails, at which point the hub is the way forward.
  if (sharedHash && !shareError) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="flex flex-col items-center gap-4 text-center animate-fade-in">
          <Loader2 className="h-10 w-10 text-violet-300/80 animate-spin" />
          <div className="text-base font-medium">Loading shared deck…</div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex-1 px-4 sm:px-8 lg:px-12 py-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent 0 23px, rgba(140, 180, 255, 0.045) 23px 24px),' +
            'repeating-linear-gradient(90deg, transparent 0 23px, rgba(140, 180, 255, 0.045) 23px 24px)',
          animation: 'fadeIn 1200ms ease-out both',
        }}
      />

      <button
        onClick={() => navigate('/')}
        className="relative flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
      >
        <ArrowLeft className="w-4 h-4" />
        Home
      </button>

      <div className="relative text-center py-6 max-w-2xl mx-auto animate-enter-up">
        <Swords className="w-12 h-12 sm:w-14 sm:h-14 mx-auto mb-3 sm:mb-4 text-violet-300 drop-shadow-[0_0_24px_rgba(140,180,255,0.35)]" />
        <h2 className="text-4xl font-bold mb-3">
          Playtest any{' '}
          <span className="gradient-text">Commander deck</span>
        </h2>
        <p className="text-base text-muted-foreground">
          Goldfish a few turns before you sleeve up.
        </p>
      </div>

      <div className="relative">
        {generatedDeck && (
          <button
            onClick={() => navigate('/playtest/generated')}
            className="w-full max-w-3xl mx-auto mb-4 flex items-center gap-4 p-3 rounded-xl border border-violet-500/30 bg-violet-500/5 hover:bg-violet-500/10 transition-colors text-left group animate-enter-up"
            style={{ animationDelay: '60ms' }}
          >
            <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center shrink-0">
              <Swords className="w-5 h-5 text-violet-300" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {commander?.name || generatedDeck.commander?.name || 'Generated deck'}
              </p>
              <p className="text-xs text-muted-foreground">
                {generatedDeck.stats.totalCards} cards · just generated
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
          </button>
        )}

        {shareError && (
          <div className="max-w-3xl mx-auto mb-3 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-sm text-red-400">
            {shareError}
          </div>
        )}

        <div className="animate-enter-up" style={{ animationDelay: '90ms' }}>
          <LaneTabs tabs={PLAYTEST_LANES} active={activeLane} onChange={handleLaneChange} />
        </div>

        <div
          id={`lane-panel-${activeLane}`}
          role="tabpanel"
          aria-labelledby={`lane-tab-${activeLane}`}
          className="max-w-3xl mx-auto rounded-xl border border-border/40 bg-card/30 backdrop-blur-sm p-3 sm:p-6 min-h-[280px] overflow-hidden animate-enter-up"
          style={{ animationDelay: '170ms' }}
        >
          {activeLane === 'paste' && (
            <PasteLane
              onSubmit={handlePaste}
              loading={false}
              requireCommander={false}
              ctaLabel="Play →"
              ctaLoadingLabel="Shuffling…"
            />
          )}
          {activeLane === 'lists' && (
            <ListsLane
              onPick={handleListPick}
              loading={false}
              loadingListId={null}
              filter={PLAYABLE}
            />
          )}
        </div>
      </div>
    </main>
  );
}
