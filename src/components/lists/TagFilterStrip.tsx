import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Tags, ChevronDown, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';

export interface TagCount {
  name: string;
  /** How many decks/lists in the current view carry this tag. */
  count: number;
}

interface TagFilterStripProps {
  /** Tags for the current view, pre-sorted by popularity (most decks first). */
  tags: TagCount[];
  selected: string[];
  onToggle: (name: string) => void;
  onClear: () => void;
}

// Matches the `gap-1.5` (0.375rem) the row uses, so measurement math lines up.
const GAP = 6;

const CHIP_BASE =
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs border transition-colors whitespace-nowrap';
const CHIP_ACTIVE = 'bg-violet-500/20 border-violet-500/50 text-violet-200';
const CHIP_IDLE =
  'bg-card/60 border-border/40 text-muted-foreground hover:text-foreground hover:border-border';

/**
 * Single-row tag filter for the lists/decks grid. Fills exactly one row with the
 * most popular tags (selected tags always pulled to the front so an active filter
 * never hides), and collapses the overflow into a searchable "+N more" popover.
 *
 * Layout is width-driven: a hidden measuring layer captures each chip's pixel
 * width once per tag set, and a ResizeObserver recomputes the fit on resize. All
 * filter state lives in the parent — this component only reflects and reports it.
 */
export function TagFilterStrip({ tags, selected, onToggle, onClear }: TagFilterStripProps) {
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Selected first (in popularity order), then the rest — guarantees active
  // filters land at the front of the row and stay visible.
  const ordered = useMemo(() => {
    const sel: TagCount[] = [];
    const rest: TagCount[] = [];
    for (const t of tags) (selectedSet.has(t.name) ? sel : rest).push(t);
    return [...sel, ...rest];
  }, [tags, selectedSet]);

  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [fixed, setFixed] = useState({ label: 0, more: 0, clear: 0 });

  // Track the visible container width. contentRect excludes padding, which is
  // what we're filling into.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerW(el.clientWidth);
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setContainerW(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Measure every chip + the fixed furniture (label, more-chip, clear) off-screen.
  // Chip width is independent of active state (border/padding are identical), so a
  // single pass per tag set is enough — reselection doesn't need a re-measure.
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const w: Record<string, number> = {};
    const f = { label: 0, more: 0, clear: 0 };
    for (const child of Array.from(el.children) as HTMLElement[]) {
      const key = child.dataset.m;
      if (!key) continue;
      const width = child.getBoundingClientRect().width;
      if (key === 'label') f.label = width;
      else if (key === 'more') f.more = width;
      else if (key === 'clear') f.clear = width;
      else if (key.startsWith('tag:')) w[key.slice(4)] = width;
    }
    setWidths(w);
    setFixed(f);
  }, [tags]);

  const { visible, overflow } = useMemo(() => {
    const names = ordered.map(t => t.name);
    const ready = containerW > 0 && Object.keys(widths).length > 0;
    if (!ready) return { visible: names, overflow: [] as string[] };

    const clearW = selected.length > 0 ? fixed.clear + GAP : 0;

    // Does the whole set fit without a more-chip? Then show everything.
    let total = fixed.label;
    for (const t of ordered) total += GAP + (widths[t.name] ?? 0);
    if (total + clearW <= containerW) return { visible: names, overflow: [] as string[] };

    // Otherwise reserve room for the more-chip and greedily fill the row.
    const avail = containerW - fixed.label - GAP - fixed.more - clearW;
    const vis: string[] = [];
    const ov: string[] = [];
    let used = 0;
    for (const t of ordered) {
      const w = GAP + (widths[t.name] ?? 0);
      if (used + w <= avail) {
        vis.push(t.name);
        used += w;
      } else {
        ov.push(t.name);
      }
    }
    return { visible: vis, overflow: ov };
  }, [ordered, containerW, widths, fixed, selected.length]);

  const countOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tags) m.set(t.name, t.count);
    return m;
  }, [tags]);

  const overflowHasActive = overflow.some(n => selectedSet.has(n));

  const renderChip = (name: string, extraProps: Record<string, unknown> = {}) => {
    const active = selectedSet.has(name);
    return (
      <button
        key={name}
        type="button"
        onClick={() => onToggle(name)}
        aria-pressed={active}
        className={`${CHIP_BASE} ${active ? CHIP_ACTIVE : CHIP_IDLE}`}
        {...extraProps}
      >
        {name}
        <span className="opacity-50 tabular-nums">{countOf.get(name) ?? 0}</span>
      </button>
    );
  };

  if (tags.length === 0) return null;

  // One clipped row. The greedy fit keeps content within the line; overflow-hidden
  // is just a safety net against sub-pixel rounding.
  return (
    <div
      ref={containerRef}
      className="relative flex flex-nowrap items-center gap-1.5 mb-5 overflow-hidden"
    >
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground/70">
        <Tags className="w-3.5 h-3.5" /> Tags
      </span>

      {visible.map(name => renderChip(name))}

      {overflow.length > 0 && <MorePopover
        overflowCount={overflow.length}
        highlight={overflowHasActive}
        tags={tags}
        selectedSet={selectedSet}
        onToggle={onToggle}
      />}

      {selected.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors ml-0.5"
        >
          Clear
        </button>
      )}

      {/* Hidden measuring layer: identical chip markup, laid out off-screen so we
          can read pixel widths without affecting the visible row. */}
      <div
        ref={measureRef}
        aria-hidden
        className="absolute -left-[9999px] top-0 flex gap-1.5 invisible pointer-events-none"
      >
        <span
          data-m="label"
          className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide"
        >
          <Tags className="w-3.5 h-3.5" /> Tags
        </span>
        {tags.map(t => (
          <span key={t.name} data-m={`tag:${t.name}`} className={`${CHIP_BASE} ${CHIP_IDLE}`}>
            {t.name}
            <span className="opacity-50 tabular-nums">{t.count}</span>
          </span>
        ))}
        <span data-m="more" className={`${CHIP_BASE} ${CHIP_IDLE}`}>
          +99 more <ChevronDown className="w-3 h-3" />
        </span>
        <span data-m="clear" className="text-[11px]">
          Clear
        </span>
      </div>
    </div>
  );
}

