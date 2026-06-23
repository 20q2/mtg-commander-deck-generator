import type { DeckTagCount } from '@/services/spellchroma/tagIndex';

interface TopTagsStripProps {
  tags: DeckTagCount[];
  selected: string[];
  onTagClick: (slug: string) => void;
  limit?: number;
}

export function TopTagsStrip({ tags, selected, onTagClick, limit = 24 }: TopTagsStripProps) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, limit);
  const sel = new Set(selected);

  return (
    <div className="rounded-lg bg-emerald-500/[0.06] border border-emerald-500/15 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold text-emerald-300/90 mr-1">Your deck’s top tags</span>
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
                    ? 'bg-transparent text-muted-foreground/50 border-border/40 hover:text-muted-foreground'
                    : 'bg-emerald-500/12 text-emerald-100/90 border-emerald-500/25 hover:bg-emerald-500/25'
              }`}
            >
              {t.slug}
              <span className="opacity-60 tabular-nums">{t.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
