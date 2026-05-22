// src/components/analyze/DeckBuildingArea.tsx
import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { ArrowUpDown, BarChart3, Sprout, Swords, Flame, BookOpen, ArrowUp, ArrowDown } from 'lucide-react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import type { ScryfallCard } from '@/types';
import { buildCurveBuckets } from './DeckBuildingArea.buckets';
import { getCardImageUrl, getCardPrice, isBasicLand, isMdfcLand, isChannelLand } from '@/services/scryfall/client';
import { isUtilityLand, isTapland, loadTaggerData } from '@/services/tagger/client';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import type { CardRowMenuProps } from '@/components/deck/optimizer/shared';
import type { ThemeMembership } from './themeMembership';

interface DeckBuildingAreaProps {
  currentCards: ScryfallCard[];
  excludeNames?: Set<string>;
  highlightRoles?: boolean;
  activeRole?: string | null;
  activeCmcRange?: [number, number] | null;
  activeRoleGroup?: string | null;
  removalNames?: Set<string>;
  focusLands?: boolean;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
  themeMembership?: ThemeMembership | null;
}

const COLUMN_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7+'];

// Role swatch color — used in the header legend.
const ROLE_SWATCH: Record<string, string> = {
  ramp:      'bg-emerald-500',
  removal:   'bg-rose-500',
  boardwipe: 'bg-orange-500',
  cardDraw:  'bg-sky-500',
};

// Per-theme chip color, matching the THEMES popover (violet = #1, amber = #2).
const THEME_CHIP_CLASS: string[] = [
  'bg-violet-500/90 text-violet-50 border border-violet-300/70',
  'bg-amber-500/90 text-amber-50 border border-amber-300/70',
];

// Per-card corner badge (text on a translucent backdrop).
const ROLE_BADGE: Record<string, string> = {
  ramp:      'bg-emerald-500/90 text-emerald-50 border border-emerald-300/70',
  removal:   'bg-rose-500/90 text-rose-50 border border-rose-300/70',
  boardwipe: 'bg-orange-500/90 text-orange-50 border border-orange-300/70',
  cardDraw:  'bg-sky-500/90 text-sky-50 border border-sky-300/70',
};

const ROLE_LABEL: Record<string, string> = {
  ramp:      'Ramp',
  removal:   'Removal',
  boardwipe: 'Wipe',
  cardDraw:  'Draw',
};

const ROLE_ICON: Record<string, typeof Sprout> = {
  ramp:      Sprout,
  removal:   Swords,
  boardwipe: Flame,
  cardDraw:  BookOpen,
};

// Role-priority sort uses the same cascade as the rest of the analyzer.
const ROLE_PRIORITY: Record<string, number> = {
  boardwipe: 0,
  removal:   1,
  ramp:      2,
  cardDraw:  3,
};

const COLOR_PRIORITY: Record<string, number> = { W: 0, U: 1, B: 2, R: 3, G: 4 };

type SortKey = 'name' | 'color' | 'role' | 'theme' | 'price';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'name',  label: 'Name'  },
  { key: 'color', label: 'Color' },
  { key: 'role',  label: 'Role'  },
  { key: 'theme', label: 'Theme' },
  { key: 'price', label: 'Price' },
];

type LandCategory = 'basic' | 'mdfc' | 'channel' | 'tapland' | 'utility' | 'other';

const LAND_CATEGORIES: { key: LandCategory; label: string }[] = [
  { key: 'basic',   label: 'Basic'   },
  { key: 'mdfc',    label: 'MDFC'    },
  { key: 'channel', label: 'Channel' },
  { key: 'tapland', label: 'Tap'     },
  { key: 'utility', label: 'Utility' },
  { key: 'other',   label: 'Other'   },
];

function categorizeLand(card: ScryfallCard): LandCategory {
  if (isBasicLand(card)) return 'basic';
  if (isMdfcLand(card)) return 'mdfc';
  if (isChannelLand(card)) return 'channel';
  if (isUtilityLand(card.name)) return 'utility';
  if (isTapland(card.name)) return 'tapland';
  return 'other';
}

function colorRank(card: ScryfallCard): number {
  const ci = card.color_identity || [];
  if (ci.length === 0) return 100; // colorless
  if (ci.length === 1) return COLOR_PRIORITY[ci[0]] ?? 50;
  return 50 + ci.length; // multicolor, ordered by # of colors
}

type SortDir = 'asc' | 'desc';

