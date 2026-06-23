import { useMemo, useState } from 'react';
import { Plus, X, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { allTags } from '@/services/spellchroma/tagIndex';
import type { ExplorerSort } from '@/services/spellchroma/explorerSearch';
import { ColorToggle } from './ColorToggle';

const SORTS: { key: ExplorerSort; label: string }[] = [
  { key: 'edhrec', label: 'Top' },
  { key: 'cmc',    label: 'CMC' },
  { key: 'name',   label: 'A–Z' },
];

interface TagSearchBarProps {
  selectedTags: string[];
  onAddTag: (slug: string) => void;
  onRemoveTag: (slug: string) => void;
  colorIdentity: string[];
  onColorsChange: (next: string[]) => void;
  sort: ExplorerSort;
  onSortChange: (s: ExplorerSort) => void;
  textFilter: string;
  onTextFilterChange: (s: string) => void;
}

export function TagSearchBar({
  selectedTags, onAddTag, onRemoveTag, colorIdentity, onColorsChange,
  sort, onSortChange, textFilter, onTextFilterChange,
}: TagSearchBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Top matches from the dictionary, excluding already-selected tags. Slug or
  // label substring match; cap at 40 so the popover stays light.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sel = new Set(selectedTags);
    return allTags()
      .filter(t => !sel.has(t.s) && (q === '' || t.s.includes(q) || t.l.toLowerCase().includes(q)))
      .slice(0, 40);
  }, [query, selectedTags]);

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-card/60 border border-border/50">
      {/* Selected tags */}
      {selectedTags.map(slug => (
        <Badge key={slug} variant="secondary" className="gap-1 pr-1">
          {slug}
          <button type="button" aria-label={`Remove ${slug}`} onClick={() => onRemoveTag(slug)}
            className="rounded-full hover:bg-background/40 p-0.5">
            <X className="w-3 h-3" />
          </button>
        </Badge>
      ))}

      {/* Add-tag autocomplete */}
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            <Plus className="w-3.5 h-3.5" /> Add tag
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <Input autoFocus value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search tags… (e.g. ramp, sacrifice)" className="mb-2" />
          <div className="max-h-64 overflow-y-auto flex flex-col">
            {matches.length === 0 && <p className="text-xs text-muted-foreground px-2 py-3">No matching tags.</p>}
            {matches.map(t => (
              <button key={t.s} type="button"
                onClick={() => { onAddTag(t.s); setQuery(''); setPickerOpen(false); }}
                className="text-left px-2 py-1.5 rounded hover:bg-accent transition-colors">
                <span className="text-sm">{t.s}</span>
                {t.l && t.l !== t.s && <span className="text-xs text-muted-foreground ml-2">{t.l}</span>}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <div className="flex-1" />

      {/* Color identity */}
      <ColorToggle value={colorIdentity} onChange={onColorsChange} />

      {/* Sort */}
      <div className="flex items-center border border-border/50 rounded-md overflow-hidden">
        {SORTS.map((s, i) => (
          <div key={s.key} className="contents">
            {i > 0 && <div className="w-px h-4 bg-border/50" />}
            <button type="button" onClick={() => onSortChange(s.key)} aria-pressed={sort === s.key}
              className={`text-xs px-2.5 py-1 transition-colors ${sort === s.key ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground/70 hover:text-foreground hover:bg-accent/50'}`}>
              {s.label}
            </button>
          </div>
        ))}
      </div>

      {/* Name/text filter (client-side over loaded results) */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
        <Input value={textFilter} onChange={e => onTextFilterChange(e.target.value)}
          placeholder="Filter…" className="pl-7 h-8 w-36" />
      </div>
    </div>
  );
}
