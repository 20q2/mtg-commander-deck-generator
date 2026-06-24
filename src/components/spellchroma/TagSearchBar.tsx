import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Plus, X, Search, Tag, ArrowUpDown, Layers } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ExplorerSort, ColorMatch } from '@/services/spellchroma/explorerSearch';
import { ColorFilterControl } from './ColorFilterControl';
import { TypeFilterControl } from './TypeFilterControl';
import { AddTagPopover } from './AddTagPopover';

const SORTS: { key: ExplorerSort; label: string }[] = [
  { key: 'edhrec', label: 'Top' },
  { key: 'cmc',    label: 'CMC' },
  { key: 'name',   label: 'A–Z' },
  { key: 'type',   label: 'Type' },
];

interface TagSearchBarProps {
  selectedTags: string[];
  onAddTag: (slug: string) => void;
  onRemoveTag: (slug: string) => void;
  colorIdentity: string[];
  onColorsChange: (next: string[]) => void;
  colorMode: ColorMatch;
  onColorModeChange: (m: ColorMatch) => void;
  excludedColors: string[];
  onExcludedChange: (next: string[]) => void;
  typeFilter: string[];
  onTypeFilterChange: (next: string[]) => void;
  sort: ExplorerSort;
  onSortChange: (s: ExplorerSort) => void;
  textFilter: string;
  onTextFilterChange: (s: string) => void;
  /** Pin the bar to the top of its scroll container (the workbench explorer pane). */
  sticky?: boolean;
  /** Show the "hide in-deck cards" toggle (only meaningful with a loaded deck). */
  showHideInDeck?: boolean;
  hideInDeck?: boolean;
  onHideInDeckChange?: (v: boolean) => void;
}

export function TagSearchBar({
  selectedTags, onAddTag, onRemoveTag, colorIdentity, onColorsChange,
  colorMode, onColorModeChange, excludedColors, onExcludedChange,
  typeFilter, onTypeFilterChange,
  sort, onSortChange, textFilter, onTextFilterChange, sticky = false,
  showHideInDeck = false, hideInDeck = false, onHideInDeckChange,
}: TagSearchBarProps) {
  // Selected-tag chips pop in/out and the Add-tag button slides with them.
  const [tagsRef] = useAutoAnimate<HTMLDivElement>({ duration: 240, easing: 'cubic-bezier(0.34, 1.5, 0.5, 1)' });

  return (
    <div className={`flex flex-wrap items-center gap-2 px-3 py-2 min-h-[52px] bg-card/95 backdrop-blur-sm border-b border-border/50 ${sticky ? 'sticky top-0 z-30' : ''}`}>
      {/* Selected tags + Add-tag trigger share one auto-animated group so chips
          pop in/out and the button slides along with them. */}
      <div ref={tagsRef} className="flex flex-wrap items-center gap-2">
        {selectedTags.map(slug => (
          <button key={slug} type="button" aria-label={`Remove ${slug}`} title={`Remove ${slug}`}
            onClick={() => onRemoveTag(slug)} className="group focus:outline-none rounded-md">
            <Badge className="gap-1 pr-1.5 cursor-pointer bg-violet-600 hover:bg-violet-600 text-white border border-violet-400/50 group-hover:bg-destructive group-hover:border-destructive/60 group-focus-visible:ring-2 group-focus-visible:ring-ring transition-colors">
              <Tag className="w-3 h-3 opacity-70 group-hover:hidden" />
              <X className="w-3 h-3 hidden group-hover:block" />
              {slug}
            </Badge>
          </button>
        ))}

        {/* Add-tag autocomplete */}
        <AddTagPopover selectedTags={selectedTags} onAddTag={onAddTag} align="start">
          <Button
            variant="outline"
            size="sm"
            className={`h-auto gap-1 px-2.5 py-0.5 text-xs rounded-full font-semibold border-violet-500/60 text-violet-300 hover:bg-violet-500/10 hover:text-violet-200 transition-colors ${
              selectedTags.length === 0 ? 'animate-pulse-subtle' : ''
            }`}
          >
            <Plus className="w-3 h-3" /> Add tag
          </Button>
        </AddTagPopover>
      </div>

      <div className="flex-1" />

      {/* Color identity (match mode + include/exclude) */}
      <ColorFilterControl
        colorIdentity={colorIdentity}
        onColorsChange={onColorsChange}
        colorMode={colorMode}
        onColorModeChange={onColorModeChange}
        excludedColors={excludedColors}
        onExcludedChange={onExcludedChange}
      />

      {/* Card type filter */}
      <TypeFilterControl typeFilter={typeFilter} onTypeFilterChange={onTypeFilterChange} />

      {/* Hide cards already in the loaded deck */}
      {showHideInDeck && (
        <button
          type="button"
          onClick={() => onHideInDeckChange?.(!hideInDeck)}
          aria-pressed={hideInDeck}
          title={hideInDeck ? 'Showing only cards not in your deck' : 'Hide cards already in your deck'}
          className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border transition-colors ${
            hideInDeck
              ? 'bg-violet-500/20 text-violet-200 border-violet-500/40'
              : 'border-border/50 text-muted-foreground/70 hover:text-foreground hover:bg-accent/50'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Hide in&nbsp;deck</span>
        </button>
      )}

      {/* Sort */}
      <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground/70" aria-hidden />
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
