import { useMemo, useRef, useState } from 'react';
import { X, Loader2, ArrowRightLeft, Search } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import { getCardByName, getCardImageUrl } from '@/services/scryfall/client';
import { useCardNameSearch } from '@/hooks/useCardNameSearch';
import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { suggestCutCandidates, type RankedCut } from '@/services/deckBuilder/cutSuggestion';

/**
 * The reverse of the swap-candidate flow: "I have this card, what should I cut for it?"
 * Search a card by name, then see the deck's worst-fit cards (via cutSuggestion, the same
 * scoring cutRanking/cardFit use everywhere else) ranked worst-first, with one-click swap.
 */
export function CutFinder({ isOpen, onClose, deckCardNames }: {
  isOpen: boolean;
  onClose: () => void;
  deckCardNames: Set<string>;
}) {
  const { generatedDeck, swapDeckCard, pushDeckHistory } = useStore();
  const [chosenCard, setChosenCard] = useState<ScryfallCard | null>(null);
  const [ranked, setRanked] = useState<RankedCut[]>([]);
  const [resolving, setResolving] = useState(false);
  const [swappedOut, setSwappedOut] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const exclude = useMemo(() => new Set([...deckCardNames].map(n => n.toLowerCase())), [deckCardNames]);
  const { query, setQuery, suggestions, loading, clear } = useCardNameSearch({ exclude });

  const chooseCard = async (name: string) => {
    setResolving(true);
    try {
      const card = await getCardByName(name, true);
      setChosenCard(card);
      setSwappedOut(new Set());
      if (generatedDeck) setRanked(suggestCutCandidates(generatedDeck, card));
      clear();
    } catch {
      /* lookup failed — leave the query so the user can retry */
    } finally {
      setResolving(false);
    }
  };

  const handleCut = (cut: RankedCut) => {
    if (!generatedDeck || !chosenCard) return;
    swapDeckCard(cut.card, chosenCard);
    pushDeckHistory({ action: 'swap', cardName: cut.card.name, targetCardName: chosenCard.name });
    setSwappedOut(prev => new Set(prev).add(cut.card.name));
  };

  const reset = () => {
    setChosenCard(null);
    setRanked([]);
    setSwappedOut(new Set());
    clear();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in p-4"
      onClick={() => { onClose(); reset(); }}
    >
      <div
        className="bg-card rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-muted-foreground" />
            What should I cut?
          </h2>
          <button onClick={() => { onClose(); reset(); }} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {!chosenCard ? (
            <>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  ref={inputRef}
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Card you want to add…"
                  className="h-9 pl-8"
                />
                {(loading || resolving) && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-violet-300" />}
              </div>
              {suggestions.length > 0 ? (
                <div className="max-h-72 overflow-y-auto flex flex-col">
                  {suggestions.map(name => (
                    <button
                      key={name}
                      type="button"
                      disabled={resolving}
                      onClick={() => void chooseCard(name)}
                      className="flex items-center gap-2 px-2 py-2 text-left text-sm rounded-md hover:bg-accent/50 transition-colors disabled:opacity-60"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              ) : query.trim() && !loading ? (
                <p className="px-2 py-3 text-xs text-center text-muted-foreground">No cards match that name.</p>
              ) : (
                <p className="px-2 py-2 text-xs text-muted-foreground/80">
                  Search for a card, then pick which of your current cards to cut for it.
                </p>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 pb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <img src={getCardImageUrl(chosenCard, 'small')} alt="" className="w-8 h-11 rounded object-cover shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">Adding</div>
                    <div className="text-sm font-medium truncate">{chosenCard.name}</div>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={reset}>Change card</Button>
              </div>

              {ranked.length === 0 ? (
                <p className="px-2 py-3 text-xs text-center text-muted-foreground">
                  No eligible cut candidates found — every card is either protected (combo piece) or there's no {isAnyLandName(chosenCard) ? 'other land' : 'other nonland card'} to compare against.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {ranked.map(cut => {
                    const done = swappedOut.has(cut.card.name);
                    return (
                      <div
                        key={cut.card.name}
                        className={`flex items-center gap-2 rounded-lg border p-2 transition-colors ${done ? 'border-border/30 opacity-50' : 'border-border/50 hover:border-border'}`}
                      >
                        <img src={getCardImageUrl(cut.card, 'small')} alt="" className="w-8 h-11 rounded object-cover shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{cut.card.name}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{cut.reasons[0]}</div>
                        </div>
                        <Button
                          size="sm"
                          variant={done ? 'outline' : 'default'}
                          disabled={done}
                          onClick={() => handleCut(cut)}
                          className="shrink-0"
                        >
                          {done ? 'Swapped' : `Cut this, add ${chosenCard.name}`}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function isAnyLandName(card: ScryfallCard): boolean {
  return (card.type_line ?? '').toLowerCase().includes('land');
}

export function useCutFinderState() {
  const [isOpen, setIsOpen] = useState(false);
  return { isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false) };
}
