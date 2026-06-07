import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { searchCards, searchCommanders, searchValidPartners, getCardImageUrl, getCardsByNames } from '@/services/scryfall/client';
import { CollectionImporter, ImportResultDisplay, type ImportResult, type CollectionImporterHandle } from '@/components/collection/CollectionImporter';
import { CommanderIcon, CardTypeIcon } from '@/components/ui/mtg-icons';
import { getPartnerType, getPartnerTypeLabel } from '@/lib/partnerUtils';
import type { ScryfallCard, UserCardList } from '@/types';
import { Search, Loader2, X, Plus, ArrowLeft, Trash2, Bold, Italic, Heading2, List, ListOrdered, Minus, LayoutGrid, Grid3x3, AlignLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { ListCardGrid, type ListViewMode } from './ListCardGrid';

const CARD_TYPES = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle', 'Land'] as const;

export interface CardMeta {
  type: string;
  imageUrl: string | null;
}

function classifyCardType(typeLine: string): string {
  const lower = typeLine.toLowerCase();
  return CARD_TYPES.find(t => lower.includes(t.toLowerCase())) ?? 'Other';
}

function getArtCropUrl(card: ScryfallCard | null): string | null {
  if (!card) return null;
  if (card.image_uris?.art_crop) return card.image_uris.art_crop;
  if (card.card_faces?.[0]?.image_uris?.art_crop) return card.card_faces[0].image_uris.art_crop;
  if (card.image_uris?.normal) return card.image_uris.normal;
  return null;
}

interface ListCreateEditFormProps {
  existingList?: UserCardList | null;
  mode?: 'deck' | 'list';
  onSave: (name: string, cards: string[], description: string, commanderOptions?: { commanderName?: string; partnerCommanderName?: string; deckSize?: number; primer?: string; heroCardName?: string }) => void;
  onCancel: () => void;
}

export function ListCreateEditForm({ existingList, mode: modeProp, onSave, onCancel }: ListCreateEditFormProps) {
  const isDeck = modeProp === 'deck' || (existingList?.type === 'deck');
  const isEditing = !!existingList;

  const [name, setName] = useState(existingList?.name ?? '');
  const [description, setDescription] = useState(existingList?.description ?? '');
  const [cards, setCards] = useState<string[]>(existingList?.cards ?? []);
  const [primer, setPrimer] = useState(existingList?.primer ?? '');
  const [heroCardName, setHeroCardName] = useState<string | undefined>(existingList?.heroCardName);
  const [heroPickerOpen, setHeroPickerOpen] = useState(false);

  // Deck size state
  const [deckSize, setDeckSize] = useState<number | ''>(existingList?.deckSize ?? (isDeck ? 100 : ''));

  // Track whether the importer has un-imported text
  const [hasPendingImport, setHasPendingImport] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // When a save-time auto-import surfaces "not found" cards, we pause the save so
  // the user can review the errors. The next Save click proceeds normally.
  const [saveBlockedByImportErrors, setSaveBlockedByImportErrors] = useState(false);
  const importerRef = useRef<CollectionImporterHandle>(null);

  // Import result/progress — rendered in its own row below the columns
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importProgress, setImportProgress] = useState('');

  // Card metadata tracking for live breakdown badges and grid thumbnails
  const cardDataRef = useRef<Map<string, CardMeta>>(new Map());
  const [typeBreakdown, setTypeBreakdown] = useState<Record<string, number>>(() => existingList?.cachedTypeBreakdown ?? {});
  const [, forceTick] = useState(0);

  // Grid view mode (medium | small | list), persisted in localStorage
  const [listViewMode, setListViewMode] = useState<ListViewMode>(() => {
    const stored = localStorage.getItem('list-view-mode');
    // Migrate legacy values from the older 'normal' | 'compact' | 'text' scheme
    if (stored === 'small' || stored === 'list' || stored === 'medium') return stored;
    if (stored === 'compact') return 'small';
    if (stored === 'text') return 'list';
    return 'medium';
  });
  const toggleListView = () => {
    setListViewMode(prev => {
      const next: ListViewMode = prev === 'medium' ? 'small' : prev === 'small' ? 'list' : 'medium';
      localStorage.setItem('list-view-mode', next);
      return next;
    });
  };

  // Commander state
  const [commanderName, setCommanderName] = useState(existingList?.commanderName ?? '');
  const [commanderCard, setCommanderCard] = useState<ScryfallCard | null>(null);
  const [partnerCommanderName, setPartnerCommanderName] = useState(existingList?.partnerCommanderName ?? '');
  const [importedLegendaries, setImportedLegendaries] = useState<ScryfallCard[]>([]);
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
  const primerRef = useRef<HTMLTextAreaElement>(null);

  // Insert markdown formatting around selection or at cursor
  const insertFormat = useCallback((prefix: string, suffix: string = '') => {
    const ta = primerRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = primer.substring(start, end);
    const before = primer.substring(0, start);
    const after = primer.substring(end);
    const replacement = selected
      ? `${prefix}${selected}${suffix}`
      : `${prefix}${suffix}`;
    const newValue = `${before}${replacement}${after}`;
    setPrimer(newValue);
    // Restore cursor position inside the formatting
    requestAnimationFrame(() => {
      ta.focus();
      const cursorPos = selected ? start + prefix.length + selected.length + suffix.length : start + prefix.length;
      ta.setSelectionRange(cursorPos, cursorPos);
    });
  }, [primer]);

  const insertLinePrefix = useCallback((prefix: string) => {
    const ta = primerRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    // Find the start of the current line
    const lineStart = primer.lastIndexOf('\n', start - 1) + 1;
    const before = primer.substring(0, lineStart);
    const after = primer.substring(lineStart);
    const newValue = `${before}${prefix}${after}`;
    setPrimer(newValue);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + prefix.length, start + prefix.length);
    });
  }, [primer]);

  // Recompute type breakdown from the card data map and current card list
  const recomputeBreakdown = useCallback((currentCards: string[]) => {
    const breakdown: Record<string, number> = {};
    for (const name of currentCards) {
      const meta = cardDataRef.current.get(name);
      if (meta) breakdown[meta.type] = (breakdown[meta.type] ?? 0) + 1;
    }
    setTypeBreakdown(breakdown);
  }, []);

  // Fetch card data (type + image URL) for cards not yet in the map.
  // Also surface any legendary creatures we encounter so the commander
  // dropdown populates for existing decks (CollectionImporter only fires
  // legendary detection on fresh paste; cards loaded from storage need this).
  const fetchMissingCardData = useCallback(async (currentCards: string[]) => {
    const missing = currentCards.filter(n => !cardDataRef.current.has(n));
    if (missing.length === 0) { recomputeBreakdown(currentCards); return; }
    try {
      const cardMap = await getCardsByNames(missing);
      const newLegendaries: ScryfallCard[] = [];
      for (const name of missing) {
        const card = cardMap.get(name);
        if (card) {
          cardDataRef.current.set(name, {
            type: classifyCardType(card.type_line ?? ''),
            imageUrl: getCardImageUrl(card, 'small'),
          });
          const tl = (card.type_line ?? '').toLowerCase();
          if (tl.includes('legendary') && tl.includes('creature')) {
            newLegendaries.push(card);
          }
        } else {
          cardDataRef.current.set(name, { type: 'Other', imageUrl: null });
        }
      }
      if (newLegendaries.length > 0) {
        setImportedLegendaries(prev => {
          const byName = new Map(prev.map(c => [c.name, c]));
          for (const c of newLegendaries) byName.set(c.name, c);
          return [...byName.values()];
        });
      }
    } catch { /* ignore */ }
    recomputeBreakdown(currentCards);
    forceTick(t => t + 1);
  }, [recomputeBreakdown]);

  // On initial mount, populate type map for existing cards
  useEffect(() => {
    if (cards.length > 0) fetchMissingCardData(cards);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // Default deck size when first commander is set
      if (!deckSize) setDeckSize(100);
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
      cardDataRef.current.set(card.name, {
        type: classifyCardType(card.type_line ?? ''),
        imageUrl: getCardImageUrl(card, 'small'),
      });
      const newCards = [...cards, card.name];
      setCards(newCards);
      recomputeBreakdown(newCards);
      forceTick(t => t + 1);
    }
    setQuery('');
    setResults([]);
    setShowResults(false);
  };

  const handleRemoveCard = (cardName: string) => {
    const newCards = cards.filter(n => n !== cardName);
    setCards(newCards);
    recomputeBreakdown(newCards);
  };

  // Auto-set commander when *CMDR* marker is detected during import.
  // Skip in list mode — the commander UI is hidden there, so an auto-set
  // would silently flip the entity to a deck on save.
  const handleCommanderDetected = useCallback((card: ScryfallCard) => {
    if (!isDeck) return;
    if (commanderName) return;
    setCommanderName(card.name);
    setCommanderCard(card);
    setDeckSize(prev => prev || 100);
  }, [commanderName, isDeck]);

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
      const updated = [...current, ...newCards];
      cardsRef.current = updated;
      setCards(updated);
      fetchMissingCardData(updated);
    }

    return { added: newCards.length, updated: dupeCount };
  }, [fetchMissingCardData]);

  const handleClearAll = () => {
    setCards([]);
    cardDataRef.current.clear();
    setTypeBreakdown({});
  };

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      if (importerRef.current?.hasPending()) {
        const result = await importerRef.current.triggerImport();
        // If the auto-import surfaced not-found cards, pause the save so the user
        // can review the error display. The textarea was cleared by the import,
        // so a second Save click (with no pending text) proceeds normally.
        if (result && result.notFound.length > 0) {
          setSaveBlockedByImportErrors(true);
          return;
        }
      }
      setSaveBlockedByImportErrors(false);
      const finalCards = cardsRef.current;
      if (isDeck && finalCards.length === 0) return;
      const cmdFirstName = commanderName ? commanderName.split(',')[0] : '';
      const dateSuffix = new Date().toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
      const finalName = name.trim() || (isDeck
        ? (cmdFirstName ? `New ${cmdFirstName} Deck ${dateSuffix}` : `New Deck ${dateSuffix}`)
        : `New List ${dateSuffix}`);
      const cmdOptions = isDeck || commanderName || partnerCommanderName || heroCardName
        ? { commanderName: commanderName || undefined, partnerCommanderName: partnerCommanderName || undefined, deckSize: deckSize || undefined, primer: primer.trim() || undefined, heroCardName }
        : { heroCardName };
      onSave(finalName, finalCards, description.trim(), cmdOptions);
    } finally {
      setIsSaving(false);
    }
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
        <h2 className="text-xl font-bold">
          {isEditing
            ? (isDeck ? 'Edit Deck' : 'Edit List')
            : (isDeck ? 'Create New Deck' : 'Create New List')}
        </h2>
        {!isEditing && (
          <p className="text-sm text-muted-foreground mt-2">
            {isDeck
              ? 'Save a full Commander deck to check its health, balance roles, spot combos, draw test hands, and get optimization suggestions.'
              : 'Create a reusable card list for exclusions, must-includes, favorites, or tracking cards you own.'}
          </p>
        )}
      </div>

      {/* Two-column layout: metadata left, cards right (stacked on mobile) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 lg:items-start">
        {/* Left column — Name, Commander, Primer */}
        <div className="space-y-6 bg-accent/20 rounded-xl p-4 border border-border/20">
          {/* Name & Description */}
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Name</label>
              <Input
                ref={nameInputRef}
                type="text"
                placeholder={isDeck ? "e.g. Korvold Treasures, Atraxa Superfriends..." : "e.g. My Salt List, Staples, Pet Cards..."}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-10 bg-background"
              />
            </div>
            {!isDeck && (
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
            )}

            {/* Hero card section — pick a card whose art becomes the list backdrop.
                List-only; commander decks always render commander art. */}
            {!isDeck && (
              <div className="rounded-lg border border-border/40 bg-card/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {(() => {
                      const meta = heroCardName ? cardDataRef.current.get(heroCardName) : null;
                      if (heroCardName && meta?.imageUrl) {
                        return (
                          <img
                            src={meta.imageUrl}
                            alt={heroCardName}
                            className="w-10 h-14 rounded object-cover object-top shrink-0"
                          />
                        );
                      }
                      return (
                        <div className="w-10 h-14 rounded bg-accent/40 shrink-0 flex items-center justify-center text-muted-foreground/60 text-[10px]">
                          Auto
                        </div>
                      );
                    })()}
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {heroCardName ?? 'Auto — first card in list'}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Backdrop art for this list on the overview.
                      </div>
                    </div>
                  </div>
                  <Popover open={heroPickerOpen} onOpenChange={setHeroPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" type="button" disabled={cards.length === 0}>
                        Pick hero
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-[360px] p-0 max-h-[420px] overflow-hidden flex flex-col">
                      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Pick hero card
                        </span>
                        <button
                          type="button"
                          onClick={() => { setHeroCardName(undefined); setHeroPickerOpen(false); }}
                          className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
                        >
                          Auto
                        </button>
                      </div>
                      <div className="flex-1 overflow-y-auto px-2 py-2">
                        {cards.length === 0 ? (
                          <div className="px-2 py-6 text-xs text-muted-foreground text-center">
                            Add some cards to the list first.
                          </div>
                        ) : (
                          <div className="grid grid-cols-3 gap-2">
                            {cards
                              .map(n => ({ name: n, meta: cardDataRef.current.get(n) }))
                              .filter(({ meta }) => meta?.imageUrl)
                              .map(({ name: cardName, meta }) => (
                                <button
                                  key={cardName}
                                  type="button"
                                  onClick={() => { setHeroCardName(cardName); setHeroPickerOpen(false); }}
                                  className={`relative rounded overflow-hidden border transition-colors ${
                                    heroCardName === cardName
                                      ? 'border-primary ring-1 ring-primary'
                                      : 'border-border/40 hover:border-border'
                                  }`}
                                >
                                  <img
                                    src={meta!.imageUrl!}
                                    alt={cardName}
                                    className="w-full h-auto object-cover"
                                  />
                                  <div className="px-1.5 py-1 text-[10px] text-foreground/80 truncate text-left">
                                    {cardName.includes(' // ') ? cardName.split(' // ')[0] : cardName}
                                  </div>
                                </button>
                              ))}
                          </div>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            )}
          </div>

          {/* Commander — deck mode only */}
          {isDeck && <div className="space-y-3">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <CommanderIcon size={14} className="text-muted-foreground" />
              Commander <span className="text-muted-foreground font-normal">(optional, will populate after importing)</span>
            </label>

            {/* Commander selection — dropdown from imported legendaries, or search fallback */}
            {importedLegendaries.length > 0 ? (
              <select
                value={commanderName}
                onChange={(e) => {
                  const selected = importedLegendaries.find(c => c.name === e.target.value);
                  if (selected) {
                    setCommanderName(selected.name);
                    setCommanderCard(selected);
                    setPartnerCommanderName('');
                    if (!deckSize) setDeckSize(100);
                  } else {
                    setCommanderName(''); setCommanderCard(null); setPartnerCommanderName(''); setDeckSize('');
                  }
                }}
                className="w-full h-9 px-3 text-sm bg-background border border-border/30 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary truncate"
              >
                <option value="">Select a commander...</option>
                {importedLegendaries.map(card => (
                  <option key={card.id} value={card.name}>{card.name}</option>
                ))}
              </select>
            ) : commanderName ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-background rounded-lg border border-border/30">
                <span className="text-sm font-medium flex-1 truncate">{commanderName}</span>
                <button
                  onClick={() => {
                    setCards(prev => prev.filter(c => c !== commanderName && c !== partnerCommanderName));
                    setCommanderName(''); setCommanderCard(null); setPartnerCommanderName(''); setDeckSize('');
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

            {/* Deck size — only shown when a commander is set */}
            {commanderName && (
              <div className="flex items-center gap-2">
                <label className="text-sm text-muted-foreground whitespace-nowrap">Deck size</label>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={deckSize}
                  onChange={(e) => setDeckSize(e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value) || 0))}
                  className="w-20 px-2 py-1 text-sm bg-background border border-border/30 rounded-lg focus:outline-none focus:border-primary text-center"
                  placeholder="100"
                />
                <span className="text-xs text-muted-foreground">cards (including commander{canPartner ? 's' : ''})</span>
              </div>
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
          </div>}

          {/* Primer — deck mode only */}
          {isDeck && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">Primer / Strategy Notes <span className="text-muted-foreground font-normal">(optional)</span></label>
              <div className="border border-border rounded-md overflow-hidden focus-within:ring-1 focus-within:ring-primary">
                <div className="flex items-center gap-0.5 px-2 py-1 bg-accent/30 border-b border-border/50">
                  {[
                    { icon: Bold, action: () => insertFormat('**', '**'), title: 'Bold' },
                    { icon: Italic, action: () => insertFormat('*', '*'), title: 'Italic' },
                    { icon: Heading2, action: () => insertLinePrefix('## '), title: 'Heading' },
                    { icon: List, action: () => insertLinePrefix('- '), title: 'Bullet list' },
                    { icon: ListOrdered, action: () => insertLinePrefix('1. '), title: 'Numbered list' },
                    { icon: Minus, action: () => insertFormat('\n---\n'), title: 'Divider' },
                  ].map(({ icon: Icon, action, title }) => (
                    <button
                      key={title}
                      type="button"
                      onClick={action}
                      title={title}
                      className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>
                <textarea
                  ref={primerRef}
                  value={primer}
                  onChange={(e) => setPrimer(e.target.value)}
                  placeholder="Describe your deck's strategy, key combos, win conditions, mulliganing tips..."
                  className="w-full h-28 px-3 py-2 text-sm bg-background resize-none focus:outline-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Right column — Import */}
        <div className="space-y-6 bg-accent/20 rounded-xl p-4 border border-border/20">
          {/* Import Cards — shared component */}
          <CollectionImporter
            ref={importerRef}
            label="Import Cards"
            onImportCards={handleImportCards}
            onCommanderDetected={handleCommanderDetected}
            onMetaDetected={handleMetaDetected}
            onLegendariesDetected={setImportedLegendaries}
            updatedLabel="duplicates skipped"
            onPendingChange={(pending) => {
              setHasPendingImport(pending);
              // User is editing the import box → drop the stale "save blocked" hint.
              if (pending) setSaveBlockedByImportErrors(false);
            }}
            textareaClassName="lg:h-64"
            externalResult
            onResultChange={setImportResult}
            onProgressChange={setImportProgress}
          />
        </div>
      </div>

      {/* Import result/progress — full-width row */}
      {(importResult || importProgress) && (
        <ImportResultDisplay result={importResult} updatedLabel="duplicates skipped" progress={importProgress} />
      )}

      {/* Cards — full-width row below the two columns */}
      {cards.length > 0 && (
        <div className="space-y-3 bg-accent/20 rounded-xl p-4 border border-border/20">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Cards ({cards.length})</label>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleListView}
              className="h-7 px-2 gap-1.5 text-muted-foreground hover:text-foreground"
            >
              {listViewMode === 'medium' ? (
                <LayoutGrid className="w-3.5 h-3.5" />
              ) : listViewMode === 'small' ? (
                <Grid3x3 className="w-3.5 h-3.5" />
              ) : (
                <AlignLeft className="w-3.5 h-3.5" />
              )}
              <span className="text-xs">
                {listViewMode === 'medium' ? 'Medium' : listViewMode === 'small' ? 'Small' : 'List'}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              className="h-7 px-2 gap-1.5 text-red-400/70 hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="text-xs">Clear</span>
            </Button>
            {Object.keys(typeBreakdown).length > 0 && (
              <div className="flex items-end gap-1.5 ml-auto">
                {Object.entries(typeBreakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => (
                    <span
                      key={type}
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-accent/50 text-muted-foreground/70 rounded border border-border/30"
                      title={type}
                    >
                      <CardTypeIcon type={type} size="sm" className="opacity-50 text-[10px]" />
                      {count}
                    </span>
                  ))}
              </div>
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

          {/* Card grid */}
          <ListCardGrid
            cards={cards}
            cardData={cardDataRef.current}
            commanderName={commanderName}
            partnerCommanderName={partnerCommanderName}
            viewMode={listViewMode}
            onRemove={handleRemoveCard}
          />
        </div>
      )}

      {/* Actions — sticky at bottom */}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-border/50 sticky bottom-0 bg-background pb-4 -mb-4">
        {isDeck && cards.length === 0 && !hasPendingImport ? (
          <p className="text-xs text-amber-400 mr-auto">
            Add at least one card to create a deck
          </p>
        ) : saveBlockedByImportErrors ? (
          <p className="text-xs text-amber-400 mr-auto">
            Some cards couldn't be imported. Review the errors above, then click Save again to continue.
          </p>
        ) : null}
        <button
          onClick={onCancel}
          disabled={isSaving}
          className="px-4 py-2 text-sm rounded-lg hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving || (isDeck && cards.length === 0 && !hasPendingImport)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {isEditing
            ? (hasPendingImport ? 'Import & Save' : 'Save Changes')
            : hasPendingImport
            ? (isDeck ? 'Import & Create Deck' : 'Import & Create List')
            : (isDeck ? 'Create Deck' : 'Create List')}
        </button>
      </div>
    </div>
  );
}
