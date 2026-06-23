import { useEffect, useState } from 'react';
import { loadTagDictionary } from '@/services/spellchroma/tagIndex';
import type { ExplorerSort } from '@/services/spellchroma/explorerSearch';
import { useExplorerSearch } from '@/components/spellchroma/useExplorerSearch';
import { TagSearchBar } from '@/components/spellchroma/TagSearchBar';
import { ExplorerGrid } from '@/components/spellchroma/ExplorerGrid';

export function SpellChromaPage() {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [colorIdentity, setColorIdentity] = useState<string[]>([]);
  const [sort, setSort] = useState<ExplorerSort>('edhrec');
  const [textFilter, setTextFilter] = useState('');

  // Load the tag dictionary once so the autocomplete has data.
  useEffect(() => { void loadTagDictionary(); }, []);

  const result = useExplorerSearch(selectedTags, colorIdentity, sort);

  const addTag = (slug: string) => setSelectedTags(t => (t.includes(slug) ? t : [...t, slug]));
  const removeTag = (slug: string) => setSelectedTags(t => t.filter(s => s !== slug));

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">SpellChroma</h1>
        <p className="text-sm text-muted-foreground">Tag-driven card discovery — pick what a card should <em>do</em>.</p>
      </div>

      <div className="flex flex-col gap-4">
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
        />
      </div>
    </div>
  );
}
