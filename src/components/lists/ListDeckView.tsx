import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, List, Pencil, CopyPlus, X, Plus, MoreHorizontal, ChevronDown, ChevronRight, ClipboardPaste, Bold, Italic, Heading2, ListOrdered, Minus, Image as ImageIcon, Swords, Scissors, Sparkles, RotateCw, Redo2, Library } from 'lucide-react';
import { FloatingListPanel } from '@/components/lists/FloatingListPanel';
import { SpellChromaIcon } from '@/components/spellchroma/SpellChromaIcon';
import { InspectorIcon } from '@/components/analyze/InspectorIcon';
import { useStore } from '@/store';
import { getCardsByNames, getCardByName, getFrontFaceTypeLine, searchCards, getCardImageUrl, getCardPrice, getCardBackFaceUrl, isDoubleFacedCard } from '@/services/scryfall/client';
import { ManaCost, CardTypeIcon } from '@/components/ui/mtg-icons';
import { fetchCommanderCombos, fetchColorIdentityCombos, formatCommanderNameForUrl } from '@/services/edhrec/client';
import { applyCommanderTheme, resetTheme } from '@/lib/commanderTheme';
import { DeckDisplay, CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import { ComboDisplay } from '@/components/deck/ComboDisplay';
import {
  enrichDeckCards,
  stampTaggerAndGameChangers,
  buildEdhrecMaps,
  buildSwapCandidates,
  type TaggerStampResult,
  type EdhrecMapsResult,
  type SwapCandidatesResult,
} from '@/services/deckBuilder/deckEnricher';
import { getBaseRoleTargets } from '@/services/deckBuilder/roleTargets';
import {
  readEnrichmentCache,
  writeEnrichmentCache,
  deleteEnrichmentCache,
  touchEnrichmentCache,
  computeContentHash,
  isCacheFresh,
  cacheMatchesCommander,
} from '@/services/deckBuilder/deckEnrichmentCache';
import { CollectionImporter, type CollectionImporterHandle } from '@/components/collection/CollectionImporter';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { trackEvent } from '@/services/analytics';
import type { UserCardList, ScryfallCard, GeneratedDeck, DeckStats, DetectedCombo, EDHRECCombo, LoadPhase, SerializedEnrichment } from '@/types';
import { useUserLists } from '@/hooks/useUserLists';
import { TrimDeckDialog } from './TrimDeckDialog';
import { FillDeckDialog } from './FillDeckDialog';
import { Drawer } from '@/components/ui/drawer';
import { MustIncludeCards } from '@/components/customization/MustIncludeCards';
import { getMaxCopies } from '@/lib/utils';

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
      // ![alt](url) — only http(s) URLs render; anything else falls back to the alt text
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, url: string) => {
        const clean = url.trim();
        if (!/^https?:\/\//i.test(clean)) return alt;
        const safeUrl = clean.replace(/"/g, '%22');
        const safeAlt = alt.replace(/"/g, '');
        return `<img src="${safeUrl}" alt="${safeAlt}" class="max-w-full h-auto rounded-md my-2" loading="lazy" />`;
      })
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
  combos: EDHRECCombo[],
  allCardNames: Set<string>,
  commanderCard: ScryfallCard | null,
  partnerCard: ScryfallCard | null,
): DetectedCombo[] | undefined {
  if (combos.length === 0) return undefined;

  // Defensive dedupe by card set. The same combo is surfaced more than once two
  // ways: (1) EDHREC lists a card set as multiple combo entries that differ only
  // by a result-variant suffix in the comboId ("3470-5702--143" vs "--131"), and
  // (2) the same combo appears on both the commander page (source 'commander')
  // and the color-identity page (source 'color-identity'). Keying on comboId
  // misses case (1) entirely, so dedupe on the card set instead. Callers list
  // commander-source combos first, so keeping the first occurrence preserves the
  // commander provenance and drops the duplicate "Synergy" copy.
  const seenCardSets = new Set<string>();
  const uniqueCombos = combos.filter(c => {
    const key = c.cards.map(card => card.name).sort().join('|');
    if (seenCardSets.has(key)) return false;
    seenCardSets.add(key);
    return true;
  });

  const detected = uniqueCombos
    .map(combo => {
      const comboCardNames = combo.cards.map(c => c.name);
      const missingCards = comboCardNames.filter(name => !allCardNames.has(name));
      const source = combo.source ?? 'commander';
      return {
        comboId: combo.comboId,
        cards: comboCardNames,
        results: combo.results,
        isComplete: missingCards.length === 0,
        missingCards,
        deckCount: combo.deckCount,
        bracket: combo.bracket,
        source,
      } as DetectedCombo;
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

// Defensive card-set dedupe for combos coming straight out of the enrichment
// cache. Fresh detection flows through detectCombosInDeck (which dedupes), but
// hydrateFromCache trusts payload.detectedCombos verbatim — and a payload written
// by an older build can list the same card set twice (EDHREC gives one card set
// several comboIds that differ only by a result-variant suffix). Surfacing both
// renders the combo twice and warns about duplicate React keys, so dedupe on the
// way out of the cache. Card set, not comboId, is the key — that's what makes
// the duplicates duplicates.
function dedupeCombosByCardSet(combos: DetectedCombo[] | undefined): DetectedCombo[] | undefined {
  if (!combos || combos.length === 0) return combos;
  const seen = new Set<string>();
  const unique = combos.filter(c => {
    const key = [...c.cards].sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.length === combos.length ? combos : unique;
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
      <span className="text-xs w-10 text-right shrink-0 text-muted-foreground">{price}</span>
    </div>
  );
}

// --- Board Add Popover (search + add a card directly to a board) ---

function BoardAddPopover({ boardType, colorIdentity, existingNames, onAdd }: {
  boardType: 'sideboard' | 'maybeboard';
  colorIdentity: string[];
  existingNames: Set<string>;
  onAdd: (cardName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchCards(query, colorIdentity, { order: 'edhrec' });
        setResults(r.data.filter(c => !existingNames.has(c.name)).slice(0, 8));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, colorIdentity, existingNames]);

  const headerColor = boardType === 'sideboard' ? 'text-amber-400' : 'text-purple-400';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`p-0.5 rounded ${headerColor} hover:bg-accent/50 transition-colors`}
          title={`Add card to ${boardType}`}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="relative">
          <input
            autoFocus
            type="text"
            placeholder={`Add to ${boardType}...`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="bg-card/50 border border-border/50 rounded-md px-2 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
          />
          {searching && (
            <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-primary" />
          )}
        </div>
        {results.length > 0 && (
          <div className="mt-2 max-h-[280px] overflow-auto">
            {results.map(card => (
              <button
                key={card.id}
                onClick={() => { onAdd(card.name); setOpen(false); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-accent/50 text-left transition-colors rounded"
              >
                <img src={getCardImageUrl(card, 'small')} alt={card.name} className="w-7 h-auto rounded shrink-0" loading="lazy" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{card.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{card.type_line}</p>
                </div>
                <Plus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// --- Board Section (Sideboard / Maybeboard) ---

function BoardSection({ title, cards, boardType, onCardAction, menuProps, onAdd, colorIdentity, existingNames }: {
  title: string;
  cards: ScryfallCard[];
  boardType: 'sideboard' | 'maybeboard';
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string> };
  onAdd?: (cardName: string) => void;
  colorIdentity?: string[];
  existingNames?: Set<string>;
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
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">${totalPrice.toFixed(2)}</span>
          {onAdd && colorIdentity && existingNames && (
            <BoardAddPopover
              boardType={boardType}
              colorIdentity={colorIdentity}
              existingNames={existingNames}
              onAdd={onAdd}
            />
          )}
        </div>
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

function BoardsCollapsible({ sideboardCards, maybeboardCards, onBoardCardAction, menuProps, onAddToBoard, colorIdentity, existingNames, viewShiftControls }: {
  sideboardCards: ScryfallCard[];
  maybeboardCards: ScryfallCard[];
  onBoardCardAction?: (card: ScryfallCard, action: CardAction, boardType: 'sideboard' | 'maybeboard') => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string> };
  onAddToBoard?: (cardName: string, boardType: 'sideboard' | 'maybeboard') => void;
  colorIdentity?: string[];
  existingNames?: Set<string>;
  viewShiftControls?: React.ReactNode;
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
      <div className="flex items-center px-4 py-2.5 gap-2">
        <button
          onClick={toggle}
          className="flex items-center gap-2 text-left rounded hover:bg-accent/30 -mx-1 px-1 py-0.5 transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          <span className="text-xs font-semibold text-foreground">
            Sideboard & Maybeboard
          </span>
          <span className="text-[10px] text-muted-foreground">({totalCount})</span>
        </button>
        {viewShiftControls && (
          <div className="ml-auto">{viewShiftControls}</div>
        )}
      </div>
      {!collapsed && (
        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <BoardSection
            title="Sideboard"
            cards={sideboardCards}
            boardType="sideboard"
            onCardAction={handleSBAction}
            menuProps={menuProps}
            onAdd={onAddToBoard ? (name) => onAddToBoard(name, 'sideboard') : undefined}
            colorIdentity={colorIdentity}
            existingNames={existingNames}
          />
          <BoardSection
            title="Maybeboard"
            cards={maybeboardCards}
            boardType="maybeboard"
            onCardAction={handleMBAction}
            menuProps={menuProps}
            onAdd={onAddToBoard ? (name) => onAddToBoard(name, 'maybeboard') : undefined}
            colorIdentity={colorIdentity}
            existingNames={existingNames}
          />
        </div>
      )}
    </div>
  );
}

// --- Main Component ---

// Derive the primary card type (for CardTypeIcon) from a Scryfall type_line.
// "Legendary Artifact Creature — Golem" → "creature". Creature wins so the
// claw shows for artifact/enchantment creatures.
function primaryTypeFromLine(typeLine: string | undefined): string {
  const tl = (typeLine || '').split('//')[0].split('—')[0].toLowerCase();
  const order = ['creature', 'planeswalker', 'land', 'battle', 'artifact', 'enchantment', 'instant', 'sorcery', 'tribal'];
  return order.find(t => tl.includes(t)) || 'creature';
}

export function ListDeckView({ list, onBack, onViewAsList, onEdit, onDuplicate, onRemoveCards, onAddCards, onMoveToSideboard, onMoveToMaybeboard, onMoveToDeck, onRemoveFromBoard, onMoveBetweenBoards, onUpdatePrimer, onChangeQuantity, onRename, onUpdateDeckSize, onSetSideboard, onSetMaybeboard }: ListDeckViewProps) {
  const navigate = useNavigate();
  const generatedDeck = useStore(s => s.generatedDeck);
  const trimReady = !!(
    generatedDeck?.cardRelevancyMap &&
    generatedDeck?.cardInclusionMap &&
    generatedDeck?.roleTargets &&
    generatedDeck?.edhrecCurve &&
    generatedDeck?.edhrecTypes
  );
  const fillReady = !!(generatedDeck?.gapAnalysis && generatedDeck.gapAnalysis.length > 0);
  const allDeckCards = useMemo<ScryfallCard[]>(
    () => generatedDeck ? Object.values(generatedDeck.categories).flat() : [],
    [generatedDeck],
  );
  const colorIdentity = useStore(s => s.colorIdentity) || [];
  // Color-identity violations — derive the commander's identity from the
  // loaded ScryfallCards so we don't show false positives during store rehydration.
  const colorIdentityViolations = useMemo(() => {
    if (!list.commanderName) return [];
    const commanderCard = generatedDeck?.commander;
    const partnerCard = generatedDeck?.partnerCommander;
    if (!commanderCard) return [];
    const allowed = new Set<string>([
      ...(commanderCard.color_identity || []),
      ...((list.partnerCommanderName && partnerCard?.color_identity) || []),
    ]);
    const cards: ScryfallCard[] = generatedDeck ? Object.values(generatedDeck.categories).flat() : [];
    return cards.filter(c => (c.color_identity || []).some(color => !allowed.has(color)));
  }, [generatedDeck, list.commanderName, list.partnerCommanderName]);

  // Singleton violations — duplicate non-basic cards. Uses getMaxCopies() so
  // basics and "any number" / capped multi-copy cards are recognized from card
  // data (oracle text + type line), not a hardcoded allowlist.
  const duplicateNonBasics = useMemo(() => {
    if (allDeckCards.length === 0) return [];
    const cardByName = new Map<string, ScryfallCard>();
    for (const c of allDeckCards) cardByName.set(c.name, c);
    const counts: Record<string, number> = {};
    for (const name of list.cards) {
      const card = cardByName.get(name);
      if (!card) continue;
      if (getMaxCopies(card) > 1) continue;
      counts[name] = (counts[name] || 0) + 1;
    }
    return Object.entries(counts)
      .filter(([, n]) => n > 1)
      .map(([name, n]) => ({ name, count: n }));
  }, [list.cards, allDeckCards]);

  const customization = useStore(s => s.customization);
  const updateCustomization = useStore(s => s.updateCustomization);
  const { lists: userLists, updateList, createList } = useUserLists();

  const [phasesDone, setPhasesDone] = useState<Set<LoadPhase>>(new Set());
  const markPhaseDone = useCallback((p: LoadPhase) => {
    setPhasesDone(prev => {
      if (prev.has(p)) return prev;
      const next = new Set(prev);
      next.add(p);
      return next;
    });
  }, []);

  // Must-include cards that are missing from the deck. customization is the
  // global preference set, so this only applies to decks (not generic lists).
  const customizationForMustInclude = useStore(s => s.customization);
  const missingMustIncludes = useMemo(() => {
    if (list.type !== 'deck') return [];
    // Only flag for freshly-generated decks. generationSummary is cleared on
    // the first edit, so user-saved decks (or generated-then-edited decks)
    // are exempt — the user has clearly taken authorship of the contents.
    if (!list.generationSummary) return [];
    const mustInclude = customizationForMustInclude.mustIncludeCards || [];
    if (mustInclude.length === 0) return [];
    const present = new Set<string>(list.cards);
    if (list.commanderName) present.add(list.commanderName);
    if (list.partnerCommanderName) present.add(list.partnerCommanderName);
    // Allow front-face matches for DFC names ("Fire" matching "Fire // Ice")
    const presentFrontFaces = new Set<string>();
    for (const n of present) {
      if (n.includes(' // ')) presentFrontFaces.add(n.split(' // ')[0]);
    }
    return mustInclude.filter(name => !present.has(name) && !presentFrontFaces.has(name));
  }, [list.type, list.generationSummary, list.cards, list.commanderName, list.partnerCommanderName, customizationForMustInclude.mustIncludeCards]);

  // Unloaded cards — names in list.cards that don't appear in the loaded
  // categories (typically Scryfall lookup failures from typos or renamed cards).
  // Gated on phasesDone.has('cards') so we don't flag everything during loading.
  const unloadedCards = useMemo(() => {
    if (!phasesDone.has('cards')) return [];
    const loadedNames = new Set<string>();
    const addLoaded = (n: string) => {
      loadedNames.add(n);
      if (n.includes(' // ')) loadedNames.add(n.split(' // ')[0]);
    };
    if (generatedDeck) {
      for (const c of Object.values(generatedDeck.categories).flat()) {
        addLoaded(c.name);
      }
      // Commander and partner live outside categories — count them as loaded
      // so their names don't get flagged when present in list.cards.
      if (generatedDeck.commander) addLoaded(generatedDeck.commander.name);
      if (generatedDeck.partnerCommander) addLoaded(generatedDeck.partnerCommander.name);
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const name of list.cards) {
      if (loadedNames.has(name)) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
    return out;
  }, [list.cards, generatedDeck, phasesDone]);

  const [refreshCounter, setRefreshCounter] = useState(0);
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

  // Controlled popover for color-identity violations (so "Remove all" can close it)
  const [offendersOpen, setOffendersOpen] = useState(false);

  const [listsPanelOpen, setListsPanelOpen] = useState(false);

  // Total deck price
  const totalDeckPrice = useMemo(() => {
    if (!generatedDeck) return null;
    const allCards = Object.values(generatedDeck.categories).flat();
    const commanders = [generatedDeck.commander, generatedDeck.partnerCommander].filter(Boolean) as ScryfallCard[];
    return [...commanders, ...allCards].reduce((sum, c) => {
      const price = parseFloat(getCardPrice(c, customization.currency) || '0');
      return sum + (isNaN(price) ? 0 : price);
    }, 0);
  }, [generatedDeck, customization.currency]);
  const priceSym = customization.currency === 'EUR' ? '€' : '$';

  // Action toast with undo (for add/remove cards)
  const [actionToast, setActionToast] = useState<{ message: string; onUndo?: () => void; kind?: 'success' | 'error'; cardType?: string } | null>(null);
  const [deckSizeNoticeDismissedAt, setDeckSizeNoticeDismissedAt] = useState<number | null>(null);
  // Split open / mounted so the drawer can play its CSS slide-out before unmounting.
  const [trimDialogOpen, setTrimDialogOpen] = useState(false);
  const [trimDialogMounted, setTrimDialogMounted] = useState(false);
  const openTrimDialog = useCallback(() => {
    setTrimDialogMounted(true);
    // Defer flipping the open flag so the drawer starts at translate-x-full
    // for one frame, then transitions to translate-x-0 — that's the slide-in.
    requestAnimationFrame(() => setTrimDialogOpen(true));
  }, []);
  const closeTrimDialog = useCallback(() => {
    setTrimDialogOpen(false);
    // Match the Drawer's duration-300 transition before unmounting.
    setTimeout(() => setTrimDialogMounted(false), 320);
  }, []);
  const [fillDialogOpen, setFillDialogOpen] = useState(false);
  const [fillDialogMounted, setFillDialogMounted] = useState(false);
  const openFillDialog = useCallback(() => {
    setFillDialogMounted(true);
    requestAnimationFrame(() => setFillDialogOpen(true));
  }, []);
  const closeFillDialog = useCallback(() => {
    setFillDialogOpen(false);
    setTimeout(() => setFillDialogMounted(false), 320);
  }, []);

  // Makes the "Cards" stat in the deck-stats sidebar a one-click entry to the
  // fill/trim drawer. delta < 0 → short (Fill); delta >= 0 → over or at target
  // (Trim; at exactly target the Trim drawer opens in fine-tune/swap mode).
  const cardCountAction = useMemo(() => {
    if (!list.deckSize) return undefined;
    const delta = list.cards.length - list.deckSize;
    const ready = delta < 0
      ? fillReady && !!onAddCards
      : trimReady && !!list.commanderName && !!onMoveToMaybeboard;
    return {
      delta,
      ready,
      onClick: () => { if (delta < 0) openFillDialog(); else openTrimDialog(); },
    };
  }, [list.deckSize, list.cards.length, list.commanderName, fillReady, trimReady, onAddCards, onMoveToMaybeboard, openFillDialog, openTrimDialog]);
  const [mustIncludeDrawerOpen, setMustIncludeDrawerOpen] = useState(false);
  const [mustIncludeDrawerMounted, setMustIncludeDrawerMounted] = useState(false);
  const openMustIncludeDrawer = useCallback(() => {
    setMustIncludeDrawerMounted(true);
    requestAnimationFrame(() => setMustIncludeDrawerOpen(true));
  }, []);
  const closeMustIncludeDrawer = useCallback(() => {
    setMustIncludeDrawerOpen(false);
    setTimeout(() => setMustIncludeDrawerMounted(false), 320);
  }, []);
  const actionToastTimer = useRef<ReturnType<typeof setTimeout>>();
  const onRemoveCardsRef = useRef(onRemoveCards);
  onRemoveCardsRef.current = onRemoveCards;
  const onAddCardsRef = useRef(onAddCards);
  onAddCardsRef.current = onAddCards;
  const onRemoveFromBoardRef = useRef(onRemoveFromBoard);
  onRemoveFromBoardRef.current = onRemoveFromBoard;
  const showActionToast = useCallback((message: string, onUndo: () => void, cardType?: string) => {
    clearTimeout(actionToastTimer.current);
    setActionToast({ message, onUndo, kind: 'success', cardType });
    actionToastTimer.current = setTimeout(() => setActionToast(null), 4000);
  }, []);
  const showErrorToast = useCallback((message: string) => {
    clearTimeout(actionToastTimer.current);
    setActionToast({ message, kind: 'error' });
    actionToastTimer.current = setTimeout(() => setActionToast(null), 4000);
  }, []);
  const handleUndoAction = useCallback(() => {
    if (!actionToast?.onUndo) return;
    actionToast.onUndo();
    setActionToast(null);
  }, [actionToast]);

  // Wrapped remove handler that shows toast with undo. Callers (DeckDisplay,
  // ComboDisplay wrappers) are responsible for pushing the matching 'remove'
  // history entry — wrapping it here would double-push for DeckDisplay, which
  // already records history before calling onRemoveCards.
  const handleRemoveCardsWithToast = useMemo(() => {
    if (!onRemoveCards) return undefined;
    return (names: string[]) => {
      onRemoveCards(names);
      const label = names.length === 1 ? `Removed ${names[0]}` : `Removed ${names.length} cards`;
      showActionToast(label, () => {
        onAddCardsRef.current?.(names, 'deck');
        useStore.getState().popLatestHistoryEntries('remove', names);
      });
    };
  }, [onRemoveCards, showActionToast]);

  // Card search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ScryfallCard[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchWrapperRef = useRef<HTMLDivElement>(null);

  // Destination picker state
  const [pendingCard, setPendingCard] = useState<ScryfallCard | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<{ top: number; left: number } | null>(null);

  // Bulk add state
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const bulkAddRef = useRef<HTMLDivElement>(null);
  // Desktop floating panel and mobile inline panel both mount when
  // showBulkAdd is true (CSS hides one); each needs its own ref.
  const bulkImporterDesktopRef = useRef<CollectionImporterHandle>(null);
  const bulkImporterMobileRef = useRef<CollectionImporterHandle>(null);
  // Closing the bulk-add panel must not silently drop pasted-but-unimported
  // text. If text is pending, trigger the import first; only keep the panel
  // open if the import surfaced errors the user should see.
  const closeBulkAddImporting = useCallback(async () => {
    const desktop = bulkImporterDesktopRef.current;
    const mobile = bulkImporterMobileRef.current;
    const pending = desktop?.hasPending() ? desktop : mobile?.hasPending() ? mobile : null;
    if (pending) {
      const result = await pending.triggerImport();
      if (result && result.notFound.length > 0) return;
    }
    setShowBulkAdd(false);
  }, []);

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
  const rawCombosRef = useRef<EDHRECCombo[]>([]);

  // Full build — only on initial mount / list.id change / manual refresh
  useEffect(() => {
    let cancelled = false;
    isInitialLoadDone.current = false;

    // Persist enrichment result + boards to the cache.
    async function persistCache(args: {
      commanderCard: ScryfallCard | null;
      partnerCard: ScryfallCard | null;
      deckCards: ScryfallCard[];
      sbCards: ScryfallCard[];
      mbCards: ScryfallCard[];
      stats: DeckStats;
      taggerResult: TaggerStampResult;
      edhrecResult: EdhrecMapsResult;
      swapsResult: SwapCandidatesResult;
      detectedCombos: DetectedCombo[] | undefined;
    }) {
      const mergedRelevancy = args.edhrecResult.cardRelevancyMap
        ? { ...args.edhrecResult.cardRelevancyMap, ...(args.swapsResult.candidateRelevancyMap ?? {}) }
        : args.swapsResult.candidateRelevancyMap;
      const payload: SerializedEnrichment = {
        commanderCard: args.commanderCard,
        partnerCard: args.partnerCard,
        deckCards: args.deckCards,
        sideboardCards: args.sbCards,
        maybeboardCards: args.mbCards,
        stats: args.stats,
        categories: args.taggerResult.categories,
        roleCounts: args.taggerResult.roleCounts,
        roleTargets: args.edhrecResult.roleTargets,
        rampSubtypeCounts: args.taggerResult.rampSubtypeCounts,
        removalSubtypeCounts: args.taggerResult.removalSubtypeCounts,
        boardwipeSubtypeCounts: args.taggerResult.boardwipeSubtypeCounts,
        cardDrawSubtypeCounts: args.taggerResult.cardDrawSubtypeCounts,
        protectionSubtypeCounts: args.taggerResult.protectionSubtypeCounts,
        bracketEstimation: args.taggerResult.bracketEstimation,
        gameChangerNames: args.taggerResult.gameChangerNames,
        cardInclusionMap: args.edhrecResult.cardInclusionMap,
        cardSynergyMap: args.edhrecResult.cardSynergyMap,
        cardRelevancyMap: mergedRelevancy,
        cardEdhrecMetaMap: args.edhrecResult.cardEdhrecMetaMap,
        deckScore: args.edhrecResult.deckScore,
        gapAnalysis: args.edhrecResult.gapAnalysis,
        swapCandidates: args.swapsResult.swapCandidates,
        edhrecCurve: args.edhrecResult.edhrecCurve,
        edhrecTypes: args.edhrecResult.edhrecTypes,
        detectedCombos: args.detectedCombos,
        rawCombos: rawCombosRef.current,
      };
      await writeEnrichmentCache({
        listId: list.id,
        commanderName: list.commanderName ?? null,
        partnerName: list.partnerCommanderName ?? null,
        contentHash: computeContentHash(list.cards),
        cachedAt: Date.now(),
        lastAccessed: Date.now(),
        payload,
      });
    }

    function hydrateFromCache(payload: SerializedEnrichment) {
      setSideboardCards(payload.sideboardCards);
      setMaybeboardCards(payload.maybeboardCards);
      setArtUrl(getArtCropUrl(payload.commanderCard));
      // Restore the raw combo pool so incremental updates (add/remove a missing
      // combo card) can re-evaluate completeness instead of falling back to the
      // stale detectedCombos array.
      rawCombosRef.current = payload.rawCombos ?? [];
      const syntheticDeck: GeneratedDeck = {
        commander: payload.commanderCard,
        partnerCommander: payload.partnerCard,
        categories: payload.categories,
        stats: payload.stats,
        detectedCombos: dedupeCombosByCardSet(payload.detectedCombos),
        roleCounts: payload.roleCounts,
        roleTargets: payload.roleTargets,
        rampSubtypeCounts: payload.rampSubtypeCounts,
        removalSubtypeCounts: payload.removalSubtypeCounts,
        boardwipeSubtypeCounts: payload.boardwipeSubtypeCounts,
        cardDrawSubtypeCounts: payload.cardDrawSubtypeCounts,
        protectionSubtypeCounts: payload.protectionSubtypeCounts,
        bracketEstimation: payload.bracketEstimation,
        gameChangerNames: payload.gameChangerNames,
        cardInclusionMap: payload.cardInclusionMap,
        cardSynergyMap: payload.cardSynergyMap,
        cardRelevancyMap: payload.cardRelevancyMap,
        cardEdhrecMetaMap: payload.cardEdhrecMetaMap,
        deckScore: payload.deckScore,
        gapAnalysis: payload.gapAnalysis,
        swapCandidates: payload.swapCandidates,
        edhrecCurve: payload.edhrecCurve,
        edhrecTypes: payload.edhrecTypes,
      };
      const allColors = new Set<string>();
      const allCardsForColor: ScryfallCard[] = [...payload.deckCards];
      if (payload.commanderCard) allCardsForColor.push(payload.commanderCard);
      if (payload.partnerCard) allCardsForColor.push(payload.partnerCard);
      for (const card of allCardsForColor) {
        for (const c of card.color_identity || []) allColors.add(c);
      }
      const colorArray = [...allColors];
      useStore.setState({
        commander: payload.commanderCard,
        colorIdentity: colorArray,
        generatedDeck: syntheticDeck,
        deckHistory: [],
      });
      if (colorArray.length > 0) applyCommanderTheme(colorArray);
      prevCardsRef.current = list.cards;
      isInitialLoadDone.current = true;
    }

    async function coldLoad() {
      // --- Phase A: Scryfall card fetch ---
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
        return;
      }

      let commanderCard: ScryfallCard | null = null;
      let partnerCard: ScryfallCard | null = null;
      if (list.commanderName) commanderCard = cardMap.get(list.commanderName) ?? null;
      if (list.partnerCommanderName) partnerCard = cardMap.get(list.partnerCommanderName) ?? null;
      setArtUrl(getArtCropUrl(commanderCard));

      const commanderNames = new Set<string>();
      if (commanderCard) commanderNames.add(commanderCard.name);
      if (partnerCard) commanderNames.add(partnerCard.name);

      const deckCards = commanderNames.size > 0
        ? cards.filter(c => !commanderNames.has(c.name))
        : cards;

      const stats = computeStatsFromCards(deckCards);

      const allColors = new Set<string>();
      for (const card of cards) {
        for (const c of card.color_identity || []) allColors.add(c);
      }
      const colorArray = [...allColors];

      // Phase A paint: deck list + stats + curve, all non-commander cards
      // temporarily piled in `creatures` so list rendering can start.
      // Phase B (tagger) re-bins them properly.
      useStore.setState({
        commander: commanderCard,
        colorIdentity: colorArray,
        generatedDeck: {
          commander: commanderCard,
          partnerCommander: partnerCard,
          categories: {
            lands: [], ramp: [], cardDraw: [], singleRemoval: [],
            boardWipes: [], protection: [], creatures: deckCards, synergy: [], utility: [],
          },
          stats,
        } as GeneratedDeck,
        deckHistory: [],
      });
      if (colorArray.length > 0) applyCommanderTheme(colorArray);
      markPhaseDone('cards');

      // --- Phase B: tagger + game changers ---
      const taggerResult = await stampTaggerAndGameChangers(deckCards);
      if (cancelled) return;
      useStore.setState(state => ({
        generatedDeck: state.generatedDeck ? {
          ...state.generatedDeck,
          categories: taggerResult.categories,
          roleCounts: taggerResult.roleCounts,
          rampSubtypeCounts: taggerResult.rampSubtypeCounts,
          removalSubtypeCounts: taggerResult.removalSubtypeCounts,
          boardwipeSubtypeCounts: taggerResult.boardwipeSubtypeCounts,
          cardDrawSubtypeCounts: taggerResult.cardDrawSubtypeCounts,
          protectionSubtypeCounts: taggerResult.protectionSubtypeCounts,
          bracketEstimation: taggerResult.bracketEstimation,
          gameChangerNames: taggerResult.gameChangerNames,
        } : null,
      }));
      markPhaseDone('tagger');

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
      const listColors = new Set<string>();
      for (const c of cards) for (const ci of c.color_identity || []) listColors.add(ci.toUpperCase());
      const listColorArray = ['W', 'U', 'B', 'R', 'G'].filter(c => listColors.has(c));

      // --- Phase D₁: combos (starts in parallel with C below) ---
      const combosPromise: Promise<DetectedCombo[] | undefined> = (async () => {
        try {
          const [a, b] = await Promise.all([
            commanderCard ? fetchCommanderCombos(commanderCard.name).catch(() => [] as EDHRECCombo[]) : Promise.resolve([] as EDHRECCombo[]),
            fetchColorIdentityCombos(listColorArray).catch(() => [] as EDHRECCombo[]),
          ]);
          const cmdCombos: EDHRECCombo[] = a.map(c => ({ ...c, source: 'commander' as const }));
          const colCombos: EDHRECCombo[] = b.map(c => ({ ...c, source: 'color-identity' as const }));
          const byId = new Map<string, EDHRECCombo>();
          for (const c of cmdCombos) byId.set(c.comboId, c);
          for (const c of colCombos) if (!byId.has(c.comboId)) byId.set(c.comboId, c);
          const merged = [...byId.values()];
          rawCombosRef.current = merged;
          const detected = detectCombosInDeck(merged, allDeckNames, commanderCard, partnerCard);
          if (!cancelled) {
            useStore.setState(state => ({
              generatedDeck: state.generatedDeck ? { ...state.generatedDeck, detectedCombos: detected } : null,
            }));
          }
          return detected;
        } catch {
          return undefined;
        } finally {
          if (!cancelled) markPhaseDone('combos');
        }
      })();

      // --- No-commander branch: skip phases C and D₂ ---
      if (!commanderCard) {
        markPhaseDone('edhrec');
        markPhaseDone('swaps');
        const detectedNoCmdr = await combosPromise;
        if (cancelled) return;
        const fallbackEdhrec: EdhrecMapsResult = {
          roleTargets: getBaseRoleTargets(list.deckSize || list.cards.length),
        };
        // Roles render off roleTargets — push it to the store so no-commander
        // decks show the role breakdown (roleCounts came from the tagger phase).
        useStore.setState(state => ({
          generatedDeck: state.generatedDeck
            ? { ...state.generatedDeck, roleTargets: fallbackEdhrec.roleTargets }
            : null,
        }));
        await persistCache({
          commanderCard, partnerCard, deckCards, sbCards, mbCards, stats,
          taggerResult, edhrecResult: fallbackEdhrec, swapsResult: {},
          detectedCombos: detectedNoCmdr,
        });
        prevCardsRef.current = list.cards;
        isInitialLoadDone.current = true;
        return;
      }

      // Wait for combos so EDHREC scoring sees combo context.
      const detectedFromCombos = await combosPromise;
      if (cancelled) return;

      // --- Phase C: EDHREC maps ---
      const edhrecResult = await buildEdhrecMaps(
        taggerResult,
        list.deckSize || list.cards.length,
        detectedFromCombos,
        commanderCard.name,
        partnerCard?.name,
      );
      if (cancelled) return;
      useStore.setState(state => ({
        generatedDeck: state.generatedDeck ? {
          ...state.generatedDeck,
          roleTargets: edhrecResult.roleTargets,
          cardInclusionMap: edhrecResult.cardInclusionMap,
          cardSynergyMap: edhrecResult.cardSynergyMap,
          cardRelevancyMap: edhrecResult.cardRelevancyMap,
          cardEdhrecMetaMap: edhrecResult.cardEdhrecMetaMap,
          deckScore: edhrecResult.deckScore,
          gapAnalysis: edhrecResult.gapAnalysis,
          edhrecCurve: edhrecResult.edhrecCurve,
          edhrecTypes: edhrecResult.edhrecTypes,
        } : null,
      }));
      markPhaseDone('edhrec');

      // --- Phase D₂: swap candidates ---
      const swapsResult = await buildSwapCandidates(
        deckCards,
        taggerResult,
        edhrecResult,
        commanderCard.name,
        partnerCard?.name,
      );
      if (cancelled) return;
      useStore.setState(state => {
        if (!state.generatedDeck) return state;
        const mergedRelevancy = state.generatedDeck.cardRelevancyMap
          ? { ...state.generatedDeck.cardRelevancyMap, ...(swapsResult.candidateRelevancyMap ?? {}) }
          : swapsResult.candidateRelevancyMap;
        return {
          generatedDeck: {
            ...state.generatedDeck,
            swapCandidates: swapsResult.swapCandidates,
            cardRelevancyMap: mergedRelevancy,
          },
        };
      });
      markPhaseDone('swaps');

      await persistCache({
        commanderCard, partnerCard, deckCards, sbCards, mbCards, stats,
        taggerResult, edhrecResult, swapsResult,
        detectedCombos: detectedFromCombos,
      });
      prevCardsRef.current = list.cards;
      isInitialLoadDone.current = true;
    }

    async function backgroundRefresh() {
      try {
        const allNames = [...list.cards, ...(list.sideboard || []), ...(list.maybeboard || [])];
        const cardMap = await getCardsByNames(allNames);
        if (cancelled) return;

        const cards: ScryfallCard[] = [];
        for (const name of list.cards) {
          const card = cardMap.get(name);
          if (card) cards.push(card);
        }
        const sbCards: ScryfallCard[] = [];
        for (const name of (list.sideboard || [])) {
          const card = cardMap.get(name);
          if (card) sbCards.push(card);
        }
        const mbCards: ScryfallCard[] = [];
        for (const name of (list.maybeboard || [])) {
          const card = cardMap.get(name);
          if (card) mbCards.push(card);
        }
        if (cards.length === 0) return;

        let commanderCard: ScryfallCard | null = null;
        let partnerCard: ScryfallCard | null = null;
        if (list.commanderName) commanderCard = cardMap.get(list.commanderName) ?? null;
        if (list.partnerCommanderName) partnerCard = cardMap.get(list.partnerCommanderName) ?? null;

        const commanderNames = new Set<string>();
        if (commanderCard) commanderNames.add(commanderCard.name);
        if (partnerCard) commanderNames.add(partnerCard.name);
        const deckCards = commanderNames.size > 0 ? cards.filter(c => !commanderNames.has(c.name)) : cards;
        const stats = computeStatsFromCards(deckCards);

        const taggerResult = await stampTaggerAndGameChangers(deckCards);
        if (cancelled) return;

        let edhrecResult: EdhrecMapsResult = {
          roleTargets: getBaseRoleTargets(list.deckSize || list.cards.length),
        };
        let swapsResult: SwapCandidatesResult = {};
        let detectedCombos: DetectedCombo[] | undefined;

        // Combos run regardless of commander — no-commander decks still pull
        // color-identity combos for their colors. (Gating this on commander used
        // to wipe the cached combos coldLoad had written.)
        {
          const allDeckNames = new Set<string>();
          if (commanderCard) allDeckNames.add(commanderCard.name);
          if (partnerCard) allDeckNames.add(partnerCard.name);
          for (const c of deckCards) allDeckNames.add(c.name);
          const listColors = new Set<string>();
          for (const c of cards) for (const ci of c.color_identity || []) listColors.add(ci.toUpperCase());
          const listColorArray = ['W', 'U', 'B', 'R', 'G'].filter(c => listColors.has(c));
          try {
            const [a, b] = await Promise.all([
              commanderCard
                ? fetchCommanderCombos(commanderCard.name).catch(() => [] as EDHRECCombo[])
                : Promise.resolve([] as EDHRECCombo[]),
              fetchColorIdentityCombos(listColorArray).catch(() => [] as EDHRECCombo[]),
            ]);
            const merged: EDHRECCombo[] = [
              ...a.map(c => ({ ...c, source: 'commander' as const })),
              ...b.map(c => ({ ...c, source: 'color-identity' as const })),
            ];
            rawCombosRef.current = merged;
            detectedCombos = detectCombosInDeck(merged, allDeckNames, commanderCard, partnerCard);
          } catch { /* non-critical */ }
          if (cancelled) return;
        }

        if (commanderCard) {
          edhrecResult = await buildEdhrecMaps(
            taggerResult,
            list.deckSize || list.cards.length,
            detectedCombos,
            commanderCard.name,
            partnerCard?.name,
          );
          if (cancelled) return;
          swapsResult = await buildSwapCandidates(
            deckCards,
            taggerResult,
            edhrecResult,
            commanderCard.name,
            partnerCard?.name,
          );
          if (cancelled) return;
        }

        await persistCache({
          commanderCard, partnerCard, deckCards, sbCards, mbCards, stats,
          taggerResult, edhrecResult, swapsResult, detectedCombos,
        });
      } catch (e) {
        console.warn('[ListDeckView] background refresh failed:', e);
      }
    }

    async function buildAndSetDeck() {
      setPhasesDone(new Set());
      setError(null);
      setArtUrl(null);
      setArtLoaded(false);

      try {
        const cached = await readEnrichmentCache(list.id);
        if (cancelled) return;

        if (
          cached
          && cacheMatchesCommander(cached, list.commanderName, list.partnerCommanderName)
          && isCacheFresh(cached)
        ) {
          hydrateFromCache(cached.payload);
          setPhasesDone(new Set(['cards', 'tagger', 'edhrec', 'combos', 'swaps']));
          void touchEnrichmentCache(list.id);
          void backgroundRefresh();
          return;
        }

        await coldLoad();
      } catch {
        if (!cancelled) setError('Failed to load card data. Please try again.');
      }
    }

    buildAndSetDeck();

    return () => {
      cancelled = true;
      useStore.setState({ generatedDeck: null, deckHistory: [] });
      resetTheme();
    };
  }, [list.id, refreshCounter]); // eslint-disable-line react-hooks/exhaustive-deps

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

      const enrichResult = await enrichDeckCards(
        allDeckCards,
        list.deckSize || list.cards.length,
        detectedCombos,
        currentDeck.commander?.name,
        currentDeck.partnerCommander?.name,
      );

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
          protectionSubtypeCounts: enrichResult.protectionSubtypeCounts,
          bracketEstimation: enrichResult.bracketEstimation,
          gameChangerNames: enrichResult.gameChangerNames,
          cardInclusionMap: enrichResult.cardInclusionMap,
          cardSynergyMap: enrichResult.cardSynergyMap,
          cardRelevancyMap: enrichResult.cardRelevancyMap,
          cardEdhrecMetaMap: enrichResult.cardEdhrecMetaMap,
          deckScore: enrichResult.deckScore,
          swapCandidates: enrichResult.swapCandidates,
          gapAnalysis: enrichResult.gapAnalysis,
          edhrecCurve: enrichResult.edhrecCurve,
          edhrecTypes: enrichResult.edhrecTypes,
        },
      });

      // Persist the freshly-enriched payload so next open is instant.
      const payload: SerializedEnrichment = {
        commanderCard: currentDeck.commander,
        partnerCard: currentDeck.partnerCommander,
        deckCards: allDeckCards,
        sideboardCards,
        maybeboardCards,
        stats,
        categories: enrichResult.categories,
        roleCounts: enrichResult.roleCounts,
        roleTargets: enrichResult.roleTargets,
        rampSubtypeCounts: enrichResult.rampSubtypeCounts,
        removalSubtypeCounts: enrichResult.removalSubtypeCounts,
        boardwipeSubtypeCounts: enrichResult.boardwipeSubtypeCounts,
        cardDrawSubtypeCounts: enrichResult.cardDrawSubtypeCounts,
        protectionSubtypeCounts: enrichResult.protectionSubtypeCounts,
        bracketEstimation: enrichResult.bracketEstimation,
        gameChangerNames: enrichResult.gameChangerNames,
        cardInclusionMap: enrichResult.cardInclusionMap,
        cardSynergyMap: enrichResult.cardSynergyMap,
        cardRelevancyMap: enrichResult.cardRelevancyMap,
        cardEdhrecMetaMap: enrichResult.cardEdhrecMetaMap,
        deckScore: enrichResult.deckScore,
        gapAnalysis: enrichResult.gapAnalysis,
        swapCandidates: enrichResult.swapCandidates,
        edhrecCurve: enrichResult.edhrecCurve,
        edhrecTypes: enrichResult.edhrecTypes,
        detectedCombos,
        rawCombos: rawCombosRef.current,
      };
      await writeEnrichmentCache({
        listId: list.id,
        commanderName: list.commanderName ?? null,
        partnerName: list.partnerCommanderName ?? null,
        contentHash: computeContentHash(list.cards),
        cachedAt: Date.now(),
        lastAccessed: Date.now(),
        payload,
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

  // Close bulk add on outside click
  useEffect(() => {
    if (!showBulkAdd) return;
    const handleClick = (e: MouseEvent) => {
      if (bulkAddRef.current && !bulkAddRef.current.contains(e.target as Node)) {
        closeBulkAddImporting();
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [showBulkAdd, closeBulkAddImporting]);

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
    showActionToast(`Added ${card.name}`, () => onRemoveCardsRef.current?.([card.name]), primaryTypeFromLine(card.type_line));
  }, [onAddCards, pushDeckHistory, showActionToast]);

  // Enter-to-add: skip the dropdown and try to resolve+add the typed name directly.
  // Uses fuzzy lookup so minor capitalization/spelling slips still work.
  const handleSearchKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const name = searchQuery.trim();
    if (!name || !onAddCards) return;
    // Capture the first dropdown result (if any) before we clear state.
    const firstResult = searchResults[0];
    // Close the dropdown / cancel the in-flight debounced search immediately
    // so the popover doesn't reappear while our lookup is running.
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchResults(false);
    setIsSearching(false);
    if (firstResult) {
      handleAddToDeck(firstResult);
      return;
    }
    try {
      const card = await getCardByName(name, false);
      handleAddToDeck(card);
    } catch {
      showErrorToast(`Couldn't find "${name}"`);
    }
  }, [searchQuery, searchResults, onAddCards, handleAddToDeck, showErrorToast]);

  const handleShowBoardPicker = useCallback((card: ScryfallCard, event: React.MouseEvent) => {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setPickerAnchor({ top: rect.bottom, left: rect.left });
    setPendingCard(card);
  }, []);

  const handleDestinationPick = useCallback((destination: 'deck' | 'sideboard' | 'maybeboard') => {
    if (!pendingCard || !onAddCards) return;
    const cardName = pendingCard.name;
    onAddCards([cardName], destination);
    const historyAction = destination === 'sideboard' ? 'sideboard' as const : destination === 'maybeboard' ? 'maybeboard' as const : 'add' as const;
    pushDeckHistory({ action: historyAction, cardName });
    setPendingCard(null);
    setPickerAnchor(null);
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchResults(false);
    const label = destination === 'deck' ? '' : ` to ${destination}`;
    showActionToast(`Added ${cardName}${label}`, () => {
      if (destination === 'deck') onRemoveCardsRef.current?.([cardName]);
      else onRemoveFromBoardRef.current?.(cardName, destination);
    }, primaryTypeFromLine(pendingCard.type_line));
  }, [pendingCard, onAddCards, pushDeckHistory, showActionToast]);

  const handleCancelPicker = useCallback(() => {
    setPendingCard(null);
    setPickerAnchor(null);
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

  // Context-menu handler for the Trim / Fill drawers. Scoped to the non-mutating
  // actions (must-include, exclude, add-to-list) so the open dialog's plan, which
  // is computed from a fixed card array, doesn't desync mid-review.
  const handleDialogCardAction = useCallback((card: ScryfallCard, action: CardAction) => {
    const name = card.name;
    switch (action.type) {
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
      case 'createListAndAdd':
        createList(action.listName, [name]);
        break;
    }
  }, [customization, updateCustomization, userLists, updateList, createList]);

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
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          {/* Rebrew — only for decks that came out of the brew flow; restarts a fresh brew with
              the same commander(s) from the setup screen. Mirrors the Back button styling. */}
          {!!list.commanderName && (list.name.includes('(Brewed)') || (list.generationSummary ?? '').toLowerCase().includes('brew')) && (
            <button
              onClick={() => {
                trackEvent('rebrew_clicked', { commanderName: list.commanderName ?? null });
                const partner = list.partnerCommanderName ? `/${formatCommanderNameForUrl(list.partnerCommanderName)}` : '';
                navigate(`/brew/${formatCommanderNameForUrl(list.commanderName!)}${partner}`);
              }}
              title="Brew a fresh deck with this commander"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Redo2 className="w-4 h-4" />
              Rebrew
            </button>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
            <div className="min-w-0">
              <h2
                className="text-lg font-bold truncate min-w-0 cursor-pointer hover:text-muted-foreground transition-colors"
                onClick={() => { setNameInput(list.name); setEditingName(true); }}
                title="Click to rename"
              >
                {list.name}
              </h2>
              {list.generationSummary && (
                <p className="text-xs text-muted-foreground truncate">{list.generationSummary}</p>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            {totalDeckPrice !== null && totalDeckPrice > 0 && (
              <span className="hidden xl:inline text-sm text-muted-foreground">{priceSym}{totalDeckPrice.toFixed(2)}</span>
            )}
            <button
              onClick={() => {
                trackEvent('analyze_cta_clicked', { from: 'list-deck' });
                navigate(`/analyze/${list.id}`);
              }}
              title="Inspect this deck"
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-card/50 hover:bg-accent text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              <InspectorIcon className="w-4 h-4" />
              <span>Inspect (Beta)</span>
            </button>
            <button
              onClick={() => {
                trackEvent('spellchroma_open_clicked', { from: 'list-deck' });
                navigate(`/spellchroma?deck=${list.id}`);
              }}
              title="Explore new cards for this deck in SpellChroma"
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-card/50 hover:bg-accent text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              <SpellChromaIcon className="w-4 h-4" />
              <span>SpellChroma</span>
            </button>
            <button
              onClick={() => setListsPanelOpen(v => !v)}
              title="Open a list alongside the deck"
              className={`flex items-center gap-1.5 h-8 px-3 rounded-lg border text-sm transition-colors ${
                listsPanelOpen
                  ? 'border-primary/50 bg-primary/10 text-foreground'
                  : 'border-border bg-card/50 hover:bg-accent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Library className="w-4 h-4" />
              <span>Lists</span>
            </button>
            <button
              onClick={() => navigate(`/playtest/list/${list.id}`)}
              title="Playtest this deck"
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-card/50 hover:bg-accent text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              <Swords className="w-4 h-4" />
              <span>Playtest</span>
            </button>
            <div className="relative" ref={overflowRef}>
              <button
                onClick={() => setShowOverflow(prev => !prev)}
                className="flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-card/50 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {showOverflow && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-card border border-border rounded-lg shadow-2xl py-1 z-50">
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
                  <button
                    disabled={phasesDone.size < 5}
                    onClick={async () => {
                      setShowOverflow(false);
                      await deleteEnrichmentCache(list.id);
                      setRefreshCounter(c => c + 1);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    Refresh stats
                  </button>
                  {(() => {
                    const overSize = !!(list.deckSize && list.cards.length > list.deckSize);
                    const underSize = !!(list.deckSize && list.cards.length < list.deckSize);
                    if (overSize) {
                      const canTrim = trimReady;
                      const trimTitle = trimReady
                        ? `Trim deck to ${list.deckSize} cards`
                        : 'Trim needs commander data — try again once cards load.';
                      return (
                        <button
                          disabled={!canTrim}
                          onClick={() => { setShowOverflow(false); openTrimDialog(); }}
                          title={trimTitle}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                        >
                          <Scissors className="w-3.5 h-3.5" />
                          Trim deck to {list.deckSize}
                        </button>
                      );
                    }
                    if (underSize) {
                      const canFill = fillReady;
                      const fillTitle = fillReady
                        ? `Fill deck to ${list.deckSize} cards`
                        : 'Fill needs commander data — try again once cards load.';
                      return (
                        <button
                          disabled={!canFill}
                          onClick={() => { setShowOverflow(false); openFillDialog(); }}
                          title={fillTitle}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          Fill deck to {list.deckSize}
                        </button>
                      );
                    }
                    const atTargetTitle = list.deckSize
                      ? `Deck is exactly at ${list.deckSize} — nothing to fill or trim.`
                      : 'Set an expected deck size to enable fill / trim.';
                    return (
                      <button
                        disabled
                        title={atTargetTitle}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                      >
                        <Scissors className="w-3.5 h-3.5" />
                        Fill / Trim deck
                      </button>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>

        {list.type === 'deck' && !list.commanderName ? (
          <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-sm flex-wrap">
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>This deck still needs a commander.</span>
            {onEdit && (
              <button
                onClick={onEdit}
                className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/40 transition-colors whitespace-nowrap"
              >
                <Pencil className="w-3.5 h-3.5" />
                Set commander
              </button>
            )}
          </div>
        ) : list.type === 'deck' && colorIdentityViolations.length > 0 ? (
          <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm flex-wrap">
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>
              {colorIdentityViolations.length} card{colorIdentityViolations.length === 1 ? '' : 's'} break{colorIdentityViolations.length === 1 ? 's' : ''} color identity
            </span>
            <Popover open={offendersOpen} onOpenChange={setOffendersOpen}>
              <PopoverTrigger asChild>
                <button
                  className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 border border-rose-500/40 transition-colors whitespace-nowrap"
                >
                  Show offenders
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0 max-h-96 overflow-y-auto">
                <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Outside commander identity
                  </span>
                  {handleRemoveCardsWithToast && (
                    <button
                      onClick={() => {
                        handleRemoveCardsWithToast(colorIdentityViolations.map(c => c.name));
                        setOffendersOpen(false);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 border border-rose-500/40 transition-colors whitespace-nowrap"
                      title="Remove all offending cards from the deck"
                    >
                      Remove all
                    </button>
                  )}
                </div>
                <ul className="py-1">
                  {colorIdentityViolations.map(c => (
                    <li key={c.name} className="px-3 py-1.5 text-sm flex items-center justify-between gap-2 hover:bg-accent/40">
                      <span className="truncate flex-1 min-w-0">{c.name.includes(' // ') ? c.name.split(' // ')[0] : c.name}</span>
                      <span className="text-xs text-rose-300/80 font-mono shrink-0">
                        {(c.color_identity || []).join('') || '∅'}
                      </span>
                      {handleRemoveCardsWithToast && (
                        <button
                          onClick={() => handleRemoveCardsWithToast([c.name])}
                          title={`Remove ${c.name} from deck`}
                          className="shrink-0 p-1 rounded text-muted-foreground hover:text-rose-300 hover:bg-rose-500/15 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          </div>
        ) : list.type === 'deck' && duplicateNonBasics.length > 0 ? (
          <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm flex-wrap">
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>
              {duplicateNonBasics.length} duplicate non-basic card{duplicateNonBasics.length === 1 ? '' : 's'}
            </span>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 border border-rose-500/40 transition-colors whitespace-nowrap"
                >
                  Show duplicates
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0 max-h-96 overflow-y-auto">
                <div className="px-3 py-2 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Duplicated cards
                </div>
                <ul className="py-1">
                  {duplicateNonBasics.map(d => (
                    <li key={d.name} className="px-3 py-1.5 text-sm flex items-center justify-between gap-3 hover:bg-accent/40">
                      <span className="truncate">{d.name.includes(' // ') ? d.name.split(' // ')[0] : d.name}</span>
                      <span className="text-xs text-rose-300/80 font-mono shrink-0">×{d.count}</span>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          </div>
        ) : unloadedCards.length > 0 ? (
          <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-sm flex-wrap">
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>
              {unloadedCards.length} card{unloadedCards.length === 1 ? '' : 's'} couldn't be loaded — check spelling.
            </span>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/40 transition-colors whitespace-nowrap"
                >
                  Show unloaded
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0 max-h-96 overflow-y-auto">
                <div className="px-3 py-2 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Names not found
                </div>
                <ul className="py-1">
                  {unloadedCards.map(name => (
                    <li key={name} className="px-3 py-1.5 text-sm hover:bg-accent/40">
                      <span className="truncate">{name}</span>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          </div>
        ) : missingMustIncludes.length > 0 ? (
          <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-sm flex-wrap">
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>
              {missingMustIncludes.length} must-include card{missingMustIncludes.length === 1 ? '' : 's'} missing from this deck
            </span>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/40 transition-colors whitespace-nowrap"
                >
                  Show missing
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0 max-h-96 overflow-y-auto">
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Missing must-includes
                  </span>
                  {onAddCards && (
                    <button
                      onClick={() => onAddCards(missingMustIncludes, 'deck')}
                      className="text-xs font-semibold text-amber-300 hover:text-amber-200 transition-colors"
                    >
                      Add all
                    </button>
                  )}
                </div>
                <ul className="py-1">
                  {missingMustIncludes.map(name => (
                    <li key={name} className="px-3 py-1.5 text-sm hover:bg-accent/40">
                      <span className="truncate">{name}</span>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
            <button
              onClick={openMustIncludeDrawer}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-amber-200/80 hover:text-amber-200 border border-amber-500/25 hover:bg-amber-500/10 transition-colors whitespace-nowrap"
            >
              Show list
            </button>
          </div>
        ) : list.deckSize && list.cards.length !== list.deckSize && deckSizeNoticeDismissedAt !== list.cards.length && (
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
            {list.deckSize && list.cards.length > list.deckSize && (
              <button
                onClick={openTrimDialog}
                disabled={!trimReady}
                title={trimReady ? `Trim deck to ${list.deckSize} cards` : 'Trim needs commander data — try again once cards load.'}
                className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 border border-violet-500/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-violet-500/20 whitespace-nowrap"
              >
                <Scissors className="w-3.5 h-3.5" />
                Trim to {list.deckSize}
              </button>
            )}
            {list.deckSize && list.cards.length < list.deckSize && (
              <button
                onClick={openFillDialog}
                disabled={!fillReady}
                title={fillReady ? `Fill deck to ${list.deckSize} cards` : 'Fill needs commander data — try again once cards load.'}
                className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 border border-violet-500/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-violet-500/20 whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Fill to {list.deckSize}
              </button>
            )}
            {onUpdateDeckSize && (
              <button
                onClick={() => onUpdateDeckSize(list.cards.length)}
                className={`${list.deckSize && list.cards.length !== list.deckSize ? '' : 'ml-auto'} inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/40 transition-colors whitespace-nowrap`}
              >
                Set expected to {list.cards.length}
              </button>
            )}
            <button
              onClick={() => setDeckSizeNoticeDismissedAt(list.cards.length)}
              className={`${onUpdateDeckSize ? '' : 'ml-auto'} p-1 -mr-1 rounded text-amber-400/70 hover:text-amber-200 hover:bg-amber-500/10 transition-colors`}
              title="Dismiss"
              aria-label="Dismiss deck size notice"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {!phasesDone.has('cards') ? (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr,320px] gap-4">
            <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-4 space-y-2">
              <div className="text-sm text-muted-foreground mb-3">Loading deck list…</div>
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-4 w-4 rounded bg-accent/30 animate-pulse" />
                  <div className="h-4 flex-1 rounded bg-accent/20 animate-pulse" />
                  <div className="h-4 w-16 rounded bg-accent/20 animate-pulse" />
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="h-16 rounded-lg bg-accent/20 animate-pulse" />
                <div className="h-16 rounded-lg bg-accent/20 animate-pulse" />
              </div>
              <div className="h-20 rounded bg-accent/20 animate-pulse" />
              <div className="h-24 rounded bg-accent/20 animate-pulse" />
            </div>
          </div>
        ) : (
        <DeckDisplay
          phasesDone={phasesDone}
          spellChromaDeckRef={list.id}
          onRemoveCards={handleRemoveCardsWithToast}
          onAddCards={onAddCards ? (names, _dest) => onAddCards(names, 'deck') : undefined}
          onMoveToSideboard={onMoveToSideboard}
          onMoveToMaybeboard={onMoveToMaybeboard}
          onChangeQuantity={onChangeQuantity}
          boardCounts={{ sideboard: sideboardCards.length, maybeboard: maybeboardCards.length }}
          cardCountAction={cardCountAction}
          sideboardNames={list.sideboard}
          maybeboardNames={list.maybeboard}
          onSetSideboard={onSetSideboard}
          onSetMaybeboard={onSetMaybeboard}
          toolbarExtra={onAddCards ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
              <div className="flex items-center gap-2">
                <div className="relative flex-1 sm:flex-none" ref={searchWrapperRef}>
                  <Plus className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Add a card..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    onFocus={() => {
                      if (searchResults.length > 0) setShowSearchResults(true);
                    }}
                    className="bg-card/50 border border-border/50 rounded-lg pl-8 pr-8 py-1.5 text-xs w-full sm:w-64 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
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
                      <div className="absolute bottom-full left-0 mb-1 z-[999] max-h-[280px] min-w-[280px] sm:min-w-[320px] w-full overflow-auto bg-card border border-border rounded-lg shadow-2xl py-1">
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
                  {/* Board Picker — rendered via portal & anchored to clicked button */}
                  {pendingCard && pickerAnchor && createPortal(
                    <>
                      <div className="fixed inset-0 z-[1000]" onClick={handleCancelPicker} />
                      <div
                        className="fixed z-[1001] bg-card border border-border rounded-lg shadow-2xl py-1 w-44"
                        style={{
                          top: Math.max(8, pickerAnchor.top - 124),
                          left: Math.min(pickerAnchor.left, window.innerWidth - 184),
                        }}
                      >
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
                    </>,
                    document.body
                  )}
                </div>
                {/* Bulk Add — manual positioning (Radix Popover breaks inside createPortal) */}
                <div className="relative" ref={bulkAddRef}>
                  <button
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border bg-card/50 hover:bg-accent transition-colors ${showBulkAdd ? 'text-foreground bg-accent' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => { if (showBulkAdd) closeBulkAddImporting(); else setShowBulkAdd(true); }}
                    title="Bulk add cards from a list"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Bulk Add</span>
                  </button>
                  {/* Desktop: floating panel above button */}
                  {showBulkAdd && (
                    <div className="hidden sm:block absolute bottom-full mb-2 right-0 z-50 w-96 rounded-lg border border-border bg-card shadow-2xl p-4">
                      <CollectionImporter
                        ref={bulkImporterDesktopRef}
                        onImportCards={handleBulkImport}
                        label="Bulk Add Cards"
                        updatedLabel="already in deck"
                        onCancel={() => setShowBulkAdd(false)}
                      />
                    </div>
                  )}
                </div>
              </div>
              {/* Mobile: inline bulk add content */}
              {showBulkAdd && (
                <div className="sm:hidden">
                  <CollectionImporter
                    ref={bulkImporterMobileRef}
                    onImportCards={handleBulkImport}
                    label="Bulk Add Cards"
                    updatedLabel="already in deck"
                    onCancel={() => setShowBulkAdd(false)}
                  />
                </div>
              )}
            </div>
          ) : undefined}
          onEditModeChange={setDeckEditMode}
          deckFooter={() => (
            <BoardsCollapsible
              sideboardCards={sideboardCards}
              maybeboardCards={maybeboardCards}
              onBoardCardAction={handleBoardCardAction}
              menuProps={boardMenuProps}
              colorIdentity={colorIdentity}
              existingNames={new Set([...list.cards, ...(list.sideboard || []), ...(list.maybeboard || [])])}
              onAddToBoard={onAddCards ? (name, boardType) => {
                onAddCards([name], boardType);
                pushDeckHistory({ action: boardType, cardName: name });
                showActionToast(`Added ${name} to ${boardType}`, () => {
                  if (boardType === 'sideboard') onRemoveFromBoard?.(name, 'sideboard');
                  else onRemoveFromBoard?.(name, 'maybeboard');
                });
              } : undefined}
            />
          )}
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
                        { icon: ImageIcon, action: () => insertFormat('![', '](image url)'), title: 'Image — ![alt](https://…)' },
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
                <div className="text-sm text-foreground [&_strong]:text-foreground [&_em]:italic [&_h3]:text-base [&_h4]:text-sm" dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(list.primer) }} />
              ) : (
                <p className="text-sm text-muted-foreground/50 italic">No primer written yet.</p>
              )}
            </div>
          )}
          {(!phasesDone.has('combos') || (generatedDeck?.detectedCombos?.length ?? 0) > 0) && (
            <ComboDisplay
              combos={generatedDeck?.detectedCombos ?? []}
              hideMustInclude
              onAddToDeck={onAddCards ? (names) => {
                onAddCards(names, 'deck');
                for (const n of names) pushDeckHistory({ action: 'add', cardName: n });
              } : undefined}
              onRemoveFromDeck={handleRemoveCardsWithToast ? (names) => {
                for (const n of names) pushDeckHistory({ action: 'remove', cardName: n });
                handleRemoveCardsWithToast(names);
              } : undefined}
              onMoveToSideboard={onMoveToSideboard ? (names) => {
                onMoveToSideboard(names);
                for (const n of names) pushDeckHistory({ action: 'sideboard', cardName: n });
              } : undefined}
              onMoveToMaybeboard={onMoveToMaybeboard ? (names) => {
                onMoveToMaybeboard(names);
                for (const n of names) pushDeckHistory({ action: 'maybeboard', cardName: n });
              } : undefined}
              phasesDone={phasesDone}
            />
          )}
        </DeckDisplay>
        )}

      </div>

      {/* Action toast with undo */}
      {actionToast && createPortal(
        <div className={`fixed bottom-6 right-6 z-[999] px-4 py-2 ${actionToast.kind === 'error' ? 'bg-rose-500/90' : 'bg-emerald-500/90'} text-white text-sm rounded-lg shadow-lg animate-fade-in flex items-center gap-2`}>
          {actionToast.cardType && <CardTypeIcon type={actionToast.cardType} size="sm" className="shrink-0" />}
          {actionToast.message}
          {actionToast.onUndo && (
            <button
              onClick={handleUndoAction}
              className="underline underline-offset-2 hover:text-white/80 transition-colors cursor-pointer px-1 py-0.5"
            >
              Undo
            </button>
          )}
        </div>,
        document.body,
      )}

      {/* Trim deck dialog */}
      {trimDialogMounted && generatedDeck && list.deckSize && list.commanderName && onMoveToMaybeboard && (
        <TrimDeckDialog
          open={trimDialogOpen}
          onClose={closeTrimDialog}
          onConfirm={(names) => {
            closeTrimDialog();
            if (names.length === 0) return;
            onMoveToMaybeboard(names);
            const label = names.length === 1
              ? `Moved ${names[0]} to maybeboard`
              : `Moved ${names.length} cards to maybeboard`;
            showActionToast(label, () => {
              onMoveToDeck?.(names, 'maybeboard');
            });
          }}
          cards={allDeckCards}
          commanderName={list.commanderName}
          partnerCommanderName={list.partnerCommanderName}
          // Pass the user-facing deck size (including commander). The dialog
          // subtracts the commander count internally for the overage math.
          targetSize={list.deckSize}
          relevancyMap={generatedDeck.cardRelevancyMap || {}}
          inclusionMap={generatedDeck.cardInclusionMap || {}}
          synergyMap={generatedDeck.cardSynergyMap || {}}
          roleCounts={generatedDeck.roleCounts || {}}
          roleTargets={generatedDeck.roleTargets || {}}
          edhrecCurve={generatedDeck.edhrecCurve || {}}
          edhrecTypes={generatedDeck.edhrecTypes || {}}
          detectedCombos={generatedDeck.detectedCombos}
          mustIncludeNames={new Set(customization.mustIncludeCards)}
          onCardAction={handleDialogCardAction}
          menuProps={boardMenuProps}
        />
      )}

      {/* Fill deck dialog */}
      {fillDialogMounted && generatedDeck && list.deckSize && onAddCards && (
        <FillDeckDialog
          open={fillDialogOpen}
          onClose={closeFillDialog}
          onConfirm={(names) => {
            closeFillDialog();
            if (names.length === 0) return;
            onAddCards(names, 'deck');
            for (const name of names) {
              pushDeckHistory({ action: 'add', cardName: name });
            }
            const label = names.length === 1
              ? `Added ${names[0]}`
              : `Added ${names.length} cards`;
            showActionToast(label, () => {
              onRemoveCardsRef.current?.(names);
              useStore.getState().popLatestHistoryEntries('add', names);
            });
          }}
          gapAnalysis={generatedDeck.gapAnalysis || []}
          deckNames={new Set(list.cards)}
          sideboardNames={new Set(list.sideboard || [])}
          maybeboardNames={new Set(list.maybeboard || [])}
          bannedNames={new Set(customization.bannedCards || [])}
          currentCount={list.cards.length}
          targetSize={list.deckSize}
          roleCounts={generatedDeck.roleCounts || {}}
          roleTargets={generatedDeck.roleTargets || {}}
          relevancyMap={generatedDeck.cardRelevancyMap || {}}
          onCardAction={handleDialogCardAction}
          menuProps={boardMenuProps}
        />
      )}

      {/* Must-include manager drawer */}
      {mustIncludeDrawerMounted && (
        <Drawer
          open={mustIncludeDrawerOpen}
          onClose={closeMustIncludeDrawer}
          position="right"
          onPositionChange={() => {}}
          defaultSizePercent={32}
        >
          <div className="flex flex-col h-full">
            <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
              <div>
                <h2 className="text-lg font-bold">Must-include list</h2>
                <p className="text-sm text-foreground/75 mt-0.5">
                  Cards you want in every deck.
                </p>
              </div>
              <button
                onClick={closeMustIncludeDrawer}
                className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label="Close must-include drawer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <MustIncludeCards />
            </div>
          </div>
        </Drawer>
      )}
      <FloatingListPanel
        open={listsPanelOpen}
        onClose={() => setListsPanelOpen(false)}
      />
    </>
  );
}
