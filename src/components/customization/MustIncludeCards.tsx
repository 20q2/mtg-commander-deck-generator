import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useStore } from '@/store';
import { searchCards, getCardImageUrl, getCardsByNames } from '@/services/scryfall/client';
import type { ScryfallCard } from '@/types';
import { CardTypeIcon } from '@/components/ui/mtg-icons';
import { Search, Loader2, X, Trash2, Plus, ChevronRight, Ban } from 'lucide-react';
import { Link } from 'react-router-dom';
import { UserListChips } from '@/components/lists/UserListChips';
import { useUserLists } from '@/hooks/useUserLists';

const CARD_TYPES = ['Battle', 'Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land'];

export function MustIncludeCards() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set());

  const { customization, updateCustomization, colorIdentity } = useStore();
  const mustIncludeCards = customization.mustIncludeCards;
  const bannedCards = customization.bannedCards;
  const banLists = customization.banLists || [];
  const arenaOnly = customization.arenaOnly;
  const appliedIncludeLists = customization.appliedIncludeLists || [];
  const { lists: userLists } = useUserLists();

  // Build a set of all cards on any stored ban list (for marking in search results)
  const banListCardNames = useMemo(() => {
    const names = new Set<string>();
    for (const list of banLists) {
      list.cards.forEach(c => names.add(c.toLowerCase()));
    }
    return names;
  }, [banLists]);

  // Ref for positioning the search dropdown via portal
  const searchWrapperRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const updateDropdownPos = useCallback(() => {
    if (searchWrapperRef.current) {
      const rect = searchWrapperRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, []);

  // Track card name → primary type for grouping
  const [typeMap, setTypeMap] = useState<Record<string, string>>({});
  const fetchingRef = useRef(false);

  // Fetch type info for cards not yet in the typeMap
  useEffect(() => {
    const missing = mustIncludeCards.filter(name => !(name in typeMap));
    if (missing.length === 0 || fetchingRef.current) return;
    fetchingRef.current = true;
    getCardsByNames(missing).then(cardMap => {
      const updates: Record<string, string> = {};
      for (const [name, card] of cardMap) {
        const typeLine = card.type_line?.toLowerCase() ?? '';
        updates[name] = CARD_TYPES.find(t => typeLine.includes(t.toLowerCase())) ?? 'Other';
      }
      // Mark any names not returned by Scryfall as 'Other'
      for (const name of missing) {
        if (!updates[name]) updates[name] = 'Other';
      }
      setTypeMap(prev => ({ ...prev, ...updates }));
    }).catch(() => {
      // Silently fail — cards just won't be grouped
    }).finally(() => { fetchingRef.current = false; });
  }, [mustIncludeCards, typeMap]);

  // Group cards by type
  const groupedCards = useMemo(() => {
    const groups: Record<string, string[]> = {};
    for (const name of mustIncludeCards) {
      const type = typeMap[name] ?? 'Other';
      (groups[type] ??= []).push(name);
    }
    // Sort groups by CARD_TYPES order, Other last
    const sorted: [string, string[]][] = [];
    for (const type of CARD_TYPES) {
      if (groups[type]) sorted.push([type, groups[type]]);
    }
    if (groups['Other']) sorted.push(['Other', groups['Other']]);
    return sorted;
  }, [mustIncludeCards, typeMap]);

  // Total included count (manual + applied user lists)
  const totalIncluded = useMemo(() => {
    const all = new Set(mustIncludeCards);
    for (const ref of appliedIncludeLists) {
      if (ref.enabled) {
        const list = userLists.find(l => l.id === ref.listId);
        if (list) list.cards.forEach(c => all.add(c));
      }
    }
    return all.size;
  }, [mustIncludeCards, appliedIncludeLists, userLists]);

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
        const arenaQuery = arenaOnly ? `${query} game:arena` : query;
        const searchResults = await searchCards(arenaQuery, colorIdentity, { order: 'edhrec', skipFormatFilter: true });
        // Filter out already included cards and banned cards
        const filtered = searchResults.data.filter(
          card => !mustIncludeCards.includes(card.name) && !bannedCards.includes(card.name)
        );
        setResults(filtered.slice(0, 8));
        updateDropdownPos();
        setShowResults(true);
      } catch (error) {
        console.error('Search error:', error);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, colorIdentity, mustIncludeCards, bannedCards, arenaOnly]);

  const handleAddCard = (card: ScryfallCard) => {
    if (!mustIncludeCards.includes(card.name)) {
      updateCustomization({
        mustIncludeCards: [...mustIncludeCards, card.name],
      });
      // Capture type info immediately from search result
      const typeLine = card.type_line?.toLowerCase() ?? '';
      const type = CARD_TYPES.find(t => typeLine.includes(t.toLowerCase())) ?? 'Other';
      setTypeMap(prev => ({ ...prev, [card.name]: type }));
    }
    setQuery('');
    setResults([]);
    setShowResults(false);
  };

  const handleRemoveCard = (cardName: string) => {
    updateCustomization({
      mustIncludeCards: mustIncludeCards.filter(name => name !== cardName),
    });
  };

  const handleClearAll = () => {
    updateCustomization({ mustIncludeCards: [] });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Must Include Cards</label>
          {totalIncluded > 0 && (
            <span className="text-xs text-muted-foreground">
              ({totalIncluded})
            </span>
          )}
        </div>
        {mustIncludeCards.length > 0 && (
          <button
            onClick={handleClearAll}
            className="p-1.5 rounded-md text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Clear all"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Search Input */}
      <div className="relative" ref={searchWrapperRef}>
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search cards to include..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { updateDropdownPos(); results.length > 0 && setShowResults(true); }}
          className="pl-9 pr-9 h-9 text-sm rounded-lg"
        />
        {isSearching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-primary" />
        )}

        {/* Search Results Dropdown — rendered via portal to escape overflow-hidden */}
        {showResults && results.length > 0 && dropdownPos && createPortal(
          <>
            <div
              className="fixed inset-0 z-[998]"
              onClick={() => setShowResults(false)}
            />
            <Card
              className="fixed z-[999] max-h-[250px] overflow-auto shadow-xl"
              style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
            >
              <CardContent className="p-1">
                {results.map((card) => {
                  const isBanned = banListCardNames.has(card.name.toLowerCase());
                  return (
                    <button
                      key={card.id}
                      onClick={() => handleAddCard(card)}
                      className="w-full flex items-center gap-3 p-2 hover:bg-accent/50 rounded-md text-left transition-colors group"
                    >
                      <img
                        src={getCardImageUrl(card, 'small')}
                        alt={card.name}
                        className="w-8 h-auto rounded shadow"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium truncate group-hover:text-emerald-500 transition-colors">
                            {card.name}
                          </p>
                          {isBanned && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-semibold rounded bg-red-500/15 text-red-500 border border-red-500/25 shrink-0">
                              <Ban className="w-2.5 h-2.5" />
                              Banned
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {card.type_line}
                        </p>
                      </div>
                      <Plus className="w-4 h-4 text-muted-foreground group-hover:text-emerald-500 transition-colors" />
                    </button>
                  );
                })}
              </CardContent>
            </Card>
          </>,
          document.body
        )}
      </div>

      {/* Must Include Cards List — grouped by type */}
      {mustIncludeCards.length > 0 && (
        <div className="relative space-y-2">
          {groupedCards.length > 1 && (
            <div className="absolute right-0 top-0 flex gap-2">
              <button
                onClick={() => setCollapsedTypes(new Set())}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Expand all
              </button>
              <button
                onClick={() => setCollapsedTypes(new Set(groupedCards.map(([type]) => type)))}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Collapse all
              </button>
            </div>
          )}
          {groupedCards.map(([type, cards]) => {
            const isCollapsed = collapsedTypes.has(type);
            return (
              <div key={type}>
                <button
                  onClick={() => setCollapsedTypes(prev => {
                    const next = new Set(prev);
                    next.has(type) ? next.delete(type) : next.add(type);
                    return next;
                  })}
                  className="flex items-center gap-1 mb-1 group cursor-pointer select-none"
                >
                  <ChevronRight className={`w-3 h-3 text-muted-foreground/60 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
                  <CardTypeIcon type={type} size="sm" className="text-emerald-400/60" />
                  <span className="text-[11px] text-muted-foreground font-medium group-hover:text-foreground transition-colors">{type}</span>
                  <span className="text-[10px] text-muted-foreground/60">{cards.length}</span>
                </button>
                {!isCollapsed && (
                  <div className="flex flex-wrap gap-1 ml-4">
                    {cards.map((cardName) => (
                      <span
                        key={cardName}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] rounded border border-emerald-500/20"
                      >
                        <span className="truncate max-w-[150px]">{cardName}</span>
                        <button
                          onClick={() => handleRemoveCard(cardName)}
                          className="hover:bg-emerald-500/20 rounded p-0.5 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {mustIncludeCards.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Search cards to include{userLists.length > 0
            ? ', or import a List below'
            : <>, or <Link to="/lists" className="text-primary hover:text-primary/80 transition-colors">create a list</Link> to import</>
          }
        </p>
      )}

      {/* User Lists as Must-Includes */}
      <UserListChips mode="include" />
    </div>
  );
}
