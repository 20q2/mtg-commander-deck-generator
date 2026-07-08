import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { X, Sparkles, Star, Pin, ArrowLeft, ArrowLeftRight, Plus, ChevronLeft, ChevronRight, ChevronDown, ListChecks, Footprints, Infinity, Loader2, ScrollText, Tag } from 'lucide-react';
import { getCardImageUrl, isDoubleFacedCard, getCardBackFaceUrl, getCardPrice, getCardByName, getCardsByNames, getFrontFaceTypeLine, useScryfallImage, fetchCardRulings, getCachedRulings } from '@/services/scryfall/client';
import { fetchComboDetails, fetchSimilarCards, type ComboDetails } from '@/services/edhrec/client';
import { tagsForOracleId, loadTagIndex, isTagIndexLoaded } from '@/services/spellchroma/tagIndex';
import type { ScryfallCard, DetectedCombo, LoadPhase } from '@/types';
import { useStore } from '@/store';
import { trackEvent } from '@/services/analytics';
import { CardTypeIcon, ManaText } from '@/components/ui/mtg-icons';

type CardType = 'Commander' | 'Creature' | 'Planeswalker' | 'Battle' | 'Instant' | 'Sorcery' | 'Artifact' | 'Enchantment' | 'Land';

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
  return 'Artifact';
}

// Format a Scryfall ruling date ("2024-11-08") as "Nov 8, 2024". Parsed as UTC
// to avoid the date shifting a day in negative-offset timezones.
function formatRulingDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
}

interface CardPreviewModalProps {
  card: ScryfallCard | null;
  onClose: () => void;
  onBuildDeck?: (cardName: string) => void;
  isOwned?: boolean;
  combos?: DetectedCombo[];
  cardTypeMap?: Map<string, CardType>;
  cardComboMap?: Map<string, DetectedCombo[]>;
  /** When true, only show complete (in-deck) combos. When false, show both sections. */
  deckOnly?: boolean;
  /** When true, hide must-include add/remove buttons (read-only context like list deck view) */
  hideMustInclude?: boolean;
  /** Swap candidates of the same role for this card */
  swapCandidates?: ScryfallCard[];
  /** Called when user picks a replacement */
  onSwapCard?: (oldCard: ScryfallCard, newCard: ScryfallCard) => void;
  /** Called when user adds a candidate to the deck without swapping */
  onAddCard?: (newCard: ScryfallCard) => void;
  /** Which side panel tab to show initially */
  initialSideTab?: 'combos' | 'swaps';
  /** Callback to trigger immediate regeneration */
  onRegenerate?: () => void;
  /** Navigate to prev/next card in the deck */
  onNavigate?: (direction: 'prev' | 'next') => void;
  /** Whether prev/next navigation is available */
  canNavigate?: { prev: boolean; next: boolean };
  /** Current card index (0-based) for position indicator */
  cardIndex?: number;
  /** Total navigable cards for position indicator */
  totalCards?: number;
  /** EDHREC inclusion % map for showing scores on swap candidates */
  cardInclusionMap?: Record<string, number> | null;
  /** Composite relevancy score map */
  cardRelevancyMap?: Record<string, number> | null;
  /** Whether to show price overlays on swap candidate thumbnails */
  showPrice?: boolean;
  /** Image URL for the previous card in the list (for peek preview) */
  prevCardImage?: string | null;
  /** Image URL for the next card in the list (for peek preview) */
  nextCardImage?: string | null;
  /** Override for the "in deck/list" name set used to filter similar-card suggestions.
   *  Falls back to the Zustand-store generatedDeck when not provided. */
  inDeckNames?: string[];
  /** Override for the commander color identity used to filter similar-card suggestions.
   *  Falls back to the Zustand-store commander when not provided. */
  commanderColorIdentity?: string[];
  /** Progressive load phases — when 'swaps' is missing, render placeholder in Replacements panel. */
  phasesDone?: Set<LoadPhase>;
  /** SpellChroma: called with a tag slug when a tag chip is clicked in the Tags tab (modal then closes).
   *  When provided, the Tags-tab chips become clickable filters; otherwise they're static. */
  onTagClick?: (slug: string) => void;
  /** ?deck= reference used when a Tags-tab chip opens SpellChroma from a deck context (a saved
   *  list id, or 'generated' for the builder deck). When set, the tag click carries the whole
   *  deck into SpellChroma instead of just this card. Ignored when onTagClick handles the click. */
  spellChromaDeckRef?: string;
}

