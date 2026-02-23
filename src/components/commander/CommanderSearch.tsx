import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { ColorIdentity } from '@/components/ui/mtg-icons';
import {
  searchCommanders,
  getCardByName,
  getCardImageUrl,
} from '@/services/scryfall/client';
import { getTopCommanders } from '@/services/edhrec/client';
import { useStore } from '@/store';
import { useCollection } from '@/hooks/useCollection';
import type { ScryfallCard } from '@/types';
import type { CollectionCard } from '@/services/collection/db';
import { Search, Loader2 } from 'lucide-react';

function isLegendaryCreature(card: CollectionCard): boolean {
  const tl = card.typeLine?.toLowerCase() ?? '';
  return tl.includes('legendary') && tl.includes('creature');
}

/** Shuffle array and return first n items */
function sampleRandom<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

export function CommanderSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [ownedOnly, setOwnedOnly] = useState(false);
  const navigate = useNavigate();
  const { setCommander } = useStore();
  const { cards: collectionCards, count: collectionCount } = useCollection();
  // All legendary creatures in the collection
  const collectionLegends = useMemo(
    () => collectionCards.filter(isLegendaryCreature),
    [collectionCards]
  );

  // Random suggestions from owned legends (stable until ownedOnly toggles)
  const ownedSuggestions = useMemo(
    () => sampleRandom(collectionLegends, 12),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ownedOnly, collectionLegends.length]
  );

  // Local search results when ownedOnly is on
  const localResults = useMemo(() => {
    if (!ownedOnly || !query.trim()) return [];
    const q = query.toLowerCase();
    return collectionLegends
      .filter(c => c.name.toLowerCase().includes(q))
      .slice(0, 10);
  }, [ownedOnly, query, collectionLegends]);

  // Get top commanders from EDHREC data
  const topCommanders = useMemo(() => getTopCommanders(12), []);

  // Debounced Scryfall search (only when NOT ownedOnly)
  useEffect(() => {
    if (ownedOnly) return; // local search handles this path

    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const searchResults = await searchCommanders(query);
        setResults(searchResults.slice(0, 10));
        setShowResults(true);
      } catch (error) {
        console.error('Search error:', error);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, ownedOnly]);

  // Show local results immediately when ownedOnly
  useEffect(() => {
    if (ownedOnly && query.trim() && localResults.length > 0) {
      setShowResults(true);
    }
  }, [ownedOnly, query, localResults]);

  const handleSelectCommander = (card: ScryfallCard) => {
    setQuery('');
    setResults([]);
    setShowResults(false);
    setCommander(card);
    navigate(`/build/${encodeURIComponent(card.name)}`);
  };

  // Select a commander from the collection — fetch full ScryfallCard first
  const handleSelectOwnedCommander = async (name: string) => {
    setIsSearching(true);
    try {
      const card = await getCardByName(name);
      handleSelectCommander(card);
    } catch (error) {
      console.error('Failed to fetch commander:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const showDropdown = ownedOnly
    ? showResults && query.trim().length > 0 && localResults.length > 0
    : showResults && results.length > 0;

  return (
    <div className="w-full max-w-lg mx-auto relative">
      <div className="relative">
        <div className="absolute left-4 inset-y-0 flex items-center pointer-events-none">
          <Search className="w-5 h-5 text-muted-foreground" />
        </div>
        <Input
          type="text"
          placeholder={ownedOnly ? 'Search your commanders...' : 'Search for a commander...'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (ownedOnly && localResults.length > 0) setShowResults(true);
            else if (!ownedOnly && results.length > 0) setShowResults(true);
          }}
          className="pl-12 pr-12 h-14 text-lg rounded-xl bg-card border-border/50 focus:border-primary"
        />
        {isSearching && (
          <div className="absolute right-4 inset-y-0 flex items-center pointer-events-none">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </div>
        )}
      </div>

      {/* Owned Only Toggle */}
      {collectionCount > 0 && (
        <div className="flex justify-end mt-2">
          <label className="flex items-center gap-2 cursor-pointer select-none group">
            <input
              type="checkbox"
              checked={ownedOnly}
              onChange={(e) => { setOwnedOnly(e.target.checked); setResults([]); setShowResults(false); }}
              className="rounded border-border accent-primary w-3.5 h-3.5"
            />
            <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
              Commanders I own{collectionLegends.length > 0 ? ` (${collectionLegends.length.toLocaleString()} legends)` : ''}
            </span>
          </label>
        </div>
      )}

      {/* Search Results Dropdown */}
      {showDropdown && (
        <Card className="absolute top-full left-0 right-0 mt-2 z-50 max-h-[400px] overflow-auto animate-scale-in shadow-2xl">
          <CardContent className="p-2">
            {ownedOnly ? (
              // Local collection results
              localResults.map((card) => (
                <button
                  key={card.name}
                  onClick={() => handleSelectOwnedCommander(card.name)}
                  className="w-full flex items-center gap-4 p-3 hover:bg-accent/50 rounded-lg text-left transition-colors group"
                >
                  {card.imageUrl ? (
                    <img
                      src={card.imageUrl}
                      alt={card.name}
                      className="w-14 h-auto rounded-lg shadow group-hover:shadow-lg transition-shadow"
                    />
                  ) : (
                    <div className="w-14 h-20 rounded-lg bg-accent/50 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate group-hover:text-primary transition-colors">
                      {card.name}
                    </p>
                    {card.typeLine && (
                      <p className="text-sm text-muted-foreground truncate">
                        {card.typeLine}
                      </p>
                    )}
                    {card.colorIdentity && card.colorIdentity.length > 0 && (
                      <div className="mt-1.5">
                        <ColorIdentity colors={card.colorIdentity} size="sm" />
                      </div>
                    )}
                  </div>
                </button>
              ))
            ) : (
              // Scryfall results
              results.map((card) => (
                <button
                  key={card.id}
                  onClick={() => handleSelectCommander(card)}
                  className="w-full flex items-center gap-4 p-3 hover:bg-accent/50 rounded-lg text-left transition-colors group"
                >
                  <img
                    src={getCardImageUrl(card, 'small')}
                    alt={card.name}
                    className="w-14 h-auto rounded-lg shadow group-hover:shadow-lg transition-shadow"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate group-hover:text-primary transition-colors">
                      {card.name}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">
                      {card.type_line}
                    </p>
                    <div className="mt-1.5">
                      <ColorIdentity colors={card.color_identity} size="sm" />
                    </div>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {/* Click outside to close */}
      {showDropdown && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowResults(false)}
        />
      )}

      {/* Suggestions Section */}
      {!query && (
        <div className="text-center mt-8 animate-fade-in">
          {ownedOnly ? (
            // Show random legends from collection
            collectionLegends.length > 0 ? (
              <>
                <p className="text-muted-foreground mb-4">
                  Your legendary creatures:
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {ownedSuggestions.map((legend) => (
                    <button
                      key={legend.name}
                      onClick={() => setQuery(legend.name)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/50 backdrop-blur-sm rounded-full text-sm text-muted-foreground hover:bg-primary/20 hover:text-primary transition-colors cursor-pointer"
                    >
                      {legend.colorIdentity && legend.colorIdentity.length > 0 && (
                        <ColorIdentity colors={legend.colorIdentity} size="sm" />
                      )}
                      <span>{legend.name}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                No legendary creatures found in your collection.
              </p>
            )
          ) : (
            // Show EDHREC top commanders
            <>
              <p className="text-muted-foreground mb-4">
                Top commanders on EDHREC:
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {topCommanders.map((commander) => (
                  <button
                    key={commander.sanitized}
                    onClick={() => setQuery(commander.name)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/50 backdrop-blur-sm rounded-full text-sm text-muted-foreground hover:bg-primary/20 hover:text-primary transition-colors cursor-pointer"
                  >
                    <ColorIdentity colors={commander.colorIdentity} size="sm" />
                    <span>{commander.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
