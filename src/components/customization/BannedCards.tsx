import { useState, useEffect, useMemo, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useStore } from '@/store';
import { searchCards, getCardImageUrl, getCardsByNames } from '@/services/scryfall/client';
import type { ScryfallCard } from '@/types';
import { CardTypeIcon } from '@/components/ui/mtg-icons';
import { Search, Loader2, X, Trash2, ChevronRight, Ban, ListPlus, Check, Shield, Info, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { UserListChips, PRESET_BAN_LISTS } from '@/components/lists/UserListChips';
import { useUserLists } from '@/hooks/useUserLists';
import { getBanList } from '@/services/scryfall/client';
import type { BanList } from '@/types';

const CARD_TYPES = ['Battle', 'Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land'];

const ALWAYS_ACTIVE_ID = 'rc-banlist';

function BanListPickerContent({ banLists, appliedExcludeLists, userLists, listPickerSearch, setListPickerSearch, onTogglePreset, onToggleBanList, onToggleUserList }: {
  banLists: BanList[];
  appliedExcludeLists: { listId: string; enabled: boolean }[];
  userLists: { id: string; name: string; cards: string[] }[];
  listPickerSearch: string;
  setListPickerSearch: (v: string) => void;
  onTogglePreset: (id: string) => void;
  onToggleBanList: (id: string) => void;
  onToggleUserList: (id: string) => void;
}) {
  const ALWAYS_ACTIVE = 'rc-banlist';
  const presets = PRESET_BAN_LISTS.filter(p => p.id !== ALWAYS_ACTIVE);
  const customBans = banLists.filter(l => !PRESET_BAN_LISTS.some(p => p.id === l.id));
  const allItems = [
    ...presets.map(p => ({ id: p.id, name: p.name, count: banLists.find(l => l.id === p.id)?.cards.length ?? 0, enabled: banLists.find(l => l.id === p.id)?.enabled ?? false, kind: 'preset' as const })),
    ...customBans.map(l => ({ id: l.id, name: l.name, count: l.cards.length, enabled: l.enabled, kind: 'banlist' as const })),
    ...userLists.map(l => ({ id: l.id, name: l.name, count: l.cards.length, enabled: appliedExcludeLists.find(r => r.listId === l.id)?.enabled ?? false, kind: 'userlist' as const })),
  ];
  const filtered = listPickerSearch
    ? allItems.filter(i => i.name.toLowerCase().includes(listPickerSearch.toLowerCase()))
    : allItems;
  return (
    <>
      {/* Commander Bans — always active, non-toggleable */}
      <div className="px-3 py-2 text-sm flex items-center gap-2 opacity-70 cursor-default">
        <Shield className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        <span className="flex-1">Commander Bans</span>
        <span className="text-[10px] text-amber-500 shrink-0">Always active</span>
        <span className="relative group/info">
          <Info className="w-3 h-3 text-muted-foreground cursor-help" />
          <span className="absolute bottom-full mb-1 right-0 w-48 px-2 py-1 text-[10px] text-muted-foreground bg-popover border border-border rounded shadow-lg opacity-0 pointer-events-none group-hover/info:opacity-100 transition-opacity leading-tight">
            EDHREC data already excludes banned cards, so this is always in effect
          </span>
        </span>
      </div>
      <div className="border-t border-border my-1" />
      {allItems.length >= 5 && (
        <div className="px-2 pt-1 pb-1">
          <input
            type="text"
            placeholder="Search lists..."
            value={listPickerSearch}
            onChange={e => setListPickerSearch(e.target.value)}
            className="w-full px-2 py-1 text-xs bg-muted/50 border border-border rounded focus:outline-none focus:border-primary"
            autoFocus
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
      <div className="overflow-y-auto">
        {filtered.map(item => (
          <button
            key={item.id}
            onClick={() => {
              if (item.kind === 'preset') onTogglePreset(item.id);
              else if (item.kind === 'banlist') onToggleBanList(item.id);
              else onToggleUserList(item.id);
            }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2"
          >
            {item.kind === 'preset' ? <Shield className="w-3.5 h-3.5 text-amber-500 shrink-0" /> : <ListPlus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
            <span className="truncate flex-1">{item.name}</span>
            {item.count > 0 && <span className="text-[10px] text-muted-foreground shrink-0">({item.count})</span>}
            {item.enabled && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">No matching lists</p>
        )}
      </div>
    </>
  );
}

export function BannedCards() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('banned-collapsedTypes');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  useEffect(() => {
    localStorage.setItem('banned-collapsedTypes', JSON.stringify([...collapsedTypes]));
  }, [collapsedTypes]);

  const { customization, updateCustomization, colorIdentity } = useStore();
  const bannedCards = customization.bannedCards;
  const banLists = customization.banLists || [];
  const arenaOnly = customization.arenaOnly;
  const appliedExcludeLists = customization.appliedExcludeLists || [];
  const { lists: allUserLists } = useUserLists();
  const userLists = useMemo(() => allUserLists.filter(l => l.type !== 'deck'), [allUserLists]);

  const [showListPicker, setShowListPicker] = useState(false);
  const [listPickerSearch, setListPickerSearch] = useState('');

  const handlePickerTogglePreset = async (presetId: string) => {
    const preset = PRESET_BAN_LISTS.find(p => p.id === presetId);
    if (!preset) return;
    const existing = banLists.find(l => l.id === preset.id);
    if (existing && existing.cards.length > 0) {
      updateCustomization({ banLists: banLists.map(l => l.id === preset.id ? { ...l, enabled: !l.enabled } : l) });
      return;
    }
    try {
      const cards = await getBanList(preset.scryfallFormat);
      const newList: BanList = { id: preset.id, name: preset.name, cards, isPreset: true, enabled: true };
      updateCustomization({ banLists: existing ? banLists.map(l => l.id === preset.id ? newList : l) : [...banLists, newList] });
    } catch (err) {
      console.error(`Failed to fetch ${preset.name}:`, err);
    }
  };

  const handlePickerToggleUserList = (listId: string) => {
    const existing = appliedExcludeLists.find(r => r.listId === listId);
    if (existing) {
      updateCustomization({ appliedExcludeLists: appliedExcludeLists.map(r => r.listId === listId ? { ...r, enabled: !r.enabled } : r) });
    } else {
      updateCustomization({ appliedExcludeLists: [...appliedExcludeLists, { listId, enabled: true }] });
    }
  };

  // Build a set of all cards on any stored ban list (for marking in search results)
  const banListCardNames = useMemo(() => {
    const names = new Set<string>();
    for (const list of banLists) {
      list.cards.forEach(c => names.add(c.toLowerCase()));
    }
    return names;
  }, [banLists]);


  // Track card name → primary type for grouping
  const [typeMap, setTypeMap] = useState<Record<string, string>>({});
  const fetchingRef = useRef(false);

  // Fetch type info for cards not yet in the typeMap
  useEffect(() => {
    const missing = bannedCards.filter(name => !(name in typeMap));
    if (missing.length === 0 || fetchingRef.current) return;
    fetchingRef.current = true;
    getCardsByNames(missing).then(cardMap => {
      const updates: Record<string, string> = {};
      for (const [name, card] of cardMap) {
        const typeLine = card.type_line?.toLowerCase() ?? '';
        updates[name] = CARD_TYPES.find(t => typeLine.includes(t.toLowerCase())) ?? 'Other';
      }
      for (const name of missing) {
        if (!updates[name]) updates[name] = 'Other';
      }
      setTypeMap(prev => ({ ...prev, ...updates }));
    }).catch(() => {
      // Silently fail — cards just won't be grouped
    }).finally(() => { fetchingRef.current = false; });
  }, [bannedCards, typeMap]);

  // Group cards by type
  const groupedCards = useMemo(() => {
    const groups: Record<string, string[]> = {};
    for (const name of bannedCards) {
      const type = typeMap[name] ?? 'Other';
      (groups[type] ??= []).push(name);
    }
    const sorted: [string, string[]][] = [];
    for (const type of CARD_TYPES) {
      if (groups[type]) sorted.push([type, groups[type]]);
    }
    if (groups['Other']) sorted.push(['Other', groups['Other']]);
    return sorted;
  }, [bannedCards, typeMap]);

  // Total excluded count (manual + enabled ban lists + applied user lists)
  // Excludes the Commander ban list since EDHRec already filters those cards
  const totalExcluded = useMemo(() => {
    const all = new Set(bannedCards);
    for (const list of banLists) {
      if (list.enabled && list.id !== ALWAYS_ACTIVE_ID) list.cards.forEach(c => all.add(c));
    }
    for (const ref of appliedExcludeLists) {
      if (ref.enabled) {
        const list = userLists.find(l => l.id === ref.listId);
        if (list) list.cards.forEach(c => all.add(c));
      }
    }
    return all.size;
  }, [bannedCards, banLists, appliedExcludeLists, userLists]);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const arenaQuery = arenaOnly ? `${query} game:arena` : query;
        const searchResults = await searchCards(arenaQuery, colorIdentity, { order: 'edhrec', skipFormatFilter: true });
        const filtered = searchResults.data.filter(
          card => !bannedCards.includes(card.name)
        );
        setResults(filtered.slice(0, 8));
        setShowResults(true);
      } catch {
        setResults([]);
        setShowResults(true);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, colorIdentity, bannedCards, arenaOnly]);

  const handleBanCard = (card: ScryfallCard) => {
    if (!bannedCards.includes(card.name)) {
      updateCustomization({
        bannedCards: [...bannedCards, card.name],
      });
      const typeLine = card.type_line?.toLowerCase() ?? '';
      const type = CARD_TYPES.find(t => typeLine.includes(t.toLowerCase())) ?? 'Other';
      setTypeMap(prev => ({ ...prev, [card.name]: type }));
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

  const handleClearAll = () => {
    updateCustomization({ bannedCards: [] });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Excluded Cards</label>
          {totalExcluded > 0 && (
            <span className="text-xs text-muted-foreground">
              ({totalExcluded})
            </span>
          )}
        </div>
        {bannedCards.length > 0 && (
          <button
            onClick={handleClearAll}
            className="p-1.5 rounded-md text-xs text-red-400/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Clear manual exclusions"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Search Input + List Picker */}
      <div className="flex gap-1.5">
        <Popover open={showResults && (results.length > 0 || (query.trim().length > 0 && !isSearching))} onOpenChange={(open) => { if (!open) setShowResults(false); }}>
          <PopoverTrigger asChild>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search cards to exclude..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => { results.length > 0 && setShowResults(true); }}
                className="pl-9 pr-9 h-9 text-sm rounded-lg"
              />
              {isSearching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-primary" />
              )}
            </div>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-1 max-h-[250px] overflow-auto">
            {results.length === 0 && query.trim() && !isSearching && (
              <p className="px-3 py-2.5 text-xs text-muted-foreground text-center">
                No valid cards found for your commander matching "{query.trim()}"
              </p>
            )}
            {results.map((card) => {
              const isBanned = banListCardNames.has(card.name.toLowerCase());
              return (
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
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium truncate group-hover:text-destructive transition-colors">
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
                  <Plus className="w-4 h-4 text-muted-foreground group-hover:text-destructive transition-colors" />
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
        <Popover open={showListPicker} onOpenChange={(open) => { setShowListPicker(open); if (!open) setListPickerSearch(''); }}>
          <PopoverTrigger asChild>
            <button
              className="h-9 w-9 flex items-center justify-center rounded-lg border-2 border-input transition-colors focus:outline-none focus-visible:ring-0 hover:bg-accent text-muted-foreground"
              title="Apply a list or ban list"
            >
              <ListPlus className="w-4 h-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 py-1 max-h-72 flex flex-col">
            <BanListPickerContent
              banLists={banLists}
              appliedExcludeLists={appliedExcludeLists}
              userLists={userLists}
              listPickerSearch={listPickerSearch}
              setListPickerSearch={setListPickerSearch}
              onTogglePreset={handlePickerTogglePreset}
              onToggleBanList={(id) => updateCustomization({ banLists: banLists.map(l => l.id === id ? { ...l, enabled: !l.enabled } : l) })}
              onToggleUserList={handlePickerToggleUserList}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Banned Cards List — grouped by type */}
      {bannedCards.length > 0 && (
        <div className="relative space-y-2">
          {groupedCards.length > 1 && (
            <div className="absolute right-0 top-0 flex gap-2">
              {collapsedTypes.size === groupedCards.length ? (
                <button
                  onClick={() => setCollapsedTypes(new Set())}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Expand all
                </button>
              ) : (
                <button
                  onClick={() => setCollapsedTypes(new Set(groupedCards.map(([type]) => type)))}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Collapse all
                </button>
              )}
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
                  <CardTypeIcon type={type} size="sm" className="text-red-400/60" />
                  <span className="text-[11px] text-muted-foreground font-medium group-hover:text-foreground transition-colors">{type}</span>
                  <span className="text-[10px] text-muted-foreground/60">{cards.length}</span>
                </button>
                {!isCollapsed && (
                  <div className="flex flex-wrap gap-1 ml-4">
                    {cards.map((cardName) => (
                      <button
                        key={cardName}
                        onClick={() => handleUnbanCard(cardName)}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-destructive/10 text-destructive text-[10px] rounded border border-destructive/20 hover:bg-destructive/25 hover:border-destructive/40 transition-colors cursor-pointer"
                        title={`Remove "${cardName}" from exclusions`}
                      >
                        <span className="truncate max-w-[150px]">{cardName}</span>
                        <X className="w-3 h-3 opacity-60" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {bannedCards.length === 0 && banLists.filter(l => l.enabled).length === 0 && !appliedExcludeLists.some(r => r.enabled) && (
        <p className="text-xs text-muted-foreground">
          Search cards to exclude{userLists.length > 0
            ? ', or import a List'
            : <>, or <Link to="/lists" className="text-primary hover:text-primary/80 transition-colors">create a list</Link> to import</>
          }
        </p>
      )}

      {/* Lists (ban lists + user lists) */}
      <UserListChips mode="exclude" />
    </div>
  );
}