function ComboEntry({
  combo,
  currentCardName,
  cardTypeMap,
  handlePillHover,
  setHoverPreview,
  handlePillClick,
  isKnown,
}: {
  combo: DetectedCombo;
  currentCardName: string;
  cardTypeMap: Map<string, CardType> | undefined;
  handlePillHover: (name: string, e: React.MouseEvent) => void;
  setHoverPreview: (v: null) => void;
  handlePillClick: (name: string, comboCards?: string[]) => void;
  isKnown?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<ComboDetails | 'loading' | 'error' | null>(null);

  const handleToggle = () => {
    const willExpand = !expanded;
    setExpanded(willExpand);
    if (willExpand && !details) {
      setDetails('loading');
      fetchComboDetails(combo.comboId)
        .then(d => setDetails(d))
        .catch(() => setDetails('error'));
    }
  };

  return (
    <div className="rounded-lg bg-white/10 border border-white/10 px-3 py-2.5">
      <div className={`flex items-center gap-1.5 text-[11px] font-semibold mb-1.5 ${isKnown ? 'text-amber-400' : 'text-violet-400'}`}>
        <Sparkles className="w-3 h-3" />
        Combo
        <span className="ml-auto text-white/30 text-[10px] font-normal">
          {combo.deckCount.toLocaleString()} decks · Bracket {combo.bracket}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {combo.cards.map((name) => {
          const isMissing = isKnown && combo.missingCards.includes(name);
          return (
            <span
              key={name}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
                name === currentCardName
                  ? 'bg-violet-500/25 text-violet-300 font-semibold hover:bg-violet-500/35'
                  : isMissing
                    ? 'bg-white/5 text-white/40 hover:bg-white/10'
                    : 'bg-white/10 text-white/80 hover:bg-white/20'
              }`}
              onMouseEnter={(e) => handlePillHover(name, e)}
              onMouseLeave={() => setHoverPreview(null)}
              onClick={() => handlePillClick(name, combo.cards)}
            >
              {cardTypeMap?.get(name) && (
                <CardTypeIcon type={cardTypeMap.get(name)!} size="sm" className="opacity-60" />
              )}
              {name}
            </span>
          );
        })}
      </div>
      {/* Inline results summary when collapsed */}
      {!expanded && combo.results.length > 0 && (
        <p className="text-white/50 text-[11px] leading-relaxed">
          {combo.results.join('. ')}
        </p>
      )}
      {/* Expandable details toggle */}
      <button
        onClick={handleToggle}
        className="flex items-center gap-1 text-[11px] text-white/40 hover:text-white/70 transition-colors mt-1"
      >
        <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        {expanded ? 'Hide details' : 'Show details'}
      </button>
      {expanded && (() => {
        if (details === 'loading') {
          return (
            <div className="flex items-center gap-1.5 mt-2 text-[11px] text-white/40">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading combo details...
            </div>
          );
        }
        if (details && details !== 'error') {
          return (
            <div className="space-y-2.5 mt-2">
              {details.prerequisites.length > 0 && (
                <div>
                  <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white/40 mb-1">
                    <ListChecks className="w-3 h-3" />
                    Prerequisites
                  </div>
                  <div className="space-y-0.5 pl-4">
                    {details.prerequisites.map((prereq, idx) => (
                      <div key={idx} className="text-[11px] text-white/50 leading-snug flex gap-1">
                        <span className="shrink-0 opacity-50">&bull;</span>
                        <ManaText text={prereq} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white/40 mb-1">
                  <Footprints className="w-3 h-3" />
                  Steps
                </div>
                <div className="space-y-0.5 pl-4">
                  {details.steps.map((step, idx) => (
                    <div key={idx} className="text-[11px] text-white/50 leading-snug flex gap-1.5">
                      <span className="shrink-0 w-3.5 h-3.5 rounded-full bg-white/10 flex items-center justify-center text-[9px] font-bold mt-0.5">
                        {idx + 1}
                      </span>
                      <ManaText text={step} />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white/40 mb-1">
                  <Infinity className="w-3 h-3" />
                  Results
                </div>
                <div className="space-y-0.5 pl-4">
                  {details.results.map((result, idx) => (
                    <div key={idx} className="text-[11px] text-white/50 leading-snug flex gap-1">
                      <span className="shrink-0 opacity-50">&infin;</span>
                      {result}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        }
        // Error or no details — fall back to results text
        return combo.results.length > 0 ? (
          <p className="text-white/50 text-[11px] leading-relaxed mt-1.5 whitespace-pre-wrap">
            {combo.results.join('\n')}
          </p>
        ) : null;
      })()}
    </div>
  );
}

export function CardPreviewModal({ card, onClose, onBuildDeck, isOwned, combos, cardTypeMap, cardComboMap, deckOnly, hideMustInclude, swapCandidates, onSwapCard, onAddCard, initialSideTab, onRegenerate, onNavigate, canNavigate, cardIndex, totalCards, cardInclusionMap, cardRelevancyMap, showPrice, prevCardImage, nextCardImage, inDeckNames, commanderColorIdentity, phasesDone, onTagClick, spellChromaDeckRef }: CardPreviewModalProps) {
  const swapsReady = !phasesDone || phasesDone.has('swaps');
  const navigate = useNavigate();
  const commander = useStore((s) => s.commander);
  const generatedDeck = useStore((s) => s.generatedDeck);
  const currency = useStore((s) => s.customization.currency);
  const mustIncludeCards = useStore((s) => s.customization.mustIncludeCards);
  const tempMustIncludeCards = useStore((s) => s.customization.tempMustIncludeCards ?? []);
  const updateCustomization = useStore((s) => s.updateCustomization);
  const sym = currency === 'EUR' ? '€' : '$';
  const [showBack, setShowBack] = useState(false);
  const [cardOverride, setCardOverride] = useState<ScryfallCard | null>(null);
  // When the user clicks a combo pill, remember which combo's card list they're
  // navigating so arrow keys / swipes can cycle through that combo's other cards.
  const [activeComboCards, setActiveComboCards] = useState<string[] | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{ name: string; top: number; left: number; below: boolean } | null>(null);
  const hoverImage = useScryfallImage(hoverPreview?.name ?? null, 'normal');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [swapPreview, setSwapPreview] = useState<ScryfallCard | null>(null);
  const [similarHydrated, setSimilarHydrated] = useState<ScryfallCard[] | null>(null);
  const [similarLoading, setSimilarLoading] = useState(false);
  // Rulings are read synchronously from the client cache during render (see
  // below); this counter only forces a re-render once an async fetch populates
  // that cache. Keeping rulings out of state avoids the null/stale frame that
  // made the card image jump on navigation.
  const [, bumpRulings] = useState(0);
  // Forces a re-render once the lazily-loaded tag index arrives (see effect below).
  const [, bumpTags] = useState(0);
  const [sidePanelTab, setSidePanelTab] = useState<'combos' | 'rulings' | 'tags'>(() => {
    const stored = localStorage.getItem('spellchroma-card-side-tab');
    return stored === 'tags' || stored === 'rulings' || stored === 'combos' ? stored : 'combos';
  });
  // Remember the user's last-picked side-panel tab across cards and sessions. The
  // activeSideTab fallback (below) still handles cards that lack the preferred tab
  // without overwriting the stored preference.
  const selectSideTab = useCallback((tab: 'combos' | 'rulings' | 'tags') => {
    setSidePanelTab(tab);
    localStorage.setItem('spellchroma-card-side-tab', tab);
  }, []);
  const [showSwaps, setShowSwaps] = useState(() => {
    if (initialSideTab === 'swaps') return true;
    const stored = localStorage.getItem('showSwapCandidates');
    return stored === null ? true : stored === 'true';
  });

  // Track which direction the new card should slide in from
  const slideDirectionRef = useRef<'next' | 'prev' | null>(null);
  const [slideClass, setSlideClass] = useState('');

  // Reset flip state and override when prop card changes
  const cardId = card?.id;
  const [prevCardId, setPrevCardId] = useState(cardId);
  if (cardId !== prevCardId) {
    setPrevCardId(cardId);
    setShowBack(false);
    setCardOverride(null);
    setActiveComboCards(null);
    setSwapPreview(null);
    if (initialSideTab === 'swaps') {
      setShowSwaps(true);
    } else {
      const stored = localStorage.getItem('showSwapCandidates');
      setShowSwaps(stored === null ? true : stored === 'true');
    }
    // Apply slide-in animation synchronously so it's ready on the very first render
    const dir = slideDirectionRef.current;
    if (dir) {
      setSlideClass(dir === 'next' ? 'animate-card-slide-from-right' : 'animate-card-slide-from-left');
      slideDirectionRef.current = null;
    } else {
      setSlideClass('');
    }
  }

  // Clear slide class after animation completes so it doesn't replay on re-render
  useEffect(() => {
    if (!slideClass) return;
    const timer = setTimeout(() => setSlideClass(''), 250);
    return () => clearTimeout(timer);
  }, [slideClass]);

  // Lock body scroll while modal is open
  useEffect(() => {
    if (!card) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [card]);

  // Pre-cache the adjacent cards' large images so navigating prev/next on
  // mobile doesn't flash an empty container after the slide animation.
  // Scryfall image URLs follow a /<size>/ path segment we can swap.
  useEffect(() => {
    if (!card) return;
    for (const url of [prevCardImage, nextCardImage]) {
      if (!url) continue;
      const large = url.replace('/small/', '/large/');
      const img = new Image();
      img.src = large;
    }
  }, [card, prevCardImage, nextCardImage]);

  // Cycle through the active combo's cards while viewing one via cardOverride
  // (entered by clicking a pill in the side panel).
  const navigateCombo = useCallback(async (direction: 'prev' | 'next') => {
    if (!cardOverride || !activeComboCards || activeComboCards.length < 2) return;
    const currentIdx = activeComboCards.indexOf(cardOverride.name);
    if (currentIdx === -1) return;
    const len = activeComboCards.length;
    const nextIdx = direction === 'next'
      ? (currentIdx + 1) % len
      : (currentIdx - 1 + len) % len;
    const nextName = activeComboCards[nextIdx];
    try {
      const fetched = await getCardByName(nextName);
      if (fetched) {
        slideDirectionRef.current = direction;
        setCardOverride(fetched);
        setShowBack(false);
        setSlideClass(direction === 'next' ? 'animate-card-slide-from-right' : 'animate-card-slide-from-left');
      }
    } catch {
      // ignore fetch errors
    }
  }, [cardOverride, activeComboCards]);

  // Keyboard navigation (ArrowLeft/ArrowRight). In cardOverride mode with an
  // active combo, arrows cycle the combo's cards. Otherwise they navigate the deck.
  useEffect(() => {
    if (!card) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (cardOverride && activeComboCards && activeComboCards.length > 1) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); navigateCombo('prev'); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); navigateCombo('next'); }
        return;
      }
      if (cardOverride) return; // viewing a single combo pill card with no combo context
      if (!onNavigate) return;
      if (e.key === 'ArrowLeft' && canNavigate?.prev) {
        e.preventDefault();
        slideDirectionRef.current = 'prev';
        onNavigate('prev');
      } else if (e.key === 'ArrowRight' && canNavigate?.next) {
        e.preventDefault();
        slideDirectionRef.current = 'next';
        onNavigate('next');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [card, onNavigate, canNavigate, cardOverride, activeComboCards, navigateCombo]);

  // Touch drag-to-swipe navigation — card follows finger, then navigates or snaps back
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragOffsetRef = useRef(0);
  const isDraggingRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const inComboNav = !!(cardOverride && activeComboCards && activeComboCards.length > 1);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!onNavigate && !inComboNav) return;
    if (cardOverride && !inComboNav) return;
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    dragOffsetRef.current = 0;
    isDraggingRef.current = false;
  }, [onNavigate, cardOverride, inComboNav]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    if (!onNavigate && !inComboNav) return;
    if (cardOverride && !inComboNav) return;
    const dx = e.touches[0].clientX - touchStartRef.current.x;
    const dy = e.touches[0].clientY - touchStartRef.current.y;
    // Lock into horizontal drag once movement is clearly horizontal
    if (!isDraggingRef.current) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        isDraggingRef.current = true;
      } else if (Math.abs(dy) > 10) {
        // Vertical scroll — abort drag tracking
        touchStartRef.current = null;
        return;
      } else {
        return; // Not enough movement to decide yet
      }
    }
    // Combo nav cycles, so no rubber-band damping. Deck nav damps at edges.
    let offset = dx;
    if (!inComboNav && ((dx < 0 && !canNavigate?.next) || (dx > 0 && !canNavigate?.prev))) {
      offset = dx * 0.2; // rubber band effect
    }
    dragOffsetRef.current = offset;
    if (contentRef.current) {
      contentRef.current.style.transform = `translateX(${offset}px)`;
      contentRef.current.style.opacity = `${1 - Math.min(Math.abs(offset) / 400, 0.4)}`;
    }
  }, [onNavigate, canNavigate, cardOverride, inComboNav]);

  const handleTouchEnd = useCallback(() => {
    if (!touchStartRef.current && !isDraggingRef.current) return;
    const offset = dragOffsetRef.current;
    const navigated = isDraggingRef.current && Math.abs(offset) > 60;
    touchStartRef.current = null;
    isDraggingRef.current = false;
    dragOffsetRef.current = 0;
    if (navigated && inComboNav) {
      if (offset < -60) navigateCombo('next');
      else if (offset > 60) navigateCombo('prev');
    } else if (navigated && onNavigate && !cardOverride) {
      if (offset < -60 && canNavigate?.next) {
        slideDirectionRef.current = 'next';
        onNavigate('next');
      } else if (offset > 60 && canNavigate?.prev) {
        slideDirectionRef.current = 'prev';
        onNavigate('prev');
      }
    }
    // Snap back with transition
    if (contentRef.current) {
      contentRef.current.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
      contentRef.current.style.transform = '';
      contentRef.current.style.opacity = '';
      // Clean up transition after it completes
      const el = contentRef.current;
      const cleanup = () => { el.style.transition = ''; el.removeEventListener('transitionend', cleanup); };
      el.addEventListener('transitionend', cleanup);
    }
  }, [onNavigate, canNavigate, cardOverride, inComboNav, navigateCombo]);

  const handlePillHover = useCallback((name: string, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isDesktop = window.innerWidth >= 768;
    setHoverPreview({
      name,
      top: isDesktop ? rect.bottom + 8 : rect.top - 8,
      left: rect.left + rect.width / 2,
      below: isDesktop,
    });
  }, []);

  const handlePillClick = useCallback(async (name: string, comboCards?: string[]) => {
    try {
      const fetched = await getCardByName(name);
      if (fetched) {
        setCardOverride(fetched);
        setActiveComboCards(comboCards ?? null);
        setShowBack(false);
        setHoverPreview(null);
      }
    } catch {
      // ignore fetch errors
    }
  }, []);

  const handleToggleSwaps = useCallback(() => {
    setShowSwaps(prev => {
      const next = !prev;
      if (prev) setSwapPreview(null);
      localStorage.setItem('showSwapCandidates', String(next));
      return next;
    });
  }, []);

  const tempBannedCards = useStore((s) => s.customization.tempBannedCards ?? []);

  const handleAddToDeck = useCallback((name: string) => {
    if (mustIncludeCards.includes(name) || tempMustIncludeCards.includes(name)) return;
    // Remove from temp banned if previously removed via edit mode
    const newTempBanned = tempBannedCards.filter(n => n !== name);
    updateCustomization({
      tempMustIncludeCards: [...tempMustIncludeCards, name],
      ...(newTempBanned.length !== tempBannedCards.length ? { tempBannedCards: newTempBanned } : {}),
    });
    trackEvent('must_include_added', { commanderName: commander?.name ?? 'unknown', cardName: name, source: 'modal' });
    setToastMessage(`Adding "${name}" to deck...`);
    onRegenerate?.();
  }, [mustIncludeCards, tempMustIncludeCards, tempBannedCards, updateCustomization, commander, onRegenerate]);

  const handleRemoveFromDeck = useCallback((name: string) => {
    if (tempMustIncludeCards.includes(name)) {
      updateCustomization({ tempMustIncludeCards: tempMustIncludeCards.filter(n => n !== name) });
    } else {
      updateCustomization({ mustIncludeCards: mustIncludeCards.filter(n => n !== name) });
    }
    setToastMessage(`Removed "${name}" from deck`);
    onRegenerate?.();
  }, [mustIncludeCards, tempMustIncludeCards, updateCustomization, onRegenerate]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Lazy-fetch EDHREC similar cards when the user opens the Replacements section
  // on a real card. One HTTP request per card per 5 min (cache lives in client.ts).
  useEffect(() => {
    if (!card) return;
    if (!showSwaps) return;
    if (cardOverride) return; // viewing combo pill card, not a real focus
    if (!onSwapCard) return; // no swap callback, no point fetching

    let cancelled = false;
    setSimilarHydrated(null);
    setSimilarLoading(true);

    (async () => {
      try {
        const names = await fetchSimilarCards(card.name);
        if (cancelled || names.length === 0) {
          if (!cancelled) setSimilarHydrated([]);
          return;
        }
        const cardMap = await getCardsByNames(names);
        if (cancelled) return;
        // Preserve EDHREC's native order in the hydrated array
        const hydrated = names
          .map((n) => cardMap.get(n))
          .filter((c): c is ScryfallCard => !!c);
        setSimilarHydrated(hydrated);
      } catch {
        if (!cancelled) setSimilarHydrated([]);
      } finally {
        if (!cancelled) setSimilarLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [card?.name, showSwaps, cardOverride, onSwapCard]);

  // Lazy-fetch Scryfall rulings for the card the side panel represents. This
  // tracks cardOverride ?? card — the same source the combo sections use — so
  // clicking a combo pill loads that card's rulings, but previewing a swap
  // candidate doesn't (the panel still reflects the focused card). Cached per
  // oracle_id in the client, so re-views are free.
  useEffect(() => {
    const target = cardOverride ?? card;
    if (!target) return;
    // Already cached → render reads it synchronously, no fetch/re-render needed.
    if (getCachedRulings(target) !== undefined) return;
    let cancelled = false;
    fetchCardRulings(target)
      .then(() => { if (!cancelled) bumpRulings((t) => t + 1); })
      .catch(() => { if (!cancelled) bumpRulings((t) => t + 1); });
    return () => { cancelled = true; };
  }, [cardOverride?.id, card?.id]);

  // Lazily load the SpellChroma tag index so the Tags tab works in every context
  // the preview opens (not just SpellChroma, which loads it eagerly). Cached after
  // the first load; the bump forces one re-render once tags become available.
  useEffect(() => {
    if (!card) return;
    if (isTagIndexLoaded()) return;
    let cancelled = false;
    loadTagIndex().then(() => { if (!cancelled) bumpTags((t) => t + 1); });
    return () => { cancelled = true; };
  }, [card?.id]);

  // Sort swap candidates: card type match first, then matching subtype tag, then rest
  // Must be above the early return to satisfy Rules of Hooks
  const sortedSwapCandidates = useMemo(() => {
    if (!card || !swapCandidates?.length) return swapCandidates;
    const originalType = getFrontFaceTypeLine(card).toLowerCase();
    const primaryTypes = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'battle'];
    const originalPrimary = primaryTypes.find(t => originalType.includes(t)) ?? '';
    // Get the original card's subtype for its role
    const originalSubtype = card.rampSubtype ?? card.removalSubtype ?? card.boardwipeSubtype ?? card.cardDrawSubtype ?? null;
    const getSubtype = (c: ScryfallCard) => c.rampSubtype ?? c.removalSubtype ?? c.boardwipeSubtype ?? c.cardDrawSubtype ?? null;
    const getRel = (c: ScryfallCard) => {
      if (!cardRelevancyMap) return 0;
      const norm = c.name.includes(' // ') ? c.name.split(' // ')[0] : c.name;
      return cardRelevancyMap[c.name] ?? cardRelevancyMap[norm] ?? 0;
    };
    return [...swapCandidates].sort((a, b) => {
      const aType = getFrontFaceTypeLine(a).toLowerCase();
      const bType = getFrontFaceTypeLine(b).toLowerCase();
      const aTypeMatch = originalPrimary && aType.includes(originalPrimary) ? 0 : 1;
      const bTypeMatch = originalPrimary && bType.includes(originalPrimary) ? 0 : 1;
      if (aTypeMatch !== bTypeMatch) return aTypeMatch - bTypeMatch;
      // Within same type-match tier, sort by subtype match
      const aSubMatch = originalSubtype && getSubtype(a) === originalSubtype ? 0 : 1;
      const bSubMatch = originalSubtype && getSubtype(b) === originalSubtype ? 0 : 1;
      if (aSubMatch !== bSubMatch) return aSubMatch - bSubMatch;
      // Within same type+subtype tier, rank by relevancy descending so the
      // top of each section is the most useful candidate for this deck.
      return getRel(b) - getRel(a);
    });
  }, [swapCandidates, card, cardRelevancyMap]);

  // Filter and rerank EDHREC similar cards.
  // Filters: drop self, drop already-in-deck, drop out-of-color-identity.
  // Rerank: inclusion % in this commander's umbrella, descending. Cards without
  // inclusion data sink to the end and keep EDHREC's native order among themselves.
  const filteredSimilarCards = useMemo<ScryfallCard[]>(() => {
    if (!card || !similarHydrated?.length) return [];

    const inDeckNameSet = new Set<string>();
    if (inDeckNames) {
      for (const n of inDeckNames) inDeckNameSet.add(n);
    } else if (generatedDeck) {
      for (const cards of Object.values(generatedDeck.categories)) {
        for (const c of cards) inDeckNameSet.add(c.name);
      }
    }

    const identitySource = commanderColorIdentity ?? commander?.color_identity ?? [];
    const cmdrIdentity = new Set(identitySource.map((c) => c.toUpperCase()));

    const filtered = similarHydrated.filter((c) => {
      if (c.name === card.name) return false;
      if (inDeckNameSet.has(c.name)) return false;
      if (cmdrIdentity.size > 0 && c.color_identity?.length) {
        if (!c.color_identity.every((col) => cmdrIdentity.has(col.toUpperCase()))) {
          return false;
        }
      }
      return true;
    });

    const scored: Array<{ card: ScryfallCard; key: number; idx: number; hasKey: boolean }> = [];
    const unscored: Array<{ card: ScryfallCard; idx: number }> = [];
    filtered.forEach((c, idx) => {
      const norm = c.name.includes(' // ') ? c.name.split(' // ')[0] : c.name;
      // Prefer relevancy when available; fall back to inclusion %.
      const rel = cardRelevancyMap?.[c.name] ?? cardRelevancyMap?.[norm];
      const incl = cardInclusionMap?.[c.name] ?? cardInclusionMap?.[norm];
      const key = typeof rel === 'number' ? rel : typeof incl === 'number' ? incl : null;
      if (key != null) scored.push({ card: c, key, idx, hasKey: true });
      else unscored.push({ card: c, idx });
    });
    scored.sort((a, b) => b.key - a.key);
    unscored.sort((a, b) => a.idx - b.idx);

    return [...scored.map((x) => x.card), ...unscored.map((x) => x.card)].slice(0, 15);
  }, [similarHydrated, card, generatedDeck, commander, cardInclusionMap, cardRelevancyMap, inDeckNames, commanderColorIdentity]);

  if (!card) return null;

  const displayCard = cardOverride ?? swapPreview ?? card;
  const isDfc = isDoubleFacedCard(displayCard);
  const backUrl = isDfc ? getCardBackFaceUrl(displayCard, 'large') : null;
  const imgUrl = showBack && backUrl ? backUrl : getCardImageUrl(displayCard, 'large');
  const faceName = showBack && displayCard.card_faces?.[1]
    ? displayCard.card_faces[1].name
    : displayCard.card_faces?.[0]?.name ?? displayCard.name;
  const faceType = showBack && displayCard.card_faces?.[1]
    ? displayCard.card_faces[1].type_line
    : displayCard.type_line;
  const currentCardName = displayCard.name.includes(' // ') ? displayCard.name.split(' // ')[0] : displayCard.name;
  const allCombosForCard = cardOverride && cardComboMap
    ? cardComboMap.get(currentCardName)
    : combos;
  const deckCombos = allCombosForCard?.filter(c => c.isComplete) ?? [];
  const knownCombos = allCombosForCard?.filter(c => !c.isComplete) ?? [];
  const hasCombos = deckCombos.length > 0 || (!deckOnly && knownCombos.length > 0);
  // Check if this card is missing from the deck (appears in its own combos' missingCards)
  const isMissingComboCard = allCombosForCard?.some(c => c.missingCards.includes(currentCardName)) ?? false;
  const isInMustInclude = mustIncludeCards.includes(currentCardName) || tempMustIncludeCards.includes(currentCardName);
  const hasRoleBucket = !!(swapCandidates && swapCandidates.length > 0);
  const hasSimilarBucket = filteredSimilarCards.length > 0 || similarLoading;
  const hasSwapSection = !!(
    (hasRoleBucket || hasSimilarBucket) &&
    onSwapCard &&
    !cardOverride &&
    !card.isMustInclude
  );
  const comboCount = deckCombos.length + (deckOnly ? 0 : knownCombos.length);
  // Resolve rulings synchronously from the client cache (keyed off cardOverride ?? card,
  // matching the fetch effect). `undefined` means "not fetched yet" → still loading.
  const rulingsTarget = cardOverride ?? card;
  const cachedRulings = rulingsTarget ? getCachedRulings(rulingsTarget) : undefined;
  const rulingsLoading = !!rulingsTarget && cachedRulings === undefined;
  const rulingsList = cachedRulings ?? [];
  const hasRulings = rulingsList.length > 0;
  // Oracle tags for the focused card (cardOverride ?? card, matching rulings so the
  // panel always reflects the focused card, not a staged swap preview).
  const tagSlugs = rulingsTarget ? tagsForOracleId(rulingsTarget.oracle_id) : [];
  const hasTags = tagSlugs.length > 0;
  // Available side-panel tabs in display order. The switcher appears only when 2+
  // have content; a lone section renders with its own header. Reserve the panel
  // while rulings load so the centered image doesn't jump when they arrive.
  const availableTabs: Array<'combos' | 'tags' | 'rulings'> = [];
  if (hasCombos) availableTabs.push('combos');
  if (hasTags) availableTabs.push('tags');
  if (hasRulings || rulingsLoading) availableTabs.push('rulings');
  const hasSidePanel = availableTabs.length > 0;
  const showTabSwitcher = availableTabs.length > 1;
  // Fall back to the first available tab when the active one has nothing for this card.
  const activeSideTab = availableTabs.includes(sidePanelTab) ? sidePanelTab : availableTabs[0];
  const canMustInclude = isMissingComboCard && !isInMustInclude;
  const alreadyMustIncluded = isInMustInclude;

  // Determine if displayCard is currently in the deck (or supplied inDeckNames list)
  const cardInDeck = (() => {
    const norm = displayCard.name.includes(' // ') ? displayCard.name.split(' // ')[0] : displayCard.name;
    if (inDeckNames) {
      return inDeckNames.includes(displayCard.name) || inDeckNames.includes(norm);
    }
    if (!generatedDeck) return false;
    for (const cards of Object.values(generatedDeck.categories)) {
      for (const c of cards) {
        if (c.name === displayCard.name || c.name === norm) return true;
      }
    }
    if (generatedDeck.commander?.name === displayCard.name) return true;
    if (generatedDeck.partnerCommander?.name === displayCard.name) return true;
    return false;
  })();
  // Show direct-add button when the previewed card is not in the deck and a direct-add handler exists.
  // Skip when a swap candidate is staged (the swap-bar Add covers that case).
  const canDirectAdd = !!onAddCard && !cardInDeck && !swapPreview && !cardOverride;

  const hasNav = !!(onNavigate && canNavigate && !cardOverride);

  return createPortal(
    <>
    <div
      data-card-preview-modal
      className="fixed inset-0 z-50 flex bg-black/80 backdrop-blur-sm animate-fade-in overflow-y-auto"
      onClick={onClose}
      onTouchStart={onNavigate ? handleTouchStart : undefined}
      onTouchMove={onNavigate ? handleTouchMove : undefined}
      onTouchEnd={onNavigate ? handleTouchEnd : undefined}
    >
      <div
        ref={contentRef}
        className={`relative w-fit max-w-[90vw] card-preview-content m-auto py-4 ${slideClass || 'animate-scale-in'}`}
        onClick={(e) => {
          // Stop propagation only when the click lands on actual content (image, buttons,
          // links, text). Clicks on empty layout containers — e.g. the column space to
          // the left/right of the card image, which is widened by the swap section
          // below — fall through to the backdrop's onClose so the modal closes.
          const target = e.target as HTMLElement;
          if (target.closest('button, a, input, img, h3, p, span, label, svg, [role="button"]')) {
            e.stopPropagation();
          }
        }}
      >
        {/* Main layout: image + side panel form the top row; the card info wraps to
            its own full-width, centered row below (md:basis-full on the info block). */}
        <div className={`${hasSidePanel ? 'md:flex md:flex-wrap md:items-start md:justify-center md:gap-x-5 md:gap-y-4' : ''}`}>
          {/* Card image column */}
          <div className="min-w-0 md:order-1">
            {/* Card image */}
            <div className="relative card-preview-image flex justify-center">
              <img
                src={imgUrl}
                alt={faceName}
                className="max-w-full w-auto rounded-xl shadow-2xl transition-all duration-200 max-h-[75vh]"
              />
              {isDfc && (
                <button
                  onClick={() => setShowBack(!showBack)}
                  className="absolute bottom-4 right-4 bg-white/90 hover:bg-white text-black rounded-full px-4 py-2 flex items-center gap-2 text-sm font-semibold shadow-lg transition-colors"
                  title={showBack ? 'Show front face' : 'Show back face'}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                  Flip
                </button>
              )}
            </div>
          </div>

          {/* Card info — its own full-width, centered row below the image + side panel */}
          <div className="mt-4 md:mt-0 text-center card-preview-info overflow-x-hidden md:order-3 md:basis-full">
          <h3 className="text-white font-bold text-lg">{faceName}</h3>
          {(displayCard.isGameChanger || isInMustInclude) && (
            <div className="flex items-center justify-center gap-2 mt-1">
              {displayCard.isGameChanger && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[11px] font-medium">
                  <Star className="w-3 h-3" />
                  Game Changer
                </span>
              )}
              {isInMustInclude && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[11px] font-medium">
                  <Pin className="w-3 h-3" />
                  Must Include
                </span>
              )}
            </div>
          )}
          <p className="text-white/70 text-sm">{faceType}</p>
          {getCardPrice(displayCard, currency) && (
            <p className="text-white/50 text-xs mt-1">{sym}{getCardPrice(displayCard, currency)}</p>
          )}
          {isOwned && !cardOverride && (
            <p className="text-emerald-400 text-xs mt-1.5 flex items-center justify-center gap-1">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              In your collection
            </p>
          )}
          <div className="flex items-center justify-center gap-3 mt-3 flex-wrap">
            {onBuildDeck && displayCard.type_line && (() => { const front = displayCard.type_line!.split(' // ')[0]; return /legendary/i.test(front) && /creature/i.test(front); })() && (
              <button
                onClick={() => { onBuildDeck(displayCard.name); onClose(); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary hover:bg-primary/80 text-primary-foreground text-xs font-medium transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="7" height="9" x="3" y="3" rx="1" />
                  <rect width="7" height="5" x="14" y="3" rx="1" />
                  <rect width="7" height="9" x="14" y="12" rx="1" />
                  <rect width="7" height="5" x="3" y="16" rx="1" />
                </svg>
                Build Deck
              </button>
            )}
            <a
              href={`https://scryfall.com/search?q=!%22${encodeURIComponent(displayCard.name)}%22`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs font-medium transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              Scryfall
            </a>
            <a
              href={`https://edhrec.com/cards/${(displayCard.name.split(' // ')[0]).toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs font-medium transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              EDHREC
            </a>
            {!hideMustInclude && canMustInclude && !canDirectAdd && (
              <button
                onClick={() => handleAddToDeck(currentCardName)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add to Deck
              </button>
            )}
            {!hideMustInclude && alreadyMustIncluded && (
              <button
                onClick={() => handleRemoveFromDeck(currentCardName)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-red-500/20 text-white/60 hover:text-red-400 text-xs font-medium transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                Remove from Deck
              </button>
            )}
            {canDirectAdd && (
              <button
                type="button"
                onClick={() => {
                  onAddCard!(displayCard);
                  trackEvent('must_include_added', {
                    commanderName: commander?.name ?? 'unknown',
                    cardName: displayCard.name,
                    source: 'modal',
                  });
                  setToastMessage(`Added "${displayCard.name}" to deck`);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add to Deck
              </button>
            )}
            {hasSwapSection && (
              <button
                type="button"
                onClick={handleToggleSwaps}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  showSwaps
                    ? 'bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25'
                    : 'bg-white/10 text-white/60 hover:bg-white/15 hover:text-white/80'
                }`}
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                Replacements
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-white/5 text-white/40">
                  {(swapCandidates?.length ?? 0) + filteredSimilarCards.length}
                </span>
              </button>
            )}
          </div>

            </div>

          {/* Side panel — combos and/or rulings, separated by tabs */}
          {hasSidePanel && (
            <div className="mt-3 md:mt-0 w-full md:w-[19.5rem] shrink-0 max-h-[30vh] sm:max-h-[35vh] md:max-h-[70vh] overflow-y-auto pr-1.5 md:order-2">
              {showTabSwitcher && (
                <div className="flex gap-1 mb-3 p-1 rounded-lg bg-white/5 border border-white/10">
                  {hasCombos && (
                    <button
                      type="button"
                      onClick={() => selectSideTab('combos')}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                        activeSideTab === 'combos'
                          ? 'bg-violet-500/20 text-violet-200'
                          : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                      }`}
                    >
                      <Sparkles className="w-3 h-3" />
                      Combos
                      <span className="text-[10px] font-medium px-1.5 rounded-full bg-white/10 text-white/50">{comboCount}</span>
                    </button>
                  )}
                  {hasTags && (
                    <button
                      type="button"
                      onClick={() => selectSideTab('tags')}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                        activeSideTab === 'tags'
                          ? 'bg-violet-500/20 text-violet-200'
                          : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                      }`}
                    >
                      <Tag className="w-3 h-3" />
                      Tags
                      <span className="text-[10px] font-medium px-1.5 rounded-full bg-white/10 text-white/50">{tagSlugs.length}</span>
                    </button>
                  )}
                  {(hasRulings || rulingsLoading) && (
                    <button
                      type="button"
                      onClick={() => selectSideTab('rulings')}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                        activeSideTab === 'rulings'
                          ? 'bg-white/15 text-white/90'
                          : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                      }`}
                    >
                      <ScrollText className="w-3 h-3" />
                      Rulings
                      <span className="text-[10px] font-medium px-1.5 rounded-full bg-white/10 text-white/50">{rulingsList.length}</span>
                    </button>
                  )}
                </div>
              )}
              {activeSideTab === 'combos' && deckCombos.length > 0 && (
                <>
                  <div className="flex items-center gap-1.5 mb-2.5 py-1.5 border-b border-white/10">
                    <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                    <span className="text-[11px] font-bold text-violet-300 tracking-wide uppercase">In Your Deck</span>
                    <span className="ml-auto text-[10px] font-medium text-violet-400/60 bg-violet-500/10 px-1.5 py-0.5 rounded-full">{deckCombos.length}</span>
                  </div>
                  <div className="space-y-2">
                    {deckCombos.map((combo) => (
                      <ComboEntry key={combo.comboId} combo={combo} currentCardName={currentCardName} cardTypeMap={cardTypeMap} handlePillHover={handlePillHover} setHoverPreview={setHoverPreview} handlePillClick={handlePillClick} />
                    ))}
                  </div>
                </>
              )}
              {activeSideTab === 'combos' && !deckOnly && knownCombos.length > 0 && (
                <>
                  <div className={`flex items-center gap-1.5 mb-2.5 py-1.5 border-b border-white/10 ${deckCombos.length > 0 ? 'mt-4' : ''}`}>
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-[11px] font-bold text-amber-300 tracking-wide uppercase">Known Combos</span>
                    <span className="ml-auto text-[10px] font-medium text-amber-400/60 bg-amber-500/10 px-1.5 py-0.5 rounded-full">{knownCombos.length}</span>
                  </div>
                  <div className="space-y-2">
                    {knownCombos.map((combo) => (
                      <ComboEntry key={combo.comboId} combo={combo} currentCardName={currentCardName} cardTypeMap={cardTypeMap} handlePillHover={handlePillHover} setHoverPreview={setHoverPreview} handlePillClick={handlePillClick} isKnown />
                    ))}
                  </div>
                </>
              )}
              {activeSideTab === 'tags' && hasTags && (
                <>
                  {!showTabSwitcher && (
                    <div className="flex items-center gap-1.5 mb-2.5 py-1.5 border-b border-white/10">
                      <Tag className="w-3.5 h-3.5 text-violet-400" />
                      <span className="text-[11px] font-bold text-violet-300 tracking-wide uppercase">Tags</span>
                      <span className="ml-auto text-[10px] font-medium text-violet-400/60 bg-violet-500/10 px-1.5 py-0.5 rounded-full">{tagSlugs.length}</span>
                    </div>
                  )}
                  <p className="text-[11px] text-white/50 leading-snug mb-2.5">
                    Click a tag to search for similar cards in SpellChroma.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {tagSlugs.map((slug) => (
                      <button
                        key={slug}
                        type="button"
                        onClick={() => {
                          if (onTagClick) onTagClick(slug);
                          else if (spellChromaDeckRef) {
                            // In a deck context: carry the whole deck along so SpellChroma
                            // opens with the full deck in its panel (edited in place, and the
                            // back button returns here) — mirrors the Statistics Top Tags chips.
                            navigate(`/spellchroma?deck=${encodeURIComponent(spellChromaDeckRef)}&tags=${encodeURIComponent(slug)}`);
                          } else {
                            // No deck context — carry just the previewed card so SpellChroma
                            // opens with it loaded in the deck area (the card we came from).
                            const params = new URLSearchParams({ tags: slug, card: rulingsTarget.name });
                            navigate(`/spellchroma?${params.toString()}`);
                          }
                          onClose();
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/15 text-violet-200 text-xs hover:bg-violet-500/30 transition-colors"
                      >
                        <Tag className="w-3.5 h-3.5 opacity-70" />
                        {slug}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {/* Rulings still loading with no combos to show — render a skeleton so the
                  reserved panel reads as intentional rather than empty space. */}
              {activeSideTab === 'rulings' && !hasRulings && rulingsLoading && (
                <>
                  {!showTabSwitcher && (
                    <div className="flex items-center gap-1.5 mb-2.5 py-1.5 border-b border-white/10">
                      <ScrollText className="w-3.5 h-3.5 text-white/60" />
                      <span className="text-[11px] font-bold text-white/70 tracking-wide uppercase">Rulings</span>
                    </div>
                  )}
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-14 w-full rounded-lg bg-white/5 animate-pulse" />
                    ))}
                  </div>
                </>
              )}
              {activeSideTab === 'rulings' && hasRulings && (
                <>
                  {!showTabSwitcher && (
                    <div className="flex items-center gap-1.5 mb-2.5 py-1.5 border-b border-white/10">
                      <ScrollText className="w-3.5 h-3.5 text-white/60" />
                      <span className="text-[11px] font-bold text-white/70 tracking-wide uppercase">Rulings</span>
                      <span className="ml-auto text-[10px] font-medium text-white/50 bg-white/10 px-1.5 py-0.5 rounded-full">{rulingsList.length}</span>
                    </div>
                  )}
                  <div className="space-y-2">
                    {rulingsList.map((ruling, idx) => (
                      <div key={idx} className="rounded-lg bg-white/10 border border-white/10 px-3 py-2.5">
                        <p className="text-[11px] text-white/70 leading-relaxed">
                          <ManaText text={ruling.comment} />
                        </p>
                        <div className="mt-1.5 text-[10px] text-white/40">
                          {ruling.source === 'wotc' ? 'WotC' : 'Scryfall'} · {formatRulingDate(ruling.published_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Swap candidates — below main layout, hidden until toggled */}
        {hasSwapSection && showSwaps && (
          <div className="mt-4">
              <div className="text-left">
                {/* Floating Swap button — sits above both sections so it stays visible regardless of which section the preview comes from */}
                {swapPreview && (
                  <div className="flex justify-end gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => setSwapPreview(null)}
                      aria-label={`Back to ${card.name}`}
                      title={`Back to ${card.name}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-white/80 hover:text-white text-xs font-medium transition-colors animate-fade-in max-w-[200px]"
                    >
                      <ArrowLeft className="w-3 h-3 shrink-0" />
                      <span className="truncate">{card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name}</span>
                    </button>
                    {onAddCard && (
                      <button
                        type="button"
                        onClick={() => {
                          onAddCard(swapPreview);
                          trackEvent('must_include_added', {
                            commanderName: commander?.name ?? 'unknown',
                            cardName: swapPreview.name,
                            source: 'modal',
                          });
                          setToastMessage(`Added "${swapPreview.name}" to deck`);
                          setSwapPreview(null);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors animate-fade-in"
                      >
                        <Plus className="w-3 h-3" />
                        Add
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        onSwapCard!(card, swapPreview);
                        trackEvent('card_swapped', {
                          commanderName: commander?.name ?? 'unknown',
                          oldCardName: card.name,
                          newCardName: swapPreview.name,
                          swapType: card.deckRole ?? 'type',
                        });
                        setToastMessage(`Swapped "${card.name}" for "${swapPreview.name}"`);
                        setSwapPreview(null);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors animate-fade-in"
                    >
                      <ArrowLeftRight className="w-3 h-3" />
                      Swap
                    </button>
                  </div>
                )}

                {/* Similar Cards (EDHREC per-card list, reranked by inclusion %) */}
                {(filteredSimilarCards.length > 0 || similarLoading) && (
                  <div className="mb-4">
                    <div className="flex items-center gap-1.5 mb-3">
                      <Sparkles className="w-3.5 h-3.5 text-violet-300" />
                      <span className="text-[11px] font-bold text-violet-200 tracking-wide uppercase">
                        Similar Cards
                      </span>
                      {similarLoading && (
                        <Loader2 className="w-3 h-3 text-white/40 animate-spin ml-1" />
                      )}
                    </div>
                    {similarLoading && filteredSimilarCards.length === 0 && (
                      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
                        {Array.from({ length: 6 }).map((_, i) => (
                          <div key={i} className="text-center">
                            <div className="w-full aspect-[5/7] rounded-lg border-2 border-white/10 bg-white/5 animate-pulse" />
                            <div className="h-2.5 mt-1 rounded bg-white/5 animate-pulse" />
                          </div>
                        ))}
                      </div>
                    )}
                    {filteredSimilarCards.length > 0 && (
                      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
                        {filteredSimilarCards.map((candidate) => {
                          const candNorm = candidate.name.includes(' // ') ? candidate.name.split(' // ')[0] : candidate.name;
                          const candIncl = cardInclusionMap ? (cardInclusionMap[candidate.name] ?? cardInclusionMap[candNorm] ?? null) : null;
                          const candPct = candIncl != null ? Math.round(candIncl) : null;
                          const candPrice = showPrice ? getCardPrice(candidate, currency) : null;
                          const isPreviewing = swapPreview?.id === candidate.id;
                          return (
                            <button
                              key={candidate.id}
                              type="button"
                              onClick={() => setSwapPreview(candidate)}
                              className={`group text-center transition-opacity ${
                                swapPreview && !isPreviewing ? 'opacity-60 hover:opacity-100' : ''
                              }`}
                            >
                              <div className="relative">
                                <img
                                  src={getCardImageUrl(candidate, 'small')}
                                  alt={candidate.name}
                                  className={`w-full rounded-lg border-2 transition-colors ${
                                    isPreviewing
                                      ? 'border-violet-300'
                                      : 'border-white/10 group-hover:border-violet-300/40'
                                  }`}
                                />
                                {candPct != null && (
                                  <span
                                    className="absolute top-1 left-1 bg-black/80 text-[9px] px-1 rounded font-medium"
                                    style={{ color: `hsl(${(candPct / 100) * 120}, 70%, 55%)` }}
                                  >
                                    {candPct}%
                                  </span>
                                )}
                                {candPrice && (
                                  <span className="absolute bottom-1 right-1 bg-black/80 text-white/80 text-[9px] px-1 rounded font-medium">
                                    {sym}{parseFloat(candPrice).toFixed(2)}
                                  </span>
                                )}
                              </div>
                              <div className={`text-[10px] mt-1 truncate transition-colors flex items-center justify-center gap-1 ${
                                isPreviewing ? 'text-violet-200 font-medium' : 'text-white/70 group-hover:text-violet-200'
                              }`}>
                                <CardTypeIcon type={getCardType(candidate)} size="sm" className="opacity-60 shrink-0" />
                                {candNorm}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Role/subtype bucket — original card highlight + candidates */}
                {!swapsReady && !hasRoleBucket && (
                  <div className="space-y-2 mb-3">
                    <div className="text-[11px] text-muted-foreground">Loading suggestions…</div>
                    <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
                      {[1, 2, 3, 4, 5, 6].map(i => (
                        <div key={i} className="aspect-[488/680] w-full bg-accent/20 rounded-lg animate-pulse" />
                      ))}
                    </div>
                  </div>
                )}
                {hasRoleBucket && (
                <div className="flex items-center gap-1.5 mb-3">
                  <ArrowLeftRight className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-[11px] font-bold text-cyan-300 tracking-wide uppercase">
                    {card.deckRole === 'ramp' ? (
                      card.rampSubtype === 'mana-producer' ? 'Mana Producer' :
                      card.rampSubtype === 'cost-reducer' ? 'Cost Reducer' : 'Ramp'
                    ) : card.deckRole === 'removal' ? (
                      card.removalSubtype === 'bounce' ? 'Bounce' :
                      card.removalSubtype === 'spot-removal' ? 'Spot Removal' : 'Removal'
                    ) : card.deckRole === 'boardwipe' ? (
                      card.boardwipeSubtype === 'bounce-wipe' ? 'Bounce Wipe' : 'Board Wipe'
                    ) : card.deckRole === 'cardDraw' ? (
                      card.cardDrawSubtype === 'tutor' ? 'Tutor' :
                      card.cardDrawSubtype === 'wheel' ? 'Wheel' :
                      card.cardDrawSubtype === 'cantrip' ? 'Cantrip' : 'Card Draw'
                    ) : getCardType(card)} Replacements
                  </span>
                </div>
                )}
                {hasRoleBucket && (
                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
                  {/* Original card — highlighted */}
                  {(() => {
                    const origNorm = card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name;
                    const origIncl = cardInclusionMap ? (cardInclusionMap[card.name] ?? cardInclusionMap[origNorm] ?? null) : null;
                    const origPct = origIncl != null ? Math.round(origIncl) : null;
                    const origPrice = showPrice ? getCardPrice(card, currency) : null;
                    return (
                      <button
                        type="button"
                        onClick={() => setSwapPreview(null)}
                        className={`text-center transition-opacity ${
                          !swapPreview ? '' : 'opacity-60 hover:opacity-100'
                        }`}
                      >
                        <div className="relative">
                          <img
                            src={getCardImageUrl(card, 'small')}
                            alt={card.name}
                            className={`w-full rounded-lg border-2 transition-colors ${
                              !swapPreview ? 'border-cyan-400' : 'border-cyan-400/40'
                            }`}
                          />
                          {origPct != null && (
                            <span
                              className="absolute top-1 left-1 bg-black/80 text-[9px] px-1 rounded font-medium"
                              style={{ color: `hsl(${(origPct / 100) * 120}, 70%, 55%)` }}
                            >
                              {origPct}%
                            </span>
                          )}
                          {origPrice && (
                            <span className="absolute bottom-1 right-1 bg-black/80 text-white/80 text-[9px] px-1 rounded font-medium">
                              {sym}{parseFloat(origPrice).toFixed(2)}
                            </span>
                          )}
                        </div>
                        <div className={`text-[10px] mt-1 truncate flex items-center justify-center gap-1 ${!swapPreview ? 'text-cyan-300 font-medium' : 'text-white/70'}`}>
                          <CardTypeIcon type={getCardType(card)} size="sm" className="opacity-60 shrink-0" />
                          {origNorm}
                        </div>
                      </button>
                    );
                  })()}
                  {/* Candidates */}
                  {sortedSwapCandidates?.map((candidate) => {
                    const candNorm = candidate.name.includes(' // ') ? candidate.name.split(' // ')[0] : candidate.name;
                    const candIncl = cardInclusionMap ? (cardInclusionMap[candidate.name] ?? cardInclusionMap[candNorm] ?? null) : null;
                    const candPct = candIncl != null ? Math.round(candIncl) : null;
                    const candRel = cardRelevancyMap ? (cardRelevancyMap[candidate.name] ?? cardRelevancyMap[candNorm] ?? null) : null;
                    const candPrice = showPrice ? getCardPrice(candidate, currency) : null;
                    return (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => setSwapPreview(candidate)}
                      className={`group text-center transition-opacity ${
                        swapPreview && swapPreview.id !== candidate.id ? 'opacity-60 hover:opacity-100' : ''
                      }`}
                    >
                      <div className="relative">
                        <img
                          src={getCardImageUrl(candidate, 'small')}
                          alt={candidate.name}
                          className={`w-full rounded-lg border-2 transition-colors ${
                            swapPreview?.id === candidate.id
                              ? 'border-cyan-400'
                              : 'border-white/10 group-hover:border-cyan-400/40'
                          }`}
                        />
                        {candPct != null && (
                          <span
                            className="absolute top-1 left-1 bg-black/80 text-[9px] px-1 rounded font-medium"
                            style={{ color: `hsl(${(candPct / 100) * 120}, 70%, 55%)` }}
                          >
                            {candPct}%
                          </span>
                        )}
                        {candPrice && (
                          <span className="absolute bottom-1 right-1 bg-black/80 text-white/80 text-[9px] px-1 rounded font-medium">
                            {sym}{parseFloat(candPrice).toFixed(2)}
                          </span>
                        )}
                      </div>
                      <div className={`text-[10px] mt-1 truncate transition-colors flex items-center justify-center gap-1 ${
                        swapPreview?.id === candidate.id
                          ? 'text-cyan-300 font-medium'
                          : 'text-white/70 group-hover:text-cyan-300'
                      }`}>
                        {candRel != null && (
                          <span className="text-violet-400 font-bold shrink-0" title={`Relevancy: ${candRel}`}>{candRel}</span>
                        )}
                        <CardTypeIcon type={getCardType(candidate)} size="sm" className="opacity-60 shrink-0" />
                        {candNorm}
                      </div>
                    </button>
                    );
                  })}
                </div>
                )}
              </div>
              {/* Inline card position indicator when swaps are open */}
              {hasNav && cardIndex != null && totalCards != null && (
                <div className="text-center mt-3">
                  <span className="bg-black/60 backdrop-blur-sm text-white/70 text-xs font-medium px-3 py-1.5 rounded-full">
                    {cardIndex + 1} / {totalCards}
                  </span>
                </div>
              )}
          </div>
        )}

        {/* Hover card preview for combo pills */}
        {hoverPreview && (
          <div
            className="pointer-events-none fixed z-[110] animate-fade-in"
            style={{
              top: hoverPreview.top,
              left: hoverPreview.left,
              transform: hoverPreview.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
            }}
          >
            <img
              src={hoverImage.url}
              alt={hoverPreview.name}
              className="w-48 rounded-lg shadow-2xl border border-white/10"
            />
          </div>
        )}
      </div>
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-[60] px-4 py-3 bg-emerald-600/90 text-white text-sm rounded-lg shadow-lg animate-fade-in max-w-sm flex items-center gap-2">
          <Pin className="w-4 h-4 shrink-0" />
          {toastMessage}
        </div>
      )}
    </div>
    {/* Navigation arrows + position indicator live OUTSIDE the scrolling backdrop
        so they stay pinned to the viewport (backdrop-filter on the backdrop creates
        a containing block that would otherwise trap position: fixed children). */}
    <button
      onClick={onClose}
      aria-label="Close"
      className="fixed top-2 right-2 z-[60] bg-black/60 hover:bg-black/80 rounded-full p-1.5 text-white/70 hover:text-white transition-colors shadow-lg"
    >
      <X className="w-5 h-5" />
    </button>
    {inComboNav && (
      <>
        <button
          onClick={(e) => { e.stopPropagation(); navigateCombo('prev'); }}
          className="fixed left-1 sm:left-4 top-1/2 -translate-y-1/2 z-[60] flex items-center group"
          title="Previous combo card"
        >
          <span className="bg-violet-500/40 group-hover:bg-violet-500/60 active:bg-violet-500/80 text-white rounded-full p-2.5 sm:p-3 transition-all backdrop-blur-sm flex items-center justify-center shadow-lg relative z-10">
            <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
          </span>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); navigateCombo('next'); }}
          className="fixed right-1 sm:right-4 top-1/2 -translate-y-1/2 z-[60] flex items-center group"
          title="Next combo card"
        >
          <span className="bg-violet-500/40 group-hover:bg-violet-500/60 active:bg-violet-500/80 text-white rounded-full p-2.5 sm:p-3 transition-all backdrop-blur-sm flex items-center justify-center shadow-lg relative z-10">
            <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
          </span>
        </button>
      </>
    )}
    {hasNav && canNavigate.prev && (
      <button
        onClick={(e) => { e.stopPropagation(); slideDirectionRef.current = 'prev'; onNavigate!('prev'); }}
        className="fixed left-1 sm:left-4 top-1/2 -translate-y-1/2 z-[60] flex items-center group"
        title="Previous card"
      >
        {prevCardImage ? (
          <img
            src={prevCardImage}
            alt="Previous"
            className="hidden sm:block w-20 rounded-lg shadow-lg opacity-40 group-hover:opacity-70 transition-opacity -mr-3 pointer-events-none"
          />
        ) : null}
        <span className="bg-black/60 group-hover:bg-black/80 active:bg-black/90 text-white/70 group-hover:text-white rounded-full p-2.5 sm:p-3 transition-all backdrop-blur-sm flex items-center justify-center shadow-lg relative z-10">
          <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
        </span>
      </button>
    )}
    {hasNav && canNavigate.next && (
      <button
        onClick={(e) => { e.stopPropagation(); slideDirectionRef.current = 'next'; onNavigate!('next'); }}
        className="fixed right-1 sm:right-4 top-1/2 -translate-y-1/2 z-[60] flex items-center group"
        title="Next card"
      >
        <span className="bg-black/60 group-hover:bg-black/80 active:bg-black/90 text-white/70 group-hover:text-white rounded-full p-2.5 sm:p-3 transition-all backdrop-blur-sm flex items-center justify-center shadow-lg relative z-10">
          <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
        </span>
        {nextCardImage ? (
          <img
            src={nextCardImage}
            alt="Next"
            className="hidden sm:block w-20 rounded-lg shadow-lg opacity-40 group-hover:opacity-70 transition-opacity -ml-3 pointer-events-none"
          />
        ) : null}
      </button>
    )}
    {hasNav && cardIndex != null && totalCards != null && !(hasSwapSection && showSwaps) && (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] bg-black/60 backdrop-blur-sm text-white/70 text-xs font-medium px-3 py-1.5 rounded-full shadow-lg pointer-events-none">
        {cardIndex + 1} / {totalCards}
      </div>
    )}
    </>,
    document.body
  );
}
