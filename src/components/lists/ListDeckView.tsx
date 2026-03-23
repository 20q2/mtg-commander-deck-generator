import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ArrowLeft, Loader2, List, Wand2, Pencil, CopyPlus, X, Plus, MoreHorizontal, ChevronDown, ChevronRight, ClipboardPaste, Bold, Italic, Heading2, ListOrdered, Minus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '@/store';
import { getCardsByNames, getFrontFaceTypeLine, searchCards, getCardImageUrl, getCardPrice, getCardBackFaceUrl, isDoubleFacedCard } from '@/services/scryfall/client';
import { ManaCost } from '@/components/ui/mtg-icons';
import { fetchCommanderCombos } from '@/services/edhrec/client';
import { applyCommanderTheme, resetTheme } from '@/lib/commanderTheme';
import { DeckDisplay, CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import { ComboDisplay } from '@/components/deck/ComboDisplay';
import { TestHand } from '@/components/deck/TestHand';
import { enrichDeckCards } from '@/services/deckBuilder/deckEnricher';
import { CollectionImporter } from '@/components/collection/CollectionImporter';
import { DeckOptimizer } from '@/components/deck/DeckOptimizer';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { UserCardList, ScryfallCard, GeneratedDeck, DeckStats, DetectedCombo } from '@/types';
import { useUserLists } from '@/hooks/useUserLists';

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
  onUpdatePrimer?: (primer: string) => void;
  onChangeQuantity?: (cardName: string, newQuantity: number) => void;
  onRename?: (newName: string) => void;
  onUpdateDeckSize?: (newSize: number) => void;
  onSetSideboard?: (names: string[]) => void;
  onSetMaybeboard?: (names: string[]) => void;
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

/** Lightweight markdown → HTML for primer display (bold, italic, headings, lists, hr) */
function renderSimpleMarkdown(md: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = md.split('\n');
  const out: string[] = [];
  let inUl = false;
  let inOl = false;

  const closeList = () => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };

  const inlineFormat = (text: string) =>
    escape(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line === '---' || line === '***' || line === '___') {
      closeList();
      out.push('<hr class="my-2 border-border/50" />');
      continue;
    }

    const h2 = line.match(/^##\s+(.+)/);
    if (h2) { closeList(); out.push(`<h4 class="font-semibold text-foreground mt-2 mb-0.5">${inlineFormat(h2[1])}</h4>`); continue; }

    const h1 = line.match(/^#\s+(.+)/);
    if (h1) { closeList(); out.push(`<h3 class="font-bold text-foreground mt-2 mb-0.5">${inlineFormat(h1[1])}</h3>`); continue; }

    const ul = line.match(/^[-*]\s+(.+)/);
    if (ul) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul class="list-disc list-inside space-y-0.5">'); inUl = true; }
      out.push(`<li>${inlineFormat(ul[1])}</li>`);
      continue;
    }

    const ol = line.match(/^\d+\.\s+(.+)/);
    if (ol) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol class="list-decimal list-inside space-y-0.5">'); inOl = true; }
      out.push(`<li>${inlineFormat(ol[1])}</li>`);
      continue;
    }

    closeList();
    if (line === '') { out.push('<br />'); }
    else { out.push(`<p>${inlineFormat(line)}</p>`); }
  }

  closeList();
  return out.join('\n');
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

// --- Board Card Row (with context menu) ---

