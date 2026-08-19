import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Check, FlaskConical } from 'lucide-react';
import { TAB_SLUG_BY_KEY, TAB_KEY_BY_SLUG, type TabKey } from '@/components/deck/optimizer/constants';
import { LaneTabs, ANALYZE_LANES, type AnalyzeLaneKey } from '@/components/deck-source/LaneTabs';
import { WhatYoullSeeStrip } from '@/components/analyze/WhatYoullSeeStrip';
import { PasteLane, type PasteLaneResult } from '@/components/deck-source/PasteLane';
import { ListsLane } from '@/components/deck-source/ListsLane';
import { GenerateLane } from '@/components/analyze/GenerateLane';
import { type AnalyzeSource } from '@/components/analyze/CommanderStrip';
import { hydrateDeckForAnalysis, type HydrateStage } from '@/components/analyze/analyzeHydration';
import { readDeckHash, decodeDeckPayload, shareLinkErrorMessage } from '@/services/share/deckLink';
import { DeckOptimizer } from '@/components/deck/optimizer';
import { DeckBuildingArea } from '@/components/analyze/DeckBuildingArea';
import { AnalyzeSplit } from '@/components/analyze/AnalyzeSplit';
import { useStore } from '@/store';
import { useUserLists } from '@/hooks/useUserLists';
import { usePageTitle } from '@/hooks/usePageTitle';
import { getCachedCard, getCardByName, isBasicLand } from '@/services/scryfall/client';
import { getCategoryForCard } from '@/services/deckBuilder/cardSwap';
import { parseIntendedThemes } from '@/services/deckUpgrades/deckUpgrades';
import { stampRoleSubtypes } from '@/services/deckBuilder/deckGenerator';
import { applyCommanderTheme, resetTheme } from '@/lib/commanderTheme';
import { getMaxCopies } from '@/lib/utils';
import { trackEvent } from '@/services/analytics';
import type { UserCardList, GeneratedDeck, ScryfallCard } from '@/types';
import type { CardAction } from '@/components/deck/DeckDisplay';
import type { ThemeMembership } from '@/components/analyze/themeMembership';

const LANE_STORAGE_KEY = 'analyze-active-lane';

// Recompute isComplete/missingCards on the stored detected combos by checking
// each combo's card list against the deck's current names. The raw combos list
// is dropped after hydration, so we work from the previously-detected combos
// (which retain their full `cards` array) and just refresh the missing set.
function recomputeDetectedCombos(deck: GeneratedDeck): GeneratedDeck['detectedCombos'] {
  if (!deck.detectedCombos || deck.detectedCombos.length === 0) return deck.detectedCombos;
  const allNames = new Set<string>();
  for (const arr of Object.values(deck.categories)) {
    for (const c of arr) allNames.add(c.name);
  }
  if (deck.commander) allNames.add(deck.commander.name);
  if (deck.partnerCommander) allNames.add(deck.partnerCommander.name);
  return deck.detectedCombos.map(dc => {
    const missingCards = dc.cards.filter(n => !allNames.has(n));
    return { ...dc, missingCards, isComplete: missingCards.length === 0 };
  });
}

function countCards(deck: GeneratedDeck): number {
  const partner = deck.partnerCommander ? 1 : 0;
  const commander = deck.commander ? 1 : 0;
  const body = Object.values(deck.categories).reduce((n, a) => n + a.length, 0);
  return commander + partner + body;
}

