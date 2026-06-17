import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useStore } from '@/store';
import { getCardByName } from '@/services/scryfall/client';
import { fetchCommanderData, formatCommanderNameForUrl } from '@/services/edhrec/client';
import { prepareBrewContext } from '@/services/brew/prepareBrewContext';
import { persistBrewSession, hydrateBrewSession, clearPersistedBrew } from '@/store';
import { finishBrew } from '@/services/brew/finishBrew';
import { trackEvent } from '@/services/analytics';
import { useUserLists } from '@/hooks/useUserLists';
import { brewDeckToList } from '@/services/brew/brewDeckToList';
import type { ThemeResult } from '@/types';
import { BrewSetup } from '@/components/brew/BrewSetup';
import { BrewSplash } from '@/components/brew/BrewSplash';
import { BrewHealthStrip } from '@/components/brew/BrewHealthStrip';
import { BrewTrack } from '@/components/brew/BrewTrack';
import { BrewStatsPanel } from '@/components/brew/BrewStatsPanel';
import { BrewPath } from '@/components/brew/BrewPath';
import { BrewNode } from '@/components/brew/BrewNode';
import { BrewQuestionScreen } from '@/components/brew/BrewQuestionScreen';
import { BrewEventScreen } from '@/components/brew/BrewEventScreen';
import { BrewRelicScreen } from '@/components/brew/BrewRelicScreen';
import { BrewRunRecap } from '@/components/brew/BrewRunRecap';
import { BrewIntro } from '@/components/brew/BrewIntro';