function BoardCardRow({
  card, boardType, onCardAction, menuProps, handleHover,
}: {
  card: ScryfallCard;
  boardType: 'sideboard' | 'maybeboard';
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string> };
  handleHover: (card: ScryfallCard | null, e?: React.MouseEvent, showBack?: boolean) => void;
}) {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const rawPrice = getCardPrice(card);
  const price = rawPrice ? `$${parseFloat(rawPrice).toFixed(2)}` : '';
  const isDfc = isDoubleFacedCard(card);

  return (
    <div
      className="w-full text-left px-2 py-1 rounded text-sm flex items-center gap-2 transition-all duration-200 cursor-pointer hover:bg-accent/50 group"
      onMouseEnter={(e) => handleHover(card, e)}
      onMouseLeave={() => handleHover(null)}
      onContextMenu={(e) => {
        if (onCardAction && menuProps) {
          e.preventDefault();
          setContextMenuOpen(true);
        }
      }}
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
      <span className="text-xs w-10 text-right shrink-0 text-muted-foreground">{price}</span>
      {onCardAction && menuProps && (
        <span
          className={`shrink-0 w-3 transition-opacity ${contextMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <CardContextMenu
            card={card}
            onAction={onCardAction}
            hasRemove
            hasAddToDeck
            hasSideboard={boardType === 'maybeboard'}
            hasMaybeboard={boardType === 'sideboard'}
            userLists={menuProps.userLists}
            isMustInclude={menuProps.mustIncludeNames.has(card.name)}
            isBanned={menuProps.bannedNames.has(card.name)}
            forceOpen={contextMenuOpen}
            onForceClose={() => setContextMenuOpen(false)}
          />
        </span>
      )}
    </div>
  );
}

// --- Board Section (Sideboard / Maybeboard) ---

function BoardSection({ title, cards, boardType, onCardAction, menuProps }: {
  title: string;
  cards: ScryfallCard[];
  boardType: 'sideboard' | 'maybeboard';
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string> };
}) {
  const [hoverCard, setHoverCard] = useState<{ card: ScryfallCard; rowRect: { right: number; top: number; height: number }; showBack?: boolean } | null>(null);

  // Clear hover when cards change (card moved/removed)
  useEffect(() => {
    if (hoverCard && !cards.some(c => c.name === hoverCard.card.name)) {
      setHoverCard(null);
    }
  }, [cards, hoverCard]);

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
        {cards.length === 0 && (
          <div className="px-2 py-3 text-xs text-muted-foreground/50 italic">Empty</div>
        )}
        {cards.map(card => (
          <BoardCardRow
            key={card.name}
            card={card}
            boardType={boardType}
            onCardAction={onCardAction}
            menuProps={menuProps}
            handleHover={handleHover}
          />
        ))}
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

function BoardsCollapsible({ sideboardCards, maybeboardCards, onBoardCardAction, menuProps }: {
  sideboardCards: ScryfallCard[];
  maybeboardCards: ScryfallCard[];
  onBoardCardAction?: (card: ScryfallCard, action: CardAction, boardType: 'sideboard' | 'maybeboard') => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string> };
}) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('mtg-deck-builder-boards-collapsed') === 'true');

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('mtg-deck-builder-boards-collapsed', String(next));
  };

  const totalCount = sideboardCards.length + maybeboardCards.length;

  const handleSBAction = useCallback((card: ScryfallCard, action: CardAction) => {
    onBoardCardAction?.(card, action, 'sideboard');
  }, [onBoardCardAction]);

  const handleMBAction = useCallback((card: ScryfallCard, action: CardAction) => {
    onBoardCardAction?.(card, action, 'maybeboard');
  }, [onBoardCardAction]);

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
        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <BoardSection
            title="Sideboard"
            cards={sideboardCards}
            boardType="sideboard"
            onCardAction={handleSBAction}
            menuProps={menuProps}
          />
          <BoardSection
            title="Maybeboard"
            cards={maybeboardCards}
            boardType="maybeboard"
            onCardAction={handleMBAction}
            menuProps={menuProps}
          />
        </div>
      )}
    </div>
  );
}

// --- Main Component ---

export function ListDeckView({ list, onBack, onViewAsList, onEdit, onDuplicate, onRemoveCards, onAddCards, onMoveToSideboard, onMoveToMaybeboard, onMoveToDeck, onRemoveFromBoard, onMoveBetweenBoards, onUpdatePrimer, onChangeQuantity, onRename, onUpdateDeckSize, onSetSideboard, onSetMaybeboard }: ListDeckViewProps) {
  const generatedDeck = useStore(s => s.generatedDeck);
  const colorIdentity = useStore(s => s.colorIdentity) || [];
  const customization = useStore(s => s.customization);
  const updateCustomization = useStore(s => s.updateCustomization);
  const { lists: userLists, updateList } = useUserLists();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [artUrl, setArtUrl] = useState<string | null>(null);
  const [artLoaded, setArtLoaded] = useState(false);
  const [deckEditMode, setDeckEditMode] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(list.name);
  const nameInputRef = useRef<HTMLInputElement>(null);

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

  // Bulk add state
  const [showBulkAdd, setShowBulkAdd] = useState(false);

  // Primer inline editing state
  const [editingPrimer, setEditingPrimer] = useState(false);
  const [primerDraft, setPrimerDraft] = useState('');
  const primerRef = useRef<HTMLTextAreaElement>(null);

  const insertFormat = useCallback((prefix: string, suffix: string = '') => {
    const ta = primerRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = primerDraft.substring(start, end);
    const before = primerDraft.substring(0, start);
    const after = primerDraft.substring(end);
    const replacement = selected ? `${prefix}${selected}${suffix}` : `${prefix}${suffix}`;
    const newValue = `${before}${replacement}${after}`;
    setPrimerDraft(newValue);
    requestAnimationFrame(() => {
      ta.focus();
      const cursorPos = selected ? start + prefix.length + selected.length + suffix.length : start + prefix.length;
      ta.setSelectionRange(cursorPos, cursorPos);
    });
  }, [primerDraft]);

  const insertLinePrefix = useCallback((prefix: string) => {
    const ta = primerRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const lineStart = primerDraft.lastIndexOf('\n', start - 1) + 1;
    const before = primerDraft.substring(0, lineStart);
    const after = primerDraft.substring(lineStart);
    const newValue = `${before}${prefix}${after}`;
    setPrimerDraft(newValue);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + prefix.length, start + prefix.length);
    });
  }, [primerDraft]);

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

        const enrichResult = await enrichDeckCards(deckCards, list.deckSize || list.cards.length);

        const syntheticDeck: GeneratedDeck = {
          commander: commanderCard,
          partnerCommander: partnerCard,
          categories: enrichResult.categories,
          stats,
          detectedCombos,
          roleCounts: enrichResult.roleCounts,
          roleTargets: enrichResult.roleTargets,
          rampSubtypeCounts: enrichResult.rampSubtypeCounts,
          removalSubtypeCounts: enrichResult.removalSubtypeCounts,
          boardwipeSubtypeCounts: enrichResult.boardwipeSubtypeCounts,
          cardDrawSubtypeCounts: enrichResult.cardDrawSubtypeCounts,
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

    // Build count maps to detect additions, removals, AND quantity changes
    const prevCounts = new Map<string, number>();
    for (const c of prev) prevCounts.set(c, (prevCounts.get(c) || 0) + 1);
    const currentCounts = new Map<string, number>();
    for (const c of current) currentCounts.set(c, (currentCounts.get(c) || 0) + 1);

    // Cards fully removed (count went to 0)
    const removed = new Set<string>();
    for (const name of prevCounts.keys()) {
      if (!currentCounts.has(name)) removed.add(name);
    }
    // Cards newly added (didn't exist before) — need to fetch from Scryfall
    const newlyAdded: string[] = [];
    for (const [name, count] of currentCounts) {
      if (!prevCounts.has(name)) {
        for (let i = 0; i < count; i++) newlyAdded.push(name);
      }
    }

    const deck = useStore.getState().generatedDeck;
    if (!deck) return;

    const commanderNames = new Set<string>();
    if (deck.commander) commanderNames.add(deck.commander.name);
    if (deck.partnerCommander) commanderNames.add(deck.partnerCommander.name);

    // Rebuild the full card list respecting current quantities
    // For existing cards (in deck already), adjust counts; for new cards, fetch them
    const existingCardMap = new Map<string, ScryfallCard>();
    for (const c of Object.values(deck.categories).flat()) {
      if (!removed.has(c.name)) existingCardMap.set(c.name, c);
    }

    const buildDeckCards = (fetchedCards?: Map<string, ScryfallCard>): ScryfallCard[] => {
      const result: ScryfallCard[] = [];
      for (const [name, count] of currentCounts) {
        if (commanderNames.has(name)) continue;
        const card = existingCardMap.get(name) || fetchedCards?.get(name);
        if (card) {
          for (let i = 0; i < count; i++) result.push(card);
        }
      }
      return result;
    };

    // Helper: re-enrich all cards and update store
    const reEnrich = async (allDeckCards: ScryfallCard[]) => {
      const currentDeck = useStore.getState().generatedDeck;
      if (!currentDeck) return;

      const enrichResult = await enrichDeckCards(allDeckCards, list.deckSize || list.cards.length);
      const stats = computeStatsFromCards(allDeckCards);

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
      for (const c of allDeckCards) {
        allDeckNames.add(c.name);
        if (c.name.includes(' // ')) allDeckNames.add(c.name.split(' // ')[0]);
      }
      const detectedCombos = rawCombosRef.current.length > 0
        ? detectCombosInDeck(rawCombosRef.current, allDeckNames, currentDeck.commander, currentDeck.partnerCommander)
        : currentDeck.detectedCombos;

      useStore.setState({
        generatedDeck: {
          ...currentDeck,
          categories: enrichResult.categories,
          stats,
          detectedCombos,
          roleCounts: enrichResult.roleCounts,
          roleTargets: enrichResult.roleTargets,
          rampSubtypeCounts: enrichResult.rampSubtypeCounts,
          removalSubtypeCounts: enrichResult.removalSubtypeCounts,
          boardwipeSubtypeCounts: enrichResult.boardwipeSubtypeCounts,
          cardDrawSubtypeCounts: enrichResult.cardDrawSubtypeCounts,
        },
      });
    };

    if (newlyAdded.length > 0) {
      const uniqueNew = [...new Set(newlyAdded)];
      getCardsByNames(uniqueNew).then(cardMap => {
        reEnrich(buildDeckCards(cardMap));
      });
      return;
    }

    // Removals or quantity changes only — no fetch needed
    reEnrich(buildDeckCards());
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

  const pushDeckHistory = useStore(s => s.pushDeckHistory);

  const handleAddToDeck = useCallback((card: ScryfallCard) => {
    if (!onAddCards) return;
    onAddCards([card.name], 'deck');
    pushDeckHistory({ action: 'add', cardName: card.name });
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchResults(false);
  }, [onAddCards, pushDeckHistory]);

  const handleShowBoardPicker = useCallback((card: ScryfallCard, event: React.MouseEvent) => {
    event.stopPropagation();
    setPendingCard(card);
  }, []);

  const handleDestinationPick = useCallback((destination: 'deck' | 'sideboard' | 'maybeboard') => {
    if (!pendingCard || !onAddCards) return;
    onAddCards([pendingCard.name], destination);
    const historyAction = destination === 'sideboard' ? 'sideboard' as const : destination === 'maybeboard' ? 'maybeboard' as const : 'add' as const;
    pushDeckHistory({ action: historyAction, cardName: pendingCard.name });
    setPendingCard(null);
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchResults(false);
  }, [pendingCard, onAddCards, pushDeckHistory]);

  const handleCancelPicker = useCallback(() => {
    setPendingCard(null);
  }, []);

  const handleBulkImport = useCallback((validatedNames: string[]) => {
    if (!onAddCards) return { added: 0, updated: 0 };
    const current = list.cards;
    const currentCounts = new Map<string, number>();
    for (const name of current) {
      currentCounts.set(name, (currentCounts.get(name) ?? 0) + 1);
    }
    const importCounts = new Map<string, number>();
    for (const name of validatedNames) {
      importCounts.set(name, (importCounts.get(name) ?? 0) + 1);
    }
    const newCards: string[] = [];
    let dupeCount = 0;
    for (const [cardName, importQty] of importCounts) {
      const existingQty = currentCounts.get(cardName) ?? 0;
      const toAdd = Math.max(0, importQty - existingQty);
      for (let i = 0; i < toAdd; i++) newCards.push(cardName);
      dupeCount += importQty - toAdd;
    }
    if (newCards.length > 0) {
      onAddCards(newCards, 'deck');
      for (const name of newCards) pushDeckHistory({ action: 'add', cardName: name });
    }
    return { added: newCards.length, updated: dupeCount };
  }, [onAddCards, list.cards, pushDeckHistory]);

  // Board context menu handler
  const handleBoardCardAction = useCallback((card: ScryfallCard, action: CardAction, boardType: 'sideboard' | 'maybeboard') => {
    const name = card.name;
    switch (action.type) {
      case 'remove':
        onRemoveFromBoard?.(name, boardType);
        pushDeckHistory({ action: 'remove', cardName: name });
        break;
      case 'addToDeck':
        onMoveToDeck?.([name], boardType);
        pushDeckHistory({ action: 'add', cardName: name });
        break;
      case 'sideboard':
        // Card is in maybeboard → move to sideboard
        onMoveBetweenBoards?.(name, boardType);
        pushDeckHistory({ action: 'sideboard', cardName: name });
        break;
      case 'maybeboard':
        // Card is in sideboard → move to maybeboard
        onMoveBetweenBoards?.(name, boardType);
        pushDeckHistory({ action: 'maybeboard', cardName: name });
        break;
      case 'mustInclude': {
        const current = customization.mustIncludeCards;
        const has = current.includes(name);
        updateCustomization({ mustIncludeCards: has ? current.filter(n => n !== name) : [...current, name] });
        break;
      }
      case 'exclude': {
        const currentBanned = customization.bannedCards;
        const hasBan = currentBanned.includes(name);
        updateCustomization({ bannedCards: hasBan ? currentBanned.filter(n => n !== name) : [...currentBanned, name] });
        break;
      }
      case 'addToList': {
        const targetList = userLists.find(l => l.id === action.listId);
        if (targetList && !targetList.cards.includes(name)) {
          updateList(action.listId, { cards: [...targetList.cards, name] });
        }
        break;
      }
    }
  }, [onRemoveFromBoard, onMoveToDeck, onMoveBetweenBoards, customization, updateCustomization, userLists, updateList, pushDeckHistory]);

  const boardMenuProps = useMemo(() => ({
    userLists,
    mustIncludeNames: new Set(customization.mustIncludeCards),
    bannedNames: new Set(customization.bannedCards),
  }), [userLists, customization.mustIncludeCards, customization.bannedCards]);

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
        <div className={`fixed inset-0 z-0 overflow-hidden pointer-events-none transition-opacity duration-500 ${deckEditMode ? 'opacity-20' : ''}`}>
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
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex items-center justify-between gap-2">
          {editingName ? (
            <input
              ref={nameInputRef}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={() => {
                const trimmed = nameInput.trim();
                if (trimmed && trimmed !== list.name) onRename?.(trimmed);
                else setNameInput(list.name);
                setEditingName(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') { setNameInput(list.name); setEditingName(false); }
              }}
              className="text-lg font-bold bg-accent border border-border rounded px-2 py-0.5 min-w-0 w-full outline-none text-foreground"
              autoFocus
            />
          ) : (
            <h2
              className="text-lg font-bold truncate min-w-0 cursor-pointer hover:text-muted-foreground transition-colors"
              onClick={() => { setNameInput(list.name); setEditingName(true); }}
              title="Click to rename"
            >
              {list.name}
            </h2>
          )}
          <div className="flex items-center gap-2 shrink-0">
            {list.commanderName && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => navigate(`/build-from-deck/${list.id}`)}
                      className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border bg-card/50 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      Build From Deck
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[240px] text-center">
                    {list.deckSize && list.cards.length !== list.deckSize
                      ? `${list.cards.length}/${list.deckSize} cards — re-generate with the deck builder to ${list.cards.length < list.deckSize ? 'fill the remaining slots' : 'trim to size'} using EDHREC data`
                      : 'Re-generate this deck using the deck builder — keeps your cards as a starting point and optimizes with EDHREC data'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <div className="relative" ref={overflowRef}>
              <button
                onClick={() => setShowOverflow(prev => !prev)}
                className="flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-card/50 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
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
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2"
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
          <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-sm flex-wrap">
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>
              Deck has {list.cards.length} card{list.cards.length !== 1 ? 's' : ''} (expected {list.deckSize})
              {list.cards.length < list.deckSize
                ? ` — ${list.deckSize - list.cards.length} short`
                : ` — ${list.cards.length - list.deckSize} over`}
            </span>
            {onUpdateDeckSize && (
              <button
                onClick={() => onUpdateDeckSize(list.cards.length)}
                className="ml-auto text-xs text-amber-400 hover:text-amber-200 underline underline-offset-2 transition-colors whitespace-nowrap"
              >
                Set expected to {list.cards.length}
              </button>
            )}
          </div>
        )}

        <DeckDisplay
          onRemoveCards={onRemoveCards}
          onAddCards={onAddCards ? (names, _dest) => onAddCards(names, 'deck') : undefined}
          onMoveToSideboard={onMoveToSideboard}
          onMoveToMaybeboard={onMoveToMaybeboard}
          onChangeQuantity={onChangeQuantity}
          boardCounts={{ sideboard: sideboardCards.length, maybeboard: maybeboardCards.length }}
          sideboardNames={list.sideboard}
          maybeboardNames={list.maybeboard}
          onSetSideboard={onSetSideboard}
          onSetMaybeboard={onSetMaybeboard}
          toolbarExtra={onAddCards ? (
            <div className="flex items-center gap-2">
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
                    <div className="absolute bottom-full left-0 mb-1 z-[999] max-h-[280px] min-w-[320px] w-full overflow-auto bg-card border border-border rounded-lg shadow-2xl py-1">
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
                    <div className="absolute bottom-full left-0 mb-1 z-[999] bg-card border border-border rounded-lg shadow-2xl py-1 w-44">
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
              {/* Bulk Add */}
              <Popover open={showBulkAdd} onOpenChange={setShowBulkAdd}>
                <PopoverTrigger asChild>
                  <button
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border bg-card/50 hover:bg-accent transition-colors ${showBulkAdd ? 'text-foreground bg-accent' : 'text-muted-foreground hover:text-foreground'}`}
                    title="Bulk add cards from a list"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Bulk Add</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" className="w-80 sm:w-96 p-4">
                  <CollectionImporter
                    onImportCards={handleBulkImport}
                    label="Bulk Add Cards"
                    updatedLabel="already in deck"
                    onCancel={() => setShowBulkAdd(false)}
                  />
                </PopoverContent>
              </Popover>
            </div>
          ) : undefined}
          onEditModeChange={setDeckEditMode}
          deckFooter={
            <BoardsCollapsible
              sideboardCards={sideboardCards}
              maybeboardCards={maybeboardCards}
              onBoardCardAction={handleBoardCardAction}
              menuProps={boardMenuProps}
            />
          }
        >
          {/* Primer */}
          {(list.primer || onUpdatePrimer) && (
            <div className="relative mt-3 rounded-lg border border-border/50 bg-card/30 px-4 py-3">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Primer</h3>
              {onUpdatePrimer && !editingPrimer && (
                <button
                  onClick={() => { setPrimerDraft(list.primer || ''); setEditingPrimer(true); }}
                  className="absolute top-2.5 right-2.5 p-1.5 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
                  title={list.primer ? 'Edit primer' : 'Add primer'}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
              {editingPrimer ? (
                <div className="space-y-2">
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
                      value={primerDraft}
                      onChange={(e) => setPrimerDraft(e.target.value)}
                      placeholder="Describe your deck's strategy, key combos, win conditions..."
                      className="w-full h-32 px-3 py-2 text-sm bg-background resize-y focus:outline-none"
                      autoFocus
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setEditingPrimer(false)}
                      className="px-2 py-1.5 text-xs text-red-400/70 hover:text-red-400 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        onUpdatePrimer?.(primerDraft.trim());
                        setEditingPrimer(false);
                      }}
                      className="px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : list.primer ? (
                <div className="text-sm text-muted-foreground [&_strong]:text-foreground [&_em]:italic [&_h3]:text-base [&_h4]:text-sm" dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(list.primer) }} />
              ) : (
                <p className="text-sm text-muted-foreground/50 italic">No primer written yet.</p>
              )}
            </div>
          )}
          {generatedDeck?.detectedCombos && generatedDeck.detectedCombos.length > 0 && (
            <ComboDisplay
              combos={generatedDeck.detectedCombos}
              hideMustInclude
              onAddToDeck={onAddCards ? (names) => onAddCards(names, 'deck') : undefined}
              onRemoveFromDeck={onRemoveCards}
              onMoveToSideboard={onMoveToSideboard}
              onMoveToMaybeboard={onMoveToMaybeboard}
            />
          )}
          <TestHand />
        </DeckDisplay>

        {list.commanderName && generatedDeck && (
          <DeckOptimizer
            commanderName={list.commanderName}
            partnerCommanderName={list.partnerCommanderName}
            currentCards={Object.values(generatedDeck.categories).flat()}
            deckSize={(list.deckSize || 100) - 1 - (list.partnerCommanderName ? 1 : 0)}
            roleCounts={generatedDeck.roleCounts || {}}
            roleTargets={generatedDeck.roleTargets || {}}
            categories={generatedDeck.categories}
            cardInclusionMap={generatedDeck.cardInclusionMap}
            onAddCards={onAddCards}
            onRemoveCards={onRemoveCards}
            onRemoveFromBoard={onRemoveFromBoard}
            onAddBasicLand={onChangeQuantity ? (name) => {
              const count = list.cards.filter(c => c === name).length;
              onChangeQuantity(name, count + 1);
            } : undefined}
            onRemoveBasicLand={onChangeQuantity ? (name) => {
              const count = list.cards.filter(c => c === name).length;
              if (count > 0) onChangeQuantity(name, count - 1);
            } : undefined}
            sideboardNames={list.sideboard}
            maybeboardNames={list.maybeboard}
          />
        )}
      </div>
    </>
  );
}
