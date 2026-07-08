import { useState } from 'react';
import { Tags } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useThemeTaxonomy } from '@/hooks/useThemeTaxonomy';

export interface ThemeSuggestion {
  name: string;
  slug: string;
  /** Match score 0-100, shown on the right. */
  score?: number;
  /** Flags the confident detection pick(s). */
  isBestGuess?: boolean;
}

interface ThemeSearchListProps {
  /** Start loading the taxonomy (e.g. popover open / section expanded). */
  enabled: boolean;
  onPick: (theme: { name: string; slug: string }) => void;
  disabledSlugs?: Set<string>;
  /** Disable every row (e.g. max themes reached). */
  disableAll?: boolean;
  /** Deck-scored themes pinned to the top under a "Suggested" header (empty query only). */
  suggestions?: ThemeSuggestion[];
  maxHeightClass?: string;
}

/** Search across the full EDHREC theme taxonomy, with optional deck-scored
 *  suggestions pinned on top. One scrolling panel. Shared by the deck-view
 *  ThemePickerPopover and the Inspector's Adjust popover. */
export function ThemeSearchList({ enabled, onPick, disabledSlugs, disableAll, suggestions = [], maxHeightClass = 'max-h-56' }: ThemeSearchListProps) {
  const [query, setQuery] = useState('');
  const { tags, loading, filter } = useThemeTaxonomy(enabled);
  const searching = query.trim().length > 0;
  const results = filter(query);

  // Suggestions only pin when browsing (no query); taxonomy rows dedupe against them.
  const showSuggestions = !searching && suggestions.length > 0;
  const suggestedSlugs = new Set(suggestions.map(s => s.slug));
  const taxonomyRows = showSuggestions ? results.filter(t => !suggestedSlugs.has(t.slug)) : results;

  const rowClass = 'w-full flex items-center justify-between gap-2 text-left rounded-md px-2 py-1.5 text-xs hover:bg-accent/40 disabled:opacity-50 disabled:pointer-events-none';

  return (
    <div className="space-y-1.5">
      <Input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search all EDHREC themes…"
        className="h-8 text-xs"
      />
      <div className={`${maxHeightClass} overflow-y-auto space-y-0.5`}>
        {showSuggestions && (
          <>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70 px-2 pt-1 pb-0.5">Suggested for this deck</div>
            {suggestions.map(s => (
              <button
                key={s.slug}
                onClick={() => onPick({ name: s.name, slug: s.slug })}
                disabled={disableAll || disabledSlugs?.has(s.slug)}
                className={rowClass}
              >
                <span className="flex items-center gap-1.5 min-w-0 font-medium">
                  <Tags className="w-3 h-3 text-violet-300/70 shrink-0" />
                  <span className="truncate">{s.name}</span>
                  {s.isBestGuess && <span className="text-[10px] text-violet-300/80 shrink-0">best guess</span>}
                </span>
                {typeof s.score === 'number' && (
                  <span className="text-[11px] text-violet-300/80 tabular-nums shrink-0">{Math.round(s.score)}</span>
                )}
              </button>
            ))}
            {taxonomyRows.length > 0 && (
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70 px-2 pt-2 pb-0.5">All themes</div>
            )}
          </>
        )}
        {taxonomyRows.map(t => (
          <button
            key={t.slug}
            onClick={() => onPick({ name: t.name, slug: t.slug })}
            disabled={disableAll || disabledSlugs?.has(t.slug)}
            className={rowClass}
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <Tags className="w-3 h-3 text-violet-300/50 shrink-0" />
              <span className="truncate">{t.name}</span>
            </span>
            <span className="text-muted-foreground/70 text-[11px] shrink-0">{t.numDecks.toLocaleString()} decks</span>
          </button>
        ))}
        {!loading && tags.length > 0 && results.length === 0 && (
          <div className="text-xs text-muted-foreground px-2 py-1">No themes match "{query}"</div>
        )}
      </div>
    </div>
  );
}
