import { X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger, PopoverClose } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { MAJOR_TYPES } from '@/services/spellchroma/explorerSearch';

interface TypeFilterControlProps {
  typeFilter: string[];
  onTypeFilterChange: (next: string[]) => void;
}

export function TypeFilterControl({ typeFilter, onTypeFilterChange }: TypeFilterControlProps) {
  const toggle = (slug: string) =>
    onTypeFilterChange(typeFilter.includes(slug) ? typeFilter.filter(s => s !== slug) : [...typeFilter, slug]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          Types
          {typeFilter.length > 0 && (
            <span className="flex items-center gap-1 border-l border-border/60 pl-1.5">
              {typeFilter.map(s => <i key={s} className={`ms ms-${s} text-sm text-violet-300`} aria-hidden />)}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-2">
        {/* Header carries the close X — the grid below has no corner to spare. */}
        <div className="mb-1.5 flex items-center justify-between px-1">
          <p className="text-xs font-medium text-muted-foreground">Card types</p>
          <PopoverClose aria-label="Close" className="-mr-1 rounded-md p-1 text-muted-foreground/60 hover:bg-accent/50 hover:text-foreground transition-colors">
            <X className="w-3.5 h-3.5" />
          </PopoverClose>
        </div>
        <div className="grid grid-cols-2 gap-1">
          {MAJOR_TYPES.map(t => {
            const active = typeFilter.includes(t.slug);
            return (
              <button key={t.slug} type="button" onClick={() => toggle(t.slug)} aria-pressed={active} title={t.label}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
                  active
                    ? 'bg-violet-500/25 text-violet-50 ring-1 ring-violet-400/40'
                    : 'text-muted-foreground/80 hover:bg-accent/60 hover:text-foreground'
                }`}>
                <i className={`ms ms-${t.slug} text-lg ${active ? 'text-violet-200' : 'opacity-70'}`} aria-hidden />
                <span className="text-xs">{t.label}</span>
              </button>
            );
          })}
        </div>
        {typeFilter.length > 0 && (
          <button type="button" onClick={() => onTypeFilterChange([])}
            className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground py-1 text-center transition-colors">
            Clear types
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
