import { useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Tags, Tag, X, ChevronDown } from 'lucide-react';
import type { DeckTagCount } from '@/services/spellchroma/tagIndex';

interface TopTagsStripProps {
  tags: DeckTagCount[];
  selected: string[];
  onTagClick: (slug: string) => void;
  /** Remove a selected tag — clicking an active chip toggles it off. */
  onRemoveTag?: (slug: string) => void;
  limit?: number;
}

export function TopTagsStrip({ tags, selected, onTagClick, onRemoveTag, limit = 15 }: TopTagsStripProps) {
  const [showAll, setShowAll] = useState(false);
  // Persist collapse state so it survives switching SpellChroma views (the strip
  // remounts on view change and would otherwise default back to open).
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('spellchroma-top-tags-collapsed') === 'true',
  );
  const toggleCollapsed = () =>
    setCollapsed(c => {
      const next = !c;
      localStorage.setItem('spellchroma-top-tags-collapsed', String(next));
      return next;
    });
  // Collapse/expand, "show all" reveal, and tag changes all animate.
  const [bodyRef] = useAutoAnimate<HTMLDivElement>({ duration: 220, easing: 'cubic-bezier(0.34, 1.4, 0.5, 1)' });
  const [stripRef] = useAutoAnimate<HTMLDivElement>({ duration: 260, easing: 'cubic-bezier(0.34, 1.4, 0.5, 1)' });
  if (tags.length === 0) return null;

  const helpful = tags.filter(t => !t.ignored);
  const ignoredCount = tags.length - helpful.length;
  // Default view: helpful tags only, capped. "Show all" reveals the ignored
  // trivia tags too (still demoted to the end by aggregateDeckTags).
  const shown = showAll ? tags : helpful.slice(0, limit);
  const sel = new Set(selected);

  return (
    // Flush, non-rounded secondary header — mirrors the explorer's "Showing X of Y"
    // bar: full-bleed (negates the deck pane's p-3), border-b, same px-3 py-2.
    <div className="-mx-3 -mt-3 px-3 py-2 border-b border-border/50 bg-card/95 backdrop-blur-sm">
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1 text-[11px] font-semibold text-foreground hover:text-foreground/80 transition-colors"
      >
        <Tags className="w-3.5 h-3.5" />
        Your deck’s top tags
        <span className="text-violet-300/60 font-normal">· {helpful.length}</span>
        <ChevronDown className={`ml-auto w-3.5 h-3.5 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>
      <div ref={bodyRef}>
      {!collapsed && (
      <div ref={stripRef} className="flex flex-wrap items-center gap-1.5 mt-2">
        {shown.map((t, i) => {
          const active = sel.has(t.slug);
          return (
            <button
              key={t.slug}
              type="button"
              onClick={() => (active ? onRemoveTag?.(t.slug) : onTagClick(t.slug))}
              title={active ? `Remove “${t.slug}” from search` : `Explore cards tagged “${t.slug}”`}
              // Bubble in with a staggered delay so chips pop in one-by-one on open.
              // Cap the index so a long "show all" list doesn't drag the tail out.
              style={{ animationDelay: `${Math.min(i, 14) * 28}ms` }}
              className={`animate-chip-bubble group/chip inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                active
                  ? 'bg-violet-500/30 text-violet-100 border-violet-400/50 hover:bg-violet-500/40'
                  : t.ignored
                    ? 'bg-transparent text-muted-foreground/60 border-border/40 hover:text-muted-foreground'
                    : 'bg-violet-500/12 text-violet-100/90 border-violet-500/25 hover:bg-violet-500/25'
              }`}
            >
              {active
                ? <X className="w-3 h-3 opacity-80" />
                : <Tag className="w-3 h-3 opacity-70" />}
              {t.slug}
              <span className="opacity-60 tabular-nums">{t.count}</span>
            </button>
          );
        })}
        {ignoredCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(s => !s)}
            className="text-[11px] text-muted-foreground/70 hover:text-foreground px-1.5 py-0.5 rounded-full transition-colors"
          >
            {showAll ? 'show less' : `+ show all (${ignoredCount})`}
          </button>
        )}
      </div>
      )}
      </div>
    </div>
  );
}
