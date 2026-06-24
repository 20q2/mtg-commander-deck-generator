import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Plus, X, Search, Tag, ArrowUpDown } from 'lucide-react';
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
  topTags?: string[];
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
}

export function TagSearchBar({
  selectedTags, topTags, onAddTag, onRemoveTag, colorIdentity, onColorsChange,
  colorMode, onColorModeChange, excludedColors, onExcludedChange,
  typeFilter, onTypeFilterChange,
  sort, onSortChange, textFilter, onTextFilterChange, sticky = false,
}: TagSearchBarProps) {
  // Selected-tag chips fade/shift in and out — a plain quick ease, no spring.
  const [tagsRef] = useAutoAnimate<HTMLDivElement>({ duration: 140, easing: 'ease-out' });

  return (
    <div className={`flex flex-col gap-2 px-3 py-2 min-h-[52px] bg-card/95 backdrop-blur-sm border-b border-border/50 ${sticky ? 'sticky top-0 z-30' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        {/* Add-tag trigger sits OUTSIDE the auto-animated chip group so it stays a
            stable anchor — inside, auto-animate's FLIP would slide it onto a new
            row whenever chips are added/removed. */}
        <AddTagPopover selectedTags={selectedTags} topTags={topTags} onAddTag={onAddTag} align="start">
          <Button
            variant="outline"
            size="sm"
            className={`shrink-0 h-auto gap-1 px-2.5 py-0.5 text-xs rounded-full font-semibold border-violet-500/60 text-violet-300 hover:bg-violet-500/10 hover:text-violet-200 transition-colors ${
              selectedTags.length === 0 ? 'animate-pulse-subtle' : ''
            }`}
          >
            <Plus className="w-3 h-3" /> Add tag
          </Button>
        </AddTagPopover>

        {/* Selected tags — auto-animated so chips pop in/out. */}
        <div ref={tagsRef} className="flex flex-wrap items-center gap-2">
          {selectedTags.map(slug => (
            <button key={slug} type="button" aria-label={`Remove ${slug}`} title={`Remove ${slug}`}
              onClick={() => onRemoveTag(slug)} className="group focus:outline-none rounded-full overflow-hidden">
              <Badge className="gap-1 pr-1.5 cursor-pointer overflow-hidden whitespace-nowrap bg-violet-600 hover:bg-violet-600 text-white border border-violet-400/50 group-hover:bg-destructive group-hover:border-destructive/60 group-focus-visible:ring-2 group-focus-visible:ring-ring transition-colors">
                <Tag className="w-3 h-3 opacity-70 group-hover:hidden" />
                <X className="w-3 h-3 hidden group-hover:block" />
                {slug}
              </Badge>
            </button>
          ))}
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
    </div>
  );
}
