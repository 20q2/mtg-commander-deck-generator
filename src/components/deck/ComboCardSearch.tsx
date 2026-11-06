import { useEffect, useMemo, useRef, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Search, X } from 'lucide-react';
import { Popover, PopoverContent } from '@/components/ui/popover';

const MAX_SUGGESTIONS = 8;

interface ComboCardSearchProps {
  /** Card name → how many visible combos use it. Suggestions only come from here. */
  cardCounts: Map<string, number>;
  /** The active card filter, if any. */
  value: string | null;
  onChange: (name: string | null) => void;
}

/**
 * Header search for the combo panel. Autocompletes against the cards in the
 * combos on offer — never the full card pool — so every pick has results.
 */
export function ComboCardSearch({ cardCounts, value, onChange }: ComboCardSearchProps) {
  const [query, setQuery] = useState(value ?? '');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // The filter can also be set from a card's right-click menu; mirror it.
  useEffect(() => { setQuery(value ?? ''); }, [value]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || query === value) return [];
    const matches: { name: string; count: number; prefix: boolean }[] = [];
    for (const [name, count] of cardCounts) {
      const idx = name.toLowerCase().indexOf(q);
      if (idx < 0) continue;
      const prefix = idx === 0 || name[idx - 1] === ' ';
      matches.push({ name, count, prefix });
    }
    matches.sort((a, b) =>
      Number(b.prefix) - Number(a.prefix) || b.count - a.count || a.name.localeCompare(b.name));
    return matches.slice(0, MAX_SUGGESTIONS);
  }, [query, value, cardCounts]);

  useEffect(() => { setHighlight(0); }, [suggestions]);

  const pick = (name: string) => {
    onChange(name);
    setQuery(name);
    setOpen(false);
  };
  const clear = () => {
    onChange(null);
    setQuery('');
    inputRef.current?.focus();
  };

  const showList = open && query.trim().length > 0 && query !== value;

  // The panel header toggles collapse on click. The list renders in a portal but
  // React still bubbles its clicks through here, so stop them at this root.
  return (
    <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
      <Popover open={showList} onOpenChange={setOpen}>
        <PopoverPrimitive.Anchor asChild>
          <div className="relative w-44 sm:w-52">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
                if (!e.target.value) onChange(null);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHighlight(h => Math.min(h + 1, suggestions.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHighlight(h => Math.max(h - 1, 0));
                } else if (e.key === 'Enter') {
                  if (suggestions[highlight]) pick(suggestions[highlight].name);
                } else if (e.key === 'Escape') {
                  if (showList) setOpen(false);
                  else if (query) clear();
                }
              }}
              placeholder="Find a card…"
              aria-label="Filter combos by card"
              className={`w-full h-6 pl-6 pr-6 rounded-md border bg-transparent text-[11px] placeholder:text-muted-foreground/70 outline-none transition-colors ${
                value ? 'border-violet-500/50 bg-violet-500/10 text-violet-100' : 'border-border text-foreground focus:border-violet-500/50'
              }`}
            />
            {query && (
              <button
                type="button"
                onClick={clear}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                title="Clear card filter"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </PopoverPrimitive.Anchor>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] min-w-56 p-1"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            // Clicks back into the input shouldn't close the list.
            if (inputRef.current?.contains(e.target as Node)) e.preventDefault();
          }}
        >
          {suggestions.length === 0 ? (
            <p className="px-2 py-1.5 text-[11px] text-muted-foreground">No combos use a card by that name.</p>
          ) : suggestions.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onMouseEnter={() => setHighlight(i)}
              onClick={() => pick(s.name)}
              className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                i === highlight ? 'bg-accent text-foreground' : 'text-foreground/90'
              }`}
            >
              <span className="flex-1 min-w-0 truncate">{s.name}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                {s.count.toLocaleString()} combo{s.count === 1 ? '' : 's'}
              </span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </span>
  );
}
