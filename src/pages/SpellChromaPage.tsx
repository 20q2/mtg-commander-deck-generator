import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadTagDictionary, loadTagIndex, aggregateDeckTags } from '@/services/spellchroma/tagIndex';
import type { ExplorerSort, ColorMatch } from '@/services/spellchroma/explorerSearch';
import { useExplorerSearch } from '@/components/spellchroma/useExplorerSearch';
import { TagSearchBar } from '@/components/spellchroma/TagSearchBar';
import { ExplorerGrid } from '@/components/spellchroma/ExplorerGrid';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SpellChromaSplit } from '@/components/spellchroma/SpellChromaSplit';
import { SpellChromaLanding } from '@/components/spellchroma/SpellChromaLanding';
import { SpellChromaBackdrop } from '@/components/spellchroma/SpellChromaBackdrop';
import { DeckContextPanel } from '@/components/spellchroma/DeckContextPanel';
import type { CardAction } from '@/components/deck/DeckDisplay';
import { useUserLists } from '@/hooks/useUserLists';
import { useStore } from '@/store';
import { SiteFooter } from '@/components/SiteFooter';
import type { ScryfallCard } from '@/types';

export function SpellChromaPage() {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [colorIdentity, setColorIdentity] = useState<string[]>([]);
  const [colorMode, setColorMode] = useState<ColorMatch>('subset');
  const [excludedColors, setExcludedColors] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<ExplorerSort>('edhrec');
  const [textFilter, setTextFilter] = useState('');
  const [deck, setDeck] = useState<ScryfallCard[] | null>(null);
  const [indexReady, setIndexReady] = useState(false);
  const [startedExploring, setStartedExploring] = useState(false);

  useEffect(() => { void loadTagDictionary(); }, []);

  const { lists: userLists, updateList, createList } = useUserLists();
  const customization = useStore(s => s.customization);
  const updateCustomization = useStore(s => s.updateCustomization);

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
      case 'addToDeck':
        setDeck(prev => (prev && prev.some(c => c.id === card.id)) ? prev : [...(prev ?? []), card]);
        break;
      case 'remove':
        setDeck(prev => prev ? prev.filter(c => c.id !== card.id) : prev);
        break;
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
        break;
      }
      case 'createListAndAdd':
        createList(action.listName, [name]);
        break;
    }
  }, [customization, updateCustomization, userLists, updateList, createList]);

  const filters = useMemo(
    () => ({ colorIdentity, colorMode, excludedColors, typeFilter }),
    [colorIdentity, colorMode, excludedColors, typeFilter],
  );
  const result = useExplorerSearch(selectedTags, filters, sort);
  const addTag = useCallback((slug: string) => setSelectedTags(t => (t.includes(slug) ? t : [...t, slug])), []);
  const removeTag = useCallback((slug: string) => setSelectedTags(t => t.filter(s => s !== slug)), []);
  // Return to the landing splash (where the paste / decks / lists options live).
  // Clears the loaded deck too, so this works from the deck workbench as well.
  const backToOptions = useCallback(() => { setDeck(null); setSelectedTags([]); setStartedExploring(false); }, []);

  // When a deck loads: pull the index (for top-tags + preview tags) and adopt
  // the deck's combined color identity as the explorer filter.
  const handleDeckLoaded = useCallback(async (cards: ScryfallCard[]) => {
    setDeck(cards);
    const ci = new Set<string>();
    for (const c of cards) for (const col of c.color_identity ?? []) ci.add(col);
    setColorIdentity([...ci]);
    const ok = await loadTagIndex();
    setIndexReady(ok);
    // Seed the explorer with the deck's single most relevant (non-trivia) tag
    // so it isn't an empty "pick a tag" prompt. Don't clobber an existing pick.
    if (ok) {
      const top = aggregateDeckTags(cards).find(t => !t.ignored);
      if (top) setSelectedTags(prev => (prev.length === 0 ? [top.slug] : prev));
    }
  }, []);

  const topTags = useMemo(
    () => (deck && indexReady ? aggregateDeckTags(deck) : []),
    [deck, indexReady],
  );

  // Names already in the loaded deck — the explorer badges these so you can see
  // at a glance which results you already run. Updates live as cards are added.
  const deckNames = useMemo(() => new Set((deck ?? []).map(c => c.name)), [deck]);

  // The landing splash shows until the user loads a deck, picks a starter tag,
  // or explicitly chooses to explore without one.
  const showLanding = !deck && selectedTags.length === 0 && !startedExploring;

  if (showLanding) {
    return (
      <div className="min-h-[calc(100vh-77px)] flex flex-col">
        <div className="container mx-auto px-4 max-w-[1600px] flex-1">
          <SpellChromaBackdrop colorIdentity={colorIdentity} />
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

  const explorer = (
    <div className="flex flex-col gap-3">
      <TagSearchBar
        selectedTags={selectedTags}
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
        textFilter={textFilter}
        onTextFilterChange={setTextFilter}
      />
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
        dealKey={`${selectedTags.join(',')}|${colorIdentity.join('')}|${colorMode}|${excludedColors.join('')}|${typeFilter.join(',')}`}
        deckNames={deckNames}
        onLoadAll={result.loadAll}
        onTagClick={addTag}
        onCardAction={handleCardAction}
        menuProps={menuProps}
      />
    </div>
  );

  // Deck loaded → full-bleed workbench (no page padding; the split fills the
  // viewport under the nav and the panes carry their own padding).
  if (deck) {
    return (
      <>
        <SpellChromaBackdrop colorIdentity={colorIdentity} />
        <SpellChromaSplit
          deck={
            <DeckContextPanel
              cards={deck}
              colorIdentity={colorIdentity}
              topTags={topTags}
              selectedTags={selectedTags}
              onTagClick={addTag}
              onCardAction={handleCardAction}
              menuProps={menuProps}
              headerExtra={
                <Button variant="outline" size="sm" onClick={backToOptions} className="gap-1.5">
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Deck options
                </Button>
              }
            />
          }
          explorer={explorer}
        />
      </>
    );
  }

  return (
    <div className="min-h-[calc(100vh-77px)] flex flex-col">
      <div className="px-3 sm:px-4 py-3 flex-1">
        <SpellChromaBackdrop colorIdentity={colorIdentity} />
        <div className="mb-3 flex items-center justify-between gap-3">
          <h1 className="text-lg font-bold whitespace-nowrap">
            SpellChroma <span className="text-xs font-normal text-muted-foreground align-middle">· tag-driven discovery</span>
          </h1>
          <Button variant="outline" size="sm" onClick={backToOptions} className="gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" />
            Deck options
          </Button>
        </div>
        {explorer}
      </div>
      <SiteFooter />
    </div>
  );
}
