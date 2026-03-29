import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Sparkles, Plus, Minus, Check,
  Shield, Ban, LayoutDashboard,
  Lightbulb, Tag, ArrowUpDown, Pencil, Gauge,
  RotateCcw, Loader2, Info, Zap, Mountain, BarChart3,
} from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { ScryfallCard, UserCardList, EDHRECTheme } from '@/types';
import type { DeckAnalysis, RecommendedCard, AnalyzedCard, GradeResult, SummaryItem } from '@/services/deckBuilder/deckAnalyzer';
import { getDeckSummaryData, summaryIconSvg } from '@/services/deckBuilder/deckAnalyzer';
import type { DetectedThemeResult, Pacing } from '@/services/deckBuilder/themeDetector';
import { getCardPrice } from '@/services/scryfall/client';
import { CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import {
  scryfallImg, edhrecRankToInclusion,
  ROLE_LABEL_ICONS, SUBTYPE_BADGE_COLORS,
  HEALTH_GRADE_STYLES, TEMPO_OPTIONS,
  BRACKET_COLORS,
  SORT_KEY, sortListeners,
  type TabKey, type SuggestionSortMode,
} from './constants';
import { useStore } from '@/store';

// ─── Suggestion Sort Hook ─────────────────────────────────────────────

export function useSuggestionSort() {
  const [mode, setMode] = useState<SuggestionSortMode>(
    () => (localStorage.getItem(SORT_KEY) as SuggestionSortMode) || 'relevance'
  );
  useEffect(() => {
    sortListeners.add(setMode);
    return () => { sortListeners.delete(setMode); };
  }, []);
  const set = useCallback((m: SuggestionSortMode) => {
    localStorage.setItem(SORT_KEY, m);
    sortListeners.forEach(fn => fn(m));
  }, []);
  return [mode, set] as const;
}

// ─── Shared: Suggestion Card Grid (for upgrade recommendations) ──────

export function SuggestionCardGrid({
  cards, onAdd, onPreview, addedCards, deficit = 0, onCardAction, menuProps, title, hideSort,
}: {
  cards: RecommendedCard[];
  onAdd: (name: string) => void;
  onPreview: (name: string) => void;
  addedCards: Set<string>;
  deficit?: number;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
  title?: React.ReactNode;
  hideSort?: boolean;
}) {
  const [sortMode, setSortMode] = useSuggestionSort();
  const sorted = useMemo(() => {
    if (hideSort) return cards;
    if (sortMode === 'popularity') {
      return [...cards].sort((a, b) => b.inclusion - a.inclusion);
    }
    return cards; // already sorted by score from analyzeDeck
  }, [cards, sortMode, hideSort]);

  return (
    <div>
      {(title || !hideSort) && (
        <div className="flex items-center gap-2 mb-1.5 px-0.5">
          {title && (
            <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80 flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              {title}
            </p>
          )}
          {!hideSort && (
            <div className="ml-auto flex items-center gap-1">
              <ArrowUpDown className="w-3 h-3 text-muted-foreground/40" />
              <div className="flex items-center border border-border/50 rounded-md overflow-hidden">
                <button
                  onClick={() => setSortMode('relevance')}
                  className={`text-[10px] px-2 py-0.5 transition-colors ${sortMode === 'relevance' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/50'}`}
                >
                  Relevance
                </button>
                <div className="w-px h-3 bg-border/50" />
                <button
                  onClick={() => setSortMode('popularity')}
                  className={`text-[10px] px-2 py-0.5 transition-colors ${sortMode === 'popularity' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/50'}`}
                >
                  Popularity
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {sorted.map((rec, i) => (
          <SuggestionCardItem
            key={rec.name}
            rec={rec}
            index={i}
            added={addedCards.has(rec.name)}
            highlighted={deficit > 0 && i < deficit && !addedCards.has(rec.name)}
            onAdd={onAdd}
            onPreview={onPreview}
            onCardAction={onCardAction}
            menuProps={menuProps}
            sortMode={hideSort ? 'none' : sortMode}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Suggestion Card Item ─────────────────────────────────────────────

export function SuggestionCardItem({
  rec, index = 0, added, highlighted, onAdd, onPreview, onCardAction, menuProps, sortMode = 'relevance',
}: {
  rec: RecommendedCard;
  index?: number;
  added: boolean;
  highlighted: boolean;
  onAdd: (name: string) => void;
  onPreview: (name: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
  sortMode?: SuggestionSortMode;
}) {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const pct = Math.round(rec.inclusion);
  const roleBadges = rec.allRoleLabels && rec.allRoleLabels.length > 1
    ? rec.allRoleLabels
    : rec.roleLabel ? [rec.roleLabel] : [];
  // Land classification tags (appended after role badges)
  const landTags: string[] = [];
  if (rec.isUtilityLand) landTags.push('Utility');
  const allBadges = [...roleBadges, ...landTags];

  // Create a minimal ScryfallCard-like object for the context menu
  const pseudoCard = useMemo(() => ({ name: rec.name, id: rec.name } as ScryfallCard), [rec.name]);

  const isBanned = menuProps?.bannedNames.has(rec.name);
  const frontUrl = rec.imageUrl || scryfallImg(rec.name, 'normal');
  const backUrl = rec.backImageUrl;
  const displayUrl = flipped && backUrl ? backUrl : frontUrl;

  return (
    <div
      className={`group relative transition-opacity duration-300 cascade-in ${added ? 'opacity-40' : ''}`}
      style={{ '--cascade-i': index } as React.CSSProperties}
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
          className={`w-full aspect-[5/7] rounded-lg shadow bg-accent/20 ${highlighted ? 'border border-emerald-500/60' : ''}`}
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
          <span className="absolute top-0 left-0 rounded-tl-lg rounded-br-lg bg-black/60 text-white p-2 animate-pop-in">
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
        {isBanned && (
          <span className="absolute top-0 right-0 rounded-tr-lg rounded-bl-lg bg-red-900/80 text-white p-1.5 animate-pop-in" title="Excluded">
            <Ban className="w-4 h-4" />
          </span>
        )}
      </button>
      {/* Context menu — outside <button> to avoid nested-button DOM warning */}
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
      {/* Row 1: metric, name, price */}
      <div className="flex items-center gap-1 px-4 -mt-0.5 min-w-0">
        {sortMode === 'none' ? null : sortMode === 'popularity' ? (
          pct >= 0 && (
            <span
              className="text-[10px] font-bold tabular-nums shrink-0"
              style={{ color: `hsl(${Math.min(pct / 50, 1) * 120}, 70%, 55%)` }}
            >
              {pct}%
            </span>
          )
        ) : (
          <span
            className="text-[10px] font-bold tabular-nums shrink-0 text-violet-400"
            title={`Relevance score: ${Math.round(rec.score ?? 0)} (inclusion: ${pct}%)`}
          >
            {Math.round(rec.score ?? 0)}
          </span>
        )}
        <span className="text-[11px] truncate flex-1 min-w-0 text-muted-foreground text-center">{rec.name}</span>
        {rec.isGameChanger && (
          <span className="text-[10px] font-bold text-amber-500/70 shrink-0" title="Game Changer (EDHREC)">GC</span>
        )}
        {rec.price && (
          <span className="text-[10px] text-muted-foreground shrink-0">${rec.price}</span>
        )}
      </div>
      {/* Row 2: role + land tags */}
      {allBadges.length > 0 && (
        <div className="flex items-center gap-1 px-1 min-w-0 justify-center flex-wrap">
          {allBadges.map(label => {
            const badgeColor = SUBTYPE_BADGE_COLORS[label];
            const RIcon = ROLE_LABEL_ICONS[label];
            if (!badgeColor || !RIcon) return null;
            return (
              <span key={label} className={`inline-flex items-center gap-0.5 px-1.5 py-px rounded-full text-[9px] font-medium ${badgeColor}`}>
                <RIcon className="w-2.5 h-2.5 shrink-0" />
                {label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Shared: Cut Card Grid (for lands to remove) ─────────────────────

export function CutCardGrid({
  cards, onRemove, onPreview, removedCards, excess, onCardAction, menuProps, cardInclusionMap, sortMode,
}: {
  cards: AnalyzedCard[];
  onRemove: (card: ScryfallCard) => void;
  onPreview: (name: string) => void;
  removedCards: Set<string>;
  excess: number;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
  cardInclusionMap?: Record<string, number>;
  sortMode?: 'inclusion' | 'score';
}) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {cards.map((ac, i) => (
        <CutCardItem
          key={ac.card.name}
          ac={ac}
          index={i}
          removed={removedCards.has(ac.card.name)}
          highlighted={excess > 0 && i < excess && !removedCards.has(ac.card.name)}
          onRemove={onRemove}
          onPreview={onPreview}
          onCardAction={onCardAction}
          menuProps={menuProps}
          cardInclusionMap={cardInclusionMap}
          sortMode={sortMode}
        />
      ))}
    </div>
  );
}

// ─── Cut Card Item ────────────────────────────────────────────────────

export function CutCardItem({
  ac, index = 0, removed, highlighted, onRemove, onPreview, onCardAction, menuProps, cardInclusionMap, sortMode = 'inclusion',
}: {
  ac: AnalyzedCard;
  index?: number;
  removed: boolean;
  highlighted: boolean;
  onRemove: (card: ScryfallCard) => void;
  onPreview: (name: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
  cardInclusionMap?: Record<string, number>;
  sortMode?: 'inclusion' | 'score';
}) {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const isBanned = menuProps?.bannedNames.has(ac.card.name);
  const rawInclusion = ac.inclusion ?? cardInclusionMap?.[ac.card.name] ?? edhrecRankToInclusion(ac.card.edhrec_rank);
  const pct = rawInclusion != null ? Math.round(rawInclusion) : null;
  const isEstimate = ac.inclusion == null && cardInclusionMap?.[ac.card.name] == null && pct != null;
  const price = getCardPrice(ac.card);
  const imgUrl = ac.card.image_uris?.normal
    || ac.card.card_faces?.[0]?.image_uris?.normal
    || scryfallImg(ac.card.name, 'normal');

  return (
    <div
      className={`group cascade-in-cut ${removed ? 'opacity-40' : ''}`}
      style={{ '--cascade-i': index } as React.CSSProperties}
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
          <span className="absolute top-0 left-0 rounded-tl-lg rounded-br-lg bg-black/60 text-white p-2 animate-pop-in">
            <Check className="w-5 h-5" />
          </span>
        )}
        {isBanned && (
          <span className="absolute top-0 right-0 rounded-tr-lg rounded-bl-lg bg-red-900/80 text-white p-1.5 animate-pop-in" title="Excluded">
            <Ban className="w-4 h-4" />
          </span>
        )}
      </button>
      {/* Context menu — outside <button> to avoid invalid nesting */}
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
      {/* Row 1: metric, name, price */}
      <div className="flex items-center gap-1 px-1 -mt-0.5 min-w-0">
        {sortMode === 'score' ? (
          <span
            className="text-[10px] font-bold tabular-nums shrink-0 text-violet-400"
            title={`Relevance score: ${Math.round(ac.score ?? 0)} (inclusion: ${pct ?? '?'}%)`}
          >
            {Math.round(ac.score ?? 0)}
          </span>
        ) : (
          <span
            className="text-[10px] font-bold tabular-nums shrink-0"
            style={{ color: pct ? `hsl(${Math.min(pct / 50, 1) * 120}, 70%, 55%)` : undefined }}
            title={isEstimate ? 'Estimated from EDHREC rank' : undefined}
          >
            {isEstimate ? '~' : ''}{pct ?? '?'}%
          </span>
        )}
        <span className="text-[11px] truncate flex-1 min-w-0 text-muted-foreground text-center">{ac.card.name}</span>
        {ac.card.isGameChanger && (
          <span className="text-[10px] font-bold text-amber-500/70 shrink-0" title="Game Changer (EDHREC)">GC</span>
        )}
        {price && (
          <span className="text-[10px] text-muted-foreground shrink-0">${price}</span>
        )}
      </div>
    </div>
  );
}

// ─── Overview: Deck Health Strip ───────────────────────────────────────

// ─── Summary Bullet Section ─────────────────────────────────────────

const SECTION_STYLES: Record<string, { label: string; border: string; labelColor: string }> = {
  needs: { label: 'Needs more', border: 'border-l-amber-500/50', labelColor: 'text-amber-400/80' },
  trims: { label: 'Could trim', border: 'border-l-sky-500/50', labelColor: 'text-sky-400/80' },
  notes: { label: 'Curve shape', border: 'border-l-muted-foreground/30', labelColor: 'text-muted-foreground/70' },
};

function SummarySection({ type, items, onNavigate, onNavigateRole }: {
  type: 'needs' | 'trims' | 'notes';
  items: SummaryItem[];
  onNavigate: (tab: TabKey) => void;
  onNavigateRole?: (role: string) => void;
}) {
  if (items.length === 0) return null;
  const style = SECTION_STYLES[type];

  const handleClick = (tab: string) => {
    const [t, sub] = tab.split(':');
    onNavigate(t as TabKey);
    if (sub && onNavigateRole) onNavigateRole(sub);
  };

  return (
    <div className={`border-l-2 ${style.border} pl-3 pr-2 py-1`}>
      <div className={`text-[11px] font-semibold uppercase tracking-wider ${style.labelColor} mb-0.5`}>{style.label}</div>
      {items.map((item) => (
        <button
          key={item.tab}
          onClick={() => handleClick(item.tab)}
          className="flex items-start gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left py-0.5"
        >
          <span className="mt-0.5 shrink-0" dangerouslySetInnerHTML={{ __html: summaryIconSvg(item.icon) }} />
          <span>
            <span className="font-semibold text-foreground/90">{item.label}</span>
            <span> — {item.text}</span>
            {item.hint && <span className="text-muted-foreground/60"> · {item.hint}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

// ─── Overview: Deck Health Strip ───────────────────────────────────────

export function DeckHealthStrip({ analysis, onNavigate, onNavigateRole, deckExcess,
  detection, themeLoading, allThemes, primaryThemeSlug, secondaryThemeSlug, onThemeSelect,
  detectedPacing, userPacing, onPacingChange,
  userLandTarget, onLandTargetChange, deckSize,
}: {
  analysis: DeckAnalysis;
  onNavigate: (tab: TabKey) => void;
  onNavigateRole?: (role: string) => void;
  deckExcess?: number;
  // Theme/tempo detection (optional — omit for list decks etc.)
  detection?: DetectedThemeResult | null;
  themeLoading?: boolean;
  allThemes?: EDHRECTheme[];
  primaryThemeSlug?: string | null;
  secondaryThemeSlug?: string | null;
  onThemeSelect?: (slug: string) => void;
  detectedPacing?: Pacing;
  userPacing?: Pacing | null;
  onPacingChange?: (pacing: Pacing | null) => void;
  userLandTarget?: number | null;
  onLandTargetChange?: (target: number | null) => void;
  deckSize?: number;
}) {
  const grades: { key: TabKey; label: string; icon: typeof Shield; grade: GradeResult }[] = [
    { key: 'roles', label: 'Roles', icon: Shield, grade: analysis.rolesGrade },
    { key: 'lands', label: 'Mana', icon: Mountain, grade: analysis.manaGrade },
    { key: 'curve', label: 'Tempo', icon: BarChart3, grade: analysis.curveGrade },
  ];

  const summary = getDeckSummaryData(analysis, deckExcess);
  const gradeStyle = HEALTH_GRADE_STYLES[summary.gradeLetter] || HEALTH_GRADE_STYLES.C;

  // Theme chips for the collapsible selector
  const hasThemes = !!detection && !!(allThemes && allThemes.length > 0);
  const chipThemes = useMemo(() => {
    if (!detection || !allThemes) return [];
    const evaluatedSlugs = new Set(detection.evaluatedThemes.map(t => t.theme.slug));
    const chips: Array<{ name: string; slug: string; score?: number }> = [];
    for (const et of detection.evaluatedThemes) {
      chips.push({ name: et.theme.name, slug: et.theme.slug, score: et.score });
    }
    for (const theme of allThemes) {
      if (evaluatedSlugs.has(theme.slug)) continue;
      if (chips.length >= 8) break;
      chips.push({ name: theme.name, slug: theme.slug });
    }
    return chips;
  }, [detection, allThemes]);

  const activePacing = userPacing ?? detectedPacing;

  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 360px' }}>
      {/* Summary card */}
      <div className="bg-card/60 border border-border/30 rounded-lg p-2.5 sm:p-4 space-y-3 min-w-0">
        {/* Header row: grade badge + "Summary" + Adjust button */}
        <div className="flex items-center gap-1.5">
          <span className={`text-2xl font-black leading-none px-3 py-2.5 rounded ${gradeStyle.color} ${gradeStyle.badgeBg}`}>{summary.gradeLetter}</span>
          <LayoutDashboard className={`w-4 h-4 ${gradeStyle.color} opacity-70`} />
          <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Summary</span>
          {themeLoading && !detection && (
            <Loader2 className="w-3 h-3 animate-spin text-primary/40 ml-auto shrink-0" />
          )}
          {(hasThemes || themeLoading) && detection && onThemeSelect && onPacingChange && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-border/40 text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors shrink-0 ml-auto"
                  title="Adjust themes & tempo"
                >
                  <Pencil className="w-2.5 h-2.5" />
                  <span>Adjust</span>
                  {themeLoading && <Loader2 className="w-2.5 h-2.5 animate-spin text-primary/40" />}
                </button>
              </PopoverTrigger>
              <PopoverContent side="bottom" align="end" className="w-80 p-0">
                <div className="px-3 pt-2.5 pb-1.5 border-b border-border/20">
                  <p className="text-[11px] text-muted-foreground/70 leading-snug">
                    Did we detect incorrectly? Adjust manually to affect card and curve suggestions.
                  </p>
                </div>
                {/* Theme chips */}
                <div className="p-3 pb-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Tag className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Themes</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {chipThemes.map(chip => {
                      const isPrimary = chip.slug === primaryThemeSlug;
                      const isSecondary = chip.slug === secondaryThemeSlug;
                      return (
                        <button
                          key={chip.slug}
                          onClick={() => onThemeSelect(chip.slug)}
                          className={`
                            inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border
                            transition-all duration-200 cursor-pointer
                            ${isPrimary
                              ? 'bg-primary/20 border-primary/40 text-primary font-semibold'
                              : isSecondary
                                ? 'bg-amber-500/15 border-amber-500/30 text-amber-400 font-medium'
                                : 'bg-card/80 border-border/40 text-muted-foreground hover:bg-accent/40 hover:text-foreground'
                            }
                          `}
                          title={
                            isPrimary ? 'Primary theme (click to deselect)'
                              : isSecondary ? 'Secondary theme (click to deselect)'
                                : chip.score != null ? `Match score: ${chip.score.toFixed(1)} / 100`
                                  : 'Click to select as theme'
                          }
                        >
                          {isPrimary && (
                            <span className="w-3.5 h-3.5 rounded-full bg-primary/30 text-[9px] font-bold flex items-center justify-center leading-none">1</span>
                          )}
                          {isSecondary && (
                            <span className="w-3.5 h-3.5 rounded-full bg-amber-500/30 text-[9px] font-bold flex items-center justify-center leading-none">2</span>
                          )}
                          {!isPrimary && !isSecondary && <Tag className="w-2.5 h-2.5" />}
                          {chip.name}
                          {chip.score != null && chip.score >= 20 && (
                            <span className={`text-[10px] tabular-nums ml-0.5 ${
                              isPrimary ? 'text-primary/70' : isSecondary ? 'text-amber-400/70' : 'text-muted-foreground/50'
                            }`}>
                              {Math.round(chip.score)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Land Target override */}
                {onLandTargetChange && (
                <div className="p-3 pt-2 border-t border-border/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Mountain className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Land Target</span>
                    {userLandTarget != null && (
                      <button
                        onClick={() => onLandTargetChange(null)}
                        className="text-[10px] text-muted-foreground/40 hover:text-foreground transition-colors ml-auto"
                        title="Reset to auto-detected land target"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const current = userLandTarget ?? analysis.manaBase.adjustedSuggestion;
                        const min = Math.floor((deckSize ?? 99) * 0.25);
                        if (current > min) onLandTargetChange(current - 1);
                      }}
                      className="p-1 rounded border border-border/40 text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-sm font-bold tabular-nums ${userLandTarget != null ? 'text-sky-400' : 'text-foreground'}`}>
                        {userLandTarget ?? analysis.manaBase.adjustedSuggestion}
                      </span>
                      <span className="text-[10px] text-muted-foreground/50">lands</span>
                    </div>
                    <button
                      onClick={() => {
                        const current = userLandTarget ?? analysis.manaBase.adjustedSuggestion;
                        const max = Math.floor((deckSize ?? 99) * 0.50);
                        if (current < max) onLandTargetChange(current + 1);
                      }}
                      className="p-1 rounded border border-border/40 text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    {userLandTarget == null && (
                      <span className="text-[10px] text-muted-foreground/40 ml-1">Auto-detected</span>
                    )}
                  </div>
                </div>
                )}

                {/* Tempo selector */}
                <div className="p-3 pt-2 border-t border-border/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tempo</span>
                    {userPacing && (
                      <button
                        onClick={() => onPacingChange(null)}
                        className="text-[10px] text-muted-foreground/40 hover:text-foreground transition-colors ml-auto"
                        title="Reset to auto-detected tempo"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {TEMPO_OPTIONS.map(opt => {
                      const isActive = activePacing === opt.value;
                      const isDetected = detectedPacing === opt.value && !userPacing;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => onPacingChange(isActive && userPacing ? null : opt.value)}
                          className={`
                            inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border
                            transition-all duration-200 cursor-pointer
                            ${isActive
                              ? 'bg-sky-500/20 border-sky-500/40 text-sky-400 font-semibold'
                              : 'bg-card/80 border-border/40 text-muted-foreground hover:bg-accent/40 hover:text-foreground'
                            }
                          `}
                          title={opt.short}
                        >
                          {isDetected && <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />}
                          {opt.label}
                        </button>
                      );
                    })}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="p-0.5 rounded-full text-muted-foreground/40 hover:text-muted-foreground transition-colors" title="What do these mean?">
                          <Info className="w-3.5 h-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="bottom" align="start" className="w-80 p-0">
                        <div className="p-3 border-b border-border/30">
                          <p className="text-xs font-semibold">Tempo Guide</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">Controls how the mana curve is shaped during deck building</p>
                        </div>
                        <div className="divide-y divide-border/20">
                          {TEMPO_OPTIONS.map(opt => {
                            const isActive = activePacing === opt.value;
                            return (
                              <div key={opt.value} className={`px-3 py-2 ${isActive ? 'bg-sky-500/5' : ''}`}>
                                <div className="flex items-center gap-2">
                                  <span className={`text-xs font-semibold ${isActive ? 'text-sky-400' : 'text-foreground'}`}>{opt.label}</span>
                                  {isActive && <span className="text-[9px] text-sky-400/70 font-medium uppercase">Active</span>}
                                </div>
                                <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{opt.detail}</p>
                                <p className="text-[11px] text-muted-foreground/50 italic mt-0.5">{opt.examples}</p>
                              </div>
                            );
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>

        {/* Theme detection line */}
        {detection && (
          <>
            <div className="flex items-center gap-2">
              <Lightbulb className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <p className="text-xs text-muted-foreground leading-relaxed"
                dangerouslySetInnerHTML={{ __html: detection.detectionMessage }}
              />
            </div>
            <div className="border-b border-border/30" />
          </>
        )}

        {/* Headline + card count note (skip note when headline already mentions excess) */}
        <div>
          <p className="text-sm text-muted-foreground leading-snug">{summary.headline}</p>
          {summary.cardCountNote && summary.cardCountSeverity === 'short' && (
            <p className="text-xs mt-1 text-amber-400/80">
              ↓ {summary.cardCountNote}
            </p>
          )}
        </div>

        {/* Action item sections */}
        {(summary.needs.length > 0 || summary.trims.length > 0 || summary.notes.length > 0) && (
          <div className="space-y-2.5">
            <SummarySection type="needs" items={summary.needs} onNavigate={onNavigate} onNavigateRole={onNavigateRole} />
            <SummarySection type="trims" items={summary.trims} onNavigate={onNavigate} onNavigateRole={onNavigateRole} />
            <SummarySection type="notes" items={summary.notes} onNavigate={onNavigate} onNavigateRole={onNavigateRole} />
          </div>
        )}
      </div>

      {/* Grade navigation — stacked column */}
      <div className="flex flex-col gap-2">
        {grades.map(({ key, label, icon: Icon, grade }, i) => {
          const style = HEALTH_GRADE_STYLES[grade.letter] || HEALTH_GRADE_STYLES.C;
          return (
            <button
              key={key}
              onClick={() => onNavigate(key)}
              className="bg-card/60 border border-border/30 rounded-lg p-2.5 sm:p-4 text-left hover:bg-accent/40 transition-all cursor-pointer group cascade-in"
              style={{ '--cascade-i': i } as React.CSSProperties}
            >
              <div className="flex items-start gap-2">
                <span className={`text-lg font-bold ${style.color} ${style.badgeBg} px-2 py-0.5 rounded shrink-0`}>{grade.letter}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Icon className={`w-3.5 h-3.5 ${style.color} opacity-70`} />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">{label}</span>
                  </div>
                  <p className="text-xs leading-snug text-muted-foreground line-clamp-2">{grade.message}</p>
                </div>
              </div>
            </button>
          );
        })}
        {/* Bracket tile */}
        {(() => {
          const bracketEst = useStore.getState().generatedDeck?.bracketEstimation;
          if (!bracketEst) return (
            <div className="bg-card/60 border border-border/30 border-dashed rounded-lg p-2.5 sm:p-4 opacity-50">
              <div className="flex items-start gap-2">
                <span className="text-lg font-bold text-muted-foreground/40 bg-muted/10 px-2 py-0.5 rounded shrink-0">?</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Gauge className="w-3.5 h-3.5 text-muted-foreground/40" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/40">Bracket</span>
                  </div>
                  <p className="text-xs leading-snug text-muted-foreground/40">No bracket data</p>
                </div>
              </div>
            </div>
          );
          const bc = BRACKET_COLORS[bracketEst.bracket] || BRACKET_COLORS[3];
          return (
            <button
              onClick={() => onNavigate('bracket')}
              className="bg-card/60 border border-border/30 rounded-lg p-2.5 sm:p-4 text-left hover:bg-accent/40 transition-all cursor-pointer group cascade-in"
              style={{ '--cascade-i': grades.length } as React.CSSProperties}
            >
              <div className="flex items-start gap-2">
                <span className={`text-lg font-bold ${bc.text} ${bc.bg} px-2 py-0.5 rounded shrink-0`}>{bracketEst.bracket}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Gauge className={`w-3.5 h-3.5 ${bc.text} opacity-70`} />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">Bracket</span>
                  </div>
                  <p className="text-xs leading-snug text-muted-foreground line-clamp-2">{bracketEst.label}</p>
                </div>
              </div>
            </button>
          );
        })()}
      </div>
    </div>
  );
}
