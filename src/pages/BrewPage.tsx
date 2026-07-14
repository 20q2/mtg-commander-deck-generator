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
import { BrewDeckListButton, BrewDeckListColumn } from '@/components/brew/BrewDeckListButton';
import { BrewDebugButton } from '@/components/brew/BrewDebugDrawer';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePageTitle } from '@/hooks/usePageTitle';
import { BrewTrack } from '@/components/brew/BrewTrack';
import { BrewStatsButton, BrewStatsColumn } from '@/components/brew/BrewStatsButton';
import { BrewCommitFlash } from '@/components/brew/BrewCommitFlash';
import { BrewCelebration } from '@/components/brew/BrewCelebration';
import { BrewPath } from '@/components/brew/BrewPath';
import { BrewNode } from '@/components/brew/BrewNode';
import { BrewQuestionScreen } from '@/components/brew/BrewQuestionScreen';
import { BrewEventScreen } from '@/components/brew/BrewEventScreen';
import { BrewRelicScreen } from '@/components/brew/BrewRelicScreen';
import { BrewRunRecap } from '@/components/brew/BrewRunRecap';
import { recordRun, buildJournalRun } from '@/services/brew/journal';
import { generateRunTitle, brewGoal, goalProgress, type BrewMoment } from '@/services/brew/engine';
import { BrewPreviously } from '@/components/brew/BrewPreviously';
import { BrewManaCapstone } from '@/components/brew/BrewManaCapstone';
import type { ManaPhilosophy } from '@/types';
import { BrewIntro } from '@/components/brew/BrewIntro';
import { BrewFinishButton } from '@/components/brew/BrewFinishButton';

