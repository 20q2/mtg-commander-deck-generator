import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ColorIdentity } from '@/components/ui/mtg-icons';
import { searchValidPartners, getCardImageUrl } from '@/services/scryfall/client';
import { fetchPartnerPopularity } from '@/services/edhrec';
import {
  getPartnerType,
  getPartnerWithName,
  getPartnerTypeLabel,
  canHavePartner,
} from '@/lib/partnerUtils';
import { useStore } from '@/store';
import type { ScryfallCard } from '@/types';
import { Search, Loader2, Plus, X, Users } from 'lucide-react';

interface PartnerSelectorProps {
  commander: ScryfallCard;
}

export function PartnerSelector({ commander }: PartnerSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingInitial, setIsLoadingInitial] = useState(false);
  const [popularity, setPopularity] = useState<Map<string, number>>(new Map());

  // Ref to persist popularity across searches (so sorting stays stable)
  const popularityRef = useRef<Map<string, number>>(new Map());

  const { partnerCommander, setPartnerCommander } = useStore();

  const partnerType = getPartnerType(commander);
  const hasPartnerAbility = canHavePartner(commander);

  // For "Partner with X", we can show the specific partner directly
  const specificPartnerName = partnerType === 'partner-with' ? getPartnerWithName(commander) : null;

  // Fetch partner popularity from EDHREC when dropdown opens
  useEffect(() => {
    if (isOpen && popularityRef.current.size === 0) {
      fetchPartnerPopularity(commander.name).then((data) => {
        popularityRef.current = data;
        setPopularity(data);
      });
    }
  }, [isOpen, commander.name]);

  // Load initial partner options when dropdown opens
  useEffect(() => {
    if (isOpen && results.length === 0 && !specificPartnerName) {
      loadInitialPartners();
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (!isOpen || specificPartnerName) return;

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const searchResults = await searchValidPartners(commander, query);
        setResults(sortByPopularity(searchResults.slice(0, 20)));
      } catch (error) {
        console.error('Partner search error:', error);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, isOpen, commander.name]);

  function sortByPopularity(cards: ScryfallCard[]): ScryfallCard[] {
    const pop = popularityRef.current;
    if (pop.size === 0) return cards;
    return [...cards].sort((a, b) => (pop.get(b.name) || 0) - (pop.get(a.name) || 0));
  }

  // Re-sort when popularity data arrives
  useEffect(() => {
    if (popularity.size > 0 && results.length > 0) {
      setResults(sortByPopularity(results));
    }
  }, [popularity]);

  async function loadInitialPartners() {
    setIsLoadingInitial(true);
    try {
      const initialResults = await searchValidPartners(commander, '');
      setResults(sortByPopularity(initialResults.slice(0, 20)));
    } catch (error) {
      console.error('Failed to load partners:', error);
    } finally {
      setIsLoadingInitial(false);
    }
  }

  async function loadSpecificPartner() {
    if (!specificPartnerName) return;

    setIsLoadingInitial(true);
    try {
      const results = await searchValidPartners(commander, '');
      if (results.length > 0) {
        setResults(results);
      }
    } catch (error) {
      console.error('Failed to load specific partner:', error);
    } finally {
      setIsLoadingInitial(false);
    }
  }

  const handleSelectPartner = (card: ScryfallCard) => {
    setPartnerCommander(card);
    setIsOpen(false);
    setQuery('');
  };

  const handleRemovePartner = () => {
    setPartnerCommander(null);
  };

  function formatDeckCount(count: number): string {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    }
    return count.toString();
  }

  // Don't render if commander can't have a partner
  if (!hasPartnerAbility) {
    return null;
  }

  // Show selected partner
  if (partnerCommander) {
    const deckCount = popularity.get(partnerCommander.name);
    return (
      <div className="mt-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
          <Users className="w-4 h-4" />
          <span>{getPartnerTypeLabel(partnerType)}</span>
        </div>
        <div className="flex items-center gap-3 p-3 bg-accent/30 rounded-lg">
          <img
            src={getCardImageUrl(partnerCommander, 'small')}
            alt={partnerCommander.name}
            className="w-12 h-auto rounded shadow"
          />
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate">{partnerCommander.name}</p>
            <div className="flex items-center gap-2 mt-1">
              <ColorIdentity colors={partnerCommander.color_identity} size="sm" />
              {deckCount !== undefined && (
                <span className="text-xs text-muted-foreground">
                  {formatDeckCount(deckCount)} decks
                </span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRemovePartner}
            className="shrink-0 text-muted-foreground hover:text-destructive"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    );
  }

  // Show "Add Partner" button and dropdown
  return (
    <div className="mt-4 relative">
      {!isOpen ? (
        <Button
          variant="outline"
          onClick={() => {
            setIsOpen(true);
            if (specificPartnerName) {
              loadSpecificPartner();
            }
          }}
          className="w-full justify-start gap-2 text-muted-foreground hover:text-primary"
        >
          <Plus className="w-4 h-4" />
          <span>Add {getPartnerTypeLabel(partnerType)}</span>
        </Button>
      ) : (
        <Card className="animate-scale-in shadow-lg">
          <CardContent className="p-3">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium">
                Select {getPartnerTypeLabel(partnerType)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setIsOpen(false);
                  setQuery('');
                }}
                className="h-8 w-8"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Search input (not shown for Partner with X) */}
            {!specificPartnerName && (
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search partners..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9 h-10"
                  autoFocus
                />
                {isSearching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-primary" />
                )}
              </div>
            )}

            {/* Results list */}
            <div className="max-h-[300px] overflow-y-auto space-y-1">
              {isLoadingInitial ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : results.length > 0 ? (
                results.map((card) => {
                  const deckCount = popularity.get(card.name);
                  return (
                    <button
                      key={card.id}
                      onClick={() => handleSelectPartner(card)}
                      className="w-full flex items-center gap-3 p-2 hover:bg-accent/50 rounded-lg text-left transition-colors group"
                    >
                      <img
                        src={getCardImageUrl(card, 'small')}
                        alt={card.name}
                        className="w-10 h-auto rounded shadow group-hover:shadow-md transition-shadow"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                          {card.name}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <ColorIdentity colors={card.color_identity} size="sm" />
                          {deckCount !== undefined && (
                            <span className="text-xs text-muted-foreground">
                              {formatDeckCount(deckCount)} decks
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              ) : (
                <p className="text-center text-sm text-muted-foreground py-4">
                  {specificPartnerName
                    ? `Loading ${specificPartnerName}...`
                    : 'No partners found'}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
