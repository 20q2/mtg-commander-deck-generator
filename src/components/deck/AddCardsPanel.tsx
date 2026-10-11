import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus, X, Loader2, CornerDownLeft, Repeat } from 'lucide-react';
import { useCardNameSearch } from '@/hooks/useCardNameSearch';
import { CollectionImporter, type CollectionImporterHandle } from '@/components/collection/CollectionImporter';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import type { ScryfallCard } from '@/types';
import type { SwapInPlan } from '@/services/deckBuilder/swapFinder';
import { getCardByName } from '@/services/scryfall/client';
import { SwapInPanel } from '@/components/lists/SwapInPanel';

export interface AddCardsPanelProps {
  /** Names already present — dropped from the autocomplete suggestions. */
  existingNames?: Set<string>;
  /**
   * Bulk path: Scryfall-validated canonical names from the paste box. Return the
   * counts so the importer's result card can report "N already in deck".
   */
  onAddCards: (names: string[]) => { added: number; updated: number };
  /** Single-card path. Defaults to routing the one name through `onAddCards`. */
  onAddCard?: (name: string) => void;
  /** Header label for the paste section (default: "Add Cards"). */
  label?: string;
  hideLabel?: boolean;
  /** Label for the importer's "updated" count (default: "already in deck"). */
  updatedLabel?: string;
  onCancel?: () => void;
  textareaClassName?: string;
  autoFocus?: boolean;
  /** Surface the drag-a-card-link tip — only true where the surface accepts those drops. */
  showDragDropHint?: boolean;
  /**
   * Offers an Add / Swap mode switch beside the type-a-name hint. In Swap mode a
   * chosen card takes this panel over with its cut recommendation instead of
   * being added — the search is one back-step behind it. The paste-a-list half
   * is always a plain add, since a 40-card import is not a trade.
   */
  swapEnabled?: boolean;
  /**
   * Inset for the panel's own content. It lives here rather than on each
   * caller's wrapper because the swap view renders edge to edge — its sections
   * carry their own padding and its dividers must reach both edges — and only
   * this component knows which view is showing.
   */
  contentPadding?: 'none' | 'sm' | 'md';
  /** Ranks what could come out for this card. Synchronous; no loading state. */
  getSwapPlan?: (card: ScryfallCard) => SwapInPlan | null;
  /** Applies the chosen trade. */
  onConfirmSwap?: (incoming: ScryfallCard, cutName: string) => void | Promise<void>;
}

/**
 * The app's one "add cards" surface: type a name with autocomplete, or paste a
 * whole list. Both halves land in the same place — the caller's `onAddCards` —
 * so a single-card add and a 40-card paste behave identically downstream.
 *
 * Rendered bare (no popover chrome) so each caller keeps its own positioning:
 * the deck-view text editor wraps it in {@link AddCardsPopover} (Radix), while
 * ListDeckView's edit toolbar hand-positions it because Radix Popover breaks
 * inside that toolbar's `createPortal` subtree.
 *
 * Forwards the underlying {@link CollectionImporterHandle} so a caller closing
 * the panel can flush pasted-but-un-imported text instead of dropping it.
 */
