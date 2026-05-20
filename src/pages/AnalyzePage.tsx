import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LaneTabs, type LaneKey } from '@/components/analyze/LaneTabs';
import { WhatYoullSeeStrip } from '@/components/analyze/WhatYoullSeeStrip';
import { PasteLane, type PasteLaneResult } from '@/components/analyze/PasteLane';
import { ListsLane } from '@/components/analyze/ListsLane';
import { GenerateLane } from '@/components/analyze/GenerateLane';
import { CommanderStrip, type AnalyzeSource } from '@/components/analyze/CommanderStrip';
import { hydrateDeckForAnalysis } from '@/components/analyze/analyzeHydration';
import { DeckOptimizer } from '@/components/deck/optimizer';
import { useStore } from '@/store';
import { useUserLists } from '@/hooks/useUserLists';
import { applyCommanderTheme, resetTheme } from '@/lib/commanderTheme';
import { trackEvent } from '@/services/analytics';
import type { UserCardList, GeneratedDeck } from '@/types';

const LANE_STORAGE_KEY = 'analyze-active-lane';

function countCards(deck: GeneratedDeck): number {
  const partner = deck.partnerCommander ? 1 : 0;
  const commander = deck.commander ? 1 : 0;
  const body = Object.values(deck.categories).reduce((n, a) => n + a.length, 0);
  return commander + partner + body;
}

