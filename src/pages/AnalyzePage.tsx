import { useState, useEffect, useCallback } from 'react';
import { LaneTabs, type LaneKey } from '@/components/analyze/LaneTabs';
import { WhatYoullSeeStrip } from '@/components/analyze/WhatYoullSeeStrip';
import { PasteLane, type PasteLaneResult } from '@/components/analyze/PasteLane';
import { ListsLane } from '@/components/analyze/ListsLane';
import { GenerateLane } from '@/components/analyze/GenerateLane';
import { hydrateDeckForAnalysis } from '@/components/analyze/analyzeHydration';
import { useStore } from '@/store';
import type { UserCardList } from '@/types';

const LANE_STORAGE_KEY = 'analyze-active-lane';

export function AnalyzePage() {
  const [activeLane, setActiveLane] = useState<LaneKey>(() => {
    const stored = localStorage.getItem(LANE_STORAGE_KEY);
    if (stored === 'paste' || stored === 'lists' || stored === 'generate') return stored;
    return 'paste';
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingListId, setLoadingListId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(LANE_STORAGE_KEY, activeLane);
  }, [activeLane]);

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
    } catch (e) {
      console.error('[AnalyzePage] list hydration failed', e);
      setError('Could not analyze this list. Please try again.');
    } finally {
      setLoading(false);
      setLoadingListId(null);
    }
  }, []);

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
