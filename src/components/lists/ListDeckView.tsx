import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, Loader2, List, Wand2, Pencil, CopyPlus, X, Plus, ArrowUpDown, MoreHorizontal, ChevronDown, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '@/store';
import { getCardsByNames, getFrontFaceTypeLine, searchCards, getCardImageUrl, getCardPrice, getCardBackFaceUrl, isDoubleFacedCard } from '@/services/scryfall/client';
import { ManaCost } from '@/components/ui/mtg-icons';
import { fetchCommanderCombos } from '@/services/edhrec/client';
import { applyCommanderTheme, resetTheme } from '@/lib/commanderTheme';
import { DeckDisplay } from '@/components/deck/DeckDisplay';
import { ComboDisplay } from '@/components/deck/ComboDisplay';
import type { UserCardList, ScryfallCard, GeneratedDeck, DeckCategory, DeckStats, DetectedCombo } from '@/types';

interface ListDeckViewProps {
  list: UserCardList;
  onBack: () => void;
  onViewAsList?: () => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onRemoveCards?: (cardNames: string[]) => void;
  onAddCards?: (cardNames: string[], destination: 'deck' | 'sideboard' | 'maybeboard') => void;
  onMoveToSideboard?: (cardNames: string[]) => void;
  onMoveToMaybeboard?: (cardNames: string[]) => void;
  onMoveToDeck?: (cardNames: string[], source: 'sideboard' | 'maybeboard') => void;
  onRemoveFromBoard?: (cardName: string, source: 'sideboard' | 'maybeboard') => void;
  onMoveBetweenBoards?: (cardName: string, from: 'sideboard' | 'maybeboard') => void;
}

function computeStatsFromCards(allCards: ScryfallCard[]): DeckStats {
  const nonLandCards = allCards.filter(
    card => !getFrontFaceTypeLine(card).toLowerCase().includes('land')
  );

  const manaCurve: Record<number, number> = {};
  nonLandCards.forEach(card => {
    const cmc = Math.min(Math.floor(card.cmc), 7);
    manaCurve[cmc] = (manaCurve[cmc] || 0) + 1;
  });

  const totalCmc = nonLandCards.reduce((sum, card) => sum + card.cmc, 0);
  const averageCmc = nonLandCards.length > 0 ? totalCmc / nonLandCards.length : 0;

  const colorDistribution: Record<string, number> = {};
  allCards.forEach(card => {
    const colors = card.colors || [];
    if (colors.length === 0) {
      colorDistribution['C'] = (colorDistribution['C'] || 0) + 1;
    } else {
      colors.forEach(color => {
        colorDistribution[color] = (colorDistribution[color] || 0) + 1;
      });
    }
  });

  const typeDistribution: Record<string, number> = { Planeswalker: 0 };
  allCards.forEach(card => {
    const typeLine = getFrontFaceTypeLine(card).toLowerCase();
    if (typeLine.includes('land')) typeDistribution['Land'] = (typeDistribution['Land'] || 0) + 1;
    else if (typeLine.includes('creature')) typeDistribution['Creature'] = (typeDistribution['Creature'] || 0) + 1;
    else if (typeLine.includes('instant')) typeDistribution['Instant'] = (typeDistribution['Instant'] || 0) + 1;
    else if (typeLine.includes('sorcery')) typeDistribution['Sorcery'] = (typeDistribution['Sorcery'] || 0) + 1;
    else if (typeLine.includes('artifact')) typeDistribution['Artifact'] = (typeDistribution['Artifact'] || 0) + 1;
    else if (typeLine.includes('enchantment')) typeDistribution['Enchantment'] = (typeDistribution['Enchantment'] || 0) + 1;
    else if (typeLine.includes('planeswalker')) typeDistribution['Planeswalker'] = (typeDistribution['Planeswalker'] || 0) + 1;
    else if (typeLine.includes('battle')) typeDistribution['Battle'] = (typeDistribution['Battle'] || 0) + 1;
  });

  return {
    totalCards: allCards.length,
    averageCmc: Math.round(averageCmc * 100) / 100,
    manaCurve,
    colorDistribution,
    typeDistribution,
  };
}

