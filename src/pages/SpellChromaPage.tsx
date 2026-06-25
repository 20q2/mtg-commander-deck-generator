import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { loadTagDictionary, loadTagIndex, aggregateDeckTags } from '@/services/spellchroma/tagIndex';
import { buildCardComboMap } from '@/services/spellchroma/combos';
import { getCardByName, getCardsByNames } from '@/services/scryfall/client';
import { fetchColorIdentityCombos } from '@/services/edhrec/client';
import type { EDHRECCombo } from '@/types';
import type { ExplorerSort, ColorMatch, SortDir } from '@/services/spellchroma/explorerSearch';
import { useExplorerSearch } from '@/components/spellchroma/useExplorerSearch';
import { TagSearchBar } from '@/components/spellchroma/TagSearchBar';
import { ExplorerGrid } from '@/components/spellchroma/ExplorerGrid';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SpellChromaSplit } from '@/components/spellchroma/SpellChromaSplit';
import { SpellChromaLanding } from '@/components/spellchroma/SpellChromaLanding';
import { SpellChromaBackdrop } from '@/components/spellchroma/SpellChromaBackdrop';
import { DeckContextPanel } from '@/components/spellchroma/DeckContextPanel';
import type { CardAction } from '@/components/deck/DeckDisplay';
import { useUserLists } from '@/hooks/useUserLists';
import { useCollection } from '@/hooks/useCollection';
import { useStore } from '@/store';
import { applyCommanderTheme, resetTheme } from '@/lib/commanderTheme';
import { trackEvent } from '@/services/analytics';
import { SiteFooter } from '@/components/SiteFooter';
import { useActionToast, ActionToast } from '@/components/ui/action-toast';
import type { ScryfallCard } from '@/types';

// Primary card type (for the toast's type icon), mirroring ListDeckView.
function primaryTypeFromLine(typeLine: string | undefined): string {
  const tl = (typeLine || '').split('//')[0].split('—')[0].toLowerCase();
  const order = ['creature', 'planeswalker', 'land', 'battle', 'artifact', 'enchantment', 'instant', 'sorcery', 'tribal'];
  return order.find(t => tl.includes(t)) || 'creature';
}

