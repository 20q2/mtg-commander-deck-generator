import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useStore } from '@/store';
import { searchCards, getCardImageUrl } from '@/services/scryfall/client';
import type { ScryfallCard } from '@/types';
import { Search, Loader2, X, Ban, Upload, Trash2 } from 'lucide-react';

export function BannedCards() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');

  const { customization, updateCustomization, colorIdentity } = useStore();
  const bannedCards = customization.bannedCards;

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        // Search for cards matching the query within the commander's color identity
        const searchResults = await searchCards(query, colorIdentity, { order: 'edhrec' });
        // Filter out already banned cards
        const filtered = searchResults.data.filter(
          card => !bannedCards.includes(card.name)
        );
        setResults(filtered.slice(0, 8));
        setShowResults(true);
      } catch (error) {
        console.error('Search error:', error);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, colorIdentity, bannedCards]);

  const handleBanCard = (card: ScryfallCard) => {
    if (!bannedCards.includes(card.name)) {
      updateCustomization({
        bannedCards: [...bannedCards, card.name],
      });
    }
    setQuery('');
    setResults([]);
    setShowResults(false);
  };

  const handleUnbanCard = (cardName: string) => {
    updateCustomization({
      bannedCards: bannedCards.filter(name => name !== cardName),
    });
  };

  const handleImportList = () => {
    if (!importText.trim()) return;

    // Parse the import text - supports:
    // - One card per line
    // - Comma-separated
    // - "1x Card Name" or "1 Card Name" format (strips quantity prefix)
    // - Lines starting with // are comments
    const lines = importText
      .split(/[\n,]/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('//'));

    const newCards: string[] = [];
    for (const line of lines) {
      // Strip quantity prefix like "1x ", "2 ", "1x", etc.
      const cardName = line.replace(/^\d+x?\s*/i, '').trim();
      if (cardName && !bannedCards.includes(cardName) && !newCards.includes(cardName)) {
        newCards.push(cardName);
      }
    }

    if (newCards.length > 0) {
      updateCustomization({
        bannedCards: [...bannedCards, ...newCards],
      });
    }

    setImportText('');
    setShowImport(false);
  };

  const handleClearAll = () => {
    updateCustomization({ bannedCards: [] });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Ban className="w-4 h-4 text-muted-foreground" />
          <label className="text-sm font-medium">Excluded Cards</label>
          {bannedCards.length > 0 && (
            <span className="text-xs text-muted-foreground">
              ({bannedCards.length})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowImport(!showImport)}
            className={`p-1.5 rounded-md text-xs transition-colors ${
              showImport
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-accent text-muted-foreground hover:text-foreground'
            }`}
            title="Import list"
          >
            <Upload className="w-3.5 h-3.5" />
          </button>
          {bannedCards.length > 0 && (
            <button
              onClick={handleClearAll}
              className="p-1.5 rounded-md text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="Clear all"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Import Textarea */}
      {showImport && (
        <div className="space-y-2 p-3 bg-accent/30 rounded-lg border border-border/50">
          <p className="text-xs text-muted-foreground">
            Paste card names (one per line or comma-separated)
          </p>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={"Sol Ring\nMana Crypt\nRhystic Study\n..."}
            className="w-full h-24 px-3 py-2 text-sm bg-background border border-border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setShowImport(false);
                setImportText('');
              }}
              className="px-3 py-1.5 text-xs rounded-md hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleImportList}
              disabled={!importText.trim()}
              className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add Cards
            </button>
          </div>
        </div>
      )}

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search cards to exclude..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setShowResults(true)}
          className="pl-9 pr-9 h-9 text-sm rounded-lg"
        />
        {isSearching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-primary" />
        )}

        {/* Search Results Dropdown */}
        {showResults && results.length > 0 && (
          <Card className="absolute top-full left-0 right-0 mt-1 z-50 max-h-[250px] overflow-auto shadow-xl">
            <CardContent className="p-1">
              {results.map((card) => (
                <button
                  key={card.id}
                  onClick={() => handleBanCard(card)}
                  className="w-full flex items-center gap-3 p-2 hover:bg-accent/50 rounded-md text-left transition-colors group"
                >
                  <img
                    src={getCardImageUrl(card, 'small')}
                    alt={card.name}
                    className="w-8 h-auto rounded shadow"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-destructive transition-colors">
                      {card.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {card.type_line}
                    </p>
                  </div>
                  <X className="w-4 h-4 text-muted-foreground group-hover:text-destructive transition-colors" />
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
      </div>

      {/* Banned Cards List */}
      {bannedCards.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {bannedCards.map((cardName) => (
            <span
              key={cardName}
              className="inline-flex items-center gap-1 px-2 py-1 bg-destructive/10 text-destructive text-xs rounded-md border border-destructive/20"
            >
              <span className="truncate max-w-[150px]">{cardName}</span>
              <button
                onClick={() => handleUnbanCard(cardName)}
                className="hover:bg-destructive/20 rounded p-0.5 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {bannedCards.length === 0 && !showImport && (
        <p className="text-xs text-muted-foreground">
          Search cards or click <Upload className="w-3 h-3 inline" /> to import a list
        </p>
      )}
    </div>
  );
}
