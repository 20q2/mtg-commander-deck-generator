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
import { BrewDeckListButton } from '@/components/brew/BrewDeckListButton';
import { BrewTrack } from '@/components/brew/BrewTrack';
import { BrewStatsPanel } from '@/components/brew/BrewStatsPanel';
import { BrewStatsButton } from '@/components/brew/BrewStatsButton';
import { BrewCommitFlash } from '@/components/brew/BrewCommitFlash';
import { BrewCelebration } from '@/components/brew/BrewCelebration';
import { BrewPath } from '@/components/brew/BrewPath';
import { BrewNode } from '@/components/brew/BrewNode';
import { BrewQuestionScreen } from '@/components/brew/BrewQuestionScreen';
import { BrewEventScreen } from '@/components/brew/BrewEventScreen';
import { BrewRelicScreen } from '@/components/brew/BrewRelicScreen';
import { BrewRunRecap } from '@/components/brew/BrewRunRecap';
import { BrewManaCapstone } from '@/components/brew/BrewManaCapstone';
import type { ManaPhilosophy } from '@/types';
import { BrewIntro } from '@/components/brew/BrewIntro';

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
  } = useStore();

  const { createList } = useUserLists();

  const [loadingCommander, setLoadingCommander] = useState(false);
  const [progress, setProgress] = useState<{ msg: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The "set off" intro: morph the Start button into the home node, then fan out routes.
  const [intro, setIntro] = useState<{ startRect: DOMRect; target: { x: number; y: number } } | null>(null);
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
      // Show the run story before handing off — the session stays live so the recap can read it.
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

  if (error) return <div className="p-8 text-center text-destructive">{error}</div>;

  const sessionActive = !!brewContext && !!brewState;

  return (
    // The live deck lives in a toggleable drawer (the "Deck list" button), so the choices keep a
    // single, centered column at every step.
    <div ref={contentRef} className="brew-foundry max-w-5xl mx-auto px-4 py-6">
      {/* The morph-and-fly intro plays over everything until it hands off to the first screen. */}
      {intro && <BrewIntro startRect={intro.startRect} target={intro.target} onDone={() => setIntro(null)} />}
      {/* The run recap overlays everything once the deck is finished. */}
      {recap && <BrewRunRecap onContinue={handleViewDeck} />}
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
          {/* Below 1560px the docked rail can't fit — this button opens the same stats in a drawer so
              laptops/tablets see the living stats too. Hidden at ≥1560px (the rail takes over). */}
          <BrewStatsButton />
          {/* Deck list is its own button now: pinned top-right on wide screens (mirroring the stats
              rail), a right-aligned row above the strip on narrower ones. Outside the space-y wrapper
              so its row-margin doesn't push the fixed/HUD layout around. */}
          <BrewDeckListButton />
          <div className="space-y-5 min-w-0">
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
                    ? <BrewNode key={brewState?.history.length ?? 0} onFinish={quickFinish} />
                    : <BrewPath onFinish={quickFinish} onManaBase={() => setCapstone(true)} />}
          </div>
          {progress && <p className="text-center text-xs text-muted-foreground">{progress.msg}</p>}
          </div>
        </>
      )}
    </div>
  );
}
