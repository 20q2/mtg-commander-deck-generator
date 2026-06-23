import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadTagDictionary, loadTagIndex, aggregateDeckTags } from '@/services/spellchroma/tagIndex';
import type { ExplorerSort } from '@/services/spellchroma/explorerSearch';
import { useExplorerSearch } from '@/components/spellchroma/useExplorerSearch';
import { TagSearchBar } from '@/components/spellchroma/TagSearchBar';
import { ExplorerGrid } from '@/components/spellchroma/ExplorerGrid';
import { DeckInput } from '@/components/spellchroma/DeckInput';
import { TopTagsStrip } from '@/components/spellchroma/TopTagsStrip';
import { SpellChromaSplit } from '@/components/spellchroma/SpellChromaSplit';
import { DeckBuildingArea } from '@/components/analyze/DeckBuildingArea';
import type { ScryfallCard } from '@/types';

export function SpellChromaPage() {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [colorIdentity, setColorIdentity] = useState<string[]>([]);
  const [sort, setSort] = useState<ExplorerSort>('edhrec');
  const [textFilter, setTextFilter] = useState('');
  const [deck, setDeck] = useState<ScryfallCard[] | null>(null);
  const [indexReady, setIndexReady] = useState(false);

  useEffect(() => { void loadTagDictionary(); }, []);

  const result = useExplorerSearch(selectedTags, colorIdentity, sort);
  const addTag = useCallback((slug: string) => setSelectedTags(t => (t.includes(slug) ? t : [...t, slug])), []);
  const removeTag = useCallback((slug: string) => setSelectedTags(t => t.filter(s => s !== slug)), []);

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

  return (
    <div className="container mx-auto px-4 py-6 max-w-[1600px]">
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">SpellChroma</h1>
          <p className="text-sm text-muted-foreground">Tag-driven card discovery — pick what a card should <em>do</em>.</p>
        </div>
        <DeckInput onLoad={handleDeckLoaded} label={deck ? 'Change deck' : 'Load a deck'} />
      </div>

      {deck
        ? <SpellChromaSplit deck={<DeckBuildingArea currentCards={deck} />} explorer={explorer} />
        : explorer}
    </div>
  );
}