function getArtCropUrl(card: ScryfallCard | null): string | null {
  if (!card) return null;
  if (card.image_uris?.art_crop) return card.image_uris.art_crop;
  if (card.card_faces?.[0]?.image_uris?.art_crop) return card.card_faces[0].image_uris.art_crop;
  if (card.image_uris?.normal) return card.image_uris.normal;
  return null;
}

function detectCombosInDeck(
  combos: { comboId: string; cards: { name: string; id: string }[]; results: string[]; deckCount: number; bracket: string }[],
  allCardNames: Set<string>,
  commanderCard: ScryfallCard | null,
  partnerCard: ScryfallCard | null,
): DetectedCombo[] | undefined {
  if (combos.length === 0) return undefined;

  const detected = combos
    .map(combo => {
      const comboCardNames = combo.cards.map(c => c.name);
      const missingCards = comboCardNames.filter(name => !allCardNames.has(name));
      return {
        comboId: combo.comboId,
        cards: comboCardNames,
        results: combo.results,
        isComplete: missingCards.length === 0,
        missingCards,
        deckCount: combo.deckCount,
        bracket: combo.bracket,
      };
    })
    .filter(dc => dc.isComplete || dc.missingCards.length <= 2);

  const commanderNames = new Set<string>();
  if (commanderCard) {
    commanderNames.add(commanderCard.name);
    if (commanderCard.name.includes(' // ')) commanderNames.add(commanderCard.name.split(' // ')[0]);
  }
  if (partnerCard) {
    commanderNames.add(partnerCard.name);
    if (partnerCard.name.includes(' // ')) commanderNames.add(partnerCard.name.split(' // ')[0]);
  }

  detected.sort((a, b) => {
    if (a.isComplete !== b.isComplete) return a.isComplete ? -1 : 1;
    const aHasCommander = a.cards.some(n => commanderNames.has(n));
    const bHasCommander = b.cards.some(n => commanderNames.has(n));
    if (aHasCommander !== bHasCommander) return aHasCommander ? -1 : 1;
    return b.deckCount - a.deckCount;
  });

  return detected.length > 0 ? detected : undefined;
}

// --- Board Section (Sideboard / Maybeboard) ---

