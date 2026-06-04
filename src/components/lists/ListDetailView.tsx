import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { useNavigate } from 'react-router-dom';
import type { UserCardList, ScryfallCard } from '@/types';
import { getCardsByNames, getCardImageUrl, getCardByName, searchCards } from '@/services/scryfall/client';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { ManaCost, CardTypeIcon, CommanderIcon } from '@/components/ui/mtg-icons';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import {
  ArrowLeft, Search, X, Grid3X3, List, Copy, CopyPlus, Pencil, Trash2,
  ChevronDown, ChevronLeft, ChevronRight, Loader2, LayoutGrid, Plus, MoreHorizontal,
} from 'lucide-react';

// --- Constants (mirroring CollectionManager) ---

const COLORS = [
  { code: 'W', label: 'White' },
  { code: 'U', label: 'Blue' },
  { code: 'B', label: 'Black' },
  { code: 'R', label: 'Red' },
  { code: 'G', label: 'Green' },
  { code: 'C', label: 'Colorless' },
];

const TYPES = ['Battle', 'Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land'];

const RARITIES = [
  { code: 'common', label: 'Common' },
  { code: 'uncommon', label: 'Uncommon' },
  { code: 'rare', label: 'Rare' },
  { code: 'mythic', label: 'Mythic' },
];

type SortKey = 'name' | 'cmc' | 'type' | 'rarity';
type ViewMode = 'grid' | 'list';
type ColorFilterMode = 'at-least' | 'exact' | 'exclude';

const ITEMS_PER_PAGE_GRID = 60;
const ITEMS_PER_PAGE_LIST = 50;

const RARITY_ORDER: Record<string, number> = { common: 0, uncommon: 1, rare: 2, mythic: 3 };

// Enriched card data (like CollectionCard but for list items)
interface ListCardData {
  name: string;
  typeLine?: string;
  colorIdentity?: string[];
  cmc?: number;
  manaCost?: string;
  rarity?: string;
  imageUrl?: string;
}

// --- Helpers (same as CollectionManager) ---

function matchesType(card: ListCardData, type: string): boolean {
  if (!card.typeLine) return false;
  return card.typeLine.toLowerCase().includes(type.toLowerCase());
}

