import { useState, useMemo, useCallback } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { useNavigate } from 'react-router-dom';
import { useCollection } from '@/hooks/useCollection';
import { ManaCost, CardTypeIcon } from '@/components/ui/mtg-icons';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { getCardByName } from '@/services/scryfall/client';
import {
  Search, Trash2, Minus, Plus, Download, AlertTriangle,
  Grid3X3, List, ChevronDown, RefreshCw, Loader2,
  ChevronLeft, ChevronRight, X,
} from 'lucide-react';
import type { CollectionCard } from '@/services/collection/db';
import type { ScryfallCard } from '@/types';

// --- Constants ---

const COLORS = [
  { code: 'W', label: 'White', bg: 'bg-amber-100 dark:bg-amber-900/50', text: 'text-amber-800 dark:text-amber-200' },
  { code: 'U', label: 'Blue', bg: 'bg-blue-100 dark:bg-blue-900/50', text: 'text-blue-800 dark:text-blue-200' },
  { code: 'B', label: 'Black', bg: 'bg-zinc-200 dark:bg-zinc-800', text: 'text-zinc-800 dark:text-zinc-200' },
  { code: 'R', label: 'Red', bg: 'bg-red-100 dark:bg-red-900/50', text: 'text-red-800 dark:text-red-200' },
  { code: 'G', label: 'Green', bg: 'bg-green-100 dark:bg-green-900/50', text: 'text-green-800 dark:text-green-200' },
  { code: 'C', label: 'Colorless', bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-800 dark:text-slate-200' },
];

const TYPES = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle'];

const RARITIES = [
  { code: 'common', label: 'Common', color: 'text-zinc-500' },
  { code: 'uncommon', label: 'Uncommon', color: 'text-slate-400' },
  { code: 'rare', label: 'Rare', color: 'text-amber-500' },
  { code: 'mythic', label: 'Mythic', color: 'text-orange-500' },
];

type SortKey = 'name' | 'quantity' | 'cmc' | 'type' | 'rarity' | 'added';
type ViewMode = 'grid' | 'list';
type ColorFilterMode = 'at-least' | 'exact' | 'exclude';

const ITEMS_PER_PAGE_GRID = 60;
const ITEMS_PER_PAGE_LIST = 50;

const RARITY_ORDER: Record<string, number> = { common: 0, uncommon: 1, rare: 2, mythic: 3 };

// --- Helpers ---

function matchesType(card: CollectionCard, type: string): boolean {
  if (!card.typeLine) return false;
  return card.typeLine.toLowerCase().includes(type.toLowerCase());
}

function matchesColor(card: CollectionCard, selectedColors: Set<string>, mode: ColorFilterMode): boolean {
  if (selectedColors.size === 0) return true;

  const cardColors = card.colorIdentity ?? [];
  const isColorless = cardColors.length === 0;
  const wantsColorless = selectedColors.has('C');
  const selectedWubrg = new Set([...selectedColors].filter(c => c !== 'C'));

  switch (mode) {
    case 'exact': {
      if (wantsColorless && selectedWubrg.size === 0) return isColorless;
      if (isColorless) return false;
      if (cardColors.length !== selectedWubrg.size) return false;
      return cardColors.every(c => selectedWubrg.has(c));
    }
    case 'exclude': {
      if (wantsColorless && isColorless) return false;
      return !cardColors.some(c => selectedColors.has(c));
    }
    case 'at-least':
    default: {
      if (wantsColorless && isColorless) return true;
      return [...selectedWubrg].every(c => cardColors.includes(c));
    }
  }
}

function sortCards(cards: CollectionCard[], sortKey: SortKey, sortDir: 'asc' | 'desc'): CollectionCard[] {
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...cards].sort((a, b) => {
    switch (sortKey) {
      case 'name':
        return dir * a.name.localeCompare(b.name);
      case 'quantity':
        return dir * (a.quantity - b.quantity);
      case 'cmc':
        return dir * ((a.cmc ?? 99) - (b.cmc ?? 99));
      case 'type':
        return dir * (a.typeLine ?? '').localeCompare(b.typeLine ?? '');
      case 'rarity':
        return dir * ((RARITY_ORDER[a.rarity ?? ''] ?? 5) - (RARITY_ORDER[b.rarity ?? ''] ?? 5));
      case 'added':
        return dir * (a.addedAt - b.addedAt);
      default:
        return 0;
    }
  });
}

