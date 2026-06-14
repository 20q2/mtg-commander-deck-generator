import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useStore } from '@/store';
import { getCardByName } from '@/services/scryfall/client';
import { fetchCommanderData } from '@/services/edhrec/client';
import { prepareBrewContext } from '@/services/brew/prepareBrewContext';
import { persistBrewSession, hydrateBrewSession, clearPersistedBrew } from '@/store';
import { finishBrew } from '@/services/brew/finishBrew';
import { trackEvent } from '@/services/analytics';
import type { ThemeResult } from '@/types';
import { BrewSetup } from '@/components/brew/BrewSetup';
import { BrewHealthStrip } from '@/components/brew/BrewHealthStrip';
import { BrewPath } from '@/components/brew/BrewPath';
import { BrewNode } from '@/components/brew/BrewNode';

export function BrewPage() {
  const { commanderName, partnerName } = useParams<{ commanderName: string; partnerName?: string }>();
  const [searchParams] = useSearchParams();
  const brewId = searchParams.get('b');
  const navigate = useNavigate();

  const {
    commander, partnerCommander, colorIdentity, customization, selectedThemes,
    setCommander, setPartnerCommander, setEdhrecStats, setEdhrecThemes, setSelectedThemes,
    setThemesLoading,
    brewContext, brewState, brewNode, startBrewSession, clearBrewSession, setGeneratedDeck,
  } = useStore();

  const [loadingCommander, setLoadingCommander] = useState(false);
  const [progress, setProgress] = useState<{ msg: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 1) Load commander + EDHREC themes/stats from the URL (mirror of BuilderPage).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!commanderName) { navigate('/'); return; }
      const decoded = decodeURIComponent(commanderName);
      if (commander?.name === decoded && selectedThemes.length > 0) return;
      setLoadingCommander(true);
      try {
        const card = commander?.name === decoded ? commander : await getCardByName(decoded, true);
        if (!card) { navigate('/'); return; }
        if (cancelled) return;
        setCommander(card);
        // setThemesLoading must come AFTER setCommander — setCommander resets themesLoading to false.
        setThemesLoading(true);
        const bracketLevel = customization.bracketLevel !== 'all' ? customization.bracketLevel : undefined;
        const data = await fetchCommanderData(card.name, undefined, bracketLevel);
        if (cancelled) return;
        setEdhrecStats(data.stats);
        if (data.themes.length > 0) {
          setEdhrecThemes(data.themes);
          const results: ThemeResult[] = data.themes.map((t, i) => ({
            name: t.name, source: 'edhrec' as const, slug: t.slug,
            deckCount: t.count, popularityPercent: t.popularityPercent, isSelected: i < 2,
          }));
          setSelectedThemes(results);
        }
      } catch (e) {
        console.error(e); if (!cancelled) setError('Could not load commander');
      } finally {
        if (!cancelled) {
          setLoadingCommander(false);
          setThemesLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commanderName]);

  // 1b) Load partner commander from URL if present, or clear if absent (mirror of BuilderPage).
  useEffect(() => {
    if (!commander) return;

    if (!partnerName) {
      // URL has no partner — clear stale partner from store
      const { partnerCommander: current } = useStore.getState();
      if (current) setPartnerCommander(null);
      return;
    }

    const decodedPartnerName = decodeURIComponent(partnerName);
    if (partnerCommander?.name === decodedPartnerName) return;

    async function loadPartnerFromUrl() {
      try {
        const partnerCard = await getCardByName(decodedPartnerName, true);
        if (partnerCard) setPartnerCommander(partnerCard);
      } catch (error) {
        console.error('Failed to load partner commander:', error);
      }
    }

    loadPartnerFromUrl();
  }, [partnerName, commander?.name]);

  // 2) Hydrate an in-progress brew from sessionStorage when ?b=<id> matches.
  useEffect(() => {
    if (brewId && !brewContext && commander) hydrateBrewSession(brewId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brewId, commander?.name]);

  // 3) Persist on every brew-state change.
  useEffect(() => {
    if (brewId && brewState) persistBrewSession(brewId);
  }, [brewId, brewState]);

  async function handleStartBrew() {
    if (!commander) return;
    setProgress({ msg: 'Preparing your pool…', pct: 0 });
    try {
      let collectionNames: Set<string> | undefined;
      if (customization.collectionMode) {
        const { getCollectionNameSet } = await import('@/services/collection/db');
        collectionNames = await getCollectionNameSet();
        if (collectionNames.size === 0) { setError('Collection mode is on but your collection is empty.'); setProgress(null); return; }
      }
      const ctx = await prepareBrewContext({
        commander, partnerCommander, colorIdentity, customization, selectedThemes,
        collectionNames, onProgress: (msg, pct) => setProgress({ msg, pct }),
      });
      startBrewSession(ctx);
      const id = `${Date.now()}`;
      const base = partnerCommander
        ? `/brew/${encodeURIComponent(commander.name)}/${encodeURIComponent(partnerCommander.name)}`
        : `/brew/${encodeURIComponent(commander.name)}`;
      navigate(`${base}?b=${id}`, { replace: true });
      trackEvent('brew_started', { commanderName: commander.name, partnerName: partnerCommander?.name, collectionMode: !!customization.collectionMode });
    } catch (e) {
      console.error(e); setError(e instanceof Error ? e.message : 'Failed to start brew');
    } finally {
      setProgress(null);
    }
  }

  async function handleFinish() {
    if (!brewState || !brewContext) return;
    setProgress({ msg: 'Finishing your deck…', pct: 0 });
    try {
      const deck = await finishBrew(brewContext, brewState, (msg, pct) => setProgress({ msg, pct }));
      setGeneratedDeck(deck);
      trackEvent('brew_finished', { commanderName: brewContext.commander.name, picks: brewState.picks.length });
      const g = `${Date.now()}`;
      sessionStorage.setItem(`deck:${g}`, JSON.stringify(deck));
      const base = partnerCommander
        ? `/build/${encodeURIComponent(brewContext.commander.name)}/${encodeURIComponent(partnerCommander.name)}`
        : `/build/${encodeURIComponent(brewContext.commander.name)}`;
      if (brewId) clearPersistedBrew(brewId);
      clearBrewSession();
      navigate(`${base}?g=${g}`);
    } catch (e) {
      console.error(e); setError(e instanceof Error ? e.message : 'Failed to finish');
    } finally {
      setProgress(null);
    }
  }

  if (error) return <div className="p-8 text-center text-destructive">{error}</div>;

  const sessionActive = !!brewContext && !!brewState;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {!sessionActive ? (
        <BrewSetup
          loadingCommander={loadingCommander}
          progress={progress}
          onStart={handleStartBrew}
        />
      ) : (
        <div className="space-y-5">
          <BrewHealthStrip />
          {brewNode ? <BrewNode onFinish={handleFinish} /> : <BrewPath onFinish={handleFinish} />}
          {progress && <p className="text-center text-xs text-muted-foreground">{progress.msg}</p>}
        </div>
      )}
    </div>
  );
}
