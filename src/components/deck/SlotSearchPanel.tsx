import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Loader2, Plus, Check, Package, Search, X, AlertTriangle } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import { searchCards, getCardImageUrl } from '@/services/scryfall/client';
import { FloatingDialog } from '@/components/playtest/FloatingDialog';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import { ManaCost } from '@/components/ui/mtg-icons';
import { useStore } from '@/store';
import { useUserLists } from '@/hooks/useUserLists';

type SortKey = 'edhrec' | 'name' | 'cmc';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'edhrec', label: 'Popularity' },
  { key: 'name', label: 'Name A→Z' },
  { key: 'cmc', label: 'Mana value' },
];

interface SlotSearchPanelProps {
  /** The slot's label, e.g. "2× creature with persist". */
  label: string;
  /** Context line under the title — usually the combo this slot belongs to. */
  subtitle?: string;
  /** Scryfall query already narrowed to the deck (see `slotSearchQuery`). */
  query: string;
  /** Link to the same search on Scryfall, kept as an escape hatch. */
  scryfallUrl: string | null;
  /** Lowercased names already in the deck — those tiles read "In deck". */
  deckCardNames?: Set<string>;
  /** Exact-case names in the user's binders — those tiles read "Owned". */
  ownedNames?: Set<string> | null;
  /** Adds a card to the deck. Omit to render a read-only browser. */
  onAdd?: (name: string) => void;
  /** Sends a card straight to the deck's sideboard / maybeboard, when the host has those. */
  onSideboard?: (name: string) => void;
  onMaybeboard?: (name: string) => void;
  onClose: () => void;
}

/**
 * Browses the cards that would fill an unfilled combo slot, in the deck's
 * colours, without leaving the app — the slot chip used to hand the user a
 * Scryfall tab and no way back. Results come from the same query the Scryfall
 * link uses, so the two always agree.
 */
