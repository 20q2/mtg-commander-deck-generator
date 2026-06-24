import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Check, Plus, ChevronsDown, Loader2, Layers } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import { getCardImageUrl } from '@/services/scryfall/client';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { Button } from '@/components/ui/button';
import { randomLoadingPhrase } from '@/services/spellchroma/loadingPhrases';
import { CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import { typeRank, type ExplorerSort } from '@/services/spellchroma/explorerSearch';
import { AddTagPopover } from './AddTagPopover';
import type { DeckPanelMenuProps } from './DeckContextPanel';

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
  /** Changes when the underlying search (tags/filters) changes — remounts the
   *  grid so the staggered deal-in replays for a genuinely new result set. */
  dealKey?: string;
  /** Names of cards already in the loaded deck — those tiles get an "in deck" badge. */
  deckNames?: Set<string>;
  /** Names of cards in the user's collection — those tiles get an "owned" badge. */
  collectionNames?: Set<string>;
  /** When true, in-deck cards are dropped from the grid entirely. */
  hideInDeck?: boolean;
  /** Pin the count row just below the (also-sticky) toolbar in the workbench pane. */
  sticky?: boolean;
  /** Pixel offset for the sticky count row — the measured toolbar height. */
  stickyTop?: number;
  onLoadAll: () => void;
  onTagClick?: (slug: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: DeckPanelMenuProps;
}

export function ExplorerGrid({
  cards, total, hasMore, loading, loadingAll, error, hasTags, textFilter, sort, dealKey, deckNames, collectionNames, hideInDeck = false, sticky = false, stickyTop = 52, onLoadAll, onTagClick,
  onCardAction, menuProps,
}: ExplorerGridProps) {
  const [preview, setPreview] = useState<ScryfallCard | null>(null);
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
      c.oracle_text?.toLowerCase().includes(q) ||
      c.card_faces?.some(f => f.name?.toLowerCase().includes(q) || f.oracle_text?.toLowerCase().includes(q)),
    );
  }, [cards, textFilter]);

  // Type sort groups by canonical type order (ties keep their EDHREC order).
  // Grouping is over loaded cards only — "Load all" covers the full set.
  const ordered = useMemo(() => {
    if (sort !== 'type') return filtered;
    return [...filtered].sort((a, b) => typeRank(a) - typeRank(b));
  }, [filtered, sort]);

  // Optionally drop cards already in the loaded deck.
  const visible = useMemo(
    () => (hideInDeck && deckNames ? ordered.filter(c => !deckNames.has(c.name)) : ordered),
    [ordered, hideInDeck, deckNames],
  );
  const hiddenCount = ordered.length - visible.length;

  // States that pre-empt the grid.
  if (!hasTags) {
    return (
      <Empty title="Pick a tag to start exploring" sub="Add an oracle tag — try “ramp”, “sacrifice-outlet”, or “treasure”."
        action={onTagClick && (
          <AddTagPopover selectedTags={[]} onAddTag={onTagClick} align="center">
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
    return <Empty title={`${phrase}…`} sub="Pulling matching cards from Scryfall." />;
  }
  if (cards.length === 0) {
    return <Empty title="No cards match those tags" sub="Try fewer tags or a wider color identity." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div style={sticky ? { top: stickyTop } : undefined}
        className={`flex items-center justify-between text-xs text-muted-foreground px-3 py-2 border-b border-border/50 bg-card/95 backdrop-blur-sm ${sticky ? 'sticky z-20' : ''}`}>
        <span>
          {filtered.length === cards.length && hiddenCount === 0
            ? `Showing ${cards.length} of ${total}`
            : `Showing ${visible.length} of ${cards.length} loaded (${total} total)`}
          {hiddenCount > 0 && <span className="text-violet-300/70"> · {hiddenCount} in deck hidden</span>}
        </span>
        {hasMore && (
          <Button variant="outline" size="sm" onClick={onLoadAll} disabled={loadingAll} className="gap-1.5 text-white">
            {loadingAll
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <ChevronsDown className="w-3.5 h-3.5" />}
            {loadingAll ? 'Loading…' : `Load all ${total}`}
          </Button>
        )}
      </div>

      <div key={dealKey} ref={gridRef} className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]">
        {visible.map((card, i) => (
          <ExplorerCard
            key={card.id}
            card={card}
            index={i}
            inDeck={!!deckNames?.has(card.name)}
            inCollection={!!collectionNames?.has(card.name)}
            onSelect={setPreview}
            onCardAction={onCardAction}
            menuProps={menuProps}
          />
        ))}
      </div>

      <CardPreviewModal
        card={preview}
        onClose={() => setPreview(null)}
        showOracleTags
        onTagClick={onTagClick}
      />
    </div>
  );
}

function Empty({ title, sub, action }: { title: string; sub: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-6 gap-1">
      <p className="text-foreground/90 font-medium">{title}</p>
      <p className="text-sm text-muted-foreground max-w-sm">{sub}</p>
      {action}
    </div>
  );
}

function ExplorerCard({ card, index, inDeck = false, inCollection = false, onSelect, onCardAction, menuProps }: {
  card: ScryfallCard;
  index: number;
  inDeck?: boolean;
  inCollection?: boolean;
  onSelect: (c: ScryfallCard) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: DeckPanelMenuProps;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const canMenu = !!(onCardAction && menuProps);
  const titleSuffix = inDeck ? ' · already in your deck' : inCollection ? ' · in your collection' : '';
  return (
    <div className="relative animate-sc-card-in" style={{ animationDelay: cardDelay(index) }}>
      <button
        type="button"
        onClick={() => onSelect(card)}
        onContextMenu={(e) => { if (!canMenu) return; e.preventDefault(); setMenuOpen(true); }}
        className={`group relative aspect-[5/7] w-full rounded-lg overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-[transform,opacity] duration-200 hover:-translate-y-1 hover:scale-[1.03] hover:shadow-[0_10px_30px_-8px_rgba(0,0,0,0.7)] ${
          inDeck ? 'ring-1 ring-inset ring-violet-400/50 opacity-45 hover:opacity-100' : ''
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
          <span className="absolute top-1 left-1 z-10 inline-flex items-center justify-center w-4 h-4 rounded-full bg-violet-500/70 text-violet-50 shadow-sm" title="Already in your deck">
            <Layers className="w-2.5 h-2.5" />
          </span>
        )}
        {inCollection && (
          <span className="absolute top-1 right-1 z-10 inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500/80 text-emerald-50 shadow-sm" title="In your collection">
            <Check className="w-2.5 h-2.5" strokeWidth={3} />
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
            hasAddToDeck
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