interface MorePopoverProps {
  overflowCount: number;
  highlight: boolean;
  tags: TagCount[];
  selectedSet: Set<string>;
  onToggle: (name: string) => void;
}

/**
 * "+N more" chip → popover holding the full tag list (popularity order),
 * searchable and toggleable. We list every tag, not just the hidden ones, so it
 * doubles as a complete picker and never feels truncated.
 */
function MorePopover({ overflowCount, highlight, tags, selectedSet, onToggle }: MorePopoverProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? tags.filter(t => t.name.toLowerCase().includes(q)) : tags;
  }, [tags, query]);

  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setQuery(''); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`${CHIP_BASE} shrink-0 ${highlight ? CHIP_ACTIVE : CHIP_IDLE}`}
        >
          +{overflowCount} more <ChevronDown className="w-3 h-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <Input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search tags…"
          className="mb-2 h-8"
        />
        <div className="max-h-64 overflow-y-auto flex flex-col">
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-3">No matching tags.</p>
          )}
          {filtered.map(t => {
            const active = selectedSet.has(t.name);
            return (
              <button
                key={t.name}
                type="button"
                onClick={() => onToggle(t.name)}
                className={`flex items-center gap-2 text-left px-2 py-1.5 rounded transition-colors hover:bg-accent ${
                  active ? 'text-violet-200' : ''
                }`}
              >
                <span className="w-3 shrink-0">
                  {active && <Check className="w-3 h-3 text-violet-300" />}
                </span>
                <span className="text-sm flex-1 truncate">{t.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{t.count}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