export function SlotSearchPanel({
  label, subtitle, query, scryfallUrl, deckCardNames, ownedNames, onAdd, onSideboard, onMaybeboard, onClose,
}: SlotSearchPanelProps) {
  const [sort, setSort] = useState<SortKey>('edhrec');
  const [cards, setCards] = useState<ScryfallCard[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState('');
  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);
  // Cards added from this panel. The deck prop behind `deckCardNames` may not
  // round-trip until a regenerate finishes, so the tile confirms locally.
  const [added, setAdded] = useState<Set<string>>(new Set());
  // The card whose context menu is open, if any — right-click anywhere on a
  // tile opens the same menu the ⋮ button does.
  const [menuCard, setMenuCard] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const mustIncludeCards = useStore(s => s.customization.mustIncludeCards);
  const bannedCards = useStore(s => s.customization.bannedCards);
  const updateCustomization = useStore(s => s.updateCustomization);
  const { lists: userLists, updateList, createList } = useUserLists();

  // A sort change restarts the search; "load more" appends. Tracking the page
  // we last fetched keeps the two in one effect without double-fetching page 1.
  const fetchedRef = useRef<string | null>(null);

  useEffect(() => {
    setCards([]);
    setPage(1);
    setHasMore(false);
    setTotal(0);
    fetchedRef.current = null;
  }, [query, sort]);

  useEffect(() => {
    const key = `${query}|${sort}|${page}`;
    if (fetchedRef.current === key) return;
    fetchedRef.current = key;
    let cancelled = false;
    setLoading(true);
    setError(false);
    (async () => {
      try {
        // The colour/format narrowing already lives in `query`, so no identity
        // or format filter is layered on here.
        const res = await searchCards(query, [], { order: sort, page, skipFormatFilter: true });
        if (cancelled) return;
        setCards(prev => {
          if (page === 1) return res.data;
          const seen = new Set(prev.map(c => c.name));
          return [...prev, ...res.data.filter(c => !seen.has(c.name))];
        });
        setHasMore(res.has_more);
        setTotal(res.total_cards ?? res.data.length);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [query, sort, page]);

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return cards;
    return cards.filter(c =>
      c.name.toLowerCase().includes(f) || (c.type_line ?? '').toLowerCase().includes(f));
  }, [cards, filter]);

  const handleAdd = useCallback((card: ScryfallCard) => {
    if (!onAdd) return;
    onAdd(card.name);
    setAdded(prev => new Set(prev).add(card.name));
    setToast(`Added "${card.name}" to deck`);
  }, [onAdd]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  /**
   * The standard card menu, minus the entries that make no sense here: these
   * cards aren't in the deck, so there's nothing to remove, and the combo-panel
   * view filters belong to the panel that owns them.
   */
  const handleCardAction = useCallback((card: ScryfallCard, action: CardAction) => {
    const name = card.name;
    switch (action.type) {
      case 'addToDeck':
        handleAdd(card);
        break;
      case 'sideboard':
        onSideboard?.(name);
        setToast(`Added "${name}" to sideboard`);
        break;
      case 'maybeboard':
        onMaybeboard?.(name);
        setToast(`Added "${name}" to maybeboard`);
        break;
      case 'mustInclude': {
        const has = mustIncludeCards.includes(name);
        updateCustomization({ mustIncludeCards: has ? mustIncludeCards.filter(n => n !== name) : [...mustIncludeCards, name] });
        setToast(has ? `Removed "${name}" from Must Include` : `Added "${name}" to Must Include`);
        break;
      }
      case 'exclude':
        if (!bannedCards.includes(name)) updateCustomization({ bannedCards: [...bannedCards, name] });
        setToast(`Excluded "${name}"`);
        break;
      case 'addToList': {
        const list = userLists.find(l => l.id === action.listId);
        if (!list) break;
        const board = action.board ?? 'main';
        const key = board === 'sideboard' ? 'sideboard' : board === 'maybeboard' ? 'maybeboard' : 'cards';
        const current = (board === 'main' ? list.cards : list[key as 'sideboard' | 'maybeboard']) ?? [];
        if (current.includes(name)) break;
        updateList(action.listId, { [key]: [...current, name] });
        setToast(`Added "${name}" to "${list.name}"${board === 'main' ? '' : ` ${board}`}`);
        break;
      }
      case 'createListAndAdd':
        createList(action.listName, [name]);
        setToast(`Created "${action.listName}" with "${name}"`);
        break;
      default:
        break;
    }
  }, [handleAdd, onSideboard, onMaybeboard, mustIncludeCards, bannedCards, updateCustomization, userLists, updateList, createList]);

  const title = (
    <span className="flex items-center gap-2 min-w-0">
      <Search className="w-4 h-4 opacity-70 shrink-0" />
      <span className="truncate capitalize">{label}</span>
    </span>
  );

  const headerExtra = scryfallUrl ? (
    <div className="flex items-center gap-2 shrink-0" onPointerDown={(e) => e.stopPropagation()}>
      <a
        href={scryfallUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted-foreground hover:text-foreground transition-colors"
        title="Open this search on Scryfall"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </div>
  ) : null;

  return (
    <FloatingDialog
      title={title}
      headerExtra={headerExtra}
      onClose={onClose}
      width={640}
      height={620}
      minWidth={380}
      minHeight={360}
      resizable
      hideGrip
      storageKey="slot-search-panel-pos"
      sizeStorageKey="slot-search-panel-size"
    >
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Toolbar — context line, filter, sort. */}
        <div className="shrink-0 px-3 pt-2.5 pb-2 border-b border-border/40 space-y-2">
          {subtitle && (
            <p className="text-[11px] text-muted-foreground truncate" title={subtitle}>{subtitle}</p>
          )}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/70 pointer-events-none" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter these results…"
                className="w-full h-8 pl-7 pr-7 text-xs rounded-md bg-background border border-border/60 focus:border-primary/60 focus:outline-none"
              />
              {filter && (
                <button
                  onClick={() => setFilter('')}
                  aria-label="Clear filter"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-8 text-xs rounded-md bg-background border border-border/60 px-2 focus:border-primary/60 focus:outline-none"
            >
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {loading && cards.length === 0
              ? 'Searching Scryfall…'
              : error
                ? 'Search failed.'
                : total === 0
                  ? 'No cards match this slot in your colours.'
                  : `${total} card${total === 1 ? '' : 's'} fill this slot in your colours — showing ${visible.length}.`}
          </p>
        </div>

        {/* Results */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
          {error ? (
            <div className="flex flex-col items-center justify-center gap-2 h-full text-center">
              <AlertTriangle className="w-6 h-6 text-amber-400/80" />
              <p className="text-xs text-muted-foreground">Couldn't reach Scryfall.</p>
              <button
                onClick={() => { fetchedRef.current = null; setPage(1); setError(false); }}
                className="text-xs text-primary hover:underline"
              >
                Try again
              </button>
            </div>
          ) : loading && cards.length === 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {Array.from({ length: 15 }).map((_, i) => (
                <div key={i} className="aspect-[5/7] rounded-lg bg-accent/30 animate-pulse" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              {cards.length === 0 ? 'Nothing matches this slot in your colours.' : 'No loaded card matches that filter.'}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {visible.map(card => (
                  <SlotResultTile
                    key={card.id}
                    card={card}
                    inDeck={!!deckCardNames?.has(card.name.toLowerCase())}
                    owned={!!ownedNames?.has(card.name)}
                    added={added.has(card.name)}
                    onPreview={() => setPreviewCard(card)}
                    onAdd={onAdd ? () => handleAdd(card) : undefined}
                    onOpenMenu={() => setMenuCard(card.name)}
                    menu={
                      <CardContextMenu
                        card={card}
                        onAction={handleCardAction}
                        hasAddToDeck={!!onAdd}
                        hasSideboard={!!onSideboard}
                        hasMaybeboard={!!onMaybeboard}
                        addToBoard
                        isMustInclude={mustIncludeCards.includes(card.name)}
                        isBanned={bannedCards.some(n => n.toLowerCase() === card.name.toLowerCase())}
                        userLists={userLists}
                        forceOpen={menuCard === card.name}
                        onForceClose={() => setMenuCard(null)}
                        contentClassName="z-[200]"
                      />
                    }
                  />
                ))}
              </div>
              {hasMore && !filter && (
                <div className="flex justify-center pt-3">
                  <button
                    onClick={() => setPage(p => p + 1)}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border/60 bg-accent/30 hover:bg-accent/60 transition-colors disabled:opacity-60"
                  >
                    {loading && <Loader2 className="w-3 h-3 animate-spin" />}
                    Load more ({total - cards.length} left)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {toast && (
        <div className="absolute inset-x-0 bottom-0 z-20 px-3 pb-2 pointer-events-none">
          <div className="rounded-md bg-foreground/90 text-background text-[11px] font-medium px-3 py-1.5 shadow-lg animate-fade-in truncate">
            {toast}
          </div>
        </div>
      )}

      <CardPreviewModal card={previewCard} onClose={() => setPreviewCard(null)} hideMustInclude />
    </FloatingDialog>
  );
}

function SlotResultTile({ card, inDeck, owned, added, onPreview, onAdd, menu, onOpenMenu }: {
  card: ScryfallCard;
  inDeck: boolean;
  owned: boolean;
  added: boolean;
  onPreview: () => void;
  onAdd?: () => void;
  /** The card's context menu — its own ⋮ trigger, force-opened by right-click. */
  menu: React.ReactNode;
  onOpenMenu: () => void;
}) {
  const imageUrl = getCardImageUrl(card, 'small');
  const isIn = inDeck || added;

  return (
    <div
      className="group relative rounded-lg overflow-hidden bg-accent/20 border border-border/30 hover:border-primary/40 transition-colors"
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onOpenMenu(); }}
    >
      <button
        type="button"
        onClick={onPreview}
        aria-label={`Preview ${card.name}`}
        className="block w-full"
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={card.name}
            loading="lazy"
            className={`w-full aspect-[5/7] object-cover transition-opacity ${isIn ? 'opacity-50' : ''}`}
          />
        ) : (
          <div className="w-full aspect-[5/7] bg-accent/50 flex items-center justify-center p-2">
            <span className="text-[10px] text-muted-foreground text-center leading-tight">{card.name}</span>
          </div>
        )}
      </button>

      {/* ⋮ trigger. Always visible on touch (no hover, no right-click), hover-only
          on desktop so the art stays clean. */}
      <span className="absolute top-1 right-1 z-20 rounded bg-black/60 backdrop-blur-[2px] opacity-70 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {menu}
      </span>

      {isIn && (
        <span className="absolute top-1 left-1 z-10 pointer-events-none rounded-full bg-emerald-500/90 text-white text-[9px] font-semibold px-1.5 py-0.5 shadow">
          {added && !inDeck ? 'Added' : 'In deck'}
        </span>
      )}
      {owned && !isIn && (
        <span
          className="absolute top-1 left-1 z-10 pointer-events-none flex items-center gap-0.5 rounded-full bg-emerald-950/85 text-emerald-300 text-[9px] font-semibold px-1.5 py-0.5 shadow"
          title="In your collection"
        >
          <Package className="w-2.5 h-2.5" />
          OWNED
        </span>
      )}

      {/* Hover footer — name, cost, and the add button. */}
      <div className="absolute inset-x-0 bottom-0 p-1.5 pt-5 bg-gradient-to-t from-black/90 via-black/70 to-transparent opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <div className="flex items-center gap-1 mb-1">
          <p className="flex-1 min-w-0 text-[10px] text-white font-medium truncate">{card.name}</p>
          {card.mana_cost && <ManaCost cost={card.mana_cost} className="text-[9px] shrink-0" />}
        </div>
        {onAdd && (
          <button
            onClick={(e) => { e.stopPropagation(); onAdd(); }}
            disabled={isIn}
            className={`w-full inline-flex items-center justify-center gap-1 text-[10px] font-semibold rounded py-1 transition-colors ${
              isIn
                ? 'bg-emerald-500/20 text-emerald-300 cursor-default'
                : 'bg-primary/80 text-primary-foreground hover:bg-primary'
            }`}
          >
            {isIn ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
            {isIn ? (added && !inDeck ? 'Added' : 'In deck') : 'Add to deck'}
          </button>
        )}
      </div>
    </div>
  );
}
