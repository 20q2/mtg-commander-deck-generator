import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Loader2, Sparkles, Plus, Minus, Check, ShoppingCart, RefreshCw,
  Shield, Swords, Flame, BookOpen,
  TrendingUp, TrendingDown,
  ChevronDown, ChevronRight,
  LayoutDashboard, Mountain, BarChart3, Layers,
  AlertTriangle, Palette, FlipHorizontal2, RotateCcw, Info, Scissors,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { ScryfallCard, DeckCategory, UserCardList } from '@/types';
import { fetchCommanderData, fetchPartnerCommanderData } from '@/services/edhrec/client';
import { loadTaggerData, getCardRole, getAllCardRoles } from '@/services/tagger/client';
import { analyzeDeck, getDeckSummary, type DeckAnalysis, type RecommendedCard, type AnalyzedCard, type RoleBreakdown, type CurveBreakdown, type ManaBaseAnalysis, type ManaSourcesAnalysis, type GradeResult } from '@/services/deckBuilder/deckAnalyzer';
import { getCardByName, getCardsByNames, getCardPrice, getFrontFaceTypeLine, isMdfcLand, isChannelLand, searchMdfcLands, getChannelLandsForColors } from '@/services/scryfall/client';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import { ManaCost } from '@/components/ui/mtg-icons';
import { useStore } from '@/store';
import { useUserLists } from '@/hooks/useUserLists';

interface DeckOptimizerProps {
  commanderName: string;
  partnerCommanderName?: string;
  currentCards: ScryfallCard[];
  deckSize: number;
  roleCounts: Record<string, number>;
  roleTargets: Record<string, number>;
  categories: Record<DeckCategory, ScryfallCard[]>;
  cardInclusionMap?: Record<string, number>;
  onAddCards?: (cardNames: string[], destination: 'deck' | 'sideboard' | 'maybeboard') => void;
  onRemoveCards?: (cardNames: string[]) => void;
  onRemoveFromBoard?: (cardName: string, source: 'sideboard' | 'maybeboard') => void;
  onAddBasicLand?: (name: string) => void;
  onRemoveBasicLand?: (name: string) => void;
  sideboardNames?: string[];
  maybeboardNames?: string[];
}

type TabKey = 'overview' | 'roles' | 'lands' | 'curve' | 'types';

const TABS: { key: TabKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'roles',    label: 'Roles',    icon: Shield },
  { key: 'lands',    label: 'Mana',     icon: Mountain },
  { key: 'curve',    label: 'Curve',    icon: BarChart3 },
  { key: 'types',    label: 'Types',    icon: Layers },
];

/** HSL bar color: red (0%) → amber (50%) → green (100%) based on current/target ratio */
function roleBarColor(current: number, target: number): string {
  if (target <= 0) return `hsl(120, 60%, 45%)`;
  const ratio = Math.min(current / target, 1);
  const hue = ratio * 120; // 0 = red, 60 = amber, 120 = green
  return `hsl(${hue}, 60%, 45%)`;
}