// Debounce a value so rapid filter toggles don't fire a search per click —
// the search waits until selections settle.
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function SpellChromaPage() {
  // Seed from a ?tags= deep link (e.g. a card preview's Tags tab links here when
  // opened outside SpellChroma). Lazy init so the explorer renders straight away
  // without a landing-splash flash. The param is stripped on mount (effect below).
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [selectedTags, setSelectedTags] = useState<string[]>(() => {
    const raw = new URLSearchParams(window.location.search).get('tags');
    return raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
  });
  const [colorIdentity, setColorIdentity] = useState<string[]>([]);
  const [colorMode, setColorMode] = useState<ColorMatch>('subset');
  const [excludedColors, setExcludedColors] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<ExplorerSort>('edhrec');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [textFilter, setTextFilter] = useState('');
  const [deck, setDeck] = useState<ScryfallCard[] | null>(null);
  const [indexReady, setIndexReady] = useState(false);
  const [startedExploring, setStartedExploring] = useState(false);
  const [hideInDeck, setHideInDeck] = useState(false);
  const [collectionOnly, setCollectionOnly] = useState(false);
  // Color-identity combos for the current color filter — powers the combo tab in
  // card previews. SpellChroma decks have no commander, so these come purely from
  // the selected colors (auto-adopted from a loaded deck, or set via the filters).
  const [rawCombos, setRawCombos] = useState<EDHRECCombo[]>([]);
  // The saved UserCardList id of the deck currently being edited in place. Set
  // only for library decks/lists (not the ephemeral 'generated'/pasted loads);
  // drives write-back + the persisted ?deck= URL param so a refresh reloads it.
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  // True while a ?deck= deep link resolves on mount — suppresses the landing
  // splash so it doesn't flash before the deck loads. Lazy-initialized from the URL.
  const [deckParamPending, setDeckParamPending] = useState(
    () => !!new URLSearchParams(window.location.search).get('deck'),
  );
  // Whether SpellChroma was *opened* via a deck/card deep link (the "Open in
  // SpellChroma" buttons or a card preview's Tags tab) vs. reached on its own and
  // loaded a deck from the landing splash. Drives where the workbench back button
  // goes: deep-link entry returns to the originating page; splash-loaded decks
  // return to the SpellChroma home. Captured once at mount.
  const [arrivedViaDeckLink] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return !!p.get('deck') || !!p.get('card');
  });
  // Guards the ?deck= deep-link effect so it fires once. Declared here (above
  // handleDeckLoaded) so handleDeckLoaded can claim the param on a landing pick
  // and stop the effect from re-resolving the same deck.
  const deckParamHandled = useRef(false);

  useEffect(() => { void loadTagDictionary(); }, []);
  // Tint the dynamic --border/--ring CSS vars to the active color identity (the
  // adopted deck's colors or the selected color filter), matching the rest of
  // the app. Falls back to the neutral default when no colors are in play.
  useEffect(() => {
    if (colorIdentity.length > 0) applyCommanderTheme(colorIdentity);
    else resetTheme();
    return () => resetTheme();
  }, [colorIdentity]);
  // One-shot adoption ping when the SpellChroma page opens.
  useEffect(() => { trackEvent('spellchroma_viewed', {}); }, []);
  // Track any deep-linked tags and load the deep-linked card (the card a preview's
  // Tags tab came from) into the deck area, then strip the ?tags=/?card= params so a
  // refresh/back doesn't re-seed (the slugs already live in selectedTags state).
  useEffect(() => {
    const raw = searchParams.get('tags');
    const cardName = searchParams.get('card');
    if (raw) {
      raw.split(',').map(s => s.trim()).filter(Boolean)
        .forEach(slug => trackEvent('spellchroma_tag_selected', { slug }));
    }
    if (cardName) {
      void (async () => {
        try {
          const c = await getCardByName(cardName);
          if (c) {
            setDeck([c]);
            const ok = await loadTagIndex();
            setIndexReady(ok);
            trackEvent('spellchroma_deck_loaded', { source: 'card-preview', cardCount: 1 });
          }
        } catch { /* card lookup failed — just skip seeding the deck */ }
      })();
    }
    if (raw || cardName) {
      const next = new URLSearchParams(searchParams);
      next.delete('tags');
      next.delete('card');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { lists: userLists, updateList, createList, deleteList } = useUserLists();
  const customization = useStore(s => s.customization);
  const updateCustomization = useStore(s => s.updateCustomization);
  // Bottom-right confirmation toast for adds (manual add + explorer).
  const { toast, success, dismiss } = useActionToast();

  const menuProps = useMemo(() => ({
    userLists,
    mustIncludeNames: new Set(customization.mustIncludeCards),
    bannedNames: new Set(customization.bannedCards),
  }), [userLists, customization.mustIncludeCards, customization.bannedCards]);

  // Add/remove mutate the ephemeral loaded deck in place; list/ban/must-include
  // delegate to the shared store + user-lists hook (mirrors ListDeckView).
  const handleCardAction = useCallback((card: ScryfallCard, action: CardAction) => {
    const name = card.name;
    switch (action.type) {
      case 'addToDeck': {
        const already = !!deck && deck.some(c => c.id === card.id);
        const prevDeck = deck;
        const next = already ? deck! : [...(deck ?? []), card];
        setDeck(next);
        // Persist back to the saved library deck when one is being edited in place.
        if (activeDeckId) updateList(activeDeckId, { cards: next.map(c => c.name) });
        trackEvent('spellchroma_card_added', { dest: 'deck' });
        if (already) {
          success(`${name} is already in your deck`, { cardType: primaryTypeFromLine(card.type_line) });
        } else {
          success(`Added ${name}`, {
            cardType: primaryTypeFromLine(card.type_line),
            onUndo: () => {
              setDeck(prevDeck);
              if (activeDeckId) updateList(activeDeckId, { cards: (prevDeck ?? []).map(c => c.name) });
            },
          });
        }
        break;
      }
      case 'remove': {
        const next = deck ? deck.filter(c => c.id !== card.id) : deck;
        setDeck(next);
        if (activeDeckId && next) updateList(activeDeckId, { cards: next.map(c => c.name) });
        break;
      }
      case 'mustInclude': {
        const cur = customization.mustIncludeCards;
        updateCustomization({ mustIncludeCards: cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name] });
        break;
      }
      case 'exclude': {
        const cur = customization.bannedCards;
        updateCustomization({ bannedCards: cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name] });
        break;
      }
      case 'sideboard':
      case 'maybeboard': {
        // Only meaningful while editing a saved list (it owns the boards). The
        // explorer hides these options for ephemeral generated/pasted decks.
        if (!activeDeckId) break;
        const board = action.type === 'sideboard' ? 'sideboard' : 'maybeboard';
        const target = userLists.find(l => l.id === activeDeckId);
        const current = target?.[board] ?? [];
        const onBoard = current.includes(name);
        if (!onBoard) updateList(activeDeckId, { [board]: [...current, name] });
        trackEvent('spellchroma_card_added', { dest: board });
        success(onBoard ? `${name} is already in ${board}` : `Added ${name} to ${board}`, {
          cardType: primaryTypeFromLine(card.type_line),
          ...(onBoard ? {} : { onUndo: () => updateList(activeDeckId, { [board]: current }) }),
        });
        break;
      }
      case 'addToList': {
        const target = userLists.find(l => l.id === action.listId);
        const inList = !!target?.cards.includes(name);
        if (target && !inList) updateList(action.listId, { cards: [...target.cards, name] });
        trackEvent('spellchroma_card_added', { dest: 'list' });
        success(
          !target ? `Added ${name}` : inList ? `${name} is already in ${target.name}` : `Added ${name} to ${target.name}`,
          {
            cardType: primaryTypeFromLine(card.type_line),
            ...(target && !inList ? { onUndo: () => updateList(action.listId, { cards: target.cards }) } : {}),
          },
        );
        break;
      }
      case 'createListAndAdd': {
        const created = createList(action.listName, [name]);
        trackEvent('spellchroma_card_added', { dest: 'list' });
        success(`Added ${name} to ${action.listName}`, {
          cardType: primaryTypeFromLine(card.type_line),
          onUndo: () => deleteList(created.id),
        });
        break;
      }
    }
  }, [customization, updateCustomization, userLists, updateList, createList, deleteList, deck, activeDeckId, success]);

  // Context-menu actions fired on a sideboard/maybeboard card. The source board
  // is supplied by the panel, so `remove` removes from that board, `addToDeck`
  // moves it into the main deck, and a `sideboard`/`maybeboard` action names the
  // destination board to move it to. Global actions (ban/must/list) behave as on
  // the main deck. All edits flow back to the saved list.
  const handleBoardCardAction = useCallback((card: ScryfallCard, action: CardAction, board: 'sideboard' | 'maybeboard') => {
    const name = card.name;
    if (!activeDeckId) return;
    const list = userLists.find(l => l.id === activeDeckId);
    if (!list) return;
    const boardArr = list[board] ?? [];
    switch (action.type) {
      case 'remove':
        updateList(activeDeckId, { [board]: boardArr.filter(n => n !== name) });
        break;
      case 'addToDeck': {
        const already = !!deck && deck.some(c => c.name === name);
        const next = already ? deck! : [...(deck ?? []), card];
        setDeck(next);
        updateList(activeDeckId, { cards: next.map(c => c.name), [board]: boardArr.filter(n => n !== name) });
        trackEvent('spellchroma_card_added', { dest: 'deck' });
        break;
      }
      case 'sideboard':
      case 'maybeboard': {
        // The fired action type is the *destination* board; `board` is the source.
        const dest = action.type;
        const destArr = list[dest] ?? [];
        updateList(activeDeckId, {
          [board]: boardArr.filter(n => n !== name),
          ...(destArr.includes(name) ? {} : { [dest]: [...destArr, name] }),
        });
        trackEvent('spellchroma_card_added', { dest });
        break;
      }
      case 'mustInclude': {
        const cur = customization.mustIncludeCards;
        updateCustomization({ mustIncludeCards: cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name] });
        break;
      }
      case 'exclude': {
        const cur = customization.bannedCards;
        updateCustomization({ bannedCards: cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name] });
        break;
      }
      case 'addToList': {
        const target = userLists.find(l => l.id === action.listId);
        if (target && !target.cards.includes(name)) updateList(action.listId, { cards: [...target.cards, name] });
        trackEvent('spellchroma_card_added', { dest: 'list' });
        break;
      }
      case 'createListAndAdd':
        createList(action.listName, [name]);
        trackEvent('spellchroma_card_added', { dest: 'list' });
        break;
    }
  }, [customization, updateCustomization, userLists, updateList, createList, deck, activeDeckId]);

  const filters = useMemo(
    () => ({ colorIdentity, colorMode, excludedColors, typeFilter }),
    [colorIdentity, colorMode, excludedColors, typeFilter],
  );
  // Debounce color + type filter changes (~550ms) so toggling several doesn't
  // fire a search each click; tags and sort still search immediately.
  const debouncedFilters = useDebouncedValue(filters, 550);
  const result = useExplorerSearch(selectedTags, debouncedFilters, sort, sortDir);
  const addTag = useCallback((slug: string) => {
    setSelectedTags(t => (t.includes(slug) ? t : [...t, slug]));
    trackEvent('spellchroma_tag_selected', { slug });
  }, []);
  const removeTag = useCallback((slug: string) => setSelectedTags(t => t.filter(s => s !== slug)), []);
  // Return to the landing splash (where the paste / decks / lists options live).
  // Clears the loaded deck too, so this works from the deck workbench as well.
  const backToOptions = useCallback(() => {
    setDeck(null);
    setSelectedTags([]);
    setStartedExploring(false);
    setActiveDeckId(null);
    // Drop the adopted color identity so the backdrop dispels back to wastes
    // (the neutral landing art) instead of lingering on the loaded deck's guild.
    setColorIdentity([]);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('deck');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Workbench back. When SpellChroma was opened via a deck/card deep link (the
  // "Open in SpellChroma" button on the Builder/List deck toolbars), return to
  // that originating page like the inspector's back button. When the deck was
  // loaded from inside SpellChroma (the landing splash's "Your decks"/paste),
  // return to the SpellChroma home instead of leaving the page. The history
  // guard also self-corrects the rare case of falling back to the splash after a
  // deep-link entry that had no in-app history to return to.
  const backToDeck = useCallback(() => {
    if (arrivedViaDeckLink && window.history.length > 1) navigate(-1);
    else backToOptions();
  }, [arrivedViaDeckLink, navigate, backToOptions]);

  // When a deck loads: pull the index (for top-tags + preview tags) and adopt
  // the deck's combined color identity as the explorer filter.
  const handleDeckLoaded = useCallback(async (cards: ScryfallCard[], source: string = 'unknown', listId?: string) => {
    setDeck(cards);
    trackEvent('spellchroma_deck_loaded', { source, cardCount: cards.length });
    const ci = new Set<string>();
    for (const c of cards) for (const col of c.color_identity ?? []) ci.add(col);
    setColorIdentity([...ci]);
    // Library decks/lists are edited in place: remember the id and persist it in
    // the URL so a refresh/bookmark reloads this deck. Claiming the deep-link
    // guard stops that effect from re-resolving the deck we just loaded. Ephemeral
    // loads ('generated'/pasted/card-preview) pass no listId and skip all of this.
    if (listId) {
      setActiveDeckId(listId);
      deckParamHandled.current = true;
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set('deck', listId);
        return next;
      }, { replace: true });
    }
    const ok = await loadTagIndex();
    setIndexReady(ok);
    // Don't auto-seed a starter tag — the empty explorer prompt is clear enough
    // now that the user knows to pick a tag (or one is already selected via a
    // deep link / earlier pick, which we leave untouched).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle a ?deck= deep link — the "Open in SpellChroma" buttons on the deck
  // toolbars route here. `generated` pulls the ephemeral builder deck (plus its
  // commanders) straight from the store; any other value is a saved-list id we
  // resolve via useUserLists. Guarded so it fires once, and the list branch
  // waits for userLists to populate before giving up. The param is stripped
  // after handling so a refresh/back doesn't re-seed.
  useEffect(() => {
    if (deckParamHandled.current) return;
    const deckParam = searchParams.get('deck');
    if (!deckParam) { setDeckParamPending(false); return; }

    const strip = () => {
      const next = new URLSearchParams(searchParams);
      next.delete('deck');
      setSearchParams(next, { replace: true });
    };

    if (deckParam === 'generated') {
      // Ephemeral builder deck — no saved id, so it's not edited in place. Load
      // it and strip the one-shot entry param.
      deckParamHandled.current = true;
      const gen = useStore.getState().generatedDeck;
      if (gen) {
        const cards = [
          ...(gen.commander ? [gen.commander] : []),
          ...(gen.partnerCommander ? [gen.partnerCommander] : []),
          ...Object.values(gen.categories).flat(),
        ];
        if (cards.length > 0) void handleDeckLoaded(cards, 'builder-deck');
      }
      strip();
      setDeckParamPending(false);
      return;
    }

    // Saved-list id — wait until the lists hook has populated before resolving.
    if (userLists.length === 0) { setDeckParamPending(false); return; }
    deckParamHandled.current = true;
    const list = userLists.find(l => l.id === deckParam);
    if (list && list.cards.length > 0) {
      // Resolve + load as an edit-in-place deck. handleDeckLoaded sets activeDeckId
      // and KEEPS ?deck=<id> in the URL (we don't strip), so a refresh reloads it.
      void (async () => {
        try {
          const map = await getCardsByNames(list.cards);
          const cards = list.cards.map(n => map.get(n)).filter((c): c is ScryfallCard => !!c);
          if (cards.length > 0) await handleDeckLoaded(cards, 'managed-deck', deckParam);
        } catch { /* lookup failed — leave the user on the landing splash */ }
        finally { setDeckParamPending(false); }
      })();
    } else {
      strip(); // unknown id — drop the dangling param
      setDeckParamPending(false);
    }
  }, [searchParams, setSearchParams, userLists, handleDeckLoaded]);

  const topTags = useMemo(
    () => (deck && indexReady ? aggregateDeckTags(deck) : []),
    [deck, indexReady],
  );
  // Deck's most relevant (non-trivia) tag slugs — surfaced first in the Add-tag picker.
  const topTagSlugs = useMemo(
    () => topTags.filter(t => !t.ignored).map(t => t.slug).slice(0, 12),
    [topTags],
  );

  // Names already in the loaded deck — the explorer badges these so you can see
  // at a glance which results you already run. Updates live as cards are added.
  const deckNames = useMemo(() => new Set((deck ?? []).map(c => c.name)), [deck]);

  // The saved list currently being edited owns the sideboard/maybeboard. Resolve
  // their name lists into full cards so the deck panel can show those boards via
  // its header switcher. Keyed on the joined names so a board edit re-resolves but
  // ordinary render churn doesn't; cleared when there's no list or an empty board.
  const activeList = useMemo(
    () => (activeDeckId ? userLists.find(l => l.id === activeDeckId) ?? null : null),
    [activeDeckId, userLists],
  );
  const [sideboardCards, setSideboardCards] = useState<ScryfallCard[]>([]);
  const [maybeboardCards, setMaybeboardCards] = useState<ScryfallCard[]>([]);
  const sideboardKey = (activeList?.sideboard ?? []).join('|');
  const maybeboardKey = (activeList?.maybeboard ?? []).join('|');
  useEffect(() => {
    const names = activeList?.sideboard ?? [];
    if (names.length === 0) { setSideboardCards([]); return; }
    let cancelled = false;
    void getCardsByNames(names).then(map => {
      if (!cancelled) setSideboardCards(names.map(n => map.get(n)).filter((c): c is ScryfallCard => !!c));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideboardKey]);
  useEffect(() => {
    const names = activeList?.maybeboard ?? [];
    if (names.length === 0) { setMaybeboardCards([]); return; }
    let cancelled = false;
    void getCardsByNames(names).then(map => {
      if (!cancelled) setMaybeboardCards(names.map(n => map.get(n)).filter((c): c is ScryfallCard => !!c));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maybeboardKey]);

  // Fetch color-identity combos whenever the (debounced) color filter changes,
  // or a deck is loaded. An empty identity is meaningful once a deck is loaded —
  // that's a *colorless* deck, which has its own combo page — so we only skip the
  // fetch on the bare landing/explorer (no deck and no colors picked).
  // fetchColorIdentityCombos caches internally, so revisiting a color set is instant.
  const hasDeck = !!deck;
  const comboColorKey = debouncedFilters.colorIdentity.join('');
  useEffect(() => {
    let cancelled = false;
    if (!hasDeck && debouncedFilters.colorIdentity.length === 0) { setRawCombos([]); return; }
    void fetchColorIdentityCombos(debouncedFilters.colorIdentity)
      .then(combos => { if (!cancelled) setRawCombos(combos); })
      .catch(() => { if (!cancelled) setRawCombos([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comboColorKey, hasDeck]);

  // Card name → combos it appears in. Completeness is measured against the loaded
  // deck, so assembled combos surface as complete and the rest as potential picks.
  const cardComboMap = useMemo(
    () => buildCardComboMap(rawCombos, deckNames),
    [rawCombos, deckNames],
  );

  // Names in the user's collection — the explorer badges these as "owned".
  const { cards: collectionCards } = useCollection();
  const collectionNames = useMemo(() => new Set((collectionCards ?? []).map(c => c.name)), [collectionCards]);

  // The sticky count row pins directly below the toolbar. The toolbar wraps to
  // multiple rows when many tags/filters are active, so we measure its live
  // height rather than assuming a fixed 52px. (Declared before any early return
  // to keep hook order stable.)
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(52);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [deck, startedExploring]);

  // The landing splash shows until the user loads a deck, picks a starter tag,
  // or explicitly chooses to explore without one. A pending ?deck= deep link
  // suppresses it so it doesn't flash before the deck resolves.
  const showLanding = !deck && selectedTags.length === 0 && !startedExploring && !deckParamPending;

  // Resolving a ?deck= deep link — show a quiet loader instead of the landing.
  if (deckParamPending && !deck) {
    return (
      <div className="min-h-[calc(100vh-77px)] flex items-center justify-center">
        <SpellChromaBackdrop colorIdentity={colorIdentity} revealArt={selectedTags.length === 0} />
        <Loader2 className="w-6 h-6 animate-spin text-violet-300" />
      </div>
    );
  }

  if (showLanding) {
    return (
      <div className="min-h-[calc(100vh-77px)] flex flex-col">
        <div className="container mx-auto px-4 max-w-[1600px] flex-1">
          <SpellChromaBackdrop colorIdentity={colorIdentity} revealArt={selectedTags.length === 0} />
          <SpellChromaLanding
            onLoad={handleDeckLoaded}
            onExplore={() => setStartedExploring(true)}
            onStarterTag={addTag}
          />
        </div>
        <SiteFooter />
      </div>
    );
  }

  // The tag/filter toolbar — shared by the workbench pane and the standalone
  // (deck-less) sticky header.
  const toolbar = (
    <TagSearchBar
      sticky={false}
      leading={!deck ? (
        <button
          type="button"
          onClick={backToOptions}
          title="Back to start"
          aria-label="Back to start"
          className="flex w-[52px] shrink-0 items-center justify-center border-r border-border/30 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      ) : undefined}
      selectedTags={selectedTags}
      topTags={topTagSlugs}
      onAddTag={addTag}
      onRemoveTag={removeTag}
      colorIdentity={colorIdentity}
      onColorsChange={setColorIdentity}
      colorMode={colorMode}
      onColorModeChange={setColorMode}
      excludedColors={excludedColors}
      onExcludedChange={setExcludedColors}
      typeFilter={typeFilter}
      onTypeFilterChange={setTypeFilter}
      sort={sort}
      onSortChange={setSort}
      sortDir={sortDir}
      onToggleSortDir={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
      textFilter={textFilter}
      onTextFilterChange={setTextFilter}
    />
  );

  // `stickyTop` is the pixel offset the count row pins to (the measured height of
  // whatever sticky header sits above it). Pass 0/false to disable.
  const renderGrid = (sticky: boolean, stickyTop: number) => (
    <ExplorerGrid
      cards={result.cards}
      total={result.total}
      hasMore={result.hasMore}
      loading={result.loading}
      loadingAll={result.loadingAll}
      error={result.error}
      hasTags={selectedTags.length > 0}
      textFilter={textFilter}
      sort={sort}
      dir={sortDir}
      sticky={sticky}
      stickyTop={stickyTop}
      dealKey={`${selectedTags.join(',')}|${debouncedFilters.colorIdentity.join('')}|${debouncedFilters.colorMode}|${debouncedFilters.excludedColors.join('')}|${debouncedFilters.typeFilter.join(',')}`}
      deckNames={deckNames}
      collectionNames={collectionNames}
      hideInDeck={hideInDeck}
      showHideInDeck={!!deck}
      onHideInDeckChange={setHideInDeck}
      collectionOnly={collectionOnly}
      showCollectionOnly={collectionNames.size > 0}
      onCollectionOnlyChange={setCollectionOnly}
      topTags={topTagSlugs}
      selectedTags={selectedTags}
      onLoadAll={result.loadAll}
      onTagClick={addTag}
      onRemoveTag={removeTag}
      onCardAction={handleCardAction}
      boardsEnabled={!!activeDeckId}
      menuProps={menuProps}
      cardComboMap={cardComboMap}
    />
  );

  // Deck loaded → full-bleed workbench (no page padding; the split fills the
  // viewport under the nav and the panes carry their own padding).
  if (deck) {
    return (
      <>
        <SpellChromaBackdrop colorIdentity={colorIdentity} revealArt={selectedTags.length === 0} />
        <SpellChromaSplit
          deck={
            <DeckContextPanel
              cards={deck}
              sideboard={sideboardCards}
              maybeboard={maybeboardCards}
              onBoardCardAction={handleBoardCardAction}
              colorIdentity={colorIdentity}
              boardsEnabled={!!activeDeckId}
              topTags={topTags}
              selectedTags={selectedTags}
              onTagClick={addTag}
              onRemoveTag={removeTag}
              onCardAction={handleCardAction}
              menuProps={menuProps}
              cardComboMap={cardComboMap}
              headerExtra={
                <Button
                  variant="ghost"
                  onClick={backToDeck}
                  title="Back to deck"
                  aria-label="Back to deck"
                  className="self-stretch -my-2 -ml-3 h-auto w-[52px] shrink-0 rounded-none border-r border-border/30"
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              }
            />
          }
          explorer={
            <div className="flex flex-col">
              {/* Toolbar pins to the top of the workbench explorer pane (its own
                  scroll container), with the count row stacking just beneath it. */}
              <div ref={headerRef} className="sticky top-0 z-30">{toolbar}</div>
              {renderGrid(true, headerH)}
            </div>
          }
        />
        <ActionToast toast={toast} onDismiss={dismiss} />
      </>
    );
  }

  return (
    <div className="min-h-[calc(100vh-77px)] flex flex-col">
      <SpellChromaBackdrop colorIdentity={colorIdentity} revealArt={selectedTags.length === 0} />
      {/* Full-bleed sticky toolbar pinned under the app nav (77px). The page title
          is redundant with the active nav item, so the deck-less explorer drops it
          entirely: the toolbar carries its own bg/border and a flush left-edge back
          arrow (mirroring the workbench deck pane), with the count row pinned right
          beneath it. */}
      <div ref={headerRef} className="sticky top-[77px] z-30">
        {toolbar}
      </div>
      <div className="flex-1">
        {renderGrid(true, 77 + headerH)}
      </div>
      <SiteFooter />
      <ActionToast toast={toast} onDismiss={dismiss} />
    </div>
  );
}