// --- Component ---

export function CollectionManager() {
  const navigate = useNavigate();
  const {
    cards, count, removeCard, updateQuantity, clearCollection,
    needsEnrichment, isEnriching, enrichProgress, enrichCollection,
  } = useCollection();

  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedColors, setSelectedColors] = useState<Set<string>>(new Set());
  const [colorFilterMode, setColorFilterMode] = useState<ColorFilterMode>('at-least');
  const [selectedType, setSelectedType] = useState<string>('');
  const [selectedRarity, setSelectedRarity] = useState<string>('');
  const [commandersOnly, setCommandersOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  // Filter & sort
  const filteredCards = useMemo(() => {
    let result = cards;

    // Text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.typeLine && c.typeLine.toLowerCase().includes(q))
      );
    }

    // Color filter
    if (selectedColors.size > 0) {
      result = result.filter(c => matchesColor(c, selectedColors, colorFilterMode));
    }

    // Type filter
    if (selectedType) {
      result = result.filter(c => matchesType(c, selectedType));
    }

    // Rarity filter
    if (selectedRarity) {
      result = result.filter(c => c.rarity === selectedRarity);
    }

    // Commanders only
    if (commandersOnly) {
      result = result.filter(c => {
        const t = c.typeLine?.toLowerCase() ?? '';
        return t.includes('legendary') && t.includes('creature');
      });
    }

    return sortCards(result, sortKey, sortDir);
  }, [cards, searchQuery, selectedColors, colorFilterMode, selectedType, selectedRarity, commandersOnly, sortKey, sortDir]);

  // Pagination
  const itemsPerPage = viewMode === 'grid' ? ITEMS_PER_PAGE_GRID : ITEMS_PER_PAGE_LIST;
  const totalPages = Math.max(1, Math.ceil(filteredCards.length / itemsPerPage));
  const currentPage = Math.min(page, totalPages);
  const paginatedCards = filteredCards.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Stats
  const stats = useMemo(() => {
    const totalQuantity = cards.reduce((sum, c) => sum + c.quantity, 0);
    const typeBreakdown: Record<string, number> = {};
    for (const card of cards) {
      const mainType = TYPES.find(t => matchesType(card, t)) ?? 'Other';
      typeBreakdown[mainType] = (typeBreakdown[mainType] ?? 0) + 1;
    }
    return { totalQuantity, typeBreakdown };
  }, [cards]);

  const activeFilters = (selectedColors.size > 0 ? 1 : 0) + (selectedType ? 1 : 0) + (selectedRarity ? 1 : 0) + (commandersOnly ? 1 : 0);

  const toggleColor = (code: string) => {
    setSelectedColors(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
    setPage(1);
  };

  const clearFilters = () => {
    setSelectedColors(new Set());
    setSelectedType('');
    setSelectedRarity('');
    setCommandersOnly(false);
    setSearchQuery('');
    setPage(1);
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const handleExport = () => {
    const text = cards.map(c => `${c.quantity} ${c.name}`).join('\n');
    navigator.clipboard.writeText(text);
  };

  const handlePreview = useCallback(async (name: string) => {
    try {
      const card = await getCardByName(name);
      if (card) setPreviewCard(card);
    } catch {
      // silently fail
    }
  }, []);

  const handleBuildDeck = useCallback((cardName: string) => {
    navigate(`/build/${encodeURIComponent(cardName)}`);
  }, [navigate]);

  if (count === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p className="text-sm">Your collection is empty.</p>
        <p className="text-xs mt-1">Use the importer above to add cards.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header: Stats + Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-sm font-semibold">
            {count.toLocaleString()} unique cards
          </span>
          <span className="text-xs text-muted-foreground ml-2">
            ({stats.totalQuantity.toLocaleString()} total)
          </span>
        </div>
        <div className="flex items-center gap-1">
          {needsEnrichment > 0 && (
            <button
              onClick={enrichCollection}
              disabled={isEnriching}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
              title={`${needsEnrichment} cards missing metadata — click to fetch from Scryfall`}
            >
              {isEnriching ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              {isEnriching ? 'Enriching...' : `Enrich ${needsEnrichment} cards`}
            </button>
          )}
          <button
            onClick={handleExport}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Copy collection to clipboard"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowClearConfirm(true)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Clear collection"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Enrichment progress */}
      {enrichProgress && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {enrichProgress}
        </div>
      )}

      {/* Clear confirmation */}
      {showClearConfirm && (
        <div className="p-3 rounded-lg border border-destructive/50 bg-destructive/10 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertTriangle className="w-4 h-4" />
            Clear entire collection?
          </div>
          <p className="text-xs text-muted-foreground">
            This will remove all {count.toLocaleString()} cards. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowClearConfirm(false)}
              className="px-3 py-1.5 text-xs rounded-md hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => { clearCollection(); setShowClearConfirm(false); }}
              className="px-3 py-1.5 text-xs bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors"
            >
              Clear All
            </button>
          </div>
        </div>
      )}

      {/* Type breakdown chips */}
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(stats.typeBreakdown)
          .sort((a, b) => b[1] - a[1])
          .map(([type, num]) => (
            <button
              key={type}
              onClick={() => { setSelectedType(prev => prev === type ? '' : type); setPage(1); }}
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full transition-colors cursor-pointer ${
                selectedType === type
                  ? 'bg-primary/20 text-primary ring-1 ring-primary/40'
                  : 'bg-accent/60 text-muted-foreground hover:bg-accent'
              }`}
            >
              <CardTypeIcon type={type} size="sm" className="opacity-70" />
              {type} {num}
            </button>
          ))}
      </div>

      {/* Search + View Toggle */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name or type..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-8 h-9 text-sm rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setPage(1); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => { setViewMode('grid'); setPage(1); }}
            className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent text-muted-foreground'}`}
            title="Grid view"
          >
            <Grid3X3 className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setViewMode('list'); setPage(1); }}
            className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent text-muted-foreground'}`}
            title="List view"
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Color filter chips */}
        <div className="flex items-center gap-1">
          {COLORS.map(({ code }) => (
            <button
              key={code}
              onClick={() => toggleColor(code)}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                selectedColors.has(code)
                  ? 'ring-2 ring-primary ring-offset-1 ring-offset-background scale-110'
                  : 'opacity-50 hover:opacity-80'
              }`}
              title={COLORS.find(c => c.code === code)?.label}
            >
              <i className={`ms ms-${code.toLowerCase()} ms-cost text-sm`} />
            </button>
          ))}
        </div>

        {/* Color filter mode */}
        {selectedColors.size > 0 && (
          <div className="flex rounded-md border border-border overflow-hidden text-[11px]">
            {([
              { mode: 'at-least' as const, label: 'Includes' },
              { mode: 'exact' as const, label: 'Exact' },
              { mode: 'exclude' as const, label: 'Exclude' },
            ]).map(({ mode, label }) => (
              <button
                key={mode}
                onClick={() => { setColorFilterMode(mode); setPage(1); }}
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

        <span className="text-border">|</span>

        {/* Type filter */}
        <div className="relative">
          <select
            value={selectedType}
            onChange={(e) => { setSelectedType(e.target.value); setPage(1); }}
            className="appearance-none pl-2.5 pr-7 py-1 text-xs rounded-md bg-background border border-border cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All Types</option>
            {TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
        </div>

        {/* Rarity filter */}
        <div className="relative">
          <select
            value={selectedRarity}
            onChange={(e) => { setSelectedRarity(e.target.value); setPage(1); }}
            className="appearance-none pl-2.5 pr-7 py-1 text-xs rounded-md bg-background border border-border cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All Rarities</option>
            {RARITIES.map(r => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
        </div>

        {/* Commanders only */}
        <button
          onClick={() => { setCommandersOnly(v => !v); setPage(1); }}
          className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
            commandersOnly
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:border-primary/50'
          }`}
        >
          Commanders
        </button>

        {/* Sort */}
        <div className="relative ml-auto">
          <select
            value={`${sortKey}-${sortDir}`}
            onChange={(e) => {
              const [key, dir] = e.target.value.split('-') as [SortKey, 'asc' | 'desc'];
              setSortKey(key);
              setSortDir(dir);
              setPage(1);
            }}
            className="appearance-none pl-2.5 pr-7 py-1 text-xs rounded-md bg-background border border-border cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="name-asc">Name A→Z</option>
            <option value="name-desc">Name Z→A</option>
            <option value="cmc-asc">CMC Low→High</option>
            <option value="cmc-desc">CMC High→Low</option>
            <option value="quantity-desc">Qty High→Low</option>
            <option value="quantity-asc">Qty Low→High</option>
            <option value="rarity-desc">Rarity High→Low</option>
            <option value="rarity-asc">Rarity Low→High</option>
            <option value="added-desc">Newest First</option>
            <option value="added-asc">Oldest First</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
        </div>

        {/* Clear filters */}
        {activeFilters > 0 && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 px-2 py-1 text-xs text-primary hover:text-primary/80 transition-colors"
          >
            <X className="w-3 h-3" />
            Clear filters
          </button>
        )}
      </div>

      {/* Result count */}
      {(searchQuery || activeFilters > 0) && (
        <p className="text-xs text-muted-foreground px-1">
          {filteredCards.length} card{filteredCards.length !== 1 ? 's' : ''} found
        </p>
      )}

      {/* Card Display */}
      {viewMode === 'grid' ? (
        <GridView
          cards={paginatedCards}
          onUpdateQuantity={updateQuantity}
          onRemove={removeCard}
          onPreview={handlePreview}
        />
      ) : (
        <ListView
          cards={paginatedCards}
          onUpdateQuantity={updateQuantity}
          onRemove={removeCard}
          onPreview={handlePreview}
          sortKey={sortKey}
          sortDir={sortDir}
          onToggleSort={toggleSort}
        />
      )}

      {/* Empty state */}
      {filteredCards.length === 0 && (searchQuery || activeFilters > 0) && (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">No cards match your filters</p>
          <button
            onClick={clearFilters}
            className="text-xs text-primary hover:underline mt-1"
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="p-1.5 rounded-md hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {/* Page number buttons */}
            {getPageNumbers(currentPage, totalPages).map((p, i) =>
              p === null ? (
                <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted-foreground">...</span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-7 h-7 rounded-md text-xs transition-colors ${
                    p === currentPage
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-accent text-muted-foreground'
                  }`}
                >
                  {p}
                </button>
              )
            )}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="p-1.5 rounded-md hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <CardPreviewModal card={previewCard} onClose={() => setPreviewCard(null)} onBuildDeck={handleBuildDeck} />
    </div>
  );
}

// --- Grid View ---

function GridView({
  cards,
  onUpdateQuantity,
  onRemove,
  onPreview,
}: {
  cards: CollectionCard[];
  onUpdateQuantity: (name: string, qty: number) => void;
  onRemove: (name: string) => void;
  onPreview: (name: string) => void;
}) {
  const [parent] = useAutoAnimate({ duration: 250 });

  return (
    <div ref={parent} className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
      {cards.map(card => (
        <GridCard
          key={card.name}
          card={card}
          onUpdateQuantity={onUpdateQuantity}
          onRemove={onRemove}
          onPreview={onPreview}
        />
      ))}
    </div>
  );
}

function GridCard({
  card,
  onUpdateQuantity,
  onRemove,
  onPreview,
}: {
  card: CollectionCard;
  onUpdateQuantity: (name: string, qty: number) => void;
  onRemove: (name: string) => void;
  onPreview: (name: string) => void;
}) {
  const [showControls, setShowControls] = useState(false);

  return (
    <div
      className="relative group rounded-lg overflow-hidden bg-accent/20 border border-border/30 hover:border-primary/40 transition-all"
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
    >
      {/* Card image */}
      {card.imageUrl ? (
        <img
          src={card.imageUrl}
          alt={card.name}
          className="w-full aspect-[5/7] object-cover cursor-pointer"
          loading="lazy"
          onClick={() => onPreview(card.name)}
        />
      ) : (
        <div
          className="w-full aspect-[5/7] bg-accent/50 flex items-center justify-center p-2 cursor-pointer"
          onClick={() => onPreview(card.name)}
        >
          <span className="text-[10px] text-muted-foreground text-center leading-tight">{card.name}</span>
        </div>
      )}

      {/* Quantity badge */}
      {card.quantity > 1 && (
        <div className="absolute top-1 right-1 bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow min-w-[20px] text-center">
          x{card.quantity}
        </div>
      )}

      {/* Hover controls overlay */}
      {showControls && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent p-2 pt-6">
          <p className="text-[10px] text-white font-medium truncate mb-1.5">{card.name}</p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => onUpdateQuantity(card.name, card.quantity - 1)}
                className="p-0.5 rounded bg-white/20 text-white hover:bg-white/30 transition-colors"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="text-[10px] font-mono text-white w-5 text-center">{card.quantity}</span>
              <button
                onClick={() => onUpdateQuantity(card.name, card.quantity + 1)}
                className="p-0.5 rounded bg-white/20 text-white hover:bg-white/30 transition-colors"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
            <button
              onClick={() => onRemove(card.name)}
              className="p-0.5 rounded bg-white/20 text-red-300 hover:bg-red-500/50 hover:text-white transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- List View ---

function ListView({
  cards,
  onUpdateQuantity,
  onRemove,
  onPreview,
  sortKey,
  sortDir,
  onToggleSort,
}: {
  cards: CollectionCard[];
  onUpdateQuantity: (name: string, qty: number) => void;
  onRemove: (name: string) => void;
  onPreview: (name: string) => void;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onToggleSort: (key: SortKey) => void;
}) {
  const SortHeader = ({ label, field, className = '' }: { label: string; field: SortKey; className?: string }) => (
    <button
      onClick={() => onToggleSort(field)}
      className={`text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5 ${className}`}
    >
      {label}
      {sortKey === field && (
        <span className="text-primary">{sortDir === 'asc' ? '↑' : '↓'}</span>
      )}
    </button>
  );

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      {/* Table header */}
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-3 py-2 bg-accent/30 border-b border-border/50 items-center">
        <SortHeader label="Card" field="name" />
        <SortHeader label="Type" field="type" className="w-24 hidden sm:flex" />
        <SortHeader label="CMC" field="cmc" className="w-10 justify-center" />
        <SortHeader label="Qty" field="quantity" className="w-12 justify-center" />
        <span className="w-16" />
      </div>

      {/* Card rows */}
      <div className="divide-y divide-border/30">
        {cards.map(card => (
          <div
            key={card.name}
            className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-3 py-1.5 items-center hover:bg-accent/30 group transition-colors"
          >
            {/* Name + color + mana cost */}
            <div
              className="flex items-center gap-2 min-w-0 cursor-pointer"
              onClick={() => onPreview(card.name)}
            >
              {card.imageUrl && (
                <img
                  src={card.imageUrl}
                  alt=""
                  className="w-7 h-auto rounded shadow shrink-0"
                  loading="lazy"
                />
              )}
              <span className="text-sm truncate min-w-0 hover:text-primary transition-colors">{card.name}</span>
              {card.manaCost && <ManaCost cost={card.manaCost} className="text-xs shrink-0" />}
            </div>

            {/* Type */}
            <span className="text-[11px] text-muted-foreground truncate w-24 hidden sm:block">
              {card.typeLine?.split('—')[0]?.trim() ?? '—'}
            </span>

            {/* CMC */}
            <span className="text-xs text-muted-foreground w-10 text-center font-mono tabular-nums">
              {card.cmc != null ? card.cmc : '—'}
            </span>

            {/* Quantity controls */}
            <div className="flex items-center gap-0.5 w-12 justify-center">
              <button
                onClick={() => onUpdateQuantity(card.name, card.quantity - 1)}
                className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="text-xs font-mono w-5 text-center tabular-nums">{card.quantity}</span>
              <button
                onClick={() => onUpdateQuantity(card.name, card.quantity + 1)}
                className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>

            {/* Remove */}
            <div className="w-16 flex justify-end">
              <button
                onClick={() => onRemove(card.name)}
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Pagination helper ---

function getPageNumbers(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | null)[] = [1];

  if (current > 3) pages.push(null);

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) pages.push(i);

  if (current < total - 2) pages.push(null);
  if (pages[pages.length - 1] !== total) pages.push(total);

  return pages;
}
