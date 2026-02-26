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
import { fetchTopCommanders } from '@/services/edhrec/client';
import { useStore } from '@/store';
import { useCollection } from '@/hooks/useCollection';
import type { ScryfallCard } from '@/types';
import type { CollectionCard } from '@/services/collection/db';
import { Search, Loader2 } from 'lucide-react';
import { trackEvent, fetchMetrics } from '@/services/analytics';

function isLegendaryCreature(card: CollectionCard): boolean {
  const tl = card.typeLine?.toLowerCase() ?? '';
  return tl.includes('legendary') && tl.includes('creature');
}

/** Map a sorted color key (e.g. "UBR") to its MTG name */
const COLOR_COMBO_NAMES: Record<string, string> = {
  W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless',
  // Guilds
  WU: 'Azorius', WB: 'Orzhov', WR: 'Boros', WG: 'Selesnya',
  UB: 'Dimir', UR: 'Izzet', UG: 'Simic',
  BR: 'Rakdos', BG: 'Golgari',
  RG: 'Gruul',
  // Shards & Wedges
  WUB: 'Esper', WUR: 'Jeskai', WUG: 'Bant',
  WBR: 'Mardu', WBG: 'Abzan', WRG: 'Naya',
  UBR: 'Grixis', UBG: 'Sultai', URG: 'Temur',
  BRG: 'Jund',
  // Four-color (Nephilim)
  WUBR: 'Yore-Tiller', WUBG: 'Witch-Maw', WURG: 'Ink-Treader', WBRG: 'Dune-Brood', UBRG: 'Glint-Eye',
  // Five-color
  WUBRG: 'Five-Color',
};

const WUBRG_ORDER = 'WUBRGC';