function BoardSection({ title, cards, boardType, onRemove, onMoveToDeck, onMoveToOtherBoard, otherBoardLabel }: {
  title: string;
  cards: ScryfallCard[];
  boardType: 'sideboard' | 'maybeboard';
  onRemove?: (cardName: string) => void;
  onMoveToDeck?: (cardName: string) => void;
  onMoveToOtherBoard?: (cardName: string) => void;
  otherBoardLabel: string;
}) {
  const [hoverCard, setHoverCard] = useState<{ card: ScryfallCard; rowRect: { right: number; top: number; height: number }; showBack?: boolean } | null>(null);

  if (cards.length === 0) return null;

  const headerColor = boardType === 'sideboard' ? 'text-amber-400' : 'text-purple-400';

  const totalPrice = cards.reduce((sum, card) => {
    const p = parseFloat(getCardPrice(card) || '0');
    return sum + (isNaN(p) ? 0 : p);
  }, 0);

  const handleHover = (card: ScryfallCard | null, e?: React.MouseEvent, showBack?: boolean) => {
    if (card && e) {
      const rect = e.currentTarget.getBoundingClientRect();
      setHoverCard({ card, rowRect: { right: rect.right, top: rect.top, height: rect.height }, showBack });
    } else {
      setHoverCard(null);
    }
  };

  return (
    <div className="break-inside-avoid mb-4">
      <div className={`flex items-center justify-between px-2 py-1.5 ${headerColor}`}>
        <span className="text-xs font-bold uppercase tracking-wider">
          {title} ({cards.length})
        </span>
        <span className="text-xs text-muted-foreground">${totalPrice.toFixed(2)}</span>
      </div>
      <div>
        {cards.map(card => {
          const rawPrice = getCardPrice(card);
          const price = rawPrice ? `$${parseFloat(rawPrice).toFixed(2)}` : '';
          const isDfc = isDoubleFacedCard(card);
          return (
            <div
              key={card.name}
              className="w-full text-left px-2 py-1 rounded text-sm flex items-center gap-2 transition-all duration-200 cursor-pointer hover:bg-accent/50"
              onMouseEnter={(e) => handleHover(card, e)}
              onMouseLeave={() => handleHover(null)}
            >
              <span className="flex-1 min-w-0 flex items-center hover:text-primary transition-colors">
                <span className="truncate">
                  {card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name}
                </span>
                <span className="shrink-0 flex items-center">
                  {isDfc && (
                    <span
                      className="ml-1 inline-flex align-text-bottom text-muted-foreground hover:text-primary transition-colors cursor-help"
                      title="Hover to see back face"
                      onMouseEnter={(e) => { e.stopPropagation(); handleHover(card, e, true); }}
                      onMouseLeave={(e) => { e.stopPropagation(); handleHover(card, e, false); }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                        <path d="M3 3v5h5" />
                      </svg>
                    </span>
                  )}
                </span>
              </span>
              <ManaCost cost={card.mana_cost || card.card_faces?.[0]?.mana_cost} />
              <div className="flex items-center gap-0.5 shrink-0">
                {onMoveToDeck && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onMoveToDeck(card.name); }}
                    className="p-0.5 rounded text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                    title="Move to deck"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
                {onMoveToOtherBoard && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onMoveToOtherBoard(card.name); }}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    title={`Move to ${otherBoardLabel}`}
                  >
                    <ArrowUpDown className="w-3.5 h-3.5" />
                  </button>
                )}
                {onRemove && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemove(card.name); }}
                    className="p-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Remove"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <span className="text-xs w-10 text-right shrink-0 text-muted-foreground">{price}</span>
            </div>
          );
        })}
      </div>
      {/* Floating Preview */}
      {hoverCard && (
        <div
          className="fixed z-[100] pointer-events-none hidden lg:block"
          style={{
            left: hoverCard.rowRect.right + 12,
            top: Math.min(Math.max(8, hoverCard.rowRect.top + hoverCard.rowRect.height / 2 - 180), window.innerHeight - 400),
          }}
        >
          <div className="card-preview-enter">
            <img
              src={hoverCard.showBack ? (getCardBackFaceUrl(hoverCard.card, 'normal') || getCardImageUrl(hoverCard.card, 'normal')) : getCardImageUrl(hoverCard.card, 'normal')}
              alt={hoverCard.card.name}
              className="w-64 rounded-lg shadow-2xl border border-border/50"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// --- Collapsible Boards Wrapper ---

function BoardsCollapsible({ sideboardCards, maybeboardCards, onRemoveFromBoard, onMoveToDeck, onMoveBetweenBoards }: {
  sideboardCards: ScryfallCard[];
  maybeboardCards: ScryfallCard[];
  onRemoveFromBoard?: (cardName: string, source: 'sideboard' | 'maybeboard') => void;
  onMoveToDeck?: (cardNames: string[], source: 'sideboard' | 'maybeboard') => void;
  onMoveBetweenBoards?: (cardName: string, from: 'sideboard' | 'maybeboard') => void;
}) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('mtg-deck-builder-boards-collapsed') === 'true');

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('mtg-deck-builder-boards-collapsed', String(next));
  };

  const totalCount = sideboardCards.length + maybeboardCards.length;

  return (
    <div className="border-t border-border/30">
      <button
        onClick={toggle}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-accent/30 transition-colors"
      >
        {collapsed ? <ChevronRight className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        <span className="text-xs font-semibold text-foreground">
          Sideboard & Maybeboard
        </span>
        <span className="text-[10px] text-muted-foreground">({totalCount})</span>
      </button>
      {!collapsed && (
        <div className={`px-4 pb-4 ${sideboardCards.length > 0 && maybeboardCards.length > 0 ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : ''}`}>
          <BoardSection
            title="Sideboard"
            cards={sideboardCards}
            boardType="sideboard"
            onRemove={onRemoveFromBoard ? (name) => onRemoveFromBoard(name, 'sideboard') : undefined}
            onMoveToDeck={onMoveToDeck ? (name) => onMoveToDeck([name], 'sideboard') : undefined}
            onMoveToOtherBoard={onMoveBetweenBoards ? (name) => onMoveBetweenBoards(name, 'sideboard') : undefined}
            otherBoardLabel="Maybeboard"
          />
          <BoardSection
            title="Maybeboard"
            cards={maybeboardCards}
            boardType="maybeboard"
            onRemove={onRemoveFromBoard ? (name) => onRemoveFromBoard(name, 'maybeboard') : undefined}
            onMoveToDeck={onMoveToDeck ? (name) => onMoveToDeck([name], 'maybeboard') : undefined}
            onMoveToOtherBoard={onMoveBetweenBoards ? (name) => onMoveBetweenBoards(name, 'maybeboard') : undefined}
            otherBoardLabel="Sideboard"
          />
        </div>
      )}
    </div>
  );
}

