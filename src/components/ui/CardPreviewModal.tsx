import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, Star, Pin, ArrowLeftRight, Plus, ChevronLeft, ChevronRight, ChevronDown, ListChecks, Footprints, Infinity, Loader2 } from 'lucide-react';
import { getCardImageUrl, isDoubleFacedCard, getCardBackFaceUrl, getCardPrice, getCardByName, getFrontFaceTypeLine } from '@/services/scryfall/client';
import { fetchComboDetails, type ComboDetails } from '@/services/edhrec/client';
import type { ScryfallCard, DetectedCombo } from '@/types';
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

function getScryfallImageUrl(cardName: string): string {
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}&format=image&version=normal`;
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
  handlePillClick: (name: string) => void;
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
    <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5">
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
              onClick={() => handlePillClick(name)}
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

export function CardPreviewModal({ card, onClose, onBuildDeck, isOwned, combos, cardTypeMap, cardComboMap, deckOnly, hideMustInclude, swapCandidates, onSwapCard, initialSideTab, onRegenerate, onNavigate, canNavigate, cardIndex, totalCards, cardInclusionMap, cardRelevancyMap, showPrice }: CardPreviewModalProps) {
  const commander = useStore((s) => s.commander);
  const currency = useStore((s) => s.customization.currency);
  const mustIncludeCards = useStore((s) => s.customization.mustIncludeCards);
  const tempMustIncludeCards = useStore((s) => s.customization.tempMustIncludeCards ?? []);
  const updateCustomization = useStore((s) => s.updateCustomization);
  const sym = currency === 'EUR' ? '€' : '$';
  const [showBack, setShowBack] = useState(false);
  const [cardOverride, setCardOverride] = useState<ScryfallCard | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{ name: string; top: number; left: number; below: boolean } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [swapPreview, setSwapPreview] = useState<ScryfallCard | null>(null);
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

  // Keyboard navigation (ArrowLeft/ArrowRight)
  useEffect(() => {
    if (!card || !onNavigate) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (cardOverride) return; // don't navigate while viewing a combo pill card
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
  }, [card, onNavigate, canNavigate, cardOverride]);

  // Touch drag-to-swipe navigation — card follows finger, then navigates or snaps back
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragOffsetRef = useRef(0);
  const isDraggingRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!onNavigate || cardOverride) return;
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    dragOffsetRef.current = 0;
    isDraggingRef.current = false;
  }, [onNavigate, cardOverride]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || !onNavigate || cardOverride) return;
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
    // Dampen the drag if moving in a direction we can't navigate
    let offset = dx;
    if ((dx < 0 && !canNavigate?.next) || (dx > 0 && !canNavigate?.prev)) {
      offset = dx * 0.2; // rubber band effect
    }
    dragOffsetRef.current = offset;
    if (contentRef.current) {
      contentRef.current.style.transform = `translateX(${offset}px)`;
      contentRef.current.style.opacity = `${1 - Math.min(Math.abs(offset) / 400, 0.4)}`;
    }
  }, [onNavigate, canNavigate, cardOverride]);

  const handleTouchEnd = useCallback(() => {
    if (!touchStartRef.current && !isDraggingRef.current) return;
    const offset = dragOffsetRef.current;
    const navigated = isDraggingRef.current && Math.abs(offset) > 60;
    touchStartRef.current = null;
    isDraggingRef.current = false;
    dragOffsetRef.current = 0;
    if (navigated && onNavigate && !cardOverride) {
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
  }, [onNavigate, canNavigate, cardOverride]);

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

  const handlePillClick = useCallback(async (name: string) => {
    try {
      const fetched = await getCardByName(name);
      if (fetched) {
        setCardOverride(fetched);
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
    return [...swapCandidates].sort((a, b) => {
      const aType = getFrontFaceTypeLine(a).toLowerCase();
      const bType = getFrontFaceTypeLine(b).toLowerCase();
      const aTypeMatch = originalPrimary && aType.includes(originalPrimary) ? 0 : 1;
      const bTypeMatch = originalPrimary && bType.includes(originalPrimary) ? 0 : 1;
      if (aTypeMatch !== bTypeMatch) return aTypeMatch - bTypeMatch;
      // Within same type-match tier, sort by subtype match
      const aSubMatch = originalSubtype && getSubtype(a) === originalSubtype ? 0 : 1;
      const bSubMatch = originalSubtype && getSubtype(b) === originalSubtype ? 0 : 1;
      return aSubMatch - bSubMatch;
    });
  }, [swapCandidates, card]);

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
  const hasSwapSection = !!(swapCandidates && swapCandidates.length > 0 && onSwapCard && !cardOverride && !card.isMustInclude);
  const hasSidePanel = hasCombos;
  const canMustInclude = isMissingComboCard && !isInMustInclude;
  const alreadyMustIncluded = isInMustInclude;

  const hasNav = !!(onNavigate && canNavigate && !cardOverride);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex bg-black/80 backdrop-blur-sm animate-fade-in overflow-y-auto"
      onClick={onClose}
      onTouchStart={onNavigate ? handleTouchStart : undefined}
      onTouchMove={onNavigate ? handleTouchMove : undefined}
      onTouchEnd={onNavigate ? handleTouchEnd : undefined}
    >
      {/* Navigation arrows — always visible, including mobile */}
      {hasNav && canNavigate.prev && (
        <button
          onClick={(e) => { e.stopPropagation(); slideDirectionRef.current = 'prev'; onNavigate!('prev'); }}
          className="fixed left-1 sm:left-4 top-1/2 -translate-y-1/2 z-[55] bg-black/60 hover:bg-black/80 active:bg-black/90 text-white/70 hover:text-white rounded-full p-2.5 sm:p-3 transition-all backdrop-blur-sm flex items-center justify-center shadow-lg"
          title="Previous card"
        >
          <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>
      )}
      {hasNav && canNavigate.next && (
        <button
          onClick={(e) => { e.stopPropagation(); slideDirectionRef.current = 'next'; onNavigate!('next'); }}
          className="fixed right-1 sm:right-4 top-1/2 -translate-y-1/2 z-[55] bg-black/60 hover:bg-black/80 active:bg-black/90 text-white/70 hover:text-white rounded-full p-2.5 sm:p-3 transition-all backdrop-blur-sm flex items-center justify-center shadow-lg"
          title="Next card"
        >
          <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>
      )}
      {/* Card position indicator — fixed when swap section is closed */}
      {hasNav && cardIndex != null && totalCards != null && !(hasSwapSection && showSwaps) && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[55] bg-black/60 backdrop-blur-sm text-white/70 text-xs font-medium px-3 py-1.5 rounded-full shadow-lg pointer-events-none"
        >
          {cardIndex + 1} / {totalCards}
        </div>
      )}
      <div ref={contentRef} className={`relative w-fit max-w-[90vw] card-preview-content m-auto py-4 ${slideClass || 'animate-scale-in'}`} onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute top-2 right-2 bg-black/60 rounded-full p-1.5 text-white/70 hover:text-white transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Main layout: card column + optional combo panel side-by-side on desktop */}
        <div className={`${hasSidePanel ? 'md:flex md:items-start md:gap-5' : ''}`}>
          {/* Card column: image + info + swap candidates */}
          <div className="min-w-0">
            {/* Card image */}
            <div className="relative card-preview-image flex justify-center">
              <img
                src={imgUrl}
                alt={faceName}
                className={`max-w-full w-auto rounded-xl shadow-2xl transition-all duration-200 ${hasSidePanel ? 'max-h-[50vh] sm:max-h-[60vh] md:max-h-[75vh] lg:max-h-[80vh]' : 'max-h-[75vh]'}`}
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

            {/* Card info */}
            <div className="mt-4 text-center card-preview-info overflow-x-hidden">
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
              href={`https://edhrec.com/cards/${(displayCard.name.split(' // ')[0]).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`}
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
            {!hideMustInclude && canMustInclude && (
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
                  {swapCandidates?.length ?? 0}
                </span>
              </button>
            )}
          </div>

            </div>
          </div>

          {/* Side panel — combos only */}
          {hasSidePanel && (
            <div className="mt-3 md:mt-0 w-full md:w-72 shrink-0 max-h-[30vh] sm:max-h-[35vh] md:max-h-[70vh] overflow-y-auto pr-1.5">
              {deckCombos.length > 0 && (
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
              {!deckOnly && knownCombos.length > 0 && (
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
            </div>
          )}
        </div>

        {/* Swap candidates — below main layout, hidden until toggled */}
        {hasSwapSection && showSwaps && (
          <div className="mt-4">
              <div className="text-left">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <ArrowLeftRight className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-[11px] font-bold text-cyan-300 tracking-wide uppercase">
                      {card.deckRole === 'ramp' ? (
                        card.rampSubtype === 'mana-producer' ? 'Mana Producer' :
                        card.rampSubtype === 'cost-reducer' ? 'Cost Reducer' : 'Ramp'
                      ) : card.deckRole === 'removal' ? (
                        card.removalSubtype === 'counterspell' ? 'Counterspell' :
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
                  {swapPreview && (
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
                  )}
                </div>
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
              src={getScryfallImageUrl(hoverPreview.name)}
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
    </div>,
    document.body
  );
}
