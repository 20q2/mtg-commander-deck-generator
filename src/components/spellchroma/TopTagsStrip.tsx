import { useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Tags } from 'lucide-react';
import type { DeckTagCount } from '@/services/spellchroma/tagIndex';

interface TopTagsStripProps {
  tags: DeckTagCount[];
  selected: string[];
  onTagClick: (slug: string) => void;
  limit?: number;
}

export function TopTagsStrip({ tags, selected, onTagClick, limit = 24 }: TopTagsStripProps) {
  const [showAll, setShowAll] = useState(false);
  // Reveal/hide of the trivia tags ("show all") and any tag changes animate.
  const [stripRef] = useAutoAnimate<HTMLDivElement>({ duration: 260, easing: 'cubic-bezier(0.34, 1.4, 0.5, 1)' });
  if (tags.length === 0) return null;

  const helpful = tags.filter(t => !t.ignored);
  const ignoredCount = tags.length - helpful.length;
  // Default view: helpful tags only, capped. "Show all" reveals the ignored
  // trivia tags too (still demoted to the end by aggregateDeckTags).
  const shown = showAll ? tags : helpful.slice(0, limit);
  const sel = new Set(selected);

  return (
    <div className="rounded-lg bg-violet-500/[0.06] border border-violet-500/20 px-3 py-2">
      <div ref={stripRef} className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-300/90 mr-1">
          <Tags className="w-3.5 h-3.5" />
          Your deck’s top tags
        </span>
        {shown.map(t => {
          const active = sel.has(t.slug);
          return (
            <button
              key={t.slug}
              type="button"
              onClick={() => onTagClick(t.slug)}
              title={`Explore cards tagged “${t.slug}”`}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                active
                  ? 'bg-violet-500/30 text-violet-100 border-violet-400/50'
                  : t.ignored
                    ? 'bg-transparent text-muted-foreground/60 border-border/40 hover:text-muted-foreground'
                    : 'bg-violet-500/12 text-violet-100/90 border-violet-500/25 hover:bg-violet-500/25'
              }`}
            >
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
    </div>
  );
}