function sortBy(
  cards: ScryfallCard[],
  key: SortKey,
  dir: SortDir = 'asc',
  themeMembership: ThemeMembership | null = null,
): ScryfallCard[] {
  const out = [...cards];
  const sign = dir === 'asc' ? 1 : -1;
  if (key === 'name') {
    out.sort((a, b) => sign * a.name.localeCompare(b.name));
  } else if (key === 'color') {
    out.sort((a, b) => {
      const d = sign * (colorRank(a) - colorRank(b));
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
  } else if (key === 'role') {
    out.sort((a, b) => {
      const ar = a.deckRole ? (ROLE_PRIORITY[a.deckRole] ?? 99) : 99;
      const br = b.deckRole ? (ROLE_PRIORITY[b.deckRole] ?? 99) : 99;
      return ar !== br ? sign * (ar - br) : a.name.localeCompare(b.name);
    });
  } else if (key === 'theme') {
    const rank = (c: ScryfallCard): number => {
      const idxs = themeMembership?.byCard.get(c.name.toLowerCase());
      if (!idxs || idxs.length === 0) return 3;
      const hasPrimary = idxs.includes(0);
      const hasSecondary = idxs.includes(1);
      if (hasPrimary && hasSecondary) return 0;
      if (hasPrimary) return 1;
      if (hasSecondary) return 2;
      return 3;
    };
    out.sort((a, b) => {
      const d = sign * (rank(a) - rank(b));
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
  } else if (key === 'price') {
    out.sort((a, b) => {
      const ap = parseFloat(getCardPrice(a) ?? '0');
      const bp = parseFloat(getCardPrice(b) ?? '0');
      return bp !== ap ? sign * (ap - bp) : a.name.localeCompare(b.name);
    });
  }
  return out;
}

// Per-sort default direction. Names/colors/roles read left-to-right ascending;
// price feels more useful starting from the expensive end.
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  name: 'asc', color: 'asc', role: 'asc', theme: 'asc', price: 'desc',
};

interface HoverState {
  card: ScryfallCard;
  anchor: { left: number; right: number; top: number; height: number };
}

type RightView = 'spells' | 'lands';
const VIEW_KEY = 'analyze-play-area-view';
const SORT_STORAGE_KEY = 'analyze-play-area-sort';
const SORT_DIR_STORAGE_KEY = 'analyze-play-area-sort-dir';
const DIM_ROLES_KEY = 'analyze-play-area-dim-roles';

export function DeckBuildingArea({ currentCards, excludeNames, highlightRoles = false, activeRole = null, activeCmcRange = null, activeRoleGroup = null, removalNames, focusLands = false, onCardAction, menuProps, themeMembership = null }: DeckBuildingAreaProps) {
  const buckets = useMemo(
    () => buildCurveBuckets(currentCards, { excludeNames }),
    [currentCards, excludeNames],
  );

  const [view, setView] = useState<RightView>(() => {
    const stored = localStorage.getItem(VIEW_KEY);
    return stored === 'lands' ? 'lands' : 'spells';
  });
  useEffect(() => { localStorage.setItem(VIEW_KEY, view); }, [view]);
  // Lands left-tab nudges the view to lands on entry, back to non-lands on
  // exit. Both buttons stay live so the user can override manually.
  useEffect(() => {
    setView(focusLands ? 'lands' : 'spells');
  }, [focusLands]);

  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const stored = localStorage.getItem(SORT_STORAGE_KEY);
    return (stored === 'name' || stored === 'color' || stored === 'role' || stored === 'theme' || stored === 'price') ? stored : 'name';
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    const stored = localStorage.getItem(SORT_DIR_STORAGE_KEY);
    if (stored === 'asc' || stored === 'desc') return stored;
    const k = (localStorage.getItem(SORT_STORAGE_KEY) ?? 'name') as SortKey;
    return DEFAULT_DIR[k] ?? 'asc';
  });

  useEffect(() => { localStorage.setItem(SORT_STORAGE_KEY, sortKey); }, [sortKey]);
  useEffect(() => { localStorage.setItem(SORT_DIR_STORAGE_KEY, sortDir); }, [sortDir]);
  // Fall back to name sort if the Theme option vanishes (no themes selected).
  useEffect(() => {
    if (sortKey === 'theme' && (!themeMembership || themeMembership.themes.length === 0)) {
      setSortKey('name');
      setSortDir(DEFAULT_DIR.name);
    }
  }, [sortKey, themeMembership]);
  // When the user picks a different sort, fall back to that sort's natural
  // default direction (price wants desc; name wants asc).
  const handleSortKeyChange = useCallback((next: SortKey) => {
    setSortKey(next);
    setSortDir(DEFAULT_DIR[next] ?? 'asc');
  }, []);
  const toggleSortDir = useCallback(() => {
    setSortDir(d => d === 'asc' ? 'desc' : 'asc');
  }, []);

  type FilterMode = 'off' | 'dim' | 'hide';
  const [filterMode, setFilterMode] = useState<FilterMode>(() => {
    const stored = localStorage.getItem(DIM_ROLES_KEY);
    if (stored === 'off' || stored === 'dim' || stored === 'hide') return stored;
    // Legacy boolean values from before the 3-mode toggle.
    if (stored === 'false') return 'off';
    return 'dim';
  });
  useEffect(() => { localStorage.setItem(DIM_ROLES_KEY, filterMode); }, [filterMode]);
  const dimEnabled = filterMode === 'dim';
  const hideEnabled = filterMode === 'hide';

  // Predicate matching the current dim/hide filter.
  const matchesActiveFilter = useCallback((card: ScryfallCard): boolean => {
    const role = card.deckRole;
    if (activeCmcRange != null || activeRoleGroup != null) {
      const cardCmc = Math.min(Math.floor(card.cmc ?? 0), 7);
      const cmcOk = !activeCmcRange || (cardCmc >= activeCmcRange[0] && cardCmc <= activeCmcRange[1]);
      const groupOk = !activeRoleGroup
        || (activeRoleGroup === 'ramp' && role === 'ramp')
        || (activeRoleGroup === 'interaction' && (role === 'removal' || role === 'boardwipe'))
        || (activeRoleGroup === 'cardDraw' && role === 'cardDraw')
        || (activeRoleGroup === 'other' && !role);
      return cmcOk && groupOk;
    }
    return activeRole ? role === activeRole : !!role;
  }, [activeRole, activeCmcRange, activeRoleGroup]);

  // Apply the user's sort within each cell. Buckets keep their CMC × type
  // organization; we just re-order the cards inside. In `hide` mode we also
  // drop cards that don't match the active filter so the play area collapses
  // to just the matching ones.
  const sortedBuckets = useMemo(() => {
    const applyFilter = (col: ScryfallCard[]) => hideEnabled && highlightRoles
      ? col.filter(matchesActiveFilter)
      : col;
    return {
      creatures: buckets.creatures.map(col => sortBy(applyFilter(col), sortKey, sortDir, themeMembership)),
      noncreatures: buckets.noncreatures.map(col => sortBy(applyFilter(col), sortKey, sortDir, themeMembership)),
      lands: buckets.lands.map(col => sortBy(col, sortKey, sortDir, themeMembership)),
    };
  }, [buckets, sortKey, sortDir, hideEnabled, highlightRoles, matchesActiveFilter, themeMembership]);

  // Only render CMC columns that actually have non-land cards. Lands have
  // their own category-based drawer beside the curve, so counting them here
  // would falsely keep CMC 0 alive whenever you have any basics.
  const activeCmcs = useMemo(
    () => COLUMN_LABELS
      .map((_, i) => i)
      .filter(i => sortedBuckets.creatures[i].length > 0
                || sortedBuckets.noncreatures[i].length > 0),
    [sortedBuckets],
  );
  const gridTemplate = `repeat(${activeCmcs.length}, minmax(0, 130px))`;

  // Ensure tagger data is loaded so utility/tapland categorization works.
  // Cheap no-op if it's already cached.
  const [taggerReady, setTaggerReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadTaggerData().then(() => { if (!cancelled) setTaggerReady(true); });
    return () => { cancelled = true; };
  }, []);

  // Split the flat lands array into named categories (Basic / MDFC /
  // Channel / Tapland / Utility / Other) and apply the user's sort within
  // each. Only categories with cards survive into the rendered row.
  const landCategoryGroups = useMemo(() => {
    void taggerReady; // re-categorize once tagger data loads
    const flat = buckets.lands.flat();
    const groups: Record<LandCategory, ScryfallCard[]> = {
      basic: [], fetch: [], mdfc: [], channel: [], tapland: [], utility: [], other: [],
    };
    for (const card of flat) groups[categorizeLand(card)].push(card);
    return LAND_CATEGORIES
      .map(({ key, label }) => ({ key, label, cards: sortBy(groups[key], sortKey, sortDir, themeMembership) }))
      .filter(g => g.cards.length > 0);
  }, [buckets, sortKey, sortDir, taggerReady, themeMembership]);
  const landsGridTemplate = `repeat(${Math.max(landCategoryGroups.length, 1)}, minmax(0, 130px))`;

  const [hover, setHover] = useState<HoverState | null>(null);
  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);

  const handleHover = (card: ScryfallCard | null, e?: React.MouseEvent) => {
    if (card && e) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setHover({ card, anchor: { left: rect.left, right: rect.right, top: rect.top, height: rect.height } });
    } else {
      setHover(null);
    }
  };

  const totalNonLand = buckets.countsByCmc.reduce((n, c) => n + c, 0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(Infinity);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const showRoleLegend = containerWidth >= 900;

  // Measure the playmat (the dot-grid area below the header) so the stack
  // overlap can tighten when the column would otherwise overflow off the
  // bottom of the screen. Both CurveRows share this height.
  const playmatRef = useRef<HTMLDivElement | null>(null);
  const [playmatHeight, setPlaymatHeight] = useState<number>(0);
  useEffect(() => {
    const el = playmatRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setPlaymatHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Dynamic stack overlap. Cards have aspect 5:7 so card height = 1.4 × W
  // (column width). Default sliver is 20% of W (the -120% margin). When the
  // tallest column would overflow the playmat we compress the sliver, down
  // to a floor of 5% (just enough for the name strip). Two rows compete for
  // vertical space in spells view; lands view uses a single row.
  const marginTopPercent = useMemo(() => {
    const DEFAULT = -120;
    const MIN_SLIVER_PCT = 5;     // floor: don't go below 5% of W
    const MAX_SLIVER_PCT = 20;    // default: 20% of W (matches original look)
    const COL_GAP_PX = 8;         // gap-2 between columns
    const ROW_LABELS_PX = 28;     // ~py-1 + text line ≈ 28px
    const ROW_PADDING_PX = 32;    // CurveRow py-2 × 2 rows = ~32px
    const PLAYMAT_BOTTOM_PAD = 16;
    if (!playmatHeight || !isFinite(containerWidth)) return DEFAULT;

    if (view === 'spells') {
      const n = activeCmcs.length;
      if (n === 0) return DEFAULT;
      const maxCreatures = Math.max(0, ...activeCmcs.map(i => sortedBuckets.creatures[i].length));
      const maxNoncreatures = Math.max(0, ...activeCmcs.map(i => sortedBuckets.noncreatures[i].length));
      const totalStackCards = maxCreatures + maxNoncreatures;
      if (totalStackCards <= 2) return DEFAULT;
      const availableWidth = containerWidth - (n - 1) * COL_GAP_PX - 32;
      const W = Math.min(130, availableWidth / n);
      const availableH = playmatHeight - ROW_LABELS_PX - ROW_PADDING_PX - PLAYMAT_BOTTOM_PAD;
      // (1.4W + (Mc-1)·sliver·W) + (1.4W + (Mn-1)·sliver·W) ≤ availableH
      // → sliver ≤ (availableH/W − 2.8) / (Mc + Mn − 2)
      const sliverFraction = (availableH / W - 2.8) / Math.max(1, totalStackCards - 2);
      const sliverPct = Math.max(MIN_SLIVER_PCT, Math.min(MAX_SLIVER_PCT, sliverFraction * 100));
      return -(140 - sliverPct);
    } else {
      const groups = landCategoryGroups;
      const n = groups.length;
      if (n === 0) return DEFAULT;
      const maxLandStack = Math.max(0, ...groups.map(g => g.cards.length));
      if (maxLandStack <= 1) return DEFAULT;
      const availableWidth = containerWidth - (n - 1) * COL_GAP_PX - 32;
      const W = Math.min(130, availableWidth / n);
      const availableH = playmatHeight - ROW_LABELS_PX - ROW_PADDING_PX / 2 - PLAYMAT_BOTTOM_PAD;
      const sliverFraction = (availableH / W - 1.4) / Math.max(1, maxLandStack - 1);
      const sliverPct = Math.max(MIN_SLIVER_PCT, Math.min(MAX_SLIVER_PCT, sliverFraction * 100));
      return -(140 - sliverPct);
    }
  }, [view, activeCmcs, sortedBuckets, landCategoryGroups, playmatHeight, containerWidth]);

  return (
    <div ref={rootRef} className="border-y border-border/40 flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Header — bigger, with sort selector */}
      <div className="flex items-center justify-between gap-3 px-2 sm:px-4 py-2 min-h-[52px] border-b border-border/30">
        <div className="flex items-center gap-2 min-w-0">
          <BarChart3 className="w-4 h-4 text-primary/70 shrink-0" />
          <span className="text-sm font-bold uppercase tracking-wider">Deck</span>
          {/* View toggle — Non-lands / Lands. Replaces the side drawer. */}
          <div className="flex items-center border border-border/50 rounded-md overflow-hidden">
            <button
              type="button"
              onClick={() => setView('spells')}
              aria-pressed={view === 'spells'}
              className={`text-[10px] px-2 py-0.5 tabular-nums transition-colors ${
                view === 'spells'
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground/60 hover:text-foreground hover:bg-accent/50'
              }`}
              title="Show creatures and non-creatures"
            >
              Non-lands <span className="text-muted-foreground/60">{totalNonLand}</span>
            </button>
            <div className="w-px h-3 bg-border/50" />
            <button
              type="button"
              onClick={() => setView('lands')}
              aria-pressed={view === 'lands'}
              className={`text-[10px] px-2 py-0.5 tabular-nums transition-colors ${
                view === 'lands'
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground/60 hover:text-foreground hover:bg-accent/50'
              }`}
              title="Show lands by category"
            >
              Lands <span className="text-muted-foreground/60">{buckets.landCount}</span>
            </button>
          </div>
          {/* Role legend — only on Roles tab. Color swatches hide when narrow; All/Dim/Hide always shows. */}
          {highlightRoles && (
          <div className="flex items-center gap-2 ml-3 text-[10px] text-muted-foreground/70">
            {showRoleLegend && Object.entries(ROLE_LABEL).map(([key, label]) => {
              const dimmed = highlightRoles && dimEnabled && activeRole != null && activeRole !== key;
              return (
                <span
                  key={key}
                  className={`inline-flex items-center gap-1 transition-opacity ${dimmed ? 'opacity-40' : ''}`}
                >
                  <span
                    className={`inline-block w-2 h-2 rounded-sm transition-colors ${dimmed ? 'bg-muted-foreground/30' : ROLE_SWATCH[key]}`}
                  />
                  {label}
                </span>
              );
            })}
            {highlightRoles && (
              <div className="ml-1 flex items-center border border-border/50 rounded-md overflow-hidden">
                {(['off', 'dim', 'hide'] as FilterMode[]).map((mode, i) => (
                  <div key={mode} className="contents">
                    {i > 0 && <div className="w-px h-3 bg-border/50" />}
                    <button
                      type="button"
                      onClick={() => setFilterMode(mode)}
                      aria-pressed={filterMode === mode}
                      className={`text-[10px] px-2 py-0.5 transition-colors ${
                        filterMode === mode
                          ? 'bg-accent text-foreground font-medium'
                          : 'text-muted-foreground/60 hover:text-foreground hover:bg-accent/50'
                      }`}
                      title={
                        mode === 'off' ? 'Show every card in full color'
                        : mode === 'dim' ? 'Grey out non-matching cards'
                        : 'Hide non-matching cards entirely'
                      }
                    >
                      {mode === 'off' ? 'All' : mode === 'dim' ? 'Dim' : 'Hide'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Sort button group. Click the active sort to flip direction. */}
          <div className="flex items-center gap-1">
            <ArrowUpDown className="w-3 h-3 text-muted-foreground/50" />
            <div className="flex items-center border border-border/50 rounded-md overflow-hidden">
              {SORT_OPTIONS
                .filter(o => o.key !== 'theme' || (themeMembership && themeMembership.themes.length > 0))
                .map((opt, i) => {
                const active = sortKey === opt.key;
                const ArrowIcon = sortDir === 'asc' ? ArrowUp : ArrowDown;
                return (
                  <div key={opt.key} className="contents">
                    {i > 0 && <div className="w-px h-3 bg-border/50" />}
                    <button
                      type="button"
                      onClick={() => active ? toggleSortDir() : handleSortKeyChange(opt.key)}
                      className={`text-[10px] px-2 py-0.5 inline-flex items-center gap-1 transition-colors ${
                        active
                          ? 'bg-accent text-foreground font-medium'
                          : 'text-muted-foreground/60 hover:text-foreground hover:bg-accent/50'
                      }`}
                      aria-pressed={active}
                      title={active ? `${opt.label} — click to reverse direction` : `Sort by ${opt.label.toLowerCase()}`}
                    >
                      {opt.label}
                      {active && <ArrowIcon className="w-3 h-3 -mr-0.5" />}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Full viewport width — cards fill their column instead of floating
          small inside it. Empty CMC columns are skipped entirely so the
          remaining ones share the freed space. Subtle dot grid background
          gives the area a playmat feel. */}
      <div
          ref={playmatRef}
          className="pl-2 sm:pl-4 pb-2 sm:pb-4 w-full max-w-full flex-1 min-h-0"
          style={{
            backgroundImage:
              'radial-gradient(circle, hsl(var(--muted-foreground) / 0.18) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
            backgroundPosition: '11px 11px',
          }}
        >
          {view === 'spells' ? (
            <div className="w-full min-w-0 pr-2 sm:pr-4">
              {/* CMC column headers — labels only, not clickable */}
              <div
                className="grid justify-start gap-2 pt-2 text-xs text-foreground/85"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                {activeCmcs.map(i => (
                  <div
                    key={i}
                    className="text-center font-semibold tabular-nums py-1"
                  >
                    {COLUMN_LABELS[i]} <span className="text-muted-foreground/80 font-normal">({buckets.countsByCmc[i]})</span>
                  </div>
                ))}
              </div>

              <CurveRow rowCards={sortedBuckets.creatures} activeCmcs={activeCmcs} gridTemplate={gridTemplate} onHover={handleHover} onSelect={setPreviewCard} dimNonRoles={highlightRoles && dimEnabled} activeRole={activeRole} activeCmcRange={activeCmcRange} activeRoleGroup={activeRoleGroup} removalNames={removalNames} showPrice={sortKey === 'price'} onCardAction={onCardAction} menuProps={menuProps} marginTopPercent={marginTopPercent} themeMembership={themeMembership} />
              <CurveRow rowCards={sortedBuckets.noncreatures} activeCmcs={activeCmcs} gridTemplate={gridTemplate} onHover={handleHover} onSelect={setPreviewCard} dimNonRoles={highlightRoles && dimEnabled} activeRole={activeRole} activeCmcRange={activeCmcRange} activeRoleGroup={activeRoleGroup} removalNames={removalNames} showPrice={sortKey === 'price'} onCardAction={onCardAction} menuProps={menuProps} marginTopPercent={marginTopPercent} themeMembership={themeMembership} />
            </div>
          ) : (
            <div className="w-full min-w-0 pr-2 sm:pr-4">
              <div
                className="grid justify-start gap-2 pt-2 text-xs text-foreground/85"
                style={{ gridTemplateColumns: landsGridTemplate }}
              >
                {landCategoryGroups.map(g => (
                  <div key={g.key} className="text-center font-semibold tabular-nums py-1">
                    {g.label} <span className="text-muted-foreground/80 font-normal">({g.cards.length})</span>
                  </div>
                ))}
              </div>
              <div
                className="grid justify-start gap-2 py-2 items-start"
                style={{ gridTemplateColumns: landsGridTemplate }}
              >
                {landCategoryGroups.map((g, col) => (
                  <CurveCell
                    key={g.key}
                    cards={g.cards}
                    cascadeIndex={col}
                    onHover={handleHover}
                    onSelect={setPreviewCard}
                    showPrice={sortKey === 'price'}
                    onCardAction={onCardAction}
                    menuProps={menuProps}
                    themeMembership={themeMembership}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

      {/* Floating hover preview — hidden on small viewports. Anchors right of
          the tile and flips left when there's no room. */}
      {hover && (() => {
        const PREVIEW_WIDTH = 256;
        const GAP = 12;
        const PAD = 8;
        const vw = window.innerWidth;
        const rightLeft = hover.anchor.right + GAP;
        const leftLeft = hover.anchor.left - GAP - PREVIEW_WIDTH;
        let left = rightLeft;
        if (rightLeft + PREVIEW_WIDTH + PAD > vw && leftLeft >= PAD) {
          left = leftLeft;
        } else if (rightLeft + PREVIEW_WIDTH + PAD > vw) {
          left = Math.max(PAD, vw - PREVIEW_WIDTH - PAD);
        }
        const top = Math.min(Math.max(8, hover.anchor.top + hover.anchor.height / 2 - 180), window.innerHeight - 400);
        return (
          <div
            className="fixed z-[100] pointer-events-none hidden lg:block"
            style={{ left, top }}
          >
            <img
              src={getCardImageUrl(hover.card, 'normal') ?? ''}
              alt={hover.card.name}
              className="w-64 rounded-lg shadow-2xl border border-border/50"
            />
          </div>
        );
      })()}

      <CardPreviewModal card={previewCard} onClose={() => setPreviewCard(null)} />
    </div>
  );
}

interface CurveRowProps {
  rowCards: ScryfallCard[][];
  activeCmcs: number[];
  gridTemplate: string;
  onHover: (card: ScryfallCard | null, e?: React.MouseEvent) => void;
  onSelect: (card: ScryfallCard) => void;
  dimNonRoles?: boolean;
  activeRole?: string | null;
  activeCmcRange?: [number, number] | null;
  activeRoleGroup?: string | null;
  removalNames?: Set<string>;
  showPrice?: boolean;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
  marginTopPercent?: number;
  themeMembership?: ThemeMembership | null;
}

function CurveRow({ rowCards, activeCmcs, gridTemplate, onHover, onSelect, dimNonRoles, activeRole, activeCmcRange, activeRoleGroup, removalNames, showPrice, onCardAction, menuProps, marginTopPercent, themeMembership }: CurveRowProps) {
  return (
    <div
      className="grid justify-start gap-2 py-2 items-end"
      style={{ gridTemplateColumns: gridTemplate }}
    >
      {activeCmcs.map((i, col) => (
        <CurveCell key={i} cards={rowCards[i]} cascadeIndex={col} onHover={onHover} onSelect={onSelect} dimNonRoles={dimNonRoles} activeRole={activeRole} activeCmcRange={activeCmcRange} activeRoleGroup={activeRoleGroup} removalNames={removalNames} showPrice={showPrice} onCardAction={onCardAction} menuProps={menuProps} marginTopPercent={marginTopPercent} themeMembership={themeMembership} />
      ))}
    </div>
  );
}

interface CurveCellProps {
  cards: ScryfallCard[];
  onHover: (card: ScryfallCard | null, e?: React.MouseEvent) => void;
  onSelect: (card: ScryfallCard) => void;
  dimNonRoles?: boolean;
  activeRole?: string | null;
  activeCmcRange?: [number, number] | null;
  activeRoleGroup?: string | null;
  removalNames?: Set<string>;
  cascadeIndex?: number;
  showPrice?: boolean;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
  marginTopPercent?: number;
  themeMembership?: ThemeMembership | null;
}

function CurveCell({ cards, onHover, onSelect, dimNonRoles, activeRole, activeCmcRange, activeRoleGroup, removalNames, cascadeIndex = 0, showPrice = false, onCardAction, menuProps, marginTopPercent, themeMembership }: CurveCellProps) {
  // FLIP-based reorder animation when sort changes. ~280ms feels right for
  // a card "settling" gesture — long enough to track, short enough not to
  // feel sluggish on a multi-column update.
  const [fanRef] = useAutoAnimate({ duration: 280, easing: 'ease-in-out' });

  if (cards.length === 0) {
    return <div className="w-full aspect-[5/7] min-h-[120px]" />;
  }
  // Arena-style fan, fully responsive. Cards fill the column width via
  // `w-full aspect-[5/7]`, and each non-first card sits via a negative
  // margin-top equal to 126% of the column width — leaving a ~10% top
  // sliver visible (half the previous 20%). Hovered cards do NOT lift in
  // the stack (the floating preview to the right is the hover signal).
  // Stable per-instance keys: counting occurrences of each name in this
  // cell. Because sortBy is a stable sort, two cards with the same name
  // keep their relative order across re-sorts, so the Nth occurrence of
  // "Forest" is always the same card instance — letting auto-animate
  // recognize reorders as reorders (not unmount + mount).
  const nameCounts = new Map<string, number>();
  return (
    <div
      ref={fanRef}
      className="relative flex flex-col w-full"
    >
      {cards.map((card, idx) => {
        const role = card.deckRole;
        const badgeClass = role ? (ROLE_BADGE[role] ?? '') : '';
        const badgeLabel = role ? (ROLE_LABEL[role] ?? '') : '';
        const BadgeIcon = role ? ROLE_ICON[role] : null;
        const themeIndices = themeMembership?.byCard.get(card.name.toLowerCase()) ?? [];
        const themeNames = themeMembership?.themes.map(t => t.name) ?? [];
        const imgUrl = getCardImageUrl(card, 'small') ?? '';
        const occurrence = nameCounts.get(card.name) ?? 0;
        nameCounts.set(card.name, occurrence + 1);
        const stableKey = `${card.name}#${occurrence}`;
        const hasRemovals = !!(removalNames && removalNames.size > 0);
        const flaggedForRemoval = hasRemovals && removalNames!.has(card.name);
        // When optimize mode is up, dim everything except the removal targets
        // so the spotlight reads at a glance.
        const dimForRemoval = hasRemovals && !flaggedForRemoval;
        // Tempo (curve) tab filter: a card matches when its CMC falls inside
        // the selected phase range AND its role fits the selected role group.
        // 'interaction' covers removal + boardwipe; 'other' means no known role.
        const cardCmc = Math.min(Math.floor(card.cmc ?? 0), 7);
        const cmcMatches = !activeCmcRange || (cardCmc >= activeCmcRange[0] && cardCmc <= activeCmcRange[1]);
        const groupMatches = !activeRoleGroup
          || (activeRoleGroup === 'ramp' && role === 'ramp')
          || (activeRoleGroup === 'interaction' && (role === 'removal' || role === 'boardwipe'))
          || (activeRoleGroup === 'cardDraw' && role === 'cardDraw')
          || (activeRoleGroup === 'other' && !role);
        const dimForCurve = dimNonRoles && (activeCmcRange != null || activeRoleGroup != null) && !(cmcMatches && groupMatches);
        const dimForRole = dimNonRoles && activeCmcRange == null && activeRoleGroup == null && (activeRole ? role !== activeRole : !role);
        return (
          <CurveCard
            key={stableKey}
            card={card}
            idx={idx}
            cascadeIndex={cascadeIndex}
            imgUrl={imgUrl}
            badgeClass={badgeClass}
            badgeLabel={badgeLabel}
            BadgeIcon={BadgeIcon}
            flaggedForRemoval={flaggedForRemoval}
            dimForRemoval={dimForRemoval}
            dimForRole={!!dimForRole}
            dimForCurve={!!dimForCurve}
            dimNonRoles={!!dimNonRoles}
            hasRemovals={hasRemovals}
            showPrice={!!showPrice}
            onSelect={onSelect}
            onHover={onHover}
            onCardAction={onCardAction}
            menuProps={menuProps}
            marginTopPercent={marginTopPercent}
            themeIndices={themeIndices}
            themeNames={themeNames}
          />
        );
      })}
    </div>
  );
}

interface CurveCardProps {
  card: ScryfallCard;
  idx: number;
  cascadeIndex: number;
  imgUrl: string;
  badgeClass: string;
  badgeLabel: string;
  BadgeIcon: typeof Sprout | null;
  flaggedForRemoval: boolean;
  dimForRemoval: boolean;
  dimForRole: boolean;
  dimForCurve: boolean;
  dimNonRoles: boolean;
  hasRemovals: boolean;
  showPrice: boolean;
  onSelect: (card: ScryfallCard) => void;
  onHover: (card: ScryfallCard | null, e?: React.MouseEvent) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
  marginTopPercent?: number;
  themeIndices: number[];
  themeNames: string[];
}

function CurveCard({
  card, idx, cascadeIndex, imgUrl, badgeClass, badgeLabel, BadgeIcon,
  flaggedForRemoval, dimForRemoval, dimForRole, dimForCurve, dimNonRoles,
  hasRemovals, showPrice, onSelect, onHover, onCardAction, menuProps,
  marginTopPercent, themeIndices, themeNames,
}: CurveCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const canMenu = !!(onCardAction && menuProps);
  return (
    <div className="relative w-full" style={{ marginTop: idx > 0 ? `${marginTopPercent ?? -120}%` : undefined, zIndex: idx }}>
      <button
        type="button"
        className={`relative w-full aspect-[5/7] text-left p-0 bg-transparent border-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background overflow-hidden rounded-[8px] transition-[filter] duration-300 animate-deal-in ${flaggedForRemoval ? 'ring-2 ring-rose-500 ring-offset-1 ring-offset-background scale-[1.02]' : ''} ${dimForRemoval ? 'saturate-0 opacity-50 hover:saturate-100 hover:opacity-100' : ''} ${!hasRemovals && (dimForRole || dimForCurve) ? 'saturate-0 hover:saturate-100' : ''}`}
        style={{ animationDelay: `${cascadeIndex * 70 + idx * 40}ms` }}
        onClick={() => onSelect(card)}
        onMouseEnter={(e) => onHover(card, e)}
        onMouseLeave={() => onHover(null)}
        onContextMenu={(e) => {
          if (!canMenu) return;
          e.preventDefault();
          setMenuOpen(true);
        }}
      >
        <img
          src={imgUrl}
          alt={card.name}
          className="absolute inset-0 w-full h-full rounded-[8px] shadow-md border border-border/40 object-cover"
          loading="lazy"
          draggable={false}
          title={`${card.name}${badgeLabel ? ` · ${badgeLabel}` : ''}`}
        />
        {showPrice && (() => {
          const raw = getCardPrice(card);
          const n = raw != null ? Number(raw) : NaN;
          if (!Number.isFinite(n)) return null;
          const label = n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(n < 10 ? 2 : 1)}`;
          return (
            <span className="absolute top-1 left-1 z-10 inline-flex items-center px-1 py-0.5 text-[8px] font-bold rounded shadow-sm bg-black/75 text-emerald-200 border border-emerald-500/40 tabular-nums">
              {label}
            </span>
          );
        })()}
        {badgeLabel ? (
          <span
            className={`absolute top-1 right-1 z-10 inline-flex items-center gap-0.5 px-0.5 py-px text-[7px] font-bold uppercase tracking-wider rounded shadow-sm ${
              (dimForRole || dimForCurve)
                ? 'bg-neutral-600/80 text-neutral-200 border border-neutral-400/50'
                : badgeClass
            }`}
          >
            {BadgeIcon && <BadgeIcon className="w-2 h-2" strokeWidth={2.5} />}
            {badgeLabel}
          </span>
        ) : dimNonRoles ? (
          <span className="absolute top-1 right-1 z-10 inline-flex items-center px-0.5 py-px text-[7px] font-bold uppercase tracking-wider rounded shadow-sm bg-neutral-600/80 text-neutral-200 border border-neutral-400/50">
            Other
          </span>
        ) : null}
        {themeIndices.length > 0 && (
          <span
            className="absolute left-1 z-10 flex items-center gap-0.5"
            style={{ top: showPrice ? '1.4rem' : '0.25rem' }}
          >
            {themeIndices.map(i => (
              <span
                key={i}
                title={themeNames[i] ?? ''}
                className={`inline-flex items-center justify-center w-3.5 h-3.5 text-[8px] font-bold rounded-full shadow-sm tabular-nums ${THEME_CHIP_CLASS[i] ?? THEME_CHIP_CLASS[0]}`}
              >
                {i + 1}
              </span>
            ))}
          </span>
        )}
      </button>
      {canMenu && (
        <span
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-0"
          onClick={(e) => e.stopPropagation()}
          aria-hidden
        >
          <CardContextMenu
            card={card}
            onAction={onCardAction!}
            hasRemove
            isMustInclude={menuProps!.mustIncludeNames.has(card.name)}
            isBanned={menuProps!.bannedNames.has(card.name)}
            userLists={menuProps!.userLists}
            forceOpen={menuOpen}
            onForceClose={() => setMenuOpen(false)}
          />
        </span>
      )}
    </div>
  );
}
