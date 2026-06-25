import { useMemo, useRef, useState } from 'react';
import { Plus, X, Loader2, MoreHorizontal, Layers, Bookmark, CornerDownLeft } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import { getCardByName } from '@/services/scryfall/client';
import { useCardNameSearch } from '@/hooks/useCardNameSearch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CardAction } from '@/components/deck/DeckDisplay';

/**
 * The deck pane's manual "add a card" control: a `+` button that opens a small
 * autocomplete search so you can pull a specific card into the loaded deck by
 * name — independent of what the tag explorer surfaces. Suggestions come from
 * the shared {@link useCardNameSearch} hook; the chosen name is resolved to a
 * full card and routed through the same `onCardAction` the rest of the panel
 * uses, so a saved list persists + toasts for free. When a saved list is loaded
 * (`boardsEnabled`), each result also offers sideboard/maybeboard destinations.
 */
export function AddCardPopover({ colorIdentity: _colorIdentity, boardsEnabled = false, deckNames, onCardAction }: {
  /** Reserved for future identity-aware hinting; suggestions are name-based today. */
  colorIdentity?: string[];
  boardsEnabled?: boolean;
  /** Names already in the main deck — filtered out of the suggestions. */
  deckNames: Set<string>;
  onCardAction: (card: ScryfallCard, action: CardAction) => void;
}) {
  const [open, setOpen] = useState(false);
  // Card name whose row is showing the sideboard/maybeboard picker (saved lists only).
  const [boardPickerFor, setBoardPickerFor] = useState<string | null>(null);
  // While a chosen name is being resolved to a full card.
  const [resolving, setResolving] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const exclude = useMemo(() => new Set([...deckNames].map(n => n.toLowerCase())), [deckNames]);
  const { query, setQuery, suggestions, loading, clear } = useCardNameSearch({ exclude });

  // Resolve the chosen name to a full card, then route it through onCardAction.
  // The popover stays open and the input refocuses so several cards can be added
  // in a row.
  const add = async (name: string, type: CardAction['type']) => {
    setResolving(name);
    try {
      const card = await getCardByName(name, true);
      onCardAction(card, { type } as CardAction);
      clear();
      setBoardPickerFor(null);
      inputRef.current?.focus();
    } catch {
      /* lookup failed — leave the query so the user can retry */
    } finally {
      setResolving(null);
    }
  };

  // Enter adds the top suggestion, or resolves the typed name fuzzily so a
  // near-miss (spelling/casing) still lands.
  const onKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const name = query.trim();
    if (!name) return;
    if (suggestions[0]) { void add(suggestions[0], 'addToDeck'); return; }
    setResolving(name);
    try {
      const card = await getCardByName(name, false);
      onCardAction(card, { type: 'addToDeck' });
      clear();
      inputRef.current?.focus();
    } catch {
      /* no match — leave the query so the user can fix it */
    } finally {
      setResolving(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { clear(); setBoardPickerFor(null); } }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" title="Add a card" aria-label="Add a card"
          className="shrink-0 h-7 w-7 text-muted-foreground/80 hover:text-foreground">
          <Plus className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <div className="relative">
          <Plus className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Add a card by name…"
            className="h-9 pl-8 pr-8 text-sm"
          />
          {(loading || resolving) && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-violet-300" />}
          {!loading && !resolving && query && (
            <button type="button" onClick={() => { clear(); inputRef.current?.focus(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {suggestions.length > 0 ? (
          <div className="mt-2 max-h-[300px] overflow-y-auto flex flex-col">
            {suggestions.map((name) => (
              <div key={name} className="flex items-center gap-2 rounded-md hover:bg-accent/50 transition-colors group">
                <button type="button" onClick={() => void add(name, 'addToDeck')} disabled={!!resolving}
                  className="flex flex-1 min-w-0 items-center gap-2 px-2 py-2 text-left disabled:opacity-60">
                  <Plus className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                  <span className="flex-1 min-w-0 truncate text-sm">{name}</span>
                </button>
                {boardsEnabled && boardPickerFor === name ? (
                  <div className="flex shrink-0 items-center gap-1 pr-1.5">
                    <button type="button" onClick={() => void add(name, 'sideboard')} title="Add to sideboard"
                      className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md border border-violet-500/50 text-violet-100/90 text-[11px] font-medium hover:bg-violet-500/15 transition-colors">
                      <Layers className="w-3 h-3 text-amber-300" /> Side
                    </button>
                    <button type="button" onClick={() => void add(name, 'maybeboard')} title="Add to maybeboard"
                      className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md border border-violet-500/50 text-violet-100/90 text-[11px] font-medium hover:bg-violet-500/15 transition-colors">
                      <Bookmark className="w-3 h-3 text-purple-300" /> Maybe
                    </button>
                  </div>
                ) : boardsEnabled ? (
                  <button type="button" onClick={() => setBoardPickerFor(name)} title="Add to sideboard or maybeboard"
                    className="shrink-0 p-1 mr-1.5 rounded text-muted-foreground/70 hover:text-foreground hover:bg-accent transition-colors">
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : query.trim() && !loading ? (
          <p className="mt-2 px-2 py-3 text-xs text-center text-muted-foreground">No cards match that name.</p>
        ) : (
          <p className="mt-2 px-2 py-2 text-[11px] text-muted-foreground/80 flex items-center gap-1.5">
            Type a name, then click a result or press <CornerDownLeft className="w-3 h-3" /> to add.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
