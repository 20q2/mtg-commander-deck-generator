import { useState, useCallback } from 'react';
import { Sparkles, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ScryfallCard, EDHRECTag } from '@/types';
import { fetchAllTags, fetchCommanderThemes, fetchCommanderThemeData, fetchPartnerThemeData } from '@/services/edhrec/client';
import { scoreThemeMatch, type ThemeMatchResult } from '@/services/deckBuilder/themeDetector';

export interface SelectedTheme { name: string; slug: string }

interface ThemePickerPopoverProps {
  themes: SelectedTheme[];
  onChange: (themes: SelectedTheme[]) => void;
  commanderName?: string;
  partnerCommanderName?: string;
  /** Current mainboard cards — powers "N of your M cards match" inference. */
  deckCards: ScryfallCard[];
}

const MAX_THEMES = 2;            // matches the generator's theme limit
const SUGGESTION_CANDIDATES = 5; // commander taglinks evaluated
const SUGGESTIONS_SHOWN = 3;

interface Suggestion {
  theme: SelectedTheme;
  match: ThemeMatchResult;
  deckNonBasicCount: number;
}

export function ThemePickerPopover({ themes, onChange, commanderName, partnerCommanderName, deckCards }: ThemePickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [allTags, setAllTags] = useState<EDHRECTag[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Lazy: taxonomy + inference load on first open, both fail-open.
  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next || allTags.length > 0) return;
    setLoading(true);
    void (async () => {
      try {
        const tags = await fetchAllTags();
        setAllTags(tags);

        if (commanderName) {
          const commanderThemes = await fetchCommanderThemes(commanderName).catch(() => []);
          const candidates = commanderThemes.slice(0, SUGGESTION_CANDIDATES);
          const results: Suggestion[] = [];
          const nonBasicCount = deckCards.length;
          for (const theme of candidates) {
            try {
              const data = partnerCommanderName
                ? await fetchPartnerThemeData(commanderName, partnerCommanderName, theme.slug)
                : await fetchCommanderThemeData(commanderName, theme.slug);
              const match = scoreThemeMatch(theme, data, deckCards);
              if (match.cardOverlap > 0) {
                results.push({ theme: { name: theme.name, slug: theme.slug }, match, deckNonBasicCount: nonBasicCount });
              }
            } catch { /* single theme page failing shouldn't kill suggestions */ }
          }
          results.sort((a, b) => b.match.score - a.match.score);
          setSuggestions(results.slice(0, SUGGESTIONS_SHOWN));
        } else {
          setSuggestions([]);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [allTags.length, commanderName, partnerCommanderName, deckCards]);

  const addTheme = (t: SelectedTheme) => {
    if (themes.length >= MAX_THEMES || themes.some(s => s.slug === t.slug)) return;
    onChange([...themes, t]);
  };
  const removeTheme = (slug: string) => onChange(themes.filter(t => t.slug !== slug));

  const selectedSlugs = new Set(themes.map(t => t.slug));
  const filtered = query.trim()
    ? allTags.filter(t => t.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 30)
    : allTags.slice(0, 30);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-violet-300/80" />
          {themes.length > 0
            ? <span className="text-xs">{themes.map(t => t.name).join(' + ')}</span>
            : <span className="text-xs hidden sm:inline">Theme</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-80 p-3 space-y-3">
        <div className="text-xs font-medium text-foreground/90">Deck theme (max {MAX_THEMES})</div>

        {themes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {themes.map(t => (
              <Badge key={t.slug} variant="secondary" className="gap-1 pr-1">
                {t.name}
                <button onClick={() => removeTheme(t.slug)} aria-label={`Remove ${t.name}`} className="hover:text-foreground">
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading EDHREC data…
          </div>
        )}

        {!loading && suggestions && suggestions.length > 0 && (
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Suggested for this deck</div>
            {suggestions.map(s => (
              <button
                key={s.theme.slug}
                onClick={() => addTheme(s.theme)}
                disabled={themes.length >= MAX_THEMES || selectedSlugs.has(s.theme.slug)}
                className="w-full text-left rounded-md px-2 py-1.5 hover:bg-accent/40 disabled:opacity-50 disabled:pointer-events-none"
              >
                <div className="text-xs font-medium">{s.theme.name}</div>
                <div className="text-[11px] text-violet-300/80">
                  {s.match.cardOverlap} of your {s.deckNonBasicCount} cards match this theme's EDHREC data
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="space-y-1.5">
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search all EDHREC themes…"
            className="h-8 text-xs"
          />
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {filtered.map(t => (
              <button
                key={t.slug}
                onClick={() => addTheme({ name: t.name, slug: t.slug })}
                disabled={themes.length >= MAX_THEMES || selectedSlugs.has(t.slug)}
                className="w-full flex items-center justify-between text-left rounded-md px-2 py-1 text-xs hover:bg-accent/40 disabled:opacity-50 disabled:pointer-events-none"
              >
                <span>{t.name}</span>
                <span className="text-muted-foreground/70 text-[11px]">{t.numDecks.toLocaleString()} decks</span>
              </button>
            ))}
            {!loading && filtered.length === 0 && (
              <div className="text-xs text-muted-foreground px-2 py-1">No themes match "{query}"</div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
