import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Crown, Search, Sparkles, X } from 'lucide-react';
import { CommanderSpotlight, CommanderTile } from './CommanderTile';
import {
  computeCommanderReadiness,
  type CommanderReadiness,
} from '@/services/collection/commanderReadiness';
import type { CollectionCard } from '@/services/collection/db';
import { useUserLists } from '@/hooks/useUserLists';
import type { UserCardList } from '@/types';

interface CollectionCommandersProps {
  cards: CollectionCard[];
}

type SortKey = 'readiness' | 'name' | 'recent';
type ColorFilterMode = 'at-least' | 'exact' | 'exclude';

const COLOR_CHIPS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;

function isLegendaryCreature(card: CollectionCard): boolean {
  const tl = (card.typeLine ?? '').split(' // ')[0].toLowerCase();
  return tl.includes('legendary') && tl.includes('creature');
}

function matchesColorFilter(
  card: CollectionCard,
  selected: Set<string>,
  mode: ColorFilterMode,
): boolean {
  if (selected.size === 0) return true;
  const ci = card.colorIdentity ?? [];
  const isColorless = ci.length === 0;
  const wantsColorless = selected.has('C');
  const wubrg = new Set([...selected].filter(c => c !== 'C'));

  switch (mode) {
    case 'exact': {
      if (wantsColorless && wubrg.size === 0) return isColorless;
      if (isColorless) return false;
      if (ci.length !== wubrg.size) return false;
      return ci.every(c => wubrg.has(c));
    }
    case 'exclude': {
      if (wantsColorless && isColorless) return false;
      return !ci.some(c => selected.has(c));
    }
    case 'at-least':
    default: {
      if (wantsColorless && isColorless) return true;
      return [...wubrg].every(c => ci.includes(c));
    }
  }
}

