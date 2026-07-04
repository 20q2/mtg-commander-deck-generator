import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { useThemeTaxonomy } from '@/hooks/useThemeTaxonomy';

interface ThemeSearchListProps {
  /** Start loading the taxonomy (e.g. popover open / section expanded). */
  enabled: boolean;
  onPick: (theme: { name: string; slug: string }) => void;
  disabledSlugs?: Set<string>;
  /** Disable every row (e.g. max themes reached). */
  disableAll?: boolean;
  maxHeightClass?: string;
}

/** Search across the full EDHREC theme taxonomy. Shared by the deck-view
 *  ThemePickerPopover and the Inspector's Adjust popover. */
export function ThemeSearchList({ enabled, onPick, disabledSlugs, disableAll, maxHeightClass = 'max-h-48' }: ThemeSearchListProps) {
  const [query, setQuery] = useState('');
  const { tags, loading, filter } = useThemeTaxonomy(enabled);
  const results = filter(query);

  return (
    <div className="space-y-1.5">
      <Input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search all EDHREC themes…"
        className="h-8 text-xs"
      />
      <div className={`${maxHeightClass} overflow-y-auto space-y-0.5`}>
        {results.map(t => (
          <button
            key={t.slug}
            onClick={() => onPick({ name: t.name, slug: t.slug })}
            disabled={disableAll || disabledSlugs?.has(t.slug)}
            className="w-full flex items-center justify-between text-left rounded-md px-2 py-1 text-xs hover:bg-accent/40 disabled:opacity-50 disabled:pointer-events-none"
          >
            <span>{t.name}</span>
            <span className="text-muted-foreground/70 text-[11px]">{t.numDecks.toLocaleString()} decks</span>
          </button>
        ))}
        {!loading && tags.length > 0 && results.length === 0 && (
          <div className="text-xs text-muted-foreground px-2 py-1">No themes match "{query}"</div>
        )}
      </div>
    </div>
  );
}
