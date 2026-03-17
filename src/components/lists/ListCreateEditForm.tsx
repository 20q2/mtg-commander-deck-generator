import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { searchCards, searchCommanders, searchValidPartners, getCardImageUrl } from '@/services/scryfall/client';
import { CollectionImporter } from '@/components/collection/CollectionImporter';
import { CommanderIcon } from '@/components/ui/mtg-icons';
import { getPartnerType, getPartnerTypeLabel } from '@/lib/partnerUtils';
import type { ScryfallCard, UserCardList } from '@/types';
import { Search, Loader2, X, Plus, ArrowLeft, Trash2 } from 'lucide-react';

function getArtCropUrl(card: ScryfallCard | null): string | null {
  if (!card) return null;
  if (card.image_uris?.art_crop) return card.image_uris.art_crop;
  if (card.card_faces?.[0]?.image_uris?.art_crop) return card.card_faces[0].image_uris.art_crop;
  if (card.image_uris?.normal) return card.image_uris.normal;
  return null;
}

interface ListCreateEditFormProps {
  existingList?: UserCardList | null;
  onSave: (name: string, cards: string[], description: string, commanderOptions?: { commanderName?: string; partnerCommanderName?: string }) => void;
  onCancel: () => void;
}

export function ListCreateEditForm({ existingList, onSave, onCancel }: ListCreateEditFormProps) {
  const [name, setName] = useState(existingList?.name ?? '');
  const [description, setDescription] = useState(existingList?.description ?? '');
  const [cards, setCards] = useState<string[]>(existingList?.cards ?? []);

  // Commander state
  const [commanderName, setCommanderName] = useState(existingList?.commanderName ?? '');
  const [commanderCard, setCommanderCard] = useState<ScryfallCard | null>(null);
  const [partnerCommanderName, setPartnerCommanderName] = useState(existingList?.partnerCommanderName ?? '');
  const [commanderQuery, setCommanderQuery] = useState('');
  const [commanderResults, setCommanderResults] = useState<ScryfallCard[]>([]);
  const [isSearchingCommander, setIsSearchingCommander] = useState(false);
  const [showCommanderResults, setShowCommanderResults] = useState(false);
  const [commanderSearchedQuery, setCommanderSearchedQuery] = useState('');
  const [commanderField, setCommanderField] = useState<'commander' | 'partner'>('commander');
  const commanderSearchRef = useRef<HTMLDivElement>(null);

  // Derive partner eligibility from the selected commander card
  const partnerType = commanderCard ? getPartnerType(commanderCard) : 'none';
  const canPartner = partnerType !== 'none';

  // Human-readable search placeholder for each partner type
  const partnerSearchPlaceholder = (() => {
    switch (partnerType) {
      case 'partner': return 'Search for a partner commander (optional)...';
      case 'partner-with': return 'Search for the designated partner...';
      case 'friends-forever': return 'Search for a friends forever partner (optional)...';
      case 'choose-background': return 'Search for a background (optional)...';
      case 'background': return 'Search for a commander (optional)...';
      case 'doctors-companion': return 'Search for a doctor (optional)...';
      case 'doctor': return "Search for a doctor's companion (optional)...";
      default: return 'Search for a partner (optional)...';
    }
  })();

  // Search state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState('');

  const nameInputRef = useRef<HTMLInputElement>(null);
  const searchWrapperRef = useRef<HTMLDivElement>(null);
  const isEditing = !!existingList;

  // Auto-focus name field on create
  useEffect(() => {
    if (!isEditing) {
      nameInputRef.current?.focus();
    }
  }, [isEditing]);

  // Debounced commander search
  useEffect(() => {
    if (!commanderQuery.trim()) {
      setCommanderResults([]);
      setCommanderSearchedQuery('');
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearchingCommander(true);
      try {
        let results: ScryfallCard[];
        if (commanderField === 'partner' && commanderCard) {
          // Use searchValidPartners to only show valid partner options
          results = await searchValidPartners(commanderCard, commanderQuery);
        } else {
          results = await searchCommanders(commanderQuery);
        }
        setCommanderResults(results.slice(0, 8));
        setCommanderSearchedQuery(commanderQuery);
        setShowCommanderResults(true);
      } catch {
        setCommanderResults([]);
        setCommanderSearchedQuery(commanderQuery);
      } finally {
        setIsSearchingCommander(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [commanderQuery, commanderField, commanderCard]);

  const handleSelectCommander = (card: ScryfallCard) => {
    if (commanderField === 'commander') {
      // Remove old commander from cards if present
      if (commanderName) {
        setCards(prev => prev.filter(c => c !== commanderName));
      }
      // Remove old partner too since commander changed
      if (partnerCommanderName) {
        setCards(prev => prev.filter(c => c !== partnerCommanderName));
      }
      setCommanderName(card.name);
      setCommanderCard(card);
      setPartnerCommanderName('');
      // Add new commander to cards
      setCards(prev => prev.includes(card.name) ? prev : [card.name, ...prev]);
    } else {
      // Remove old partner from cards if present
      if (partnerCommanderName) {
        setCards(prev => prev.filter(c => c !== partnerCommanderName));
      }
      setPartnerCommanderName(card.name);
      // Add partner to cards
      setCards(prev => prev.includes(card.name) ? prev : [card.name, ...prev]);
    }
    setCommanderQuery('');
    setCommanderResults([]);
    setShowCommanderResults(false);
  };

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearchedQuery('');
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const searchResults = await searchCards(query, [], { order: 'edhrec' });
        const filtered = searchResults.data.filter(card => !cards.includes(card.name));
        setResults(filtered.slice(0, 8));
        setSearchedQuery(query);
        setShowResults(true);
      } catch {
        setResults([]);
        setSearchedQuery(query);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, cards]);

  const handleAddCard = (card: ScryfallCard) => {
    if (!cards.includes(card.name)) {
      setCards(prev => [...prev, card.name]);
    }
    setQuery('');
    setResults([]);
    setShowResults(false);
  };

  const handleRemoveCard = (cardName: string) => {
    setCards(prev => prev.filter(n => n !== cardName));
  };

  // Auto-set commander when *CMDR* marker is detected during import
  const handleCommanderDetected = useCallback((card: ScryfallCard) => {
    // Only auto-set if no commander is currently selected
    if (commanderName) return;
    setCommanderName(card.name);
    setCommanderCard(card);
  }, [commanderName]);

  // Auto-fill name/description from detected metadata (e.g. MTGGoldfish format)
  const handleMetaDetected = useCallback((meta: { deckName?: string }) => {
    if (meta.deckName) {
      setName(prev => prev || meta.deckName!);
    }
  }, []);

  // Use a ref to always have the latest cards for the import callback
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const handleImportCards = useCallback((validatedNames: string[]) => {
    const current = cardsRef.current;
    const newCards: string[] = [];
    let dupeCount = 0;

    // Count how many of each card already exist in the list
    const currentCounts = new Map<string, number>();
    for (const name of current) {
      currentCounts.set(name, (currentCounts.get(name) ?? 0) + 1);
    }
    // Count how many of each card are being imported
    const importCounts = new Map<string, number>();
    for (const name of validatedNames) {
      importCounts.set(name, (importCounts.get(name) ?? 0) + 1);
    }

    for (const [cardName, importQty] of importCounts) {
      const existingQty = currentCounts.get(cardName) ?? 0;
      const toAdd = Math.max(0, importQty - existingQty);
      if (toAdd > 0) {
        for (let i = 0; i < toAdd; i++) {
          newCards.push(cardName);
        }
      }
      const skipped = importQty - toAdd;
      if (skipped > 0) dupeCount += skipped;
    }

    if (newCards.length > 0) {
      setCards(prev => [...prev, ...newCards]);
    }

    return { added: newCards.length, updated: dupeCount };
  }, []);

  const handleClearAll = () => {
    setCards([]);
  };

  const handleSave = () => {
    if (!name.trim() || cards.length === 0) return;
    const cmdOptions = (commanderName || partnerCommanderName)
      ? { commanderName: commanderName || undefined, partnerCommanderName: partnerCommanderName || undefined }
      : undefined;
    onSave(name.trim(), cards, description.trim(), cmdOptions);
  };

  // No results: searched but got 0 results and not currently searching
  const showNoResults = showResults && results.length === 0 && searchedQuery.trim() && !isSearching;

  // Commander art background
  const artUrl = useMemo(() => getArtCropUrl(commanderCard), [commanderCard]);
  const [artLoaded, setArtLoaded] = useState(false);
  useEffect(() => { setArtLoaded(false); }, [artUrl]);

  return (
    <div className="space-y-6">
      {/* Commander art background — portal to body so it sits behind all content */}
      {artUrl && createPortal(
        <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
          <div className={`absolute inset-0 transition-all duration-1000 ${artLoaded ? 'opacity-100' : 'opacity-0'}`}>
            <img
              src={artUrl}
              alt=""
              className="w-full h-[70vh] object-cover object-top blur-xl scale-110"
              onLoad={() => setArtLoaded(true)}
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/70 to-background" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/30" />
          <div className="absolute inset-0 bg-background/15" />
          <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center top, transparent 0%, hsl(var(--background)) 70%)' }} />
        </div>,
        document.body
      )}
      {/* Header */}
      <div>
        <button
          onClick={onCancel}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          {isEditing ? 'Back to list' : 'Back to lists'}
        </button>
        <h2 className="text-xl font-bold">{isEditing ? 'Edit List' : 'Create New List'}</h2>
      </div>

      {/* Name & Description */}
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium mb-1.5 block">Name</label>
          <Input
            ref={nameInputRef}
            type="text"
            placeholder="e.g. My Salt List, Staples, Pet Cards..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-10 bg-background"
          />
        </div>
        <div>
          <label className="text-sm font-medium mb-1.5 block">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
          <Input
            type="text"
            placeholder="What is this list for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="h-10 bg-background"
          />
        </div>
      </div>

      {/* Commander (optional) */}
      <div className="space-y-3">
        <label className="text-sm font-medium flex items-center gap-1.5">
          <CommanderIcon size={14} className="text-muted-foreground" />
          Commander <span className="text-muted-foreground font-normal">(optional — set to enable deck features)</span>
        </label>

        {/* Selected commander */}
        {commanderName ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-background rounded-lg border border-border/30">
            <span className="text-sm font-medium flex-1 truncate">{commanderName}</span>
            <button
              onClick={() => {
                // Remove commander and partner from cards list
                setCards(prev => prev.filter(c => c !== commanderName && c !== partnerCommanderName));
                setCommanderName(''); setCommanderCard(null); setPartnerCommanderName('');
              }}
              className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="relative" ref={commanderSearchRef}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search for a commander..."
              value={commanderField === 'commander' ? commanderQuery : ''}
              onChange={(e) => { setCommanderField('commander'); setCommanderQuery(e.target.value); }}
              onFocus={() => { setCommanderField('commander'); (commanderResults.length > 0) && setShowCommanderResults(true); }}
              className="pl-9 pr-9 h-9 text-sm bg-background"
            />
            {isSearchingCommander && commanderField === 'commander' && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-primary" />
            )}
          </div>
        )}

        {/* Partner commander — only show when commander supports partners */}
        {commanderName && canPartner && (
          <>
            {partnerCommanderName ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-background rounded-lg border border-border/30">
                <span className="text-xs text-muted-foreground">{getPartnerTypeLabel(partnerType)}:</span>
                <span className="text-sm font-medium flex-1 truncate">{partnerCommanderName}</span>
                <button
                  onClick={() => { setCards(prev => prev.filter(c => c !== partnerCommanderName)); setPartnerCommanderName(''); }}
                  className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative" ref={commanderSearchRef}>
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder={partnerSearchPlaceholder}
                  value={commanderField === 'partner' ? commanderQuery : ''}
                  onChange={(e) => { setCommanderField('partner'); setCommanderQuery(e.target.value); }}
                  onFocus={() => { setCommanderField('partner'); (commanderResults.length > 0) && setShowCommanderResults(true); }}
                  className="pl-9 pr-9 h-9 text-sm bg-background"
                />
                {isSearchingCommander && commanderField === 'partner' && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-primary" />
                )}
              </div>
            )}
          </>
        )}

        {/* Commander search dropdown — anchored to commanderSearchRef */}
        {showCommanderResults && commanderResults.length > 0 && commanderSearchRef.current && createPortal(
          <>
            <div className="fixed inset-0 z-[998]" onClick={() => setShowCommanderResults(false)} />
            <Card className="absolute top-full left-0 right-0 mt-1 z-[999] max-h-[250px] overflow-auto shadow-xl">
              <CardContent className="p-1">
                {commanderResults.map((card) => (
                  <button
                    key={card.id}
                    onClick={() => handleSelectCommander(card)}
                    className="w-full flex items-center gap-3 p-2 hover:bg-accent/50 rounded-md text-left transition-colors group"
                  >
                    <img
                      src={getCardImageUrl(card, 'small')}
                      alt={card.name}
                      className="w-8 h-auto rounded shadow"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                        {card.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {card.type_line}
                      </p>
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>
          </>,
          commanderSearchRef.current
        )}

        {/* Commander no results */}
        {showCommanderResults && commanderResults.length === 0 && commanderSearchedQuery.trim() && !isSearchingCommander && commanderSearchRef.current && createPortal(
          <>
            <div className="fixed inset-0 z-[998]" onClick={() => setShowCommanderResults(false)} />
            <Card className="absolute top-full left-0 right-0 mt-1 z-[999] shadow-xl">
              <CardContent className="p-4 text-center">
                <p className="text-sm text-muted-foreground">No commanders found for "{commanderSearchedQuery}"</p>
              </CardContent>
            </Card>
          </>,
          commanderSearchRef.current
        )}
      </div>

      {/* Import Cards — shared component */}
      <CollectionImporter
        label="Import Cards"
        onImportCards={handleImportCards}
        onCommanderDetected={handleCommanderDetected}
        onMetaDetected={handleMetaDetected}
        updatedLabel="duplicates skipped"
      />

      {/* Cards */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Cards ({cards.length})</label>
          {cards.length > 0 && (
            <button
              onClick={handleClearAll}
              className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="Clear all cards"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Search input */}
        <div className="relative" ref={searchWrapperRef}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search cards to add..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => { (results.length > 0 || showNoResults) && setShowResults(true); }}
            className="pl-9 pr-9 h-9 text-sm bg-background"
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-primary" />
          )}

          {/* Search Results Dropdown */}
          {showResults && results.length > 0 && (
            <>
              <div className="fixed inset-0 z-[998]" onClick={() => setShowResults(false)} />
              <Card className="absolute top-full left-0 right-0 mt-1 z-[999] max-h-[250px] overflow-auto shadow-xl">
                <CardContent className="p-1">
                  {results.map((card) => (
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
                        <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                          {card.name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {card.type_line}
                        </p>
                      </div>
                      <Plus className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </button>
                  ))}
                </CardContent>
              </Card>
            </>
          )}

          {/* No results state */}
          {showNoResults && (
            <>
              <div className="fixed inset-0 z-[998]" onClick={() => setShowResults(false)} />
              <Card className="absolute top-full left-0 right-0 mt-1 z-[999] shadow-xl">
                <CardContent className="p-4 text-center">
                  <p className="text-sm text-muted-foreground">No cards found for "{searchedQuery}"</p>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* Current cards as chips */}
        {cards.length > 0 && (
          <div className="flex flex-wrap gap-1.5 max-h-60 overflow-auto p-2 bg-background rounded-lg border border-border/30">
            {cards.map((name, idx) => (
              <span
                key={`${name}-${idx}`}
                className="inline-flex items-center gap-1 px-2 py-1 bg-accent/50 text-foreground text-xs rounded-md border border-border/30"
              >
                <span className="truncate max-w-[180px]">{name}</span>
                <button
                  onClick={() => handleRemoveCard(name)}
                  className="hover:bg-destructive/20 rounded p-0.5 transition-colors text-muted-foreground hover:text-destructive"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {cards.length === 0 && (
          <p className="text-xs text-muted-foreground py-4 text-center">
            Search for cards above or import a list to get started
          </p>
        )}
      </div>

      {/* Actions — sticky at bottom */}
      <div className="flex justify-end gap-3 pt-2 border-t border-border/50 sticky bottom-0 bg-background pb-4 -mb-4">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm rounded-lg hover:bg-accent transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!name.trim() || cards.length === 0}
          className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isEditing ? 'Save Changes' : 'Create List'}
        </button>
      </div>
    </div>
  );
}