function matchesColor(card: ListCardData, selectedColors: Set<string>, mode: ColorFilterMode): boolean {
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

function sortCards(cards: ListCardData[], sortKey: SortKey, sortDir: 'asc' | 'desc'): ListCardData[] {
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...cards].sort((a, b) => {
    switch (sortKey) {
      case 'name':
        return dir * a.name.localeCompare(b.name);
      case 'cmc':
        return dir * ((a.cmc ?? 99) - (b.cmc ?? 99));
      case 'type':
        return dir * (a.typeLine ?? '').localeCompare(b.typeLine ?? '');
      case 'rarity':
        return dir * ((RARITY_ORDER[a.rarity ?? ''] ?? 5) - (RARITY_ORDER[b.rarity ?? ''] ?? 5));
      default:
        return 0;
    }
  });
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

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

// --- Props ---

interface ListDetailViewProps {
  list: UserCardList;
  onBack: () => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onExport?: () => void;
  onDelete?: () => void;
  onRemoveCard?: (cardName: string) => void;
  onSwapCard?: (oldCardName: string, newCardName: string) => void;
  onAddCard?: (cardName: string) => void;
  readOnly?: boolean;
  onViewAsDeck?: () => void;
  onConvertToDeck?: () => void;
  onConvertToList?: () => void;
  /** Debug hook — fires whenever the in-list color filter selection changes,
   *  letting a parent (e.g. ListsPage) drive the aurora background from it. */
  onColorFilterChange?: (colors: string[]) => void;
  /** Fires whenever the derived color identity of the list changes (i.e. after
   *  card data loads). Lets a parent theme the aurora for commander-less lists
   *  whose cachedColorIdentity is never populated by useUserLists. */
  onDerivedColorIdentityChange?: (colors: string[]) => void;
}

// --- Component ---

export function ListDetailView({ list, onBack, onEdit, onDuplicate, onExport, onDelete, onRemoveCard, onSwapCard, onAddCard, readOnly, onViewAsDeck, onConvertToDeck, onConvertToList, onColorFilterChange, onDerivedColorIdentityChange }: ListDetailViewProps) {
  const navigate = useNavigate();

  // Card data enrichment
  const [cardDataMap, setCardDataMap] = useState<Map<string, ListCardData>>(new Map());
  const [loading, setLoading] = useState(false);
  const [scryfallMap, setScryfallMap] = useState<Map<string, ScryfallCard>>(new Map());

  // Preview
  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);

  // Delete confirmation
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleDeleteClick = () => {
    if (confirmingDelete) {
      onDelete?.();
    } else {
      setConfirmingDelete(true);
      setTimeout(() => setConfirmingDelete(false), 3000);
    }
  };

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedColors, setSelectedColors] = useState<Set<string>>(new Set());
  // Bubble the color-filter selection up so a parent can drive the aurora.
  useEffect(() => {
    onColorFilterChange?.([...selectedColors]);
  }, [selectedColors, onColorFilterChange]);
  const [colorFilterMode, setColorFilterMode] = useState<ColorFilterMode>('at-least');
  const [selectedType, setSelectedType] = useState('');
  const [selectedRarity, setSelectedRarity] = useState('');
  const [commandersOnly, setCommandersOnly] = useState(false);

  // Sort & View
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [page, setPage] = useState(1);

  // Fetch card data from Scryfall
  useEffect(() => {
    const missing = list.cards.filter(name => !cardDataMap.has(name));
    if (missing.length === 0) return;

    setLoading(true);
    getCardsByNames(missing).then(fetchedMap => {
      const newCards = new Map(cardDataMap);
      const newScryfall = new Map(scryfallMap);

      for (const name of missing) {
        const card = fetchedMap.get(name);
        if (card) {
          newCards.set(name, {
            name,
            typeLine: card.type_line,
            colorIdentity: card.color_identity,
            cmc: card.cmc,
            manaCost: card.mana_cost ?? card.card_faces?.[0]?.mana_cost,
            rarity: card.rarity,
            imageUrl: getCardImageUrl(card, 'small'),
          });
          newScryfall.set(name, card);
        } else {
          newCards.set(name, { name });
        }
      }

      setCardDataMap(newCards);
      setScryfallMap(newScryfall);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [list.cards]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build enriched cards array
  const enrichedCards = useMemo(() => {
    return list.cards.map(name => cardDataMap.get(name) ?? { name });
  }, [list.cards, cardDataMap]);

  // Bubble the derived color identity up so a parent can theme on it.
  // Uses WUBRG order; only includes colors actually present in any card.
  const WUBRG_AURORA = ['W', 'U', 'B', 'R', 'G'];
  useEffect(() => {
    if (!onDerivedColorIdentityChange) return;
    const present = new Set<string>();
    for (const c of enrichedCards) {
      for (const letter of c.colorIdentity ?? []) present.add(letter);
    }
    onDerivedColorIdentityChange(WUBRG_AURORA.filter(l => present.has(l)));
  }, [enrichedCards, onDerivedColorIdentityChange]);

  // Filter & sort
  const filteredCards = useMemo(() => {
    let result = enrichedCards;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.typeLine && c.typeLine.toLowerCase().includes(q))
      );
    }

    if (selectedColors.size > 0) {
      result = result.filter(c => matchesColor(c, selectedColors, colorFilterMode));
    }

    if (selectedType) {
      result = result.filter(c => matchesType(c, selectedType));
    }

    if (selectedRarity) {
      result = result.filter(c => c.rarity === selectedRarity);
    }

    if (commandersOnly) {
      result = result.filter(c => {
        const t = (c.typeLine?.split(' // ')[0] ?? '').toLowerCase();
        return t.includes('legendary') && t.includes('creature');
      });
    }

    return sortCards(result, sortKey, sortDir);
  }, [enrichedCards, searchQuery, selectedColors, colorFilterMode, selectedType, selectedRarity, commandersOnly, sortKey, sortDir]);

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
    const typeBreakdown: Record<string, number> = {};
    for (const card of enrichedCards) {
      const mainType = TYPES.find(t => matchesType(card, t)) ?? 'Other';
      typeBreakdown[mainType] = (typeBreakdown[mainType] ?? 0) + 1;
    }
    return { typeBreakdown };
  }, [enrichedCards]);

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

  const handlePreview = useCallback(async (name: string) => {
    // Use cached scryfall card if available
    const cached = scryfallMap.get(name);
    if (cached) {
      setPreviewCard(cached);
      return;
    }
    try {
      const card = await getCardByName(name);
      if (card) setPreviewCard(card);
    } catch {
      // silently fail
    }
  }, [scryfallMap]);

  const handleBuildDeck = useCallback((cardName: string) => {
    navigate(`/build/${encodeURIComponent(cardName)}`);
  }, [navigate]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to lists
        </button>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-xl font-bold">{list.name}</h2>
            {list.commanderName && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
                <CommanderIcon size={14} className="shrink-0" />
                <span>{list.commanderName}{list.partnerCommanderName ? ` & ${list.partnerCommanderName}` : ''}</span>
              </div>
            )}
            {list.description && (
              <p className="text-sm text-muted-foreground mt-1">{list.description}</p>
            )}
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span>{list.cards.length} cards</span>
              <span className="text-border">·</span>
              <span>Created {formatDate(list.createdAt)}</span>
              <span className="text-border">·</span>
              <span>Updated {formatDate(list.updatedAt)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {list.type === 'deck' && onViewAsDeck && list.cards.length > 0 && (
              <button
                onClick={onViewAsDeck}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                View as Deck
              </button>
            )}
            {onAddCard && !readOnly && (
              <AddCardPopover
                existingCards={list.cards}
                onAddCard={onAddCard}
              />
            )}
            {!readOnly && onEdit && (
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border bg-card/40 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </button>
            )}
            {!readOnly && onDuplicate && (
              <button
                onClick={onDuplicate}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border bg-card/40 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <CopyPlus className="w-3.5 h-3.5" />
                Duplicate
              </button>
            )}
            {onExport && (
              <button
                onClick={onExport}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border bg-card/40 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                Export
              </button>
            )}
            {((!readOnly && (onConvertToDeck || onConvertToList || onDelete))) && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className="ml-auto flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-card/40 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    title="More actions"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-48 p-1">
                  {list.type !== 'deck' && onConvertToDeck && list.cards.length > 0 && (
                    <button
                      onClick={onConvertToDeck}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent rounded transition-colors text-left"
                    >
                      <CommanderIcon size={14} />
                      Convert to Deck
                    </button>
                  )}
                  {list.type === 'deck' && onConvertToList && (
                    <button
                      onClick={onConvertToList}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent rounded transition-colors text-left"
                    >
                      <X className="w-3.5 h-3.5" />
                      Remove Commander
                    </button>
                  )}
                  {onDelete && (
                    <>
                      <div className="border-t border-border/50 my-1" />
                      <button
                        onClick={handleDeleteClick}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs rounded transition-colors text-left ${
                          confirmingDelete
                            ? 'bg-destructive/20 text-destructive font-medium'
                            : 'hover:bg-destructive/10 text-destructive'
                        }`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {confirmingDelete ? 'Confirm Delete?' : 'Delete'}
                      </button>
                    </>
                  )}
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      </div>

      {/* Loading indicator */}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading card data...
        </div>
      )}

      {/* Type breakdown chips */}
      {Object.keys(stats.typeBreakdown).length > 0 && (
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
      )}

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
          {COLORS.map(({ code, label }) => (
            <button
              key={code}
              onClick={() => toggleColor(code)}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                selectedColors.has(code)
                  ? 'ring-2 ring-primary ring-offset-1 ring-offset-background scale-110'
                  : 'opacity-50 hover:opacity-80'
              }`}
              title={label}
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
              ? 'border-primary bg-primary/10 text-violet-200'
              : 'border-border bg-card/40 text-muted-foreground hover:border-primary/50'
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
            <option value="rarity-desc">Rarity High→Low</option>
            <option value="rarity-asc">Rarity Low→High</option>
            <option value="type-asc">Type A→Z</option>
            <option value="type-desc">Type Z→A</option>
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
          onRemove={onRemoveCard}
          onPreview={handlePreview}
          readOnly={readOnly}
        />
      ) : (
        <ListViewTable
          cards={paginatedCards}
          onRemove={onRemoveCard}
          onPreview={handlePreview}
          sortKey={sortKey}
          sortDir={sortDir}
          onToggleSort={toggleSort}
          readOnly={readOnly}
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

      {list.cards.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="text-sm text-muted-foreground text-center">
            {readOnly ? 'This list is empty.' : 'This list is empty. Click Edit or Add cards to get started.'}
          </p>
          {!readOnly && onEdit && (
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-primary text-primary hover:bg-primary/10 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add cards
            </button>
          )}
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

      <CardPreviewModal
        card={previewCard}
        onClose={() => setPreviewCard(null)}
        onBuildDeck={handleBuildDeck}
        hideMustInclude
        inDeckNames={list.cards}
        commanderColorIdentity={
          list.commanderName
            ? scryfallMap.get(list.commanderName)?.color_identity ?? undefined
            : undefined
        }
        onSwapCard={onSwapCard && previewCard ? (oldCard, newCard) => {
          onSwapCard(oldCard.name, newCard.name);
          setPreviewCard(null);
        } : undefined}
      />
    </div>
  );
}

// --- Grid View ---

function GridView({
  cards,
  onRemove,
  onPreview,
  readOnly,
}: {
  cards: ListCardData[];
  onRemove?: (name: string) => void;
  onPreview: (name: string) => void;
  readOnly?: boolean;
}) {
  const [parent] = useAutoAnimate({ duration: 250 });

  return (
    <div ref={parent} className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
      {cards.map((card, i) => (
        <GridCard key={`${card.name}-${i}`} card={card} onRemove={onRemove} onPreview={onPreview} readOnly={readOnly} />
      ))}
    </div>
  );
}

function GridCard({
  card,
  onRemove,
  onPreview,
  readOnly,
}: {
  card: ListCardData;
  onRemove?: (name: string) => void;
  onPreview: (name: string) => void;
  readOnly?: boolean;
}) {
  const [showControls, setShowControls] = useState(false);

  return (
    <div
      className="relative group rounded-lg overflow-hidden bg-accent/20 border border-border/30 hover:border-primary/40 transition-all"
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
    >
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

      {/* Hover controls overlay */}
      {showControls && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent p-2 pt-6">
          <p className="text-[10px] text-white font-medium truncate mb-1.5">{card.name}</p>
          {!readOnly && onRemove && (
            <div className="flex items-center justify-end">
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(card.name); }}
                className="p-0.5 rounded bg-white/20 text-red-300 hover:bg-red-500/50 hover:text-white transition-colors"
                title="Remove from list"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- List View ---

function ListViewTable({
  cards,
  onRemove,
  onPreview,
  sortKey,
  sortDir,
  onToggleSort,
  readOnly,
}: {
  cards: ListCardData[];
  onRemove?: (name: string) => void;
  onPreview: (name: string) => void;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onToggleSort: (key: SortKey) => void;
  readOnly?: boolean;
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
      <div className={`grid ${readOnly ? 'grid-cols-[1fr_auto_auto]' : 'grid-cols-[1fr_auto_auto_auto]'} gap-2 px-3 py-2 bg-accent/30 border-b border-border/50 items-center`}>
        <SortHeader label="Card" field="name" />
        <SortHeader label="Type" field="type" className="w-24 hidden sm:flex" />
        <SortHeader label="CMC" field="cmc" className="w-10 justify-center" />
        {!readOnly && <span className="w-8" />}
      </div>

      {/* Card rows */}
      <div className="divide-y divide-border/30 bg-card/40">
        {cards.map((card, i) => (
          <div
            key={`${card.name}-${i}`}
            className={`grid ${readOnly ? 'grid-cols-[1fr_auto_auto]' : 'grid-cols-[1fr_auto_auto_auto]'} gap-2 px-3 py-1.5 items-center hover:bg-accent/30 group transition-colors`}
          >
            {/* Name + mana cost */}
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

            {/* Remove */}
            {!readOnly && onRemove && (
              <div className="w-8 flex justify-end">
                <button
                  onClick={() => onRemove(card.name)}
                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                  title="Remove from list"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Inline card-add popover ────────────────────────────────────────────

// Parse "1 Sol Ring", "1x Sol Ring", "Sol Ring", "  // sideboard markers ", etc.
// Returns deduped card names (preserving first-seen order) skipping board headers
// and empty lines. Quantity is collapsed to a single name (we only track names here).
function parseBulkLines(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split('\n')) {
    let s = line.trim();
    if (!s) continue;
    // Skip board section headers like "Sideboard" / "Maybeboard" / "Deck"
    if (/^(sideboard|maybeboard|deck|commander)$/i.test(s)) continue;
    // Strip optional leading quantity ("1 ", "1x ", "10x ", "2 ")
    s = s.replace(/^(\d+)(x)?\s+/i, '');
    // Strip set/collector suffix like " (NEO) 123"
    s = s.replace(/\s+\([A-Za-z0-9]{2,5}\)\s+\S+$/, '');
    s = s.trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function AddCardPopover({ existingCards, onAddCard }: { existingCards: string[]; onAddCard: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'search' | 'paste'>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);

  const existing = useMemo(() => new Set(existingCards.map(c => c.toLowerCase())), [existingCards]);

  const parsedBulk = useMemo(() => parseBulkLines(bulkText), [bulkText]);
  const newBulkNames = useMemo(() => parsedBulk.filter(n => !existing.has(n.toLowerCase())), [parsedBulk, existing]);

  useEffect(() => {
    if (mode !== 'search') return;
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await searchCards(query, [], { order: 'edhrec', skipFormatFilter: true });
        const filtered = res.data.filter(c => !existing.has(c.name.toLowerCase()));
        setResults(filtered.slice(0, 8));
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [mode, query, existing]);

  const handleAdd = (card: ScryfallCard) => {
    onAddCard(card.name);
    setQuery('');
    setResults([]);
  };

  const handleBulkAdd = () => {
    if (newBulkNames.length === 0) return;
    for (const name of newBulkNames) onAddCard(name);
    const skipped = parsedBulk.length - newBulkNames.length;
    setBulkStatus(`Added ${newBulkNames.length} card${newBulkNames.length === 1 ? '' : 's'}${skipped > 0 ? `, skipped ${skipped} already in list` : ''}.`);
    setBulkText('');
    setTimeout(() => setBulkStatus(null), 2500);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add cards
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="flex items-center gap-1 p-1 border-b border-border/60">
          <button
            onClick={() => setMode('search')}
            className={`flex-1 px-2 py-1 rounded text-xs font-medium transition-colors ${mode === 'search' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Search
          </button>
          <button
            onClick={() => setMode('paste')}
            className={`flex-1 px-2 py-1 rounded text-xs font-medium transition-colors ${mode === 'paste' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Paste list
          </button>
        </div>
        {mode === 'search' ? (
          <>
            <div className="p-2 border-b border-border/60">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search Scryfall by name..."
                  className="w-full pl-8 pr-2 py-1.5 text-xs rounded-md bg-accent/40 border border-border/40 focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto py-1">
              {isSearching && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Searching...
                </div>
              )}
              {!isSearching && query.trim() && results.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">No matches.</div>
              )}
              {!isSearching && !query.trim() && (
                <div className="px-3 py-2 text-xs text-muted-foreground">Type a card name to search.</div>
              )}
              {results.map(card => (
                <button
                  key={card.id}
                  onClick={() => handleAdd(card)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors text-left"
                >
                  <Plus className="w-3 h-3 text-primary shrink-0" />
                  <span className="truncate">{card.name}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground/70 shrink-0 truncate max-w-[120px]">{card.type_line?.split('—')[0].trim()}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="p-2 space-y-2">
            <textarea
              autoFocus
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={"One card per line:\n1 Sol Ring\nLightning Bolt\n1x Counterspell"}
              rows={10}
              className="w-full px-2 py-1.5 text-xs rounded-md bg-accent/40 border border-border/40 focus:outline-none focus:ring-1 focus:ring-primary/40 font-mono"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-muted-foreground">
                {parsedBulk.length === 0
                  ? 'Quantity prefixes (1, 1x) and set tags will be stripped.'
                  : `${newBulkNames.length} new${parsedBulk.length !== newBulkNames.length ? ` · ${parsedBulk.length - newBulkNames.length} dupe${parsedBulk.length - newBulkNames.length === 1 ? '' : 's'}` : ''}`}
              </p>
              <button
                onClick={handleBulkAdd}
                disabled={newBulkNames.length === 0}
                className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none transition-colors"
              >
                Add {newBulkNames.length || ''}
              </button>
            </div>
            {bulkStatus && (
              <p className="text-[10px] text-emerald-400/90">{bulkStatus}</p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