export const AddCardsPanel = forwardRef<CollectionImporterHandle, AddCardsPanelProps>(function AddCardsPanel(
  { existingNames, onAddCards, onAddCard, label, hideLabel, updatedLabel = 'already in deck', onCancel, textareaClassName, autoFocus, showDragDropHint, swapEnabled = false, contentPadding = 'md', getSwapPlan, onConfirmSwap }, ref
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'add' | 'swap'>('add');
  const swapping = swapEnabled && !!getSwapPlan && !!onConfirmSwap && mode === 'swap';
  // The card being swapped in, once chosen. Non-null means this panel is showing
  // the cut recommendation in place of the search.
  const [pendingSwap, setPendingSwap] = useState<ScryfallCard | null>(null);
  const [resolving, setResolving] = useState(false);
  // Retained so the outgoing pane still has something to draw while it slides
  // away; clearing it with pendingSwap would collapse the view mid-transition.
  const [lastSwap, setLastSwap] = useState<ScryfallCard | null>(null);
  useEffect(() => { if (pendingSwap) setLastSwap(pendingSwap); }, [pendingSwap]);
  // Recomputed per render so a card added moments ago stops being suggested;
  // useCardNameSearch holds it in a ref, so this never re-fires the request.
  const exclude = useMemo(
    () => new Set([...(existingNames ?? [])].map(n => n.toLowerCase())),
    [existingNames]
  );

  const { query, setQuery, suggestions, loading, clear } = useCardNameSearch({ exclude });

  // Suggestions are canonical Scryfall names already, so they can go straight
  // down the same path as a validated paste.
  const add = async (name: string) => {
    if (swapping) {
      setResolving(true);
      try {
        setPendingSwap(await getCardByName(name, true));
        // Collapse the suggestions so the swap pane sits straight under the
        // search bar rather than below a list you have finished with.
        clear();
      }
      catch { /* lookup failed — leave the query so the user can retry */ }
      finally { setResolving(false); }
      return;
    }
    if (onAddCard) onAddCard(name);
    else onAddCards([name]);
    clear();
    inputRef.current?.focus();
  };

  // The search bar is a fixed header; only what sits beneath it changes, and it
  // slides across like a pair of tabs rather than swapping in place.
  const padX = contentPadding === 'md' ? 'px-4' : contentPadding === 'sm' ? 'px-3' : '';
  const padTop = contentPadding === 'md' ? 'pt-4' : contentPadding === 'sm' ? 'pt-3' : '';
  const padBottom = contentPadding === 'md' ? 'pb-4' : contentPadding === 'sm' ? 'pb-3' : '';

  const addPaneRef = useRef<HTMLDivElement>(null);
  const swapPaneRef = useRef<HTMLDivElement>(null);
  const [paneHeight, setPaneHeight] = useState<number>();
  useLayoutEffect(() => {
    const el = (pendingSwap ? swapPaneRef : addPaneRef).current;
    if (!el) return;
    const measure = () => setPaneHeight(el.offsetHeight);
    measure();
    // Both panes change height on their own — suggestions arrive, the paste box
    // is dragged — so track the active one rather than measuring once.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pendingSwap, suggestions.length, query, loading]);

  const leaveSwap = () => { setPendingSwap(null); inputRef.current?.focus(); };
  const swapCard = pendingSwap ?? lastSwap;

  return (
    <div>
      <div className={`${padX} ${padTop}`}>
        <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Plus className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            autoFocus={autoFocus}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); if (suggestions[0]) void add(suggestions[0]); }
            }}
            placeholder="Add a card by name…"
            className="h-9 pl-8 pr-8 text-sm"
          />
          {(loading || resolving) && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-violet-300" />}
          {!loading && !resolving && query && (
            <button
              type="button"
              onClick={() => { clear(); inputRef.current?.focus(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {swapEnabled && getSwapPlan && onConfirmSwap && (
          <div className="shrink-0 flex items-center rounded-md border border-border/60 bg-card/60 p-0.5" role="group" aria-label="What a chosen card does">
            {(['add', 'swap'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); if (m === 'add') leaveSwap(); }}
                aria-pressed={mode === m}
                title={m === 'add' ? 'Add the card to the deck' : 'Trade the card in for one already in the deck'}
                className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors ${
                  mode === m
                    ? 'bg-violet-500/20 text-violet-100 border border-violet-400/40'
                    : 'text-muted-foreground hover:text-foreground border border-transparent'
                }`}
              >
                {m === 'add' ? 'Add' : 'Swap'}
              </button>
            ))}
          </div>
        )}
        </div>

        <div className="mt-1.5 min-h-[22px]">
          {/* A plain paragraph, not a flex row: as flex items the two text
              halves and the ↵ glyph wrapped independently, with the gap left
              hanging mid-sentence. */}
          <p className="px-2 text-[11px] leading-snug text-muted-foreground/80">
            {query.trim() && !loading && suggestions.length === 0
              ? 'No cards match that name.'
              : suggestions.length === 0 && (swapping
                ? 'Type a name to swap it in.'
                : <>Type a name, then press <CornerDownLeft className="inline w-3 h-3 align-[-1px]" /> to add.</>
              )}
          </p>
        </div>

        {suggestions.length > 0 && (
          <div className="max-h-[220px] overflow-y-auto flex flex-col">
            {suggestions.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => void add(name)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-accent/50 transition-colors"
              >
                {swapping
                  ? <Repeat className="w-3.5 h-3.5 text-violet-300/70 shrink-0" />
                  : <Plus className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />}
                <span className="flex-1 min-w-0 truncate text-sm">{name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        className="overflow-hidden transition-[height] duration-300 ease-out"
        style={{ height: paneHeight }}
      >
        <div
          className="flex transition-transform duration-300 ease-out"
          style={{ width: '200%', transform: pendingSwap ? 'translateX(-50%)' : 'translateX(0)' }}
        >
          <div
            ref={addPaneRef}
            aria-hidden={!!pendingSwap}
            className={`w-1/2 shrink-0 space-y-3 pt-3 ${padX} ${padBottom} ${pendingSwap ? 'pointer-events-none' : ''}`}
          >
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-border/60" />
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">or paste a list</span>
              <div className="h-px flex-1 bg-border/60" />
            </div>

            <CollectionImporter
        ref={ref}
        onImportCards={onAddCards}
        label={label ?? 'Add Cards'}
        hideLabel={hideLabel}
        updatedLabel={updatedLabel}
        onCancel={onCancel}
        textareaClassName={textareaClassName}
        showDragDropHint={showDragDropHint}
            />
          </div>

          <div
            ref={swapPaneRef}
            aria-hidden={!pendingSwap}
            className={`w-1/2 shrink-0 ${pendingSwap ? '' : 'pointer-events-none'}`}
          >
            {swapCard && (
              <SwapInPanel
                key={swapCard.name}
                incoming={swapCard}
                plan={getSwapPlan?.(swapCard) ?? { roomToAdd: false, short: 0, incomingRole: null, candidates: [] }}
                onBack={leaveSwap}
                onSwap={async (cutName) => {
                  await onConfirmSwap!(swapCard, cutName);
                  setPendingSwap(null);
                  clear();
                  onCancel?.();
                }}
                onAddAnyway={() => {
                  if (onAddCard) onAddCard(swapCard.name);
                  else onAddCards([swapCard.name]);
                  setPendingSwap(null);
                  clear();
                  onCancel?.();
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export interface AddCardsPopoverProps extends AddCardsPanelProps {
  trigger: React.ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  contentClassName?: string;
}

/**
 * {@link AddCardsPanel} in a Radix popover. Closing while the paste box still
 * holds text imports it first rather than silently dropping it — the same rule
 * ListDeckView applies to its hand-positioned copies.
 */
export function AddCardsPopover({ trigger, align = 'end', side = 'bottom', contentClassName, ...panel }: AddCardsPopoverProps) {
  const [open, setOpen] = useState(false);
  const importerRef = useRef<CollectionImporterHandle>(null);

  const handleOpenChange = (next: boolean) => {
    if (next) { setOpen(true); return; }
    const importer = importerRef.current;
    if (importer?.hasPending()) {
      // Stay open until the flush resolves so its result card is visible.
      void importer.triggerImport().then(() => setOpen(false));
      return;
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        // Escape is an explicit cancel, so it discards pending text rather than
        // flushing it the way an outside click does.
        onEscapeKeyDown={(e) => { e.preventDefault(); setOpen(false); }}
        className={contentClassName ?? 'w-[min(92vw,24rem)] p-0'}
      >
        <AddCardsPanel
          contentPadding="sm"
          ref={importerRef}
          autoFocus
          hideLabel
          onCancel={() => setOpen(false)}
          textareaClassName="h-32"
          {...panel}
        />
      </PopoverContent>
    </Popover>
  );
}
