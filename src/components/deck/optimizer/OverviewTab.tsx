import { useState, useMemo, useCallback, useEffect } from 'react';
import { ThemeSearchList } from '@/components/theme/ThemeSearchList';
import {
  Sparkles, Plus, Minus, Check,
  Ban,
  Tag, ArrowUpDown,
  RotateCcw, Info, Zap, Mountain,
  AlertTriangle, Layers, Package,
} from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { ScryfallCard, UserCardList, EDHRECTheme } from '@/types';
import type { DeckAnalysis, RecommendedCard, AnalyzedCard } from '@/services/deckBuilder/deckAnalyzer';
import type { DetectedThemeResult, Pacing } from '@/services/deckBuilder/themeDetector';
import { getCardPrice } from '@/services/scryfall/client';
import { CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import {
  scryfallImg, edhrecRankToInclusion,
  ROLE_LABEL_ICONS, SUBTYPE_BADGE_COLORS,
  TEMPO_OPTIONS,
  SORT_KEY, sortListeners,
  type SuggestionSortMode,
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
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string>; collectionNames?: Set<string> };
  title?: React.ReactNode;
  hideSort?: boolean;
}) {
  const [sortMode, setSortMode] = useSuggestionSort();
  const sorted = useMemo(() => {
    const bannedSet = menuProps?.bannedNames;
    const isBanned = (name: string) => bannedSet?.has(name) ?? false;
    // Stable-sort banned/excluded cards to the bottom so the strike-out tiles
    // don't clutter the top of the list. Sort within each group by the
    // user's active sort mode.
    const order = (() => {
      if (hideSort) return cards;
      if (sortMode === 'popularity') return [...cards].sort((a, b) => b.inclusion - a.inclusion);
      if (sortMode === 'cmc') return [...cards].sort((a, b) => {
        const ac = a.cmc ?? -1;
        const bc = b.cmc ?? -1;
        if (ac !== bc) return bc - ac;
        return (b.score ?? 0) - (a.score ?? 0);
      });
      return cards;
    })();
    if (!bannedSet || bannedSet.size === 0) return order;
    const allowed: RecommendedCard[] = [];
    const blocked: RecommendedCard[] = [];
    for (const rec of order) (isBanned(rec.name) ? blocked : allowed).push(rec);
    return [...allowed, ...blocked];
  }, [cards, sortMode, hideSort, menuProps]);

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
                  className={`text-[10px] px-2 py-0.5 transition-colors ${sortMode === 'relevance' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground/80 bg-card/40 hover:text-foreground hover:bg-accent/70'}`}
                >
                  Relevance
                </button>
                <div className="w-px h-3 bg-border/50" />
                <button
                  onClick={() => setSortMode('popularity')}
                  className={`text-[10px] px-2 py-0.5 transition-colors ${sortMode === 'popularity' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground/80 bg-card/40 hover:text-foreground hover:bg-accent/70'}`}
                >
                  Popularity
                </button>
                <div className="w-px h-3 bg-border/50" />
                <button
                  onClick={() => setSortMode('cmc')}
                  className={`text-[10px] px-2 py-0.5 transition-colors ${sortMode === 'cmc' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground/80 bg-card/40 hover:text-foreground hover:bg-accent/70'}`}
                >
                  CMC
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}
      >
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
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string>; collectionNames?: Set<string> };
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
  const isOwned = menuProps?.collectionNames?.has(rec.name) ?? false;
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
        ) : sortMode === 'cmc' ? null : (
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
      {(allBadges.length > 0 || isOwned || rec.isGameChanger) && (
        <div className="flex items-center gap-1 px-1 min-w-0 justify-center flex-wrap">
          {isOwned && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-px rounded-md text-[9px] font-medium bg-zinc-700/70 text-zinc-200"
              title="This card exists in your collection"
            >
              <Package className="w-2.5 h-2.5 shrink-0" />
              Owned
            </span>
          )}
          {rec.isGameChanger && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-px rounded-full text-[9px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30"
              title="Game Changer (EDHREC) — high-power card flagged by bracket rules"
            >
              <Sparkles className="w-2.5 h-2.5 shrink-0" />
              Game Changer
            </span>
          )}
          {allBadges.map(label => {
            const badgeColor = SUBTYPE_BADGE_COLORS[label];
            const RIcon = ROLE_LABEL_ICONS[label];
            if (!badgeColor || !RIcon) return null;
            const shortLabel = label === 'Card Advantage' ? 'Card Adv.' : label;
            return (
              <span key={label} className={`inline-flex items-center gap-0.5 px-1.5 py-px rounded-full text-[9px] font-medium ${badgeColor}`} title={label}>
                <RIcon className="w-2.5 h-2.5 shrink-0" />
                {shortLabel}
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
  cards, onRemove, onPreview, removedCards, excess, onCardAction, menuProps, cardInclusionMap, sortMode, getBadges,
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
  getBadges?: (ac: AnalyzedCard) => { countLabel?: string; warning?: string } | undefined;
}) {
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(105px, 1fr))' }}
    >
      {cards.map((ac, i) => {
        const badges = getBadges?.(ac);
        return (
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
            countLabel={badges?.countLabel}
            warning={badges?.warning}
          />
        );
      })}
    </div>
  );
}

// ─── Cut Card Item ────────────────────────────────────────────────────

export function CutCardItem({
  ac, index = 0, removed, highlighted, onRemove, onPreview, onCardAction, menuProps, cardInclusionMap, sortMode = 'inclusion', countLabel, warning,
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
  countLabel?: string;
  warning?: string;
}) {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const isBanned = menuProps?.bannedNames.has(ac.card.name);
  // Treat a 0 in cardInclusionMap as "not in pool" (older decks stored 0 for
  // missing entries) so we fall through to the global edhrec_rank estimate.
  const mapInclusion = cardInclusionMap?.[ac.card.name] || null;
  const rawInclusion = ac.inclusion ?? mapInclusion ?? edhrecRankToInclusion(ac.card.edhrec_rank);
  const pct = rawInclusion != null ? Math.round(rawInclusion) : null;
  const isEstimate = ac.inclusion == null && mapInclusion == null && pct != null;
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
        {countLabel && (
          <span className="text-[10px] font-semibold px-1.5 py-px rounded-full bg-amber-500/15 text-amber-400 shrink-0">
            {countLabel}
          </span>
        )}
        {ac.card.isGameChanger && (
          <span className="text-[10px] font-bold text-amber-500/70 shrink-0" title="Game Changer (EDHREC)">GC</span>
        )}
        {price && (
          <span className="text-[10px] text-muted-foreground shrink-0">${price}</span>
        )}
      </div>
      {warning && (
        <div className="px-1 -mt-0.5 flex items-center gap-1" title={warning}>
          <AlertTriangle className="w-2.5 h-2.5 text-amber-400/80 shrink-0" />
          <span className="text-[9px] text-amber-400/80 truncate">{warning}</span>
        </div>
      )}
    </div>
  );
}

// ─── Overview: Deck Health Strip ───────────────────────────────────────

// ─── Adjust Popover Content ────────────────────────────────────────────
// Shared body of the "Adjust themes & tempo" popover. Rendered in two
// places: by the Overview tab's existing Adjust button and by the
// pacing/themes status strip in the analyzer's tab bar.

export function AdjustPopoverContent({
  analysis,
  detection,
  allThemes,
  primaryThemeSlug,
  secondaryThemeSlug,
  onThemeSelect,
  resolveThemeName,
  userLandTarget,
  onLandTargetChange,
  deckSize,
  userDeckSize,
  onDeckSizeChange,
  detectedPacing,
  userPacing,
  onPacingChange,
}: {
  analysis: DeckAnalysis;
  detection: DetectedThemeResult;
  allThemes: EDHRECTheme[];
  primaryThemeSlug?: string | null;
  secondaryThemeSlug?: string | null;
  onThemeSelect: (slug: string) => void;
  /** Resolves names for slugs outside detection/taglinks (custom picks, saved themes). */
  resolveThemeName?: (slug: string) => string | null;
  userLandTarget?: number | null;
  onLandTargetChange?: (target: number | null) => void;
  deckSize?: number;
  userDeckSize?: number | null;
  onDeckSizeChange?: (size: number | null) => void;
  detectedPacing?: Pacing;
  userPacing?: Pacing | null;
  onPacingChange: (pacing: Pacing | null) => void;
}) {
  const [showAllThemes, setShowAllThemes] = useState(false);
  const chipThemes = useMemo(() => {
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
    // Selected slugs outside the evaluated/taglink set (custom or saved picks)
    // must still render as chips.
    for (const slug of [primaryThemeSlug, secondaryThemeSlug]) {
      if (!slug || chips.some(c => c.slug === slug)) continue;
      chips.push({ name: resolveThemeName?.(slug) ?? slug, slug });
    }
    return chips;
  }, [detection, allThemes, primaryThemeSlug, secondaryThemeSlug, resolveThemeName]);

  const activePacing = userPacing ?? detectedPacing;

  return (
    <>
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
                    ? 'bg-primary/20 border-primary/50 text-violet-200 font-semibold'
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
        <button
          type="button"
          onClick={() => setShowAllThemes(v => !v)}
          className="mt-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {showAllThemes ? 'Hide theme search' : 'More themes…'}
        </button>
        {showAllThemes && (
          <div className="mt-2">
            <ThemeSearchList
              enabled={showAllThemes}
              onPick={t => onThemeSelect(t.slug)}
              disabledSlugs={new Set([primaryThemeSlug, secondaryThemeSlug].filter((s): s is string => !!s))}
              maxHeightClass="max-h-40"
            />
          </div>
        )}
      </div>

      {/* Deck Size override */}
      {onDeckSizeChange && (
      <div className="p-3 pt-2 border-t border-border/20">
        <div className="flex items-center gap-2 mb-2">
          <Layers className="w-3 h-3 text-muted-foreground" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Deck Size</span>
          <span className="text-[10px] text-muted-foreground/50 normal-case font-normal">(not including commander)</span>
          {userDeckSize != null && (
            <button
              onClick={() => onDeckSizeChange(null)}
              className="text-[10px] text-muted-foreground/40 hover:text-foreground transition-colors ml-auto"
              title="Reset to actual deck size"
            >
              Reset
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const current = userDeckSize ?? deckSize ?? 99;
              if (current > 40) onDeckSizeChange(current - 1);
            }}
            className="p-1 rounded border border-border/40 text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
          >
            <Minus className="w-3 h-3" />
          </button>
          <div className="flex items-center gap-1.5">
            <span className={`text-sm font-bold tabular-nums ${userDeckSize != null ? 'text-sky-400' : 'text-foreground'}`}>
              {userDeckSize ?? deckSize ?? 99}
            </span>
            <span className="text-[10px] text-muted-foreground/50">cards</span>
          </div>
          <button
            onClick={() => {
              const current = userDeckSize ?? deckSize ?? 99;
              if (current < 250) onDeckSizeChange(current + 1);
            }}
            className="p-1 rounded border border-border/40 text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
          >
            <Plus className="w-3 h-3" />
          </button>
          {userDeckSize == null && (
            <span className="text-[10px] text-muted-foreground/40 ml-1">Actual</span>
          )}
        </div>
      </div>
      )}

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
            <PopoverContent side="bottom" align="start" className="w-[34rem] max-w-[calc(100vw-2rem)] p-0">
              <div className="p-3 border-b border-border/30">
                <p className="text-xs font-semibold">Tempo Guide</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Controls how the mana curve is shaped during deck building</p>
              </div>
              <div className="grid grid-cols-2 gap-px bg-border/20">
                {TEMPO_OPTIONS.map(opt => {
                  const isActive = activePacing === opt.value;
                  return (
                    <div key={opt.value} className={`px-3 py-2 bg-popover ${isActive ? 'bg-sky-500/5' : ''}`}>
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
    </>
  );
}