function getColorFilterLabel(colors: Set<string>): string {
  if (colors.size === 0) return 'Top';
  const sorted = [...colors].sort((a, b) => WUBRG_ORDER.indexOf(a) - WUBRG_ORDER.indexOf(b)).join('');
  const name = COLOR_COMBO_NAMES[sorted];
  return name ? `Top ${name}` : 'Top';
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

  // Suggestion tab: 'edhrec' or 'popular'
  const [suggestionTab, setSuggestionTab] = useState<'edhrec' | 'popular'>('edhrec');
  const [colorFilter, setColorFilter] = useState<Set<string>>(new Set());
  const [popularCommanders, setPopularCommanders] = useState<{ name: string; count: number }[]>([]);
  const [popularLoading, setPopularLoading] = useState(false);

  // Fetch top commanders from EDHREC based on color filter
  const [edhrecCommanders, setEdhrecCommanders] = useState<import('@/types').EDHRECTopCommander[]>([]);
  const [edhrecLoading, setEdhrecLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEdhrecLoading(true);
    fetchTopCommanders([...colorFilter]).then(data => {
      if (!cancelled) setEdhrecCommanders(data);
    }).catch(() => {
      if (!cancelled) setEdhrecCommanders([]);
    }).finally(() => {
      if (!cancelled) setEdhrecLoading(false);
    });
    return () => { cancelled = true; };
  }, [colorFilter]);

  // Fetch popular commanders from analytics
  useEffect(() => {
    if (suggestionTab !== 'popular' || popularCommanders.length > 0) return;
    setPopularLoading(true);
    fetchMetrics({ action: 'summary' })
      .then((data) => {
        const counts = (data as { commanderCounts?: Record<string, number> }).commanderCounts ?? {};
        const sorted = Object.entries(counts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 12)
          .map(([name, count]) => ({ name, count }));
        setPopularCommanders(sorted);
      })
      .catch(() => setPopularCommanders([]))
      .finally(() => setPopularLoading(false));
  }, [suggestionTab, popularCommanders.length]);

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
        trackEvent('commander_searched', { query, resultCount: searchResults.length });
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
    trackEvent('commander_selected', {
      commanderName: card.name,
      colorIdentity: card.color_identity,
      hasPartner: false,
    });
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
            // Show EDHREC or Popular commanders
            <>
              {suggestionTab === 'edhrec' ? (
                <>
                  <p className="text-muted-foreground">
                    {getColorFilterLabel(colorFilter)} commanders on EDHREC:
                  </p>

                  {/* Color filter */}
                  <div className="flex justify-center gap-1.5 mb-1.5">
                    {(['W', 'U', 'B', 'R', 'G', 'C'] as const).map(color => (
                      <button
                        key={color}
                        onClick={() => setColorFilter(prev => {
                          const next = new Set(prev);
                          if (next.has(color)) {
                            next.delete(color);
                          } else {
                            next.add(color);
                            // Colorless and colors are mutually exclusive
                            if (color === 'C') {
                              next.forEach(c => { if (c !== 'C') next.delete(c); });
                            } else {
                              next.delete('C');
                            }
                          }
                          return next;
                        })}
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                          colorFilter.has(color)
                            ? 'ring-2 ring-primary ring-offset-2 ring-offset-background scale-110'
                            : 'opacity-50 hover:opacity-80'
                        }`}
                        title={color === 'C' ? 'Colorless' : color}
                      >
                        <i className={`ms ms-${color.toLowerCase()} ms-cost text-lg`} />
                      </button>
                    ))}
                    <button
                      onClick={() => setColorFilter(new Set())}
                      className={`text-xs text-muted-foreground hover:text-foreground transition-all duration-200 self-center overflow-hidden whitespace-nowrap ${colorFilter.size > 0 ? 'opacity-100 max-w-[3rem] ml-1' : 'opacity-0 max-w-0 ml-0'}`}
                    >
                      Clear
                    </button>
                  </div>

                  {edhrecCommanders.length > 0 ? (
                    <div className={`relative flex flex-wrap justify-center gap-2 transition-opacity ${edhrecLoading ? 'opacity-40' : ''}`}>
                      {edhrecLoading && (
                        <div className="absolute inset-0 flex items-center justify-center z-10">
                          <Loader2 className="w-5 h-5 animate-spin text-primary" />
                        </div>
                      )}
                      {edhrecCommanders.filter(c => !c.name.includes('//')).map((commander, i) => (
                        <button
                          key={commander.sanitized}
                          onClick={() => setQuery(commander.name)}
                          className="animate-chip-in flex items-center gap-1.5 px-3 py-1.5 bg-accent/50 backdrop-blur-sm rounded-full text-sm text-muted-foreground hover:bg-primary/20 hover:text-primary transition-colors cursor-pointer"
                          style={{ animationDelay: `${i * 40}ms` }}
                        >
                          <ColorIdentity colors={commander.colorIdentity.length > 0 ? commander.colorIdentity : ['C']} size="sm" />
                          <span>{commander.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : edhrecLoading ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No commanders found
                    </p>
                  )}

                  <button
                    onClick={() => setSuggestionTab('popular')}
                    className="mt-4 text-xs text-muted-foreground/60 hover:text-primary transition-colors"
                  >
                    or see popular on this site &rarr;
                  </button>
                </>
              ) : (
                <>
                  <p className="text-muted-foreground mb-3">
                    Popular on this site:
                  </p>

                  {popularLoading ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    </div>
                  ) : popularCommanders.length > 0 ? (
                    <div className="flex flex-wrap justify-center gap-2">
                      {popularCommanders.map((commander) => (
                        <button
                          key={commander.name}
                          onClick={() => setQuery(commander.name)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/50 backdrop-blur-sm rounded-full text-sm text-muted-foreground hover:bg-primary/20 hover:text-primary transition-colors cursor-pointer"
                        >
                          <span>{commander.name}</span>
                          <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full">
                            {commander.count}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No deck data yet — generate some decks first!
                    </p>
                  )}

                  <button
                    onClick={() => setSuggestionTab('edhrec')}
                    className="mt-4 text-xs text-muted-foreground/60 hover:text-primary transition-colors"
                  >
                    &larr; back to EDHREC top
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
