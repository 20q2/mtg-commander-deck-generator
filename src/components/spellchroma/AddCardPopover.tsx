import { useEffect, useRef, useState } from 'react';
import { Plus, X, Loader2, MoreHorizontal, Layers, Bookmark, CornerDownLeft } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import { searchCards, getCardByName, getCardImageUrl } from '@/services/scryfall/client';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CardAction } from '@/components/deck/DeckDisplay';

/**
 * The deck pane's manual "add a card" control: a `+` button that opens a small
 * autocomplete search. Lets you pull a specific card into the loaded deck by
 * name — independent of what the tag explorer happens to surface. Results stay
 * in the deck's color identity (and commander-legal) via `searchCards`, and an
 * empty Enter resolves the typed name fuzzily so a near-miss still lands.
 *
 * Adds route through the same `onCardAction` the rest of the panel uses, so a
 * saved list persists + toasts for free. When a saved list is loaded
 * (`boardsEnabled`), each result also offers sideboard/maybeboard destinations.
 */
export function AddCardPopover({ colorIdentity, boardsEnabled = false, deckNames, onCardAction }: {
  colorIdentity: string[];
  boardsEnabled?: boolean;
  /** Names already in the main deck — filtered out of the suggestions. */
  deckNames: Set<string>;
  onCardAction: (card: ScryfallCard, action: CardAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [searching, setSearching] = useState(false);
  // Card id whose row is showing the sideboard/maybeboard picker (saved lists only).
  const [boardPickerFor, setBoardPickerFor] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search, scoped to the deck's identity + commander legality. Drops
  // cards already in the deck and caps the list so the popover stays compact.
  useEffect(() => {
    if (!query.trim()) { setResults([]); setSearching(false); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchCards(query, colorIdentity, { order: 'edhrec' });
        setResults(res.data.filter(c => !deckNames.has(c.name)).slice(0, 8));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, colorIdentity, deckNames]);

  // Add and reset for the next card — the popover stays open so several cards
  // can be added in a row.
  const add = (card: ScryfallCard, type: CardAction['type']) => {
    onCardAction(card, { type } as CardAction);
    setQuery('');
    setResults([]);
    setBoardPickerFor(null);
    inputRef.current?.focus();
  };

  // Enter with no dropdown selection: resolve the typed name fuzzily so minor
  // spelling/capitalization slips still add the intended card.
  const onKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const name = query.trim();
    if (!name) return;
    const first = results[0];
    if (first) { add(first, 'addToDeck'); return; }
    try {
      const card = await getCardByName(name, false);
      add(card, 'addToDeck');
    } catch { /* no match — leave the query so the user can fix it */ }
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setQuery(''); setResults([]); setBoardPickerFor(null); } }}>
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
          {searching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-violet-300" />}
          {!searching && query && (
            <button type="button" onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {results.length > 0 ? (
          <div className="mt-2 max-h-[300px] overflow-y-auto flex flex-col">
            {results.map((card) => (
              <div key={card.id} className="flex items-center gap-2 rounded-md hover:bg-accent/50 transition-colors group">
                <button type="button" onClick={() => add(card, 'addToDeck')}
                  className="flex flex-1 min-w-0 items-center gap-2.5 px-2 py-1.5 text-left">
                  <img src={getCardImageUrl(card, 'small')} alt={card.name} loading="lazy"
                    className="w-7 h-auto rounded shadow shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{card.name}</span>
                    {card.type_line && <span className="block text-[11px] text-muted-foreground truncate">{card.type_line}</span>}
                  </span>
                </button>
                {boardsEnabled && boardPickerFor === card.id ? (
                  <div className="flex shrink-0 items-center gap-1 pr-1.5">
                    <button type="button" onClick={() => add(card, 'sideboard')} title="Add to sideboard"
                      className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md border border-violet-500/50 text-violet-100/90 text-[11px] font-medium hover:bg-violet-500/15 transition-colors">
                      <Layers className="w-3 h-3 text-amber-300" /> Side
                    </button>
                    <button type="button" onClick={() => add(card, 'maybeboard')} title="Add to maybeboard"
                      className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md border border-violet-500/50 text-violet-100/90 text-[11px] font-medium hover:bg-violet-500/15 transition-colors">
                      <Bookmark className="w-3 h-3 text-purple-300" /> Maybe
                    </button>
                  </div>
                ) : (
                  <span className="flex shrink-0 items-center pr-1.5">
                    {boardsEnabled && (
                      <button type="button" onClick={() => setBoardPickerFor(card.id)} title="Add to sideboard or maybeboard"
                        className="p-1 rounded text-muted-foreground/70 hover:text-foreground hover:bg-accent transition-colors">
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : query.trim() && !searching ? (
          <p className="mt-2 px-2 py-3 text-xs text-center text-muted-foreground">No commander-legal matches in this color identity.</p>
        ) : (
          <p className="mt-2 px-2 py-2 text-[11px] text-muted-foreground/80 flex items-center gap-1.5">
            Type a name, then click a result or press <CornerDownLeft className="w-3 h-3" /> to add.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