export function AnalyzePage() {
  const [activeLane, setActiveLane] = useState<AnalyzeLaneKey>(() => {
    const stored = localStorage.getItem(LANE_STORAGE_KEY);
    if (stored === 'paste' || stored === 'lists' || stored === 'generate') return stored;
    return 'paste';
  });
  // Read at first render, not in the effect, so the very first paint is already
  // the loading view — a share-link recipient must never see the lane hub flash.
  const [initialDeckHash] = useState(() => readDeckHash(window.location.hash));
  const [loading, setLoading] = useState(!!initialDeckHash);
  const [loadStage, setLoadStage] = useState<HydrateStage | null>(
    initialDeckHash ? 'fetching-cards' : null,
  );
  // "12 / 100 cards" under the fetch step — the Scryfall pass is the long one and
  // a bare spinner reads as hung on a cold cache.
  const [cardProgress, setCardProgress] = useState<{ fetched: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingListId, setLoadingListId] = useState<string | null>(null);
  const [source, setSource] = useState<AnalyzeSource | null>(null);
  const [activeOptimizerRole, setActiveOptimizerRole] = useState<string | null>(null);
  const [activeOptimizerCmcRange, setActiveOptimizerCmcRange] = useState<[number, number] | null>(null);
  const [activeOptimizerRoleGroup, setActiveOptimizerRoleGroup] = useState<string | null>(null);
  const [pendingRemovals, setPendingRemovals] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{
        optimizeView?: boolean;
        activeRole?: string | null;
        activeCmcRange?: [number, number] | null;
        activeRoleGroup?: string | null;
      }>).detail;
      if (detail) {
        if ('activeRole' in detail) setActiveOptimizerRole(detail.activeRole ?? null);
        if ('activeCmcRange' in detail) setActiveOptimizerCmcRange(detail.activeCmcRange ?? null);
        if ('activeRoleGroup' in detail) setActiveOptimizerRoleGroup(detail.activeRoleGroup ?? null);
      }
    };
    document.addEventListener('deck-optimizer-state', handler);
    return () => document.removeEventListener('deck-optimizer-state', handler);
  }, []);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ names?: string[] }>).detail;
      setPendingRemovals(new Set(detail?.names ?? []));
    };
    document.addEventListener('deck-optimizer-removals', handler);
    return () => document.removeEventListener('deck-optimizer-removals', handler);
  }, []);

  const generatedDeck = useStore(s => s.generatedDeck);
  const colorIdentityStore = useStore(s => s.colorIdentity);
  const { lists, updateList, createList, getListById } = useUserLists();
  const customization = useStore(s => s.customization);
  const updateCustomization = useStore(s => s.updateCustomization);
  const { param1, param2 } = useParams<{ param1?: string; param2?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const analyzeContext = source?.kind === 'list' ? source.listName : generatedDeck?.commander?.name;
  usePageTitle([analyzeContext, 'Analyze']);

  // URL shape variants under /analyze:
  //   /analyze                       → hub
  //   /analyze/<tab>                 → tab (paste / generated deck)
  //   /analyze/<listId>              → list-loaded, default tab
  //   /analyze/<listId>/<tab>        → list + tab
  // Disambiguation: a TAB_KEY_BY_SLUG entry is a tab; anything else is a listId.
  const param1IsTab = !!(param1 && param1 in TAB_KEY_BY_SLUG);
  const listIdParam: string | null = !param1 ? null : (param1IsTab ? null : param1);
  const tabSlug: string | undefined = param1IsTab ? param1 : param2;

  const activeAnalyzerTab: TabKey = (tabSlug && TAB_KEY_BY_SLUG[tabSlug]) || 'overview';
  // Lift Web deep-link: /analyze/<id>/lift?view=islands reproduces the Overview lift tile's jump
  // (Your deck, islands shown, lands hidden) so the URL is shareable and survives a reload.
  const liftViewParam = activeAnalyzerTab === 'lift' && searchParams.get('view') === 'islands' ? 'islands' : null;
  const [themeMembership, setThemeMembership] = useState<ThemeMembership | null>(null);
  const [misfitNames, setMisfitNames] = useState<Set<string>>(new Set());
  const [focusedMisfitName, setFocusedMisfitName] = useState<string | null>(null);
  const handleAnalyzerTabChange = useCallback((next: TabKey, opts?: { view?: string }) => {
    const slug = TAB_SLUG_BY_KEY[next];
    const path = listIdParam ? `/analyze/${listIdParam}/${slug}` : `/analyze/${slug}`;
    // Push (don't replace) so each tab switch is its own history entry — the
    // browser back button then walks back through tabs to the overview and on
    // to the page the user came from, which is what they expect. The "Inspect a
    // different deck" button no longer relies on navigate(-1) (see
    // handleChangeDeck), so it stays correct even with tab entries in history.
    navigate(opts?.view ? `${path}?view=${opts.view}` : path);
  }, [navigate, listIdParam]);
  const getAnalyzerTabHref = useCallback((next: TabKey) => {
    const slug = TAB_SLUG_BY_KEY[next];
    const path = listIdParam ? `analyze/${listIdParam}/${slug}` : `analyze/${slug}`;
    return `${import.meta.env.BASE_URL}${path}`;
  }, [listIdParam]);

  const prevLaneRef = useRef<AnalyzeLaneKey>(activeLane);
  useEffect(() => {
    localStorage.setItem(LANE_STORAGE_KEY, activeLane);
    if (prevLaneRef.current !== activeLane) {
      trackEvent('analyze_lane_switched', { from: prevLaneRef.current, to: activeLane });
      prevLaneRef.current = activeLane;
    }
  }, [activeLane]);

  // Track which inspector tab people actually use, but only once a deck is loaded
  // (the tabs are inert on the hub). Dedupe on (deck-present, tab) so deck edits —
  // which change the deck reference but not the tab — don't re-fire.
  const lastTabFireRef = useRef('');
  useEffect(() => {
    const present = !!generatedDeck;
    const key = `${present}|${activeAnalyzerTab}`;
    if (!present) { lastTabFireRef.current = key; return; }
    if (lastTabFireRef.current === key) return;
    lastTabFireRef.current = key;
    trackEvent('inspector_tab_viewed', { tab: activeAnalyzerTab });
  }, [activeAnalyzerTab, generatedDeck]);

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
    setLoadStage('fetching-cards');
    setError(null);
    hydrateDeckForAnalysis({
      cardNames: list.cards,
      commanderName: list.commanderName,
      partnerCommanderName: list.partnerCommanderName,
      deckSize: list.deckSize ?? list.cards.length,
      onProgress: setLoadStage,
      onCardProgress: (fetched, total) => setCardProgress({ fetched, total }),
    })
      .then(({ deck, colorIdentity }) => {
        useStore.setState({
          commander: deck.commander,
          partnerCommander: deck.partnerCommander,
          colorIdentity,
          generatedDeck: deck,
        });
        // The Inspector edits this list directly, so its history belongs to it.
        useStore.getState().setHistoryScope(list.id);
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
      .finally(() => { setLoading(false); setLoadStage(null); setCardProgress(null); });
  }, [listIdParam, lists]);

  // Leaving the Inspector detaches history so a later generated deck can't
  // write into this list's trail. The stored entries themselves are kept.
  useEffect(() => () => { useStore.getState().setHistoryScope(null); }, []);

  // Detect bridge-from-Generate: if a deck is already in the store on mount
  // and no listId param and no source set yet, treat as 'generated'.
  // When the URL goes back to a bare /analyze (e.g. browser back from a
  // listId or tab URL), clear the local `source` so the hub renders again.
  // We intentionally do NOT clear the Zustand `generatedDeck` here — the
  // user may have generated it on /build and we don't want to lose their
  // work; the bridge effect below will re-attach it if they re-enter the
  // loaded view via /analyze/<tab>.
  // A share fragment is itself an explicit request for the analyzer view, so a
  // bare "/analyze#d=…" (a hand-trimmed link) must not be treated as the hub —
  // otherwise the deck hydrates and is then immediately thrown away. Checked
  // live rather than from the first render because handleChangeDeck's
  // navigate('/analyze') drops the fragment, which is what releases this guard.
  useEffect(() => {
    if (!listIdParam && !param1IsTab && source !== null && !readDeckHash(window.location.hash)) {
      setSource(null);
      hydratedListIdRef.current = null;
    }
  }, [listIdParam, param1IsTab, source]);

  // Bridge-from-Generate: only hydrate from the Zustand store when the URL
  // signals the analyzer view explicitly (e.g. /analyze/overview). Bare
  // /analyze is always the selection hub, even if a deck happens to be in
  // memory from a previous session — that lets the user pick something new
  // without having to click "Analyze a different deck" first.
  useEffect(() => {
    if (source !== null) return;
    // A shared load owns the source. It writes the deck into Zustand (a
    // synchronous, unbatched store update) just before setting source, so this
    // effect can observe generatedDeck non-null while source is still null and
    // mislabel a shared deck as 'generated'.
    if (readDeckHash(window.location.hash)) return;
    if (generatedDeck && !listIdParam && param1IsTab) {
      setSource({ kind: 'generated' });
      trackEvent('analyze_deck_loaded', {
        source: 'generated',
        cardCount: countCards(generatedDeck),
        hasCommander: !!generatedDeck.commander,
      });
    }
  }, [generatedDeck, listIdParam, source, param1IsTab]);

  // Apply commander theme when a deck is loaded.
  useEffect(() => {
    if (colorIdentityStore.length > 0) {
      applyCommanderTheme(colorIdentityStore);
    }
    return () => resetTheme();
  }, [colorIdentityStore]);

  const handlePasteAnalyze = useCallback(async (result: PasteLaneResult) => {
    // The lane gates its CTA on a commander for us (requireCommander defaults to
    // true), so this is a type narrowing rather than a reachable branch.
    if (!result.commanderName) return;
    setLoading(true);
    setLoadStage('fetching-cards');
    setError(null);
    try {
      const { deck, colorIdentity } = await hydrateDeckForAnalysis({
        cardNames: result.cardNames,
        commanderName: result.commanderName,
        partnerCommanderName: result.partnerCommanderName,
        onProgress: setLoadStage,
        onCardProgress: (fetched, total) => setCardProgress({ fetched, total }),
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
      // Preserve a tab the user deep-linked to (e.g. /analyze/lift-web) before the hub
      // rendered in place of it — otherwise a fresh paste always dumps them on Overview.
      navigate(`/analyze/${tabSlug ?? 'overview'}`);
    } catch (e) {
      console.error('[AnalyzePage] paste hydration failed', e);
      setError('Could not analyze this deck. Check the card names and try again.');
    } finally {
      setLoading(false);
      setLoadStage(null);
      setCardProgress(null);
    }
  }, [navigate, tabSlug]);

  // ── Shared-link load ──
  // A "#d=<payload>" fragment carries a whole decklist, so a link can reproduce
  // this page on someone else's machine with no server involved. Guarded by a
  // ref keyed on the payload so store updates can't re-trigger hydration.
  const loadedShareHash = useRef<string | null>(null);
  useEffect(() => {
    const raw = readDeckHash(window.location.hash);
    if (!raw || loadedShareHash.current === raw) return;
    loadedShareHash.current = raw;

    // Deliberately no cancel-on-cleanup flag. StrictMode mounts this effect
    // twice; the ref guard means only the FIRST run does the work, so a cleanup
    // that cancelled it would discard the only real attempt and leave the page
    // stuck loading forever. The ref alone already prevents double hydration,
    // and React 18 tolerates a setState that lands after unmount.
    (async () => {
      setLoading(true);
      setLoadStage('fetching-cards');
      setError(null);
      try {
        const payload = await decodeDeckPayload(raw);
        const { deck, colorIdentity } = await hydrateDeckForAnalysis({
          cardNames: payload.cardNames,
          commanderName: payload.commanderName,
          partnerCommanderName: payload.partnerCommanderName,
          onProgress: setLoadStage,
          onCardProgress: (fetched, total) => setCardProgress({ fetched, total }),
        });
        useStore.setState({
          commander: deck.commander,
          partnerCommander: deck.partnerCommander,
          colorIdentity,
          generatedDeck: deck,
        });
        setSource({ kind: 'shared' });
        trackEvent('analyze_deck_loaded', {
          source: 'shared',
          cardCount: countCards(deck),
          hasCommander: !!deck.commander,
        });
      } catch (e) {
        console.error('[AnalyzePage] shared-link hydration failed', e);
        setError(shareLinkErrorMessage(e, 'Could not analyze this deck. Check the card names and try again.'));
      } finally {
        setLoading(false);
        setLoadStage(null);
        setCardProgress(null);
      }
    })();
  }, []);

  const handleListPick = useCallback(async (list: UserCardList) => {
    setLoading(true);
    setLoadStage('fetching-cards');
    setLoadingListId(list.id);
    setError(null);
    try {
      const { deck, colorIdentity } = await hydrateDeckForAnalysis({
        cardNames: list.cards,
        commanderName: list.commanderName,
        partnerCommanderName: list.partnerCommanderName,
        deckSize: list.deckSize ?? list.cards.length,
        onProgress: setLoadStage,
        onCardProgress: (fetched, total) => setCardProgress({ fetched, total }),
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
      // Preserve a tab the user deep-linked to (e.g. /analyze/lift-web) before the hub
      // rendered in place of it — otherwise picking a list always dumps them on Overview.
      navigate(param1IsTab ? `/analyze/${list.id}/${tabSlug}` : `/analyze/${list.id}`);
    } catch (e) {
      console.error('[AnalyzePage] list hydration failed', e);
      setError('Could not analyze this list. Please try again.');
    } finally {
      setLoading(false);
      setLoadStage(null);
      setCardProgress(null);
      setLoadingListId(null);
    }
  }, [navigate, param1IsTab, tabSlug]);

  const handleChangeDeck = useCallback(() => {
    // 'shared' is as unsaved as 'paste' — the deck only exists in the link.
    if (source?.kind === 'paste' || source?.kind === 'shared') {
      const ok = window.confirm("Discard this analysis? You haven't saved it.");
      if (!ok) return;
    }
    // For 'generated', the deck belongs to the user's /build session — leave the store intact
    // so navigating back to /build/X?g=… renders the deck view, not settings.
    if (source?.kind !== 'generated') {
      useStore.setState({ generatedDeck: null, commander: null, partnerCommander: null, colorIdentity: [] });
    }
    setSource(null);
    setError(null);
    hydratedListIdRef.current = null;
    // Go straight to the inspector hub — that's where you pick a different deck.
    // (Not navigate(-1): now that tab switches push history entries, a relative
    // back would land on the previous tab instead of leaving the inspector.)
    navigate('/analyze');
  }, [source, navigate]);

  const handleAddCardsToAnalyzerDeck = useCallback(async (names: string[], destination: 'deck' | 'sideboard' | 'maybeboard') => {
    if (destination !== 'deck') return;
    // Resolve any uncached names from Scryfall before we read fresh deck state.
    // Without this, adding a basic land that isn't already in the deck silently
    // no-ops because getCachedCard returns nothing.
    const uncached = names.filter(n => !getCachedCard(n));
    if (uncached.length > 0) {
      await Promise.all(uncached.map(n => getCardByName(n).catch(() => null)));
    }

    const deck = useStore.getState().generatedDeck;
    if (!deck) return;

    // Copies per name, not mere presence: the limit is 1 for almost everything,
    // but basics and the cards whose own text permits duplicates (Nazgûl,
    // Relentless Rats, Dragon's Approach …) allow more, and a presence check
    // made the second copy of those silently impossible to add.
    const copies = new Map<string, number>();
    const countCopy = (n: string) => copies.set(n, (copies.get(n) ?? 0) + 1);
    for (const arr of Object.values(deck.categories)) {
      for (const c of arr) countCopy(c.name);
    }
    if (deck.commander) countCopy(deck.commander.name);
    if (deck.partnerCommander) countCopy(deck.partnerCommander.name);

    const newCategories = { ...deck.categories };
    const addedNames: string[] = [];
    for (const name of names) {
      const card = getCachedCard(name);
      if (!card) continue;
      if ((copies.get(name) ?? 0) >= getMaxCopies(card)) continue;
      stampRoleSubtypes(card);
      const cat = getCategoryForCard(card);
      newCategories[cat] = [...newCategories[cat], card];
      countCopy(name);
      addedNames.push(name);
    }
    if (addedNames.length === 0) return;

    const newInclusionMap = { ...(deck.cardInclusionMap || {}) };
    let scoreDelta = 0;
    for (const name of addedNames) {
      // Stamp 0 only if there is truly no value — never overwrite an existing entry
      // (a card may already be in the map if it was in the gap/swap pools).
      if (newInclusionMap[name] == null) newInclusionMap[name] = 0;
      scoreDelta += newInclusionMap[name];
    }

    const nextDeck: GeneratedDeck = {
      ...deck,
      categories: newCategories,
      cardInclusionMap: newInclusionMap,
      deckScore: (deck.deckScore ?? 0) + scoreDelta,
    };
    useStore.setState({
      generatedDeck: {
        ...nextDeck,
        detectedCombos: recomputeDetectedCombos(nextDeck),
      },
    });

    // Notify DeckOptimizer (which holds the live EDHREC ref) so it can patch
    // any 0-stamped entries with real inclusion/synergy from the EDHREC payload.
    document.dispatchEvent(new CustomEvent('analyze-cards-added', { detail: { names: addedNames } }));

    if (source?.kind === 'list') {
      // getListById reads the module-level list store, NOT this render's `lists`
      // snapshot. That matters: Card Fit's Apply calls remove-then-add in one
      // tick, so a snapshot read here would still hold the pre-removal cards and
      // this write would resurrect every card the removal just persisted away.
      const list = getListById(source.listId);
      if (list) {
        // Allow duplicate basic-land entries; everything else stays singleton.
        const listExisting = new Set(list.cards);
        const toAppend = addedNames.filter(n => {
          const c = getCachedCard(n);
          if (c && isBasicLand(c)) return true;
          return !listExisting.has(n);
        });
        if (toAppend.length > 0) {
          updateList(source.listId, {
            cards: [...list.cards, ...toAppend],
            generationSummary: undefined,
          });
        }
      }
    }
  }, [source, getListById, updateList]);

  const handleRemoveCardsFromAnalyzerDeck = useCallback((names: string[]) => {
    const deck = useStore.getState().generatedDeck;
    if (!deck) return;

    // Build a per-name removal budget: 1 copy per occurrence in `names`.
    // This means callers can pass ["Forest"] to drop one Forest even when
    // the deck contains many basic forests.
    const budget = new Map<string, number>();
    for (const n of names) budget.set(n, (budget.get(n) ?? 0) + 1);

    const newCategories = { ...deck.categories };
    const actuallyRemoved: string[] = [];
    for (const cat of Object.keys(newCategories) as Array<keyof typeof newCategories>) {
      const next: typeof newCategories[typeof cat] = [];
      for (const c of newCategories[cat]) {
        const left = budget.get(c.name) ?? 0;
        if (left > 0) {
          budget.set(c.name, left - 1);
          actuallyRemoved.push(c.name);
          continue;
        }
        next.push(c);
      }
      if (next.length !== newCategories[cat].length) newCategories[cat] = next;
    }
    if (actuallyRemoved.length === 0) return;

    const newInclusionMap = { ...(deck.cardInclusionMap || {}) };
    let scoreDelta = 0;
    for (const name of actuallyRemoved) {
      if (newInclusionMap[name] != null) {
        scoreDelta += newInclusionMap[name];
      }
    }

    const nextDeck: GeneratedDeck = {
      ...deck,
      categories: newCategories,
      cardInclusionMap: newInclusionMap,
      deckScore: Math.max(0, (deck.deckScore ?? 0) - scoreDelta),
    };
    useStore.setState({
      generatedDeck: {
        ...nextDeck,
        detectedCombos: recomputeDetectedCombos(nextDeck),
      },
    });

    if (source?.kind === 'list') {
      // Fresh read from the shared store, not this render's `lists` — see the
      // note in handleAddCardsToAnalyzerDeck.
      const list = getListById(source.listId);
      if (list) {
        // Remove one list entry per removed copy (basics may appear multiple times).
        const removeBudget = new Map<string, number>();
        for (const n of actuallyRemoved) removeBudget.set(n, (removeBudget.get(n) ?? 0) + 1);
        const nextCards: string[] = [];
        for (const cardName of list.cards) {
          const left = removeBudget.get(cardName) ?? 0;
          if (left > 0) { removeBudget.set(cardName, left - 1); continue; }
          nextCards.push(cardName);
        }
        updateList(source.listId, {
          cards: nextCards,
          generationSummary: undefined,
        });
      }
    }
  }, [source, getListById, updateList]);

  // Swap/add from the card preview modal's "Similar Cards" panel (EDHREC-powered),
  // mirroring the deck-view preview. Swap = remove the previewed card, add the pick.
  const handleAnalyzerSwapCard = useCallback((oldCard: ScryfallCard, newCard: ScryfallCard) => {
    handleRemoveCardsFromAnalyzerDeck([oldCard.name]);
    handleAddCardsToAnalyzerDeck([newCard.name], 'deck');
  }, [handleRemoveCardsFromAnalyzerDeck, handleAddCardsToAnalyzerDeck]);

  const handleAnalyzerAddCard = useCallback((newCard: ScryfallCard) => {
    handleAddCardsToAnalyzerDeck([newCard.name], 'deck');
  }, [handleAddCardsToAnalyzerDeck]);

  const handleAnalyzerCardAction = useCallback((card: ScryfallCard, action: CardAction) => {
    const name = card.name;
    switch (action.type) {
      case 'remove':
        handleRemoveCardsFromAnalyzerDeck([name]);
        break;
      case 'addToDeck':
        handleAddCardsToAnalyzerDeck([name], 'deck');
        break;
      case 'mustInclude': {
        const current = customization.mustIncludeCards;
        const has = current.includes(name);
        updateCustomization({ mustIncludeCards: has ? current.filter(n => n !== name) : [...current, name] });
        break;
      }
      case 'exclude': {
        const currentBanned = customization.bannedCards;
        const hasBan = currentBanned.includes(name);
        updateCustomization({ bannedCards: hasBan ? currentBanned.filter(n => n !== name) : [...currentBanned, name] });
        break;
      }
      case 'addToList': {
        const list = getListById(action.listId);
        if (list && !list.cards.includes(name)) {
          updateList(action.listId, { cards: [...list.cards, name] });
        }
        break;
      }
      case 'createListAndAdd':
        createList(action.listName, [name]);
        break;
    }
  }, [handleRemoveCardsFromAnalyzerDeck, handleAddCardsToAnalyzerDeck, customization, updateCustomization, getListById, updateList, createList]);

  const analyzerMenuProps = useMemo(() => ({
    userLists: lists,
    mustIncludeNames: new Set(customization.mustIncludeCards),
    bannedNames: new Set(customization.bannedCards),
    sideboardNames: new Set<string>(),
    maybeboardNames: new Set<string>(),
  }), [lists, customization.mustIncludeCards, customization.bannedCards]);

  const deckLoaded = generatedDeck && source;

  // Show a dedicated loading screen when arriving fresh via /analyze/<listId>
  // — the hub (paste/lists/generate) would be misleading while hydration runs.
  // A share link is the same situation: the visitor asked for a specific deck,
  // so showing them a "paste your deck" chooser for the seconds it takes to
  // hydrate would read as the link having failed. Checked against the live URL
  // rather than the first render, because handleChangeDeck drops the fragment
  // and that has to release this gate.
  const pendingShareLoad = !deckLoaded && !error && !!readDeckHash(window.location.hash);
  const pendingListLoad = !!listIdParam && !deckLoaded && !error;
  if (pendingListLoad || pendingShareLoad) {
    const list = lists.find(l => l.id === listIdParam);
    const steps: { id: HydrateStage; label: string }[] = [
      { id: 'fetching-cards',   label: 'Fetching card data from Scryfall' },
      { id: 'detecting-combos', label: 'Detecting commander combos' },
      { id: 'analyzing-roles',  label: 'Analyzing roles, curve & mana' },
    ];
    const order: HydrateStage[] = ['fetching-cards', 'detecting-combos', 'analyzing-roles', 'done'];
    const currentIdx = loadStage ? order.indexOf(loadStage) : 0;

    return (
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="flex flex-col items-center gap-5 text-center animate-fade-in">
          <Loader2 className="h-10 w-10 text-violet-300/80 animate-spin" />
          <div>
            <div className="text-base font-medium">
              {pendingShareLoad
                ? 'Loading shared deck…'
                : `Loading ${list?.name ? `"${list.name}"` : 'deck'}…`}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              This takes a few seconds on first load.
            </div>
          </div>

          <ol className="flex flex-col gap-2 text-sm text-left mt-1 min-w-[260px]">
            {steps.map((step, i) => {
              const done = i < currentIdx;
              const active = i === currentIdx;
              // Card counter only on the Scryfall step, and only while it's the
              // running one — a stale "100/100" under a later step reads as stuck.
              const showCount = active && step.id === 'fetching-cards'
                && !!cardProgress && cardProgress.total > 0;
              const pct = showCount
                ? Math.round((cardProgress.fetched / cardProgress.total) * 100)
                : 0;
              return (
                <li key={step.id} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2.5">
                    <span className="h-5 w-5 flex items-center justify-center flex-shrink-0">
                      {done ? (
                        <Check className="h-4 w-4 text-emerald-400" />
                      ) : active ? (
                        <Loader2 className="h-4 w-4 text-violet-300 animate-spin" />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                      )}
                    </span>
                    <span className={
                      done ? 'text-zinc-400 line-through decoration-emerald-500/40'
                      : active ? 'text-zinc-100'
                      : 'text-zinc-500'
                    }>
                      {step.label}
                    </span>
                    {showCount && (
                      <span className="ml-auto pl-3 text-xs tabular-nums text-zinc-500">
                        {cardProgress.fetched}/{cardProgress.total} cards
                      </span>
                    )}
                  </div>
                  {showCount && (
                    <div className="ml-[30px] h-1 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-violet-400/70 transition-[width] duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </main>
    );
  }

  if (deckLoaded) {
    const partnerOffset = generatedDeck.partnerCommander ? 1 : 0;
    const totalCards =
      (generatedDeck.commander ? 1 : 0)
      + partnerOffset
      + Object.values(generatedDeck.categories).reduce((n, arr) => n + arr.length, 0);
    const sourceList = source.kind === 'list' ? lists.find(l => l.id === source.listId) : undefined;
    const analyzerDeckSize = sourceList?.deckSize != null
      ? Math.max(sourceList.deckSize - 1 - partnerOffset, 0)
      : Math.max(totalCards - 1 - partnerOffset, 0);

    const sourceLabel = source.kind === 'paste'
      ? 'Pasted'
      : source.kind === 'generated'
      ? 'Generated'
      : source.kind === 'shared'
      ? 'Shared deck'
      : `From "${source.listName}"`;

    // Intended themes for the New Cards tab. Hierarchy: the user's explicit theme
    // declaration → generation provenance → legacy summary parse → generator run.
    const intendedThemes = sourceList
      ? (sourceList.themes?.length ? sourceList.themes.map(t => t.name)
        : sourceList.usedThemes?.length ? sourceList.usedThemes
        : parseIntendedThemes(sourceList.generationSummary))
      : generatedDeck.usedThemes;

    const handleSaveAsDeck = () => {
      const today = new Date().toISOString().slice(0, 10);
      const name = `${generatedDeck.commander?.name ?? 'Untitled'} — Inspected ${today}`;
      const cardNames: string[] = [];
      if (generatedDeck.commander) cardNames.push(generatedDeck.commander.name);
      if (generatedDeck.partnerCommander) cardNames.push(generatedDeck.partnerCommander.name);
      for (const cards of Object.values(generatedDeck.categories)) {
        for (const c of cards) cardNames.push(c.name);
      }
      const newList = createList(name, cardNames, '', {
        type: 'deck',
        commanderName: generatedDeck.commander?.name,
        partnerCommanderName: generatedDeck.partnerCommander?.name,
        deckSize: cardNames.length,
      });
      setSource({ kind: 'list', listId: newList.id, listName: name });
      trackEvent('analyze_deck_saved', { listName: name, cardCount: cardNames.length, source: source.kind });
    };
    const handleOpenInDeckView = source.kind === 'list'
      ? () => navigate(`/decks/${source.listId}`)
      : undefined;

    return (
      <main className="flex-1 pt-0">
        {generatedDeck.commander && (
          <AnalyzeSplit
            analyzer={
              <DeckOptimizer
                commanderName={generatedDeck.commander.name}
                partnerCommanderName={generatedDeck.partnerCommander?.name}
                currentCards={Object.values(generatedDeck.categories).flat()}
                deckSize={analyzerDeckSize}
                roleCounts={generatedDeck.roleCounts || {}}
                roleTargets={generatedDeck.roleTargets || {}}
                categories={generatedDeck.categories}
                cardInclusionMap={generatedDeck.cardInclusionMap}
                activeTab={activeAnalyzerTab}
                onTabChange={handleAnalyzerTabChange}
                getTabHref={getAnalyzerTabHref}
                initialLiftView={liftViewParam}
                onAddCards={handleAddCardsToAnalyzerDeck}
                onRemoveCards={handleRemoveCardsFromAnalyzerDeck}
                commander={generatedDeck.commander}
                partnerCommander={generatedDeck.partnerCommander ?? undefined}
                colorIdentity={colorIdentityStore}
                sourceLabel={sourceLabel}
                deckName={source.kind === 'list' ? source.listName : undefined}
                onChangeDeck={handleChangeDeck}
                onThemeMembershipChange={setThemeMembership}
                onMisfitNamesChange={setMisfitNames}
                onFocusedMisfitChange={setFocusedMisfitName}
                onSaveAsDeck={source.kind === 'list' ? undefined : handleSaveAsDeck}
                onOpenInDeckView={handleOpenInDeckView}
                intendedThemes={intendedThemes}
                sourceListId={source.kind === 'list' ? source.listId : undefined}
                sourceListUpdatedAt={sourceList?.updatedAt}
              />
            }
            deck={
              <DeckBuildingArea
                spellChromaDeckRef={source.kind === 'list' ? source.listId : 'generated'}
                currentCards={Object.values(generatedDeck.categories).flat()}
                excludeNames={(() => {
                  const s = new Set<string>();
                  if (generatedDeck.commander) s.add(generatedDeck.commander.name);
                  if (generatedDeck.partnerCommander) s.add(generatedDeck.partnerCommander.name);
                  return s;
                })()}
                highlightRoles={activeAnalyzerTab === 'roles' || activeAnalyzerTab === 'curve'}
                activeRole={activeAnalyzerTab === 'roles' ? activeOptimizerRole : null}
                activeCmcRange={activeAnalyzerTab === 'curve' ? activeOptimizerCmcRange : null}
                activeRoleGroup={activeAnalyzerTab === 'curve' ? activeOptimizerRoleGroup : null}
                removalNames={pendingRemovals}
                misfitNames={activeAnalyzerTab === 'optimize' ? misfitNames : undefined}
                focusedMisfitName={activeAnalyzerTab === 'optimize' ? focusedMisfitName : null}
                focusLands={activeAnalyzerTab === 'lands'}
                onCardAction={handleAnalyzerCardAction}
                menuProps={analyzerMenuProps}
                themeMembership={themeMembership}
                onSwapCard={handleAnalyzerSwapCard}
                onAddCard={handleAnalyzerAddCard}
                cardInclusionMap={generatedDeck.cardInclusionMap}
                cardRelevancyMap={generatedDeck.cardRelevancyMap}
                commanderColorIdentity={colorIdentityStore}
              />
            }
          />
        )}
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
      <div className="relative text-center py-6 max-w-2xl mx-auto animate-enter-up">
        <img
          src={`${import.meta.env.BASE_URL}inspector-logo.png`}
          alt="Inspector"
          className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-3 sm:mb-4 invert drop-shadow-[0_0_24px_rgba(140,180,255,0.35)]"
        />
        <h2 className="text-4xl font-bold mb-3">
          Inspect any{' '}
          <span className="gradient-text">Commander deck</span>
        </h2>
        <p className="text-base text-muted-foreground">
          Spot what's missing before you sleeve up.
        </p>
      </div>

      <div
        className="fixed top-[96px] right-2 sm:right-4 z-30 max-w-[320px] rounded-lg border border-violet-400/20 bg-card/85 backdrop-blur-md px-3 py-2 shadow-lg shadow-black/20 animate-fade-in"
        style={{ animationDelay: '360ms', animationFillMode: 'backwards' }}
      >
        <p className="inline-flex items-center gap-1.5 text-[11px] leading-snug text-violet-300/70">
          <FlaskConical className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>
            Inspector is still in early development — things may be buggy or behave in surprising ways, especially if your deck does something unique.
          </span>
        </p>
      </div>

      <div className="relative">
        <div className="animate-enter-up" style={{ animationDelay: '90ms' }}>
          <LaneTabs tabs={ANALYZE_LANES} active={activeLane} onChange={setActiveLane} />
        </div>

        {error && (
          <div className="max-w-3xl mx-auto mb-3 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-sm text-red-400">
            {error}
          </div>
        )}

        <div
          id={`lane-panel-${activeLane}`}
          role="tabpanel"
          aria-labelledby={`lane-tab-${activeLane}`}
          className="max-w-3xl mx-auto rounded-xl border border-border/40 bg-card/30 backdrop-blur-sm p-3 sm:p-6 min-h-[280px] overflow-hidden animate-enter-up"
          style={{ animationDelay: '170ms' }}
        >
          {activeLane === 'paste' && (
            <PasteLane onSubmit={handlePasteAnalyze} loading={loading} />
          )}
          {activeLane === 'lists' && (
            <ListsLane onPick={handleListPick} loading={loading} loadingListId={loadingListId} />
          )}
          {activeLane === 'generate' && <GenerateLane />}
        </div>

        <div className="animate-enter-up" style={{ animationDelay: '250ms' }}>
          <WhatYoullSeeStrip />
        </div>
      </div>
    </main>
  );
}