export function AnalyzePage() {
  const [activeLane, setActiveLane] = useState<LaneKey>(() => {
    const stored = localStorage.getItem(LANE_STORAGE_KEY);
    if (stored === 'paste' || stored === 'lists' || stored === 'generate') return stored;
    return 'paste';
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingListId, setLoadingListId] = useState<string | null>(null);
  const [source, setSource] = useState<AnalyzeSource | null>(null);

  const generatedDeck = useStore(s => s.generatedDeck);
  const colorIdentityStore = useStore(s => s.colorIdentity);
  const { lists } = useUserLists();
  const [searchParams] = useSearchParams();
  const listIdParam = searchParams.get('listId');

  const prevLaneRef = useRef<LaneKey>(activeLane);
  useEffect(() => {
    localStorage.setItem(LANE_STORAGE_KEY, activeLane);
    if (prevLaneRef.current !== activeLane) {
      trackEvent('analyze_lane_switched', { from: prevLaneRef.current, to: activeLane });
      prevLaneRef.current = activeLane;
    }
  }, [activeLane]);

  // Page-view event with source attribution (one-shot on mount).
  useEffect(() => {
    const generated = useStore.getState().generatedDeck;
    const src = listIdParam ? 'from_list' : (generated ? 'from_generate' : 'direct');
    trackEvent('analyze_page_viewed', { source: src });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hydrate from ?listId= (bridge from ListDeckView) on mount.
  const hydratedListIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!listIdParam || hydratedListIdRef.current === listIdParam) return;
    const list = lists.find(l => l.id === listIdParam);
    if (!list || !list.commanderName) return;
    hydratedListIdRef.current = listIdParam;
    setLoading(true);
    setError(null);
    hydrateDeckForAnalysis({
      cardNames: list.cards,
      commanderName: list.commanderName,
      partnerCommanderName: list.partnerCommanderName,
      deckSize: list.deckSize ?? list.cards.length,
    })
      .then(({ deck, colorIdentity }) => {
        useStore.setState({
          commander: deck.commander,
          partnerCommander: deck.partnerCommander,
          colorIdentity,
          generatedDeck: deck,
        });
        setSource({ kind: 'list', listId: list.id, listName: list.name });
        trackEvent('analyze_deck_loaded', {
          source: 'list',
          cardCount: countCards(deck),
          hasCommander: !!deck.commander,
        });
      })
      .catch(e => {
        console.error('[AnalyzePage] listId hydration failed', e);
        setError('Could not load this list. Please try again.');
      })
      .finally(() => setLoading(false));
  }, [listIdParam, lists]);

  // Detect bridge-from-Generate: if a deck is already in the store on mount
  // and no listId param and no source set yet, treat as 'generated'.
  useEffect(() => {
    if (source !== null) return;
    if (generatedDeck && !listIdParam) {
      setSource({ kind: 'generated' });
      trackEvent('analyze_deck_loaded', {
        source: 'generated',
        cardCount: countCards(generatedDeck),
        hasCommander: !!generatedDeck.commander,
      });
    }
  }, [generatedDeck, listIdParam, source]);

  // Apply commander theme when a deck is loaded.
  useEffect(() => {
    if (colorIdentityStore.length > 0) {
      applyCommanderTheme(colorIdentityStore);
    }
    return () => resetTheme();
  }, [colorIdentityStore]);

  const handlePasteAnalyze = useCallback(async (result: PasteLaneResult) => {
    setLoading(true);
    setError(null);
    try {
      const { deck, colorIdentity } = await hydrateDeckForAnalysis({
        cardNames: result.cardNames,
        commanderName: result.commanderName,
        partnerCommanderName: result.partnerCommanderName,
      });
      useStore.setState({
        commander: deck.commander,
        partnerCommander: deck.partnerCommander,
        colorIdentity,
        generatedDeck: deck,
      });
      setSource({ kind: 'paste' });
      trackEvent('analyze_deck_loaded', {
        source: 'paste',
        cardCount: countCards(deck),
        hasCommander: !!deck.commander,
      });
    } catch (e) {
      console.error('[AnalyzePage] paste hydration failed', e);
      setError('Could not analyze this deck. Check the card names and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleListPick = useCallback(async (list: UserCardList) => {
    setLoading(true);
    setLoadingListId(list.id);
    setError(null);
    try {
      const { deck, colorIdentity } = await hydrateDeckForAnalysis({
        cardNames: list.cards,
        commanderName: list.commanderName,
        partnerCommanderName: list.partnerCommanderName,
        deckSize: list.deckSize ?? list.cards.length,
      });
      useStore.setState({
        commander: deck.commander,
        partnerCommander: deck.partnerCommander,
        colorIdentity,
        generatedDeck: deck,
      });
      setSource({ kind: 'list', listId: list.id, listName: list.name });
      trackEvent('analyze_deck_loaded', {
        source: 'list',
        cardCount: countCards(deck),
        hasCommander: !!deck.commander,
      });
    } catch (e) {
      console.error('[AnalyzePage] list hydration failed', e);
      setError('Could not analyze this list. Please try again.');
    } finally {
      setLoading(false);
      setLoadingListId(null);
    }
  }, []);

  const handleChangeDeck = useCallback(() => {
    if (source?.kind === 'paste') {
      const ok = window.confirm("Discard this analysis? You haven't saved it.");
      if (!ok) return;
    }
    useStore.setState({ generatedDeck: null, commander: null, partnerCommander: null, colorIdentity: [] });
    setSource(null);
    setError(null);
    hydratedListIdRef.current = null;
  }, [source]);

  const deckLoaded = generatedDeck && source;

  if (deckLoaded) {
    const partnerOffset = generatedDeck.partnerCommander ? 1 : 0;
    const totalCards =
      (generatedDeck.commander ? 1 : 0)
      + partnerOffset
      + Object.values(generatedDeck.categories).reduce((n, arr) => n + arr.length, 0);
    const analyzerDeckSize = Math.max(totalCards - 1 - partnerOffset, 0);

    return (
      <main className="flex-1 py-6">
        <CommanderStrip
          deck={generatedDeck}
          colorIdentity={colorIdentityStore}
          source={source}
          onChangeDeck={handleChangeDeck}
        />
        <div className="px-4 sm:px-8 lg:px-12">
          {generatedDeck.commander && (
            <DeckOptimizer
              commanderName={generatedDeck.commander.name}
              partnerCommanderName={generatedDeck.partnerCommander?.name}
              currentCards={Object.values(generatedDeck.categories).flat()}
              deckSize={analyzerDeckSize}
              roleCounts={generatedDeck.roleCounts || {}}
              roleTargets={generatedDeck.roleTargets || {}}
              categories={generatedDeck.categories}
              cardInclusionMap={generatedDeck.cardInclusionMap}
            />
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 px-4 sm:px-8 lg:px-12 py-8">
      <div className="text-center py-6 max-w-2xl mx-auto animate-fade-in">
        <h2 className="text-4xl font-bold mb-3">
          Analyze any{' '}
          <span className="gradient-text">Commander deck</span>
        </h2>
        <p className="text-base text-muted-foreground">
          See what's strong, what's missing, and why.
        </p>
      </div>

      <LaneTabs active={activeLane} onChange={setActiveLane} />

      {error && (
        <div className="max-w-3xl mx-auto mb-3 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-sm text-red-400">
          {error}
        </div>
      )}

      <div
        id={`lane-panel-${activeLane}`}
        role="tabpanel"
        aria-labelledby={`lane-tab-${activeLane}`}
        className="max-w-3xl mx-auto rounded-xl border border-border/40 bg-card/30 backdrop-blur-sm p-6 min-h-[280px]"
      >
        {activeLane === 'paste' && (
          <PasteLane onAnalyze={handlePasteAnalyze} loading={loading} />
        )}
        {activeLane === 'lists' && (
          <ListsLane onPick={handleListPick} loading={loading} loadingListId={loadingListId} />
        )}
        {activeLane === 'generate' && <GenerateLane />}
      </div>

      <WhatYoullSeeStrip />
    </main>
  );
}