export function CollectionCommanders({ cards }: CollectionCommandersProps) {
  const legendaries = useMemo(() => cards.filter(isLegendaryCreature), [cards]);

  // Compute readiness for each legendary, in parallel-ish batches.
  const [readinessByName, setReadinessByName] = useState<Map<string, CommanderReadiness>>(new Map());
  const [loading, setLoading] = useState(false);
  const taskIdRef = useRef(0);

  useEffect(() => {
    const id = ++taskIdRef.current;
    if (legendaries.length === 0) {
      setReadinessByName(new Map());
      setLoading(false);
      return;
    }
    setLoading(true);
    const next = new Map<string, CommanderReadiness>();

    const BATCH_SIZE = 4;
    const queue = [...legendaries];

    async function worker() {
      while (queue.length > 0) {
        if (taskIdRef.current !== id) return; // collection changed mid-run
        const next_cmd = queue.shift();
        if (!next_cmd) return;
        const r = await computeCommanderReadiness(next_cmd.name, cards);
        if (taskIdRef.current !== id) return;
        next.set(next_cmd.name, r);
        setReadinessByName(new Map(next));
      }
    }

    Promise.all(Array.from({ length: BATCH_SIZE }, () => worker())).finally(() => {
      if (taskIdRef.current === id) setLoading(false);
    });
    // Re-run if the legendary set changes. Collection-content changes that don't add/remove
    // legendaries will still benefit from the cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legendaries.length, legendaries.map(l => l.name).join('|')]);

  // Sort + filter controls
  const [sortKey, setSortKey] = useState<SortKey>('readiness');
  const [colorFilter, setColorFilter] = useState<Set<string>>(new Set());
  const [colorFilterMode, setColorFilterMode] = useState<ColorFilterMode>('at-least');
  const [searchQuery, setSearchQuery] = useState('');
  // The Spotlight is the hero; the full list is opt-in via a collapsible.
  const [listOpen, setListOpen] = useState(false);

  const toggleColor = (code: string) => {
    setColorFilter(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  // Commanders matching the active filters (color + search), pre-sort.
  const filtered = useMemo(() => {
    let list = legendaries.filter(c => matchesColorFilter(c, colorFilter, colorFilterMode));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q));
    }
    return list;
  }, [legendaries, colorFilter, colorFilterMode, searchQuery]);

  const visible = useMemo(() => {
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'readiness': {
          const pa = readinessByName.get(a.name)?.percent ?? -1;
          const pb = readinessByName.get(b.name)?.percent ?? -1;
          if (pa !== pb) return pb - pa;
          return a.name.localeCompare(b.name);
        }
        case 'name':
          return a.name.localeCompare(b.name);
        case 'recent':
          return b.addedAt - a.addedAt;
      }
    });
  }, [filtered, sortKey, readinessByName]);

  // Spotlight pool: top-N commanders by readiness from the active-filter set.
  // The Spotlight cycles through these with prev/next; index resets on filter changes.
  const SPOTLIGHT_POOL_SIZE = 5;
  const spotlightPool = useMemo(() => {
    if (readinessByName.size === 0) return [] as { cmd: CollectionCard; r: CommanderReadiness }[];
    const scored: { cmd: CollectionCard; r: CommanderReadiness }[] = [];
    for (const cmd of filtered) {
      const r = readinessByName.get(cmd.name);
      if (!r || r.totalCount === 0) continue;
      scored.push({ cmd, r });
    }
    scored.sort((a, b) => b.r.percent - a.r.percent);
    return scored.slice(0, SPOTLIGHT_POOL_SIZE);
  }, [filtered, readinessByName]);

  const [spotlightIndex, setSpotlightIndex] = useState(0);
  // Reset to the first (best-readiness) entry whenever the filter set changes.
  useEffect(() => {
    setSpotlightIndex(0);
  }, [colorFilter, colorFilterMode, searchQuery]);
  const safeSpotlightIndex = Math.min(spotlightIndex, Math.max(0, spotlightPool.length - 1));
  const spotlight = spotlightPool[safeSpotlightIndex] ?? null;

  // Map: commander name → the first saved-deck list we find for that commander.
  // Used to show "saved deck" badges and adapt the Spotlight CTA.
  const { lists: allUserLists } = useUserLists();
  const savedDecksByCommander = useMemo(() => {
    const map = new Map<string, UserCardList>();
    for (const list of allUserLists) {
      if (list.type === 'deck' && list.commanderName) {
        if (!map.has(list.commanderName)) map.set(list.commanderName, list);
      }
    }
    return map;
  }, [allUserLists]);

  if (legendaries.length === 0) {
    return (
      <div className="text-center py-12 px-4">
        <Crown className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm font-medium">No legendary creatures in your collection yet.</p>
        <p className="text-xs text-muted-foreground mt-1.5 max-w-md mx-auto">
          Import some legendary creatures and they'll show up here, ranked by how ready they are to play.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Spotlight hero — owns its own padding so the collapsible below can sit flush */}
      {spotlight && (
        <div className="p-4 relative">
          <CommanderSpotlight
            commander={spotlight.cmd}
            readiness={spotlight.r}
            savedDeck={savedDecksByCommander.get(spotlight.cmd.name)}
          />

          {/* Carousel nav — prev/next arrows on the edges, plus a caption + dots at the bottom */}
          {spotlightPool.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => setSpotlightIndex(i => (i - 1 + spotlightPool.length) % spotlightPool.length)}
                aria-label="Previous commander"
                className="absolute left-6 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center bg-black/50 hover:bg-violet-500/90 text-white transition-colors shadow ring-1 ring-white/10"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setSpotlightIndex(i => (i + 1) % spotlightPool.length)}
                aria-label="Next commander"
                className="absolute right-6 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center bg-black/50 hover:bg-violet-500/90 text-white transition-colors shadow ring-1 ring-white/10"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
                <div className="flex items-center gap-1.5">
                  {spotlightPool.map((entry, i) => (
                    <button
                      key={entry.cmd.name}
                      type="button"
                      onClick={() => setSpotlightIndex(i)}
                      aria-label={`Spotlight ${entry.cmd.name}`}
                      className={`h-1.5 rounded-full transition-all ${
                        i === safeSpotlightIndex ? 'w-5 bg-violet-300' : 'w-1.5 bg-white/30 hover:bg-white/50'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-[10px] uppercase tracking-wider text-white/60">
                  Top {spotlightPool.length} ready · {safeSpotlightIndex + 1} of {spotlightPool.length}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Collapsible "Your Commanders" — divider + click target span the full section width
          and sit flush against the bottom edge of the section card. */}
      <div className="border-t border-border/40">
        <button
          type="button"
          onClick={() => setListOpen(o => !o)}
          aria-expanded={listOpen}
          className={`w-full flex items-center justify-between gap-2 text-left py-3 px-4 hover:bg-accent/30 transition-colors ${listOpen ? 'border-b border-border/40' : ''}`}
        >
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Crown className="w-3.5 h-3.5 text-violet-300/80" />
            Your Commanders
            <span className="text-xs text-muted-foreground font-normal ml-1">
              ({listOpen
                ? `${visible.length}${visible.length !== legendaries.length ? ` of ${legendaries.length}` : ''}`
                : legendaries.length})
            </span>
            {loading && (
              <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1 ml-2">
                <Sparkles className="w-3 h-3 animate-pulse text-violet-300/70" />
                reading staples…
              </span>
            )}
          </h3>
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground transition-transform ${listOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {listOpen && (
          <div className="px-4 pb-4 space-y-3">
            {/* Controls row */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Search */}
              <div className="relative flex-1 min-w-[160px] max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search commanders..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-7 h-8 text-xs rounded-md bg-background border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Color filter */}
              <div className="flex items-center gap-1">
                {COLOR_CHIPS.map(code => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => toggleColor(code)}
                    className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                      colorFilter.has(code)
                        ? 'ring-2 ring-violet-300/80 ring-offset-1 ring-offset-background scale-110'
                        : 'opacity-50 hover:opacity-90'
                    }`}
                    title={code}
                  >
                    <i className={`ms ms-${code.toLowerCase()} ms-cost text-sm`} />
                  </button>
                ))}
              </div>

              {/* Color filter mode (mirrors CollectionManager) */}
              {colorFilter.size > 0 && (
                <div className="flex rounded-md border border-border overflow-hidden text-[11px]">
                  {([
                    { mode: 'at-least' as const, label: 'Includes' },
                    { mode: 'exact' as const, label: 'Exact' },
                    { mode: 'exclude' as const, label: 'Exclude' },
                  ]).map(({ mode, label }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setColorFilterMode(mode)}
                      className={`px-2 py-0.5 transition-colors ${
                        colorFilterMode === mode
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* Sort */}
              <div className="relative ml-auto">
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="appearance-none pl-2.5 pr-7 py-1 text-xs rounded-md bg-background border border-border cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="readiness">Sort: Readiness</option>
                  <option value="name">Sort: Name</option>
                  <option value="recent">Sort: Recently added</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            {/* Grid */}
            {visible.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">No commanders match your filters.</p>
                <button
                  onClick={() => { setSearchQuery(''); setColorFilter(new Set()); }}
                  className="text-xs text-violet-300 hover:underline mt-1"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {visible.map(cmd => (
                  <CommanderTile
                    key={cmd.name}
                    commander={cmd}
                    readiness={readinessByName.get(cmd.name)}
                    loading={loading && !readinessByName.has(cmd.name)}
                    savedDeck={savedDecksByCommander.get(cmd.name)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
