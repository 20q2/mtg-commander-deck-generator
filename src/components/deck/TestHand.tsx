import { useState, useCallback, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { getCardImageUrl } from '@/services/scryfall/client';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { useStore } from '@/store';
import type { ScryfallCard } from '@/types';
import { Plus, Shuffle, Info, Hand, ChevronDown } from 'lucide-react';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';

/** Fisher-Yates shuffle (returns a new array). */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function initialDeal(cards: ScryfallCard[]) {
  const shuffled = shuffle(cards);
  return { hand: shuffled.slice(0, 7), library: shuffled.slice(7) };
}

interface DragState {
  index: number;
  startX: number;
  currentX: number;
  hasMoved: boolean;
  settling: boolean;
}

export function TestHand() {
  const generatedDeck = useStore(s => s.generatedDeck);
  const [expanded, setExpanded] = useState(false);
  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);

  // Build flat card array + land count from generated deck
  const { allCards, landCount } = useMemo(() => {
    if (!generatedDeck) return { allCards: [] as ScryfallCard[], landCount: 0 };
    const all = Object.values(generatedDeck.categories).flat();
    const lands = all.filter(c => getFrontFaceTypeLine(c).toLowerCase().includes('land')).length;
    return { allCards: all, landCount: lands };
  }, [generatedDeck]);

  if (allCards.length === 0) return null;

  return (
    <div className="mt-6 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm">
      {/* Accordion header */}
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center gap-2 w-full text-left p-4"
      >
        <Hand className="w-4 h-4 text-primary shrink-0" />
        <h3 className="text-sm font-semibold">Test Hand</h3>
        <span className="text-xs text-muted-foreground ml-auto shrink-0">
          {allCards.length} cards · {landCount} lands
        </span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* Accordion body */}
      <div className={`transition-all duration-300 ${expanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden'}`}>
        {expanded && (
          <TestHandContent
            cards={allCards}
            landCount={landCount}
            onCardClick={setPreviewCard}
          />
        )}
      </div>

      <CardPreviewModal
        card={previewCard}
        onClose={() => setPreviewCard(null)}
      />
    </div>
  );
}

// --- Inner content (only rendered when expanded) ---

interface TestHandContentProps {
  cards: ScryfallCard[];
  landCount: number;
  onCardClick: (card: ScryfallCard) => void;
}

