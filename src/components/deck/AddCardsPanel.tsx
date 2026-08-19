import { forwardRef, useMemo, useRef, useState } from 'react';
import { Plus, X, Loader2, CornerDownLeft } from 'lucide-react';
import { useCardNameSearch } from '@/hooks/useCardNameSearch';
import { CollectionImporter, type CollectionImporterHandle } from '@/components/collection/CollectionImporter';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';

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
  { existingNames, onAddCards, onAddCard, label, hideLabel, updatedLabel = 'already in deck', onCancel, textareaClassName, autoFocus, showDragDropHint }, ref
) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Recomputed per render so a card added moments ago stops being suggested;
  // useCardNameSearch holds it in a ref, so this never re-fires the request.
  const exclude = useMemo(
    () => new Set([...(existingNames ?? [])].map(n => n.toLowerCase())),
    [existingNames]
  );

  const { query, setQuery, suggestions, loading, clear } = useCardNameSearch({ exclude });

  // Suggestions are canonical Scryfall names already, so they can go straight
  // down the same path as a validated paste.
  const add = (name: string) => {
    if (onAddCard) onAddCard(name);
    else onAddCards([name]);
    clear();
    inputRef.current?.focus();
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="relative">
          <Plus className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            autoFocus={autoFocus}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); if (suggestions[0]) add(suggestions[0]); }
            }}
            placeholder="Add a card by name…"
            className="h-9 pl-8 pr-8 text-sm"
          />
          {loading && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-violet-300" />}
          {!loading && query && (
            <button
              type="button"
              onClick={() => { clear(); inputRef.current?.focus(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {suggestions.length > 0 ? (
          <div className="mt-1.5 max-h-[220px] overflow-y-auto flex flex-col">
            {suggestions.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => add(name)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-accent/50 transition-colors"
              >
                <Plus className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                <span className="flex-1 min-w-0 truncate text-sm">{name}</span>
              </button>
            ))}
          </div>
        ) : query.trim() && !loading ? (
          <p className="mt-1.5 px-2 py-2 text-xs text-center text-muted-foreground">No cards match that name.</p>
        ) : (
          <p className="mt-1.5 px-2 text-[11px] text-muted-foreground/80 flex items-center gap-1.5">
            Type a name, then press <CornerDownLeft className="w-3 h-3" /> to add.
          </p>
        )}
      </div>

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
        className={contentClassName ?? 'w-[min(92vw,24rem)] p-3'}
      >
        <AddCardsPanel
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
