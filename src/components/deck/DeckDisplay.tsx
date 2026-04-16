import React, { useState, useCallback, useMemo, useRef, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import { getCardImageUrl, isDoubleFacedCard, getCardBackFaceUrl, getCardPrice, getFrontFaceTypeLine, getCardByName, isMdfcLand, getCachedCard } from '@/services/scryfall/client';
import { getDeckFormatConfig } from '@/lib/constants/archetypes';
import { getMaxCopies } from '@/lib/utils';
import { DeckHistory } from '@/components/deck/DeckHistory';
import type { ScryfallCard, DetectedCombo, UserCardList } from '@/types';
import {
  Copy,
  Check,
  Download,
  X,
  Grid3X3,
  List,
  ArrowUpDown,
  Search,
  AlertTriangle,
  Info,
  Sparkles,
  RefreshCw,
  Star,
  Pin,
  Bookmark,
  Pencil,
  ChevronDown,
  ChevronRight,
  Ban,
  Plus,
  Trash2,
  Eye,
  MoreVertical,
  ListPlus,
  FileText,
  Loader2 as Loader2Icon,
  Sprout,
  Swords,
  Flame,
  BookOpen,
} from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { CardTypeIcon, ManaCost } from '@/components/ui/mtg-icons';
import { PieChart } from '@/components/ui/pie-chart';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { parseCollectionList } from '@/services/collection/parseCollectionList';
import { getCardsByNames, autocompleteCardName } from '@/services/scryfall/client';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { getSwapCandidatesForCard } from '@/services/deckBuilder/cardSwap';
import { analyzeDeck, getDeckSummaryData } from '@/services/deckBuilder/deckAnalyzer';
import { HEALTH_GRADE_STYLES } from '@/components/deck/optimizer/constants';
import { getGenerationCacheEdhrecData } from '@/services/deckBuilder/deckGenerator';
import { cardMatchesRole, getCardRole, type RoleKey } from '@/services/tagger/client';
import { trackEvent } from '@/services/analytics';
import { useUserLists } from '@/hooks/useUserLists';
import { getCollectionNameSet } from '@/services/collection/db';

// Role badge display properties for each subtype
function getRoleBadgeProps(card: ScryfallCard): { color: string; bgColor: string; title: string; label: string } | null {
  if (!card.deckRole) return null;
  switch (card.deckRole) {
    case 'ramp':
      switch (card.rampSubtype) {
        case 'mana-producer': return { color: 'text-lime-400/70', bgColor: 'bg-lime-500/80', title: 'Mana Producer', label: 'MP' };
        case 'mana-rock': return { color: 'text-yellow-400/70', bgColor: 'bg-yellow-500/80', title: 'Mana Rock', label: 'MR' };
        case 'cost-reducer': return { color: 'text-teal-400/70', bgColor: 'bg-teal-500/80', title: 'Cost Reducer', label: 'CR' };
        default: return { color: 'text-emerald-400/70', bgColor: 'bg-emerald-500/80', title: 'Ramp', label: 'RA' };
      }
    case 'removal':
      switch (card.removalSubtype) {
        case 'counterspell': return { color: 'text-sky-400/70', bgColor: 'bg-sky-500/80', title: 'Counterspell', label: 'CT' };
        case 'bounce': return { color: 'text-cyan-400/70', bgColor: 'bg-cyan-500/80', title: 'Bounce', label: 'BN' };
        case 'spot-removal': return { color: 'text-rose-400/70', bgColor: 'bg-rose-500/80', title: 'Spot Removal', label: 'SR' };
        default: return { color: 'text-red-400/70', bgColor: 'bg-red-500/80', title: 'Removal', label: 'RE' };
      }
    case 'boardwipe':
      switch (card.boardwipeSubtype) {
        case 'bounce-wipe': return { color: 'text-cyan-400/70', bgColor: 'bg-cyan-500/80', title: 'Bounce Wipe', label: 'BW' };
        default: return { color: 'text-orange-400/70', bgColor: 'bg-orange-500/80', title: 'Board Wipe', label: 'WI' };
      }
    case 'cardDraw':
      switch (card.cardDrawSubtype) {
        case 'tutor': return { color: 'text-amber-400/70', bgColor: 'bg-amber-500/80', title: 'Tutor', label: 'TU' };
        case 'wheel': return { color: 'text-pink-400/70', bgColor: 'bg-pink-500/80', title: 'Wheel', label: 'WH' };
        case 'cantrip': return { color: 'text-sky-400/70', bgColor: 'bg-sky-500/80', title: 'Cantrip', label: 'CN' };
        case 'card-draw': return { color: 'text-blue-400/70', bgColor: 'bg-blue-500/80', title: 'Card Draw', label: 'DR' };
        default: return { color: 'text-indigo-400/70', bgColor: 'bg-indigo-500/80', title: 'Card Advantage', label: 'CA' };
      }
    default: return null;
  }
}

// Stats filter for interactive highlighting
type StatsFilter =
  | { type: 'cmc'; value: number }
  | { type: 'color'; value: string }
  | { type: 'manaProduction'; value: string }
  | { type: 'role'; value: string }
  | null;

// Check if a card matches the current stats filter
function cardMatchesFilter(card: ScryfallCard, filter: StatsFilter): boolean {
  if (!filter) return true;

  switch (filter.type) {
    case 'cmc': {
      if (getFrontFaceTypeLine(card).toLowerCase().includes('land')) return false;
      const cardCmc = Math.min(Math.floor(card.cmc), 7);
      return cardCmc === filter.value;
    }
    case 'color': {
      const manaCost = card.mana_cost || '';
      const symbols = manaCost.match(/\{[^}]+\}/g) || [];
      for (const symbol of symbols) {
        const clean = symbol.replace(/[{}]/g, '');
        if (clean === filter.value) return true;
        if (clean.includes('/')) {
          const parts = clean.split('/');
          if (parts.includes(filter.value)) return true;
        }
      }
      if (filter.value === 'C') {
        const hasColorPip = symbols.some(s => {
          const c = s.replace(/[{}]/g, '');
          return ['W','U','B','R','G'].includes(c) || (c.includes('/') && c.split('/').some(p => ['W','U','B','R','G'].includes(p)));
        });
        return !hasColorPip && symbols.length > 0;
      }
      return false;
    }
    case 'manaProduction': {
      const typeLine = card.type_line?.toLowerCase() || '';
      if (!typeLine.includes('land')) return false;
      const producedMana = card.produced_mana || [];
      if (producedMana.includes(filter.value)) return true;
      if (producedMana.length === 0) {
        const oracleText = card.oracle_text?.toLowerCase() || '';
        const checks: Record<string, () => boolean> = {
          W: () => typeLine.includes('plains') || oracleText.includes('add {w}'),
          U: () => typeLine.includes('island') || oracleText.includes('add {u}'),
          B: () => typeLine.includes('swamp') || oracleText.includes('add {b}'),
          R: () => typeLine.includes('mountain') || oracleText.includes('add {r}'),
          G: () => typeLine.includes('forest') || oracleText.includes('add {g}'),
          C: () => oracleText.includes('add {c}'),
        };
        return checks[filter.value]?.() ?? false;
      }
      return false;
    }
    case 'role':
      if (card.deckRole === filter.value) return true;
      if (card.multiRole) return cardMatchesRole(card.name, filter.value as RoleKey);
      return false;
    default:
      return true;
  }
}

// Card type categories for Moxfield-style grouping
type CardType = 'Commander' | 'Creature' | 'Planeswalker' | 'Battle' | 'Instant' | 'Sorcery' | 'Artifact' | 'Enchantment' | 'Land';