export function BrewPage() {
  const { commanderName, partnerName } = useParams<{ commanderName: string; partnerName?: string }>();
  const [searchParams] = useSearchParams();
  const brewId = searchParams.get('b');
  const navigate = useNavigate();

  const {
    commander, partnerCommander, colorIdentity, customization, selectedThemes,
    setCommander, setPartnerCommander, setEdhrecStats, setEdhrecThemes, setSelectedThemes,
    setThemesLoading,
    brewContext, brewState, brewNode, brewQuestion, brewEvent, brewRelicOffer, startBrewSession, clearBrewSession,
  } = useStore();

  const { createList } = useUserLists();

  const [loadingCommander, setLoadingCommander] = useState(false);
  const [progress, setProgress] = useState<{ msg: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The "set off" intro: morph the Start button into the home node, then fan out routes.
  const [intro, setIntro] = useState<{ startRect: DOMRect; target: { x: number; y: number } } | null>(null);
  // The end-of-run story: once the deck is finished, hold here until the player taps through.
  const [recap, setRecap] = useState<{ listId: string } | null>(null);
  // The "what is this?" splash plays before the setup form on every arrival (skippable in one tap).
  const [showSplash, setShowSplash] = useState(true);
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // 1) Load commander + EDHREC themes/stats from the URL (mirror of BuilderPage).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!commanderName) { navigate('/'); return; }
      // URL carries an EDHREC-style slug (e.g. "heliod-sun-crowned"). Prefer the in-store commander
      // when its slug matches (button entry); otherwise de-slug + fuzzy-resolve it (cold load / shared link).
      const matchesSlug = !!commander && formatCommanderNameForUrl(commander.name) === commanderName;
      if (matchesSlug && selectedThemes.length > 0) return;
      setLoadingCommander(true);
      try {
        // De-slugged name (dashes→spaces) needs Scryfall FUZZY matching (false), not exact — the
        // slug dropped the commas/apostrophes that an exact lookup requires.
        const card = matchesSlug && commander ? commander : await getCardByName(commanderName.replace(/-/g, ' '), false);
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

    const partnerSearch = partnerName.replace(/-/g, ' ');
    if (partnerCommander && formatCommanderNameForUrl(partnerCommander.name) === partnerName) return;

    async function loadPartnerFromUrl() {
      try {
        const partnerCard = await getCardByName(partnerSearch, false); // fuzzy: de-slugged name
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

  // Replay the splash when arriving at a different commander's brew.
  useEffect(() => { setShowSplash(true); }, [commanderName]);

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
      // Capture the button + content frame BEFORE the screen swaps, so the intro can morph the
      // button into the home node. Skipped under reduced-motion (we cut straight to the first screen).
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const btnRect = startButtonRef.current?.getBoundingClientRect();
      const contRect = contentRef.current?.getBoundingClientRect();
      startBrewSession(ctx);
      if (!reduceMotion && btnRect && contRect) {
        setIntro({ startRect: btnRect, target: { x: contRect.left + contRect.width / 2, y: contRect.top + 150 } });
      }
      const id = `${Date.now()}`;
      const base = partnerCommander
        ? `/brew/${formatCommanderNameForUrl(commander.name)}/${formatCommanderNameForUrl(partnerCommander.name)}`
        : `/brew/${formatCommanderNameForUrl(commander.name)}`;
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
      const payload = brewDeckToList(deck, brewContext.commander, brewContext.partnerCommander, brewContext.customization);
      const list = createList(payload.name, payload.cards, '', {
        type: 'deck',
        commanderName: brewContext.commander.name,
        partnerCommanderName: brewContext.partnerCommander?.name,
        deckSize: payload.deckSize,
        generationSummary: payload.generationSummary,
      });
      trackEvent('brew_finished', { commanderName: brewContext.commander.name, picks: brewState.picks.length });
      trackEvent('list_created', { listName: payload.name, cardCount: payload.cards.length });
      // Show the run story before handing off — the session stays live so the recap can read it.
      setRecap({ listId: list.id });
    } catch (e) {
      console.error(e); setError(e instanceof Error ? e.message : 'Failed to finish');
    } finally {
      setProgress(null);
    }
  }

  // Tear down the brew session and head to the finished deck once the player closes the recap.
  function handleViewDeck() {
    const listId = recap?.listId;
    if (brewId) clearPersistedBrew(brewId);
    clearBrewSession();
    setRecap(null);
    if (listId) navigate(`/decks/${listId}`);
  }

  if (error) return <div className="p-8 text-center text-destructive">{error}</div>;

  const sessionActive = !!brewContext && !!brewState;

  return (
    // The live deck lives in a toggleable drawer (the "Deck list" button), so the choices keep a
    // single, centered column at every step.
    <div ref={contentRef} className="max-w-5xl mx-auto px-4 py-6">
      {/* The morph-and-fly intro plays over everything until it hands off to the first screen. */}
      {intro && <BrewIntro startRect={intro.startRect} target={intro.target} onDone={() => setIntro(null)} />}
      {/* The run recap overlays everything once the deck is finished. */}
      {recap && <BrewRunRecap onContinue={handleViewDeck} />}
      {!sessionActive ? (
        showSplash ? (
          <BrewSplash commanderName={commander?.name} onContinue={() => setShowSplash(false)} />
        ) : (
          <BrewSetup
            loadingCommander={loadingCommander}
            progress={progress}
            onStart={handleStartBrew}
            startButtonRef={startButtonRef}
          />
        )
      ) : intro ? (
        // Hold the stage during the intro so the question doesn't flash behind the overlay.
        <div className="min-h-[60vh]" />
      ) : (
        <>
          {/* The living-stats rail is fixed-positioned and mounted here (not inside a screen) so it
              stays put across every fork/node/question/event, not only between rounds. Kept OUTSIDE
              the space-y wrapper so its row-spacing margin doesn't shove the fixed panel down. */}
          <BrewStatsPanel />
          <div className="space-y-5 min-w-0">
          {/* Health strip + the "up next" track read as one stacked unit. */}
          <div className="space-y-2">
            <BrewHealthStrip />
            <BrewTrack />
          </div>
          {/* Key the view on the active screen so each arrival fades in as one cohesive unit
              instead of its pieces blinking into existence one by one. Priority: a relic offer or
              an event "moment" preempts the fork/question/node when the engine surfaces one. */}
          <div
            key={brewRelicOffer ? 'relic' : brewEvent ? `event:${brewEvent.id}` : brewQuestion ? 'question' : brewNode ? 'node' : 'fork'}
            className="animate-brew-view-in"
          >
            {brewRelicOffer
              ? <BrewRelicScreen />
              : brewEvent
                ? <BrewEventScreen key={brewEvent.id} />
                : brewQuestion
                  ? <BrewQuestionScreen key={brewQuestion.id} />
                  : brewNode
                    ? <BrewNode key={brewState?.history.length ?? 0} onFinish={handleFinish} />
                    : <BrewPath onFinish={handleFinish} />}
          </div>
          {progress && <p className="text-center text-xs text-muted-foreground">{progress.msg}</p>}
          </div>
        </>
      )}
    </div>
  );
}