// --- Main Component ---

export function ListDeckView({ list, onBack, onViewAsList, onEdit, onDuplicate, onRemoveCards, onAddCards, onMoveToSideboard, onMoveToMaybeboard, onMoveToDeck, onRemoveFromBoard, onMoveBetweenBoards }: ListDeckViewProps) {
  const generatedDeck = useStore(s => s.generatedDeck);
  const colorIdentity = useStore(s => s.colorIdentity) || [];
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [artUrl, setArtUrl] = useState<string | null>(null);
  const [artLoaded, setArtLoaded] = useState(false);

  // Board card data
  const [sideboardCards, setSideboardCards] = useState<ScryfallCard[]>([]);
  const [maybeboardCards, setMaybeboardCards] = useState<ScryfallCard[]>([]);

  // Overflow menu
  const [showOverflow, setShowOverflow] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  // Card search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ScryfallCard[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchWrapperRef = useRef<HTMLDivElement>(null);

  // Destination picker state
  const [pendingCard, setPendingCard] = useState<ScryfallCard | null>(null);

  // Track previous cards for incremental updates
  const prevCardsRef = useRef<string[]>(list.cards);
  const isInitialLoadDone = useRef(false);
  // Cache raw combos so incremental updates can re-evaluate completeness
  const rawCombosRef = useRef<{ comboId: string; cards: { name: string; id: string }[]; results: string[]; deckCount: number; bracket: string }[]>([]);

  // Full build — only on initial mount / list.id change
  useEffect(() => {
    let cancelled = false;
    isInitialLoadDone.current = false;

    async function buildAndSetDeck() {
      setLoading(true);
      setError(null);
      setArtUrl(null);
      setArtLoaded(false);

      try {
        const allNames = [
          ...list.cards,
          ...(list.sideboard || []),
          ...(list.maybeboard || []),
        ];
        const cardMap = await getCardsByNames(allNames);
        if (cancelled) return;

        const cards: ScryfallCard[] = [];
        for (const name of list.cards) {
          const card = cardMap.get(name);
          if (card) cards.push(card);
        }

        // Resolve board cards
        const sbCards: ScryfallCard[] = [];
        for (const name of (list.sideboard || [])) {
          const card = cardMap.get(name);
          if (card) sbCards.push(card);
        }
        setSideboardCards(sbCards);

        const mbCards: ScryfallCard[] = [];
        for (const name of (list.maybeboard || [])) {
          const card = cardMap.get(name);
          if (card) mbCards.push(card);
        }
        setMaybeboardCards(mbCards);

        if (cards.length === 0) {
          setError('Could not fetch card data for this list.');
          setLoading(false);
          return;
        }

        let commanderCard: ScryfallCard | null = null;
        let partnerCard: ScryfallCard | null = null;

        if (list.commanderName) {
          commanderCard = cardMap.get(list.commanderName) ?? null;
        }
        if (list.partnerCommanderName) {
          partnerCard = cardMap.get(list.partnerCommanderName) ?? null;
        }

        setArtUrl(getArtCropUrl(commanderCard));

        const commanderNames = new Set<string>();
        if (commanderCard) commanderNames.add(commanderCard.name);
        if (partnerCard) commanderNames.add(partnerCard.name);

        const deckCards = commanderNames.size > 0
          ? cards.filter(c => !commanderNames.has(c.name))
          : cards;

        const stats = computeStatsFromCards(deckCards);

        const allDeckNames = new Set<string>();
        if (commanderCard) {
          allDeckNames.add(commanderCard.name);
          if (commanderCard.name.includes(' // ')) allDeckNames.add(commanderCard.name.split(' // ')[0]);
        }
        if (partnerCard) {
          allDeckNames.add(partnerCard.name);
          if (partnerCard.name.includes(' // ')) allDeckNames.add(partnerCard.name.split(' // ')[0]);
        }
        for (const c of deckCards) {
          allDeckNames.add(c.name);
          if (c.name.includes(' // ')) allDeckNames.add(c.name.split(' // ')[0]);
        }

        let detectedCombos: DetectedCombo[] | undefined;
        if (commanderCard) {
          try {
            const combos = await fetchCommanderCombos(commanderCard.name);
            if (!cancelled) {
              rawCombosRef.current = combos;
              detectedCombos = detectCombosInDeck(combos, allDeckNames, commanderCard, partnerCard);
            }
          } catch {
            // Combo fetch failed — not critical
          }
        }

        if (cancelled) return;

        const categories: Record<DeckCategory, ScryfallCard[]> = {
          lands: [],
          ramp: [],
          cardDraw: [],
          singleRemoval: [],
          boardWipes: [],
          creatures: [],
          synergy: deckCards,
          utility: [],
        };

        const syntheticDeck: GeneratedDeck = {
          commander: commanderCard,
          partnerCommander: partnerCard,
          categories,
          stats,
          detectedCombos,
        };

        const allColors = new Set<string>();
        for (const card of cards) {
          for (const c of card.color_identity || []) {
            allColors.add(c);
          }
        }

        const colorArray = [...allColors];
        useStore.setState({
          commander: commanderCard,
          colorIdentity: colorArray,
          generatedDeck: syntheticDeck,
        });

        if (colorArray.length > 0) {
          applyCommanderTheme(colorArray);
        }

        prevCardsRef.current = list.cards;
        isInitialLoadDone.current = true;
      } catch {
        if (!cancelled) {
          setError('Failed to load card data. Please try again.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    buildAndSetDeck();

    return () => {
      cancelled = true;
      useStore.setState({ generatedDeck: null });
      resetTheme();
    };
  }, [list.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Incremental update — patch deck in-place when cards change (no full reload)
  useEffect(() => {
    if (!isInitialLoadDone.current) return;
    const prev = prevCardsRef.current;
    const current = list.cards;
    // Quick equality check
    if (prev.length === current.length && prev.every((c, i) => c === current[i])) return;
    prevCardsRef.current = current;

    const removed = new Set(prev.filter(c => !current.includes(c)));
    const added = current.filter(c => !prev.includes(c));

    const deck = useStore.getState().generatedDeck;
    if (!deck) return;

    const commanderNames = new Set<string>();
    if (deck.commander) commanderNames.add(deck.commander.name);
    if (deck.partnerCommander) commanderNames.add(deck.partnerCommander.name);

    // Handle removals: filter out from synergy
    let updatedSynergy = deck.categories.synergy.filter(c => !removed.has(c.name));

    // Handle additions: fetch new cards and append
    if (added.length > 0) {
      getCardsByNames(added).then(cardMap => {
        const currentDeck = useStore.getState().generatedDeck;
        if (!currentDeck) return;

        const newCards: ScryfallCard[] = [];
        for (const name of added) {
          const card = cardMap.get(name);
          if (card && !commanderNames.has(card.name)) newCards.push(card);
        }

        const synergy = [...currentDeck.categories.synergy, ...newCards];
        const stats = computeStatsFromCards(synergy);

        // Re-evaluate combo completeness
        const allDeckNames = new Set<string>();
        if (currentDeck.commander) {
          allDeckNames.add(currentDeck.commander.name);
          if (currentDeck.commander.name.includes(' // ')) allDeckNames.add(currentDeck.commander.name.split(' // ')[0]);
        }
        if (currentDeck.partnerCommander) {
          allDeckNames.add(currentDeck.partnerCommander.name);
          if (currentDeck.partnerCommander.name.includes(' // ')) allDeckNames.add(currentDeck.partnerCommander.name.split(' // ')[0]);
        }
        for (const c of synergy) {
          allDeckNames.add(c.name);
          if (c.name.includes(' // ')) allDeckNames.add(c.name.split(' // ')[0]);
        }
        const detectedCombos = rawCombosRef.current.length > 0
          ? detectCombosInDeck(rawCombosRef.current, allDeckNames, currentDeck.commander, currentDeck.partnerCommander)
          : currentDeck.detectedCombos;

        useStore.setState({
          generatedDeck: {
            ...currentDeck,
            categories: { ...currentDeck.categories, synergy },
            stats,
            detectedCombos,
          },
        });
      });
      return; // additions are async — they'll update when ready
    }

    // Removals only (synchronous)
    const stats = computeStatsFromCards(updatedSynergy);

    // Re-evaluate combo completeness
    const allDeckNames = new Set<string>();
    if (deck.commander) {
      allDeckNames.add(deck.commander.name);
      if (deck.commander.name.includes(' // ')) allDeckNames.add(deck.commander.name.split(' // ')[0]);
    }
    if (deck.partnerCommander) {
      allDeckNames.add(deck.partnerCommander.name);
      if (deck.partnerCommander.name.includes(' // ')) allDeckNames.add(deck.partnerCommander.name.split(' // ')[0]);
    }
    for (const c of updatedSynergy) {
      allDeckNames.add(c.name);
      if (c.name.includes(' // ')) allDeckNames.add(c.name.split(' // ')[0]);
    }
    const detectedCombos = rawCombosRef.current.length > 0
      ? detectCombosInDeck(rawCombosRef.current, allDeckNames, deck.commander, deck.partnerCommander)
      : deck.detectedCombos;

    useStore.setState({
      generatedDeck: {
        ...deck,
        categories: { ...deck.categories, synergy: updatedSynergy },
        stats,
        detectedCombos,
      },
    });
  }, [list.cards]);

  // Separate effect for board-only changes (lighter than full rebuild)
  useEffect(() => {
    const sbNames = list.sideboard || [];
    const mbNames = list.maybeboard || [];
    if (sbNames.length === 0 && mbNames.length === 0) {
      setSideboardCards([]);
      setMaybeboardCards([]);
      return;
    }
    const boardNames = [...sbNames, ...mbNames];
    getCardsByNames(boardNames).then(cardMap => {
      setSideboardCards(sbNames.map(n => cardMap.get(n)).filter(Boolean) as ScryfallCard[]);
      setMaybeboardCards(mbNames.map(n => cardMap.get(n)).filter(Boolean) as ScryfallCard[]);
    });
  }, [list.sideboard, list.maybeboard]);

  // Close overflow menu on outside click
  useEffect(() => {
    if (!showOverflow) return;
    const handleClick = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setShowOverflow(false);
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [showOverflow]);

  // Debounced card search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchCards(searchQuery, colorIdentity, { order: 'edhrec' });
        const allExisting = new Set([
          ...list.cards,
          ...(list.sideboard || []),
          ...(list.maybeboard || []),
        ]);
        const filtered = results.data.filter(card => !allExisting.has(card.name));
        setSearchResults(filtered.slice(0, 8));
        setShowSearchResults(true);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, list.cards, list.sideboard, list.maybeboard, colorIdentity]);

  const handleAddToDeck = useCallback((card: ScryfallCard) => {
    if (!onAddCards) return;
    onAddCards([card.name], 'deck');
    setSearchResults(prev => prev.filter(c => c.id !== card.id));
  }, [onAddCards]);

  const handleShowBoardPicker = useCallback((card: ScryfallCard, event: React.MouseEvent) => {
    event.stopPropagation();
    setPendingCard(card);
  }, []);

  const handleDestinationPick = useCallback((destination: 'deck' | 'sideboard' | 'maybeboard') => {
    if (!pendingCard || !onAddCards) return;
    onAddCards([pendingCard.name], destination);
    setSearchResults(prev => prev.filter(c => c.id !== pendingCard.id));
    setPendingCard(null);
  }, [pendingCard, onAddCards]);

  const handleCancelPicker = useCallback(() => {
    setPendingCard(null);
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex items-center justify-center gap-3 py-20">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Loading deck view...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="text-center py-16 text-sm text-muted-foreground">{error}</div>
      </div>
    );
  }

  return (
    <>
      {/* Commander art background */}
      {artUrl && (
        <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
          <div className={`absolute inset-0 transition-all duration-1000 ${artLoaded ? 'opacity-100' : 'opacity-0'}`}>
            <img
              src={artUrl}
              alt=""
              className="w-full h-[70vh] object-cover object-top blur-md scale-110 transition-all duration-700"
              onLoad={() => setArtLoaded(true)}
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/70 to-background" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/30" />
          <div className="absolute inset-0 bg-background/15" />
          <div
            className="absolute inset-0"
            style={{ background: 'radial-gradient(ellipse at center top, transparent 0%, hsl(var(--background)) 70%)' }}
          />
        </div>
      )}

      <div className="relative z-10 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back</span>
            </button>
            <h2 className="text-lg font-bold truncate">{list.name}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {list.commanderName && (
              <button
                onClick={() => navigate(`/build-from-deck/${list.id}`)}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <Wand2 className="w-3.5 h-3.5" />
                Build From Deck
              </button>
            )}
            {onViewAsList && (
              <button
                onClick={onViewAsList}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <List className="w-3.5 h-3.5" />
                View as List
              </button>
            )}
            <div className="relative" ref={overflowRef}>
              <button
                onClick={() => setShowOverflow(prev => !prev)}
                className="flex items-center justify-center w-8 h-8 rounded-lg border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {showOverflow && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-card border border-border rounded-lg shadow-2xl py-1 z-50">
                  {/* Mobile-only: show Build From Deck + View as List */}
                  {list.commanderName && (
                    <button
                      onClick={() => { setShowOverflow(false); navigate(`/build-from-deck/${list.id}`); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2 sm:hidden"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      Build From Deck
                    </button>
                  )}
                  {onViewAsList && (
                    <button
                      onClick={() => { setShowOverflow(false); onViewAsList(); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2 sm:hidden"
                    >
                      <List className="w-3.5 h-3.5" />
                      View as List
                    </button>
                  )}
                  {onEdit && (
                    <button
                      onClick={() => { setShowOverflow(false); onEdit(); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit Details
                    </button>
                  )}
                  {onDuplicate && (
                    <button
                      onClick={() => { setShowOverflow(false); onDuplicate(); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2"
                    >
                      <CopyPlus className="w-3.5 h-3.5" />
                      Duplicate
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {list.deckSize && list.cards.length !== list.deckSize && (
          <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-sm">
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Deck has {list.cards.length} card{list.cards.length !== 1 ? 's' : ''} (expected {list.deckSize})
            {list.cards.length < list.deckSize
              ? ` — ${list.deckSize - list.cards.length} short`
              : ` — ${list.cards.length - list.deckSize} over`}
          </div>
        )}

        <DeckDisplay
          onRemoveCards={onRemoveCards}
          onMoveToSideboard={onMoveToSideboard}
          onMoveToMaybeboard={onMoveToMaybeboard}
          boardCounts={{ sideboard: sideboardCards.length, maybeboard: maybeboardCards.length }}
          toolbarExtra={onAddCards ? (
            <div className="relative" ref={searchWrapperRef}>
              <Plus className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Add a card..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => {
                  if (searchResults.length > 0) setShowSearchResults(true);
                }}
                className="bg-card/50 border border-border/50 rounded-lg pl-8 pr-8 py-1.5 text-xs w-44 sm:w-64 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
              />
              {isSearching && (
                <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-primary" />
              )}
              {!isSearching && searchQuery && (
                <button
                  onClick={() => { setSearchQuery(''); setSearchResults([]); setShowSearchResults(false); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              {/* Search Results Dropdown */}
              {showSearchResults && searchResults.length > 0 && (
                <>
                  <div className="fixed inset-0 z-[998]" onClick={() => setShowSearchResults(false)} />
                  <div className="absolute top-full left-0 mt-1 z-[999] max-h-[280px] min-w-[320px] w-full overflow-auto bg-card border border-border rounded-lg shadow-2xl py-1">
                    {searchResults.map((card) => (
                      <div
                        key={card.id}
                        onClick={() => handleAddToDeck(card)}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-accent/50 text-left transition-colors cursor-pointer group"
                      >
                        <img src={getCardImageUrl(card, 'small')} alt={card.name} className="w-8 h-auto rounded shadow shrink-0" loading="lazy" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{card.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{card.type_line}</p>
                        </div>
                        <span className="shrink-0" title="Add to deck">
                          <Plus className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                        </span>
                        {(onMoveToSideboard || onMoveToMaybeboard) && (
                          <button
                            onClick={(e) => handleShowBoardPicker(card, e)}
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                            title="Add to sideboard or maybeboard"
                          >
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
              {/* Board Picker — sideboard/maybeboard */}
              {pendingCard && (
                <>
                  <div className="fixed inset-0 z-[998]" onClick={handleCancelPicker} />
                  <div className="absolute top-full left-0 mt-1 z-[999] bg-card border border-border rounded-lg shadow-2xl py-1 w-44">
                    <p className="px-3 py-1.5 text-xs text-muted-foreground truncate border-b border-border/50">{pendingCard.name}</p>
                    <button
                      onClick={() => handleDestinationPick('sideboard')}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors text-amber-400"
                    >
                      Add to Sideboard
                    </button>
                    <button
                      onClick={() => handleDestinationPick('maybeboard')}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors text-purple-400"
                    >
                      Add to Maybeboard
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : undefined}
          deckFooter={(sideboardCards.length > 0 || maybeboardCards.length > 0) ? (
            <BoardsCollapsible
              sideboardCards={sideboardCards}
              maybeboardCards={maybeboardCards}
              onRemoveFromBoard={onRemoveFromBoard}
              onMoveToDeck={onMoveToDeck}
              onMoveBetweenBoards={onMoveBetweenBoards}
            />
          ) : undefined}
        >
          {generatedDeck?.detectedCombos && generatedDeck.detectedCombos.length > 0 && (
            <ComboDisplay combos={generatedDeck.detectedCombos} hideMustInclude />
          )}
        </DeckDisplay>
      </div>
    </>
  );
}