const TYPE_ORDER: CardType[] = ['Commander', 'Planeswalker', 'Creature', 'Battle', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Land'];

// Get primary card type from front face type_line (handles MDFCs like "Instant // Land")
function getCardType(card: ScryfallCard): CardType {
  const typeLine = getFrontFaceTypeLine(card).toLowerCase();

  if (typeLine.includes('land')) return 'Land';
  if (typeLine.includes('creature')) return 'Creature';
  if (typeLine.includes('planeswalker')) return 'Planeswalker';
  if (typeLine.includes('battle')) return 'Battle';
  if (typeLine.includes('instant')) return 'Instant';
  if (typeLine.includes('sorcery')) return 'Sorcery';
  if (typeLine.includes('artifact')) return 'Artifact';
  if (typeLine.includes('enchantment')) return 'Enchantment';

  return 'Artifact'; // Default fallback
}

// Format price
function formatPrice(price: string | null | undefined, sym = '$'): string {
  if (!price) return '-';
  const num = parseFloat(price);
  if (isNaN(num)) return '-';
  return `${sym}${num.toFixed(2)}`;
}

// Combo popover for inline combo indicator
interface ComboPopoverProps {
  combos: DetectedCombo[];
  cardName: string;
  cardTypeMap?: Map<string, CardType>;
}

function ComboPopover({ combos, cardName, cardTypeMap }: ComboPopoverProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLSpanElement>(null);

  const show = useCallback(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos({
      top: rect.top - 8,
      left: rect.left + rect.width / 2,
    });
    setVisible(true);
  }, []);

  const label = combos.length === 1 ? 'CB' : `CB${combos.length}`;

  return (
    <span
      ref={ref}
      className="ml-1 text-[10px] font-bold text-violet-500/70 cursor-help"
      onMouseEnter={show}
      onMouseLeave={() => setVisible(false)}
      onClick={(e) => e.stopPropagation()}
    >
      {label}
      {visible && createPortal(
        <div
          className="pointer-events-none fixed w-72 rounded-lg bg-popover border border-border px-3 py-2.5 text-xs text-popover-foreground leading-relaxed shadow-lg z-[100] animate-fade-in"
          style={{
            top: pos.top,
            left: pos.left,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="font-semibold text-violet-400 mb-1.5 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            {combos.length === 1 ? 'Combo' : `${combos.length} Combos`}
          </div>
          {combos.map((combo) => (
            <div key={combo.comboId} className="mb-2 last:mb-0">
              <div className="flex flex-wrap gap-1 mb-0.5">
                {combo.cards.map((name) => (
                  <span
                    key={name}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${
                      name === cardName
                        ? 'bg-violet-500/20 text-violet-300 font-semibold'
                        : 'bg-accent/40 text-foreground/80'
                    }`}
                  >
                    {cardTypeMap?.get(name) && (
                      <CardTypeIcon type={cardTypeMap.get(name)!} size="sm" className="opacity-60" />
                    )}
                    {name}
                  </span>
                ))}
              </div>
              {combo.results.length > 0 && (
                <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                  {combo.results[0]}
                </p>
              )}
            </div>
          ))}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-border" />
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-[5px] border-4 border-transparent border-t-popover" />
        </div>,
        document.body
      )}
    </span>
  );
}

// Card context menu types and component
export type CardAction =
  | { type: 'remove' }
  | { type: 'addToDeck' }
  | { type: 'sideboard' }
  | { type: 'maybeboard' }
  | { type: 'mustInclude' }
  | { type: 'exclude' }
  | { type: 'addToList'; listId: string }
  | { type: 'createListAndAdd'; listName: string };

export interface CardContextMenuProps {
  card: ScryfallCard;
  onAction: (card: ScryfallCard, action: CardAction) => void;
  hasRemove?: boolean;
  hasAddToDeck?: boolean;
  hasSideboard?: boolean;
  hasMaybeboard?: boolean;
  isInSideboard?: boolean;
  isInMaybeboard?: boolean;
  isMustInclude?: boolean;
  isBanned?: boolean;
  userLists: UserCardList[];
  forceOpen?: boolean;
  onForceClose?: () => void;
}

export function CardContextMenu({ card, onAction, hasRemove, hasAddToDeck, hasSideboard, hasMaybeboard, isInSideboard, isInMaybeboard, isMustInclude, isBanned, userLists, forceOpen, onForceClose }: CardContextMenuProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [showLists, setShowLists] = React.useState(false);
  const [showNewList, setShowNewList] = React.useState(false);
  const [newListName, setNewListName] = React.useState('');
  const newListRef = React.useRef<HTMLInputElement>(null);
  const open = forceOpen || internalOpen;

  const handleOpenChange = (v: boolean) => {
    setInternalOpen(v);
    if (!v) {
      setShowLists(false);
      setShowNewList(false);
      setNewListName('');
      onForceClose?.();
    }
  };

  const fire = (action: CardAction) => {
    onAction(card, action);
    handleOpenChange(false);
  };

  const menuBtn = 'group/item w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2 rounded transition-colors';

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          onClick={(e) => { e.stopPropagation(); }}
          className="p-0.5 rounded hover:bg-accent/80 text-muted-foreground hover:text-foreground transition-colors"
        >
          <MoreVertical className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-48 p-1" onClick={(e) => e.stopPropagation()}>
        {hasAddToDeck && (
          <button className={menuBtn} onClick={() => fire({ type: 'addToDeck' })}>
            <Plus className="w-3.5 h-3.5 text-muted-foreground group-hover/item:text-emerald-400 transition-colors" />
            Add to Deck
          </button>
        )}
        {hasRemove && (
          <button className={menuBtn} onClick={() => fire({ type: 'remove' })}>
            <Trash2 className="w-3.5 h-3.5 text-muted-foreground group-hover/item:text-red-400 transition-colors" />
            Remove from Deck
          </button>
        )}
        {hasSideboard && (
          <button className={menuBtn} onClick={() => fire({ type: 'sideboard' })}>
            <ArrowUpDown className={`w-3.5 h-3.5 transition-colors ${isInSideboard ? 'text-amber-400' : 'text-muted-foreground group-hover/item:text-amber-400'}`} />
            {isInSideboard ? 'Remove from Sideboard' : 'Move to Sideboard'}
          </button>
        )}
        {hasMaybeboard && (
          <button className={menuBtn} onClick={() => fire({ type: 'maybeboard' })}>
            <Bookmark className={`w-3.5 h-3.5 transition-colors ${isInMaybeboard ? 'text-purple-400' : 'text-muted-foreground group-hover/item:text-purple-400'}`} />
            {isInMaybeboard ? 'Remove from Maybeboard' : 'Move to Maybeboard'}
          </button>
        )}
        {(hasRemove || hasAddToDeck || hasSideboard || hasMaybeboard) && (
          <div className="h-px bg-border my-1" />
        )}
        <button className={menuBtn} onClick={() => fire({ type: 'mustInclude' })}>
          <Pin className={`w-3.5 h-3.5 transition-colors ${isMustInclude ? 'text-emerald-400' : 'text-muted-foreground group-hover/item:text-emerald-400'}`} />
          {isMustInclude ? 'Remove Must Include' : 'Must Include'}
        </button>
        <button className={menuBtn} onClick={() => fire({ type: 'exclude' })}>
          <Ban className={`w-3.5 h-3.5 transition-colors ${isBanned ? 'text-red-400' : 'text-muted-foreground group-hover/item:text-red-400/70'}`} />
          {isBanned ? 'Remove Exclude' : 'Exclude'}
        </button>
        <div className="h-px bg-border my-1" />
        {!showLists ? (
          <button className={menuBtn} onClick={(e) => { e.stopPropagation(); setShowLists(true); }}>
            <ListPlus className="w-3.5 h-3.5 text-muted-foreground group-hover/item:text-blue-400 transition-colors" />
            Add to List...
          </button>
        ) : (
          <div>
            {!showNewList ? (
              <button
                className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent flex items-center gap-2 rounded transition-colors"
                onClick={(e) => { e.stopPropagation(); setShowNewList(true); }}
              >
                <Plus className="w-3.5 h-3.5" />
                Create New List
              </button>
            ) : (
              <form
                className="flex items-center gap-1 px-2 py-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const trimmed = newListName.trim();
                  if (trimmed) fire({ type: 'createListAndAdd', listName: trimmed });
                }}
              >
                <input
                  ref={newListRef}
                  type="text"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="New list name..."
                  className="flex-1 min-w-0 bg-transparent border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-blue-400/50"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  type="submit"
                  disabled={!newListName.trim()}
                  className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-blue-400 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </form>
            )}
            {userLists.length > 0 && (
              <div className="max-h-32 overflow-y-auto">
                {userLists.map(list => {
                  const alreadyIn = list.cards.includes(card.name);
                  return (
                    <button
                      key={list.id}
                      className={`${menuBtn}${alreadyIn ? ' opacity-50 pointer-events-none' : ''}`}
                      onClick={() => fire({ type: 'addToList', listId: list.id })}
                      disabled={alreadyIn}
                    >
                      {alreadyIn ? (
                        <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                      ) : list.commanderName ? (
                        <CardTypeIcon type="commander" size="sm" className="shrink-0" />
                      ) : (
                        <List className="w-3 h-3 text-muted-foreground shrink-0" />
                      )}
                      <span className="truncate">{list.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// Card row component

interface CardRowProps {
  card: ScryfallCard;
  quantity: number;
  onPreview: (card: ScryfallCard) => void;
  onHover: (card: ScryfallCard | null, e?: React.MouseEvent, showBack?: boolean) => void;
  dimmed?: boolean;
  avgCardPrice?: number | null;
  currency?: 'USD' | 'EUR';
  combosForCard?: DetectedCombo[];
  cardTypeMap?: Map<string, CardType>;
  showRoleColumn?: boolean;
  showPinColumn?: boolean;
  showPinBanIcons?: boolean;
  isRemoved?: boolean;
  isEditMode?: boolean;
  isSelected?: boolean;
  isCommanderCard?: boolean;
  onToggleSelect?: (card: ScryfallCard, shiftKey?: boolean) => void;
  isOwned?: boolean;
  isMustIncludeLive?: boolean;
  isBannedLive?: boolean;
  inclusionPercent?: number | null;
  relevancyScore?: number | null;
  showPrice?: boolean;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  showCardMenu?: boolean;
  cardMenuProps?: Omit<CardContextMenuProps, 'card' | 'onAction'>;
  onChangeQuantity?: (cardName: string, newQuantity: number) => void;
  isSingleton?: boolean;
}

const CardRow = memo(function CardRow({ card, quantity, onPreview, onHover, dimmed, avgCardPrice, currency = 'USD', combosForCard, cardTypeMap, showRoleColumn, showPinColumn, showPinBanIcons = true, isRemoved, isEditMode, isSelected, isCommanderCard, onToggleSelect, isOwned, isMustIncludeLive, isBannedLive, inclusionPercent, relevancyScore, showPrice = true, onCardAction, showCardMenu, cardMenuProps, onChangeQuantity, isSingleton }: CardRowProps) {
  const rawPrice = getCardPrice(card, currency);
  const price = formatPrice(rawPrice, currency === 'EUR' ? '€' : '$');
  const isDfc = isDoubleFacedCard(card);
  const priceNum = parseFloat(rawPrice || '0');
  const isPriceOutlier = avgCardPrice != null &&
    !isNaN(priceNum) && priceNum > 0 &&
    priceNum >= avgCardPrice * 3 &&
    priceNum >= avgCardPrice + 1;
  const [contextMenuOpen, setContextMenuOpen] = React.useState(false);
  const [editingQuantity, setEditingQuantity] = React.useState(false);
  const [quantityInput, setQuantityInput] = React.useState(String(quantity));
  const quantityInputRef = React.useRef<HTMLInputElement>(null);

  const maxQuantity = isSingleton ? getMaxCopies(card) : 99;

  const commitQuantityChange = React.useCallback(() => {
    const parsed = parseInt(quantityInput, 10);
    if (isNaN(parsed) || parsed < 0) {
      setQuantityInput(String(quantity));
      setEditingQuantity(false);
      return;
    }
    const clamped = Math.min(Math.max(parsed, 0), maxQuantity);
    if (clamped !== quantity) {
      onChangeQuantity?.(card.name, clamped);
    }
    setEditingQuantity(false);
  }, [quantityInput, quantity, maxQuantity, onChangeQuantity, card.name]);

  React.useEffect(() => {
    if (editingQuantity && quantityInputRef.current) {
      quantityInputRef.current.focus();
      quantityInputRef.current.select();
    }
  }, [editingQuantity]);

  return (
    <div
      className={`w-full text-left px-2 py-1 rounded text-sm flex items-center gap-2 group transition-all duration-200 cursor-pointer relative ${
        dimmed ? 'opacity-30' :
        isRemoved ? 'opacity-40' :
        isEditMode && isSelected ? 'bg-primary/15 hover:bg-primary/20' :
        isEditMode && isCommanderCard ? 'opacity-60' :
        'hover:bg-accent/50'
      }`}
      onContextMenu={(e) => {
        if (showCardMenu && !isCommanderCard && onCardAction && cardMenuProps) {
          e.preventDefault();
          setContextMenuOpen(true);
        }
      }}
      onClick={(e) => {
        if (isEditMode && !isCommanderCard && onToggleSelect) {
          onToggleSelect(card, e.shiftKey);
        } else if (!isEditMode) {
          onPreview(card);
        }
      }}
      onMouseEnter={(e) => onHover(card, e)}
      onMouseLeave={() => onHover(null)}
    >
      {isEditMode && (
        <span className="shrink-0 flex items-center justify-center w-4">
          {isCommanderCard ? (
            <span className="w-3.5 h-3.5 rounded border border-border/30 bg-muted/20 cursor-not-allowed" />
          ) : (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => {/* handled by onClick */}}
              onClick={(e) => { e.stopPropagation(); onToggleSelect?.(card, e.shiftKey); }}
              className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
            />
          )}
        </span>
      )}
      {showPinColumn && (
        <span className="w-3 shrink-0 flex justify-center">
          {showPinBanIcons && isBannedLive ? (
            <span title="Excluded" className="animate-pop-in"><Ban className="w-3 h-3 text-red-400/70" /></span>
          ) : showPinBanIcons && isMustIncludeLive ? (
            card.mustIncludeSource === 'deck' ? <span title="From original deck"><Bookmark className="w-3 h-3 text-muted-foreground/50" /></span> :
            card.mustIncludeSource === 'combo' ? <span title="Added by user"><Sparkles className="w-3 h-3 text-violet-500/70" /></span> :
            <span title="Must include" className="animate-pop-in"><Pin className="w-3 h-3 text-emerald-500/70" /></span>
          ) : isOwned ? <span title="In your collection"><Check className="w-3 h-3 text-emerald-500/50" /></span> : null}
        </span>
      )}
      {editingQuantity ? (
        <input
          ref={quantityInputRef}
          type="number"
          min={0}
          max={maxQuantity}
          value={quantityInput}
          onChange={(e) => setQuantityInput(e.target.value)}
          onBlur={commitQuantityChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitQuantityChange();
            if (e.key === 'Escape') { setQuantityInput(String(quantity)); setEditingQuantity(false); }
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-6 h-5 text-center text-xs bg-accent border border-border rounded px-0 py-0 text-foreground shrink-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      ) : (
        <span
          className={`text-muted-foreground w-fit text-right shrink-0 ${onChangeQuantity && !isCommanderCard ? 'cursor-pointer hover:text-foreground hover:bg-accent rounded px-0.5 transition-colors' : ''}`}
          onClick={onChangeQuantity && !isCommanderCard ? (e) => { e.stopPropagation(); setQuantityInput(String(quantity)); setEditingQuantity(true); } : undefined}
          title={onChangeQuantity && !isCommanderCard ? (maxQuantity === 1 ? 'Singleton — only 1 copy allowed' : 'Click to change quantity') : undefined}
        >
          {quantity}
        </span>
      )}
      {showRoleColumn && (() => {
        const badge = getRoleBadgeProps(card);
        return badge ? (
          <span className={`w-5 text-center shrink-0 text-[10px] font-bold ${card.multiRole ? 'text-purple-400/70' : badge.color}`} title={card.multiRole ? (['ramp', 'removal', 'boardwipe', 'cardDraw'] as RoleKey[]).filter(r => cardMatchesRole(card.name, r)).map(r => ({ ramp: 'Ramp', removal: 'Removal', boardwipe: 'Board Wipe', cardDraw: 'Card Advantage' })[r]).join(' + ') : badge.title}>{
            card.multiRole ? '*' : badge.label
          }</span>
        ) : card.isUtilityLand ? (
          <span className="w-5 text-center shrink-0 text-[10px] font-bold text-violet-400/70" title="Utility Land">UL</span>
        ) : (
          <span className="w-5 shrink-0" />
        );
      })()}
      <span className={`flex-1 min-w-0 flex items-center group-hover:text-primary transition-colors ${isRemoved ? 'line-through text-muted-foreground/50' : ''}`}>
        <span className="truncate">
          {card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name}
        </span>
        <span className="shrink-0 flex items-center">
          {card.isGameChanger && (
            <span className="ml-1 text-[10px] font-bold text-amber-500/70" title="Game Changer (EDHREC)">GC</span>
          )}
          {combosForCard && combosForCard.length > 0 && (
            <ComboPopover
              combos={combosForCard}
              cardName={card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name}
              cardTypeMap={cardTypeMap}
            />
          )}
          {isDfc && (
            <span
              className="ml-1 inline-flex align-text-bottom text-muted-foreground hover:text-primary transition-colors cursor-help"
              title="Hover to see back face"
              onMouseEnter={(e) => { e.stopPropagation(); onHover(card, e, true); }}
              onMouseLeave={(e) => { e.stopPropagation(); onHover(card, e, false); }}
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
      {inclusionPercent != null && (() => {
        const pct = Math.round(inclusionPercent);
        const hue = (pct / 100) * 120; // 0%=red, 50%=yellow, 100%=green
        return (
          <span className="text-[10px] w-7 text-right shrink-0" style={{ color: `hsl(${hue}, 70%, 55%)` }} title={`${pct}% of EDHREC decks include this card`}>
            {pct}%
          </span>
        );
      })()}
      {relevancyScore != null && (
        <span className="text-[10px] w-7 text-right shrink-0 text-violet-400 font-medium tabular-nums" title={`Relevancy: ${relevancyScore}`}>
          {relevancyScore}
        </span>
      )}
      {showCardMenu && !isCommanderCard && onCardAction && cardMenuProps && (
        <span className={`shrink-0 w-3 transition-opacity ${contextMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <CardContextMenu card={card} onAction={onCardAction} {...cardMenuProps} isMustInclude={isMustIncludeLive} isBanned={isBannedLive} forceOpen={contextMenuOpen} onForceClose={() => setContextMenuOpen(false)} />
        </span>
      )}
      {showPrice && (
        <span className={`text-xs w-10 text-right shrink-0 ${isPriceOutlier ? 'text-amber-400' : 'text-muted-foreground'}`}>
          {price}
        </span>
      )}
    </div>
  );
});

// Category column component
interface CategoryColumnProps {
  type: CardType;
  cards: Array<{ card: ScryfallCard; quantity: number }>;
  onPreview: (card: ScryfallCard) => void;
  onHover: (card: ScryfallCard | null, e?: React.MouseEvent, showBack?: boolean) => void;
  matchingCardIds: Set<string> | null;
  avgCardPrice?: number | null;
  currency?: 'USD' | 'EUR';
  cardComboMap?: Map<string, DetectedCombo[]>;
  cardTypeMap?: Map<string, CardType>;
  showRoleColumn?: boolean;
  removedCards?: Set<string>;
  isEditMode?: boolean;
  selectedCards?: Set<string>;
  onToggleSelect?: (card: ScryfallCard, shiftKey?: boolean) => void;
  onToggleCategory?: (cardIds: string[]) => void;
  collectionNames?: Set<string> | null;
  mustIncludeNames?: Set<string>;
  bannedNames?: Set<string>;
  cardInclusionMap?: Record<string, number> | null;
  cardRelevancyMap?: Record<string, number> | null;
  showPrice?: boolean;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  showCardMenu?: boolean;
  cardMenuProps?: Omit<CardContextMenuProps, 'card' | 'onAction'>;
  onChangeQuantity?: (cardName: string, newQuantity: number) => void;
  isSingleton?: boolean;
  showPinBan?: boolean;
  mdfcLandCount?: number;
}

function CategoryColumn({ type, cards, onPreview, onHover, matchingCardIds, avgCardPrice, currency = 'USD', cardComboMap, cardTypeMap, showRoleColumn, removedCards, isEditMode, selectedCards, onToggleSelect, onToggleCategory, collectionNames, mustIncludeNames, bannedNames, cardInclusionMap, cardRelevancyMap, showPrice = true, onCardAction, showCardMenu, cardMenuProps, onChangeQuantity, isSingleton, showPinBan = true, mdfcLandCount }: CategoryColumnProps) {

  if (cards.length === 0) return null;

  const sym = currency === 'EUR' ? '€' : '$';
  const totalCards = cards.reduce((sum, c) => sum + c.quantity, 0);
  const totalPrice = cards.reduce((sum, c) => {
    const price = parseFloat(getCardPrice(c.card, currency) || '0');
    return sum + (isNaN(price) ? 0 : price * c.quantity);
  }, 0);

  const hasMatch = matchingCardIds === null || cards.some(({ card }) => matchingCardIds.has(card.id));
  const hasMustInclude = cards.some(({ card }) => mustIncludeNames ? mustIncludeNames.has(card.name) : card.isMustInclude);
  const hasBanned = bannedNames ? cards.some(({ card }) => bannedNames.has(card.name)) : false;
  const hasOwnedCard = collectionNames ? cards.some(({ card }) => {
    const name = card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name;
    return collectionNames.has(name);
  }) : false;

  return (
    <div className="break-inside-avoid-column mb-4">
      {/* Header */}
      <div
        className={`flex items-center justify-between px-2 py-2 border-b border-border/50 transition-opacity duration-200 ${!hasMatch ? 'opacity-30' : ''} ${isEditMode && type !== 'Commander' ? 'cursor-pointer hover:bg-accent/30' : ''}`}
        onClick={() => {
          if (isEditMode && type !== 'Commander' && onToggleCategory) {
            onToggleCategory(cards.map(c => c.card.id));
          }
        }}
      >
        <div className="flex items-center gap-2">
          {isEditMode && type !== 'Commander' && (
            <input
              type="checkbox"
              checked={cards.length > 0 && cards.every(c => selectedCards?.has(c.card.id))}
              onChange={() => onToggleCategory?.(cards.map(c => c.card.id))}
              onClick={(e) => e.stopPropagation()}
              className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer shrink-0"
            />
          )}
          <CardTypeIcon type={type} size="md" className="text-muted-foreground" />
          <span className="font-medium text-sm uppercase tracking-wide">
            {type} ({totalCards})
            {type === 'Land' && mdfcLandCount != null && mdfcLandCount > 0 && (
              <span className="text-muted-foreground text-[10px] font-normal lowercase tracking-normal ml-1">
                ({totalCards + mdfcLandCount} with mdfc)
              </span>
            )}
          </span>
        </div>
        {showPrice && totalPrice > 0 && (
          <span className="text-muted-foreground text-xs">
            {sym}{totalPrice.toFixed(2)}
          </span>
        )}
      </div>

      {/* Cards */}
      <div className="py-1">
        {cards.map(({ card, quantity }) => {
          const normalizedName = card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name;
          return (
            <CardRow
              key={card.id}
              card={card}
              quantity={quantity}
              onPreview={onPreview}
              onHover={onHover}
              dimmed={matchingCardIds !== null && !matchingCardIds.has(card.id)}
              avgCardPrice={avgCardPrice}
              currency={currency}
              combosForCard={cardComboMap?.get(normalizedName)}
              cardTypeMap={cardTypeMap}
              showRoleColumn={showRoleColumn}
              showPinColumn={(showPinBan && (hasMustInclude || hasBanned)) || hasOwnedCard}
              showPinBanIcons={showPinBan !== false}
              isRemoved={removedCards?.has(card.id)}
              isEditMode={isEditMode}
              isSelected={selectedCards?.has(card.id)}
              isCommanderCard={type === 'Commander'}
              onToggleSelect={onToggleSelect}
              isOwned={collectionNames ? collectionNames.has(card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name) : undefined}
              isMustIncludeLive={mustIncludeNames ? mustIncludeNames.has(card.name) : card.isMustInclude}
              isBannedLive={bannedNames ? bannedNames.has(card.name) : false}
              inclusionPercent={cardInclusionMap ? (cardInclusionMap[card.name] ?? cardInclusionMap[normalizedName] ?? null) : null}
              relevancyScore={cardRelevancyMap ? (cardRelevancyMap[card.name] ?? cardRelevancyMap[normalizedName] ?? null) : null}
              showPrice={showPrice}
              onCardAction={onCardAction}
              showCardMenu={showCardMenu}
              cardMenuProps={cardMenuProps}
              onChangeQuantity={onChangeQuantity}
              isSingleton={isSingleton}
            />
          );
        })}
      </div>
    </div>
  );
}

// Floating card preview
interface FloatingPreviewProps {
  card: ScryfallCard;
  rowRect: { right: number; top: number; height: number };
  showBack?: boolean;
}

function FloatingPreview({ card, rowRect, showBack }: FloatingPreviewProps) {
  const backUrl = showBack ? getCardBackFaceUrl(card, 'normal') : null;
  const imgUrl = backUrl || getCardImageUrl(card, 'normal');

  // Anchor to the right edge of the row, vertically centered on it
  const left = rowRect.right + 12;
  const rowCenter = rowRect.top + rowRect.height / 2;
  const top = Math.min(Math.max(8, rowCenter - 180), window.innerHeight - 400);

  return (
    <div
      className="fixed z-[100] pointer-events-none hidden lg:block"
      style={{ left, top }}
    >
      <div className="card-preview-enter">
        <img
          src={imgUrl}
          alt={card.name}
          className="w-64 rounded-lg shadow-2xl border border-border/50"
        />
        <p className="text-center text-xs text-muted-foreground mt-2 truncate max-w-[256px]">
          {card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name}
        </p>
      </div>
    </div>
  );
}

// Export modal
interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  generateDeckList: (excludeMustIncludes: boolean) => string;
  hasMustIncludes: boolean;
  onExport: (format: 'clipboard' | 'download') => void;
  onSaveToList: (name: string, cards: string[]) => void;
  defaultListName: string;
}

function ExportModal({ isOpen, onClose, generateDeckList, hasMustIncludes, onExport, onSaveToList, defaultListName }: ExportModalProps) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showListNameInput, setShowListNameInput] = useState(false);
  const [listName, setListName] = useState('');
  const [excludeMustIncludes, setExcludeMustIncludes] = useState(false);

  const deckList = useMemo(() => generateDeckList(excludeMustIncludes), [generateDeckList, excludeMustIncludes]);

  const cardCount = useMemo(() => {
    return deckList.split('\n').filter(l => l.trim()).reduce((sum, line) => {
      const match = line.match(/^(\d+)\s/);
      return sum + (match ? parseInt(match[1], 10) : 1);
    }, 0);
  }, [deckList]);

  const parseCardNames = useCallback(() => {
    return deckList.split('\n').filter(l => l.trim()).flatMap(line => {
      const match = line.match(/^(\d+)\s+(.+)/);
      if (!match) return [];
      const qty = parseInt(match[1], 10);
      const name = match[2].trim();
      return Array(qty).fill(name);
    });
  }, [deckList]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(deckList);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onExport('clipboard');
  }, [deckList, onExport]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([deckList], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'deck.txt';
    a.click();
    URL.revokeObjectURL(url);
    onExport('download');
  }, [deckList, onExport]);

  const handleSaveToList = useCallback(() => {
    if (!showListNameInput) {
      setListName(defaultListName);
      setShowListNameInput(true);
      return;
    }
    const name = listName.trim() || defaultListName;
    const cards = parseCardNames();
    onSaveToList(name, cards);
    setSaved(true);
    setShowListNameInput(false);
    setTimeout(() => setSaved(false), 2000);
  }, [showListNameInput, listName, defaultListName, parseCardNames, onSaveToList]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-xl shadow-2xl w-full max-w-2xl mx-4 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-bold">Export Deck</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <Button onClick={handleCopy} variant="outline" className="flex-col h-auto py-3">
              {copied ? <Check className="w-5 h-5 mb-1 text-green-500" /> : <Copy className="w-5 h-5 mb-1" />}
              <span className="text-xs">{copied ? `Copied ${cardCount} cards!` : 'Copy'}</span>
            </Button>
            <Button onClick={handleDownload} variant="outline" className="flex-col h-auto py-3">
              <Download className="w-5 h-5 mb-1" />
              <span className="text-xs">Download</span>
            </Button>
            <Button onClick={handleSaveToList} variant="outline" className="flex-col h-auto py-3" disabled={saved}>
              {saved ? <Check className="w-5 h-5 mb-1 text-green-500" /> : <Bookmark className="w-5 h-5 mb-1" />}
              <span className="text-xs">{saved ? 'Saved!' : 'Save Deck'}</span>
            </Button>
          </div>

          {showListNameInput && (
            <div className="flex gap-2">
              <input
                type="text"
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveToList(); }}
                placeholder="List name..."
                autoFocus
                className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <Button onClick={handleSaveToList} size="sm" className="shrink-0">
                Save
              </Button>
              <Button onClick={() => setShowListNameInput(false)} variant="ghost" size="sm" className="shrink-0">
                Cancel
              </Button>
            </div>
          )}

          {hasMustIncludes && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={excludeMustIncludes}
                onChange={(e) => setExcludeMustIncludes(e.target.checked)}
                className="rounded border-border accent-purple-500"
              />
              Exclude must-include cards
            </label>
          )}

          <textarea
            readOnly
            value={deckList}
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            className="w-full h-64 bg-background border border-border rounded-lg p-3 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Text Editor View ─────────────────────────────────────────────────
interface TextEditorViewProps {
  generateDeckList: () => string;
  onAddCards?: (cardNames: string[], destination: 'deck') => void;
  onRemoveCards?: (cardNames: string[]) => void;
  onChangeQuantity?: (cardName: string, newQuantity: number) => void;
  onClose?: () => void;
  readOnly?: boolean;
  sideboardNames?: string[];
  maybeboardNames?: string[];
  onSetSideboard?: (names: string[]) => void;
  onSetMaybeboard?: (names: string[]) => void;
  pushDeckHistory?: (entry: { action: 'add' | 'remove' | 'swap' | 'sideboard' | 'maybeboard'; cardName: string; targetCardName?: string }) => void;
}

function sortDeckListAlpha(raw: string): string {
  return raw.split('\n').filter(Boolean).sort((a, b) => {
    const nameA = a.replace(/^\d+\s+/, '').toLowerCase();
    const nameB = b.replace(/^\d+\s+/, '').toLowerCase();
    return nameA.localeCompare(nameB);
  }).join('\n');
}

function TextEditorView({ generateDeckList, onAddCards, onRemoveCards, onChangeQuantity, readOnly, onClose, sideboardNames, maybeboardNames, onSetSideboard, onSetMaybeboard, pushDeckHistory }: TextEditorViewProps) {
  const canEdit = !readOnly && (!!onAddCards || !!onRemoveCards);
  const hasSideboard = !!onSetSideboard;
  const hasMaybeboard = !!onSetMaybeboard;
  const hasBoards = hasSideboard || hasMaybeboard;

  type BoardTab = 'deck' | 'sideboard' | 'maybeboard';
  const [activeTab, setActiveTab] = useState<BoardTab>('deck');

  const [text, setText] = useState(() => sortDeckListAlpha(generateDeckList()));
  const [sbText, setSbText] = useState(() => sortDeckListAlpha((sideboardNames || []).map(n => '1 ' + n).join('\n')));
  const [mbText, setMbText] = useState(() => sortDeckListAlpha((maybeboardNames || []).map(n => '1 ' + n).join('\n')));

  const [applying, setApplying] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [addQuery, setAddQuery] = useState('');
  const [addSuggestions, setAddSuggestions] = useState<string[]>([]);
  const [showAddSearch, setShowAddSearch] = useState(false);
  const addSearchRef = useRef<HTMLDivElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync sideboard/maybeboard text when external data changes
  const sbKey = (sideboardNames || []).join(',');
  const mbKey = (maybeboardNames || []).join(',');
  const prevSbKeyRef = useRef(sbKey);
  const prevMbKeyRef = useRef(mbKey);
  useEffect(() => {
    if (sbKey !== prevSbKeyRef.current) {
      setSbText(sortDeckListAlpha((sideboardNames || []).map(n => '1 ' + n).join('\n')));
      prevSbKeyRef.current = sbKey;
    }
  }, [sbKey, sideboardNames]);
  useEffect(() => {
    if (mbKey !== prevMbKeyRef.current) {
      setMbText(sortDeckListAlpha((maybeboardNames || []).map(n => '1 ' + n).join('\n')));
      prevMbKeyRef.current = mbKey;
    }
  }, [mbKey, maybeboardNames]);

  // Autocomplete search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (addQuery.length < 2) { setAddSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      const results = await autocompleteCardName(addQuery);
      setAddSuggestions(results.slice(0, 8));
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [addQuery]);

  const handleAddCard = useCallback((name: string) => {
    if (activeTab === 'deck') {
      setText(prev => sortDeckListAlpha(prev + '\n1 ' + name));
    } else if (activeTab === 'sideboard') {
      setSbText(prev => sortDeckListAlpha(prev + '\n1 ' + name));
    } else {
      setMbText(prev => sortDeckListAlpha(prev + '\n1 ' + name));
    }
    setAddQuery('');
    setAddSuggestions([]);
    setTimeout(() => addInputRef.current?.focus(), 0);
  }, [activeTab]);
  const [lastAppliedDeckList, setLastAppliedDeckList] = useState(() => generateDeckList());

  // Re-sync text when deck changes externally (e.g. after apply, or switching back)
  const currentDeckList = generateDeckList();
  useEffect(() => {
    if (currentDeckList !== lastAppliedDeckList) {
      setText(sortDeckListAlpha(currentDeckList));
      setLastAppliedDeckList(currentDeckList);
      setErrors([]);
    }
  }, [currentDeckList, lastAppliedDeckList]);

  // Parse current text into a name→quantity map
  const parsedText = useMemo(() => {
    const result = parseCollectionList(text);
    const map = new Map<string, number>();
    for (const { name, quantity } of result.cards) {
      const lower = name.toLowerCase();
      map.set(lower, (map.get(lower) || 0) + quantity);
    }
    return map;
  }, [text]);

  // Parse current deck into a name→quantity map
  const currentDeckMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of currentDeckList.split('\n')) {
      const match = line.match(/^(\d+)\s+(.+)/);
      if (!match) continue;
      const qty = parseInt(match[1], 10);
      const name = match[2].trim().toLowerCase();
      map.set(name, (map.get(name) || 0) + qty);
    }
    return map;
  }, [currentDeckList]);

  // Compute diff
  const diff = useMemo(() => {
    const additions: string[] = [];
    const removals: string[] = [];
    const qtyChanges: { name: string; newQty: number }[] = [];

    // Check for additions & quantity increases
    for (const [name, newQty] of parsedText) {
      const oldQty = currentDeckMap.get(name) || 0;
      if (oldQty === 0) {
        for (let i = 0; i < newQty; i++) additions.push(name);
      } else if (newQty !== oldQty) {
        qtyChanges.push({ name, newQty });
      }
    }

    // Check for removals
    for (const [name, oldQty] of currentDeckMap) {
      if (!parsedText.has(name)) {
        for (let i = 0; i < oldQty; i++) removals.push(name);
      }
    }

    return { additions, removals, qtyChanges, hasChanges: additions.length > 0 || removals.length > 0 || qtyChanges.length > 0 };
  }, [parsedText, currentDeckMap]);

  const textCardCount = useMemo(() => {
    let count = 0;
    for (const qty of parsedText.values()) count += qty;
    return count;
  }, [parsedText]);

  const handleApply = useCallback(async () => {
    if (!diff.hasChanges) return;
    setApplying(true);
    setErrors([]);

    try {
      // Validate new card names with Scryfall
      const newNames = [...new Set(diff.additions)];
      const notFound: string[] = [];

      if (newNames.length > 0) {
        const found = await getCardsByNames(newNames);
        for (const name of newNames) {
          // getCardsByNames returns a Map keyed by original name
          if (!found.has(name)) {
            // Try case-insensitive match
            const match = [...found.keys()].find(k => k.toLowerCase() === name.toLowerCase());
            if (!match) notFound.push(name);
          }
        }
      }

      if (notFound.length > 0) {
        setErrors(notFound.map(n => `Card not found: "${n}"`));
        setApplying(false);
        return;
      }

      // Apply removals
      if (diff.removals.length > 0 && onRemoveCards) {
        // Need original-cased names for removal
        const originalNames: string[] = [];
        for (const line of currentDeckList.split('\n')) {
          const match = line.match(/^(\d+)\s+(.+)/);
          if (!match) continue;
          const name = match[2].trim();
          if (diff.removals.includes(name.toLowerCase())) {
            originalNames.push(name);
          }
        }
        if (originalNames.length > 0) {
          onRemoveCards(originalNames);
          for (const n of originalNames) pushDeckHistory?.({ action: 'remove', cardName: n });
        }
      }

      // Apply quantity changes
      if (diff.qtyChanges.length > 0 && onChangeQuantity) {
        for (const { name, newQty } of diff.qtyChanges) {
          // Find original-cased name and old quantity
          for (const line of currentDeckList.split('\n')) {
            const match = line.match(/^(\d+)\s+(.+)/);
            if (match && match[2].trim().toLowerCase() === name) {
              const oldQty = parseInt(match[1], 10);
              const cardDisplayName = match[2].trim();
              onChangeQuantity(cardDisplayName, newQty);
              if (newQty > oldQty) {
                for (let i = 0; i < newQty - oldQty; i++) pushDeckHistory?.({ action: 'add', cardName: cardDisplayName });
              } else if (newQty < oldQty) {
                for (let i = 0; i < oldQty - newQty; i++) pushDeckHistory?.({ action: 'remove', cardName: cardDisplayName });
              }
              break;
            }
          }
        }
      }

      // Apply additions
      if (diff.additions.length > 0 && onAddCards) {
        // Use validated names (proper casing) from Scryfall
        const validatedNames = await getCardsByNames([...new Set(diff.additions)]);
        const toAdd: string[] = [];
        for (const name of diff.additions) {
          const found = validatedNames.get(name) || [...validatedNames.values()].find(c => c.name.toLowerCase() === name.toLowerCase());
          if (found) toAdd.push(found.name);
        }
        if (toAdd.length > 0) {
          onAddCards(toAdd, 'deck');
          for (const n of toAdd) pushDeckHistory?.({ action: 'add', cardName: n });
        }
      }

      setLastAppliedDeckList(text);
    } catch (err) {
      setErrors(['Failed to validate cards. Please try again.']);
    } finally {
      setApplying(false);
    }
  }, [diff, onAddCards, onRemoveCards, onChangeQuantity, currentDeckList, text, pushDeckHistory]);

  // Board diffs (sideboard/maybeboard)
  const parseBoardText = useCallback((boardText: string) => {
    const result = parseCollectionList(boardText);
    return result.cards.map(c => c.name);
  }, []);

  const sbParsedNames = useMemo(() => parseBoardText(sbText), [sbText, parseBoardText]);
  const mbParsedNames = useMemo(() => parseBoardText(mbText), [mbText, parseBoardText]);

  const sbDiff = useMemo(() => {
    const oldSet = new Set((sideboardNames || []).map(n => n.toLowerCase()));
    const newSet = new Set(sbParsedNames.map(n => n.toLowerCase()));
    const added = sbParsedNames.filter(n => !oldSet.has(n.toLowerCase()));
    const removed = (sideboardNames || []).filter(n => !newSet.has(n.toLowerCase()));
    return { added, removed, hasChanges: added.length > 0 || removed.length > 0 };
  }, [sbParsedNames, sideboardNames]);

  const mbDiff = useMemo(() => {
    const oldSet = new Set((maybeboardNames || []).map(n => n.toLowerCase()));
    const newSet = new Set(mbParsedNames.map(n => n.toLowerCase()));
    const added = mbParsedNames.filter(n => !oldSet.has(n.toLowerCase()));
    const removed = (maybeboardNames || []).filter(n => !newSet.has(n.toLowerCase()));
    return { added, removed, hasChanges: added.length > 0 || removed.length > 0 };
  }, [mbParsedNames, maybeboardNames]);

  const handleApplyBoard = useCallback(async (board: 'sideboard' | 'maybeboard') => {
    const names = board === 'sideboard' ? sbParsedNames : mbParsedNames;
    const setter = board === 'sideboard' ? onSetSideboard : onSetMaybeboard;
    if (!setter) return;
    setApplying(true);
    setErrors([]);
    try {
      // Validate new card names
      const boardDiff = board === 'sideboard' ? sbDiff : mbDiff;
      if (boardDiff.added.length > 0) {
        const found = await getCardsByNames(boardDiff.added);
        const notFound = boardDiff.added.filter(n => !found.has(n) && ![...found.keys()].some(k => k.toLowerCase() === n.toLowerCase()));
        if (notFound.length > 0) {
          setErrors(notFound.map(n => `Card not found: "${n}"`));
          setApplying(false);
          return;
        }
        // Use validated names
        const validated = names.map(n => {
          const match = found.get(n) || [...found.values()].find(c => c.name.toLowerCase() === n.toLowerCase());
          return match ? match.name : n;
        });
        setter(validated);
      } else {
        setter(names);
      }
      // Track board changes in history
      const historyAction = board === 'sideboard' ? 'sideboard' as const : 'maybeboard' as const;
      for (const n of boardDiff.added) pushDeckHistory?.({ action: historyAction, cardName: n });
      for (const n of boardDiff.removed) pushDeckHistory?.({ action: 'remove', cardName: n });
    } catch {
      setErrors(['Failed to validate cards. Please try again.']);
    } finally {
      setApplying(false);
    }
  }, [sbParsedNames, mbParsedNames, sbDiff, mbDiff, onSetSideboard, onSetMaybeboard, pushDeckHistory]);

  const handleReset = useCallback(() => {
    if (activeTab === 'deck') {
      setText(sortDeckListAlpha(currentDeckList));
    } else if (activeTab === 'sideboard') {
      setSbText(sortDeckListAlpha((sideboardNames || []).map(n => '1 ' + n).join('\n')));
    } else {
      setMbText(sortDeckListAlpha((maybeboardNames || []).map(n => '1 ' + n).join('\n')));
    }
    setErrors([]);
  }, [activeTab, currentDeckList, sideboardNames, maybeboardNames]);

  // Active tab helpers
  const activeText = activeTab === 'deck' ? text : activeTab === 'sideboard' ? sbText : mbText;
  const activeSetText = activeTab === 'deck' ? setText : activeTab === 'sideboard' ? setSbText : setMbText;
  const activeDiff = activeTab === 'deck' ? diff : activeTab === 'sideboard' ? sbDiff : mbDiff;
  const activeCardCount = activeTab === 'deck' ? textCardCount : activeTab === 'sideboard' ? sbParsedNames.length : mbParsedNames.length;
  const activeHandleApply = activeTab === 'deck' ? handleApply : () => handleApplyBoard(activeTab);

  return (
    <div className="p-3 flex flex-col gap-2 h-full">
      {/* Header — add search + close */}
      <div className="flex items-center gap-1.5">
        {canEdit && (
          <div className="relative flex-1" ref={addSearchRef}>
            {showAddSearch ? (
              <>
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                <input
                  ref={addInputRef}
                  type="text"
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setShowAddSearch(false); setAddQuery(''); setAddSuggestions([]); }
                    if (e.key === 'Enter' && addSuggestions.length > 0) { handleAddCard(addSuggestions[0]); }
                  }}
                  placeholder="Add a card..."
                  className="w-full bg-background border border-border rounded-md pl-7 pr-7 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
                  autoFocus
                />
                <button
                  onClick={() => { setShowAddSearch(false); setAddQuery(''); setAddSuggestions([]); }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3 h-3" />
                </button>
                {addSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 mt-1 z-50 w-full max-h-[240px] overflow-auto bg-card border border-border rounded-lg shadow-2xl py-1">
                    {addSuggestions.map((name) => (
                      <button
                        key={name}
                        onClick={() => handleAddCard(name)}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 transition-colors truncate"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <button
                onClick={() => { setShowAddSearch(true); setTimeout(() => addInputRef.current?.focus(), 0); }}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                title="Add a card"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors shrink-0 ml-auto"
            title="Close text editor"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {/* Board Tabs */}
      {hasBoards && (
        <div className="flex border-b border-border/50 -mx-3 px-3">
          {(['deck', ...(hasSideboard ? ['sideboard'] : []), ...(hasMaybeboard ? ['maybeboard'] : [])] as BoardTab[]).map(tab => {
            const count = tab === 'deck' ? textCardCount : tab === 'sideboard' ? sbParsedNames.length : mbParsedNames.length;
            const label = tab === 'deck' ? 'Deck' : tab === 'sideboard' ? 'Sideboard' : 'Maybe';
            const color = tab === 'sideboard' ? 'text-amber-400' : tab === 'maybeboard' ? 'text-purple-400' : '';
            return (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); setErrors([]); }}
                className={`px-3 py-1.5 text-xs font-medium transition-colors relative ${
                  activeTab === tab
                    ? `${color || 'text-foreground'} after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-current`
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}{count > 0 ? ` (${count}${(tab === 'deck' ? diff.hasChanges : tab === 'sideboard' ? sbDiff.hasChanges : mbDiff.hasChanges) ? '*' : ''})` : ''}
              </button>
            );
          })}
        </div>
      )}

      {/* Textarea */}
      <textarea
        value={activeText}
        onChange={canEdit ? (e) => activeSetText(e.target.value) : undefined}
        readOnly={!canEdit}
        onClick={!canEdit ? (e) => (e.target as HTMLTextAreaElement).select() : undefined}
        spellCheck={false}
        className="w-full flex-1 min-h-[520px] bg-background border border-border rounded-none p-3 font-mono text-xs resize-y focus:outline-none focus:ring-2 focus:ring-primary/50 leading-tight"
        placeholder="1 Card Name&#10;2 Another Card&#10;..."
      />

      {/* Errors */}
      {errors.length > 0 && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2 space-y-0.5">
          {errors.map((err, i) => (
            <p key={i} className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              {err}
            </p>
          ))}
        </div>
      )}

      {/* Toolbar — bottom */}
      {canEdit ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground tabular-nums">{activeCardCount} cards</span>

          {activeDiff.hasChanges && (() => {
            const addCount = activeTab === 'deck' ? diff.additions.length : (activeTab === 'sideboard' ? sbDiff.added.length : mbDiff.added.length);
            const removeCount = activeTab === 'deck' ? diff.removals.length : (activeTab === 'sideboard' ? sbDiff.removed.length : mbDiff.removed.length);
            const qtyCount = activeTab === 'deck' ? diff.qtyChanges.length : 0;
            return (
              <span className="text-xs text-muted-foreground">
                {addCount > 0 && <span className="text-emerald-400">+{addCount}</span>}
                {addCount > 0 && removeCount > 0 && ' '}
                {removeCount > 0 && <span className="text-red-400">-{removeCount}</span>}
                {qtyCount > 0 && <span className="text-sky-400"> {qtyCount} changed</span>}
              </span>
            );
          })()}

          <div className="ml-auto flex items-center gap-1.5">
            {activeDiff.hasChanges && (
              <button
                onClick={handleReset}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg text-muted-foreground hover:text-foreground transition-colors"
              >
                Reset
              </button>
            )}
            <button
              onClick={activeHandleApply}
              disabled={!activeDiff.hasChanges || applying}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              {applying && <Loader2Icon className="w-3 h-3 animate-spin" />}
              Apply Changes
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground/60 italic">Read-only — switch to a saved list to edit via text</p>
      )}
    </div>
  );
}

// Mana color configuration
const MANA_COLORS: Record<string, { name: string; color: string; bgColor: string }> = {
  W: { name: 'White', color: '#F9FAF4', bgColor: 'bg-amber-100' },
  U: { name: 'Blue', color: '#0E68AB', bgColor: 'bg-blue-500' },
  B: { name: 'Black', color: '#D8B4FE', bgColor: 'bg-purple-300' }, // Matches bg-purple-300 for consistency
  R: { name: 'Red', color: '#D3202A', bgColor: 'bg-red-500' },
  G: { name: 'Green', color: '#00733E', bgColor: 'bg-green-600' },
  C: { name: 'Colorless', color: '#CBC2BF', bgColor: 'bg-gray-400' },
};

// SVG Pie Chart Component
// PieChart is now imported from '@/components/ui/pie-chart'

// Calculate mana pip distribution from cards
function calculateManaPips(cards: ScryfallCard[]): Record<string, number> {
  const pips: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

  for (const card of cards) {
    const manaCost = card.mana_cost || '';
    const symbols = manaCost.match(/\{[^}]+\}/g) || [];

    for (const symbol of symbols) {
      const clean = symbol.replace(/[{}]/g, '');
      if (clean === 'W') pips.W++;
      else if (clean === 'U') pips.U++;
      else if (clean === 'B') pips.B++;
      else if (clean === 'R') pips.R++;
      else if (clean === 'G') pips.G++;
      else if (clean === 'C') pips.C++;
      // Hybrid mana counts as both
      else if (clean.includes('/')) {
        const parts = clean.split('/');
        for (const part of parts) {
          if (part === 'W') pips.W += 0.5;
          else if (part === 'U') pips.U += 0.5;
          else if (part === 'B') pips.B += 0.5;
          else if (part === 'R') pips.R += 0.5;
          else if (part === 'G') pips.G += 0.5;
        }
      }
    }
  }

  return pips;
}

// Calculate mana production from lands
function calculateManaProduction(cards: ScryfallCard[]): Record<string, number> {
  const production: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

  for (const card of cards) {
    const typeLine = card.type_line?.toLowerCase() || '';
    if (!typeLine.includes('land')) continue;

    const producedMana = card.produced_mana || [];
    const oracleText = card.oracle_text?.toLowerCase() || '';

    // Check produced_mana field first
    for (const mana of producedMana) {
      if (mana === 'W') production.W++;
      else if (mana === 'U') production.U++;
      else if (mana === 'B') production.B++;
      else if (mana === 'R') production.R++;
      else if (mana === 'G') production.G++;
      else if (mana === 'C') production.C++;
    }

    // Fallback to basic land types
    if (producedMana.length === 0) {
      if (typeLine.includes('plains') || oracleText.includes('add {w}')) production.W++;
      if (typeLine.includes('island') || oracleText.includes('add {u}')) production.U++;
      if (typeLine.includes('swamp') || oracleText.includes('add {b}')) production.B++;
      if (typeLine.includes('mountain') || oracleText.includes('add {r}')) production.R++;
      if (typeLine.includes('forest') || oracleText.includes('add {g}')) production.G++;
      if (oracleText.includes('add {c}')) production.C++;
    }
  }

  return production;
}

// Bracket estimation helpers
const BRACKET_DOT_COLORS: Record<number, string> = {
  1: 'bg-emerald-400',
  2: 'bg-sky-400',
  3: 'bg-amber-400',
  4: 'bg-orange-400',
  5: 'bg-red-400',
};

const BRACKET_TEXT_COLORS: Record<number, string> = {
  1: 'text-emerald-400',
  2: 'text-sky-400',
  3: 'text-amber-400',
  4: 'text-orange-400',
  5: 'text-red-400',
};

const BRACKET_DESCRIPTIONS: Record<number, string> = {
  1: 'Casual — theme-focused, no fast mana or combos',
  2: 'Precon-level — light synergy, no game changers',
  3: 'Focused — up to 3 game changers, late combos',
  4: 'High power — strong engines, tutors, and combos',
  5: 'Competitive — optimized to win as early as possible',
};

function formatBracketTooltip(est: import('@/services/deckBuilder/bracketEstimator').BracketEstimation): string {
  const lines: string[] = [BRACKET_DESCRIPTIONS[est.bracket]];
  const { breakdown: b } = est;

  const signals: string[] = [];
  if (b.fastManaCount > 0) signals.push(`${b.fastManaCount} fast mana`);
  if (b.tutorCount > 0) signals.push(`${b.tutorCount} tutor${b.tutorCount > 1 ? 's' : ''}`);
  if (b.gameChangerCount > 0) signals.push(`${b.gameChangerCount} game changer${b.gameChangerCount > 1 ? 's' : ''}: ${b.gameChangerNames.join(', ')}`);
  if (b.earlyComboCount > 0) signals.push(`${b.earlyComboCount} early combo${b.earlyComboCount > 1 ? 's' : ''}`);
  if (b.lateComboCount > 0) signals.push(`${b.lateComboCount} late combo${b.lateComboCount > 1 ? 's' : ''}`);
  if (b.extraTurnCount > 0) signals.push(`${b.extraTurnCount} extra turn${b.extraTurnCount > 1 ? 's' : ''}`);
  if (b.massLandDenialCount > 0) signals.push(`${b.massLandDenialCount} mass land denial`);

  if (signals.length > 0) {
    lines.push('');
    lines.push(signals.join('\n'));
  }

  return lines.join('\n');
}

// Stats sidebar
interface DeckStatsProps {
  activeFilter: StatsFilter;
  onFilterChange: (filter: StatsFilter) => void;
  showRoles: boolean;
  onToggleRoles: () => void;
  hideHeader?: boolean;
  collectionNames?: Set<string> | null;
  showCollection?: boolean;
  showRelevancy?: boolean;
  overallGrade?: { letter: string; headline: string } | null;
}

function DeckStats({ activeFilter, onFilterChange, showRoles, onToggleRoles, hideHeader, collectionNames, showCollection, showRelevancy: _showRelevancy, overallGrade }: DeckStatsProps) {
  const { generatedDeck, colorIdentity } = useStore();
  if (!generatedDeck) return null;

  const { stats, categories, partnerCommander } = generatedDeck;
  const commanderCount = (generatedDeck.commander ? 1 : 0) + (partnerCommander ? 1 : 0);
  const totalCardsWithCommander = stats.totalCards + commanderCount;
  const maxCurveCount = Math.max(...Object.values(stats.manaCurve), 1);

  // Get all cards for mana calculations
  const allCards = Object.values(categories).flat();
  const ownedCount = (showCollection && collectionNames)
    ? allCards.filter(c => {
        const name = c.name.includes(' // ') ? c.name.split(' // ')[0] : c.name;
        return collectionNames.has(name);
      }).length
    : null;
  const nonLandCards = allCards.filter(c => !getFrontFaceTypeLine(c).toLowerCase().includes('land'));

  // Calculate mana pips and production
  const manaPips = calculateManaPips(nonLandCards);
  const manaProduction = calculateManaProduction(allCards);

  const totalPips = Object.values(manaPips).reduce((a, b) => a + b, 0);
  const totalProduction = Object.values(manaProduction).reduce((a, b) => a + b, 0);

  // Prepare pie chart data
  const pieData = Object.entries(manaPips)
    .filter(([, value]) => value > 0)
    .map(([color, value]) => ({
      color: MANA_COLORS[color].color,
      value,
      label: MANA_COLORS[color].name,
      colorKey: color,
    }));

  return (
    <div className="bg-card/50 rounded-lg border border-border/50 p-4 space-y-5">
      {!hideHeader && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-sm uppercase tracking-wide text-muted-foreground">Statistics</h3>
            {activeFilter && (
              <button
                onClick={() => onFilterChange(activeFilter)}
                className="flex items-center gap-1.5 text-xs text-primary bg-primary/10 rounded-full px-2.5 py-0.5 hover:bg-primary/20 transition-colors"
              >
                <X className="w-3 h-3" />
                <span>
                  {activeFilter.type === 'cmc' && `CMC ${activeFilter.value === 7 ? '7+' : activeFilter.value}`}
                  {activeFilter.type === 'color' && `${MANA_COLORS[activeFilter.value]?.name} pips`}
                  {activeFilter.type === 'manaProduction' && `${MANA_COLORS[activeFilter.value]?.name} sources`}
                  {activeFilter.type === 'role' && `${
                    ({ ramp: 'Ramp', removal: 'Removal', boardwipe: 'Board Wipes', cardDraw: 'Card Advantage' } as Record<string, string>)[activeFilter.value] ?? activeFilter.value
                  }`}
                </span>
              </button>
            )}
          </div>

          {/* Basic Stats */}
          <div className={`grid gap-3 ${ownedCount !== null ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <div className="bg-accent/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-foreground">{totalCardsWithCommander}</div>
              <div className="text-xs text-muted-foreground">Cards</div>
            </div>
            <div className="bg-accent/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-foreground">{stats.averageCmc}</div>
              <div className="text-xs text-muted-foreground">Avg CMC</div>
            </div>
            {ownedCount !== null && (
              <div className="bg-accent/30 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-foreground">{ownedCount}</div>
                <div className="text-xs text-muted-foreground">Owned</div>
              </div>
            )}
          </div>
          {generatedDeck.bracketEstimation && (() => {
            const b = generatedDeck.bracketEstimation;
            return (
              <div className="-mt-2">
                <div className="flex items-center gap-2 px-1">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${BRACKET_DOT_COLORS[b.bracket]}`} />
                  <span className={`text-xs font-medium ${BRACKET_TEXT_COLORS[b.bracket]}`}>Bracket {b.bracket}</span>
                  <span className="text-xs text-muted-foreground">{b.label}</span>
                  <span className="ml-auto"><InfoTooltip text={formatBracketTooltip(b)} /></span>
                </div>
                <div className="text-[10px] text-muted-foreground/60 px-1 -mt-1">Estimated from deck contents</div>
              </div>
            );
          })()}
          {overallGrade && (() => {
            const style = HEALTH_GRADE_STYLES[overallGrade.letter] || HEALTH_GRADE_STYLES.C;
            return (
              <div className="flex items-center gap-3 bg-accent/30 rounded-lg px-3 py-2.5 -mt-2">
                <span className={`text-2xl font-black leading-none px-2 py-1 rounded ${style.color} ${style.badgeBg}`}>{overallGrade.letter}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">Deck Grade</span>
                    <button
                      onClick={() => {
                        document.dispatchEvent(new CustomEvent('deck-optimizer-open'));
                        setTimeout(() => {
                          document.getElementById('deck-optimizer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }, 100);
                      }}
                      className="text-[10px] text-primary hover:text-primary/80 transition-colors"
                    >
                      See more →
                    </button>
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-snug">{overallGrade.headline}</div>
                </div>
              </div>
            );
          })()}
        </>
      )}
      {hideHeader && activeFilter && (
        <div className="flex justify-end">
          <button
            onClick={() => onFilterChange(activeFilter)}
            className="flex items-center gap-1.5 text-xs text-primary bg-primary/10 rounded-full px-2.5 py-0.5 hover:bg-primary/20 transition-colors"
          >
            <X className="w-3 h-3" />
            <span>
              {activeFilter.type === 'cmc' && `CMC ${activeFilter.value === 7 ? '7+' : activeFilter.value}`}
              {activeFilter.type === 'color' && `${MANA_COLORS[activeFilter.value]?.name} pips`}
              {activeFilter.type === 'manaProduction' && `${MANA_COLORS[activeFilter.value]?.name} sources`}
              {activeFilter.type === 'role' && `${
                ({ ramp: 'Ramp', removal: 'Removal', boardwipe: 'Board Wipes', cardDraw: 'Card Advantage' } as Record<string, string>)[activeFilter.value] ?? activeFilter.value
              }`}
            </span>
          </button>
        </div>
      )}

      {/* Mana Curve */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">Mana Curve</div>
        <div className="flex items-end gap-1 h-16">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((cmc) => {
            const count = stats.manaCurve[cmc] || 0;
            const height = (count / maxCurveCount) * 100;
            const isActive = activeFilter?.type === 'cmc' && activeFilter?.value === cmc;
            return (
              <button
                key={cmc}
                className={`flex-1 flex flex-col items-center ${
                  count === 0 ? 'pointer-events-none' : 'cursor-pointer group'
                }`}
                onClick={() => count > 0 && onFilterChange({ type: 'cmc', value: cmc })}
                title={`${cmc === 7 ? '7+' : cmc} CMC: ${count} cards`}
              >
                <div className="w-full flex flex-col items-center justify-end h-12">
                  <div
                    className={`w-full rounded-t transition-colors ${
                      isActive ? 'bg-primary ring-1 ring-primary/50' : 'bg-primary/70 group-hover:bg-primary/90'
                    }`}
                    style={{ height: `${height}%`, minHeight: count > 0 ? '4px' : '0' }}
                  />
                </div>
                <span className={`text-[10px] mt-1 ${
                  isActive ? 'text-primary font-bold' : 'text-muted-foreground'
                }`}>
                  {cmc === 7 ? '7+' : cmc}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Mana Distribution - Pie Chart */}
      {totalPips > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-3">Color Distribution</div>
          <div className="flex items-center gap-4">
            <PieChart
              data={pieData}
              size={80}
              activeColorKey={activeFilter?.type === 'color' ? activeFilter.value : null}
              onSegmentClick={(colorKey) => onFilterChange({ type: 'color', value: colorKey })}
            />
            <div className="flex-1 space-y-0.5">
              {Object.entries(manaPips)
                .filter(([, value]) => value > 0)
                .sort(([, a], [, b]) => b - a)
                .map(([color, value]) => {
                  const percent = ((value / totalPips) * 100).toFixed(0);
                  const isActive = activeFilter?.type === 'color' && activeFilter?.value === color;
                  return (
                    <button
                      key={color}
                      className={`flex items-center gap-2 w-full rounded px-1 py-0.5 transition-colors cursor-pointer ${
                        isActive ? 'bg-accent/50' : 'hover:bg-accent/30'
                      }`}
                      onClick={() => onFilterChange({ type: 'color', value: color })}
                    >
                      <div
                        className={`w-3 h-3 rounded-full ${isActive ? 'ring-2 ring-primary' : ''}`}
                        style={{ backgroundColor: MANA_COLORS[color].color }}
                      />
                      <span className="text-xs flex-1 text-left">{MANA_COLORS[color].name}</span>
                      <span className={`text-xs font-medium ${isActive ? 'text-primary' : ''}`}>{percent}%</span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* Mana Production */}
      {totalProduction > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-2">Mana Production</div>
          <div className="space-y-1">
            {Object.entries(manaProduction)
              .filter(([color, value]) => value > 0 && (color === 'C' || colorIdentity.includes(color)))
              .sort(([, a], [, b]) => b - a)
              .map(([color, value]) => {
                const percent = (value / totalProduction) * 100;
                const isActive = activeFilter?.type === 'manaProduction' && activeFilter?.value === color;
                return (
                  <button
                    key={color}
                    className={`w-full text-left rounded px-1 py-1 transition-colors cursor-pointer ${
                      isActive ? 'bg-accent/50' : 'hover:bg-accent/30'
                    }`}
                    onClick={() => onFilterChange({ type: 'manaProduction', value: color })}
                  >
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${MANA_COLORS[color].bgColor} ${
                          isActive ? 'ring-2 ring-primary' : ''
                        }`} />
                        <span>{MANA_COLORS[color].name}</span>
                      </div>
                      <span className="text-muted-foreground">{value} sources ({percent.toFixed(0)}%)</span>
                    </div>
                    <div className="h-1.5 bg-accent/50 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${MANA_COLORS[color].bgColor} ${isActive ? 'opacity-100' : 'opacity-80'}`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Deck Roles — only when balanced roles mode was active */}
      {generatedDeck.roleTargets && generatedDeck.roleCounts && (
        <div>
          <button
            type="button"
            onClick={onToggleRoles}
            className="flex items-center gap-1 text-xs text-muted-foreground mb-2 hover:text-foreground transition-colors cursor-pointer w-full"
          >
            {showRoles ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Deck Roles
          </button>
          {showRoles && <div className="space-y-1.5">
            {([
              ['ramp', 'Ramp', 'bg-emerald-500', Sprout],
              ['removal', 'Removal', 'bg-red-500', Swords],
              ['boardwipe', 'Board Wipes', 'bg-orange-500', Flame],
              ['cardDraw', 'Card Advantage', 'bg-blue-500', BookOpen],
            ] as [string, string, string, typeof Sprout][]).map(([key, label, barColor, Icon]) => {
              const count = generatedDeck.roleCounts![key] ?? 0;
              const target = generatedDeck.roleTargets![key] ?? 0;
              const percent = target > 0 ? Math.min(100, (count / target) * 100) : 100;
              const met = count >= target;
              const isActive = activeFilter?.type === 'role' && activeFilter.value === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onFilterChange({ type: 'role', value: key })}
                  className={`w-full text-left rounded-md px-1.5 py-1 -mx-1.5 transition-colors cursor-pointer ${
                    isActive ? 'bg-primary/15 ring-1 ring-primary/30' : 'hover:bg-accent/50'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="flex items-center gap-1.5"><Icon className="w-3 h-3 text-muted-foreground" />{label}</span>
                    <span className={met ? 'text-emerald-500' : 'text-amber-500'}>
                      {count}{import.meta.env.DEV && <> / {target}</>}
                    </span>
                  </div>
                  <div className="h-1.5 bg-accent/50 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barColor} ${met ? 'opacity-80' : 'opacity-60'}`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  {count > 0 && (() => {
                    const subtypeConfig: Record<string, { counts: Record<string, number> | undefined; entries: [string, string, string][] }> = {
                      ramp: {
                        counts: generatedDeck.rampSubtypeCounts,
                        entries: [['mana-producer', 'producer', 'text-lime-400/80'], ['mana-rock', 'rock', 'text-yellow-400/80'], ['cost-reducer', 'reducer', 'text-teal-400/80'], ['ramp', 'ramp', 'text-emerald-400/80']],
                      },
                      removal: {
                        counts: generatedDeck.removalSubtypeCounts,
                        entries: [['counterspell', 'counter', 'text-sky-400/80'], ['bounce', 'bounce', 'text-cyan-400/80'], ['spot-removal', 'spot', 'text-rose-400/80'], ['removal', 'other', 'text-red-300/80']],
                      },
                      boardwipe: {
                        counts: generatedDeck.boardwipeSubtypeCounts,
                        entries: [['bounce-wipe', 'bounce', 'text-cyan-400/80'], ['boardwipe', 'other', 'text-orange-400/80']],
                      },
                      cardDraw: {
                        counts: generatedDeck.cardDrawSubtypeCounts,
                        entries: [['tutor', 'tutor', 'text-amber-400/80'], ['wheel', 'wheel', 'text-pink-400/80'], ['cantrip', 'cantrip', 'text-sky-400/80'], ['card-draw', 'draw', 'text-blue-400/80'], ['card-advantage', 'other', 'text-indigo-400/80']],
                      },
                    };
                    const config = subtypeConfig[key];
                    if (!config?.counts) return null;
                    const visible = config.entries.filter(([k]) => (config.counts![k] ?? 0) > 0);
                    if (visible.length === 0) return null;
                    return (
                      <div className="flex flex-wrap gap-x-2 mt-0.5 text-[10px] text-muted-foreground pl-4">
                        {visible.map(([k, label, color]) => (
                          <span key={k} className={color}>{config.counts![k]} {label}</span>
                        ))}
                      </div>
                    );
                  })()}
                </button>
              );
            })}
          </div>}
        </div>
      )}

      {/* Type Distribution */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">Types</div>
        <div className="space-y-1">
          {Object.entries(stats.typeDistribution)
            .sort(([, a], [, b]) => b - a)
            .map(([type, count]) => {
              const target = generatedDeck.typeTargets?.[type.toLowerCase()];
              return (
                <div key={type} className="flex justify-between text-xs">
                  <span>{type}</span>
                  <span className="text-muted-foreground">
                    {count}
                    {import.meta.env.DEV && target != null && (
                      <span className={`ml-1 ${count === target ? 'text-green-500' : count < target ? 'text-amber-500' : 'text-blue-400'}`}>
                        / {target}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
        </div>
      </div>

    </div>
  );
}

export function RemovedCardsDialog({ removedCards, onClose }: { removedCards: string[]; onClose: () => void }) {
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [hoverY, setHoverY] = useState(0);

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4 max-h-[70vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <h3 className="text-sm font-semibold">Removed Cards ({removedCards.length})</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-4 space-y-0.5">
          {removedCards.map(name => (
            <div
              key={name}
              className="text-sm text-muted-foreground py-1 px-2 -mx-2 rounded hover:bg-accent/50 hover:text-foreground cursor-default transition-colors"
              onMouseEnter={(e) => {
                setHoveredCard(name);
                setHoverY(e.currentTarget.getBoundingClientRect().top);
              }}
              onMouseLeave={() => setHoveredCard(null)}
            >
              {name.includes(' // ') ? name.split(' // ')[0] : name}
            </div>
          ))}
        </div>
      </div>
      {hoveredCard && (
        <div
          className="fixed pointer-events-none hidden md:block"
          style={{
            top: Math.max(8, Math.min(hoverY - 100, window.innerHeight - 360)),
            right: `calc(50% + 210px)`,
          }}
        >
          <img
            src={(() => { const c = getCachedCard(hoveredCard); return c ? getCardImageUrl(c, 'normal') : `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(hoveredCard)}&format=image&version=normal`; })()}
            alt={hoveredCard}
            className="w-[250px] rounded-xl shadow-2xl border border-border/50"
          />
        </div>
      )}
    </div>,
    document.body
  );
}

type GroupedCards = Record<CardType, Array<{ card: ScryfallCard; quantity: number }>>;

// Persist the last-used "Add to" tab across open/close
let lastAddToTab: 'lists' | 'deck' = 'deck';

// Main component
interface DeckDisplayProps {
  onRegenerate?: () => void;
  /** When true, hide must-include badges and controls (read-only list deck view) */
  readOnly?: boolean;
  /** When true, hide the regenerate button (edit mode still available) */
  hideRegenerate?: boolean;
  /** Progress percentage (0-100) during regeneration */
  regenerateProgress?: number;
  /** Progress message during regeneration */
  regenerateMessage?: string;
  /** Callback to remove cards from a saved list (used in list deck view) */
  onRemoveCards?: (cardNames: string[]) => void;
  /** Callback to add cards (used in text view to apply edits) */
  onAddCards?: (cardNames: string[], destination: 'deck') => void;
  /** Callbacks to move cards to sideboard/maybeboard (used in list deck view) */
  onMoveToSideboard?: (cardNames: string[]) => void;
  onMoveToMaybeboard?: (cardNames: string[]) => void;
  /** Slot rendered in toolbar next to Modify Deck button (e.g. add-card search) */
  toolbarExtra?: React.ReactNode;
  /** Board counts shown in the toolbar summary (e.g. "2 sideboard · 1 maybe") */
  boardCounts?: { sideboard: number; maybeboard: number };
  /** Content rendered inside the deck card (e.g. boards) */
  deckFooter?: React.ReactNode;
  /** Render prop for header-level actions (e.g. export, save). Receives onExport trigger. When provided, the Export button is removed from the summary row. */
  renderHeaderActions?: (actions: { onExport: () => void }) => React.ReactNode;
  /** Callback to change the quantity of a card (for list deck views) */
  onChangeQuantity?: (cardName: string, newQuantity: number) => void;
  /** Called when edit mode is toggled */
  onEditModeChange?: (editing: boolean) => void;
  /** Content rendered above the Statistics sidebar on desktop (e.g. Export/Save buttons) */
  sidebarHeader?: React.ReactNode;
  /** Extra buttons rendered on the left side of the sidebar header row (next to Edit) */
  sidebarLeftActions?: React.ReactNode;
  /** Sideboard/maybeboard card names for text editor tabs */
  sideboardNames?: string[];
  maybeboardNames?: string[];
  onSetSideboard?: (names: string[]) => void;
  onSetMaybeboard?: (names: string[]) => void;
  children?: React.ReactNode;
}

export function DeckDisplay({ onRegenerate, readOnly, hideRegenerate, regenerateProgress, regenerateMessage, onRemoveCards, onAddCards, onMoveToSideboard, onMoveToMaybeboard, toolbarExtra, boardCounts, deckFooter, renderHeaderActions, onChangeQuantity, onEditModeChange, sidebarHeader, sidebarLeftActions, sideboardNames, maybeboardNames, onSetSideboard, onSetMaybeboard, children }: DeckDisplayProps) {
  const navigate = useNavigate();
  const { generatedDeck, commander, customization, swapDeckCard, updateCustomization, pushDeckHistory, colorIdentity } = useStore();
  const { lists: userLists, createList, updateList, deleteList } = useUserLists();
  const formatConfig = getDeckFormatConfig(customization.deckFormat);
  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);
  const [hoverCard, setHoverCard] = useState<{ card: ScryfallCard; rowRect: { right: number; top: number; height: number }; showBack?: boolean } | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [showTextEditor, _setShowTextEditor] = useState(() => localStorage.getItem('mtg-deck-show-text-editor') === 'true');
  const setShowTextEditor = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    _setShowTextEditor(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      localStorage.setItem('mtg-deck-show-text-editor', String(next));
      return next;
    });
  }, []);
  const [sortBy, setSortBy] = useState<'name' | 'cmc' | 'price' | 'score' | 'relevancy'>('name');
  const [gridAnimateRef] = useAutoAnimate({ duration: 250 });
  const [statsFilter, setStatsFilter] = useState<StatsFilter>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [toastMessage, setToastMessage] = useState<{ text: string; onUndo?: () => void } | null>(null);
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [removedCards, setRemovedCards] = useState<Set<string>>(new Set());
  const tempBannedRef = useRef(customization.tempBannedCards || []);
  tempBannedRef.current = customization.tempBannedCards || [];
  const [showRoles, setShowRoles] = useState(() => localStorage.getItem('deckRolesOpen') === 'true');
  const [showPrice, setShowPrice] = useState(() => localStorage.getItem('mtg-deck-show-price') !== 'false');
  const [showInclusion, setShowInclusion] = useState(() => localStorage.getItem('mtg-deck-show-inclusion') === 'true');
  const [showRelevancy, setShowRelevancy] = useState(() => localStorage.getItem('mtg-deck-show-relevancy') === 'true');
  const [showCollectionChecks, setShowCollectionChecks] = useState(
    () => localStorage.getItem('mtg-deck-builder-show-collection-checks') !== 'false'
  );
  const [showPinBan, setShowPinBan] = useState(() => localStorage.getItem('mtg-deck-show-pin-ban') !== 'false');
  const [showIcons, setShowIcons] = useState(() => localStorage.getItem('mtg-deck-show-icons') !== 'false');
  const [showMenu, setShowMenu] = useState(false);
  const showMenuRef = useRef<HTMLDivElement>(null);
  const showMenuMobileRef = useRef<HTMLDivElement>(null);
  const [mobileStatsOpen, setMobileStatsOpen] = useState(false);
  const [collectionNames, setCollectionNames] = useState<Set<string> | null>(null);
  const [isEditMode, _setIsEditMode] = useState(false);
  const editModeRef = useRef(false);
  const setIsEditMode = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    _setIsEditMode(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      editModeRef.current = next;
      return next;
    });
  }, []);
  // Notify parent of edit mode changes outside of render
  useEffect(() => {
    onEditModeChange?.(isEditMode);
  }, [isEditMode, onEditModeChange]);
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const [showAddToDropdown, setShowAddToDropdown] = useState(false);
  const [editDrawerTab, setEditDrawerTab] = useState<'actions' | 'move' | 'add'>('actions');
  const [collapsedGridCategories, setCollapsedGridCategories] = useState<Set<CardType>>(new Set());
  const [addToTab, setAddToTabRaw] = useState<'lists' | 'deck'>(lastAddToTab);
  const setAddToTab = useCallback((tab: 'lists' | 'deck') => { lastAddToTab = tab; setAddToTabRaw(tab); }, []);
  const [listSearchQuery, setListSearchQuery] = useState('');
  const [newListName, setNewListName] = useState('');
  const [showNewListInput, setShowNewListInput] = useState(false);
  const newListInputRef = useRef<HTMLInputElement>(null);
  const addToDropdownRef = useRef<HTMLDivElement>(null);
  const lastSelectedIdRef = useRef<string | null>(null);
  const flatCardOrderRef = useRef<string[]>([]);

  // Listen for preference changes from the gear menu
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail.showCollectionChecks === 'boolean')
        setShowCollectionChecks(detail.showCollectionChecks);
    };
    window.addEventListener('prefs-changed', handler);
    return () => window.removeEventListener('prefs-changed', handler);
  }, []);

  // Close show menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (
        showMenuRef.current && !showMenuRef.current.contains(e.target as Node) &&
        (!showMenuMobileRef.current || !showMenuMobileRef.current.contains(e.target as Node))
      ) { setShowMenu(false); }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  // Load collection names for "owned" indicators
  useEffect(() => {
    getCollectionNameSet().then(names => {
      if (names.size > 0) setCollectionNames(names);
    });
  }, [generatedDeck]);

  // Background deck analysis for overall grade (EA only)
  const [overallGrade, setOverallGrade] = useState<{ letter: string; headline: string } | null>(null);
  useEffect(() => {
    if (!generatedDeck || localStorage.getItem('ea-features-enabled') !== 'true') {
      setOverallGrade(null);
      return;
    }
    if (!generatedDeck.roleTargets) {
      setOverallGrade(null);
      return;
    }
    let cancelled = false;

    const runAnalysis = (edhrecData: import('@/types').EDHRECCommanderData) => {
      if (cancelled) return;
      try {
        const allCards = Object.values(generatedDeck.categories).flat();
        // Use target format size (same as Optimizer) so grades match,
        // not actual card count which can be 1-2 short.
        // deckFormat already excludes the main commander; partners take one additional slot.
        const deckSize = customization.deckFormat - (generatedDeck.partnerCommander ? 1 : 0);
        // Recompute role counts from actual current cards (not stale generation-time counts)
        const freshRoleCounts: Record<string, number> = {};
        for (const card of allCards) {
          const role = getCardRole(card.name);
          if (role) freshRoleCounts[role] = (freshRoleCounts[role] || 0) + 1;
        }
        const analysis = analyzeDeck(
          edhrecData,
          allCards,
          freshRoleCounts,
          generatedDeck.roleTargets!,
          deckSize,
          generatedDeck.cardInclusionMap,
          colorIdentity,
        );
        const summary = getDeckSummaryData(analysis);
        if (!cancelled) setOverallGrade({ letter: summary.gradeLetter, headline: summary.headline });
      } catch {
        if (!cancelled) setOverallGrade(null);
      }
    };

    // Try generation cache first (free, already fetched)
    const cached = getGenerationCacheEdhrecData();
    if (cached) {
      const id = requestAnimationFrame(() => runAnalysis(cached));
      return () => { cancelled = true; cancelAnimationFrame(id); };
    }

    // No cache — fetch EDHREC data in background (e.g. list deck view)
    const commanderName = generatedDeck.commander?.name;
    const partnerName = generatedDeck.partnerCommander?.name;
    if (!commanderName) {
      setOverallGrade(null);
      return;
    }
    (partnerName
      ? import('@/services/edhrec/client').then(m => m.fetchPartnerCommanderData(commanderName, partnerName))
      : import('@/services/edhrec/client').then(m => m.fetchCommanderData(commanderName))
    ).then(data => { if (!cancelled) runAnalysis(data); })
     .catch(() => { if (!cancelled) setOverallGrade(null); });

    return () => { cancelled = true; };
  }, [generatedDeck, colorIdentity, customization.deckFormat]);

  // Only show owned indicators if not every card in the deck is owned
  const showOwnedIndicators = useMemo(() => {
    if (!collectionNames || !generatedDeck) return false;
    const allCards = Object.values(generatedDeck.categories).flat();
    const allOwned = allCards.every(c => {
      const name = c.name.includes(' // ') ? c.name.split(' // ')[0] : c.name;
      return collectionNames.has(name);
    });
    return !allOwned;
  }, [collectionNames, generatedDeck]);

  // Track dirty state: snapshot mustIncludeCards + appliedIncludeLists at generation time
  const [snapshotMustInclude, setSnapshotMustInclude] = useState<string[]>([]);
  const [snapshotAppliedLists, setSnapshotAppliedLists] = useState('[]');
  const [pendingRegenerate, setPendingRegenerate] = useState(false);
  useEffect(() => {
    if (generatedDeck) {
      setSnapshotMustInclude([...customization.mustIncludeCards]);
      setSnapshotAppliedLists(JSON.stringify(customization.appliedIncludeLists || []));
      if (pendingRegenerate) {
        setPendingRegenerate(false);
        setToastMessage({ text: 'Deck regenerated!' });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedDeck]);

  const isDirty = useMemo(() => {
    const current = customization.mustIncludeCards;
    if (current.length !== snapshotMustInclude.length) return true;
    const snap = new Set(snapshotMustInclude);
    if (current.some(n => !snap.has(n))) return true;
    // Check if applied include lists changed (toggled on/off or added/removed)
    if (JSON.stringify(customization.appliedIncludeLists || []) !== snapshotAppliedLists) return true;
    // Temp lists with entries mean we have pending changes
    if ((customization.tempMustIncludeCards?.length ?? 0) > 0) return true;
    if ((customization.tempBannedCards?.length ?? 0) > 0) return true;
    return false;
  }, [customization.mustIncludeCards, snapshotMustInclude, customization.appliedIncludeLists, snapshotAppliedLists, customization.tempMustIncludeCards, customization.tempBannedCards]);

  // Auto-dismiss toasts
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    if (!showSavedToast) return;
    const timer = setTimeout(() => setShowSavedToast(false), 6000);
    return () => clearTimeout(timer);
  }, [showSavedToast]);

  // Clear state when a completely different deck is loaded (not incremental updates)
  const deckIdentity = generatedDeck?.commander?.name ?? null;
  const prevDeckRef = useRef(generatedDeck);
  const prevDeckIdentityRef = useRef(deckIdentity);
  // Tracks cards being replaced via "Replace" toolbar action so we can push history after regen
  const pendingReplaceRef = useRef<string[] | null>(null);
  useEffect(() => {
    const commanderChanged = prevDeckIdentityRef.current !== deckIdentity;
    const deckRegenerated = prevDeckRef.current !== generatedDeck;
    const prevDeck = prevDeckRef.current;
    prevDeckIdentityRef.current = deckIdentity;
    prevDeckRef.current = generatedDeck;
    if (commanderChanged) {
      setIsEditMode(false);
      setSelectedCards(new Set());
    }
    if (commanderChanged || deckRegenerated) {
      setRemovedCards(new Set());
    }
    // Push history entries for replace-triggered regens
    if (deckRegenerated && !commanderChanged && pendingReplaceRef.current && prevDeck && generatedDeck) {
      const replaced = pendingReplaceRef.current;
      pendingReplaceRef.current = null;
      const oldNames = new Set(Object.values(prevDeck.categories).flat().map(c => c.name));
      const newNames = new Set(Object.values(generatedDeck.categories).flat().map(c => c.name));
      for (const name of replaced) {
        pushDeckHistory({ action: 'remove', cardName: name });
      }
      for (const name of newNames) {
        if (!oldNames.has(name)) {
          pushDeckHistory({ action: 'add', cardName: name });
        }
      }
    }
  }, [deckIdentity, generatedDeck, pushDeckHistory]);

  const handleToggleRoles = useCallback(() => {
    setShowRoles(prev => {
      const next = !prev;
      localStorage.setItem('deckRolesOpen', String(next));
      return next;
    });
  }, []);

  const handleExitEditMode = useCallback(() => {
    setIsEditMode(false);
    setSelectedCards(new Set());
    lastSelectedIdRef.current = null;
    setEditDrawerTab('actions');
  }, []);

  const handleToggleCardSelection = useCallback((card: ScryfallCard, shiftKey?: boolean) => {
    const lastId = lastSelectedIdRef.current;
    lastSelectedIdRef.current = card.id;

    setSelectedCards(prev => {
      const next = new Set(prev);

      if (shiftKey && lastId && lastId !== card.id) {
        // Shift-select: select or deselect range between last and current
        const order = flatCardOrderRef.current;
        const startIdx = order.indexOf(lastId);
        const endIdx = order.indexOf(card.id);
        if (startIdx !== -1 && endIdx !== -1) {
          const from = Math.min(startIdx, endIdx);
          const to = Math.max(startIdx, endIdx);
          const shouldDeselect = prev.has(card.id);
          for (let i = from; i <= to; i++) {
            if (shouldDeselect) {
              next.delete(order[i]);
            } else {
              next.add(order[i]);
            }
          }
        } else {
          next.add(card.id);
        }
      } else {
        if (next.has(card.id)) {
          next.delete(card.id);
        } else {
          next.add(card.id);
        }
      }

      return next;
    });
  }, []);

  const handleToggleCategory = useCallback((cardIds: string[]) => {
    setSelectedCards(prev => {
      const next = new Set(prev);
      const allSelected = cardIds.every(id => next.has(id));
      if (allSelected) {
        for (const id of cardIds) next.delete(id);
      } else {
        for (const id of cardIds) next.add(id);
      }
      return next;
    });
  }, []);

  const handleRegenerate = useCallback(() => {
    if (onRegenerate) {
      setPendingRegenerate(true);
      onRegenerate();
    }
  }, [onRegenerate]);

  const handleStatsFilterChange = useCallback((newFilter: StatsFilter) => {
    setStatsFilter(prev => {
      if (prev && newFilter &&
          prev.type === newFilter.type &&
          prev.value === newFilter.value) {
        return null;
      }
      return newFilter;
    });
  }, []);

  // Group cards by type and count duplicates
  const groupedCards = useMemo((): GroupedCards => {
    const emptyGroups: GroupedCards = {
      Commander: [],
      Creature: [],
      Planeswalker: [],
      Battle: [],
      Instant: [],
      Sorcery: [],
      Artifact: [],
      Enchantment: [],
      Land: [],
    };

    if (!generatedDeck) return emptyGroups;

    const allCards = Object.values(generatedDeck.categories).flat();
    const groups: Record<CardType, Map<string, { card: ScryfallCard; quantity: number }>> = {
      Commander: new Map(),
      Creature: new Map(),
      Planeswalker: new Map(),
      Battle: new Map(),
      Instant: new Map(),
      Sorcery: new Map(),
      Artifact: new Map(),
      Enchantment: new Map(),
      Land: new Map(),
    };

    // Add commander(s) only for formats that have a commander
    if (formatConfig.hasCommander) {
      if (commander) {
        groups.Commander.set(commander.name, { card: commander, quantity: 1 });
      }
      if (generatedDeck.partnerCommander) {
        groups.Commander.set(generatedDeck.partnerCommander.name, { card: generatedDeck.partnerCommander, quantity: 1 });
      }
    }

    // Group other cards
    allCards.forEach((card) => {
      const type = getCardType(card);
      const existing = groups[type].get(card.name);
      if (existing) {
        existing.quantity++;
      } else {
        groups[type].set(card.name, { card, quantity: 1 });
      }
    });

    // Convert to sorted arrays
    const result: GroupedCards = { ...emptyGroups };

    TYPE_ORDER.forEach((type) => {
      const cards = Array.from(groups[type].values());

      // Sort
      cards.sort((a, b) => {
        if (sortBy === 'name') return a.card.name.localeCompare(b.card.name);
        if (sortBy === 'cmc') return (a.card.cmc - b.card.cmc) || a.card.name.localeCompare(b.card.name);
        if (sortBy === 'price') {
          const priceA = parseFloat(getCardPrice(a.card, customization.currency) || '0');
          const priceB = parseFloat(getCardPrice(b.card, customization.currency) || '0');
          return priceB - priceA;
        }
        if (sortBy === 'score') {
          const inclMap = generatedDeck?.cardInclusionMap;
          const getIncl = (name: string) => {
            if (!inclMap) return 0;
            return inclMap[name] ?? (name.includes(' // ') ? inclMap[name.split(' // ')[0]] : 0) ?? 0;
          };
          return getIncl(b.card.name) - getIncl(a.card.name) || a.card.name.localeCompare(b.card.name);
        }
        if (sortBy === 'relevancy') {
          const relMap = generatedDeck?.cardRelevancyMap;
          const getRel = (name: string) => {
            if (!relMap) return 0;
            return relMap[name] ?? (name.includes(' // ') ? relMap[name.split(' // ')[0]] : 0) ?? 0;
          };
          return getRel(b.card.name) - getRel(a.card.name) || a.card.name.localeCompare(b.card.name);
        }
        return 0;
      });

      result[type] = cards;
    });

    return result;
  }, [generatedDeck, commander, sortBy, formatConfig.hasCommander]);

  // Count MDFC lands (spell // land cards categorized under their spell type, not Land)
  const mdfcLandCount = useMemo(() => {
    if (!generatedDeck) return 0;
    let count = 0;
    for (const type of TYPE_ORDER) {
      if (type === 'Land' || type === 'Commander') continue;
      for (const { card } of groupedCards[type] || []) {
        if (isMdfcLand(card)) count++;
      }
    }
    return count;
  }, [groupedCards, generatedDeck]);

  // Flat ordered list of non-commander card IDs for shift-select
  flatCardOrderRef.current = useMemo(() => {
    const ids: string[] = [];
    for (const type of TYPE_ORDER) {
      if (type === 'Commander') continue;
      for (const { card } of groupedCards[type] || []) {
        ids.push(card.id);
      }
    }
    return ids;
  }, [groupedCards]);

  // Flat ordered list of all cards (including commanders) for preview navigation
  const flatCardList = useMemo(() => {
    const cards: ScryfallCard[] = [];
    for (const type of TYPE_ORDER) {
      for (const { card } of groupedCards[type] || []) {
        cards.push(card);
      }
    }
    return cards;
  }, [groupedCards]);

  const handleHistoryPreview = useCallback(async (name: string) => {
    const found = flatCardList.find(c => c.name === name);
    if (found) { setPreviewCard(found); return; }
    try {
      const card = await getCardByName(name);
      if (card) setPreviewCard(card);
    } catch { /* silently fail */ }
  }, [flatCardList]);

  const deckCardNames = useMemo(() => new Set(flatCardList.map(c => c.name)), [flatCardList]);

  const resolveCardByName = useCallback(async (name: string): Promise<ScryfallCard | undefined> => {
    const found = flatCardList.find(c => c.name === name);
    if (found) return found;
    try { return await getCardByName(name) ?? undefined; } catch { return undefined; }
  }, [flatCardList]);

  const handlePreviewNavigate = useCallback((direction: 'prev' | 'next') => {
    if (!previewCard || flatCardList.length === 0) return;
    const idx = flatCardList.findIndex(c => c.id === previewCard.id);
    if (idx === -1) return;
    const nextIdx = direction === 'next' ? idx + 1 : idx - 1;
    if (nextIdx >= 0 && nextIdx < flatCardList.length) {
      setPreviewCard(flatCardList[nextIdx]);
    }
  }, [previewCard, flatCardList]);

  const previewCardIndex = useMemo(() => {
    if (!previewCard || flatCardList.length === 0) return -1;
    return flatCardList.findIndex(c => c.id === previewCard.id);
  }, [previewCard, flatCardList]);

  const previewCanNavigate = useMemo(() => {
    return { prev: previewCardIndex > 0, next: previewCardIndex >= 0 && previewCardIndex < flatCardList.length - 1 };
  }, [previewCardIndex, flatCardList.length]);

  const prevCardImage = useMemo(() => {
    if (previewCardIndex <= 0) return null;
    return getCardImageUrl(flatCardList[previewCardIndex - 1], 'small');
  }, [previewCardIndex, flatCardList]);

  const nextCardImage = useMemo(() => {
    if (previewCardIndex < 0 || previewCardIndex >= flatCardList.length - 1) return null;
    return getCardImageUrl(flatCardList[previewCardIndex + 1], 'small');
  }, [previewCardIndex, flatCardList]);

  const handleReplaceSelected = useCallback(() => {
    const allCards = Object.values(groupedCards).flat();
    const namesToBan: string[] = [];
    const idsToMark = new Set<string>();

    for (const { card } of allCards) {
      if (selectedCards.has(card.id)) {
        namesToBan.push(card.name);
        idsToMark.add(card.id);
      }
    }

    if (namesToBan.length === 0) return;

    const currentBanned = tempBannedRef.current;
    const newBanned = [...currentBanned];
    for (const name of namesToBan) {
      if (!newBanned.includes(name)) {
        newBanned.push(name);
      }
    }
    // Also remove any of these cards from both must-include lists
    const banSet = new Set(namesToBan);
    const currentTempIncludes = customization.tempMustIncludeCards ?? [];
    const filteredTempIncludes = currentTempIncludes.filter(n => !banSet.has(n));
    const currentMustIncludes = customization.mustIncludeCards;
    const filteredMustIncludes = currentMustIncludes.filter(n => !banSet.has(n));
    updateCustomization({
      tempBannedCards: newBanned,
      ...(filteredTempIncludes.length !== currentTempIncludes.length ? { tempMustIncludeCards: filteredTempIncludes } : {}),
      ...(filteredMustIncludes.length !== currentMustIncludes.length ? { mustIncludeCards: filteredMustIncludes } : {}),
    });
    trackEvent('cards_removed', { commanderName: commander?.name ?? 'unknown', cardCount: namesToBan.length });

    setRemovedCards(prev => {
      const next = new Set(prev);
      for (const id of idsToMark) {
        next.add(id);
      }
      return next;
    });

    setToastMessage({ text: `Replacing ${namesToBan.length} card${namesToBan.length > 1 ? 's' : ''}...` });
    setSelectedCards(new Set());
    pendingReplaceRef.current = namesToBan;
    // Trigger regeneration immediately
    handleRegenerate();
  }, [selectedCards, groupedCards, updateCustomization, handleRegenerate]);

  const handleBanSelected = useCallback(() => {
    const allCards = Object.values(groupedCards).flat();
    const namesToBan: string[] = [];
    const idsToMark = new Set<string>();

    for (const { card } of allCards) {
      if (selectedCards.has(card.id)) {
        namesToBan.push(card.name);
        idsToMark.add(card.id);
      }
    }

    if (namesToBan.length === 0) return;

    // Add to persistent ban list (not temp)
    const currentBanned = [...customization.bannedCards];
    for (const name of namesToBan) {
      if (!currentBanned.includes(name)) {
        currentBanned.push(name);
      }
    }
    // Also remove from must-include lists
    const banSet = new Set(namesToBan);
    const currentTempIncludes = customization.tempMustIncludeCards ?? [];
    const filteredTempIncludes = currentTempIncludes.filter(n => !banSet.has(n));
    const currentMustIncludes = customization.mustIncludeCards;
    const filteredMustIncludes = currentMustIncludes.filter(n => !banSet.has(n));
    updateCustomization({
      bannedCards: currentBanned,
      ...(filteredTempIncludes.length !== currentTempIncludes.length ? { tempMustIncludeCards: filteredTempIncludes } : {}),
      ...(filteredMustIncludes.length !== currentMustIncludes.length ? { mustIncludeCards: filteredMustIncludes } : {}),
    });
    trackEvent('cards_removed', { commanderName: commander?.name ?? 'unknown', cardCount: namesToBan.length });

    setRemovedCards(prev => {
      const next = new Set(prev);
      for (const id of idsToMark) next.add(id);
      return next;
    });

    setToastMessage({ text: `Banned ${namesToBan.length} card${namesToBan.length > 1 ? 's' : ''} — regenerating...` });
    setSelectedCards(new Set());
    handleRegenerate();
  }, [selectedCards, groupedCards, customization, updateCustomization, handleRegenerate, commander]);

  const getSelectedCardNames = useCallback((): string[] => {
    const allCards = Object.values(groupedCards).flat();
    const names: string[] = [];
    for (const { card } of allCards) {
      if (selectedCards.has(card.id) && !names.includes(card.name)) {
        names.push(card.name);
      }
    }
    return names;
  }, [selectedCards, groupedCards]);

  const allSelectedAreMustInclude = useMemo(() => {
    if (selectedCards.size === 0) return false;
    const miSet = new Set(customization.mustIncludeCards);
    const allCards = Object.values(groupedCards).flat();
    return allCards
      .filter(({ card }) => selectedCards.has(card.id))
      .every(({ card }) => miSet.has(card.name));
  }, [selectedCards, groupedCards, customization.mustIncludeCards]);

  const handleToggleMustInclude = useCallback(() => {
    const names = getSelectedCardNames();
    if (names.length === 0) return;
    const current = customization.mustIncludeCards;
    const currentSet = new Set(current);
    const allIncluded = names.every(n => currentSet.has(n));
    if (allIncluded) {
      // Remove from must-include
      const nameSet = new Set(names);
      updateCustomization({ mustIncludeCards: current.filter(n => !nameSet.has(n)) });
      setToastMessage({ text: `Unpinned ${names.length} card${names.length > 1 ? 's' : ''}` });
    } else {
      // Add to must-include, and remove from ban lists if present
      const newMI = [...current];
      for (const name of names) {
        if (!currentSet.has(name)) newMI.push(name);
      }
      const nameSet = new Set(names);
      const currentBanned = customization.bannedCards.filter(n => !nameSet.has(n));
      const currentTempBanned = (customization.tempBannedCards ?? []).filter(n => !nameSet.has(n));
      updateCustomization({
        mustIncludeCards: newMI,
        ...(currentBanned.length !== customization.bannedCards.length ? { bannedCards: currentBanned } : {}),
        ...(currentTempBanned.length !== (customization.tempBannedCards ?? []).length ? { tempBannedCards: currentTempBanned } : {}),
      });
      setToastMessage({ text: `Pinned ${names.length} card${names.length > 1 ? 's' : ''} as must-include` });
    }
    setSelectedCards(new Set());
  }, [getSelectedCardNames, customization, updateCustomization]);

  const handleRemoveFromList = useCallback(() => {
    if (!onRemoveCards) return;
    const names = getSelectedCardNames();
    if (names.length === 0) return;
    onRemoveCards(names);
    for (const name of names) pushDeckHistory({ action: 'remove', cardName: name });
    setSelectedCards(new Set());
  }, [onRemoveCards, getSelectedCardNames, pushDeckHistory]);

  const handleMoveToSideboard = useCallback(() => {
    if (!onMoveToSideboard) return;
    const names = getSelectedCardNames();
    if (names.length === 0) return;
    onMoveToSideboard(names);
    for (const name of names) pushDeckHistory({ action: 'sideboard', cardName: name });
    setSelectedCards(new Set());
    setShowAddToDropdown(false);
  }, [onMoveToSideboard, getSelectedCardNames, pushDeckHistory]);

  const handleMoveToMaybeboard = useCallback(() => {
    if (!onMoveToMaybeboard) return;
    const names = getSelectedCardNames();
    if (names.length === 0) return;
    onMoveToMaybeboard(names);
    for (const name of names) pushDeckHistory({ action: 'maybeboard', cardName: name });
    setSelectedCards(new Set());
    setShowAddToDropdown(false);
  }, [onMoveToMaybeboard, getSelectedCardNames, pushDeckHistory]);

  const handleAddToExistingList = useCallback((listId: string) => {
    const names = getSelectedCardNames();
    if (names.length === 0) return;
    const list = userLists.find(l => l.id === listId);
    if (!list) return;
    const existing = new Set(list.cards);
    const newCards = [...list.cards, ...names.filter(n => !existing.has(n))];
    updateList(listId, { cards: newCards });
    const prevCards = [...list.cards];
    setToastMessage({
      text: `Added ${names.length} card${names.length !== 1 ? 's' : ''} to "${list.name}"`,
      onUndo: () => { updateList(listId, { cards: prevCards }); setToastMessage(null); },
    });
    setShowAddToDropdown(false);
    setListSearchQuery('');
  }, [getSelectedCardNames, userLists, updateList]);

  const handleAddToNewList = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const names = getSelectedCardNames();
    if (names.length === 0) return;
    const newList = createList(trimmed, names);
    setToastMessage({
      text: `Created "${trimmed}" with ${names.length} card${names.length !== 1 ? 's' : ''}`,
      onUndo: () => { deleteList(newList.id); setToastMessage(null); },
    });
    setShowAddToDropdown(false);
    setShowNewListInput(false);
    setNewListName('');
    setListSearchQuery('');
  }, [getSelectedCardNames, createList, deleteList]);

  // Single-card context menu handler
  const handleCardAction = useCallback((card: ScryfallCard, action: CardAction) => {
    const name = card.name;
    switch (action.type) {
      case 'remove':
        onRemoveCards?.([name]);
        pushDeckHistory({ action: 'remove', cardName: name });
        break;
      case 'sideboard':
        onMoveToSideboard?.([name]);
        pushDeckHistory({ action: 'sideboard', cardName: name });
        break;
      case 'maybeboard':
        onMoveToMaybeboard?.([name]);
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
      case 'addToDeck':
        onAddCards?.([name], 'deck');
        pushDeckHistory({ action: 'add', cardName: name });
        break;
      case 'addToList': {
        const list = userLists.find(l => l.id === action.listId);
        if (list && !list.cards.includes(name)) {
          const prevCards = [...list.cards];
          updateList(action.listId, { cards: [...list.cards, name] });
          setToastMessage({
            text: `Added "${name}" to "${list.name}"`,
            onUndo: () => { updateList(action.listId, { cards: prevCards }); setToastMessage(null); },
          });
        }
        break;
      }
      case 'createListAndAdd': {
        const newList = createList(action.listName, [name]);
        setToastMessage({
          text: `Created "${action.listName}" with "${name}"`,
          onUndo: () => { deleteList(newList.id); setToastMessage(null); },
        });
        break;
      }
    }
  }, [onRemoveCards, onAddCards, onMoveToSideboard, onMoveToMaybeboard, customization, updateCustomization, userLists, updateList, createList, deleteList, pushDeckHistory]);

  const cardMenuProps: Omit<CardContextMenuProps, 'card' | 'onAction'> = useMemo(() => ({
    hasRemove: !!onRemoveCards,
    hasSideboard: !!onMoveToSideboard,
    hasMaybeboard: !!onMoveToMaybeboard,
    userLists,
  }), [onRemoveCards, onMoveToSideboard, onMoveToMaybeboard, userLists]);

  // Close add-to dropdown on outside click
  useEffect(() => {
    if (!showAddToDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (addToDropdownRef.current && !addToDropdownRef.current.contains(e.target as Node)) {
        setShowAddToDropdown(false);
        setShowNewListInput(false);
        setNewListName('');
        setListSearchQuery('');
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [showAddToDropdown]);

  // Escape key to exit edit mode
  useEffect(() => {
    if (!isEditMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showAddToDropdown) setShowAddToDropdown(false);
        else handleExitEditMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditMode, handleExitEditMode, showAddToDropdown]);

  // Build map of card name -> complete combos that include it
  const cardComboMap = useMemo(() => {
    const map = new Map<string, DetectedCombo[]>();
    const combos = generatedDeck?.detectedCombos;
    if (!combos) return map;

    for (const combo of combos) {
      if (!combo.isComplete) continue;
      for (const cardName of combo.cards) {
        const existing = map.get(cardName);
        if (existing) {
          existing.push(combo);
        } else {
          map.set(cardName, [combo]);
        }
      }
    }
    return map;
  }, [generatedDeck?.detectedCombos]);

  // Build map of card name -> card type for combo popover icons
  const cardTypeMap = useMemo(() => {
    const map = new Map<string, CardType>();
    for (const type of TYPE_ORDER) {
      for (const { card } of groupedCards[type] || []) {
        const normalizedName = card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name;
        map.set(normalizedName, type);
      }
    }
    return map;
  }, [groupedCards]);

  // Build set of card IDs matching the active stats filter
  const matchingCardIds = useMemo(() => {
    if (!statsFilter) return null;
    const allGrouped = Object.values(groupedCards).flat();
    const ids = new Set<string>();
    for (const { card } of allGrouped) {
      if (cardMatchesFilter(card, statsFilter)) {
        ids.add(card.id);
      }
    }
    return ids;
  }, [statsFilter, groupedCards]);

  // Build set of card IDs matching the search query (name or oracle text)
  const searchMatchingIds = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return null;
    const allGrouped = Object.values(groupedCards).flat();
    const ids = new Set<string>();
    for (const { card } of allGrouped) {
      const name = card.name?.toLowerCase() || '';
      const oracleText = card.oracle_text?.toLowerCase() || '';
      const faceTexts = card.card_faces?.map(f => `${f.name?.toLowerCase() || ''} ${f.oracle_text?.toLowerCase() || ''}`).join(' ') || '';
      if (name.includes(query) || oracleText.includes(query) || faceTexts.includes(query)) {
        ids.add(card.id);
      }
    }
    return ids;
  }, [searchQuery, groupedCards]);

  // Combine stats filter and search filter into a single set of matching IDs
  const combinedMatchingIds = useMemo(() => {
    if (!matchingCardIds && !searchMatchingIds) return null;
    if (!matchingCardIds) return searchMatchingIds;
    if (!searchMatchingIds) return matchingCardIds;
    // Intersection: card must match both filters
    const ids = new Set<string>();
    for (const id of matchingCardIds) {
      if (searchMatchingIds.has(id)) ids.add(id);
    }
    return ids;
  }, [matchingCardIds, searchMatchingIds]);

  // Swap candidates for the previewed card (role-based or type-based)
  const previewSwapCandidates = useMemo(() => {
    if (!previewCard || !generatedDeck?.swapCandidates) return undefined;
    if (previewCard.isMustInclude) return undefined;
    return getSwapCandidatesForCard(generatedDeck, previewCard);
  }, [previewCard, generatedDeck]);

  const handleHover = (card: ScryfallCard | null, e?: React.MouseEvent, showBack?: boolean) => {
    if (card && e) {
      const rect = e.currentTarget.getBoundingClientRect();
      setHoverCard({ card, rowRect: { right: rect.right, top: rect.top, height: rect.height }, showBack });
    } else {
      setHoverCard(null);
    }
  };

  const generateDeckList = useCallback((excludeMustIncludes: boolean = false) => {
    const lines: string[] = [];

    TYPE_ORDER.forEach((type) => {
      const cards = groupedCards[type];
      if (cards && cards.length > 0) {
        cards.forEach(({ card, quantity }) => {
          if (excludeMustIncludes && card.isMustInclude) return;
          lines.push(`${quantity} ${card.name}`);
        });
      }
    });

    return lines.join('\n');
  }, [groupedCards]);

  const mustIncludeNames = useMemo(() => {
    const set = new Set(customization.mustIncludeCards);
    for (const n of customization.tempMustIncludeCards ?? []) set.add(n);
    return set;
  }, [customization.mustIncludeCards, customization.tempMustIncludeCards]);

  const bannedNames = useMemo(() => {
    const set = new Set(customization.bannedCards);
    for (const n of customization.tempBannedCards ?? []) set.add(n);
    return set;
  }, [customization.bannedCards, customization.tempBannedCards]);

  if (!generatedDeck) return null;

  const { usedThemes, dataSource } = generatedDeck;
  const allGroupedCards = Object.values(groupedCards).flat();
  const totalCards = allGroupedCards.reduce((sum, c) => sum + c.quantity, 0);
  const totalPrice = allGroupedCards.reduce((sum, c) => {
    const price = parseFloat(getCardPrice(c.card, customization.currency) || '0');
    return sum + (isNaN(price) ? 0 : price * c.quantity);
  }, 0);
  const nonOwnedPrice = (customization.ignoreOwnedBudget && collectionNames) ? allGroupedCards.reduce((sum, c) => {
    const name = c.card.name.includes(' // ') ? c.card.name.split(' // ')[0] : c.card.name;
    if (collectionNames.has(name)) return sum;
    const price = parseFloat(getCardPrice(c.card, customization.currency) || '0');
    return sum + (isNaN(price) ? 0 : price * c.quantity);
  }, 0) : null;
  const sym = customization.currency === 'EUR' ? '€' : '$';

  const budgetActive = customization.maxCardPrice !== null ||
    customization.deckBudget !== null ||
    customization.budgetOption !== 'any';
  const avgCardPrice = budgetActive && totalCards > 0 ? totalPrice / totalCards : null;

  // Determine if we fell back from what the user asked for
  const hadThemes = usedThemes && usedThemes.length > 0;
  const hadBracket = customization.bracketLevel !== 'all';
  const hadBudget = customization.budgetOption !== 'any';
  const fallbackMessage = (() => {
    if (!dataSource) return null;
    // Best-case: got exactly what was requested
    if (hadThemes && hadBracket && dataSource === 'theme+bracket') return null;
    if (hadThemes && !hadBracket && dataSource === 'theme') return null;
    if (!hadThemes && hadBracket && dataSource === 'base+bracket') return null;
    if (!hadThemes && !hadBracket && dataSource === 'base') return null;

    const requested: string[] = [];
    if (hadThemes) requested.push(usedThemes!.join(' + '));
    if (hadBracket) requested.push(`bracket ${customization.bracketLevel}`);
    if (hadBudget) requested.push(customization.budgetOption);

    const got: Record<typeof dataSource, string> = {
      'theme+bracket': 'theme + bracket data',
      'theme': 'theme data (without bracket filtering)',
      'base+bracket': 'general commander data with bracket filtering',
      'base': 'general commander data',
      'scryfall': 'Scryfall card search (no EDHREC data)',
    };

    if (requested.length === 0) return null; // nothing was requested, nothing to fall back from
    return `EDHREC didn't have data for the combination of ${requested.join(', ')}. Used ${got[dataSource]} instead.`;
  })();

  const deckSummary = (
    <>
      {renderHeaderActions && renderHeaderActions({ onExport: () => setShowExportModal(true) })}
      <div className="flex items-center justify-end gap-2 sm:gap-4 xl:gap-3 flex-wrap">
        <div className="text-sm text-muted-foreground xl:hidden">
          {/* When renderHeaderActions is set (BuilderPage), the outer header already shows card count, themes, and settings — only show price here */}
          {renderHeaderActions ? (
            <>
              {showPrice && (
                <span>{sym}{totalPrice.toFixed(2)}
                  {nonOwnedPrice !== null && nonOwnedPrice < totalPrice && (
                    <span className="ml-1 text-xs opacity-70">({sym}{nonOwnedPrice.toFixed(2)} new)</span>
                  )}
                </span>
              )}
            </>
          ) : (
            <>
              {totalCards} cards{showPrice ? ` · ${sym}${totalPrice.toFixed(2)}` : ''}
              {showPrice && nonOwnedPrice !== null && nonOwnedPrice < totalPrice && (
                <span className="ml-1 text-xs opacity-70">({sym}{nonOwnedPrice.toFixed(2)} new)</span>
              )}
              {boardCounts && (boardCounts.sideboard > 0 || boardCounts.maybeboard > 0) && (
                <span className="text-xs">
                  {' · '}
                  {[
                    boardCounts.sideboard > 0 ? `${boardCounts.sideboard} sideboard` : null,
                    boardCounts.maybeboard > 0 ? `${boardCounts.maybeboard} maybe` : null,
                  ].filter(Boolean).join(' · ')}
                </span>
              )}
              {(customization.budgetOption !== 'any' || customization.maxCardPrice !== null || customization.deckBudget !== null) && (
                <span className="ml-1 text-xs">
                  ({[
                    customization.budgetOption === 'budget' ? 'Budget' : customization.budgetOption === 'expensive' ? 'Expensive' : null,
                    customization.maxCardPrice !== null ? `<${sym}${customization.maxCardPrice}/card` : null,
                    customization.deckBudget !== null ? `${totalPrice > customization.deckBudget ? '~' : ''}${sym}${customization.deckBudget} budget, excludes commander` : null,
                  ].filter(Boolean).join(' · ')})
                </span>
              )}
              {usedThemes && usedThemes.length > 0 && (
                <span className="ml-2">
                  · Built with: <span className="font-medium">{usedThemes.join(', ')}</span>
                </span>
              )}
            </>
          )}
        </div>
        {(isDirty || removedCards.size > 0 || pendingRegenerate) && onRegenerate && !hideRegenerate && (
          <Button onClick={handleRegenerate} variant="outline" className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300" disabled={pendingRegenerate}>
            <RefreshCw className={`w-4 h-4 mr-2 ${pendingRegenerate ? 'animate-spin' : ''}`} />
            {pendingRegenerate ? 'Regenerating...' : 'Regenerate'}
          </Button>
        )}
        <div className="flex flex-col items-end gap-1">
          {generatedDeck.builtFromCollection && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
              <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              {customization.collectionStrategy === 'partial'
                ? `Collection (${customization.collectionOwnedPercent}% owned)`
                : 'From My Collection'}
            </span>
          )}
          {!renderHeaderActions && (
            <Button onClick={() => setShowExportModal(true)} className="btn-shimmer">
              <Copy className="w-4 h-4 mr-2" />
              Export
            </Button>
          )}
        </div>
      </div>
    </>
  );

  return (
    <>
      <div className="animate-slide-up">
        {/* Header + Mobile Stats combined card */}
        <div className="bg-card/50 rounded-lg border border-border/50 mb-4 xl:hidden">
        <div className="flex items-center justify-between p-3 flex-wrap gap-3">
          <div className="hidden flex-1 items-center gap-2 sm:gap-3 flex-wrap">
            {/* Sort */}
            <div className="flex items-center gap-2 bg-card/50 rounded-lg px-3 py-1.5 border border-border/50">
              <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">SORT:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'name' | 'cmc' | 'price' | 'score' | 'relevancy')}
                className="bg-transparent text-xs text-primary font-medium focus:outline-none cursor-pointer"
              >
                <option value="name">NAME</option>
                <option value="cmc">CMC</option>
                <option value="price">PRICE</option>
                {showInclusion && generatedDeck?.cardInclusionMap && <option value="score">INCLUSION</option>}
                {showRelevancy && generatedDeck?.cardRelevancyMap && <option value="relevancy">RELEVANCY</option>}
              </select>
            </div>

            {/* Show Toggles */}
            <div className="relative" ref={showMenuRef}>
              <button
                onClick={() => setShowMenu(v => !v)}
                className={`flex items-center gap-1.5 bg-card/50 rounded-lg px-3 py-1.5 border border-border/50 text-xs transition-colors ${showMenu ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Eye className="w-4 h-4" />
                <span className="hidden sm:inline">Show</span>
              </button>
              {showMenu && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg p-2 space-y-1 min-w-[160px]">
                  {[
                    { key: 'price', label: 'Price', value: showPrice, toggle: () => setShowPrice(v => { const next = !v; localStorage.setItem('mtg-deck-show-price', String(next)); return next; }) },
                    { key: 'inclusion', label: 'Inclusion %', value: showInclusion, toggle: () => setShowInclusion(v => { const next = !v; localStorage.setItem('mtg-deck-show-inclusion', String(next)); if (!next && sortBy === 'score') setSortBy('name'); return next; }), hide: !generatedDeck?.cardInclusionMap, infoText: "Each card's percentage shows how many EDHREC decks with this commander include that card. Higher % = more popular, proven pick." },
                    { key: 'relevancy', label: 'Relevancy', value: showRelevancy, toggle: () => setShowRelevancy(v => { const next = !v; localStorage.setItem('mtg-deck-show-relevancy', String(next)); if (!next && sortBy === 'relevancy') setSortBy('name'); return next; }), hide: !generatedDeck?.cardRelevancyMap, infoText: 'Composite score combining EDHREC synergy, inclusion %, role fit, curve fit, and type balance. Higher = stronger fit for this deck.' },
                    { key: 'roles', label: 'Roles', value: showRoles, toggle: () => { setShowRoles(v => { const next = !v; localStorage.setItem('deckRolesOpen', String(next)); return next; }); }, hide: !generatedDeck?.roleTargets },
                  ].filter(o => !o.hide).map(opt => (
                    <div key={opt.key} className="relative flex items-center">
                      <button
                        onClick={opt.toggle}
                        className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${opt.value ? 'text-foreground bg-accent/50' : 'text-muted-foreground hover:bg-accent/30'}`}
                      >
                        <span className={`w-3 h-3 rounded-sm border flex items-center justify-center shrink-0 ${opt.value ? 'bg-primary border-primary' : 'border-border'}`}>
                          {opt.value && <Check className="w-2 h-2 text-primary-foreground" />}
                        </span>
                        {opt.label}
                      </button>
                      {'infoText' in opt && opt.infoText && (
                        <InfoTooltip text={opt.infoText}>
                          <Info className="w-3 h-3" />
                        </InfoTooltip>
                      )}
                    </div>
                  ))}
                  {/* Icons parent toggle + sub-items */}
                  <div className="pt-1 mt-1">
                    <div className="relative flex items-center">
                      <button
                        onClick={() => setShowIcons(v => { const next = !v; localStorage.setItem('mtg-deck-show-icons', String(next)); return next; })}
                        className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${showIcons ? 'text-foreground bg-accent/50' : 'text-muted-foreground hover:bg-accent/30'}`}
                      >
                        <span className={`w-3 h-3 rounded-sm border flex items-center justify-center shrink-0 ${showIcons ? 'bg-primary border-primary' : 'border-border'}`}>
                          {showIcons && <Check className="w-2 h-2 text-primary-foreground" />}
                        </span>
                        Icons
                      </button>
                    </div>
                    {showIcons && [
                      ...(!showOwnedIndicators ? [] : [{ key: 'collection', label: 'In Collection', value: showCollectionChecks, toggle: () => setShowCollectionChecks(v => { const next = !v; localStorage.setItem('mtg-deck-builder-show-collection-checks', String(next)); return next; }) }]),
                      { key: 'pinban', label: 'Pin / Ban', value: showPinBan, toggle: () => setShowPinBan(v => { const next = !v; localStorage.setItem('mtg-deck-show-pin-ban', String(next)); return next; }) },
                    ].map(opt => (
                      <div key={opt.key} className="relative flex items-center">
                        <button
                          onClick={opt.toggle}
                          className={`flex-1 flex items-center gap-2 px-2 pl-4 py-1.5 rounded text-xs transition-colors ${opt.value ? 'text-foreground bg-accent/50' : 'text-muted-foreground hover:bg-accent/30'}`}
                        >
                          <span className={`w-3 h-3 rounded-sm border flex items-center justify-center shrink-0 ${opt.value ? 'bg-primary border-primary' : 'border-border'}`}>
                            {opt.value && <Check className="w-2 h-2 text-primary-foreground" />}
                          </span>
                          {opt.label}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Search */}
            <div className="relative flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search cards..."
                  className="bg-card/50 border border-border/50 rounded-lg pl-8 pr-8 py-1.5 text-xs w-32 sm:w-48 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {searchMatchingIds && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {searchMatchingIds.size} match{searchMatchingIds.size !== 1 ? 'es' : ''}
                </span>
              )}
            </div>

            {/* Modify Deck */}
            {!readOnly && !isEditMode && (
              <button
                onClick={() => setIsEditMode(true)}
                className="flex items-center gap-1.5 bg-card/50 rounded-lg px-3 py-1.5 border border-border/50 text-xs text-muted-foreground hover:text-foreground transition-colors"
                title="Modify Deck"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Modify Deck</span>
              </button>
            )}
            {!readOnly && isEditMode && (
              <button onClick={handleExitEditMode} className="px-2 py-1.5 text-xs text-red-400/70 hover:text-red-400 transition-colors whitespace-nowrap">
                Exit Modify
              </button>
            )}

            {/* View Toggle + Text Editor — pushed to flex-end */}
            <div className="ml-auto flex bg-card/50 rounded-lg px-1.5 py-1 border border-border/50 items-center">
              <button
                onClick={() => setShowTextEditor(v => !v)}
                className={`px-1.5 py-1 rounded ${showTextEditor ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                title={showTextEditor ? 'Hide text editor' : 'Show text editor'}
              >
                <FileText className="w-4 h-4" />
              </button>
              <div className="w-px h-4 bg-border/60 mx-1" />
              <button
                onClick={() => setViewMode('grid')}
                className={`px-1.5 py-1 rounded ${viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                title="Grid view"
              >
                <Grid3X3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-1.5 py-1 rounded ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                title="List view"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>

          {deckSummary}
        </div>

        {/* Stats - Mobile/Tablet (inside combined card) */}
        <div className="xl:hidden border-t border-border/30">
          <button
            onClick={() => setMobileStatsOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-card/70"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Statistics</span>
              <span className="text-xs text-muted-foreground/70">{generatedDeck.stats.averageCmc} avg CMC</span>
            </div>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${mobileStatsOpen ? 'rotate-180' : ''}`} />
          </button>
          {mobileStatsOpen && (
            <div className="px-4 pb-3 space-y-4">
              <DeckStats activeFilter={statsFilter} onFilterChange={handleStatsFilterChange} showRoles={showRoles} onToggleRoles={handleToggleRoles} hideHeader collectionNames={collectionNames} showCollection={showOwnedIndicators && showCollectionChecks} showRelevancy={showRelevancy} overallGrade={overallGrade} />
              <DeckHistory onPreviewCard={handleHistoryPreview} resolveCard={resolveCardByName} onCardAction={!readOnly ? handleCardAction : undefined} cardMenuProps={!readOnly ? cardMenuProps : undefined} deckCardNames={deckCardNames} />
            </div>
          )}
        </div>
        </div>{/* end combined card */}

        {regenerateProgress !== undefined && (
          <div className="mb-4">
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${regenerateProgress}%` }}
              />
            </div>
            {regenerateMessage && (
              <p className="text-xs text-muted-foreground mt-1">{regenerateMessage}</p>
            )}
          </div>
        )}

        {fallbackMessage && (
          <div className="flex items-start gap-3 p-3 mb-4 rounded-lg border border-blue-500/30 bg-blue-500/10 text-sm">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-blue-200/90">
              {fallbackMessage}
            </p>
          </div>
        )}

        {generatedDeck.collectionShortfall && generatedDeck.collectionShortfall > 0 && (
          <div className="flex items-start gap-3 p-3 mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-amber-200/90">
              Your collection didn't have enough cards to fill the deck.{' '}
              <span className="font-semibold">{generatedDeck.collectionShortfall} extra basic land{generatedDeck.collectionShortfall > 1 ? 's were' : ' was'}</span>{' '}
              added to reach {totalCards} cards. Check the suggestions below for cards worth picking up!
            </p>
          </div>
        )}

        {generatedDeck.filterShortfall && generatedDeck.filterShortfall > 0 && (
          <div className="flex items-start gap-3 p-3 mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-amber-200/90">
              Your Scryfall filters reduced the available card pool.{' '}
              <span className="font-semibold">{generatedDeck.filterShortfall} extra basic land{generatedDeck.filterShortfall > 1 ? 's were' : ' was'}</span>{' '}
              added to reach {totalCards} cards. Try broadening your filters for more variety.
            </p>
          </div>
        )}

        {/* Main Content — two-column layout */}
        <div className="flex gap-6 items-start">
          {/* Deck Column */}
          <div className="flex-1 min-w-0">

        {/* Toolbar - Mobile/Tablet (below stats, above deck) */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {/* Sort */}
          <div className="flex items-center gap-2 bg-card/50 rounded-lg px-3 py-1.5 border border-border/50">
            <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'name' | 'cmc' | 'price' | 'score' | 'relevancy')}
              className="bg-transparent text-xs text-primary font-medium focus:outline-none cursor-pointer"
            >
              <option value="name">NAME</option>
              <option value="cmc">CMC</option>
              <option value="price">PRICE</option>
              {showInclusion && generatedDeck?.cardInclusionMap && <option value="score">INCLUSION</option>}
              {showRelevancy && generatedDeck?.cardRelevancyMap && <option value="relevancy">RELEVANCY</option>}
            </select>
          </div>

          {/* Show Toggles */}
          <div className="relative" ref={showMenuMobileRef}>
            <button
              onClick={() => setShowMenu(v => !v)}
              className={`flex items-center gap-1.5 bg-card/50 rounded-lg px-3 py-1.5 border border-border/50 text-xs transition-colors ${showMenu ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Eye className="w-4 h-4" />
              Show
            </button>
            {showMenu && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg p-2 space-y-1 min-w-[160px]">
                {[
                  { key: 'price', label: 'Price', value: showPrice, toggle: () => setShowPrice(v => { const next = !v; localStorage.setItem('mtg-deck-show-price', String(next)); return next; }) },
                  { key: 'inclusion', label: 'Inclusion %', value: showInclusion, toggle: () => setShowInclusion(v => { const next = !v; localStorage.setItem('mtg-deck-show-inclusion', String(next)); if (!next && sortBy === 'score') setSortBy('name'); return next; }), hide: !generatedDeck?.cardInclusionMap, infoText: "Each card's percentage shows how many EDHREC decks with this commander include that card. Higher % = more popular, proven pick." },
                  { key: 'relevancy', label: 'Relevancy', value: showRelevancy, toggle: () => setShowRelevancy(v => { const next = !v; localStorage.setItem('mtg-deck-show-relevancy', String(next)); if (!next && sortBy === 'relevancy') setSortBy('name'); return next; }), hide: !generatedDeck?.cardRelevancyMap, infoText: 'Composite score combining EDHREC synergy, inclusion %, role fit, curve fit, and type balance. Higher = stronger fit for this deck.' },
                  { key: 'roles', label: 'Roles', value: showRoles, toggle: () => { setShowRoles(v => { const next = !v; localStorage.setItem('deckRolesOpen', String(next)); return next; }); }, hide: !generatedDeck?.roleTargets },
                ].filter(o => !o.hide).map(opt => (
                  <div key={opt.key} className="relative flex items-center">
                    <button
                      onClick={opt.toggle}
                      className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${opt.value ? 'text-foreground bg-accent/50' : 'text-muted-foreground hover:bg-accent/30'}`}
                    >
                      <span className={`w-3 h-3 rounded-sm border flex items-center justify-center shrink-0 ${opt.value ? 'bg-primary border-primary' : 'border-border'}`}>
                        {opt.value && <Check className="w-2 h-2 text-primary-foreground" />}
                      </span>
                      {opt.label}
                    </button>
                    {'infoText' in opt && opt.infoText && (
                      <InfoTooltip text={opt.infoText}>
                        <Info className="w-3 h-3" />
                      </InfoTooltip>
                    )}
                  </div>
                ))}
                {/* Icons parent toggle + sub-items */}
                <div className="pt-1 mt-1">
                  <div className="relative flex items-center">
                    <button
                      onClick={() => setShowIcons(v => { const next = !v; localStorage.setItem('mtg-deck-show-icons', String(next)); return next; })}
                      className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${showIcons ? 'text-foreground bg-accent/50' : 'text-muted-foreground hover:bg-accent/30'}`}
                    >
                      <span className={`w-3 h-3 rounded-sm border flex items-center justify-center shrink-0 ${showIcons ? 'bg-primary border-primary' : 'border-border'}`}>
                        {showIcons && <Check className="w-2 h-2 text-primary-foreground" />}
                      </span>
                      Icons
                    </button>
                  </div>
                  {showIcons && [
                    ...(!showOwnedIndicators ? [] : [{ key: 'collection', label: 'In Collection', value: showCollectionChecks, toggle: () => setShowCollectionChecks(v => { const next = !v; localStorage.setItem('mtg-deck-builder-show-collection-checks', String(next)); return next; }) }]),
                    { key: 'pinban', label: 'Pin / Ban', value: showPinBan, toggle: () => setShowPinBan(v => { const next = !v; localStorage.setItem('mtg-deck-show-pin-ban', String(next)); return next; }) },
                  ].map(opt => (
                    <div key={opt.key} className="relative flex items-center">
                      <button
                        onClick={opt.toggle}
                        className={`flex-1 flex items-center gap-2 px-2 pl-4 py-1.5 rounded text-xs transition-colors ${opt.value ? 'text-foreground bg-accent/50' : 'text-muted-foreground hover:bg-accent/30'}`}
                      >
                        <span className={`w-3 h-3 rounded-sm border flex items-center justify-center shrink-0 ${opt.value ? 'bg-primary border-primary' : 'border-border'}`}>
                          {opt.value && <Check className="w-2 h-2 text-primary-foreground" />}
                        </span>
                        {opt.label}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Search */}
          <div className="relative flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="bg-card/50 border border-border/50 rounded-lg pl-8 pr-8 py-1.5 text-xs w-28 sm:w-48 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {searchMatchingIds && (
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {searchMatchingIds.size} match{searchMatchingIds.size !== 1 ? 'es' : ''}
              </span>
            )}
          </div>

          {/* Modify Deck — mobile/tablet only (on xl it's in sidebar) */}
          {!readOnly && !isEditMode && (
            <button
              onClick={() => setIsEditMode(true)}
              className="xl:hidden flex items-center gap-1.5 bg-card/50 rounded-lg px-3 py-1.5 border border-border/50 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="Modify Deck"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>Modify Deck</span>
            </button>
          )}
          {!readOnly && isEditMode && (
            <button onClick={handleExitEditMode} className="xl:hidden w-full sm:w-auto px-2 py-2 sm:py-1.5 text-xs text-red-400/70 hover:text-red-400 transition-colors whitespace-nowrap">
              Exit Modify
            </button>
          )}

          {/* View Toggle + Text Editor — pushed to flex-end */}
          <div className="ml-auto flex bg-card/50 rounded-lg px-1.5 py-1 border border-border/50 items-center">
            <button
              onClick={() => setShowTextEditor(v => !v)}
              className={`px-1.5 py-1 rounded ${showTextEditor ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              title={showTextEditor ? 'Hide text editor' : 'Show text editor'}
            >
              <FileText className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-border/60 mx-1" />
            <button
              onClick={() => setViewMode('grid')}
              className={`px-1.5 py-1 rounded ${viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              title="Grid view"
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-1.5 py-1 rounded ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              title="List view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

          <div className={`flex flex-col lg:flex-row ${showTextEditor ? 'gap-4' : 'gap-0'}`}>
          {/* Text Editor Panel — animated side-by-side */}
          <div
            className={`lg:sticky lg:top-[84px] lg:self-start transition-all duration-300 ease-in-out overflow-hidden ${
              showTextEditor
                ? 'lg:w-[380px] lg:shrink-0 lg:opacity-100 max-lg:opacity-100 max-lg:max-h-[800px]'
                : 'lg:w-0 lg:opacity-0 max-lg:max-h-0 max-lg:opacity-0'
            }`}
          >
            <div className={`bg-card/30 rounded-lg border border-border/50 overflow-hidden ${showTextEditor ? '' : 'lg:hidden max-lg:hidden'}`} style={{ minWidth: showTextEditor ? 380 : 0 }}>
              <TextEditorView
                generateDeckList={generateDeckList}
                onAddCards={onAddCards}
                onRemoveCards={onRemoveCards}
                onChangeQuantity={onChangeQuantity}
                readOnly={readOnly || (!onAddCards && !onRemoveCards)}
                onClose={() => setShowTextEditor(false)}
                sideboardNames={sideboardNames}
                maybeboardNames={maybeboardNames}
                onSetSideboard={onSetSideboard}
                onSetMaybeboard={onSetMaybeboard}
                pushDeckHistory={pushDeckHistory}
              />
            </div>
          </div>

          {/* Deck View */}
          <div className={`bg-card/30 rounded-lg border border-border/50 overflow-hidden flex-1 min-w-0 ${isEditMode ? 'select-none' : ''}`}>
            {viewMode === 'list' ? (
              <div className="p-4" style={{ columnWidth: '280px', columnGap: '2rem' }}>
                {TYPE_ORDER.map((type) => (
                  <CategoryColumn
                    key={type}
                    type={type}
                    cards={groupedCards[type] || []}
                    onPreview={setPreviewCard}
                    onHover={handleHover}
                    matchingCardIds={combinedMatchingIds}
                    avgCardPrice={avgCardPrice}
                    currency={customization.currency}
                    cardComboMap={cardComboMap}
                    cardTypeMap={cardTypeMap}
                    showRoleColumn={showRoles && !!generatedDeck?.roleTargets}
                    removedCards={removedCards}
                    isEditMode={isEditMode && !readOnly}
                    selectedCards={selectedCards}
                    onToggleSelect={handleToggleCardSelection}
                    onToggleCategory={handleToggleCategory}
                    collectionNames={showIcons && showOwnedIndicators && showCollectionChecks ? collectionNames : null}
                    mustIncludeNames={mustIncludeNames}
                    bannedNames={bannedNames}
                    cardInclusionMap={showInclusion ? generatedDeck?.cardInclusionMap : null}
                    cardRelevancyMap={showRelevancy ? generatedDeck?.cardRelevancyMap : null}
                    showPrice={showPrice}
                    onCardAction={!readOnly ? handleCardAction : undefined}
                    showCardMenu={!readOnly}
                    cardMenuProps={cardMenuProps}
                    onChangeQuantity={onChangeQuantity}
                    isSingleton={formatConfig.hasCommander}
                    showPinBan={showIcons && showPinBan}
                    mdfcLandCount={type === 'Land' ? mdfcLandCount : undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="p-4 space-y-1">
                {TYPE_ORDER.map((type) => {
                  const cards = groupedCards[type] || [];
                  const visibleCards = combinedMatchingIds
                    ? cards.filter(({ card }) => combinedMatchingIds.has(card.id))
                    : cards;
                  if (visibleCards.length === 0) return null;
                  return (
                    <div key={type}>
                      <button
                        onClick={() => setCollapsedGridCategories(prev => {
                          const next = new Set(prev);
                          next.has(type) ? next.delete(type) : next.add(type);
                          return next;
                        })}
                        className="flex items-center gap-1.5 pt-2 pb-1 w-full text-left group"
                      >
                        <ChevronDown className={`w-3 h-3 text-muted-foreground/60 transition-transform ${collapsedGridCategories.has(type) ? '-rotate-90' : ''}`} />
                        <CardTypeIcon type={type} size="sm" className="opacity-60" />
                        <span className="text-xs font-medium text-muted-foreground">{type}</span>
                        <span className="text-[10px] text-muted-foreground/60">{visibleCards.length}</span>
                      </button>
                      {!collapsedGridCategories.has(type) && (
                      <div ref={gridAnimateRef} className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                        {visibleCards.map(({ card, quantity }) => {
                          const isCommanderType = type === 'Commander';
                          const canSelect = isEditMode && !readOnly && !isCommanderType;
                          const isSelected = selectedCards.has(card.id);
                          return (
                            <button
                              key={card.id}
                              onClick={(e) => {
                                if (canSelect) {
                                  handleToggleCardSelection(card, e.shiftKey);
                                } else {
                                  setPreviewCard(card);
                                }
                              }}
                              className={`relative group ${canSelect ? 'cursor-pointer' : ''} ${isSelected ? 'ring-2 ring-primary rounded' : ''} ${canSelect && isCommanderType ? 'opacity-60' : ''}`}
                            >
                              <img
                                src={getCardImageUrl(card, 'small')}
                                alt={card.name}
                                className={`w-full rounded transition-transform ${canSelect ? '' : 'group-hover:scale-105'} ${isSelected ? 'brightness-75' : ''}`}
                                loading="lazy"
                              />
                              {/* Selection checkbox overlay */}
                              {canSelect && (
                                <span className={`absolute top-1 left-1 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                                  isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-white/70 bg-black/30'
                                }`}>
                                  {isSelected && <Check className="w-3 h-3" />}
                                </span>
                              )}
                              {quantity > 1 && (
                                <span className="absolute top-1 right-1 bg-black/80 text-white text-xs px-1.5 rounded">
                                  {quantity}x
                                </span>
                              )}
                              {!readOnly && !isCommanderType && (
                                <span className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity z-10" style={quantity > 1 ? { top: '1.75rem' } : undefined}>
                                  <CardContextMenu card={card} onAction={handleCardAction} {...cardMenuProps} isMustInclude={mustIncludeNames.has(card.name)} isBanned={bannedNames.has(card.name)} />
                                </span>
                              )}
                              {sortBy === 'cmc' && (
                                <span className="absolute top-1 left-1 bg-black/80 text-white text-[10px] px-1 rounded">
                                  {card.cmc}
                                </span>
                              )}
                              {sortBy === 'price' && showPrice && (
                                <span className="absolute top-1 left-1 bg-black/80 text-white text-[10px] px-1 rounded">
                                  {formatPrice(getCardPrice(card, customization.currency), sym)}
                                </span>
                              )}
                              {sortBy === 'score' && generatedDeck?.cardInclusionMap && (() => {
                                const normalizedName = card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name;
                                const incl = generatedDeck.cardInclusionMap![card.name] ?? generatedDeck.cardInclusionMap![normalizedName];
                                if (incl == null) return null;
                                const pct = Math.round(incl);
                                const hue = (pct / 100) * 120;
                                return (
                                  <span className="absolute top-1 left-1 bg-black/80 text-[10px] px-1 rounded font-medium" style={{ color: `hsl(${hue}, 70%, 55%)` }}>
                                    {pct}%
                                  </span>
                                );
                              })()}
                              {sortBy === 'relevancy' && generatedDeck?.cardRelevancyMap && (() => {
                                const normalizedName = card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name;
                                const rel = generatedDeck.cardRelevancyMap![card.name] ?? generatedDeck.cardRelevancyMap![normalizedName];
                                if (rel == null) return null;
                                return (
                                  <span className="absolute top-1 left-1 bg-violet-500/90 text-white text-[10px] px-1 rounded font-medium" title={`Relevancy: ${rel}`}>
                                    {rel}
                                  </span>
                                );
                              })()}
                              {sortBy !== 'cmc' && sortBy !== 'price' && sortBy !== 'score' && sortBy !== 'relevancy' && !isEditMode && showRelevancy && generatedDeck?.cardRelevancyMap && (() => {
                                const normalizedName = card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name;
                                const rel = generatedDeck.cardRelevancyMap![card.name] ?? generatedDeck.cardRelevancyMap![normalizedName];
                                if (rel == null) return null;
                                return (
                                  <span className="absolute top-1 right-8 bg-violet-500/90 text-white text-[10px] px-1 rounded font-medium" title={`Relevancy: ${rel}`}>
                                    {rel}
                                  </span>
                                );
                              })()}
                              {sortBy !== 'cmc' && sortBy !== 'price' && sortBy !== 'score' && sortBy !== 'relevancy' && !isEditMode && showInclusion && generatedDeck?.cardInclusionMap && (() => {
                                const normalizedName = card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name;
                                const incl = generatedDeck.cardInclusionMap![card.name] ?? generatedDeck.cardInclusionMap![normalizedName];
                                if (incl == null) return null;
                                const pct = Math.round(incl);
                                const hue = (pct / 100) * 120;
                                return (
                                  <span className="absolute top-1 left-1 bg-black/80 text-[10px] px-1 rounded font-medium" style={{ color: `hsl(${hue}, 70%, 55%)` }} title={`${pct}% EDHREC inclusion`}>
                                    {pct}%
                                  </span>
                                );
                              })()}
                              {/* Bottom-right badge stack: GC/pin/ban icons + role badges */}
                              {(() => {
                                const isMLive = mustIncludeNames.has(card.name);
                                const isBLive = bannedNames.has(card.name);
                                const hasGcOrPin = card.isGameChanger || isMLive || isBLive;
                                const roleBadges: { bgColor: string; title: string; label: string }[] = [];
                                if (card.deckRole && showRoles) {
                                  if (card.multiRole) {
                                    // Show all matching roles
                                    for (const role of ['ramp', 'removal', 'boardwipe', 'cardDraw'] as RoleKey[]) {
                                      if (cardMatchesRole(card.name, role)) {
                                        // Build a pseudo-card to get badge props for each role
                                        const badge = getRoleBadgeProps({ ...card, deckRole: role } as ScryfallCard);
                                        if (badge) roleBadges.push(badge);
                                      }
                                    }
                                  } else {
                                    const badge = getRoleBadgeProps(card);
                                    if (badge) roleBadges.push(badge);
                                  }
                                }
                                const hasLandTags = showRoles && card.isUtilityLand;
                                if (!hasGcOrPin && roleBadges.length === 0 && !hasLandTags) return null;
                                return (
                                  <span className="absolute bottom-1 flex gap-0.5" style={{ right: isDoubleFacedCard(card) ? 28 : 4 }}>
                                    {card.isGameChanger && (
                                      <span className="bg-amber-500/80 text-white rounded-full w-5 h-5 flex items-center justify-center" title="Game Changer">
                                        <Star className="w-2.5 h-2.5" />
                                      </span>
                                    )}
                                    {isBLive && (
                                      <span className="bg-red-500/80 text-white rounded-full w-5 h-5 flex items-center justify-center animate-pop-in" title="Excluded">
                                        <Ban className="w-2.5 h-2.5" />
                                      </span>
                                    )}
                                    {isMLive && (
                                      <span className={`${
                                        card.mustIncludeSource === 'deck' ? 'bg-muted-foreground/60' :
                                        card.mustIncludeSource === 'combo' ? 'bg-violet-500/80' :
                                        'bg-emerald-500/80'
                                      } text-white rounded-full w-5 h-5 flex items-center justify-center ${
                                        card.mustIncludeSource === 'deck' || card.mustIncludeSource === 'combo' ? '' : 'animate-pop-in'
                                      }`}
                                        title={card.mustIncludeSource === 'deck' ? 'From Original Deck' :
                                               card.mustIncludeSource === 'combo' ? 'Added by User' : 'Must Include'}>
                                        {card.mustIncludeSource === 'deck' ? <Bookmark className="w-2.5 h-2.5" /> :
                                         card.mustIncludeSource === 'combo' ? <Sparkles className="w-2.5 h-2.5" /> :
                                         <Pin className="w-2.5 h-2.5" />}
                                      </span>
                                    )}
                                    {roleBadges.map((badge) => (
                                      <span key={badge.label} className={`text-white rounded-full px-1.5 py-0.5 text-[8px] font-bold leading-none flex items-center ${badge.bgColor}`}
                                        title={badge.title}
                                      >{badge.label}</span>
                                    ))}
                                    {showRoles && card.isUtilityLand && (
                                      <span className="text-white rounded-full px-1.5 py-0.5 text-[8px] font-bold leading-none flex items-center bg-violet-500/80"
                                        title="Utility Land">UL</span>
                                    )}
                                  </span>
                                );
                              })()}
                              {isDoubleFacedCard(card) && (
                                <span className="absolute bottom-1 right-1 bg-black/70 text-white rounded-full w-5 h-5 flex items-center justify-center" title="Double-faced card">
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                                    <path d="M3 3v5h5" />
                                  </svg>
                                </span>
                              )}
                              {(() => {
                                const normalizedName = card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name;
                                const combos = cardComboMap.get(normalizedName);
                                if (!combos || combos.length === 0) return null;
                                return (
                                  <span
                                    className="absolute bottom-1 left-1 bg-violet-600/80 text-white rounded-full w-5 h-5 flex items-center justify-center text-[9px] font-bold"
                                    title={`Part of ${combos.length} combo${combos.length > 1 ? 's' : ''}`}
                                  >
                                    {combos.length > 1 ? combos.length : <Sparkles className="w-2.5 h-2.5" />}
                                  </span>
                                );
                              })()}
                            </button>
                          );
                        })}
                      </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          {deckFooter}
          </div>{/* end Deck View */}
          </div>{/* end flex wrapper (text + deck) */}

          {/* Below-deck content (combos, etc.) */}
          {children && <div className="mt-4 space-y-4">{children}</div>}
          </div>{/* end Deck Column */}

          {/* Stats Sidebar - Desktop only */}
          <div className="hidden xl:block w-64 shrink-0">
            <div className="mb-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {!readOnly && !isEditMode && (
                    <button
                      onClick={() => setIsEditMode(true)}
                      className="p-1.5 rounded-md border bg-card/50 border-border/50 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      title="Modify Deck"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                  {!readOnly && isEditMode && (
                    <button onClick={handleExitEditMode} className="px-2 py-1.5 text-xs text-red-400/70 hover:text-red-400 transition-colors whitespace-nowrap">
                      Exit Modify
                    </button>
                  )}
                  {sidebarLeftActions}
                </div>
                {sidebarHeader || deckSummary}
              </div>
            </div>
            <DeckStats activeFilter={statsFilter} onFilterChange={handleStatsFilterChange} showRoles={showRoles} onToggleRoles={handleToggleRoles} collectionNames={collectionNames} showCollection={showOwnedIndicators && showCollectionChecks} showRelevancy={showRelevancy} overallGrade={overallGrade} />
            <div className="mt-4"><DeckHistory onPreviewCard={handleHistoryPreview} resolveCard={resolveCardByName} onCardAction={!readOnly ? handleCardAction : undefined} cardMenuProps={!readOnly ? cardMenuProps : undefined} deckCardNames={deckCardNames} /></div>
          </div>
        </div>
      </div>

      {/* Floating Preview */}
      {hoverCard && viewMode === 'list' && (
        <FloatingPreview card={hoverCard.card} rowRect={hoverCard.rowRect} showBack={hoverCard.showBack} />
      )}

      {/* Modals */}
      <CardPreviewModal
        card={previewCard}
        onClose={() => setPreviewCard(null)}
        combos={previewCard ? cardComboMap.get(previewCard.name.includes(' // ') ? previewCard.name.split(' // ')[0] : previewCard.name) : undefined}
        cardTypeMap={cardTypeMap}
        cardComboMap={cardComboMap}
        deckOnly
        hideMustInclude={readOnly}
        swapCandidates={readOnly ? undefined : previewSwapCandidates}
        onSwapCard={readOnly ? undefined : (oldCard, newCard) => {
          swapDeckCard(oldCard, newCard);
          pushDeckHistory({ action: 'swap', cardName: oldCard.name, targetCardName: newCard.name });
          // Clear the swapped-out card from removedCards so it doesn't show struck-through
          setRemovedCards(prev => {
            if (!prev.has(oldCard.id)) return prev;
            const next = new Set(prev);
            next.delete(oldCard.id);
            return next;
          });
          setPreviewCard(null);
        }}
        onRegenerate={readOnly ? undefined : handleRegenerate}
        onNavigate={handlePreviewNavigate}
        canNavigate={previewCanNavigate}
        cardIndex={previewCardIndex >= 0 ? previewCardIndex : undefined}
        totalCards={flatCardList.length}
        cardInclusionMap={showInclusion ? generatedDeck?.cardInclusionMap : null}
        cardRelevancyMap={showRelevancy ? generatedDeck?.cardRelevancyMap : null}
        showPrice={showPrice}
        prevCardImage={prevCardImage}
        nextCardImage={nextCardImage}
        onBuildDeck={(cardName) => navigate(`/build/${encodeURIComponent(cardName)}`)}
      />
      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        generateDeckList={generateDeckList}
        hasMustIncludes={!readOnly && customization.mustIncludeCards.length > 0}
        onExport={(format) => {
          if (commander) trackEvent('deck_exported', { commanderName: commander.name, format });
        }}
        onSaveToList={(name, cards) => {
          // Build generation summary
          const summaryParts: string[] = [];
          if (generatedDeck?.usedThemes && generatedDeck.usedThemes.length > 0) {
            summaryParts.push(`Built with: ${generatedDeck.usedThemes.join(', ')}`);
          }
          const sym = customization.currency === 'EUR' ? '€' : '$';
          if (customization.bracketLevel !== 'all') summaryParts.push(`Bracket ${customization.bracketLevel}`);
          if (customization.budgetOption === 'budget') summaryParts.push('Budget');
          if (customization.budgetOption === 'expensive') summaryParts.push('Expensive');
          if (customization.maxCardPrice !== null) summaryParts.push(`<${sym}${customization.maxCardPrice}/card`);
          if (customization.deckBudget !== null) summaryParts.push(`${sym}${customization.deckBudget} deck budget`);
          if (customization.maxRarity) summaryParts.push(`${customization.maxRarity.charAt(0).toUpperCase() + customization.maxRarity.slice(1)} max`);
          if (customization.tinyLeaders) summaryParts.push('Tiny Leaders');
          if (customization.arenaOnly) summaryParts.push('Arena Only');
          if (customization.collectionMode) summaryParts.push(customization.collectionStrategy === 'partial' ? `Collection (${customization.collectionOwnedPercent}%)` : 'Collection Only');
          if (!customization.tempoAutoDetect) {
            const pacingLabels: Record<string, string> = { 'aggressive-early': 'Aggressive Early', 'fast-tempo': 'Fast Tempo', 'balanced': 'Balanced', 'midrange': 'Midrange', 'late-game': 'Late Game' };
            summaryParts.push(pacingLabels[customization.tempoPacing] || customization.tempoPacing);
          }
          if (customization.hyperFocus) summaryParts.push('Hyper-focused');
          if (customization.comboCount === 0) summaryParts.push('No combos');
          if (customization.comboCount === 2) summaryParts.push('Extra combos');
          if (customization.comboCount === 3) summaryParts.push('Combo-heavy');
          if (customization.scryfallQuery) summaryParts.push(`Query: ${customization.scryfallQuery}`);

          createList(name, cards, '', {
            type: 'deck',
            commanderName: commander?.name,
            partnerCommanderName: generatedDeck?.partnerCommander?.name,
            deckSize: cards.length,
            generationSummary: summaryParts.length > 0 ? summaryParts.join(' · ') : undefined,
          });
          trackEvent('list_created', { listName: name, cardCount: cards.length });
          setShowSavedToast(true);
        }}
        defaultListName={commander ? `${commander.name} Deck` : 'My Deck'}
      />
      {toastMessage && createPortal(
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 bg-emerald-600/90 text-white text-sm rounded-lg shadow-lg animate-fade-in max-w-sm flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>{toastMessage.text}</span>
          {toastMessage.onUndo && (
            <button
              onClick={toastMessage.onUndo}
              className="underline underline-offset-2 hover:text-white/80 transition-colors font-medium shrink-0"
            >
              Undo
            </button>
          )}
        </div>,
        document.body
      )}
      {showSavedToast && createPortal(
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 bg-emerald-600/90 text-white text-sm rounded-lg shadow-lg animate-fade-in max-w-sm flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>Deck saved!</span>
          <button
            onClick={() => { setShowSavedToast(false); navigate('/lists'); }}
            className="underline underline-offset-2 hover:text-white/80 transition-colors font-medium"
          >
            View in My Lists
          </button>
        </div>,
        document.body
      )}
      {isEditMode && createPortal(
        <div className="fixed bottom-0 left-0 right-0 z-40 animate-slide-up">
          {/* Desktop toolbar */}
          <div className="hidden sm:block max-w-4xl mx-auto px-4 pb-4">
            <div className="flex items-center justify-between gap-4 bg-card/95 backdrop-blur-md border border-border rounded-xl shadow-2xl px-5 py-3">
              <span className="text-sm font-medium shrink-0">
                {selectedCards.size > 0 ? (
                  <>{selectedCards.size} card{selectedCards.size !== 1 ? 's' : ''} selected</>
                ) : (
                  <span className="text-muted-foreground">Select cards</span>
                )}
              </span>
              {toolbarExtra}
              <div className="flex items-center gap-2">
                {onRemoveCards && (
                  <button
                    onClick={handleRemoveFromList}
                    disabled={selectedCards.size === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    title="Remove"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove</span>
                  </button>
                )}
                {onRegenerate && (
                  <>
                    <button
                      onClick={handleToggleMustInclude}
                      disabled={selectedCards.size === 0}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                        allSelectedAreMustInclude
                          ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                          : 'border-border hover:bg-accent text-muted-foreground hover:text-foreground'
                      }`}
                      title={allSelectedAreMustInclude ? 'Unpin must-include' : 'Must Include'}
                    >
                      <Pin className="w-3.5 h-3.5" />
                      <span>{allSelectedAreMustInclude ? 'Unpin' : 'Must Include'}</span>
                    </button>
                    <button
                      onClick={handleBanSelected}
                      disabled={selectedCards.size === 0}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                      title="Exclude"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>Exclude</span>
                    </button>
                    <div className="w-px h-5 bg-border mx-0.5" />
                    <button
                      onClick={handleReplaceSelected}
                      disabled={selectedCards.size === 0}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                      title="Replace"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Replace</span>
                    </button>
                  </>
                )}
                <div className="relative" ref={addToDropdownRef}>
                  <button
                    onClick={() => setShowAddToDropdown(prev => !prev)}
                    disabled={selectedCards.size === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    title="Add to"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add to</span>
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  {showAddToDropdown && (() => {
                    const hasDeckTab = !!(onMoveToSideboard || onMoveToMaybeboard);
                    const activeTab = hasDeckTab ? addToTab : 'lists';
                    const listsOnly = userLists.filter(l => l.type !== 'deck');
                    const filtered = listSearchQuery
                      ? listsOnly.filter(l => l.name.toLowerCase().includes(listSearchQuery.toLowerCase()))
                      : listsOnly;
                    return (
                      <div className="absolute bottom-full mb-1 right-0 w-60 bg-card border border-border rounded-lg shadow-2xl z-50 max-h-80 flex flex-col">
                        {hasDeckTab && (
                          <div className="flex border-b border-border">
                            <button
                              onClick={() => { setAddToTab('deck'); setListSearchQuery(''); }}
                              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${activeTab === 'deck' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                              Deck
                            </button>
                            <button
                              onClick={() => { setAddToTab('lists'); setListSearchQuery(''); }}
                              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${activeTab === 'lists' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                              Lists
                            </button>
                          </div>
                        )}
                        {activeTab === 'deck' && hasDeckTab && (
                          <div className="py-1">
                            {onMoveToSideboard && (
                              <button onClick={handleMoveToSideboard} className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2">
                                <ArrowUpDown className="w-3.5 h-3.5 text-amber-400" /><span>Sideboard</span>
                              </button>
                            )}
                            {onMoveToMaybeboard && (
                              <button onClick={handleMoveToMaybeboard} className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2">
                                <Bookmark className="w-3.5 h-3.5 text-purple-400" /><span>Maybeboard</span>
                              </button>
                            )}
                          </div>
                        )}
                        {activeTab === 'lists' && (
                          <>
                            {listsOnly.length >= 5 && (
                              <div className="px-2 pt-1 pb-1">
                                <input type="text" placeholder="Search lists..." value={listSearchQuery} onChange={e => setListSearchQuery(e.target.value)} className="w-full px-2 py-1 text-xs bg-muted/50 border border-border rounded focus:outline-none focus:border-primary" autoFocus onClick={e => e.stopPropagation()} />
                              </div>
                            )}
                            <div className="overflow-y-auto py-1">
                              {showNewListInput ? (
                                <form className="px-2 py-1.5 flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); handleAddToNewList(newListName); }}>
                                  <input ref={newListInputRef} type="text" placeholder="List name..." value={newListName} onChange={e => setNewListName(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setShowNewListInput(false); setNewListName(''); } }} className="flex-1 min-w-0 px-2 py-1 text-xs bg-muted/50 border border-border rounded focus:outline-none focus:border-primary" autoFocus onClick={e => e.stopPropagation()} />
                                  <button type="submit" disabled={!newListName.trim()} className="px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:pointer-events-none">Create</button>
                                </form>
                              ) : (
                                <button onClick={() => { setShowNewListInput(true); setTimeout(() => newListInputRef.current?.focus(), 0); }} className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2 text-primary">
                                  <Plus className="w-3.5 h-3.5" />New list
                                </button>
                              )}
                              {filtered.length > 0 && <div className="border-t border-border my-1" />}
                              {filtered.map(list => (
                                <button key={list.id} onClick={() => handleAddToExistingList(list.id)} className="w-full text-left px-3 py-2 text-sm hover:bg-accent truncate" title={`${list.name} (${list.cards.length} cards)`}>
                                  {list.name}<span className="text-muted-foreground ml-1">({list.cards.length})</span>
                                </button>
                              ))}
                              {listSearchQuery && filtered.length === 0 && (
                                <p className="px-3 py-2 text-xs text-muted-foreground">No matching lists</p>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <button onClick={handleExitEditMode} className="px-2 py-1.5 text-xs text-red-400/70 hover:text-red-400 transition-colors">Cancel</button>
              </div>
            </div>
          </div>

          {/* Mobile drawer */}
          {(() => {
            const hasMoveTab = !!(onMoveToSideboard || onMoveToMaybeboard || userLists.some(l => l.type !== 'deck'));
            const hasAddTab = !!toolbarExtra;
            const listsOnly = userLists.filter(l => l.type !== 'deck');
            const filtered = listSearchQuery
              ? listsOnly.filter(l => l.name.toLowerCase().includes(listSearchQuery.toLowerCase()))
              : listsOnly;
            return (
              <div className="sm:hidden bg-card/95 backdrop-blur-md border-t border-border shadow-2xl">
                {/* Handle + Header */}
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                  <span className="text-sm font-medium">
                    {selectedCards.size > 0 ? (
                      <>{selectedCards.size} card{selectedCards.size !== 1 ? 's' : ''} selected</>
                    ) : (
                      <span className="text-muted-foreground">Select cards</span>
                    )}
                  </span>
                  <button onClick={handleExitEditMode} className="px-2 py-1 text-xs text-red-400/70 hover:text-red-400 transition-colors">
                    Cancel
                  </button>
                </div>

                {/* Tab bar */}
                <div className="flex border-b border-border/50 px-4 gap-1">
                  <button
                    onClick={() => setEditDrawerTab('actions')}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${editDrawerTab === 'actions' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'}`}
                  >
                    Actions
                  </button>
                  {hasMoveTab && (
                    <button
                      onClick={() => setEditDrawerTab('move')}
                      className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${editDrawerTab === 'move' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'}`}
                    >
                      Move to
                    </button>
                  )}
                  {hasAddTab && (
                    <button
                      onClick={() => setEditDrawerTab('add')}
                      className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${editDrawerTab === 'add' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'}`}
                    >
                      Add
                    </button>
                  )}
                </div>

                {/* Tab content */}
                <div className="px-4 py-3 pb-6 space-y-1">
                  {/* Actions tab */}
                  {editDrawerTab === 'actions' && (
                    <>
                      {onRemoveCards && (
                        <button
                          onClick={handleRemoveFromList}
                          disabled={selectedCards.size === 0}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                        >
                          <Trash2 className="w-4 h-4" />
                          Remove from deck
                        </button>
                      )}
                      {onRegenerate && (
                        <>
                          <button
                            onClick={handleToggleMustInclude}
                            disabled={selectedCards.size === 0}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                              allSelectedAreMustInclude
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'hover:bg-accent text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            <Pin className="w-4 h-4" />
                            {allSelectedAreMustInclude ? 'Unpin must-include' : 'Pin as must-include'}
                          </button>
                          <button
                            onClick={handleBanSelected}
                            disabled={selectedCards.size === 0}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                          >
                            <Ban className="w-4 h-4" />
                            Exclude from deck
                          </button>
                          <button
                            onClick={handleReplaceSelected}
                            disabled={selectedCards.size === 0}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                          >
                            <RefreshCw className="w-4 h-4" />
                            Replace with alternatives
                          </button>
                        </>
                      )}
                    </>
                  )}

                  {/* Move to tab */}
                  {editDrawerTab === 'move' && hasMoveTab && (
                    <>
                      {onMoveToSideboard && (
                        <button
                          onClick={handleMoveToSideboard}
                          disabled={selectedCards.size === 0}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                        >
                          <ArrowUpDown className="w-4 h-4 text-amber-400" />
                          Move to sideboard
                        </button>
                      )}
                      {onMoveToMaybeboard && (
                        <button
                          onClick={handleMoveToMaybeboard}
                          disabled={selectedCards.size === 0}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                        >
                          <Bookmark className="w-4 h-4 text-purple-400" />
                          Move to maybeboard
                        </button>
                      )}
                      {listsOnly.length > 0 && (onMoveToSideboard || onMoveToMaybeboard) && (
                        <div className="border-t border-border/50 my-2" />
                      )}
                      {listsOnly.length >= 5 && (
                        <div className="pb-1">
                          <input
                            type="text"
                            placeholder="Search lists..."
                            value={listSearchQuery}
                            onChange={e => setListSearchQuery(e.target.value)}
                            className="w-full px-3 py-2 text-xs bg-muted/50 border border-border rounded-lg focus:outline-none focus:border-primary"
                            onClick={e => e.stopPropagation()}
                          />
                        </div>
                      )}
                      <div className="max-h-40 overflow-y-auto">
                        {showNewListInput ? (
                          <form className="flex items-center gap-1.5 py-1" onSubmit={(e) => { e.preventDefault(); handleAddToNewList(newListName); }}>
                            <input
                              ref={newListInputRef}
                              type="text"
                              placeholder="List name..."
                              value={newListName}
                              onChange={e => setNewListName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Escape') { setShowNewListInput(false); setNewListName(''); } }}
                              className="flex-1 min-w-0 px-3 py-2 text-xs bg-muted/50 border border-border rounded-lg focus:outline-none focus:border-primary"
                              autoFocus
                              onClick={e => e.stopPropagation()}
                            />
                            <button type="submit" disabled={!newListName.trim()} className="px-3 py-2 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:pointer-events-none">
                              Create
                            </button>
                          </form>
                        ) : (
                          <button
                            onClick={() => { setShowNewListInput(true); setTimeout(() => newListInputRef.current?.focus(), 0); }}
                            disabled={selectedCards.size === 0}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg hover:bg-accent text-primary transition-colors disabled:opacity-40 disabled:pointer-events-none"
                          >
                            <Plus className="w-4 h-4" />
                            Add to new list
                          </button>
                        )}
                        {filtered.map(list => (
                          <button
                            key={list.id}
                            onClick={() => handleAddToExistingList(list.id)}
                            disabled={selectedCards.size === 0}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors truncate disabled:opacity-40 disabled:pointer-events-none"
                          >
                            <List className="w-4 h-4 shrink-0" />
                            <span className="truncate">{list.name}</span>
                            <span className="text-muted-foreground/70 text-xs ml-auto shrink-0">({list.cards.length})</span>
                          </button>
                        ))}
                        {listSearchQuery && filtered.length === 0 && (
                          <p className="px-3 py-2 text-xs text-muted-foreground">No matching lists</p>
                        )}
                      </div>
                    </>
                  )}

                  {/* Add tab */}
                  {editDrawerTab === 'add' && hasAddTab && (
                    <div>{toolbarExtra}</div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>,
        document.body
      )}
    </>
  );
}
