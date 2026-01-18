import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { ColorIdentity } from '@/components/ui/mtg-icons';
import {
  searchCommanders,
  getCardImageUrl,
} from '@/services/scryfall/client';
import { getTopCommanders } from '@/services/edhrec/client';
import { useStore } from '@/store';
import type { ScryfallCard } from '@/types';
import { Search, Loader2 } from 'lucide-react';

export function CommanderSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const navigate = useNavigate();
  const { setCommander } = useStore();

  // Get top commanders from EDHREC data
  const topCommanders = useMemo(() => getTopCommanders(12), []);

  // Debounced search
  useEffect(() => {
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
  }, [query]);

  const handleSelectCommander = (card: ScryfallCard) => {
    setQuery('');
    setResults([]);
    setShowResults(false);
    // Store the commander in the store (caches image URL)
    setCommander(card);
    // Navigate to the builder page with the commander name
    navigate(`/build/${encodeURIComponent(card.name)}`);
  };

  return (
    <div className="w-full max-w-lg mx-auto relative">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search for a commander..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setShowResults(true)}
          className="pl-12 pr-12 h-14 text-lg rounded-xl bg-card border-border/50 focus:border-primary"
        />
        {isSearching && (
          <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 animate-spin text-primary" />
        )}
      </div>

      {/* Search Results Dropdown */}
      {showResults && results.length > 0 && (
        <Card className="absolute top-full left-0 right-0 mt-2 z-50 max-h-[400px] overflow-auto animate-scale-in shadow-2xl">
          <CardContent className="p-2">
            {results.map((card) => (
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
            ))}
          </CardContent>
        </Card>
      )}

      {/* Click outside to close */}
      {showResults && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowResults(false)}
        />
      )}

      {/* Popular Commander Suggestions from EDHREC */}
      {!query && (
        <div className="text-center mt-8 animate-fade-in">
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
        </div>
      )}
    </div>
  );
}