// One-time onboarding: the splash shows on the player's first brew, then never again (see showSplash).
const BREW_SPLASH_SEEN_KEY = 'mtg-brew-splash-seen';

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
    brewStatsOpen, toggleBrewStats,
  } = useStore();

  const { createList } = useUserLists();

  const brewCommanderTitle = [commander?.name, partnerCommander?.name].filter(Boolean).join(' & ');
  usePageTitle([brewCommanderTitle, 'Brew']);

  const [loadingCommander, setLoadingCommander] = useState(false);
  const [progress, setProgress] = useState<{ msg: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The "set off" beat, played at the philosophy → fork handoff: the chosen card morphs into the
  // home node, then the routes fan out beneath it.
  const [intro, setIntro] = useState<{ startRect: DOMRect; target: { x: number; y: number } } | null>(null);
  // Flips true once the intro's pin has flown home: from that beat we mount the real fork SKELETON
  // (blank cards, exact final layout) beneath the overlay, so the "set off" animation resolves onto
  // the fork itself and the overlay just fades its pin out over the skeleton's matching node.
  const [introRoutes, setIntroRoutes] = useState(false);
  // The end-of-run story: once the deck is finished, hold here until the player taps through.
  const [recap, setRecap] = useState<{ listId: string } | null>(null);
  // The mana-base capstone: the final land-style choice, shown before the deck is built.
  const [capstone, setCapstone] = useState(false);
  // The "what is this?" splash pitches the mode on a player's FIRST brew only — once they've seen it
  // (and continued), later brews drop straight onto the setup form so repeat use stays fast. The
  // one-tap continue persists the flag.
  const [showSplash, setShowSplash] = useState(() => {
    try { return localStorage.getItem(BREW_SPLASH_SEEN_KEY) !== 'true'; } catch { return true; }
  });
  function dismissSplash() {
    try { localStorage.setItem(BREW_SPLASH_SEEN_KEY, 'true'); } catch { /* ignore */ }
    setShowSplash(false);
  }
  const contentRef = useRef<HTMLDivElement>(null);
  // The active-screen slot — measured at the philosophy choice so the intro's pin lands where the
  // fork's home node is about to render.
  const screenRef = useRef<HTMLDivElement>(null);
  // The live deck-so-far. On screens wide enough (≥1024px) it opens as its own COLUMN beside the
  // game (~25% of the page) instead of an overlay drawer; narrower screens keep the drawer.
  const [deckListOpen, setDeckListOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  // Both side panels (stats on the left, deck list on the right) open as real slide-in columns once
  // the viewport is wide enough (≥1024px); narrower screens fall back to overlay drawers.
  const columnFits = useMediaQuery('(min-width: 1024px)');

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

  // "Previously, on your brew…" — the last moments of a resumed run, shown once as a cliffhanger.
  const [previously, setPreviously] = useState<BrewMoment[] | null>(null);

  // 2) Hydrate an in-progress brew from sessionStorage when ?b=<id> matches.
  useEffect(() => {
    if (brewId && !brewContext && commander) {
      if (hydrateBrewSession(brewId)) {
        const resumed = useStore.getState().brewState;
        if (resumed && resumed.picks.length > 0 && resumed.moments.length > 0) {
          setPreviously(resumed.moments.slice(-2));
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brewId, commander?.name]);

  // 3) Persist on every brew-state change.
  useEffect(() => {
    if (brewId && brewState) persistBrewSession(brewId);
  }, [brewId, brewState]);

  // Each new brew screen (fresh pack, fork, event, question, relic) starts at the top. On mobile a
  // pack round can be ~3 screens tall, so without this you land mid-card-list after every pick
  // instead of at the prompt/HUD. Keyed on the same discriminator the rendered view uses, so it
  // fires exactly once per screen change (a no-op on desktop where the content already fits).
  const brewViewKey = brewRelicOffer ? 'relic'
    : brewEvent ? `event:${brewEvent.id}`
    : brewQuestion ? 'question'
    : brewNode ? `node:${brewState?.history.length ?? 0}`
    : `fork:${brewState?.history.length ?? 0}`;
  useEffect(() => {
    if (brewContext && brewState) window.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brewViewKey]);

  // Re-arriving at a different commander only re-shows the splash if it's still never been seen.
  useEffect(() => {
    try { if (localStorage.getItem(BREW_SPLASH_SEEN_KEY) !== 'true') setShowSplash(true); } catch { /* ignore */ }
  }, [commanderName]);

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
      // No opening ceremony — the run drops straight onto the first pack. The "set off" intro
      // now plays at the philosophy → fork handoff instead (see handlePhilosophyChosen).
      startBrewSession(ctx);
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

  // The philosophy is locked in — play the "set off" beat: the chosen card folds into the home
  // node and the routes fan out beneath it, then the fork takes over. The store has already
  // advanced (BrewRelicScreen commits before calling this), so only run the ceremony when the
  // handoff genuinely lands on the fork — an event/question preempting it would break the promise.
  function handlePhilosophyChosen(rect: DOMRect) {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const slot = screenRef.current?.getBoundingClientRect();
    const s = useStore.getState();
    const forkNext = !s.brewNode && !s.brewQuestion && !s.brewEvent && !s.brewRelicOffer;
    if (reduceMotion || !slot || !forkNext) return;
    // Land the pin where the fork's home node renders: below its heading + leaning readout.
    setIntroRoutes(false);
    setIntro({ startRect: rect, target: { x: slot.left + slot.width / 2, y: slot.top + 145 } });
  }

  async function handleFinish(landStyle?: ManaPhilosophy) {
    if (!brewState || !brewContext) return;
    setCapstone(false);
    setProgress({ msg: 'Finishing your deck…', pct: 0 });
    try {
      const deck = await finishBrew(brewContext, brewState, landStyle, (msg, pct) => setProgress({ msg, pct }));
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
      // Cross-run memory: record the run in the Journal & Treasury (localStorage; never blocks).
      recordRun(buildJournalRun(brewContext, brewState, {
        id: brewId ?? `${Date.now()}`,
        title: generateRunTitle(brewContext, brewState),
        goalLabel: brewGoal(brewContext).label,
        goalDone: goalProgress(brewContext, brewState).done,
      }));
      // The run ends on the recap — the session stays live so it can read the run's state.
      setRecap({ listId: list.id });
    } catch (e) {
      console.error(e); setError(e instanceof Error ? e.message : 'Failed to finish');
    } finally {
      setProgress(null);
    }
  }

  // "Finish for me" is the bail-out: build the deck NOW with a sensible mana base, no extra prompt.
  // We infer the land style from the up-front setup (a budget pool → budget fixing; otherwise the
  // best available fixing) so the player who taps out early still gets a good base without a quiz.
  // The deliberate "Build the Mana Base" route (onManaBase) still opens the capstone for players who
  // play all the way to completion and want to make that final call themselves.
  function quickFinish() {
    const style: ManaPhilosophy = customization.budgetOption === 'budget' ? 'budget' : 'reliable';
    void handleFinish(style);
  }

  // Tear down the brew session and head to the finished deck once the player closes the recap.
  function handleViewDeck() {
    const listId = recap?.listId;
    if (brewId) clearPersistedBrew(brewId);
    clearBrewSession();
    setRecap(null);
    if (listId) navigate(`/decks/${listId}`);
  }

  // The recap's Inspector bridge: same teardown as handleViewDeck, but land in the Inspector —
  // the one-click-fix thesis pointed at the finished deck.
  function handleInspector(listId: string) {
    if (brewId) clearPersistedBrew(brewId);
    clearBrewSession();
    setRecap(null);
    navigate(`/analyze/${listId}`);
  }

  if (error) return <div className="p-8 text-center text-destructive">{error}</div>;

  const sessionActive = !!brewContext && !!brewState;
  // The deck list renders as a real side column only when open, wide enough, and mid-session.
  const deckColumn = sessionActive && deckListOpen && columnFits;
  // The stats render as a left-side column whenever they're open (the persisted default is shown),
  // wide enough, and the deck has begun — a mirror of the deck list. The page reserves matching left
  // padding so the game column sits beside it rather than under it.
  const statsColumn = sessionActive && brewStatsOpen && columnFits && (brewState?.picks.length ?? 0) > 0;
  const reserveColumns = statsColumn || deckColumn;

  // Keep each column mounted through its close so the slide-out actually plays before unmounting.
  // 250ms matches animate-slide-out-*.
  const [deckPanel, setDeckPanel] = useState<{ closing: boolean } | null>(null);
  useEffect(() => {
    if (deckColumn) { setDeckPanel({ closing: false }); return; }
    setDeckPanel(p => (p ? { closing: true } : p));
    const t = window.setTimeout(() => setDeckPanel(null), 250);
    return () => window.clearTimeout(t);
  }, [deckColumn]);

  const [statsPanel, setStatsPanel] = useState<{ closing: boolean } | null>(null);
  useEffect(() => {
    if (statsColumn) { setStatsPanel({ closing: false }); return; }
    setStatsPanel(p => (p ? { closing: true } : p));
    const t = window.setTimeout(() => setStatsPanel(null), 250);
    return () => window.clearTimeout(t);
  }, [statsColumn]);

  return (
    // The choices keep a single, centered column at every step. The stats (left) and deck list
    // (right) each slide in as a fixed column flush with their viewport edge; the page reserves
    // matching padding on whichever side is open so the game recenters between them instead of
    // sliding underneath. When only the (narrow) stats column is open, we mirror its width on the
    // right too, so the game stays centered in the viewport and hugs the drawer rather than drifting
    // to the center of the huge leftover space. When neither is open it simply centers in max-w-6xl.
    <div
      ref={contentRef}
      className={`brew-foundry flex min-h-full flex-col py-6 ${reserveColumns ? 'max-w-none' : 'max-w-6xl mx-auto'} ${statsColumn ? 'pl-[18.75vw]' : 'pl-4'} ${deckColumn ? 'pr-[25vw]' : statsColumn ? 'pr-[18.75vw]' : 'pr-4'}`}
    >
      {/* The morph-and-fly "set off" beat plays over everything until it hands off to the fork. */}
      {intro && <BrewIntro startRect={intro.startRect} target={intro.target} onRoutes={() => setIntroRoutes(true)} onDone={() => { setIntro(null); setIntroRoutes(false); }} />}
      {/* Resume cliffhanger — the last moments of a rejoined run, then straight back in. */}
      {previously && <BrewPreviously moments={previously} onDone={() => setPreviously(null)} />}
      {/* The run recap overlays everything once the deck is finished. */}
      {recap && <BrewRunRecap onContinue={handleViewDeck} onInspector={() => handleInspector(recap.listId)} />}
      {/* The mana-base capstone — the final land-style choice, before the deck is built. */}
      {capstone && <BrewManaCapstone onChoose={(s) => void handleFinish(s)} onSkip={() => void handleFinish()} />}
      {/* The commit consequence banner — overlays everything briefly after a Crossroads commit. */}
      <BrewCommitFlash />
      {/* Earned-beat celebrations — goal complete / hot streak / combo online. */}
      <BrewCelebration />
      {!sessionActive ? (
        showSplash ? (
          <BrewSplash commanderName={commander?.name} onContinue={dismissSplash} />
        ) : (
          <BrewSetup
            loadingCommander={loadingCommander}
            progress={progress}
            onStart={handleStartBrew}
          />
        )
      ) : (
        <>
          {/* Stats trigger — pinned top-left on wide screens (mirroring the deck-list button), a
              left-aligned row above the strip on narrower ones. On wide screens it opens the living
              stats as a slide-in column beside the game; on narrow ones, a left-side drawer. Outside
              the space-y wrapper so its row-margin doesn't push the fixed/HUD layout around. */}
          <BrewStatsButton open={brewStatsOpen} onToggle={(o) => toggleBrewStats(o)} asColumn={columnFits} />
          {/* Deck-list trigger — mirror of the stats button on the opposite margin. */}
          <BrewDeckListButton open={deckListOpen} onToggle={setDeckListOpen} asColumn={columnFits} />
          {/* Developer debug drawer — sits just below the deck-list trigger; a holistic dump of the
              card pool, tag aggregations, and pack-population reasoning. */}
          <BrewDebugButton open={debugOpen} onToggle={setDebugOpen} />
          <div className={`space-y-5 min-w-0 ${reserveColumns ? 'max-w-6xl mx-auto' : ''}`}>
          {/* Health strip + the "up next" track read as one stacked unit. The identity meter rides
              along as a compact strip on narrow screens (the wide-screen rail carries it otherwise). */}
          <div className="space-y-2">
            <BrewHealthStrip />
            <BrewTrack />
          </div>
          {/* Key the view on the active screen so each arrival fades in as one cohesive unit
              instead of its pieces blinking into existence one by one. Priority: a relic offer or
              an event "moment" preempts the fork/question/node when the engine surfaces one. */}
          <div
            ref={screenRef}
            // During the intro's morph/fly the slot is just held empty ('intro'); once the pin lands
            // it becomes the real fork ('fork') so BrewPath's skeleton renders beneath the overlay —
            // and the key STAYS 'fork' after the intro ends, so BrewPath doesn't remount (its
            // skeleton → reveal keeps running straight through the hand-off).
            key={intro && !introRoutes ? 'intro' : brewRelicOffer ? 'relic' : brewEvent ? `event:${brewEvent.id}` : brewQuestion ? 'question' : brewNode ? 'node' : 'fork'}
            className={intro && !introRoutes ? undefined : 'animate-brew-view-in'}
          >
            {intro && !introRoutes
              // Hold just the screen slot while the pin morphs and flies — the health strip, track,
              // and rails stay put; the fork skeleton mounts the moment the pin lands (introRoutes).
              ? <div className="min-h-[42vh]" />
              : brewRelicOffer
                ? <BrewRelicScreen onChosen={handlePhilosophyChosen} />
                : brewEvent
                  ? <BrewEventScreen key={brewEvent.id} />
                  : brewQuestion
                    ? <BrewQuestionScreen key={brewQuestion.id} />
                    : brewNode
                      ? <BrewNode key={brewState?.history.length ?? 0} onFinish={quickFinish} />
                      : <BrewPath onManaBase={() => setCapstone(true)} />}
          </div>
          {progress && <p className="text-center text-xs text-muted-foreground">{progress.msg}</p>}
          </div>
          {/* The bail-out escape hatch — docked at the bottom of the content region (mt-auto), right
              above the site footer, so it stays put instead of bouncing with each screen's height.
              Only on the fork/pack screens (the forced-choice moments carry their own commit). */}
          {!intro && !brewRelicOffer && !brewEvent && !brewQuestion && (
            <BrewFinishButton onFinish={quickFinish} className="mt-auto" />
          )}
          {/* The living-stats side column — fixed flush to the left edge, sliding in/out on toggle.
              Mounted through the close (statsPanel lags statsColumn) so the exit animation plays. */}
          {statsPanel && (
            <BrewStatsColumn closing={statsPanel.closing} onClose={() => toggleBrewStats(false)} />
          )}
          {/* The deck-so-far side column — fixed flush to the right edge, sliding in/out on toggle.
              Mounted through the close (deckPanel lags deckColumn) so the exit animation plays. */}
          {deckPanel && (
            <BrewDeckListColumn closing={deckPanel.closing} onClose={() => setDeckListOpen(false)} />
          )}
        </>
      )}
    </div>
  );
}
