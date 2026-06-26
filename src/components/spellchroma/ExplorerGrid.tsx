import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Check, Plus, ChevronsDown, Loader2, Layers, Package } from 'lucide-react';
import type { ScryfallCard, DetectedCombo } from '@/types';
import { getCardImageUrl } from '@/services/scryfall/client';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { Button } from '@/components/ui/button';
import { randomLoadingPhrase } from '@/services/spellchroma/loadingPhrases';
import { CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import { typeRank, type ExplorerSort, type SortDir } from '@/services/spellchroma/explorerSearch';
import { tagsForOracleId } from '@/services/spellchroma/tagIndex';
import { isIgnoredTag } from '@/services/spellchroma/ignoredTags';
import { AddTagPopover } from './AddTagPopover';
import { CardTagPopoverContent, type DeckPanelMenuProps } from './DeckContextPanel';
import { useCardCombos } from './useCardCombos';

// Per-tile entrance delay for the staggered "deal-in". Capped so a large result
// set still finishes its wave quickly instead of trickling in for seconds.
const cardDelay = (i: number) => `${Math.min(i, 24) * 20}ms`;

interface ExplorerGridProps {
  cards: ScryfallCard[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  loadingAll: boolean;
  error: boolean;
  hasTags: boolean;       // any tags selected?
  textFilter: string;
  sort: ExplorerSort;
  dir?: SortDir;
  /** Changes when the underlying search (tags/filters) changes — remounts the
   *  grid so the staggered deal-in replays for a genuinely new result set. */
  dealKey?: string;
  /** Names of cards already in the loaded deck — those tiles get an "in deck" badge. */
  deckNames?: Set<string>;
  /** Names of cards in the user's collection — those tiles get an "owned" badge. */
  collectionNames?: Set<string>;
  /** When true, in-deck cards are dropped from the grid entirely. */
  hideInDeck?: boolean;
  /** Show the "hide in-deck cards" toggle in the count row (a deck is loaded). */
  showHideInDeck?: boolean;
  onHideInDeckChange?: (v: boolean) => void;
  /** Whether the loaded thing is a deck or a list — used for "in your deck/list" wording. */
  noun?: 'deck' | 'list';
  /** When true, only cards in the user's collection are shown. */
  collectionOnly?: boolean;
  /** Show the "owned only" toggle in the count row (the collection is non-empty). */
  showCollectionOnly?: boolean;
  onCollectionOnlyChange?: (v: boolean) => void;
  /** Deck's top tag slugs — surfaced first in the empty-state Add-tag picker. */
  topTags?: string[];
  /** Pin the count row just below the (also-sticky) toolbar in the workbench pane. */
  sticky?: boolean;
  /** Pixel offset for the sticky count row — the measured toolbar height. */
  stickyTop?: number;
  /** Currently-selected search tags — drive active state in the card popover. */
  selectedTags?: string[];
  onLoadAll: () => void;
  onTagClick?: (slug: string) => void;
  onRemoveTag?: (slug: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  /** A saved list is loaded → the card popover's Add button gains a board dropdown. */
  boardsEnabled?: boolean;
  menuProps?: DeckPanelMenuProps;
  /** Card name → combos it appears in, for the preview modal's combo tab. */
  cardComboMap?: Map<string, DetectedCombo[]>;
}

export function ExplorerGrid({
  cards, total, hasMore, loading, loadingAll, error, hasTags, textFilter, sort, dir = 'asc', dealKey, deckNames, collectionNames, hideInDeck = false, showHideInDeck = false, onHideInDeckChange, noun = 'deck', collectionOnly = false, showCollectionOnly = false, onCollectionOnlyChange, topTags, selectedTags, sticky = false, stickyTop = 52, onLoadAll, onTagClick, onRemoveTag,
  onCardAction, boardsEnabled = false, menuProps, cardComboMap,
}: ExplorerGridProps) {
  // Full-card preview opened by clicking the image inside a card's popover
  // (mirrors the deck panel).
  const [preview, setPreview] = useState<ScryfallCard | null>(null);
  const previewCombos = useCardCombos(preview, deckNames, cardComboMap);
  // Springy reorder/add/remove for in-place changes (sort flip, text filter,
  // "load all"). A new search remounts the grid via `key`, so auto-animate stays
  // quiet there and the CSS deal-in handles the fresh wave.
  const [gridRef] = useAutoAnimate<HTMLDivElement>({ duration: 320, easing: 'cubic-bezier(0.34, 1.4, 0.5, 1)' });

  // Rotating flavor while a search is in flight.
  const [phrase, setPhrase] = useState(randomLoadingPhrase);
  useEffect(() => {
    if (!loading) return;
    setPhrase(randomLoadingPhrase());
    const id = setInterval(() => setPhrase(randomLoadingPhrase()), 2500);
    return () => clearInterval(id);
  }, [loading]);

  const filtered = useMemo(() => {
    const q = textFilter.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.type_line?.toLowerCase().includes(q) ||
      c.oracle_text?.toLowerCase().includes(q) ||
      c.card_faces?.some(f =>
        f.name?.toLowerCase().includes(q) ||
        f.type_line?.toLowerCase().includes(q) ||
        f.oracle_text?.toLowerCase().includes(q),
      ),
    );
  }, [cards, textFilter]);

  // Sort client-side so changing the order/direction never needs a new query once
  // cards are loaded. `order=edhrec` on Scryfall is just edhrec_rank ascending, so
  // sorting by that field reproduces the server order exactly; type groups by
  // canonical type order. The direction flips the primary key; edhrec_rank stays
  // the ascending tiebreak so equal-key cards keep a stable, popular-first order.
  const ordered = useMemo(() => {
    const byRank = (a: ScryfallCard, b: ScryfallCard) =>
      (a.edhrec_rank ?? Infinity) - (b.edhrec_rank ?? Infinity);
    const primary: (a: ScryfallCard, b: ScryfallCard) => number =
      sort === 'cmc' ? (a, b) => (a.cmc ?? 0) - (b.cmc ?? 0)
      : sort === 'name' ? (a, b) => a.name.localeCompare(b.name)
      : sort === 'type' ? (a, b) => typeRank(a) - typeRank(b)
      : byRank;
    const sign = dir === 'desc' ? -1 : 1;
    return [...filtered].sort((a, b) => sign * primary(a, b) || byRank(a, b));
  }, [filtered, sort, dir]);

  // Optionally drop cards already in the loaded deck and/or those not owned.
  const visible = useMemo(() => {
    let list = ordered;
    if (hideInDeck && deckNames) list = list.filter(c => !deckNames.has(c.name));
    if (collectionOnly && collectionNames) list = list.filter(c => collectionNames.has(c.name));
    return list;
  }, [ordered, hideInDeck, deckNames, collectionOnly, collectionNames]);
  const hiddenCount = ordered.length - visible.length;

  // States that pre-empt the grid.
  if (!hasTags) {
    return (
      <Empty title="Pick a tag to start exploring" sub="Add an oracle tag — try “ramp”, “sacrifice-outlet”, or “treasure”."
        action={onTagClick && (
          <AddTagPopover selectedTags={[]} topTags={topTags} onAddTag={onTagClick} align="center">
            <Button size="sm" className="gap-1.5 mt-2 bg-violet-600 hover:bg-violet-500 text-white">
              <Plus className="w-4 h-4" /> Add tag
            </Button>
          </AddTagPopover>
        )}
      />
    );
  }
  if (error) {
    return <Empty title="Search failed" sub="Scryfall didn’t respond. Try again or change tags." />;
  }
  if (loading && cards.length === 0) {
    return <Empty title={`${phrase}…`} sub="Pulling matching cards from Scryfall." spinner />;
  }
  if (cards.length === 0) {
    return <Empty title="No cards match those tags" sub="Try fewer tags or a wider color identity." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div style={sticky ? { top: stickyTop } : undefined}
        className={`flex items-center justify-between text-xs text-muted-foreground px-3 py-2 border-b border-border/50 bg-card/95 backdrop-blur-sm ${sticky ? 'lg:sticky z-20' : ''}`}>
        <span>
          {filtered.length === cards.length && hiddenCount === 0
            ? `Showing ${cards.length} of ${total}`
            : `Showing ${visible.length} of ${cards.length} loaded (${total} total)`}
          {hiddenCount > 0 && <span className="text-violet-300/70"> · {hiddenCount} hidden</span>}
        </span>
        <div className="flex items-center gap-2">
          {showCollectionOnly && (
            <button
              type="button"
              onClick={() => onCollectionOnlyChange?.(!collectionOnly)}
              aria-pressed={collectionOnly}
              title={collectionOnly ? 'Showing only cards you own' : 'Limit to cards in your collection'}
              className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border transition-colors ${
                collectionOnly
                  ? 'bg-violet-500/20 text-violet-200 border-violet-500/40'
                  : 'border-border/50 text-muted-foreground/70 hover:text-foreground hover:bg-accent/50'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Owned&nbsp;only</span>
            </button>
          )}
          {showHideInDeck && (
            <button
              type="button"
              onClick={() => onHideInDeckChange?.(!hideInDeck)}
              aria-pressed={hideInDeck}
              title={hideInDeck ? `Showing only cards not in your ${noun}` : `Hide cards already in your ${noun}`}
              className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border transition-colors ${
                hideInDeck
                  ? 'bg-violet-500/20 text-violet-200 border-violet-500/40'
                  : 'border-border/50 text-muted-foreground/70 hover:text-foreground hover:bg-accent/50'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{hideInDeck ? `Hiding in ${noun}` : `Showing in ${noun}`}</span>
            </button>
          )}
          {hasMore && (
            <Button variant="outline" size="sm" onClick={onLoadAll} disabled={loadingAll} className="gap-1.5 bg-violet-500/30 text-violet-100 border-violet-500/50 hover:bg-violet-500/40 hover:text-white">
              {loadingAll
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <ChevronsDown className="w-3.5 h-3.5" />}
              {loadingAll ? 'Loading…' : `Load all ${total}`}
            </Button>
          )}
        </div>
      </div>

      <div key={dealKey} ref={gridRef} className="grid gap-3 px-3 pb-4 grid-cols-2 sm:gap-4 sm:px-4 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]">
        {visible.map((card, i) => (
          <ExplorerCard
            key={card.id}
            card={card}
            index={i}
            inDeck={!!deckNames?.has(card.name)}
            inCollection={!!collectionNames?.has(card.name)}
            noun={noun}
            selectedTags={selectedTags}
            onTagClick={onTagClick}
            onRemoveTag={onRemoveTag}
            onCardAction={onCardAction}
            boardsEnabled={boardsEnabled}
            onPreview={setPreview}
            menuProps={menuProps}
          />
        ))}
      </div>

      <CardPreviewModal
        card={preview}
        onClose={() => setPreview(null)}
        onTagClick={onTagClick}
        combos={previewCombos}
        cardComboMap={cardComboMap}
      />
    </div>
  );
}

function Empty({ title, sub, action, spinner = false }: { title: string; sub: string; action?: ReactNode; spinner?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-6 gap-1">
      {spinner && <Loader2 className="w-6 h-6 mb-3 animate-spin text-violet-300" />}
      <p className="text-foreground/90 font-medium">{title}</p>
      <p className="text-sm text-muted-foreground max-w-sm">{sub}</p>
      {action}
    </div>
  );
}

const ExplorerCard = memo(function ExplorerCard({ card, index, inDeck = false, inCollection = false, noun = 'deck', selectedTags, onTagClick, onRemoveTag, onCardAction, boardsEnabled = false, onPreview, menuProps }: {
  card: ScryfallCard;
  index: number;
  inDeck?: boolean;
  inCollection?: boolean;
  noun?: 'deck' | 'list';
  selectedTags?: string[];
  onTagClick?: (slug: string) => void;
  onRemoveTag?: (slug: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  boardsEnabled?: boolean;
  onPreview?: (card: ScryfallCard) => void;
  menuProps?: DeckPanelMenuProps;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const canMenu = !!(onCardAction && menuProps);
  const titleSuffix = inDeck ? ` · already in your ${noun}` : inCollection ? ' · in your collection' : '';

  const tags = useMemo(() => {
    const all = tagsForOracleId(card.oracle_id ?? '');
    const helpful = all.filter(s => !isIgnoredTag(s));
    return helpful.length ? helpful : all;
  }, [card]);
  const selected = useMemo(() => new Set(selectedTags ?? []), [selectedTags]);

  return (
    <div
      className={`relative [content-visibility:auto] [contain-intrinsic-size:auto_240px] ${index < 60 ? 'animate-sc-card-in' : ''}`}
      style={index < 60 ? { animationDelay: cardDelay(index) } : undefined}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            onContextMenu={(e) => { if (!canMenu) return; e.preventDefault(); setMenuOpen(true); }}
            className={`group relative aspect-[5/7] w-full rounded-lg overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-[transform,opacity] duration-200 hover:-translate-y-1 hover:scale-[1.03] hover:shadow-[0_10px_30px_-8px_rgba(0,0,0,0.7)] data-[state=open]:-translate-y-1 data-[state=open]:scale-[1.03] data-[state=open]:shadow-[0_10px_30px_-8px_rgba(0,0,0,0.7)] data-[state=open]:!opacity-100 ${
              inDeck ? 'ring-2 ring-inset ring-emerald-400/70 opacity-45 hover:opacity-100' : ''
            }`}
            title={`${card.name}${titleSuffix}`}
          >
            <img
              src={getCardImageUrl(card, 'normal') ?? ''}
              alt={card.name}
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
            />
            {inDeck && (
              <span className="absolute top-1 left-1 z-10 inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500/90 text-white border border-emerald-300/60 shadow-sm" title={`Already in your ${noun}`}>
                <Check className="w-2.5 h-2.5" strokeWidth={3} />
              </span>
            )}
            {inCollection && (
              <span className="absolute top-1 right-1 z-10 inline-flex items-center justify-center w-4 h-4 rounded-md bg-muted text-foreground/80 border border-border shadow-sm" title="In your collection">
                <Package className="w-2.5 h-2.5" />
              </span>
            )}
          </button>
        </PopoverTrigger>
        <CardTagPopoverContent
          card={card}
          count={1}
          tags={tags}
          selected={selected}
          noun={noun}
          onTagClick={(slug) => onTagClick?.(slug)}
          onRemoveTag={onRemoveTag}
          onPreview={onPreview}
          onAddToDeck={onCardAction && !inDeck ? (c) => onCardAction(c, { type: 'addToDeck' }) : undefined}
          onAddToSideboard={onCardAction && !inDeck && boardsEnabled ? (c) => onCardAction(c, { type: 'sideboard' }) : undefined}
          onAddToMaybeboard={onCardAction && !inDeck && boardsEnabled ? (c) => onCardAction(c, { type: 'maybeboard' }) : undefined}
        />
      </Popover>
      {canMenu && (
        <span
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-0"
          onClick={(e) => e.stopPropagation()}
          aria-hidden
        >
          <CardContextMenu
            card={card}
            onAction={onCardAction!}
            noun={noun}
            hasAddToDeck={!inDeck}
            hasRemove={inDeck}
            hasSideboard={!inDeck && boardsEnabled}
            hasMaybeboard={!inDeck && boardsEnabled}
            addToBoard
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
}, (prev, next) =>
  // Skip re-rendering tiles whose own data is unchanged so a single toolbar click
  // (sort/color/type/owned-only) doesn't re-render every card in the grid. `index`
  // is intentionally excluded from the compare — it only drives the mount-time
  // CSS deal-in delay, which is inert once a tile is on screen (a genuinely new
  // search remounts the whole grid via its `key`, giving fresh tiles fresh delays).
  prev.card === next.card &&
  prev.inDeck === next.inDeck &&
  prev.inCollection === next.inCollection &&
  prev.noun === next.noun &&
  prev.selectedTags === next.selectedTags &&
  prev.boardsEnabled === next.boardsEnabled &&
  prev.onTagClick === next.onTagClick &&
  prev.onRemoveTag === next.onRemoveTag &&
  prev.onCardAction === next.onCardAction &&
  prev.onPreview === next.onPreview &&
  prev.menuProps === next.menuProps,
);