/** Scryfall direct image redirect — works as <img src> */
function scryfallImg(name: string, version: 'small' | 'normal' = 'small'): string {
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=${version}`;
}

const ROLE_META: Record<string, { icon: typeof Sparkles; color: string; barColor: string }> = {
  ramp:      { icon: TrendingUp, color: 'text-emerald-400', barColor: 'bg-emerald-500' },
  removal:   { icon: Swords,     color: 'text-rose-400',    barColor: 'bg-rose-500' },
  boardwipe: { icon: Flame,      color: 'text-orange-400',  barColor: 'bg-orange-500' },
  cardDraw:  { icon: BookOpen,   color: 'text-sky-400',     barColor: 'bg-sky-500' },
};

const RANK_STYLES = [
  { bg: 'bg-amber-500/10', border: 'border-amber-500/30', badge: 'bg-amber-500 text-amber-950', label: '1st' },
  { bg: 'bg-slate-300/10', border: 'border-slate-400/30', badge: 'bg-slate-400 text-slate-950', label: '2nd' },
  { bg: 'bg-orange-700/10', border: 'border-orange-600/30', badge: 'bg-orange-700 text-orange-100', label: '3rd' },
];

const ROLE_LABELS: Record<string, string> = {
  ramp: 'Ramp', removal: 'Removal', boardwipe: 'Board Wipes', cardDraw: 'Card Advantage',
};

const ROLE_BADGE_COLORS: Record<string, string> = {
  Ramp: 'bg-emerald-500/20 text-emerald-400',
  Removal: 'bg-rose-500/20 text-rose-400',
  'Board Wipes': 'bg-orange-500/20 text-orange-400',
  'Card Advantage': 'bg-sky-500/20 text-sky-400',
};

const VERDICT_STYLES: Record<string, { border: string; bg: string; icon: string; titleColor: string }> = {
  'critically-low': { border: 'border-red-500/40', bg: 'bg-red-500/10', icon: '🚨', titleColor: 'text-red-400' },
  'low':            { border: 'border-amber-500/40', bg: 'bg-amber-500/10', icon: '⚠️', titleColor: 'text-amber-400' },
  'slightly-low':   { border: 'border-amber-500/30', bg: 'bg-amber-500/5', icon: '📉', titleColor: 'text-amber-400/80' },
  'high':           { border: 'border-sky-500/30', bg: 'bg-sky-500/5', icon: '📈', titleColor: 'text-sky-400' },
  'ok':             { border: 'border-emerald-500/30', bg: 'bg-emerald-500/5', icon: '✅', titleColor: 'text-emerald-400' },
};

const SUBTYPE_BADGE_COLORS: Record<string, string> = {
  'Mana Dork': 'bg-emerald-500/15 text-emerald-400/80',
  'Mana Rock': 'bg-emerald-500/15 text-emerald-400/80',
  'Cost Reducer': 'bg-emerald-500/15 text-emerald-400/80',
  'Ramp': 'bg-emerald-500/15 text-emerald-400/80',
  'Counter': 'bg-rose-500/15 text-rose-400/80',
  'Bounce': 'bg-rose-500/15 text-rose-400/80',
  'Spot Removal': 'bg-rose-500/15 text-rose-400/80',
  'Removal': 'bg-rose-500/15 text-rose-400/80',
  'Bounce Wipe': 'bg-orange-500/15 text-orange-400/80',
  'Board Wipe': 'bg-orange-500/15 text-orange-400/80',
  'Tutor': 'bg-sky-500/15 text-sky-400/80',
  'Wheel': 'bg-sky-500/15 text-sky-400/80',
  'Cantrip': 'bg-sky-500/15 text-sky-400/80',
  'Card Draw': 'bg-sky-500/15 text-sky-400/80',
  'Card Advantage': 'bg-sky-500/15 text-sky-400/80',
};

const ROLE_LABEL_ICONS: Record<string, typeof Sparkles> = {
  // Role-level
  'Ramp': TrendingUp,
  'Removal': Swords,
  'Board Wipes': Flame,
  'Card Advantage': BookOpen,
  // Ramp subtypes
  'Mana Dork': TrendingUp,
  'Mana Rock': TrendingUp,
  'Cost Reducer': TrendingUp,
  // Removal subtypes
  'Counter': Swords,
  'Bounce': Swords,
  'Spot Removal': Swords,
  // Boardwipe subtypes
  'Bounce Wipe': Flame,
  'Board Wipe': Flame,
  // Card draw subtypes
  'Tutor': BookOpen,
  'Wheel': BookOpen,
  'Cantrip': BookOpen,
  'Card Draw': BookOpen,
};


// ─── Shared: Analyzed Card Row (compact, for curve/lands/types) ──────
function AnalyzedCardRow({
  ac, onPreview, warning, showDetails, showProducedMana, onCardAction, menuProps,
}: {
  ac: AnalyzedCard;
  onPreview: (name: string) => void;
  warning?: string;
  showDetails?: boolean;
  showProducedMana?: boolean;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; isMustInclude?: boolean; isBanned?: boolean; isInSideboard?: boolean; isInMaybeboard?: boolean };
}) {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const price = showDetails ? getCardPrice(ac.card) : null;
  const typeLine = getFrontFaceTypeLine(ac.card).toLowerCase();
  const cardType = typeLine.includes('creature') ? 'creature'
    : typeLine.includes('planeswalker') ? 'planeswalker'
    : typeLine.includes('instant') ? 'instant'
    : typeLine.includes('sorcery') ? 'sorcery'
    : typeLine.includes('artifact') ? 'artifact'
    : typeLine.includes('enchantment') ? 'enchantment'
    : typeLine.includes('land') ? 'land'
    : typeLine.includes('battle') ? 'battle'
    : 'artifact';

  const primaryType = cardType.charAt(0).toUpperCase() + cardType.slice(1);

  const producedColors = showProducedMana ? (() => {
    const WUBRG = ['W', 'U', 'B', 'R', 'G'];
    const produced = ac.card.produced_mana || [];
    const colors = [...new Set(produced.filter(c => WUBRG.includes(c)))];
    if (colors.length > 0) return colors.sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));
    const oracle = (ac.card.oracle_text || '').toLowerCase();
    if (oracle.includes('any color') || oracle.includes('any type')) return WUBRG;
    const found: string[] = [];
    if (oracle.includes('add {w}')) found.push('W');
    if (oracle.includes('add {u}')) found.push('U');
    if (oracle.includes('add {b}')) found.push('B');
    if (oracle.includes('add {r}')) found.push('R');
    if (oracle.includes('add {g}')) found.push('G');
    if (found.length === 0 && produced.includes('C')) return ['C'];
    return found;
  })() : null;

  return (
    <div
      className={`flex items-center gap-2 py-1 px-1.5 rounded-lg cursor-pointer hover:bg-accent/40 transition-colors group ${
        warning ? 'border border-amber-500/20' : 'border border-transparent'
      }`}
      onClick={() => onPreview(ac.card.name)}
      onContextMenu={(e) => {
        if (onCardAction && menuProps) {
          e.preventDefault();
          setContextMenuOpen(true);
        }
      }}
    >
      <img
        src={scryfallImg(ac.card.name)}
        alt={ac.card.name}
        className="w-10 h-auto rounded shadow shrink-0"
        loading="lazy"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm truncate">{ac.card.name}</span>
          {ac.subtypeLabel && (() => {
            const RIcon = ROLE_LABEL_ICONS[ac.subtypeLabel];
            return (
              <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1 py-px rounded-full shrink-0 ${
                SUBTYPE_BADGE_COLORS[ac.subtypeLabel] || 'bg-muted text-muted-foreground'
              }`}>
                {RIcon && <RIcon className="w-2.5 h-2.5" />}
                {ac.subtypeLabel}
              </span>
            );
          })()}
        </div>
        <span className="text-[10px] text-muted-foreground/60 truncate block">
          {primaryType}
          {producedColors && producedColors.length > 0 && (
            <>
              <span className="mx-0.5 opacity-40">&bull;</span>
              <span className="inline-flex items-center gap-px align-middle">
                <span className="mr-1">Produces</span>
                {producedColors.map(c => (
                  <i key={c} className={`ms ms-${c.toLowerCase()} ms-cost text-[9px] ml-0.5`} />
                ))}
              </span>
            </>
          )}
        </span>
      </div>
      {showDetails && ac.card.mana_cost && (
        <ManaCost cost={ac.card.mana_cost} className="text-[10px] shrink-0" />
      )}
      {ac.inclusion != null && (
        <span
          className="text-xs tabular-nums shrink-0 font-medium"
          style={{ color: `hsl(${Math.min(ac.inclusion / 50, 1) * 120}, 70%, 55%)` }}
        >
          {Math.round(ac.inclusion)}%
        </span>
      )}
      {price && (
        <span className="text-[10px] text-muted-foreground shrink-0">${price}</span>
      )}
      {warning && (
        <span title={warning}>
          <AlertTriangle className="w-3 h-3 text-amber-400/60 shrink-0" />
        </span>
      )}
      {onCardAction && menuProps && (
        <span className={`shrink-0 w-3 transition-opacity ${contextMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} onClick={(e) => e.stopPropagation()}>
          <CardContextMenu
            card={ac.card}
            onAction={onCardAction}
            hasRemove
            hasSideboard
            hasMaybeboard
            isInSideboard={menuProps.isInSideboard}
            isInMaybeboard={menuProps.isInMaybeboard}
            userLists={menuProps.userLists}
            isMustInclude={menuProps.isMustInclude}
            isBanned={menuProps.isBanned}
            forceOpen={contextMenuOpen}
            onForceClose={() => setContextMenuOpen(false)}
          />
        </span>
      )}
    </div>
  );
}

// ─── Shared: Suggestion Card Grid (for upgrade recommendations) ──────
function SuggestionCardGrid({
  cards, onAdd, onPreview, addedCards, deficit = 0, onCardAction, menuProps,
}: {
  cards: RecommendedCard[];
  onAdd: (name: string) => void;
  onPreview: (name: string) => void;
  addedCards: Set<string>;
  deficit?: number;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
}) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {cards.map((rec, i) => (
        <SuggestionCardItem
          key={rec.name}
          rec={rec}
          added={addedCards.has(rec.name)}
          highlighted={deficit > 0 && i < deficit && !addedCards.has(rec.name)}
          onAdd={onAdd}
          onPreview={onPreview}
          onCardAction={onCardAction}
          menuProps={menuProps}
        />
      ))}
    </div>
  );
}

function SuggestionCardItem({
  rec, added, highlighted, onAdd, onPreview, onCardAction, menuProps,
}: {
  rec: RecommendedCard;
  added: boolean;
  highlighted: boolean;
  onAdd: (name: string) => void;
  onPreview: (name: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
}) {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const pct = Math.round(rec.inclusion);
  const roleBadges = rec.allRoleLabels && rec.allRoleLabels.length > 1
    ? rec.allRoleLabels
    : rec.roleLabel ? [rec.roleLabel] : [];

  // Create a minimal ScryfallCard-like object for the context menu
  const pseudoCard = useMemo(() => ({ name: rec.name, id: rec.name } as ScryfallCard), [rec.name]);

  const frontUrl = rec.imageUrl || scryfallImg(rec.name, 'normal');
  const backUrl = rec.backImageUrl;
  const displayUrl = flipped && backUrl ? backUrl : frontUrl;

  return (
    <div
      className={`group ${added ? 'opacity-40' : ''}`}
      onContextMenu={(e) => {
        if (onCardAction && menuProps) {
          e.preventDefault();
          setContextMenuOpen(true);
        }
      }}
    >
      <button
        type="button"
        onClick={() => !added && onPreview(rec.name)}
        className="w-full text-left relative"
        disabled={added}
      >
        <img
          src={displayUrl}
          alt={rec.name}
          className={`w-full rounded-lg shadow ${highlighted ? 'border border-emerald-500/60' : ''}`}
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).src = scryfallImg(rec.name, 'normal'); }}
        />
        {highlighted && (
          <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[8px] font-bold uppercase tracking-wider px-1.5 py-px rounded-full bg-emerald-600 text-white shadow whitespace-nowrap">
            Suggested
          </span>
        )}
        {/* Add button overlay */}
        {!added ? (
          <span
            onClick={(e) => { e.stopPropagation(); onAdd(rec.name); }}
            className="absolute top-0 left-0 rounded-tl-lg rounded-br-lg bg-black/60 hover:bg-black/80 text-white p-2 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
            title="Add to deck"
          >
            <Plus className="w-5 h-5" />
          </span>
        ) : (
          <span className="absolute top-0 left-0 rounded-tl-lg rounded-br-lg bg-black/60 text-white p-2">
            <Check className="w-5 h-5" />
          </span>
        )}
        {/* Flip button for DFCs — hover to show back face */}
        {backUrl && (
          <span
            onMouseEnter={() => setFlipped(true)}
            onMouseLeave={() => setFlipped(false)}
            className="absolute bottom-1 right-1 rounded-lg bg-black/60 hover:bg-black/80 text-white p-1.5 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
            title="Hover to show back face"
          >
            <RotateCcw className="w-4 h-4" />
          </span>
        )}
        {/* Context menu */}
        {onCardAction && menuProps && (
          <span className={`absolute top-1 right-1 z-10 transition-opacity ${contextMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} onClick={(e) => e.stopPropagation()}>
            <CardContextMenu
              card={pseudoCard}
              onAction={onCardAction}
              hasAddToDeck
              hasSideboard
              hasMaybeboard
              isInSideboard={menuProps.sideboardNames.has(rec.name)}
              isInMaybeboard={menuProps.maybeboardNames.has(rec.name)}
              userLists={menuProps.userLists}
              isMustInclude={menuProps.mustIncludeNames.has(rec.name)}
              isBanned={menuProps.bannedNames.has(rec.name)}
              forceOpen={contextMenuOpen}
              onForceClose={() => setContextMenuOpen(false)}
            />
          </span>
        )}
      </button>
      {/* Row 1: inclusion, name, price */}
      <div className="flex items-center gap-1 px-4 -mt-0.5 min-w-0">
        {pct >= 0 && (
          <span
            className="text-[10px] font-bold tabular-nums shrink-0"
            style={{ color: `hsl(${Math.min(pct / 50, 1) * 120}, 70%, 55%)` }}
          >
            {pct}%
          </span>
        )}
        <span className="text-[11px] truncate flex-1 min-w-0 text-muted-foreground text-center">{rec.name}</span>
        {rec.price && (
          <span className="text-[10px] text-muted-foreground/60 shrink-0">${rec.price}</span>
        )}
      </div>
      {/* Row 2: role tags */}
      {roleBadges.length > 0 && (
        <div className="flex items-center gap-1 px-4 min-w-0 flex-wrap justify-center">
          {roleBadges.map(label => {
            const badgeColor = ROLE_BADGE_COLORS[label];
            const RIcon = ROLE_LABEL_ICONS[label];
            return badgeColor ? (
              <span key={label} className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1 py-px rounded-full shrink-0 ${badgeColor}`}>
                {RIcon && <RIcon className="w-2.5 h-2.5" />}
                {label}
              </span>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

// ─── Shared: Cut Card Grid (for lands to remove) ─────────────────────
function CutCardGrid({
  cards, onRemove, onPreview, removedCards, excess, onCardAction, menuProps, cardInclusionMap,
}: {
  cards: AnalyzedCard[];
  onRemove: (card: ScryfallCard) => void;
  onPreview: (name: string) => void;
  removedCards: Set<string>;
  excess: number;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
  cardInclusionMap?: Record<string, number>;
}) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {cards.map((ac, i) => (
        <CutCardItem
          key={ac.card.name}
          ac={ac}
          removed={removedCards.has(ac.card.name)}
          highlighted={excess > 0 && i < excess && !removedCards.has(ac.card.name)}
          onRemove={onRemove}
          onPreview={onPreview}
          onCardAction={onCardAction}
          menuProps={menuProps}
          cardInclusionMap={cardInclusionMap}
        />
      ))}
    </div>
  );
}

function CutCardItem({
  ac, removed, highlighted, onRemove, onPreview, onCardAction, menuProps, cardInclusionMap,
}: {
  ac: AnalyzedCard;
  removed: boolean;
  highlighted: boolean;
  onRemove: (card: ScryfallCard) => void;
  onPreview: (name: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
  cardInclusionMap?: Record<string, number>;
}) {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const rawInclusion = ac.inclusion ?? cardInclusionMap?.[ac.card.name] ?? null;
  const pct = rawInclusion != null ? Math.round(rawInclusion) : null;
  const price = getCardPrice(ac.card);
  const imgUrl = ac.card.image_uris?.normal
    || ac.card.card_faces?.[0]?.image_uris?.normal
    || scryfallImg(ac.card.name, 'normal');

  return (
    <div
      className={`group ${removed ? 'opacity-40' : ''}`}
      onContextMenu={(e) => {
        if (onCardAction && menuProps) {
          e.preventDefault();
          setContextMenuOpen(true);
        }
      }}
    >
      <button
        type="button"
        onClick={() => !removed && onPreview(ac.card.name)}
        className="w-full text-left relative"
        disabled={removed}
      >
        <img
          src={imgUrl}
          alt={ac.card.name}
          className={`w-full rounded-lg shadow ${highlighted ? 'border border-red-500/60' : ''}`}
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).src = scryfallImg(ac.card.name, 'normal'); }}
        />
        {highlighted && (
          <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[8px] font-bold uppercase tracking-wider px-1.5 py-px rounded-full bg-red-600 text-white shadow whitespace-nowrap">
            Recommended Cut
          </span>
        )}
        {/* Remove button overlay */}
        {!removed ? (
          <span
            onClick={(e) => { e.stopPropagation(); onRemove(ac.card); }}
            className="absolute top-0 left-0 rounded-tl-lg rounded-br-lg bg-red-900/70 hover:bg-red-900/90 text-white p-2 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
            title="Remove from deck"
          >
            <Minus className="w-5 h-5" />
          </span>
        ) : (
          <span className="absolute top-0 left-0 rounded-tl-lg rounded-br-lg bg-black/60 text-white p-2">
            <Check className="w-5 h-5" />
          </span>
        )}
        {/* Context menu */}
        {onCardAction && menuProps && (
          <span className={`absolute top-1 right-1 z-10 transition-opacity ${contextMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} onClick={(e) => e.stopPropagation()}>
            <CardContextMenu
              card={ac.card}
              onAction={onCardAction}
              hasRemove
              hasSideboard
              hasMaybeboard
              isInSideboard={menuProps.sideboardNames.has(ac.card.name)}
              isInMaybeboard={menuProps.maybeboardNames.has(ac.card.name)}
              userLists={menuProps.userLists}
              isMustInclude={menuProps.mustIncludeNames.has(ac.card.name)}
              isBanned={menuProps.bannedNames.has(ac.card.name)}
              forceOpen={contextMenuOpen}
              onForceClose={() => setContextMenuOpen(false)}
            />
          </span>
        )}
      </button>
      {/* Row 1: inclusion, name, price */}
      <div className="flex items-center gap-1 px-1 -mt-0.5 min-w-0">
        <span
          className="text-[10px] font-bold tabular-nums shrink-0"
          style={{ color: pct ? `hsl(${Math.min(pct / 50, 1) * 120}, 70%, 55%)` : undefined }}
        >
          {pct ?? '?'}%
        </span>
        <span className="text-[11px] truncate flex-1 min-w-0 text-muted-foreground text-center">{ac.card.name}</span>
        {price && (
          <span className="text-[10px] text-muted-foreground/60 shrink-0">${price}</span>
        )}
      </div>
    </div>
  );
}

// ─── Shared: Suggestion Row (for recommended cards) ──────────────────
function SuggestionRow({ card, onAdd, onPreview, added }: {
  card: RecommendedCard;
  onAdd: () => void;
  onPreview: () => void;
  added: boolean;
}) {
  // Show all role badges for multi-role cards, fall back to single role
  const roleBadges = card.allRoleLabels && card.allRoleLabels.length > 1
    ? card.allRoleLabels
    : card.roleLabel ? [card.roleLabel] : [];

  return (
    <div
      className={`flex items-center gap-2 py-0.5 px-1.5 rounded-lg border transition-colors ${
        added ? 'opacity-40 border-transparent' : 'border-transparent hover:bg-accent/40 cursor-pointer'
      }`}
      onClick={added ? undefined : onPreview}
    >
      <img
        src={card.imageUrl || scryfallImg(card.name)}
        alt={card.name}
        className="w-6 h-auto rounded shadow shrink-0"
        loading="lazy"
        onError={(e) => { (e.target as HTMLImageElement).src = scryfallImg(card.name); }}
      />
      <span className="text-sm truncate flex-1 min-w-0">{card.name}</span>
      {roleBadges.length > 0 && (
        <span className="flex items-center gap-0.5 shrink-0">
          {roleBadges.map(label => {
            const badgeColor = ROLE_BADGE_COLORS[label];
            return badgeColor ? (
              <span key={label} className={`text-[10px] font-bold px-1 py-px rounded-full ${badgeColor}`}>
                {label}
              </span>
            ) : null;
          })}
        </span>
      )}
      <span className="text-xs text-muted-foreground shrink-0">{card.price ? `$${card.price}` : '—'}</span>
      <span className="text-xs text-muted-foreground tabular-nums shrink-0">{Math.round(card.inclusion)}%</span>
      {!added ? (
        <button
          onClick={(e) => { e.stopPropagation(); onAdd(); }}
          className="p-0.5 rounded-md text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors shrink-0"
          title="Add to deck"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      ) : (
        <span className="p-0.5 text-emerald-400 shrink-0"><Check className="w-3.5 h-3.5" /></span>
      )}
    </div>
  );
}

// ─── Overview: Deck Health Strip ───────────────────────────────────

const HEALTH_GRADE_STYLES: Record<string, { color: string; badgeBg: string }> = {
  A: { color: 'text-emerald-400', badgeBg: 'bg-emerald-500/15' },
  B: { color: 'text-sky-400', badgeBg: 'bg-sky-500/15' },
  C: { color: 'text-amber-400', badgeBg: 'bg-amber-500/15' },
  D: { color: 'text-orange-400', badgeBg: 'bg-orange-500/15' },
  F: { color: 'text-red-400', badgeBg: 'bg-red-500/15' },
};

function DeckHealthStrip({ analysis, onNavigate }: {
  analysis: DeckAnalysis;
  onNavigate: (tab: TabKey) => void;
}) {
  const grades: { key: TabKey; label: string; icon: typeof Shield; grade: GradeResult }[] = [
    { key: 'roles', label: 'Roles', icon: Shield, grade: analysis.rolesGrade },
    { key: 'lands', label: 'Mana', icon: Mountain, grade: analysis.manaGrade },
    { key: 'curve', label: 'Curve', icon: BarChart3, grade: analysis.curveGrade },
  ];

  const summary = getDeckSummary(analysis);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {grades.map(({ key, label, icon: Icon, grade }) => {
          const style = HEALTH_GRADE_STYLES[grade.letter] || HEALTH_GRADE_STYLES.C;
          return (
            <button
              key={key}
              onClick={() => onNavigate(key)}
              className="bg-card/60 border border-border/30 rounded-lg p-2.5 sm:p-3 text-left hover:bg-accent/40 transition-all cursor-pointer group"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-lg sm:text-xl font-bold ${style.color} ${style.badgeBg} px-2 py-0.5 rounded`}>{grade.letter}</span>
                <div className="flex items-center gap-1">
                  <Icon className={`w-3.5 h-3.5 ${style.color} opacity-70`} />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">{label}</span>
                </div>
              </div>
              <p className="text-xs leading-snug text-muted-foreground line-clamp-2">{grade.message}</p>
            </button>
          );
        })}
      </div>
      <div className="bg-card/60 border border-border/30 rounded-lg p-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Summary</span>
        <p className="text-xs text-muted-foreground leading-relaxed mt-1">{summary}</p>
      </div>
    </div>
  );
}

// ─── Overview Panel: Role Balance ──────────────────────────────────
function RoleBalancePanel({ deficits, hasDeficits, onNavigate }: { deficits: DeckAnalysis['roleDeficits']; hasDeficits: boolean; onNavigate?: () => void }) {
  const totalDeficit = deficits.reduce((sum, rd) => sum + Math.max(0, rd.deficit), 0);
  const rolesShort = deficits.filter(rd => rd.deficit > 0).length;

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2.5">
        <button onClick={onNavigate} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer">Roles</button>
        <span className={`text-[10px] font-bold px-1.5 py-px rounded-full ml-auto ${
          !hasDeficits ? 'bg-emerald-500/15 text-emerald-400'
            : rolesShort >= 3 ? 'bg-red-500/15 text-red-400'
            : 'bg-amber-500/15 text-amber-400'
        }`}>
          {!hasDeficits ? 'ON TARGET' : `${totalDeficit} SHORT`}
        </span>
      </div>
      <div className="space-y-2">
        {deficits.map(rd => {
          const pct = rd.target > 0 ? Math.min(100, (rd.current / rd.target) * 100) : 100;
          const meta = ROLE_META[rd.role];
          const Icon = meta?.icon || Shield;
          return (
            <div key={rd.role}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                <span className="text-xs font-medium truncate">{rd.label}</span>
                <span className="text-xs font-bold tabular-nums shrink-0 ml-auto" style={{ color: roleBarColor(rd.current, rd.target) }}>
                  {rd.current}/{rd.target}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-accent/40 overflow-hidden mb-2.5">
                <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${pct}%`, backgroundColor: roleBarColor(rd.current, rd.target) }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Overview Panel: Mana Curve ────────────────────────────────────
type CurveMode = 'line' | 'bar';

function CurvePanel({ slots, tall, onNavigate }: { slots: DeckAnalysis['curveAnalysis']; tall?: boolean; onNavigate?: () => void }) {
  const [mode, setMode] = useState<CurveMode>('line');
  const maxVal = Math.max(...slots.flatMap(s => [s.current, s.target]), 1);

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg p-3 flex flex-col">
      <div className="flex items-center gap-1.5 mb-2 shrink-0">
        <button onClick={onNavigate} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer">Mana Curve</button>
        <span className="text-[11px] text-muted-foreground/50 ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-sm bg-muted-foreground/20 inline-block" />avg</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-sm bg-sky-500/70 inline-block" />you</span>
          <button
            onClick={() => setMode(m => m === 'line' ? 'bar' : 'line')}
            className="ml-1 p-0.5 rounded text-foreground hover:text-foreground transition-colors"
            title={mode === 'line' ? 'Switch to bar chart' : 'Switch to line chart'}
          >
            {mode === 'line' ? <BarChart3 className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
          </button>
        </span>
      </div>
      {mode === 'line'
        ? <CurveLineChart slots={slots} maxVal={maxVal} tall={tall} />
        : <CurveBarChart slots={slots} maxVal={maxVal} tall={tall} />
      }
    </div>
  );
}

function CurveLineChart({ slots, maxVal, tall }: { slots: DeckAnalysis['curveAnalysis']; maxVal: number; tall?: boolean }) {
  const chartH = tall ? 100 : 44;
  const padTop = 16;   // room for value labels above dots
  const padBot = 16;   // room for CMC labels below
  const svgH = chartH + padTop + padBot;
  const padL = 8;
  const padR = 8;
  const viewW = 200;
  const plotW = viewW - padL - padR;
  const n = slots.length;
  const step = n > 1 ? plotW / (n - 1) : 0;

  const toY = (val: number) => padTop + chartH - (maxVal > 0 ? (val / maxVal) * chartH : 0);

  const yourPoints = slots.map((s, i) => ({ x: padL + i * step, y: toY(s.current), ...s }));
  const avgPoints = slots.map((s, i) => ({ x: padL + i * step, y: toY(s.target), ...s }));

  // Straight line path through points
  const toLinePath = (pts: { x: number; y: number }[]) => {
    if (pts.length === 0) return '';
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  };

  const yourPath = toLinePath(yourPoints);
  const avgPath = toLinePath(avgPoints);

  // Filled area under the "you" line
  const yourArea = yourPoints.length > 0
    ? `${yourPath} L${yourPoints[yourPoints.length - 1].x},${padTop + chartH} L${yourPoints[0].x},${padTop + chartH} Z`
    : '';

  const svgHeight = tall ? 130 : 70;

  return (
    <svg
      viewBox={`0 0 ${viewW} ${svgH}`}
      className="w-full flex-1"
      style={{ height: svgHeight, minHeight: svgHeight }}
      preserveAspectRatio="none"
    >
      {/* Horizontal grid lines */}
      {[0.25, 0.5, 0.75].map(frac => {
        const y = padTop + chartH - frac * chartH;
        return <line key={frac} x1={padL} x2={viewW - padR} y1={y} y2={y} stroke="currentColor" className="text-border/20" strokeWidth={0.4} />;
      })}
      {/* Baseline */}
      <line x1={padL} x2={viewW - padR} y1={padTop + chartH} y2={padTop + chartH} stroke="currentColor" className="text-border/30" strokeWidth={0.4} />

      {/* Filled area under "you" line (only in tall/detail mode) */}
      {tall && yourArea && <path d={yourArea} className="fill-sky-500/8" />}

      {/* Avg line (dashed) */}
      <path d={avgPath} fill="none" stroke="currentColor" className="text-muted-foreground/20" strokeWidth={1} strokeDasharray="3 2" />

      {/* Your line */}
      <path d={yourPath} fill="none" stroke="currentColor" className="text-sky-500" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />

      {/* Dots + labels */}
      {yourPoints.map((p, i) => {
        const isOver = p.current > p.target;
        const isUnder = p.current < p.target;
        const dotColor = isOver ? 'text-amber-500' : isUnder ? 'text-sky-400' : 'text-emerald-400';
        const labelColor = isOver ? 'fill-amber-400' : isUnder ? 'fill-sky-400' : 'fill-emerald-400';
        return (
          <g key={i}>
            {/* Avg dot */}
            <circle cx={avgPoints[i].x} cy={avgPoints[i].y} r={1.2} fill="currentColor" className="text-muted-foreground/25" />
            {/* Your dot */}
            <circle cx={p.x} cy={p.y} r={2.2} fill="currentColor" className={dotColor} />
            {/* Value label above dot */}
            {p.current > 0 && (
              <text x={p.x} y={p.y - 5} textAnchor="middle" className="text-[7px] font-semibold tabular-nums">
                <tspan className={labelColor}>{p.current}</tspan>
                {p.target > 0 && p.current !== p.target && (
                  <tspan className="fill-muted-foreground/40">{' '}(~{p.target})</tspan>
                )}
              </text>
            )}
            {/* CMC label below */}
            <text x={p.x} y={padTop + chartH + 11} textAnchor="middle" className="text-[8px] fill-muted-foreground/50 tabular-nums">
              {p.cmc === 7 ? '7+' : p.cmc}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function CurveBarChart({ slots, maxVal, tall }: { slots: DeckAnalysis['curveAnalysis']; maxVal: number; tall?: boolean }) {
  const barAreaH = tall ? 100 : 60;

  return (
    <div className="flex items-end gap-1" style={{ height: barAreaH + 30 }}>
      {slots.map(slot => {
        const curH = Math.max(2, (slot.current / maxVal) * 100);
        const tgtH = Math.max(2, (slot.target / maxVal) * 100);
        const isOver = slot.current > slot.target;
        const isUnder = slot.current < slot.target;

        return (
          <div key={slot.cmc} className="flex-1 flex flex-col items-center h-full">
            <div className="flex gap-px text-[10px] tabular-nums h-5 items-end justify-center shrink-0">
              {slot.current > 0 && (
                <span className={isOver ? 'text-amber-400' : isUnder ? 'text-sky-400' : 'text-emerald-400'}>{slot.current}</span>
              )}
              {slot.current > 0 && slot.target > 0 && slot.current !== slot.target && (
                <span className="text-muted-foreground/40">(~{slot.target})</span>
              )}
            </div>
            <div className="relative w-full flex items-end justify-center gap-px" style={{ height: barAreaH }}>
              <div
                className="w-[38%] rounded-t-sm bg-muted-foreground/15"
                style={{ height: `${tgtH * 0.8}%`, minHeight: '2px' }}
                title={`EDHREC avg: ${slot.target}`}
              />
              <div
                className={`w-[38%] rounded-t-sm ${isOver ? 'bg-amber-500/80' : isUnder ? 'bg-sky-500/70' : 'bg-emerald-500/70'}`}
                style={{ height: `${curH * 0.8}%`, minHeight: '2px' }}
                title={`You: ${slot.current}`}
              />
            </div>
            <span className="text-[11px] text-muted-foreground/60 tabular-nums mt-0.5 shrink-0">{slot.cmc === 7 ? '7+' : slot.cmc}</span>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// LANDS TAB Components
// ═══════════════════════════════════════════════════════════════════════

type LandSection = 'landCount' | 'manaSources' | 'fixing' | 'mdfc';


function getMdfcGrade(count: number): { letter: string; color: string } {
  if (count >= 6) return { letter: 'A', color: 'text-emerald-400' };
  if (count >= 3) return { letter: 'B', color: 'text-sky-400' };
  if (count >= 1) return { letter: 'C', color: 'text-amber-400' };
  return { letter: 'F', color: 'text-red-400' };
}

function LandSummaryStrip({
  analysis, activeSection, onSectionClick, mdfcInDeckCount, channelLandCount,
}: {
  analysis: DeckAnalysis;
  activeSection: LandSection | null;
  onSectionClick: (section: LandSection) => void;
  mdfcInDeckCount: number;
  channelLandCount: number;
}) {
  const mb = analysis.manaBase;
  const cf = analysis.colorFixing;
  const coveredColors = cf.colorsNeeded.filter(c => (cf.sourcesPerColor[c] || 0) >= 5).length;
  const totalColors = cf.colorsNeeded.length;

  const landGrade = getManaBaseGrade(mb);
  const ms = analysis.manaSources;
  const sourceGradeColor = (FIXING_GRADE_STYLES[ms.grade] || FIXING_GRADE_STYLES.C).color;
  const fixGrade = cf.fixingGrade || 'C';
  const fixColor = (FIXING_GRADE_STYLES[fixGrade] || FIXING_GRADE_STYLES.C).color;
  const flexCount = mdfcInDeckCount + channelLandCount;
  const mdfcGrade = getMdfcGrade(flexCount);

  const tileGradeStyles = (letter: string) => FIXING_GRADE_STYLES[letter] || FIXING_GRADE_STYLES.C;

  const tiles: { key: LandSection; icon: typeof Mountain; label: string; value: number; sub: string; grade: string; gradeColor: string; gradeBg: string; gradeBadgeBg: string }[] = [
    {
      key: 'landCount', icon: Mountain, label: 'Land Count',
      value: mb.currentLands,
      sub: `of ${mb.adjustedSuggestion} suggested`,
      grade: landGrade.letter, gradeColor: landGrade.color,
      gradeBg: tileGradeStyles(landGrade.letter).bg,
      gradeBadgeBg: tileGradeStyles(landGrade.letter).bgColor,
    },
    {
      key: 'manaSources', icon: TrendingUp, label: 'Mana Production',
      value: ms.totalRamp,
      sub: `${ms.producers} producers · ${ms.earlyRamp} early`,
      grade: ms.grade, gradeColor: sourceGradeColor,
      gradeBg: tileGradeStyles(ms.grade).bg,
      gradeBadgeBg: tileGradeStyles(ms.grade).bgColor,
    },
    {
      key: 'fixing', icon: Palette, label: 'Color Fixing',
      value: cf.fixingLands.length + cf.manaFixCards.length,
      sub: totalColors > 0 ? `${coveredColors}/${totalColors} colors covered` : 'colorless deck',
      grade: totalColors > 0 ? fixGrade : '-', gradeColor: totalColors > 0 ? fixColor : 'text-muted-foreground',
      gradeBg: totalColors > 0 ? tileGradeStyles(fixGrade).bg : '',
      gradeBadgeBg: totalColors > 0 ? tileGradeStyles(fixGrade).bgColor : '',
    },
    {
      key: 'mdfc', icon: FlipHorizontal2, label: 'Flex Lands',
      value: flexCount,
      sub: channelLandCount > 0 && mdfcInDeckCount > 0
        ? `${mdfcInDeckCount} MDFC · ${channelLandCount} channel`
        : flexCount >= 3 ? 'good flexibility' : flexCount > 0 ? 'room to add more' : 'none yet',
      grade: mdfcGrade.letter, gradeColor: mdfcGrade.color,
      gradeBg: tileGradeStyles(mdfcGrade.letter).bg,
      gradeBadgeBg: tileGradeStyles(mdfcGrade.letter).bgColor,
    },
  ];

  return (
    <div className="-mx-3 sm:-mx-4 -mt-3 sm:-mt-4 grid grid-cols-2 sm:grid-cols-4 border-b border-border/30">
      {tiles.map((tile, i) => {
        const Icon = tile.icon;
        const isActive = activeSection === tile.key;
        return (
          <button
            key={tile.key}
            onClick={() => onSectionClick(tile.key)}
            className={`p-2.5 text-left transition-all hover:bg-card/80 ${
              i % 2 !== 0 ? 'border-l border-l-border/30' : ''
            } ${i < 2 ? 'border-b border-b-border/30 sm:border-b-0' : ''} ${
              i > 0 ? 'sm:border-l sm:border-l-border/30' : ''
            } ${isActive ? tile.gradeBg : ''}`}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <Icon className={`w-4 h-4 ${isActive ? tile.gradeColor : 'text-muted-foreground'}`} />
              <span className={`text-xs font-semibold uppercase tracking-wider truncate ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>{tile.label}</span>
              <span className={`text-sm font-black ml-auto px-1.5 py-0.5 rounded ${tile.gradeColor} ${tile.gradeBadgeBg}`}>{tile.grade}</span>
            </div>
            <div className="flex items-baseline gap-1.5 mb-1.5">
              <span className={`text-xl font-bold tabular-nums leading-none ${tile.gradeColor}`}>
                {tile.value}
              </span>
              <span className="text-xs text-muted-foreground/60 truncate">{tile.sub}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Grade Info Popover ──────────────────────────────────────────
function GradeInfoPopover({ children }: { children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className="ml-auto p-0.5 rounded hover:bg-accent/60 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          title="How this is graded"
        >
          <Info className="w-3 h-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-72 p-3 text-xs text-muted-foreground leading-relaxed space-y-2" onClick={(e) => e.stopPropagation()}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

// ─── Land Count Detail Panel ──────────────────────────────────────
function getManaBaseGrade(mb: ManaBaseAnalysis): { letter: string; color: string; bgColor: string } {
  const sweetSpot = mb.probLand2to3;
  if (mb.verdict === 'ok' && sweetSpot >= 0.48) return { letter: 'A', color: 'text-emerald-400', bgColor: 'bg-emerald-500/15' };
  if (mb.verdict === 'ok' || (mb.verdict === 'slightly-low' && sweetSpot >= 0.45)) return { letter: 'B', color: 'text-sky-400', bgColor: 'bg-sky-500/15' };
  if (mb.verdict === 'slightly-low' || mb.verdict === 'high') return { letter: 'C', color: 'text-amber-400', bgColor: 'bg-amber-500/15' };
  if (mb.verdict === 'low') return { letter: 'D', color: 'text-orange-400', bgColor: 'bg-orange-500/15' };
  return { letter: 'F', color: 'text-red-400', bgColor: 'bg-red-500/15' };
}

function getMdfcStatus(count: number): {
  label: string; color: string; bgColor: string;
  border: string; bg: string; titleColor: string; message: string;
} {
  if (count === 0) return {
    label: 'NONE', color: 'text-amber-400', bgColor: 'bg-amber-500/15',
    border: 'border-amber-500/40', bg: 'bg-amber-500/10', titleColor: 'text-amber-400',
    message: 'No MDFC spell/lands yet. MDFCs act as both a spell and a land, reducing flood risk while still providing action.',
  };
  if (count <= 2) return {
    label: 'FEW', color: 'text-amber-400', bgColor: 'bg-amber-500/15',
    border: 'border-amber-500/30', bg: 'bg-amber-500/5', titleColor: 'text-amber-400/80',
    message: `${count} MDFC${count > 1 ? 's' : ''} in your deck. Running 3–6 MDFCs gives noticeably better consistency.`,
  };
  if (count <= 5) return {
    label: 'GOOD', color: 'text-emerald-400', bgColor: 'bg-emerald-500/15',
    border: 'border-emerald-500/30', bg: 'bg-emerald-500/5', titleColor: 'text-emerald-400',
    message: `${count} MDFCs — solid flexibility without feeling forced.`,
  };
  return {
    label: 'GREAT', color: 'text-sky-400', bgColor: 'bg-sky-500/15',
    border: 'border-sky-500/30', bg: 'bg-sky-500/5', titleColor: 'text-sky-400',
    message: `${count} MDFCs — excellent flexibility. Every one replaces a dead land draw with a live spell.`,
  };
}


function LandRatingSummary({ analysis }: { analysis: DeckAnalysis }) {
  const [expanded, setExpanded] = useState(true);
  const mb = analysis.manaBase;
  const vs = VERDICT_STYLES[mb.verdict] || VERDICT_STYLES['ok'];
  const grade = getManaBaseGrade(mb);

  const avgLands = mb.deckSize ? 7 * (mb.currentLands / mb.deckSize) : 0;
  const segments = [
    { label: '0', pct: mb.probLand0, color: 'bg-red-500', text: 'text-red-400' },
    { label: '1', pct: mb.probLand1, color: 'bg-amber-500', text: 'text-amber-400' },
    { label: '2-3', pct: mb.probLand2to3, color: 'bg-emerald-500', text: 'text-emerald-400' },
    { label: '4+', pct: mb.probLand4plus, color: 'bg-sky-500', text: 'text-sky-400' },
  ];

  return (
    <div className="-mx-3 sm:-mx-4 -mt-3 px-3 sm:px-4 pt-3 pb-3 space-y-3 border-b border-border/30">
      <div
        role="button"
        tabIndex={0}
        className="w-full text-[11px] font-semibold uppercase tracking-wider text-foreground/60 px-0.5 flex items-center gap-1 hover:text-foreground/80 transition-colors cursor-pointer select-none"
        onClick={() => setExpanded(prev => !prev)}
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
        <Mountain className="w-3 h-3" />
        Summary
        <GradeInfoPopover>
          <p className="font-semibold text-foreground/80">Land Count Grading</p>
          <p>Suggested count uses EDHREC average, adjusted up if ramp is weak (+1 decent, +2 low), floored at 33% of deck size.</p>
          <p><span className="font-semibold text-emerald-400">A</span> — On target with ≥48% chance of 2–3 lands in opening hand</p>
          <p><span className="font-semibold text-sky-400">B</span> — On target, or slightly low with ≥45% sweet spot</p>
          <p><span className="font-semibold text-amber-400">C</span> — Slightly low or slightly high</p>
          <p><span className="font-semibold text-orange-400">D</span> — Noticeably below suggestion (3+ lands short)</p>
          <p><span className="font-semibold text-red-400">F</span> — Critically low (below 33% of deck size)</p>
        </GradeInfoPopover>
      </div>
      {expanded && <>
        <div className={`border rounded-lg p-2.5 ${vs.border} ${vs.bg}`}>
          <div className="flex items-center gap-3">
            <div className={`flex items-center justify-center w-12 h-12 rounded-lg ${grade.bgColor} shrink-0`}>
              <span className={`text-2xl font-black leading-none ${grade.color}`}>{grade.letter}</span>
            </div>
            <div className="flex-1 min-w-0 flex items-center justify-center">
              <p className="text-sm text-muted-foreground leading-snug text-center">{mb.verdictMessage}</p>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Opening Hand</p>
            <p className="text-[11px] text-muted-foreground/70">avg <span className="font-semibold text-foreground/70">{avgLands.toFixed(1)}</span> lands</p>
          </div>
          <div className="flex gap-1.5">
            {segments.map(seg => {
              const pctNum = Math.round(seg.pct * 100);
              return (
                <div key={seg.label} className="flex flex-col items-center gap-1" style={{ flex: `${Math.max(pctNum, 8)} 0 0` }}>
                  <div className={`w-full h-2.5 rounded-full ${seg.color}`} />
                  <span className={`text-[10px] font-semibold tabular-nums leading-none ${seg.text}`}>{pctNum}%</span>
                  <span className="text-[9px] text-muted-foreground/50 leading-none">{seg.label} lands</span>
                </div>
              );
            })}
          </div>
        </div>
      </>}
    </div>
  );
}

function LandCountDetail({
  analysis, onPreview, onAdd, addedCards, onCardAction, menuProps, colorIdentity, onAddBasicLand, onRemoveBasicLand, cardInclusionMap,
}: {
  analysis: DeckAnalysis;
  onPreview: (name: string) => void;
  onAdd: (name: string) => void;
  addedCards: Set<string>;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
  colorIdentity: string[];
  onAddBasicLand?: (name: string) => void;
  onRemoveBasicLand?: (name: string) => void;
  cardInclusionMap?: Record<string, number>;
}) {
  const mb = analysis.manaBase;
  const hasSuggestions = analysis.landRecommendations.length > 0;
  const isOverTarget = mb.verdict === 'high';
  const excess = Math.max(0, mb.currentLands - mb.adjustedSuggestion);

  // Resolve inclusion map: prop > store > empty
  const storeInclusionMap = useStore(s => s.generatedDeck?.cardInclusionMap);
  const resolvedInclusionMap = cardInclusionMap || storeInclusionMap || {};

  // Split lands into MDFC, nonbasic, and basic groups
  const mdfcLands = analysis.landCards.filter(ac => isMdfcLand(ac.card))
    .sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0));

  const mdfcNames = new Set(mdfcLands.map(ac => ac.card.name));

  const channelLands = analysis.landCards.filter(ac => {
    if (mdfcNames.has(ac.card.name)) return false;
    return isChannelLand(ac.card);
  }).sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0));

  const channelNames = new Set(channelLands.map(ac => ac.card.name));

  const nonbasicLands = analysis.landCards.filter(ac => {
    if (mdfcNames.has(ac.card.name)) return false;
    if (channelNames.has(ac.card.name)) return false;
    const tl = getFrontFaceTypeLine(ac.card).toLowerCase();
    return !/\bbasic\b/.test(tl);
  }).sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0));

  const basicLands = analysis.landCards.filter(ac => {
    const tl = getFrontFaceTypeLine(ac.card).toLowerCase();
    return /\bbasic\b/.test(tl);
  });

  // Cut candidates: nonbasic lands excluding MDFCs and channel lands, sorted by inclusion ascending (weakest first)
  const cutCandidates = useMemo(() => {
    const filtered = nonbasicLands
      .filter(ac => !isChannelLand(ac.card))
      .sort((a, b) =>
        (a.inclusion ?? resolvedInclusionMap[a.card.name] ?? 0) - (b.inclusion ?? resolvedInclusionMap[b.card.name] ?? 0)
      );
    const limit = Math.min(Math.max(excess + 4, 5), 15);
    return filtered.slice(0, limit);
  }, [nonbasicLands, resolvedInclusionMap, excess]);

  const [showCuts, setShowCuts] = useState(isOverTarget);
  const [removedCards, setRemovedCards] = useState<Set<string>>(new Set());

  const handleRemoveCard = useCallback((card: ScryfallCard) => {
    onCardAction?.(card, { type: 'remove' });
    setRemovedCards(prev => new Set([...prev, card.name]));
  }, [onCardAction]);

  const hasRightColumn = hasSuggestions || (isOverTarget && cutCandidates.length > 0);

  // Group basics by name with count, including ×0 entries for all colors in identity
  const COLOR_TO_BASIC: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
  const basicCountMap = new Map<string, number>();
  // Seed with all basics for our color identity (including ×0)
  for (const c of colorIdentity) {
    const name = COLOR_TO_BASIC[c];
    if (name) basicCountMap.set(name, 0);
  }
  // Also seed Wastes for colorless commanders
  if (colorIdentity.length === 0) basicCountMap.set('Wastes', 0);
  for (const ac of basicLands) {
    basicCountMap.set(ac.card.name, (basicCountMap.get(ac.card.name) || 0) + 1);
  }
  const basicGroups = [...basicCountMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const totalBasicCount = basicGroups.reduce((sum, bg) => sum + bg.count, 0);

  const [mdfcOpen, setMdfcOpen] = useState(true);
  const [channelOpen, setChannelOpen] = useState(true);
  const [nonbasicOpen, setNonbasicOpen] = useState(true);
  const [basicOpen, setBasicOpen] = useState(true);

  return (
    <div className="-mx-3 sm:-mx-4 -mb-3 sm:-mb-4 bg-black/15 px-3 sm:px-4 py-3">
      <div className={`${hasRightColumn ? 'flex flex-col md:flex-row md:items-stretch gap-4' : ''}`}>
        {/* Left: rating summary + lands list */}
        <div className={`${hasRightColumn ? 'md:w-[30%] shrink-0' : 'w-full'} space-y-3`}>
              <LandRatingSummary analysis={analysis} />
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400/60 mb-1 px-0.5 flex items-center gap-1">
                <Check className="w-3 h-3" />
                In Your Deck
              </p>

              {/* Current lands list */}
              {analysis.landCards.length > 0 && (
                <div className="space-y-2">
                  {/* MDFC lands */}
                  {mdfcLands.length > 0 && (
                    <div>
                      <button
                        onClick={() => setMdfcOpen(v => !v)}
                        className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
                      >
                        {mdfcOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60">
                          MDFC ({mdfcLands.length})
                        </span>
                      </button>
                      {mdfcOpen && (
                        <div className="space-y-0.5">
                          {mdfcLands.map(ac => (
                            <AnalyzedCardRow
                              key={ac.card.name}
                              ac={ac}
                              onPreview={onPreview}
                              showDetails
                              onCardAction={onCardAction}
                              menuProps={menuProps ? {
                                userLists: menuProps.userLists,
                                isMustInclude: menuProps.mustIncludeNames.has(ac.card.name),
                                isBanned: menuProps.bannedNames.has(ac.card.name),
                                isInSideboard: menuProps.sideboardNames.has(ac.card.name),
                                isInMaybeboard: menuProps.maybeboardNames.has(ac.card.name),
                              } : undefined}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Channel lands */}
                  {channelLands.length > 0 && (
                    <div>
                      <button
                        onClick={() => setChannelOpen(v => !v)}
                        className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
                      >
                        {channelOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60">
                          Channel ({channelLands.length})
                        </span>
                      </button>
                      {channelOpen && (
                        <div className="space-y-0.5">
                          {channelLands.map(ac => (
                            <AnalyzedCardRow
                              key={ac.card.name}
                              ac={ac}
                              onPreview={onPreview}
                              showDetails
                              onCardAction={onCardAction}
                              menuProps={menuProps ? {
                                userLists: menuProps.userLists,
                                isMustInclude: menuProps.mustIncludeNames.has(ac.card.name),
                                isBanned: menuProps.bannedNames.has(ac.card.name),
                                isInSideboard: menuProps.sideboardNames.has(ac.card.name),
                                isInMaybeboard: menuProps.maybeboardNames.has(ac.card.name),
                              } : undefined}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Nonbasic lands */}
                  {nonbasicLands.length > 0 && (
                    <div>
                      <button
                        onClick={() => setNonbasicOpen(v => !v)}
                        className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
                      >
                        {nonbasicOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60">
                          Nonbasic ({nonbasicLands.length})
                        </span>
                      </button>
                      {nonbasicOpen && (
                        <div className="space-y-0.5">
                          {nonbasicLands.map(ac => (
                            <AnalyzedCardRow
                              key={ac.card.name}
                              ac={ac}
                              onPreview={onPreview}
                              showDetails
                              onCardAction={onCardAction}
                              menuProps={menuProps ? {
                                userLists: menuProps.userLists,
                                isMustInclude: menuProps.mustIncludeNames.has(ac.card.name),
                                isBanned: menuProps.bannedNames.has(ac.card.name),
                                isInSideboard: menuProps.sideboardNames.has(ac.card.name),
                                isInMaybeboard: menuProps.maybeboardNames.has(ac.card.name),
                              } : undefined}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Basic lands */}
                  {basicGroups.length > 0 && (
                    <div>
                      <button
                        onClick={() => setBasicOpen(v => !v)}
                        className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
                      >
                        {basicOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60">
                          Basic ({totalBasicCount})
                        </span>
                      </button>
                      {basicOpen && (
                        <div className="space-y-0.5">
                          {basicGroups.map(bg => (
                            <div
                              key={bg.name}
                              className={`flex items-center gap-2 py-1 px-1.5 rounded-lg transition-colors ${bg.count === 0 ? 'opacity-40' : 'cursor-pointer hover:bg-accent/40'}`}
                              onClick={() => bg.count > 0 && onPreview(bg.name)}
                            >
                              <img
                                src={scryfallImg(bg.name)}
                                alt={bg.name}
                                className="w-10 h-auto rounded shadow shrink-0"
                                loading="lazy"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                              <div className="flex-1 min-w-0">
                                <span className="text-sm truncate block">{bg.name}</span>
                                <span className="text-[10px] text-muted-foreground/60">Land — Basic</span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                                <button
                                  className="w-5 h-5 flex items-center justify-center rounded bg-accent/40 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                                  disabled={bg.count === 0}
                                  onClick={() => onRemoveBasicLand?.(bg.name)}
                                  title={`Remove a ${bg.name}`}
                                >
                                  <Minus className="w-3 h-3" />
                                </button>
                                <span className="text-xs tabular-nums w-5 text-center font-medium">{bg.count}</span>
                                <button
                                  className="w-5 h-5 flex items-center justify-center rounded bg-accent/40 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                                  onClick={() => onAddBasicLand?.(bg.name)}
                                  title={`Add a ${bg.name}`}
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Recently added from suggestions */}
              {(() => {
                const existingNames = new Set(analysis.landCards.map(ac => ac.card.name));
                const landRecNames = new Set(analysis.landRecommendations.map(r => r.name));
                const recentlyAdded = [...addedCards].filter(n => !existingNames.has(n) && landRecNames.has(n));
                if (recentlyAdded.length === 0) return null;
                return (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/60 mb-0.5 px-0.5 flex items-center gap-1">
                      <Plus className="w-2.5 h-2.5" />
                      Recently Added ({recentlyAdded.length})
                    </p>
                    <div className="space-y-0.5">
                      {recentlyAdded.map(name => (
                        <div
                          key={name}
                          className="flex items-center gap-2 py-1 px-1.5 rounded-lg cursor-pointer hover:bg-accent/40 transition-colors"
                          onClick={() => onPreview(name)}
                        >
                          <img
                            src={scryfallImg(name)}
                            alt={name}
                            className="w-10 h-auto rounded shadow shrink-0"
                            loading="lazy"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                          <span className="text-sm truncate flex-1 min-w-0">{name}</span>
                          <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-emerald-500/15 text-emerald-400 shrink-0">NEW</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
        </div>

        {/* Vertical divider */}
        {(hasSuggestions || (isOverTarget && cutCandidates.length > 0)) && <div className="hidden md:block w-px bg-border/30 shrink-0 -my-3" />}

        {/* Right: cut candidates or land suggestions */}
        {(hasSuggestions || (isOverTarget && cutCandidates.length > 0)) && (
          <div className="flex-1 min-w-0">
            {showCuts && cutCandidates.length > 0 ? (
              <>
                <div className="flex items-center gap-2 mb-2 px-0.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-red-400 flex items-center gap-1">
                    <Scissors className="w-3 h-3" />
                    Lands to Cut ({cutCandidates.length})
                  </p>
                  <span className="text-[9px] text-muted-foreground/40 ml-1">sorted by inclusion %</span>
                  {hasSuggestions && (
                    <button
                      onClick={() => setShowCuts(false)}
                      className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      View suggestions →
                    </button>
                  )}
                </div>
                <CutCardGrid
                  cards={cutCandidates}
                  onRemove={handleRemoveCard}
                  onPreview={onPreview}
                  removedCards={removedCards}
                  excess={excess}
                  onCardAction={onCardAction}
                  menuProps={menuProps}
                  cardInclusionMap={resolvedInclusionMap}
                />
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-2 px-0.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    Suggested Lands ({analysis.landRecommendations.length})
                  </p>
                  {isOverTarget && cutCandidates.length > 0 && (
                    <button
                      onClick={() => setShowCuts(true)}
                      className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      View cut candidates →
                    </button>
                  )}
                </div>
                <SuggestionCardGrid
                  cards={analysis.landRecommendations}
                  onAdd={onAdd}
                  onPreview={onPreview}
                  addedCards={addedCards}
                  deficit={Math.max(0, mb.adjustedSuggestion - mb.currentLands)}
                  onCardAction={onCardAction}
                  menuProps={menuProps}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Mana Production Detail Panel ───────────────────────────────────
function ManaSourcesSummary({ ms }: { ms: ManaSourcesAnalysis }) {
  const [expanded, setExpanded] = useState(true);
  const gs = FIXING_GRADE_STYLES[ms.grade] || FIXING_GRADE_STYLES.C;

  return (
    <div className="-mx-3 sm:-mx-4 -mt-3 px-3 sm:px-4 pt-3 pb-3 space-y-3 border-b border-border/30">
      <div
        role="button"
        tabIndex={0}
        className="w-full text-[11px] font-semibold uppercase tracking-wider text-foreground/60 px-0.5 flex items-center gap-1 hover:text-foreground/80 transition-colors cursor-pointer select-none"
        onClick={() => setExpanded(prev => !prev)}
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
        <TrendingUp className="w-3 h-3" />
        Summary
        <GradeInfoPopover>
          <p className="font-semibold text-foreground/80">Mana Production Grading</p>
          <p>Evaluates ramp count, early-game availability (CMC ≤ 2), and how many are mana producers (dorks/rocks).</p>
          <p><span className="font-semibold text-emerald-400">A</span> — 10+ ramp, 5+ early, 6+ producers</p>
          <p><span className="font-semibold text-sky-400">B</span> — 8+ ramp, 3+ early, 4+ producers</p>
          <p><span className="font-semibold text-amber-400">C</span> — 6+ ramp total</p>
          <p><span className="font-semibold text-orange-400">D</span> — 4+ ramp total</p>
          <p><span className="font-semibold text-red-400">F</span> — Fewer than 4 ramp cards</p>
        </GradeInfoPopover>
      </div>
      {expanded && <>
        <div className={`border rounded-lg p-2.5 ${gs.border} ${gs.bg}`}>
          <div className="flex items-center gap-3">
            <div className={`flex items-center justify-center w-12 h-12 rounded-lg ${gs.bgColor} shrink-0`}>
              <span className={`text-2xl font-black leading-none ${gs.color}`}>{ms.grade}</span>
            </div>
            <div className="flex-1 min-w-0 flex items-center justify-center">
              <p className="text-sm text-muted-foreground leading-snug text-center">{ms.message}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70 px-0.5">
          <span>{ms.earlyRamp} early <span className="text-muted-foreground/40">(CMC ≤ 2)</span></span>
          <span className="text-border">·</span>
          <span>avg ramp cost <span className="font-semibold text-foreground/60">{ms.avgRampCmc.toFixed(1)}</span></span>
        </div>
      </>}
    </div>
  );
}

function ManaSourcesDetail({
  analysis, onPreview, onAdd, addedCards, onCardAction, menuProps,
}: {
  analysis: DeckAnalysis;
  onPreview: (name: string) => void;
  onAdd: (name: string) => void;
  addedCards: Set<string>;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
}) {
  // Group ramp cards by subtype
  const groups: { key: string; label: string; cards: AnalyzedCard[] }[] = [];
  const dorks = analysis.rampCards.filter(ac => ac.card.rampSubtype === 'mana-producer');
  const rocks = analysis.rampCards.filter(ac => ac.card.rampSubtype === 'mana-rock');
  const reducers = analysis.rampCards.filter(ac => ac.card.rampSubtype === 'cost-reducer');
  const otherRamp = analysis.rampCards.filter(ac =>
    ac.card.rampSubtype !== 'mana-producer' && ac.card.rampSubtype !== 'mana-rock' && ac.card.rampSubtype !== 'cost-reducer'
  );
  if (dorks.length > 0) groups.push({ key: 'dorks', label: 'Mana Dorks', cards: dorks });
  if (rocks.length > 0) groups.push({ key: 'rocks', label: 'Mana Rocks', cards: rocks });
  if (reducers.length > 0) groups.push({ key: 'reducers', label: 'Cost Reducers', cards: reducers });
  if (otherRamp.length > 0) groups.push({ key: 'other', label: 'Other Ramp', cards: otherRamp });

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map(g => [g.key, true]))
  );
  const toggleGroup = (key: string) => setOpenGroups(prev => ({ ...prev, [key]: !prev[key] }));

  // Get ramp suggestions from role breakdowns
  const rampRb = analysis.roleBreakdowns.find(rb => rb.role === 'ramp');
  const rampSuggestions = rampRb?.suggestedReplacements || [];
  const hasSuggestions = rampSuggestions.length > 0;

  return (
    <div className="-mx-3 sm:-mx-4 -mb-3 sm:-mb-4 bg-black/15 px-3 sm:px-4 py-3">
      <div className={`${hasSuggestions ? 'flex flex-col md:flex-row md:items-stretch gap-4' : ''}`}>
        {/* Left: summary + ramp cards grouped */}
        <div className={`${hasSuggestions ? 'md:w-[30%] shrink-0' : 'w-full'} space-y-3`}>
          <ManaSourcesSummary ms={analysis.manaSources} />
          {groups.length > 0 ? groups.map(g => (
            <div key={g.key}>
              <button
                onClick={() => toggleGroup(g.key)}
                className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
              >
                {openGroups[g.key] !== false ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60">
                  {g.label} ({g.cards.length})
                </span>
              </button>
              {openGroups[g.key] !== false && (
                <div className="space-y-0.5">
                  {g.cards.map(ac => (
                    <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showDetails onCardAction={onCardAction} menuProps={menuProps ? { userLists: menuProps.userLists, isMustInclude: menuProps.mustIncludeNames.has(ac.card.name), isBanned: menuProps.bannedNames.has(ac.card.name), isInSideboard: menuProps.sideboardNames.has(ac.card.name), isInMaybeboard: menuProps.maybeboardNames.has(ac.card.name) } : undefined} />
                  ))}
                </div>
              )}
            </div>
          )) : (
            <p className="text-xs text-muted-foreground/60 italic px-0.5">No ramp cards in deck</p>
          )}
          {/* Recently added from suggestions */}
          {(() => {
            const existingNames = new Set(analysis.rampCards.map(ac => ac.card.name));
            const suggNames = new Set(rampSuggestions.map(r => r.name));
            const recentlyAdded = [...addedCards].filter(n => !existingNames.has(n) && suggNames.has(n));
            if (recentlyAdded.length === 0) return null;
            return (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/60 mb-0.5 px-0.5 flex items-center gap-1">
                  <Plus className="w-2.5 h-2.5" />
                  Recently Added ({recentlyAdded.length})
                </p>
                <div className="space-y-0.5">
                  {recentlyAdded.map(name => (
                    <div key={name} className="flex items-center gap-2 py-1 px-1.5 rounded-lg cursor-pointer hover:bg-accent/40 transition-colors" onClick={() => onPreview(name)}>
                      <img src={scryfallImg(name)} alt={name} className="w-10 h-auto rounded shadow shrink-0" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      <span className="text-sm truncate flex-1 min-w-0">{name}</span>
                      <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-emerald-500/15 text-emerald-400 shrink-0">NEW</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Vertical divider */}
        {hasSuggestions && <div className="hidden md:block w-px bg-border/30 shrink-0 -my-3" />}

        {/* Right: ramp suggestions */}
        {hasSuggestions && (
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60 mb-2 px-0.5 flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              Suggested Ramp ({rampSuggestions.length})
            </p>
            <SuggestionCardGrid
              cards={rampSuggestions}
              onAdd={onAdd}
              onPreview={onPreview}
              addedCards={addedCards}
              deficit={rampRb?.deficit || 0}
              onCardAction={onCardAction}
              menuProps={menuProps}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Fixing Summary Box (accordion) ─────────────────────────────
const FIXING_GRADE_STYLES: Record<string, { color: string; bgColor: string; border: string; bg: string }> = {
  A: { color: 'text-emerald-400', bgColor: 'bg-emerald-500/15', border: 'border-emerald-500/30', bg: 'bg-emerald-500/5' },
  B: { color: 'text-sky-400', bgColor: 'bg-sky-500/15', border: 'border-sky-500/30', bg: 'bg-sky-500/5' },
  C: { color: 'text-amber-400', bgColor: 'bg-amber-500/15', border: 'border-amber-500/30', bg: 'bg-amber-500/5' },
  D: { color: 'text-orange-400', bgColor: 'bg-orange-500/15', border: 'border-orange-500/30', bg: 'bg-orange-500/5' },
  F: { color: 'text-red-400', bgColor: 'bg-red-500/15', border: 'border-red-500/30', bg: 'bg-red-500/5' },
};

const COLOR_BARS: Record<string, string> = {
  W: 'bg-amber-200', U: 'bg-blue-500', B: 'bg-violet-500', R: 'bg-red-500', G: 'bg-green-500',
};

function FixingSummaryBox({ analysis }: { analysis: DeckAnalysis }) {
  const [expanded, setExpanded] = useState(true);
  const cf = analysis.colorFixing;
  const grade = cf.fixingGrade || 'C';
  const gs = FIXING_GRADE_STYLES[grade] || FIXING_GRADE_STYLES.C;

  return (
    <div className="-mx-3 sm:-mx-4 -mt-3 px-3 sm:px-4 pt-3 pb-3 space-y-3">
      <div
        role="button"
        tabIndex={0}
        className="w-full text-[11px] font-semibold uppercase tracking-wider text-foreground/60 px-0.5 flex items-center gap-1 hover:text-foreground/80 transition-colors cursor-pointer select-none"
        onClick={() => setExpanded(prev => !prev)}
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
        <Palette className="w-3 h-3" />
        Summary
        <GradeInfoPopover>
          <p className="font-semibold text-foreground/80">Color Fixing Grading</p>
          <p>Mono-color decks get auto-A. For 2+ colors, a composite 0–100 score from three factors:</p>
          <p><span className="text-foreground/70 font-medium">50%</span> — Color coverage (sources vs pip demand per color, capped at 130%)</p>
          <p><span className="text-foreground/70 font-medium">25%</span> — Worst-color penalty (any color below 60% of expected)</p>
          <p><span className="text-foreground/70 font-medium">25%</span> — Absolute adequacy (min sources per color vs target)</p>
          <p><span className="font-semibold text-emerald-400">A</span> ≥ 85 · <span className="font-semibold text-sky-400">B</span> ≥ 70 · <span className="font-semibold text-amber-400">C</span> ≥ 50 · <span className="font-semibold text-orange-400">D</span> ≥ 30 · <span className="font-semibold text-red-400">F</span> &lt; 30</p>
        </GradeInfoPopover>
      </div>
      {expanded && (
        <div className={`border rounded-lg p-2.5 ${gs.border} ${gs.bg}`}>
          <div className="flex items-center gap-3">
            <div className={`flex items-center justify-center w-12 h-12 rounded-lg ${gs.bgColor} shrink-0`}>
              <span className={`text-2xl font-black leading-none ${gs.color}`}>{grade}</span>
            </div>
            <div className="flex-1 min-w-0 flex items-center justify-center">
              <p className="text-sm text-muted-foreground leading-snug text-center">{cf.fixingGradeMessage || ''}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Color Fixing Detail Panel ───────────────────────────────────
function FixingDetail({
  analysis, onPreview, onAdd, addedCards, onCardAction, menuProps, colorIdentity, onAddBasicLand, onRemoveBasicLand,
}: {
  analysis: DeckAnalysis;
  onPreview: (name: string) => void;
  onAdd: (name: string) => void;
  addedCards: Set<string>;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
  colorIdentity: string[];
  onAddBasicLand?: (name: string) => void;
  onRemoveBasicLand?: (name: string) => void;
}) {
  const cf = analysis.colorFixing;
  const fixerRecs = cf.fixingRecommendations || [];
  const hasSuggestions = analysis.landRecommendations.length > 0 || fixerRecs.length > 0;
  const [fixersOpen, setFixersOpen] = useState(true);
  const [rampOpen, setRampOpen] = useState(true);
  const [multiColorOpen, setMultiColorOpen] = useState(true);
  const [monoColorOpen, setMonoColorOpen] = useState(false);
  const [colorlessOpen, setColorlessOpen] = useState(false);
  const [basicOpen, setBasicOpen] = useState(false);
  const [selectedColors, setSelectedColors] = useState<Set<string>>(new Set());

  // Derive mono-color and basic land groups
  const multiColorNames = new Set(cf.fixingLands.map(ac => ac.card.name));
  const colorlessNames = new Set(cf.colorlessOnly.map(ac => ac.card.name));

  const monoColorLands = useMemo(() =>
    analysis.landCards.filter(ac => {
      if (multiColorNames.has(ac.card.name) || colorlessNames.has(ac.card.name)) return false;
      const tl = getFrontFaceTypeLine(ac.card).toLowerCase();
      return !/\bbasic\b/.test(tl);
    }).sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0)),
    [analysis.landCards, multiColorNames, colorlessNames]
  );

  const COLOR_TO_BASIC: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
  const basicCountMap = new Map<string, number>();
  for (const c of colorIdentity) {
    const name = COLOR_TO_BASIC[c];
    if (name) basicCountMap.set(name, 0);
  }
  if (colorIdentity.length === 0) basicCountMap.set('Wastes', 0);
  for (const ac of analysis.landCards) {
    const tl = getFrontFaceTypeLine(ac.card).toLowerCase();
    if (/\bbasic\b/.test(tl)) basicCountMap.set(ac.card.name, (basicCountMap.get(ac.card.name) || 0) + 1);
  }
  const basicGroups = [...basicCountMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const toggleColor = (color: string) => {
    setSelectedColors(prev => {
      const next = new Set(prev);
      if (next.has(color)) next.delete(color); else next.add(color);
      return next;
    });
  };

  // Sort land suggestions by how well they cover weak colors, then by inclusion
  const sortedLandSuggestions = useMemo(() => {
    if ((cf.colorsNeeded?.length || 0) < 2 || !cf.demandVsSupplyRatio) return analysis.landRecommendations;
    return [...analysis.landRecommendations].sort((a, b) => {
      const scoreA = (a.producedColors || []).reduce((s, c) => s + (cf.demandVsSupplyRatio[c] || 0), 0);
      const scoreB = (b.producedColors || []).reduce((s, c) => s + (cf.demandVsSupplyRatio[c] || 0), 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return b.inclusion - a.inclusion;
    });
  }, [analysis.landRecommendations, cf.demandVsSupplyRatio, cf.colorsNeeded?.length]);

  // Filter suggestions by selected colors
  const matchesColorFilter = (colors: string[] | undefined) => {
    if (!colors || colors.length === 0) return false; // no color data = colorless, exclude
    return colors.some(c => selectedColors.has(c));
  };

  // Get produced colors from a card (for filtering left-column cards)
  const getCardProducedColors = (card: ScryfallCard): string[] => {
    const WUBRG = ['W', 'U', 'B', 'R', 'G'];
    const produced = card.produced_mana || [];
    const colors = [...new Set(produced.filter(c => WUBRG.includes(c)))];
    if (colors.length > 0) return colors;
    const oracle = (card.oracle_text || '').toLowerCase();
    if (oracle.includes('any color') || oracle.includes('any type')) return WUBRG;
    const found: string[] = [];
    if (oracle.includes('add {w}')) found.push('W');
    if (oracle.includes('add {u}')) found.push('U');
    if (oracle.includes('add {b}')) found.push('B');
    if (oracle.includes('add {r}')) found.push('R');
    if (oracle.includes('add {g}')) found.push('G');
    return found;
  };

  const cardMatchesColorFilter = (card: ScryfallCard) => {
    if (selectedColors.size === 0) return true;
    return getCardProducedColors(card).some(c => selectedColors.has(c));
  };

  const filteredLandSuggestions = useMemo(() => {
    if (selectedColors.size === 0) return sortedLandSuggestions;
    return sortedLandSuggestions.filter(r => matchesColorFilter(r.producedColors));
  }, [sortedLandSuggestions, selectedColors]);

  const filteredFixerRecs = useMemo(() => {
    if (selectedColors.size === 0) return fixerRecs;
    return fixerRecs.filter(r => matchesColorFilter(r.producedColors));
  }, [fixerRecs, selectedColors]);

  // Filtered left-column card lists
  const filteredManaFixCards = useMemo(() => cf.manaFixCards.filter(ac => cardMatchesColorFilter(ac.card)), [cf.manaFixCards, selectedColors]);
  const filteredRampCards = useMemo(() => cf.nonFixRampCards.filter(ac => cardMatchesColorFilter(ac.card)), [cf.nonFixRampCards, selectedColors]);
  const filteredFixingLands = useMemo(() => cf.fixingLands.filter(ac => cardMatchesColorFilter(ac.card)), [cf.fixingLands, selectedColors]);
  const filteredMonoColorLands = useMemo(() => monoColorLands.filter(ac => cardMatchesColorFilter(ac.card)), [monoColorLands, selectedColors]);
  const filteredColorlessLands = useMemo(() => cf.colorlessOnly.filter(ac => cardMatchesColorFilter(ac.card)), [cf.colorlessOnly, selectedColors]);
  const filteredBasicGroups = useMemo(() => {
    if (selectedColors.size === 0) return basicGroups;
    const BASIC_COLOR: Record<string, string> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
    return basicGroups.filter(bg => BASIC_COLOR[bg.name] ? selectedColors.has(BASIC_COLOR[bg.name]) : false);
  }, [basicGroups, selectedColors]);

  return (
    <div className="-mx-3 sm:-mx-4 -mb-3 sm:-mb-4 bg-black/15 px-3 sm:px-4 py-3">
      <div className={`${hasSuggestions ? 'flex flex-col md:flex-row md:items-stretch gap-4' : ''}`}>
        {/* Left: fixing summary + mana fixers + multi-color + recently added */}
        <div className={`${hasSuggestions ? 'md:w-[30%] shrink-0' : 'w-full'} space-y-3`}>
          <FixingSummaryBox analysis={analysis} />

          {/* Demand vs Supply — per-color breakdown */}
          {(cf.colorsNeeded?.length || 0) >= 2 && (() => {
            const pipTotal = cf.pipDemandTotal || 1;
            const WUBRG = ['W', 'U', 'B', 'R', 'G'];
            const colors = [...(cf.colorsNeeded || [])].sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));
            return (
              <div>
              <div className="flex items-center gap-1 mb-1.5 px-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60">Pip Demand</span>
                <GradeInfoPopover>
                  <p className="font-semibold text-foreground mb-1">Pip Demand vs Supply</p>
                  <p>Counts colored mana pips across your non-land cards, then checks if your sources (lands, dorks, rocks) match that distribution.</p>
                  <p>A color with 30 pips and 19 sources is healthy. Aim for roughly 1 source per 1.5–2 pips. Colors highlighted amber are undersupplied.</p>
                  <p className="text-muted-foreground/40">Click a color to filter cards and suggestions.</p>
                </GradeInfoPopover>
              </div>
              <div className="flex gap-1.5">
                {colors.map(color => {
                  const pips = cf.pipDemand?.[color] || 0;
                  const demandPct = Math.round((pips / pipTotal) * 100);
                  const ratio = cf.demandVsSupplyRatio?.[color] || 0;
                  const isWeak = ratio > 0.25;
                  return (
                    <button
                      key={color}
                      onClick={() => toggleColor(color)}
                      className={`flex-1 min-w-0 rounded-lg border p-1.5 transition-all cursor-pointer ${
                        selectedColors.has(color)
                          ? 'border-foreground/50 bg-foreground/10 ring-1 ring-foreground/20'
                          : isWeak ? 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10' : 'border-border/30 bg-card/30 hover:bg-card/50'
                      }`}
                    >
                      <div className="flex items-center justify-center gap-0.5">
                        <i className={`ms ms-${color.toLowerCase()} ms-cost text-sm`} />
                        <span className="text-[10px] text-muted-foreground/60 font-medium">x</span>
                        <span className={`text-sm font-black tabular-nums leading-none ${selectedColors.has(color) ? 'text-foreground' : isWeak ? 'text-amber-400' : 'text-foreground'}`}>{pips}</span>
                      </div>
                      <p className="text-[9px] text-muted-foreground/50 text-center tabular-nums mb-0.5">{demandPct}% of demand</p>
                      <div className="h-1 rounded-full bg-accent/40 overflow-hidden mb-0.5">
                        <div className={`h-full rounded-full transition-all ${COLOR_BARS[color] || 'bg-foreground'}`} style={{ width: `${Math.min(100, Math.round(((cf.sourcesPerColor?.[color] || 0) / Math.max(pips, 1)) * 50))}%` }} />
                      </div>
                      <p className="text-[9px] text-muted-foreground/50 text-center tabular-nums">{cf.sourcesPerColor?.[color] || 0} sources</p>
                    </button>
                  );
                })}
              </div>
              </div>
            );
          })()}

          <div className="-mx-3 sm:-mx-4 border-b border-border/30" />

          {/* Mana Fixers (cards with mana-fix tag) */}
          {filteredManaFixCards.length > 0 && (
            <div>
              <button
                onClick={() => setFixersOpen(v => !v)}
                className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
              >
                {fixersOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60">
                  Mana Fixers ({filteredManaFixCards.length})
                </span>
              </button>
              {fixersOpen && (
                <div className="space-y-0.5">
                  {filteredManaFixCards.map(ac => (
                    <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showProducedMana showDetails onCardAction={onCardAction} menuProps={menuProps ? { userLists: menuProps.userLists, isMustInclude: menuProps.mustIncludeNames.has(ac.card.name), isBanned: menuProps.bannedNames.has(ac.card.name), isInSideboard: menuProps.sideboardNames.has(ac.card.name), isInMaybeboard: menuProps.maybeboardNames.has(ac.card.name) } : undefined} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Other Ramp (dorks, rocks, cost-reducers without mana-fix tag) */}
          {filteredRampCards.length > 0 && (
            <div>
              <button
                onClick={() => setRampOpen(v => !v)}
                className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
              >
                {rampOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60">
                  Ramp ({filteredRampCards.length})
                </span>
              </button>
              {rampOpen && (
                <div className="space-y-0.5">
                  {filteredRampCards.map(ac => (
                    <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showProducedMana showDetails onCardAction={onCardAction} menuProps={menuProps ? { userLists: menuProps.userLists, isMustInclude: menuProps.mustIncludeNames.has(ac.card.name), isBanned: menuProps.bannedNames.has(ac.card.name), isInSideboard: menuProps.sideboardNames.has(ac.card.name), isInMaybeboard: menuProps.maybeboardNames.has(ac.card.name) } : undefined} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Multi-color lands in deck */}
          {filteredFixingLands.length > 0 && (
            <div>
              <button
                onClick={() => setMultiColorOpen(v => !v)}
                className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
              >
                {multiColorOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60">
                  Multi-Color Lands ({filteredFixingLands.length})
                </span>
              </button>
              {multiColorOpen && (
                <div className="space-y-0.5">
                  {filteredFixingLands.map(ac => (
                    <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showProducedMana showDetails onCardAction={onCardAction} menuProps={menuProps ? { userLists: menuProps.userLists, isMustInclude: menuProps.mustIncludeNames.has(ac.card.name), isBanned: menuProps.bannedNames.has(ac.card.name), isInSideboard: menuProps.sideboardNames.has(ac.card.name), isInMaybeboard: menuProps.maybeboardNames.has(ac.card.name) } : undefined} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Mono-color lands */}
          {filteredMonoColorLands.length > 0 && (
            <div>
              <button
                onClick={() => setMonoColorOpen(v => !v)}
                className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
              >
                {monoColorOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60">
                  Other Lands ({filteredMonoColorLands.length})
                </span>
              </button>
              {monoColorOpen && (
                <div className="space-y-0.5">
                  {filteredMonoColorLands.map(ac => (
                    <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showProducedMana showDetails onCardAction={onCardAction} menuProps={menuProps ? { userLists: menuProps.userLists, isMustInclude: menuProps.mustIncludeNames.has(ac.card.name), isBanned: menuProps.bannedNames.has(ac.card.name), isInSideboard: menuProps.sideboardNames.has(ac.card.name), isInMaybeboard: menuProps.maybeboardNames.has(ac.card.name) } : undefined} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Colorless utility lands */}
          {filteredColorlessLands.length > 0 && (
            <div>
              <button
                onClick={() => setColorlessOpen(v => !v)}
                className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
              >
                {colorlessOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60">
                  Colorless Lands ({filteredColorlessLands.length})
                </span>
              </button>
              {colorlessOpen && (
                <div className="space-y-0.5">
                  {filteredColorlessLands.map(ac => (
                    <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showProducedMana showDetails onCardAction={onCardAction} menuProps={menuProps ? { userLists: menuProps.userLists, isMustInclude: menuProps.mustIncludeNames.has(ac.card.name), isBanned: menuProps.bannedNames.has(ac.card.name), isInSideboard: menuProps.sideboardNames.has(ac.card.name), isInMaybeboard: menuProps.maybeboardNames.has(ac.card.name) } : undefined} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Basic lands */}
          {filteredBasicGroups.length > 0 && (
            <div>
              <button
                onClick={() => setBasicOpen(v => !v)}
                className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
              >
                {basicOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60">
                  Basic ({filteredBasicGroups.reduce((sum, bg) => sum + bg.count, 0)})
                </span>
              </button>
              {basicOpen && (
                <div className="space-y-0.5">
                  {filteredBasicGroups.map(bg => (
                    <div
                      key={bg.name}
                      className={`flex items-center gap-2 py-1 px-1.5 rounded-lg transition-colors ${bg.count === 0 ? 'opacity-40' : 'cursor-pointer hover:bg-accent/40'}`}
                      onClick={() => bg.count > 0 && onPreview(bg.name)}
                    >
                      <img
                        src={scryfallImg(bg.name)}
                        alt={bg.name}
                        className="w-10 h-auto rounded shadow shrink-0"
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm truncate block">{bg.name}</span>
                        <span className="text-[10px] text-muted-foreground/60">Land — Basic</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          className="w-5 h-5 flex items-center justify-center rounded bg-accent/40 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                          disabled={bg.count === 0}
                          onClick={() => onRemoveBasicLand?.(bg.name)}
                          title={`Remove a ${bg.name}`}
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-xs tabular-nums w-5 text-center font-medium">{bg.count}</span>
                        <button
                          className="w-5 h-5 flex items-center justify-center rounded bg-accent/40 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => onAddBasicLand?.(bg.name)}
                          title={`Add a ${bg.name}`}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Recently added from suggestions */}
          {(() => {
            const existingNames = new Set([...cf.fixingLands, ...cf.colorlessOnly, ...cf.manaFixCards, ...cf.nonFixRampCards, ...monoColorLands].map(ac => ac.card.name));
            const suggNames = new Set([...analysis.landRecommendations, ...fixerRecs].map(r => r.name));
            const recentlyAdded = [...addedCards].filter(n => !existingNames.has(n) && suggNames.has(n));
            if (recentlyAdded.length === 0) return null;
            return (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/60 mb-0.5 px-0.5 flex items-center gap-1">
                  <Plus className="w-2.5 h-2.5" />
                  Recently Added ({recentlyAdded.length})
                </p>
                <div className="space-y-0.5">
                  {recentlyAdded.map(name => (
                    <div key={name} className="flex items-center gap-2 py-1 px-1.5 rounded-lg cursor-pointer hover:bg-accent/40 transition-colors" onClick={() => onPreview(name)}>
                      <img src={scryfallImg(name)} alt={name} className="w-10 h-auto rounded shadow shrink-0" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      <span className="text-sm truncate flex-1 min-w-0">{name}</span>
                      <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-emerald-500/15 text-emerald-400 shrink-0">NEW</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Vertical divider */}
        {hasSuggestions && <div className="hidden md:block w-px bg-border/30 shrink-0 -my-3" />}

        {/* Right: land + fixer suggestions (color-weighted, filterable by pip selection) */}
        {hasSuggestions && (
          <div className="flex-1 min-w-0 space-y-4">
            {selectedColors.size > 0 ? (
              <p className="text-[10px] text-muted-foreground/50 px-0.5 flex items-center gap-1">
                Showing {[...selectedColors].map(c => <i key={c} className={`ms ms-${c.toLowerCase()} ms-cost text-xs`} />)} sources
              </p>
            ) : cf.weakestColor && (cf.colorsNeeded?.length || 0) >= 2 && cf.fixingGrade !== 'A' ? (
              <p className="text-[10px] text-muted-foreground/50 px-0.5 flex items-center gap-1">
                Prioritizing <i className={`ms ms-${cf.weakestColor.toLowerCase()} ms-cost text-xs`} /> sources
              </p>
            ) : null}
            {filteredFixerRecs.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60 mb-2 px-0.5 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  Suggested {(cf.colorsNeeded?.length || 0) >= 2 ? 'Fixers' : 'Ramp'} ({filteredFixerRecs.length})
                </p>
                <SuggestionCardGrid
                  cards={filteredFixerRecs}
                  onAdd={onAdd}
                  onPreview={onPreview}
                  addedCards={addedCards}
                  onCardAction={onCardAction}
                  menuProps={menuProps}
                />
              </div>
            )}
            {filteredLandSuggestions.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60 mb-2 px-0.5 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  Suggested Lands ({filteredLandSuggestions.length})
                </p>
                <SuggestionCardGrid
                  cards={filteredLandSuggestions}
                  onAdd={onAdd}
                  onPreview={onPreview}
                  addedCards={addedCards}
                  onCardAction={onCardAction}
                  menuProps={menuProps}
                />
              </div>
            )}
            {selectedColors.size > 0 && filteredFixerRecs.length === 0 && filteredLandSuggestions.length === 0 && (
              <p className="text-xs text-muted-foreground/40 text-center py-4">No suggestions produce the selected color{selectedColors.size > 1 ? 's' : ''}.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Flex Lands Summary Box ──────────────────────────────────────
function FlexLandSummaryBox({ mdfcCount, channelLandCount, totalAvailable, loading }: { mdfcCount: number; channelLandCount: number; totalAvailable: number; loading: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const flexCount = mdfcCount + channelLandCount;
  const status = getMdfcStatus(flexCount);
  const grade = getMdfcGrade(flexCount);
  const gs = FIXING_GRADE_STYLES[grade.letter] || FIXING_GRADE_STYLES.C;

  return (
    <div className="-mx-3 sm:-mx-4 -mt-3 px-3 sm:px-4 pt-3 pb-3 space-y-3 border-b border-border/30">
      <div
        role="button"
        tabIndex={0}
        className="w-full text-[11px] font-semibold uppercase tracking-wider text-foreground/60 px-0.5 flex items-center gap-1 hover:text-foreground/80 transition-colors cursor-pointer select-none"
        onClick={() => setExpanded(prev => !prev)}
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
        <FlipHorizontal2 className="w-3 h-3" />
        Summary
        <GradeInfoPopover>
          <p className="font-semibold text-foreground/80">Flex Land Grading</p>
          <p>MDFCs and channel lands count as both a spell and a land, reducing flood risk. Recommended: 3–6 total.</p>
          <p><span className="font-semibold text-emerald-400">A</span> — 6+ flex lands</p>
          <p><span className="font-semibold text-sky-400">B</span> — 3–5 flex lands</p>
          <p><span className="font-semibold text-amber-400">C</span> — 1–2 flex lands</p>
          <p><span className="font-semibold text-red-400">F</span> — No flex lands</p>
        </GradeInfoPopover>
      </div>
      {expanded && <>
        <div className={`border rounded-lg p-2.5 ${gs.border} ${gs.bg}`}>
          <div className="flex items-center gap-3">
            <div className={`flex items-center justify-center w-12 h-12 rounded-lg ${gs.bgColor} shrink-0`}>
              <span className={`text-2xl font-black leading-none ${gs.color}`}>{grade.letter}</span>
            </div>
            <div className="flex-1 min-w-0 flex items-center justify-center">
              <p className="text-sm text-muted-foreground leading-snug text-center">{status.message}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70 px-0.5 flex-wrap">
          <span>Target: <span className="font-semibold text-foreground/60">3–6</span></span>
          {channelLandCount > 0 && mdfcCount > 0 && (
            <><span className="text-border">·</span><span>{mdfcCount} MDFC + {channelLandCount} channel</span></>
          )}
          {!loading && <><span className="text-border">·</span><span>{totalAvailable} MDFCs in colors</span></>}
        </div>
      </>}
    </div>
  );
}

// ─── MDFC Lands Detail Panel ─────────────────────────────────────
function MdfcDetail({
  analysis, mdfcSuggestions, totalMdfcAvailable, mdfcLoading, channelLandCards = [], currentCardNames = new Set<string>(), onPreview, onAdd, addedCards, onCardAction, menuProps, colorIdentity, onAddBasicLand, onRemoveBasicLand,
}: {
  analysis: DeckAnalysis;
  mdfcSuggestions: RecommendedCard[];
  totalMdfcAvailable: number;
  mdfcLoading: boolean;
  channelLandCards?: RecommendedCard[];
  currentCardNames?: Set<string>;
  onPreview: (name: string) => void;
  onAdd: (name: string) => void;
  addedCards: Set<string>;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
  colorIdentity: string[];
  onAddBasicLand?: (name: string) => void;
  onRemoveBasicLand?: (name: string) => void;
}) {
  // Split lands into MDFC, channel, nonbasic, and basic groups
  const mdfcLands = analysis.landCards.filter(ac => isMdfcLand(ac.card))
    .sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0));
  const mdfcNames = new Set(mdfcLands.map(ac => ac.card.name));

  const channelLands = analysis.channelLandsInDeck || [];
  const channelNames = new Set(channelLands.map(ac => ac.card.name));

  const nonbasicLands = analysis.landCards.filter(ac => {
    if (mdfcNames.has(ac.card.name)) return false;
    if (channelNames.has(ac.card.name)) return false;
    const tl = getFrontFaceTypeLine(ac.card).toLowerCase();
    return !/\bbasic\b/.test(tl);
  }).sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0));

  const basicLands = analysis.landCards.filter(ac => {
    const tl = getFrontFaceTypeLine(ac.card).toLowerCase();
    return /\bbasic\b/.test(tl);
  });
  const COLOR_TO_BASIC: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
  const basicCountMap = new Map<string, number>();
  for (const c of colorIdentity) {
    const name = COLOR_TO_BASIC[c];
    if (name) basicCountMap.set(name, 0);
  }
  if (colorIdentity.length === 0) basicCountMap.set('Wastes', 0);
  for (const ac of basicLands) {
    basicCountMap.set(ac.card.name, (basicCountMap.get(ac.card.name) || 0) + 1);
  }
  const basicGroups = [...basicCountMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const totalBasicCount = basicGroups.reduce((sum, bg) => sum + bg.count, 0);

  const [mdfcOpen, setMdfcOpen] = useState(true);
  const [channelOpen, setChannelOpen] = useState(true);
  const [nonbasicOpen, setNonbasicOpen] = useState(true);
  const [basicOpen, setBasicOpen] = useState(true);

  const makeMenuProps = (cardName: string) => menuProps ? {
    userLists: menuProps.userLists,
    isMustInclude: menuProps.mustIncludeNames.has(cardName),
    isBanned: menuProps.bannedNames.has(cardName),
    isInSideboard: menuProps.sideboardNames.has(cardName),
    isInMaybeboard: menuProps.maybeboardNames.has(cardName),
  } : undefined;

  // Count MDFCs added from suggestions (not already in analysis)
  const existingLandNames = new Set(analysis.landCards.map(ac => ac.card.name));
  const mdfcSuggNames = new Set(mdfcSuggestions.map(r => r.name));
  const addedMdfcNames = [...addedCards].filter(n => !existingLandNames.has(n) && mdfcSuggNames.has(n));
  const adjustedMdfcCount = analysis.mdfcsInDeck.length + addedMdfcNames.length;

  return (
    <div className="-mx-3 sm:-mx-4 -mb-3 sm:-mb-4 bg-black/15 px-3 sm:px-4 py-3">
      <div className="flex flex-col md:flex-row md:items-stretch gap-4">
        {/* Left: summary + all lands in deck */}
        <div className="md:w-[30%] shrink-0 space-y-3">
          <FlexLandSummaryBox
            mdfcCount={adjustedMdfcCount}
            channelLandCount={channelLands.length}
            totalAvailable={totalMdfcAvailable}
            loading={mdfcLoading}
          />

          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400/60 mb-1 px-0.5 flex items-center gap-1">
            <Check className="w-3 h-3" />
            In Your Deck
          </p>

          {analysis.landCards.length > 0 && (
            <div className="space-y-2">
              {/* MDFC lands */}
              {mdfcLands.length > 0 && (
                <div>
                  <button
                    onClick={() => setMdfcOpen(v => !v)}
                    className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
                  >
                    {mdfcOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60">
                      MDFC ({mdfcLands.length})
                    </span>
                  </button>
                  {mdfcOpen && (
                    <div className="space-y-0.5">
                      {mdfcLands.map(ac => (
                        <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showDetails onCardAction={onCardAction} menuProps={makeMenuProps(ac.card.name)} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Channel lands */}
              {channelLands.length > 0 && (
                <div>
                  <button
                    onClick={() => setChannelOpen(v => !v)}
                    className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
                  >
                    {channelOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60">
                      Channel ({channelLands.length})
                    </span>
                  </button>
                  {channelOpen && (
                    <div className="space-y-0.5">
                      {channelLands.map(ac => (
                        <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showDetails onCardAction={onCardAction} menuProps={makeMenuProps(ac.card.name)} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Nonbasic lands */}
              {nonbasicLands.length > 0 && (
                <div>
                  <button
                    onClick={() => setNonbasicOpen(v => !v)}
                    className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
                  >
                    {nonbasicOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60">
                      Nonbasic ({nonbasicLands.length})
                    </span>
                  </button>
                  {nonbasicOpen && (
                    <div className="space-y-0.5">
                      {nonbasicLands.map(ac => (
                        <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showDetails onCardAction={onCardAction} menuProps={makeMenuProps(ac.card.name)} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Basic lands */}
              {basicGroups.length > 0 && (
                <div>
                  <button
                    onClick={() => setBasicOpen(v => !v)}
                    className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
                  >
                    {basicOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60">
                      Basic ({totalBasicCount})
                    </span>
                  </button>
                  {basicOpen && (
                    <div className="space-y-0.5">
                      {basicGroups.map(bg => (
                        <div
                          key={bg.name}
                          className={`flex items-center gap-2 py-1 px-1.5 rounded-lg transition-colors ${bg.count === 0 ? 'opacity-40' : 'cursor-pointer hover:bg-accent/40'}`}
                          onClick={() => bg.count > 0 && onPreview(bg.name)}
                        >
                          <img src={scryfallImg(bg.name)} alt={bg.name} className="w-10 h-auto rounded shadow shrink-0" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm truncate block">{bg.name}</span>
                            <span className="text-[10px] text-muted-foreground/60">Land — Basic</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                            <button
                              className="w-5 h-5 flex items-center justify-center rounded bg-accent/40 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                              disabled={bg.count === 0}
                              onClick={() => onRemoveBasicLand?.(bg.name)}
                              title={`Remove a ${bg.name}`}
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="text-xs tabular-nums w-5 text-center font-medium">{bg.count}</span>
                            <button
                              className="w-5 h-5 flex items-center justify-center rounded bg-accent/40 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                              onClick={() => onAddBasicLand?.(bg.name)}
                              title={`Add a ${bg.name}`}
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {analysis.landCards.length === 0 && (
            <div className="text-xs text-muted-foreground/60 px-0.5 space-y-1.5">
              <p className="italic">No lands in your deck yet.</p>
            </div>
          )}
          {/* Recently added from suggestions */}
          {(() => {
            const existingNames = new Set(analysis.landCards.map(ac => ac.card.name));
            const suggNames = new Set(mdfcSuggestions.map(r => r.name));
            const recentlyAdded = [...addedCards].filter(n => !existingNames.has(n) && suggNames.has(n));
            if (recentlyAdded.length === 0) return null;
            return (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/60 mb-0.5 px-0.5 flex items-center gap-1">
                  <Plus className="w-2.5 h-2.5" />
                  Recently Added ({recentlyAdded.length})
                </p>
                <div className="space-y-0.5">
                  {recentlyAdded.map(name => (
                    <div key={name} className="flex items-center gap-2 py-1 px-1.5 rounded-lg cursor-pointer hover:bg-accent/40 transition-colors" onClick={() => onPreview(name)}>
                      <img src={scryfallImg(name)} alt={name} className="w-10 h-auto rounded shadow shrink-0" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      <span className="text-sm truncate flex-1 min-w-0">{name}</span>
                      <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-emerald-500/15 text-emerald-400 shrink-0">NEW</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Vertical divider */}
        <div className="hidden md:block w-px bg-border/30 shrink-0 -my-3" />

        {/* Right: channel lands callout + all available MDFCs */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Channel Lands */}
          {channelLandCards.length > 0 && channelLandCards.some(cl => !currentCardNames.has(cl.name) && !addedCards.has(cl.name)) && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60 mb-1 px-0.5 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                Channel Lands ({channelLandCards.length})
              </p>
              <p className="text-[10px] text-muted-foreground/50 mb-2 px-0.5">
                Lands that double as spells with virtually no downside. We recommend running every one you can.
              </p>
              <SuggestionCardGrid
                cards={channelLandCards}
                onAdd={onAdd}
                onPreview={onPreview}
                addedCards={new Set([...addedCards, ...Array.from(currentCardNames).filter(n => channelLandCards.some(cl => cl.name === n))])}
                onCardAction={onCardAction}
                menuProps={menuProps}
              />
            </div>
          )}

          <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60 mb-2 px-0.5 flex items-center gap-1">
            <FlipHorizontal2 className="w-3 h-3" />
            All Available MDFCs {!mdfcLoading && `(${mdfcSuggestions.length})`}
          </p>
          {mdfcLoading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground/60">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-xs">Searching Scryfall for MDFC lands...</span>
            </div>
          ) : mdfcSuggestions.length > 0 ? (
            <SuggestionCardGrid
              cards={mdfcSuggestions}
              onAdd={onAdd}
              onPreview={onPreview}
              addedCards={addedCards}
              deficit={0}
              onCardAction={onCardAction}
              menuProps={menuProps}
            />
          ) : (
            <p className="text-xs text-muted-foreground/60 italic py-4 text-center">No MDFC lands found for your color identity</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Lands Tab Content Orchestrator ──────────────────────────────
function LandsTabContent({
  analysis, activeSection, onSectionChange, onPreview, onAdd, addedCards, currentCards, onCardAction, menuProps, onAddBasicLand, onRemoveBasicLand, cardInclusionMap,
}: {
  analysis: DeckAnalysis;
  activeSection: LandSection | null;
  onSectionChange: (section: LandSection) => void;
  onPreview: (name: string) => void;
  onAdd: (name: string) => void;
  addedCards: Set<string>;
  currentCards: ScryfallCard[];
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
  onAddBasicLand?: (name: string) => void;
  onRemoveBasicLand?: (name: string) => void;
  cardInclusionMap?: Record<string, number>;
}) {
  const colorIdentity = useStore(s => s.colorIdentity);

  // Track basic land count adjustments (deltas from analysis baseline)
  const handleAddBasic = useCallback((name: string) => {
    onAddBasicLand?.(name);
  }, [onAddBasicLand]);
  const handleRemoveBasic = useCallback((name: string) => {
    onRemoveBasicLand?.(name);
  }, [onRemoveBasicLand]);

  // MDFC search — eager fetch on mount, store ALL results unfiltered
  const [allMdfcCards, setAllMdfcCards] = useState<RecommendedCard[]>([]);
  const [mdfcLoading, setMdfcLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMdfcLoading(true);

    searchMdfcLands(colorIdentity).then(cards => {
      if (cancelled) return;
      const all: RecommendedCard[] = cards.map(card => {
        const frontName = card.card_faces?.[0]?.name || card.name;
        const role = getCardRole(frontName) || getCardRole(card.name);
        const allRoles = getAllCardRoles(frontName);
        if (allRoles.length === 0) { const r2 = getAllCardRoles(card.name); if (r2.length > 0) allRoles.push(...r2); }
        return {
          name: card.name,
          inclusion: card.edhrec_rank ? Math.max(1, 100 - Math.floor(card.edhrec_rank / 100)) : 0,
          synergy: 0,
          fillsDeficit: false,
          primaryType: card.type_line || '',
          imageUrl: card.card_faces?.[0]?.image_uris?.normal || card.image_uris?.normal,
          backImageUrl: card.card_faces?.[1]?.image_uris?.normal || undefined,
          price: card.prices?.usd || undefined,
          role: role || undefined,
          roleLabel: role ? ROLE_LABELS[role] : undefined,
          allRoleLabels: allRoles.length > 0 ? allRoles.map(r => ROLE_LABELS[r] || r) : undefined,
        };
      });
      setAllMdfcCards(all);
    }).catch(() => {
      if (!cancelled) setAllMdfcCards([]);
    }).finally(() => {
      if (!cancelled) setMdfcLoading(false);
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorIdentity]);

  // Channel lands — fetch card data for prices/images
  const channelLandsForColors = useMemo(() => getChannelLandsForColors(colorIdentity), [colorIdentity]);
  const [channelLandCards, setChannelLandCards] = useState<RecommendedCard[]>([]);

  useEffect(() => {
    if (channelLandsForColors.length === 0) { setChannelLandCards([]); return; }
    let cancelled = false;
    const names = channelLandsForColors.map(cl => cl.name);
    getCardsByNames(names).then(cardMap => {
      if (cancelled) return;
      const cards: RecommendedCard[] = channelLandsForColors.map(cl => {
        const card = cardMap.get(cl.name);
        return {
          name: cl.name,
          inclusion: -1, // sentinel: no inclusion data
          synergy: 0,
          fillsDeficit: false,
          primaryType: card?.type_line || 'Legendary Land',
          imageUrl: card?.image_uris?.normal,
          price: card?.prices?.usd || undefined,
        };
      });
      setChannelLandCards(cards);
    }).catch(() => { if (!cancelled) setChannelLandCards([]); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorIdentity]);

  // Filter suggestions: exclude cards currently in deck
  const currentCardNames = useMemo(() => new Set(currentCards.map(c => c.name)), [currentCards]);
  const mdfcSuggestions = useMemo(() =>
    allMdfcCards.filter(r => !currentCardNames.has(r.name) && !currentCardNames.has(r.name.split(' // ')[0])),
    [allMdfcCards, currentCardNames],
  );
  const totalMdfcAvailable = allMdfcCards.length;

  return (
    <div>
      <LandSummaryStrip
        analysis={analysis}
        activeSection={activeSection}
        onSectionClick={onSectionChange}
        mdfcInDeckCount={analysis.mdfcsInDeck.length}
        channelLandCount={(analysis.channelLandsInDeck || []).length}
      />
      {activeSection === 'landCount' && (
        <LandCountDetail analysis={analysis} onPreview={onPreview} onAdd={onAdd} addedCards={addedCards} onCardAction={onCardAction} menuProps={menuProps} colorIdentity={colorIdentity} onAddBasicLand={handleAddBasic} onRemoveBasicLand={handleRemoveBasic} cardInclusionMap={cardInclusionMap} />
      )}
      {activeSection === 'manaSources' && (
        <ManaSourcesDetail analysis={analysis} onPreview={onPreview} onAdd={onAdd} addedCards={addedCards} onCardAction={onCardAction} menuProps={menuProps} />
      )}
      {activeSection === 'fixing' && (
        <FixingDetail analysis={analysis} onPreview={onPreview} onAdd={onAdd} addedCards={addedCards} onCardAction={onCardAction} menuProps={menuProps} colorIdentity={colorIdentity} onAddBasicLand={handleAddBasic} onRemoveBasicLand={handleRemoveBasic} />
      )}
      {activeSection === 'mdfc' && (
        <MdfcDetail analysis={analysis} mdfcSuggestions={mdfcSuggestions} totalMdfcAvailable={totalMdfcAvailable} mdfcLoading={mdfcLoading} channelLandCards={channelLandCards} currentCardNames={currentCardNames} onPreview={onPreview} onAdd={onAdd} addedCards={addedCards} onCardAction={onCardAction} menuProps={menuProps} colorIdentity={colorIdentity} onAddBasicLand={handleAddBasic} onRemoveBasicLand={handleRemoveBasic} />
      )}
    </div>
  );
}

// ─── Overview Panel: Mana Base ─────────────────────────────────────
function ManaBasePanel({ manaBase, onNavigate }: { manaBase: DeckAnalysis['manaBase']; onNavigate?: () => void }) {
  const vs = VERDICT_STYLES[manaBase.verdict] || VERDICT_STYLES['ok'];
  const landDelta = manaBase.currentLands - manaBase.adjustedSuggestion;

  return (
    <div className={`border rounded-lg p-3 ${vs.border} ${vs.bg}`}>
      <div className="flex items-center gap-1.5 mb-2">
        <button onClick={onNavigate} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer">Mana Base</button>
        {manaBase.verdict !== 'ok' && (
          <span className={`text-[10px] font-bold px-1.5 py-px rounded-full ml-auto ${
            manaBase.verdict === 'critically-low' ? 'bg-red-500/20 text-red-400' :
            manaBase.verdict === 'high' ? 'bg-sky-500/20 text-sky-400' :
            'bg-amber-500/20 text-amber-400'
          }`}>
            {manaBase.verdict === 'critically-low' ? 'CRITICAL' : manaBase.verdict === 'low' ? 'LOW' : manaBase.verdict === 'slightly-low' ? 'LIGHT' : 'HIGH'}
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2 mb-1.5">
        <span className={`text-2xl font-bold tabular-nums ${vs.titleColor}`}>{manaBase.currentLands}</span>
        <span className="text-xs text-muted-foreground">lands</span>
        {landDelta !== 0 && (
          <span className={`text-xs font-medium flex items-center ${landDelta > 0 ? 'text-sky-400' : 'text-amber-400'}`}>
            {landDelta > 0 ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
            {landDelta > 0 ? '+' : ''}{landDelta} vs suggested
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-1.5">
        <span>{manaBase.currentBasic} basic</span>
        <span className="text-border">·</span>
        <span>{manaBase.currentNonbasic} nonbasic</span>
        <span className="text-border">·</span>
        <span>avg {manaBase.suggestedLands}</span>
      </div>

      <p className="text-xs text-muted-foreground/80 leading-relaxed">{manaBase.verdictMessage}</p>

      {manaBase.rampCount > 0 && (
        <p className="text-xs text-muted-foreground/60 mt-1 flex items-center gap-1">
          <TrendingUp className="w-3 h-3 text-emerald-400/50" />
          {manaBase.rampCount} ramp ({manaBase.manaProducerCount} producers)
        </p>
      )}
    </div>
  );
}

// ─── Overview Panel: Type Distribution ──────────────────────────────
function TypeSidebar({ types }: { types: DeckAnalysis['typeAnalysis'] }) {
  return (
    <div className="bg-card/60 border border-border/30 rounded-lg p-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">Types</div>
      <div className="space-y-2">
        {types.map(ta => {
          const pct = ta.target > 0 ? Math.min(100, (ta.current / ta.target) * 100) : 100;
          const isOver = ta.delta > 2;
          const isUnder = ta.delta < -2;
          const color = isOver ? 'bg-amber-500' : isUnder ? 'bg-sky-500' : 'bg-emerald-500';
          return (
            <div key={ta.type}>
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="text-muted-foreground capitalize">{ta.type}</span>
                <span className="flex items-center gap-1">
                  <span className={`font-bold tabular-nums ${isOver ? 'text-amber-400' : isUnder ? 'text-sky-400' : 'text-muted-foreground'}`}>
                    {ta.current}/{ta.target}
                  </span>
                  {(isOver || isUnder) && (
                    <span className={`text-[11px] ${isOver ? 'text-amber-400/70' : 'text-sky-400/70'}`}>
                      {ta.delta > 0 ? '+' : ''}{ta.delta}
                    </span>
                  )}
                </span>
              </div>
              <div className="h-1 rounded-full bg-accent/30 overflow-hidden">
                <div className={`h-full rounded-full ${color} opacity-70`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Overview: Recommendation Row ────────────────────────────────────
function RecommendationRow({ card, rank, onAdd, onPreview, added }: {
  card: RecommendedCard;
  rank: number;
  onAdd: () => void;
  onPreview: () => void;
  added: boolean;
}) {
  const rankStyle = rank < 3 ? RANK_STYLES[rank] : null;
  const badgeColor = card.roleLabel ? ROLE_BADGE_COLORS[card.roleLabel] : null;

  return (
    <div
      className={`flex items-center gap-2 py-1 px-1.5 rounded-lg border transition-all duration-200 ${
        added
          ? 'opacity-40 border-transparent'
          : rankStyle
            ? `${rankStyle.bg} ${rankStyle.border} hover:brightness-110 cursor-pointer`
            : 'border-transparent hover:bg-accent/40 cursor-pointer'
      }`}
      onClick={added ? undefined : onPreview}
    >
      <div className="relative shrink-0">
        <img
          src={card.imageUrl || scryfallImg(card.name)}
          alt={card.name}
          className="w-7 h-auto rounded shadow-md"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).src = scryfallImg(card.name); }}
        />
        {rankStyle && (
          <span className={`absolute -top-1 -left-1 text-[10px] font-bold px-0.5 py-px rounded-full shadow ${rankStyle.badge}`}>
            {rankStyle.label}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <p className={`text-sm truncate ${rankStyle ? 'font-semibold' : 'font-medium'}`}>{card.name}</p>
          {card.fillsDeficit && card.roleLabel && badgeColor && (
            <span className={`text-[10px] font-bold px-1 py-px rounded-full shrink-0 ${badgeColor}`}>
              {card.roleLabel}
            </span>
          )}
        </div>
        {card.primaryType && card.primaryType !== 'Unknown' && (
          <p className="text-xs text-muted-foreground truncate">{card.primaryType}</p>
        )}
      </div>
      <div className="text-right shrink-0 leading-tight">
        <p className="text-xs font-medium">{card.price ? `$${card.price}` : '—'}</p>
        <p className="text-[11px] text-muted-foreground tabular-nums">{Math.round(card.inclusion)}%</p>
      </div>
      {!added ? (
        <button
          onClick={(e) => { e.stopPropagation(); onAdd(); }}
          className="p-0.5 rounded-md text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors shrink-0"
          title="Add to deck"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      ) : (
        <span className="p-0.5 text-emerald-400 shrink-0">
          <Check className="w-3.5 h-3.5" />
        </span>
      )}
    </div>
  );
}

// ─── Roles Tab: Per-Role Section ─────────────────────────────────────
// ─── Roles Tab: Summary Strip ────────────────────────────────────────
function RoleSummaryStrip({
  roleBreakdowns, activeRole, onRoleClick,
}: {
  roleBreakdowns: RoleBreakdown[];
  activeRole: string | null;
  onRoleClick: (role: string) => void;
}) {
  return (
    <div className="-mx-3 sm:-mx-4 -mt-3 sm:-mt-4 grid grid-cols-2 sm:grid-cols-4 border-b border-border/30">
      {roleBreakdowns.map((rb, i) => {
        const meta = ROLE_META[rb.role];
        const Icon = meta?.icon || Shield;
        const pct = rb.target > 0 ? Math.min(100, (rb.current / rb.target) * 100) : 100;
        const met = rb.current >= rb.target;
        const isActive = activeRole === rb.role;
        return (
          <button
            key={rb.role}
            onClick={() => onRoleClick(rb.role)}
            className={`p-2.5 text-left transition-all hover:bg-card/80 ${
              i % 2 !== 0 ? 'border-l border-l-border/30' : ''
            } ${i < 2 ? 'border-b border-b-border/30 sm:border-b-0' : ''} ${
              i > 0 ? 'sm:border-l sm:border-l-border/30' : ''
            } ${
              isActive ? met ? 'bg-emerald-500/5' : 'bg-amber-500/5' : ''
            }`}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <Icon className={`w-4 h-4 ${isActive ? (meta?.color || 'text-muted-foreground') : 'text-muted-foreground'}`} />
              <span className={`text-xs font-semibold uppercase tracking-wider truncate ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                {rb.label}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5 mb-1.5">
              <span className="text-xl font-bold tabular-nums leading-none" style={{ color: roleBarColor(rb.current, rb.target) }}>
                {rb.current}
              </span>
              <span className="text-xs text-muted-foreground/60">/ {rb.target} suggested</span>
              {rb.deficit > 0 && (
                <span className="text-[10px] font-bold px-1 py-px rounded-full bg-red-500/15 text-red-400 ml-auto shrink-0">
                  -{rb.deficit}
                </span>
              )}
              {met && <Check className="w-3.5 h-3.5 text-emerald-400/50 ml-auto shrink-0" />}
            </div>
            <div className="h-1 rounded-full bg-accent/40 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: roleBarColor(rb.current, rb.target) }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Roles Tab: Detail Panel ─────────────────────────────────────────
function RoleDetailPanel({
  rb, onPreview, onAdd, addedCards, onCardAction, menuProps,
}: {
  rb: RoleBreakdown;
  onPreview: (name: string) => void;
  onAdd: (name: string) => void;
  addedCards: Set<string>;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
}) {
  const met = rb.current >= rb.target;
  const hasSuggestions = rb.suggestedReplacements.length > 0;

  return (
    <div className="-mx-3 sm:-mx-4 -mb-3 sm:-mb-4 bg-black/15 px-3 sm:px-4 py-3">
      <div className={`${hasSuggestions ? 'flex flex-col md:flex-row md:items-stretch gap-4' : ''}`}>
        {/* Left column: current cards as compact list */}
        <div className={`${hasSuggestions ? 'md:w-[30%] shrink-0' : 'w-full'}`}>
          {(() => {
            const allCards = rb.cards
              .sort((a, b) => (a.subtypeLabel || 'zzz').localeCompare(b.subtypeLabel || 'zzz') || a.card.name.localeCompare(b.card.name));
            return rb.cards.length > 0 ? (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400/60 mb-1 px-0.5 flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  In Your Deck ({allCards.length})
                </p>
                <div className="space-y-0.5">
                  {allCards.map(ac => (
                    <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showDetails onCardAction={onCardAction} menuProps={menuProps ? { userLists: menuProps.userLists, isMustInclude: menuProps.mustIncludeNames.has(ac.card.name), isBanned: menuProps.bannedNames.has(ac.card.name), isInSideboard: menuProps.sideboardNames.has(ac.card.name), isInMaybeboard: menuProps.maybeboardNames.has(ac.card.name) } : undefined} />
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/60 italic px-0.5">No cards filling this role</p>
            );
          })()}
        </div>

        {/* Vertical divider */}
        {hasSuggestions && (
          <div className="hidden md:block w-px bg-border/30 shrink-0 -my-3" />
        )}

        {/* Right column: potential replacements as card image grid */}
        {hasSuggestions && (
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/60 mb-2 px-0.5 flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              {met ? 'Potential Replacements' : 'Suggested Additions'} ({rb.suggestedReplacements.length})
            </p>
            <SuggestionCardGrid
              cards={rb.suggestedReplacements}
              onAdd={onAdd}
              onPreview={onPreview}
              addedCards={addedCards}
              deficit={rb.deficit}
              onCardAction={onCardAction}
              menuProps={menuProps}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Roles Tab: Content Orchestrator ─────────────────────────────────
function RolesTabContent({
  roleBreakdowns, activeRole, onRoleChange, onPreview, onAdd, addedCards, onCardAction, menuProps,
}: {
  roleBreakdowns: RoleBreakdown[];
  activeRole: string | null;
  onRoleChange: (role: string) => void;
  onPreview: (name: string) => void;
  onAdd: (name: string) => void;
  addedCards: Set<string>;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
}) {

  const activeRb = roleBreakdowns.find(rb => rb.role === activeRole);

  return (
    <div>
      <RoleSummaryStrip roleBreakdowns={roleBreakdowns} activeRole={activeRole} onRoleClick={onRoleChange} />
      {activeRb && (
        <RoleDetailPanel key={activeRb.role} rb={activeRb} onPreview={onPreview} onAdd={onAdd} addedCards={addedCards} onCardAction={onCardAction} menuProps={menuProps} />
      )}
    </div>
  );
}

// ─── Curve Tab: CMC Bucket Section ───────────────────────────────────
function CurveBucketSection({
  cb, onPreview, recommendations, onAdd, addedCards,
}: {
  cb: CurveBreakdown;
  onPreview: (name: string) => void;
  recommendations: RecommendedCard[];
  onAdd: (name: string) => void;
  addedCards: Set<string>;
}) {
  const [expanded, setExpanded] = useState(cb.cards.length > 0);
  const isOver = cb.delta > 0;
  const isUnder = cb.delta < 0;
  const cmcLabel = cb.cmc === 7 ? '7+' : String(cb.cmc);

  const cmcSuggestions = isUnder
    ? recommendations.slice(0, 3)
    : [];

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(p => !p)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/20 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
        <span className="text-sm font-bold tabular-nums w-10">CMC {cmcLabel}</span>
        <span className="text-xs text-muted-foreground">{cb.cards.length} cards</span>
        <span className="text-xs text-muted-foreground/60">target {cb.target}</span>
        {cb.delta !== 0 && (
          <span className={`text-xs font-bold ml-auto ${isOver ? 'text-amber-400' : 'text-sky-400'}`}>
            {isOver ? '+' : ''}{cb.delta}
          </span>
        )}
      </button>
      {expanded && cb.cards.length > 0 && (
        <div className="px-3 pb-3 space-y-0.5">
          {cb.cards.map(ac => (
            <AnalyzedCardRow
              key={ac.card.name}
              ac={ac}
              onPreview={onPreview}
              warning={isOver && ac.inclusion != null && ac.inclusion < 30 ? 'Consider cutting' : undefined}
            />
          ))}
          {cmcSuggestions.length > 0 && (
            <div className="mt-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1 px-1.5">
                Suggestions
              </p>
              {cmcSuggestions.map(rec => (
                <SuggestionRow
                  key={rec.name}
                  card={rec}
                  onAdd={() => onAdd(rec.name)}
                  onPreview={() => onPreview(rec.name)}
                  added={addedCards.has(rec.name)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════
export function DeckOptimizer({
  commanderName,
  partnerCommanderName,
  currentCards,
  deckSize,
  roleCounts,
  roleTargets,
  cardInclusionMap,
  onAddCards,
  onRemoveCards,
  onRemoveFromBoard,
  onAddBasicLand: onAddBasicLandProp,
  onRemoveBasicLand: onRemoveBasicLandProp,
  sideboardNames,
  maybeboardNames,
}: DeckOptimizerProps) {
  const [analysis, setAnalysis] = useState<DeckAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedCards, setAddedCards] = useState<Set<string>>(new Set());
  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);
  const [collapseRecs, setCollapseRecs] = useState(false);
  const cachedEdhrecDataRef = useRef<import('@/types').EDHRECCommanderData | null>(null);
  const prevCardCountRef = useRef(currentCards.length);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<LandSection | null>(null);

  // Initialize sub-tab defaults once when analysis arrives
  useEffect(() => {
    if (!analysis) return;
    if (activeRole === null && analysis.roleBreakdowns.length > 0) {
      setActiveRole(analysis.roleBreakdowns[0].role);
    }
    if (activeSection === null) {
      setActiveSection('landCount');
    }
  }, [analysis]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasDeficits = useMemo(() => {
    if (!analysis) return false;
    return analysis.roleDeficits.some(d => d.deficit > 0);
  }, [analysis]);

  const totalRecCost = useMemo(() => {
    if (!analysis) return 0;
    return analysis.recommendations
      .filter(r => !addedCards.has(r.name))
      .reduce((sum, r) => sum + (r.price ? parseFloat(r.price) || 0 : 0), 0);
  }, [analysis, addedCards]);

  // For the Types tab — group current cards by type
  const typeCardGroups = useMemo(() => {
    if (!analysis) return new Map<string, AnalyzedCard[]>();
    const incMap = cardInclusionMap || {};
    const groups = new Map<string, AnalyzedCard[]>();

    const nonLandCards = currentCards.filter(
      c => !getFrontFaceTypeLine(c).toLowerCase().includes('land')
    );

    for (const card of nonLandCards) {
      const tl = getFrontFaceTypeLine(card).toLowerCase();
      let type = 'other';
      if (tl.includes('creature')) type = 'creature';
      else if (tl.includes('instant')) type = 'instant';
      else if (tl.includes('sorcery')) type = 'sorcery';
      else if (tl.includes('artifact')) type = 'artifact';
      else if (tl.includes('enchantment')) type = 'enchantment';
      else if (tl.includes('planeswalker')) type = 'planeswalker';
      else if (tl.includes('battle')) type = 'battle';

      if (!groups.has(type)) groups.set(type, []);
      const subtype = card.rampSubtype || card.removalSubtype || card.boardwipeSubtype || card.cardDrawSubtype;
      groups.get(type)!.push({
        card,
        inclusion: incMap[card.name] ?? null,
        role: card.deckRole || undefined,
        roleLabel: card.deckRole ? ({ ramp: 'Ramp', removal: 'Removal', boardwipe: 'Board Wipes', cardDraw: 'Card Advantage' }[card.deckRole] || card.deckRole) : undefined,
        subtype: subtype || undefined,
        subtypeLabel: undefined,
      });
    }

    // Sort each group by inclusion desc
    for (const [, cards] of groups) {
      cards.sort((a, b) => (b.inclusion ?? -1) - (a.inclusion ?? -1));
    }

    return groups;
  }, [analysis, currentCards, cardInclusionMap]);

  const handleOptimize = async () => {
    setLoading(true);
    setError(null);
    try {
      await loadTaggerData();
      const edhrecData = partnerCommanderName
        ? await fetchPartnerCommanderData(commanderName, partnerCommanderName)
        : await fetchCommanderData(commanderName);
      cachedEdhrecDataRef.current = edhrecData;

      // Build inclusion map from EDHREC data if not provided
      let effectiveInclusionMap = cardInclusionMap;
      if (!effectiveInclusionMap) {
        const built: Record<string, number> = {};
        const indexCard = (name: string, inclusion: number) => {
          built[name] = inclusion;
          // Also index by front-face name for DFC lookup
          if (name.includes(' // ')) built[name.split(' // ')[0]] = inclusion;
        };
        for (const c of edhrecData.cardlists.allNonLand) indexCard(c.name, c.inclusion);
        for (const c of edhrecData.cardlists.lands) indexCard(c.name, c.inclusion);
        // Cross-reference: for each deck card with //, also try front-face lookup
        for (const card of currentCards) {
          if (card.name.includes(' // ') && built[card.name] === undefined) {
            const front = card.name.split(' // ')[0];
            if (built[front] !== undefined) built[card.name] = built[front];
          }
        }
        effectiveInclusionMap = built;
      }

      const storeColorIdentity = useStore.getState().colorIdentity;
      const result = analyzeDeck(
        edhrecData,
        currentCards,
        roleCounts,
        roleTargets,
        deckSize,
        effectiveInclusionMap,
        storeColorIdentity,
      );

      // Collect all RecommendedCard objects missing prices or producedColors
      const allRecs: RecommendedCard[] = [
        ...result.recommendations,
        ...result.landRecommendations,
        ...(result.colorFixing.fixingRecommendations || []),
        ...result.roleBreakdowns.flatMap(rb => rb.suggestedReplacements),
      ];
      const needsFetch = [...new Set(allRecs.filter(r => !r.price || !r.producedColors?.length).map(r => r.name))];

      if (needsFetch.length > 0) {
        try {
          const scryfallCards = await getCardsByNames(needsFetch);
          const priceMap = new Map<string, string>();
          const colorMap = new Map<string, string[]>();
          for (const [name, card] of scryfallCards) {
            const p = getCardPrice(card);
            if (p) priceMap.set(name, p);
            // Resolve produced colors from Scryfall data
            const produced = (card.produced_mana || []).filter((c: string) => ['W', 'U', 'B', 'R', 'G'].includes(c));
            if (produced.length > 0) {
              colorMap.set(name, [...new Set(produced)]);
            } else if (card.color_identity?.length) {
              colorMap.set(name, card.color_identity.map((c: string) => c.toUpperCase()));
            }
          }
          for (const rec of allRecs) {
            if (!rec.price) rec.price = priceMap.get(rec.name) || undefined;
            if (!rec.producedColors?.length) rec.producedColors = colorMap.get(rec.name) || undefined;
          }
        } catch { /* prices/colors are nice-to-have, don't block on failure */ }
      }

      setAnalysis(result);
      setAddedCards(new Set());
    } catch (err) {
      setError('Failed to fetch EDHREC data. Please try again.');
      console.error('[DeckOptimizer]', err);
    } finally {
      setLoading(false);
    }
  };

  // Re-run analysis when cards change (add/remove) if we have cached EDHREC data
  useEffect(() => {
    if (!cachedEdhrecDataRef.current || !analysis) return;
    if (currentCards.length === prevCardCountRef.current) return;
    prevCardCountRef.current = currentCards.length;

    // Build inclusion map from EDHREC data if not provided
    let effectiveInclusionMap = cardInclusionMap;
    if (!effectiveInclusionMap) {
      const edhrecData = cachedEdhrecDataRef.current;
      const built: Record<string, number> = {};
      const indexCard = (name: string, inclusion: number) => {
        built[name] = inclusion;
        if (name.includes(' // ')) built[name.split(' // ')[0]] = inclusion;
      };
      for (const c of edhrecData.cardlists.allNonLand) indexCard(c.name, c.inclusion);
      for (const c of edhrecData.cardlists.lands) indexCard(c.name, c.inclusion);
      for (const card of currentCards) {
        if (card.name.includes(' // ') && built[card.name] === undefined) {
          const front = card.name.split(' // ')[0];
          if (built[front] !== undefined) built[card.name] = built[front];
        }
      }
      effectiveInclusionMap = built;
    }

    const storeColorIdentity = useStore.getState().colorIdentity;
    const result = analyzeDeck(
      cachedEdhrecDataRef.current,
      currentCards,
      roleCounts,
      roleTargets,
      deckSize,
      effectiveInclusionMap,
      storeColorIdentity,
    );
    setAnalysis(result);
  }, [currentCards, roleCounts, roleTargets, deckSize, cardInclusionMap, analysis]);

  const handleAddCard = (name: string) => {
    if (!onAddCards) return;
    onAddCards([name], 'deck');
    setAddedCards(prev => new Set([...prev, name]));
  };

  const handlePreview = async (name: string) => {
    try {
      const card = await getCardByName(name);
      if (card) setPreviewCard(card);
    } catch { /* silently fail */ }
  };

  // Context menu support
  const { customization, updateCustomization } = useStore();
  const { lists: userLists, updateList } = useUserLists();

  const handleCardAction = useCallback((card: ScryfallCard, action: CardAction) => {
    const name = card.name;
    switch (action.type) {
      case 'remove':
        onRemoveCards?.([name]);
        break;
      case 'addToDeck':
        onAddCards?.([name], 'deck');
        setAddedCards(prev => new Set([...prev, name]));
        break;
      case 'sideboard': {
        if (sideboardNames?.includes(name)) {
          onRemoveFromBoard?.(name, 'sideboard');
        } else {
          onAddCards?.([name], 'sideboard');
        }
        break;
      }
      case 'maybeboard': {
        if (maybeboardNames?.includes(name)) {
          onRemoveFromBoard?.(name, 'maybeboard');
        } else {
          onAddCards?.([name], 'maybeboard');
        }
        break;
      }
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
        const list = userLists.find(l => l.id === action.listId);
        if (list && !list.cards.includes(name)) {
          updateList(action.listId, { cards: [...list.cards, name] });
        }
        break;
      }
    }
  }, [customization, updateCustomization, userLists, updateList, onAddCards, onRemoveCards, onRemoveFromBoard, sideboardNames, maybeboardNames]);

  const menuProps = useMemo(() => ({
    userLists,
    mustIncludeNames: new Set(customization.mustIncludeCards),
    bannedNames: new Set(customization.bannedCards),
    sideboardNames: new Set(sideboardNames || []),
    maybeboardNames: new Set(maybeboardNames || []),
  }), [userLists, customization.mustIncludeCards, customization.bannedCards, sideboardNames, maybeboardNames]);

  // --- Pre-analysis: prominent CTA ---
  if (!analysis && !loading) {
    return (
      <div className="mt-8 flex flex-col items-center gap-3">
        <p className="text-xs text-muted-foreground text-center max-w-sm">
          Analyze your deck against EDHREC data for optimization suggestions
        </p>
        <Button
          onClick={handleOptimize}
          className="btn-shimmer px-8 py-3 text-sm font-semibold gap-2.5"
          disabled={loading}
        >
          <Sparkles className="w-4 h-4" />
          Optimize My Deck
        </Button>
      </div>
    );
  }

  // --- Loading ---
  if (loading) {
    return (
      <div className="mt-8 p-6 rounded-xl border border-border/30 bg-card/30 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="relative">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <Sparkles className="absolute -top-1 -right-1 w-3 h-3 text-primary/50 animate-pulse" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">Analyzing your deck...</p>
            <p className="text-xs text-muted-foreground mt-1">Fetching EDHREC data for {commanderName}</p>
          </div>
        </div>
      </div>
    );
  }

  // --- Error ---
  if (error) {
    return (
      <div className="mt-8 p-6 rounded-xl border border-red-500/20 bg-red-500/5 text-center">
        <p className="text-sm text-red-400 mb-3">{error}</p>
        <button
          onClick={handleOptimize}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors mx-auto"
        >
          <RefreshCw className="w-3 h-3" />
          Try Again
        </button>
      </div>
    );
  }

  if (!analysis) return null;

  // ═════════════════════════════════════════════════════════════════════
  // Dashboard Render
  // ═════════════════════════════════════════════════════════════════════
  return (
    <div className="mt-6 rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30 bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-primary/10">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
          </div>
          <h3 className="text-sm font-bold">Deck Analysis</h3>
        </div>
        <button
          onClick={handleOptimize}
          className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-lg border border-border/50 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Re-analyze
        </button>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-0.5 px-3 py-1.5 border-b border-border/20 bg-card/30 overflow-x-auto">
        {TABS.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="p-3 sm:p-4">

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && (
          <div className="space-y-3">
            <DeckHealthStrip analysis={analysis} onNavigate={setActiveTab} />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <RoleBalancePanel deficits={analysis.roleDeficits} hasDeficits={hasDeficits} onNavigate={() => setActiveTab('roles')} />
              <CurvePanel slots={analysis.curveAnalysis} onNavigate={() => setActiveTab('curve')} />
              <ManaBasePanel manaBase={analysis.manaBase} onNavigate={() => setActiveTab('lands')} />
            </div>

            <div className="flex gap-3 items-start">
              <div className="flex-1 min-w-0 bg-card/60 border border-border/30 rounded-lg p-3">
                <button
                  onClick={() => setCollapseRecs(p => !p)}
                  className="w-full flex items-center gap-2 mb-2 text-left group"
                >
                  {collapseRecs
                    ? <ChevronRight className="w-3 h-3 text-muted-foreground" />
                    : <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  }
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">
                    Recommended Cards
                  </span>
                  <span className="text-[11px] text-muted-foreground/60">({analysis.recommendations.length})</span>
                  <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground/50">
                    <ShoppingCart className="w-3 h-3" />
                    ~${totalRecCost.toFixed(2)}
                  </span>
                </button>
                {!collapseRecs && (
                  <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-x-2 gap-y-0.5">
                    {analysis.recommendations.map((rec, i) => (
                      <RecommendationRow
                        key={rec.name}
                        card={rec}
                        rank={i}
                        onAdd={() => handleAddCard(rec.name)}
                        onPreview={() => handlePreview(rec.name)}
                        added={addedCards.has(rec.name)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="hidden md:block w-44 shrink-0">
                <TypeSidebar types={analysis.typeAnalysis} />
              </div>
            </div>

            <div className="md:hidden">
              <TypeSidebar types={analysis.typeAnalysis} />
            </div>
          </div>
        )}

        {/* ── ROLES TAB ── */}
        {activeTab === 'roles' && (
          <RolesTabContent
            roleBreakdowns={analysis.roleBreakdowns}
            activeRole={activeRole}
            onRoleChange={setActiveRole}
            onPreview={handlePreview}
            onAdd={handleAddCard}
            addedCards={addedCards}
            onCardAction={handleCardAction}
            menuProps={menuProps}
          />
        )}

        {/* ── LANDS TAB ── */}
        {activeTab === 'lands' && (
          <LandsTabContent
            analysis={analysis}
            activeSection={activeSection}
            onSectionChange={setActiveSection}
            onPreview={handlePreview}
            onAdd={handleAddCard}
            addedCards={addedCards}
            currentCards={currentCards}
            onCardAction={handleCardAction}
            menuProps={menuProps}
            onAddBasicLand={onAddBasicLandProp ?? (onAddCards ? (name) => onAddCards([name], 'deck') : undefined)}
            onRemoveBasicLand={onRemoveBasicLandProp ?? (onRemoveCards ? (name) => onRemoveCards([name]) : undefined)}
            cardInclusionMap={cardInclusionMap}
          />
        )}

        {/* ── CURVE TAB ── */}
        {activeTab === 'curve' && (
          <div className="space-y-3">
            <CurvePanel slots={analysis.curveAnalysis} tall />
            <div className="space-y-2">
              {analysis.curveBreakdowns
                .filter(cb => cb.cards.length > 0 || cb.target > 0)
                .map(cb => (
                  <CurveBucketSection
                    key={cb.cmc}
                    cb={cb}
                    onPreview={handlePreview}
                    recommendations={analysis.recommendations}
                    onAdd={handleAddCard}
                    addedCards={addedCards}
                  />
                ))}
            </div>
          </div>
        )}

        {/* ── TYPES TAB ── */}
        {activeTab === 'types' && (
          <div className="space-y-3">
            {/* Full-width type distribution bars */}
            <div className="bg-card/60 border border-border/30 rounded-lg p-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">Type Distribution</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {analysis.typeAnalysis.map(ta => {
                  const pct = ta.target > 0 ? Math.min(100, (ta.current / ta.target) * 100) : 100;
                  const isOver = ta.delta > 2;
                  const isUnder = ta.delta < -2;
                  const color = isOver ? 'bg-amber-500' : isUnder ? 'bg-sky-500' : 'bg-emerald-500';
                  return (
                    <div key={ta.type}>
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="text-muted-foreground capitalize font-medium">{ta.type}</span>
                        <span className="flex items-center gap-1">
                          <span className={`font-bold tabular-nums ${isOver ? 'text-amber-400' : isUnder ? 'text-sky-400' : 'text-muted-foreground'}`}>
                            {ta.current}/{ta.target}
                          </span>
                          {(isOver || isUnder) && (
                            <span className={`text-[11px] ${isOver ? 'text-amber-400/70' : 'text-sky-400/70'}`}>
                              {ta.delta > 0 ? '+' : ''}{ta.delta}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-accent/30 overflow-hidden">
                        <div className={`h-full rounded-full ${color} opacity-70`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Per-type card lists */}
            {analysis.typeAnalysis.map(ta => {
              const cards = typeCardGroups.get(ta.type);
              if (!cards || cards.length === 0) return null;
              const isOver = ta.delta > 2;
              const isUnder = ta.delta < -2;

              return (
                <TypeCardSection
                  key={ta.type}
                  type={ta.type}
                  cards={cards}
                  current={ta.current}
                  target={ta.target}
                  delta={ta.delta}
                  isOver={isOver}
                  isUnder={isUnder}
                  onPreview={handlePreview}
                />
              );
            })}
          </div>
        )}
      </div>

      <CardPreviewModal card={previewCard} onClose={() => setPreviewCard(null)} />
    </div>
  );
}

// ─── Types Tab: Per-Type Card Section ────────────────────────────────
function TypeCardSection({
  type, cards, current, target, delta, isOver, isUnder, onPreview,
}: {
  type: string;
  cards: AnalyzedCard[];
  current: number;
  target: number;
  delta: number;
  isOver: boolean;
  isUnder: boolean;
  onPreview: (name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(p => !p)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/20 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
        <span className="text-sm font-bold capitalize">{type}</span>
        <span className={`text-xs font-bold tabular-nums ${isOver ? 'text-amber-400' : isUnder ? 'text-sky-400' : 'text-muted-foreground'}`}>
          {current}/{target}
        </span>
        {(isOver || isUnder) && (
          <span className={`text-[11px] ${isOver ? 'text-amber-400/70' : 'text-sky-400/70'}`}>
            {delta > 0 ? '+' : ''}{delta}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-0.5">
          {cards.map(ac => (
            <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} />
          ))}
        </div>
      )}
    </div>
  );
}