function TestHandContent({ cards, landCount, onCardClick }: TestHandContentProps) {
  const [hand, setHand] = useState<ScryfallCard[]>(() => initialDeal(cards).hand);
  const libraryRef = useRef<ScryfallCard[]>([]);
  const [drawnCardKey, setDrawnCardKey] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync initial library with hand on first render
  const initRef = useRef(false);
  if (!initRef.current) {
    const deal = initialDeal(cards);
    setHand(deal.hand);
    libraryRef.current = deal.library;
    initRef.current = true;
  }

  const dealNewHand = useCallback(() => {
    const deal = initialDeal(cards);
    setHand(deal.hand);
    libraryRef.current = deal.library;
    setDrawnCardKey(null);
    setDragState(null);
  }, [cards]);

  const draw = useCallback(() => {
    if (libraryRef.current.length === 0) return;
    const next = libraryRef.current[0];
    libraryRef.current = libraryRef.current.slice(1);
    const key = `${next.id}-drawn-${Date.now()}`;
    setDrawnCardKey(key);
    setHand(prev => [...prev, next]);
  }, []);

  // --- Drag handlers ---
  const DRAG_THRESHOLD = 5;

  const onPointerDown = useCallback((e: React.PointerEvent, index: number) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragState({ index, startX: e.clientX, currentX: e.clientX, hasMoved: false, settling: false });
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    setDragState(prev => {
      if (!prev) return null;
      const hasMoved = prev.hasMoved || Math.abs(e.clientX - prev.startX) > DRAG_THRESHOLD;
      return { ...prev, currentX: e.clientX, hasMoved };
    });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragState) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

    if (!dragState.hasMoved) {
      onCardClick(hand[dragState.index]);
      setDragState(null);
      return;
    }

    // getBoundingClientRect already includes the CSS transform, so no need to add deltaX
    const draggedRect = cardRefs.current[dragState.index]?.getBoundingClientRect();
    if (!draggedRect) { setDragState(null); return; }

    const draggedCenter = draggedRect.left + draggedRect.width / 2;

    let targetIndex = dragState.index;
    for (let i = 0; i < hand.length; i++) {
      if (i === dragState.index) continue;
      const ref = cardRefs.current[i];
      if (!ref) continue;
      const rect = ref.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      if (dragState.index < i && draggedCenter > center) targetIndex = i;
      if (dragState.index > i && draggedCenter < center) { targetIndex = i; break; }
    }

    if (targetIndex !== dragState.index) {
      setHand(prev => {
        const next = [...prev];
        const [moved] = next.splice(dragState.index, 1);
        next.splice(targetIndex, 0, moved);
        return next;
      });
    }

    // Enter settling phase — card transitions smoothly to its slot
    setDragState(prev => prev ? { ...prev, settling: true } : null);
    setTimeout(() => setDragState(null), 200);
  }, [dragState, hand, onCardClick]);

  function getDragTransform(i: number): React.CSSProperties {
    if (!dragState || !dragState.hasMoved) return {};

    // Settling: animate the dragged card back to its natural position
    if (dragState.settling) {
      if (i === dragState.index) {
        return {
          transform: 'translateX(0) translateY(0) scale(1)',
          zIndex: 50,
          transition: 'transform 200ms ease',
        };
      }
      return { transition: 'transform 200ms ease' };
    }

    if (i === dragState.index) {
      const deltaX = dragState.currentX - dragState.startX;
      return {
        transform: `translateX(${deltaX}px) translateY(-8px) scale(1.05)`,
        zIndex: 50,
        transition: 'none',
        cursor: 'grabbing',
      };
    }

    // getBoundingClientRect already includes the CSS transform
    const draggedRect = cardRefs.current[dragState.index]?.getBoundingClientRect();
    if (!draggedRect) return {};
    const draggedCenter = draggedRect.left + draggedRect.width / 2;
    const thisRect = cardRefs.current[i]?.getBoundingClientRect();
    if (!thisRect) return {};
    const thisCenter = thisRect.left + thisRect.width / 2;

    const cardWidth = thisRect.width * 0.6;
    if (dragState.index < i && draggedCenter > thisCenter) {
      return { transform: `translateX(-${cardWidth}px)`, transition: 'transform 200ms ease' };
    }
    if (dragState.index > i && draggedCenter < thisCenter) {
      return { transform: `translateX(${cardWidth}px)`, transition: 'transform 200ms ease' };
    }

    return { transition: 'transform 200ms ease' };
  }

  const totalCards = cards.length || 99;
  const avgLands = ((landCount / totalCards) * 7).toFixed(2);

  // Dynamic overlap: keep total width roughly constant as cards are drawn
  // With 7 cards the base overlap is 1.5rem; as more cards are added, overlap increases
  const baseOverlap = 1.5; // rem, for 7 cards
  const overlapRem = hand.length <= 7
    ? baseOverlap
    : baseOverlap + (hand.length - 7) * 0.35;

  return (
    <div className="px-4 pb-4">
      {/* Card fan */}
      <div className="flex justify-center overflow-x-auto pt-4 pb-2 scrollbar-thin">
        <div ref={containerRef} className="flex items-end select-none">
          {hand.map((card, i) => {
            const isNewCard = drawnCardKey && i === hand.length - 1;
            const cardKey = isNewCard ? drawnCardKey : `${card.id}-${i}`;

            return (
              <div
                key={cardKey}
                ref={(el) => { cardRefs.current[i] = el; }}
                onPointerDown={(e) => onPointerDown(e, i)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                className={`relative shrink-0 rounded-lg touch-none transition-all duration-200 ${
                  isNewCard ? 'animate-[slideInRight_300ms_ease-out]' : ''
                } ${
                  dragState?.hasMoved && dragState.index === i ? '' : 'hover:-translate-y-2 hover:z-20 hover:scale-105'
                }`}
                style={{
                  marginLeft: i === 0 ? 0 : `-${overlapRem}rem`,
                  zIndex: dragState?.hasMoved && dragState.index === i ? 50 : i,
                  width: 'clamp(80px, 12vw, 140px)',
                  cursor: dragState?.hasMoved ? 'grabbing' : 'grab',
                  ...getDragTransform(i),
                }}
              >
                <img
                  src={getCardImageUrl(card, 'normal')}
                  alt={card.name}
                  className="w-full rounded-lg shadow-md pointer-events-none"
                  loading="lazy"
                  draggable={false}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Buttons */}
      <div className="flex justify-center gap-3 mt-3">
        <Button
          variant="outline"
          size="sm"
          onClick={draw}
          disabled={libraryRef.current.length === 0}
        >
          <Plus className="w-4 h-4 mr-1.5" />
          Draw
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={dealNewHand}
        >
          <Shuffle className="w-4 h-4 mr-1.5" />
          Deal Another Hand
        </Button>
      </div>

      {/* Average lands stat */}
      <div className="flex items-center justify-center gap-1.5 mt-3 text-xs text-muted-foreground">
        <span>
          Average number of lands in opening hand: <strong className="text-foreground">{avgLands}</strong>
        </span>
      </div>
    </div>
  );
}
