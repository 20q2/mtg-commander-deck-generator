import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Sparkles, Plus, Minus, Check,
  Shield,
  Lightbulb, Tag, ArrowUpDown, Pencil,
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
  SORT_KEY, sortListeners,
  type TabKey, type SuggestionSortMode,
} from './constants';

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
  rec, added, highlighted, onAdd, onPreview, onCardAction, menuProps, sortMode = 'relevance',
}: {
  rec: RecommendedCard;
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
  ac, removed, highlighted, onRemove, onPreview, onCardAction, menuProps, cardInclusionMap, sortMode = 'inclusion',
}: {
  ac: AnalyzedCard;
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
  const rawInclusion = ac.inclusion ?? cardInclusionMap?.[ac.card.name] ?? edhrecRankToInclusion(ac.card.edhrec_rank);
  const pct = rawInclusion != null ? Math.round(rawInclusion) : null;
  const isEstimate = ac.inclusion == null && cardInclusionMap?.[ac.card.name] == null && pct != null;
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
        {price && (
          <span className="text-[10px] text-muted-foreground shrink-0">${price}</span>
        )}
      </div>
    </div>
  );
}

// ─── Theme Detection Banner ───────────────────────────────────────────

export function ThemeDetectionBanner({
  detection,
  loading,
  allThemes,
  primaryThemeSlug,
  secondaryThemeSlug,
  onThemeSelect,
  detectedPacing,
  userPacing,
  onPacingChange,
}: {
  detection: DetectedThemeResult | null;
  loading: boolean;
  allThemes: EDHRECTheme[];
  primaryThemeSlug: string | null;
  secondaryThemeSlug: string | null;
  onThemeSelect: (slug: string) => void;
  detectedPacing?: Pacing;
  userPacing: Pacing | null;
  onPacingChange: (pacing: Pacing | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (allThemes.length === 0 && !loading) return null;

  // Loading shimmer
  if (loading && !detection) {
    return (
      <div className="bg-card/60 border border-border/30 rounded-lg p-3 animate-pulse">
        <div className="flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary/50" />
          <span className="text-xs text-muted-foreground">Detecting deck themes...</span>
        </div>
      </div>
    );
  }

  if (!detection) return null;

  // Build chip list: evaluated themes first (with scores), then remaining EDHREC themes
  const evaluatedSlugs = new Set(detection.evaluatedThemes.map(t => t.theme.slug));
  const chipThemes: Array<{ name: string; slug: string; score?: number }> = [];

  for (const et of detection.evaluatedThemes) {
    chipThemes.push({ name: et.theme.name, slug: et.theme.slug, score: et.score });
  }
  for (const theme of allThemes) {
    if (evaluatedSlugs.has(theme.slug)) continue;
    if (chipThemes.length >= 8) break;
    chipThemes.push({ name: theme.name, slug: theme.slug });
  }

  const activePacing = userPacing ?? detectedPacing;

  return (
    <div className="bg-gradient-to-r from-amber-500/5 via-card/60 to-card/60 border border-amber-500/15 rounded-lg p-3">
      <div className="flex items-center gap-2">
        <div className="p-1 rounded-md bg-amber-500/10 shrink-0">
          <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed flex-1"
          dangerouslySetInnerHTML={{ __html: detection.detectionMessage }}
        />
        {loading && (
          <Loader2 className="w-3 h-3 animate-spin text-primary/40 shrink-0" />
        )}
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-border/40 text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors shrink-0"
          title={expanded ? 'Hide selector' : 'Adjust themes & tempo'}
        >
          <Pencil className="w-2.5 h-2.5" />
          <span>Adjust</span>
        </button>
      </div>

      {/* Collapsible theme + tempo selector */}
      <div
        className="overflow-hidden transition-all duration-300 ease-out"
        style={{ maxHeight: expanded ? '300px' : '0px', opacity: expanded ? 1 : 0 }}
      >
        {/* Theme chips */}
        <div className="flex items-center gap-2 pt-2 mb-1.5">
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

        {/* Tempo selector */}
        <div className="pt-2 mt-2 border-t border-border/20">
          <div className="flex items-center gap-2 mb-1.5">
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
      </div>
    </div>
  );
}

// ─── Overview: Deck Health Strip ───────────────────────────────────────

// ─── Summary Bullet Section ─────────────────────────────────────────

const SECTION_STYLES: Record<string, { label: string; border: string; labelColor: string; bg: string }> = {
  needs: { label: 'Needs more', border: 'border-l-amber-500/50', labelColor: 'text-amber-400/80', bg: 'bg-amber-500/5' },
  trims: { label: 'Could trim', border: 'border-l-sky-500/50', labelColor: 'text-sky-400/80', bg: 'bg-sky-500/5' },
  notes: { label: 'Curve shape', border: 'border-l-muted-foreground/30', labelColor: 'text-muted-foreground/70', bg: 'bg-muted/5' },
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
    <div className={`border-l-2 ${style.border} ${style.bg} rounded-r-lg pl-3 pr-2 py-2`}>
      <div className={`text-[11px] font-semibold uppercase tracking-wider ${style.labelColor} mb-1`}>{style.label}</div>
      {items.map((item) => (
        <button
          key={item.tab}
          onClick={() => handleClick(item.tab)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left py-0.5"
        >
          <span dangerouslySetInnerHTML={{ __html: summaryIconSvg(item.icon) }} />
          <span className="font-semibold text-foreground/90">{item.label}</span>
          <span>— {item.text}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Overview: Deck Health Strip ───────────────────────────────────────

export function DeckHealthStrip({ analysis, onNavigate, onNavigateRole, deckExcess }: {
  analysis: DeckAnalysis;
  onNavigate: (tab: TabKey) => void;
  onNavigateRole?: (role: string) => void;
  deckExcess?: number;
}) {
  const grades: { key: TabKey; label: string; icon: typeof Shield; grade: GradeResult }[] = [
    { key: 'roles', label: 'Roles', icon: Shield, grade: analysis.rolesGrade },
    { key: 'lands', label: 'Mana', icon: Mountain, grade: analysis.manaGrade },
    { key: 'curve', label: 'Tempo', icon: BarChart3, grade: analysis.curveGrade },
  ];

  const summary = getDeckSummaryData(analysis, deckExcess);
  const gradeStyle = HEALTH_GRADE_STYLES[summary.gradeLetter] || HEALTH_GRADE_STYLES.C;


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
              <div className="flex items-start gap-2.5">
                <span className={`text-xl sm:text-2xl font-bold ${style.color} ${style.badgeBg} px-2.5 py-0.5 rounded shrink-0`}>{grade.letter}</span>
                <div className="pt-0.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon className={`w-4 h-4 ${style.color} opacity-70`} />
                    <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">{label}</span>
                  </div>
                  <p className="text-sm leading-snug text-muted-foreground line-clamp-2">{grade.message}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Summary card */}
      <div className="bg-card/60 border border-border/30 rounded-lg p-2.5 sm:p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <span className={`text-sm font-black leading-none px-1.5 py-0.5 rounded ${gradeStyle.color} ${gradeStyle.badgeBg}`}>{summary.gradeLetter}</span>
          <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Summary</span>
        </div>
        {/* Headline + card count note */}
        <div>
          <p className="text-sm text-muted-foreground leading-snug">{summary.headline}</p>
          {summary.cardCountNote && (
            <p className={`text-xs mt-1 ${summary.cardCountSeverity === 'short' ? 'text-amber-400/80' : 'text-sky-400/80'}`}>
              {summary.cardCountSeverity === 'short' ? '↓' : '↑'} {summary.cardCountNote}
            </p>
          )}
        </div>

        {/* Action item sections with backdrops */}
        {(summary.needs.length > 0 || summary.trims.length > 0 || summary.notes.length > 0) && (
          <div className="space-y-1.5">
            <SummarySection type="needs" items={summary.needs} onNavigate={onNavigate} onNavigateRole={onNavigateRole} />
            <SummarySection type="trims" items={summary.trims} onNavigate={onNavigate} onNavigateRole={onNavigateRole} />
            <SummarySection type="notes" items={summary.notes} onNavigate={onNavigate} onNavigateRole={onNavigateRole} />
          </div>
        )}
      </div>
    </div>
  );
}
