import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadTagDictionary, loadTagIndex, aggregateDeckTags } from '@/services/spellchroma/tagIndex';
import type { ExplorerSort } from '@/services/spellchroma/explorerSearch';
import { useExplorerSearch } from '@/components/spellchroma/useExplorerSearch';
import { TagSearchBar } from '@/components/spellchroma/TagSearchBar';
import { ExplorerGrid } from '@/components/spellchroma/ExplorerGrid';
import { DeckInput } from '@/components/spellchroma/DeckInput';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TopTagsStrip } from '@/components/spellchroma/TopTagsStrip';
import { SpellChromaSplit } from '@/components/spellchroma/SpellChromaSplit';
import { SpellChromaLanding } from '@/components/spellchroma/SpellChromaLanding';
import { DeckBuildingArea } from '@/components/analyze/DeckBuildingArea';
import type { ScryfallCard } from '@/types';

export function SpellChromaPage() {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [colorIdentity, setColorIdentity] = useState<string[]>([]);
  const [sort, setSort] = useState<ExplorerSort>('edhrec');
  const [textFilter, setTextFilter] = useState('');
  const [deck, setDeck] = useState<ScryfallCard[] | null>(null);
  const [indexReady, setIndexReady] = useState(false);
  const [startedExploring, setStartedExploring] = useState(false);

  useEffect(() => { void loadTagDictionary(); }, []);

  const result = useExplorerSearch(selectedTags, colorIdentity, sort);
  const addTag = useCallback((slug: string) => setSelectedTags(t => (t.includes(slug) ? t : [...t, slug])), []);
  const removeTag = useCallback((slug: string) => setSelectedTags(t => t.filter(s => s !== slug)), []);
  // Return to the landing splash (where the paste / decks / lists options live).
  const backToOptions = useCallback(() => { setSelectedTags([]); setStartedExploring(false); }, []);

  // When a deck loads: pull the index (for top-tags + preview tags) and adopt
  // the deck's combined color identity as the explorer filter.
  const handleDeckLoaded = useCallback(async (cards: ScryfallCard[]) => {
    setDeck(cards);
    const ci = new Set<string>();
    for (const c of cards) for (const col of c.color_identity ?? []) ci.add(col);
    setColorIdentity([...ci]);
    const ok = await loadTagIndex();
    setIndexReady(ok);
  }, []);

  const topTags = useMemo(
    () => (deck && indexReady ? aggregateDeckTags(deck) : []),
    [deck, indexReady],
  );

  // The landing splash shows until the user loads a deck, picks a starter tag,
  // or explicitly chooses to explore without one.
  const showLanding = !deck && selectedTags.length === 0 && !startedExploring;

  if (showLanding) {
    return (
      <div className="container mx-auto px-4 max-w-[1600px]">
        <SpellChromaLanding
          onLoad={handleDeckLoaded}
          onExplore={() => setStartedExploring(true)}
          onStarterTag={addTag}
        />
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
        sort={sort}
        onSortChange={setSort}
        textFilter={textFilter}
        onTextFilterChange={setTextFilter}
      />
      {topTags.length > 0 && (
        <TopTagsStrip tags={topTags} selected={selectedTags} onTagClick={addTag} />
      )}
      <ExplorerGrid
        cards={result.cards}
        total={result.total}
        hasMore={result.hasMore}
        loading={result.loading}
        loadingAll={result.loadingAll}
        error={result.error}
        hasTags={selectedTags.length > 0}
        textFilter={textFilter}
        onLoadAll={result.loadAll}
        onTagClick={addTag}
      />
    </div>
  );

  // Deck loaded → full-bleed workbench (no page padding; the split fills the
  // viewport under the nav and the panes carry their own padding).
  if (deck) {
    return (
      <SpellChromaSplit
        deck={<DeckBuildingArea currentCards={deck} headerExtra={<DeckInput onLoad={handleDeckLoaded} label="Change deck" />} />}
        explorer={explorer}
      />
    );
  }

  return (
    <div className="px-3 sm:px-4 py-3">
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
  );
}
