import { useState, useMemo, useCallback } from 'react';
import {
  Loader2, Sparkles, Plus, Check, ShoppingCart, RefreshCw,
  Shield, Swords, Flame, BookOpen,
  TrendingUp, TrendingDown,
  ChevronDown, ChevronRight,
  LayoutDashboard, Mountain, BarChart3, Layers,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ScryfallCard, DeckCategory, UserCardList } from '@/types';
import { fetchCommanderData, fetchPartnerCommanderData } from '@/services/edhrec/client';
import { loadTaggerData } from '@/services/tagger/client';
import { analyzeDeck, type DeckAnalysis, type RecommendedCard, type AnalyzedCard, type RoleBreakdown, type CurveBreakdown } from '@/services/deckBuilder/deckAnalyzer';
import { getCardByName, getCardsByNames, getCardPrice, getFrontFaceTypeLine } from '@/services/scryfall/client';
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
  onRemoveFromBoard?: (cardName: string, source: 'sideboard' | 'maybeboard') => void;
  sideboardNames?: string[];
  maybeboardNames?: string[];
}

type TabKey = 'overview' | 'roles' | 'lands' | 'curve' | 'types';

const TABS: { key: TabKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'roles',    label: 'Roles',    icon: Shield },
  { key: 'lands',    label: 'Lands',    icon: Mountain },
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
  ac, onPreview, warning, showDetails, onCardAction, menuProps,
}: {
  ac: AnalyzedCard;
  onPreview: (name: string) => void;
  warning?: string;
  showDetails?: boolean;
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
        <span className="text-[10px] text-muted-foreground/60 truncate block">{primaryType}</span>
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
  const pct = Math.round(rec.inclusion);
  const roleBadges = rec.allRoleLabels && rec.allRoleLabels.length > 1
    ? rec.allRoleLabels
    : rec.roleLabel ? [rec.roleLabel] : [];

  // Create a minimal ScryfallCard-like object for the context menu
  const pseudoCard = useMemo(() => ({ name: rec.name, id: rec.name } as ScryfallCard), [rec.name]);

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
          src={rec.imageUrl || scryfallImg(rec.name, 'normal')}
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
      <div className="flex items-center gap-1 px-0.5 -mt-0.5 min-w-0">
        <span
          className="text-[10px] font-bold tabular-nums shrink-0"
          style={{ color: `hsl(${Math.min(pct / 50, 1) * 120}, 70%, 55%)` }}
        >
          {pct}%
        </span>
        <span className="text-[11px] truncate flex-1 min-w-0 text-muted-foreground text-center">{rec.name}</span>
        {rec.price && (
          <span className="text-[10px] text-muted-foreground/60 shrink-0">${rec.price}</span>
        )}
      </div>
      {/* Row 2: role tags */}
      {roleBadges.length > 0 && (
        <div className="flex items-center gap-1 px-0.5 min-w-0 flex-wrap justify-center">
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

// ─── Overview Panel: Role Balance ──────────────────────────────────
function RoleBalancePanel({ deficits, hasDeficits }: { deficits: DeckAnalysis['roleDeficits']; hasDeficits: boolean }) {
  const totalDeficit = deficits.reduce((sum, rd) => sum + Math.max(0, rd.deficit), 0);
  const rolesShort = deficits.filter(rd => rd.deficit > 0).length;

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Roles</span>
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

function CurvePanel({ slots, tall }: { slots: DeckAnalysis['curveAnalysis']; tall?: boolean }) {
  const [mode, setMode] = useState<CurveMode>('line');
  const maxVal = Math.max(...slots.flatMap(s => [s.current, s.target]), 1);

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg p-3 flex flex-col">
      <div className="flex items-center gap-1.5 mb-2 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Mana Curve</span>
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

// ─── Overview Panel: Mana Base ─────────────────────────────────────
function ManaBasePanel({ manaBase }: { manaBase: DeckAnalysis['manaBase'] }) {
  const vs = VERDICT_STYLES[manaBase.verdict] || VERDICT_STYLES['ok'];
  const landDelta = manaBase.currentLands - manaBase.adjustedSuggestion;

  return (
    <div className={`border rounded-lg p-3 ${vs.border} ${vs.bg}`}>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Mana Base</span>
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
        const hasLowInclusion = rb.cards.some(ac => ac.inclusion != null && ac.inclusion < 25);
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
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">
                {rb.label}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5 mb-1.5">
              <span className="text-xl font-bold tabular-nums leading-none" style={{ color: roleBarColor(rb.current, rb.target) }}>
                {rb.current}
              </span>
              <span className="text-xs text-muted-foreground/60">/ {rb.target}</span>
              {rb.deficit > 0 && (
                <span className="text-[10px] font-bold px-1 py-px rounded-full bg-red-500/15 text-red-400 ml-auto shrink-0">
                  -{rb.deficit}
                </span>
              )}
              {met && !hasLowInclusion && <Check className="w-3.5 h-3.5 text-emerald-400/50 ml-auto shrink-0" />}
              {met && hasLowInclusion && <AlertTriangle className="w-3.5 h-3.5 text-amber-400/50 ml-auto shrink-0" />}
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
            const solidCards = rb.cards
              .filter(ac => ac.inclusion == null || ac.inclusion >= 25)
              .sort((a, b) => (a.subtypeLabel || 'zzz').localeCompare(b.subtypeLabel || 'zzz') || a.card.name.localeCompare(b.card.name));
            const weakCards = rb.cards.filter(ac => ac.inclusion != null && ac.inclusion < 25);
            return rb.cards.length > 0 ? (
              <div className="space-y-3">
                {solidCards.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400/60 mb-1 px-0.5 flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      In Your Deck ({solidCards.length})
                    </p>
                    <div className="space-y-0.5">
                      {solidCards.map(ac => (
                        <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} showDetails onCardAction={onCardAction} menuProps={menuProps ? { userLists: menuProps.userLists, isMustInclude: menuProps.mustIncludeNames.has(ac.card.name), isBanned: menuProps.bannedNames.has(ac.card.name), isInSideboard: menuProps.sideboardNames.has(ac.card.name), isInMaybeboard: menuProps.maybeboardNames.has(ac.card.name) } : undefined} />
                      ))}
                    </div>
                  </div>
                )}
                {weakCards.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-400/60 mb-1 px-0.5 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Needs Attention ({weakCards.length})
                    </p>
                    <div className="space-y-0.5">
                      {weakCards.map(ac => (
                        <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} warning="Low inclusion — consider swapping" showDetails onCardAction={onCardAction} menuProps={menuProps ? { userLists: menuProps.userLists, isMustInclude: menuProps.mustIncludeNames.has(ac.card.name), isBanned: menuProps.bannedNames.has(ac.card.name), isInSideboard: menuProps.sideboardNames.has(ac.card.name), isInMaybeboard: menuProps.maybeboardNames.has(ac.card.name) } : undefined} />
                      ))}
                    </div>
                  </div>
                )}
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
  roleBreakdowns, onPreview, onAdd, addedCards, onCardAction, menuProps,
}: {
  roleBreakdowns: RoleBreakdown[];
  onPreview: (name: string) => void;
  onAdd: (name: string) => void;
  addedCards: Set<string>;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
}) {
  // Default to the first role with a deficit, or the first role
  const [activeRole, setActiveRole] = useState<string | null>(() => {
    const deficit = roleBreakdowns.find(rb => rb.deficit > 0 || rb.cards.some(ac => ac.inclusion != null && ac.inclusion < 25));
    return deficit?.role ?? roleBreakdowns[0]?.role ?? null;
  });

  const toggleRole = (role: string) => {
    setActiveRole(prev => prev === role ? null : role);
  };

  const activeRb = roleBreakdowns.find(rb => rb.role === activeRole);

  return (
    <div>
      <RoleSummaryStrip roleBreakdowns={roleBreakdowns} activeRole={activeRole} onRoleClick={toggleRole} />
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
  onRemoveFromBoard,
  sideboardNames,
  maybeboardNames,
}: DeckOptimizerProps) {
  const [analysis, setAnalysis] = useState<DeckAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedCards, setAddedCards] = useState<Set<string>>(new Set());
  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);
  const [collapseRecs, setCollapseRecs] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

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

      const result = analyzeDeck(
        edhrecData,
        currentCards,
        roleCounts,
        roleTargets,
        deckSize,
        cardInclusionMap,
      );

      // Collect all RecommendedCard objects missing prices
      const allRecs: RecommendedCard[] = [
        ...result.recommendations,
        ...result.landRecommendations,
        ...result.roleBreakdowns.flatMap(rb => rb.suggestedReplacements),
      ];
      const missingPriceNames = [...new Set(allRecs.filter(r => !r.price).map(r => r.name))];

      if (missingPriceNames.length > 0) {
        try {
          const scryfallCards = await getCardsByNames(missingPriceNames);
          const priceMap = new Map<string, string>();
          for (const [name, card] of scryfallCards) {
            const p = getCardPrice(card);
            if (p) priceMap.set(name, p);
          }
          for (const rec of allRecs) {
            if (!rec.price) rec.price = priceMap.get(rec.name) || undefined;
          }
        } catch { /* prices are nice-to-have, don't block on failure */ }
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
  }, [customization, updateCustomization, userLists, updateList, onAddCards, onRemoveFromBoard, sideboardNames, maybeboardNames]);

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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <RoleBalancePanel deficits={analysis.roleDeficits} hasDeficits={hasDeficits} />
              <CurvePanel slots={analysis.curveAnalysis} />
              <ManaBasePanel manaBase={analysis.manaBase} />
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
            onPreview={handlePreview}
            onAdd={handleAddCard}
            addedCards={addedCards}
            onCardAction={handleCardAction}
            menuProps={menuProps}
          />
        )}

        {/* ── LANDS TAB ── */}
        {activeTab === 'lands' && (
          <div className="space-y-3">
            {/* Verdict banner */}
            <ManaBasePanel manaBase={analysis.manaBase} />

            {/* Land cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Nonbasic lands */}
              <div className="bg-card/60 border border-border/30 rounded-lg p-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Nonbasic Lands ({analysis.landCards.filter(ac => !/\bbasic\b/.test(getFrontFaceTypeLine(ac.card).toLowerCase())).length})
                </div>
                <div className="space-y-0.5 max-h-64 overflow-y-auto">
                  {analysis.landCards
                    .filter(ac => !/\bbasic\b/.test(getFrontFaceTypeLine(ac.card).toLowerCase()))
                    .map(ac => (
                      <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={handlePreview} />
                    ))}
                </div>
              </div>

              {/* Basic lands — grouped by name */}
              <div className="bg-card/60 border border-border/30 rounded-lg p-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Basic Lands ({analysis.manaBase.currentBasic})
                </div>
                <div className="space-y-0.5">
                  {(() => {
                    const basics = analysis.landCards.filter(ac =>
                      /\bbasic\b/.test(getFrontFaceTypeLine(ac.card).toLowerCase())
                    );
                    const grouped = new Map<string, { ac: AnalyzedCard; count: number }>();
                    for (const ac of basics) {
                      const existing = grouped.get(ac.card.name);
                      if (existing) existing.count++;
                      else grouped.set(ac.card.name, { ac, count: 1 });
                    }
                    return [...grouped.values()].map(({ ac, count }) => (
                      <div
                        key={ac.card.name}
                        className="flex items-center gap-2 py-0.5 px-1.5 rounded-lg cursor-pointer hover:bg-accent/40 transition-colors border border-transparent"
                        onClick={() => handlePreview(ac.card.name)}
                      >
                        <img
                          src={scryfallImg(ac.card.name)}
                          alt={ac.card.name}
                          className="w-6 h-auto rounded shadow shrink-0"
                          loading="lazy"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        <span className="text-xs truncate flex-1 min-w-0">
                          {count}x {ac.card.name}
                        </span>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </div>

            {/* Ramp cards */}
            {analysis.rampCards.length > 0 && (
              <div className="bg-card/60 border border-border/30 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400/70" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Ramp ({analysis.rampCards.length})
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0.5">
                  {analysis.rampCards.map(ac => (
                    <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={handlePreview} />
                  ))}
                </div>
              </div>
            )}

            {/* Land recommendations */}
            {analysis.landRecommendations.length > 0 && (
              <div className="bg-card/60 border border-border/30 rounded-lg p-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Suggested Lands
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0.5">
                  {analysis.landRecommendations.map(rec => (
                    <SuggestionRow
                      key={rec.name}
                      card={rec}
                      onAdd={() => handleAddCard(rec.name)}
                      onPreview={() => handlePreview(rec.name)}
                      added={addedCards.has(rec.name)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
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
