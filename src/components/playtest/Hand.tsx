import { useEffect, useRef, useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { getCardImageUrl, getFrontFaceTypeLine } from '@/services/scryfall/client';
import { PlaytestCardMenu, type CardMenuTarget } from '@/components/playtest/PlaytestCardMenu';
import { PlaytestActionsBar, NextTurnButton } from '@/components/playtest/PlaytestActionsBar';
import { PlaytestPile, PILES } from '@/components/playtest/PlaytestPile';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { useMagnifyKey } from '@/hooks/useMagnifyKey';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { ScryfallCard } from '@/types';

type SortMode = 'none' | 'cmc' | 'type';

export function Hand() {
  const hand = usePlaytestStore(s => s.zones.hand);
  const moveCard = usePlaytestStore(s => s.moveCard);
  const setHoveredHandIndex = usePlaytestStore(s => s.setHoveredHandIndex);
  const [sort, setSort] = useState<SortMode>('none');
  // Conditionally RENDER the hand-row piles (not just CSS-hide) so they
  // don't share dnd-kit IDs with the mobile floating piles on the battlefield.
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [menu, setMenu] = useState<CardMenuTarget | null>(null);
  const [hoveredFanIndex, setHoveredFanIndex] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [rowWidth, setRowWidth] = useState(0);

  useEffect(() => {
    if (!rowRef.current) return;
    const el = rowRef.current;
    const update = () => setRowWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const display = sortedHand(hand, sort);
  const overlap = computeOverlap(display.length, rowWidth);

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: 'hand',
    data: { kind: 'pile', zone: 'hand' },
  });

  const playToBattlefield = (handIndex: number) => {
    moveCard({
      source: { kind: 'zone', zone: 'hand', index: handIndex },
      target: { kind: 'battlefield', x: 50, y: 0, arrived: true },
    });
  };

  return (
    <div
      ref={setDropRef}
      className="border-t border-border/50 bg-card/30 px-2 sm:px-4 py-2 sm:py-3 flex flex-col"
    >
      {/* Toolbar row mirrors the hand row's three-column layout below so the
          action buttons center over the hand fan, not over the whole bar. The
          hairline under it separates the controls from the cards they act on.
          Negative margins cancel the wrapper's padding so the row's buttons sit
          flush against the top edge and the hairline, and the hairline itself
          runs the full width of the bar instead of stopping at the padding.
          No right padding either, so Next Turn ends on the bar's right edge.

          This hairline doubles as the hand's drop indicator: a card dragged over
          the hand lights it up. Ringing the whole container instead drew the
          highlight ABOVE the controls, which read as "drop on the toolbar". */}
      <div
        className={`relative flex items-center gap-2 mb-2 -mt-2 sm:-mt-3 -mx-2 sm:-mx-4 pl-2 sm:pl-4 border-b transition-colors duration-150 ${
          isOver ? 'border-primary' : 'border-border/40'
        }`}
      >
        {/* The bloom rides its own hairline element rather than a box-shadow on
            the row — a shadow on the row haloes the whole button strip, when the
            only thing that should light up is the line. */}
        {isOver && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-primary shadow-[0_0_8px_1px_hsl(var(--primary)/0.75)]"
          />
        )}
        <div className="shrink-0 flex items-center gap-2">
          <span className="text-[10px] uppercase opacity-60 shrink-0">Hand · {hand.length}</span>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortMode)}
            className="hidden sm:inline-block text-[10px] uppercase opacity-60 bg-transparent border border-border/50 rounded-none px-1 py-0.5 shrink-0 min-w-0"
            title="Sort hand"
          >
            <option value="none">None</option>
            <option value="cmc">CMC</option>
            <option value="type">Type</option>
          </select>
        </div>
        <div className="flex-1 flex justify-center min-w-0">
          <PlaytestActionsBar />
        </div>
        {/* Right column: spacers + Next Turn on desktop. Hidden on mobile
            (Next Turn lives in the top toolbar there). */}
        <div className="hidden md:flex items-center gap-2 shrink-0">
          <div className="shrink-0" style={{ width: 'clamp(80px, 11vw, 130px)' }} aria-hidden />
          <div className="shrink-0" style={{ width: 'clamp(80px, 11vw, 130px)' }} aria-hidden />
          <div className="shrink-0 flex justify-end" style={{ width: 'clamp(80px, 11vw, 130px)' }}>
            <NextTurnButton />
          </div>
        </div>
      </div>
      <div className="flex items-end gap-1 sm:gap-2 min-h-[140px] sm:min-h-[160px]">
        {/* Desktop: Command pile on the left. Mobile: zones float on the battlefield. */}
        {isDesktop && (
          <div className="shrink-0" style={{ width: 'clamp(80px, 11vw, 130px)' }}>
            <PlaytestPile spec={PILES[0]} />
          </div>
        )}
        <div ref={rowRef} className="flex-1 flex justify-center min-w-0">
          <div className="flex items-end">
            {display.map(({ card, originalIndex }, i) => (
              <HandCard
                key={`${card.id}-${originalIndex}`}
                card={card}
                indexInHand={originalIndex}
                fanIndex={i}
                overlap={overlap}
                hoveredFanIndex={hoveredFanIndex}
                onHoverChange={(h) => {
                  setHoveredFanIndex(prev => h ? i : (prev === i ? null : prev));
                  // Publish to the store too, so the Del hotkey knows which hand
                  // card is under the cursor. Uses the real hand index, not the
                  // fan position, because the row can be sorted.
                  setHoveredHandIndex(h ? originalIndex : null);
                }}
                onClickPlay={() => playToBattlefield(originalIndex)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ kind: 'hand', handIndex: originalIndex, card, x: e.clientX, y: e.clientY });
                }}
              />
            ))}
          </div>
        </div>
        {/* Desktop: Library / Graveyard / Exile on the right. Exile is half the
            width of the other two and hangs from the top — it's the zone you
            touch least, so it shouldn't claim a full card's worth of the row. */}
        {isDesktop && (
          <div className="flex items-end gap-2 shrink-0">
            <div style={{ width: 'clamp(60px, 8.25vw, 98px)' }}>
              <PlaytestPile spec={PILES[1]} />
            </div>
            <div style={{ width: 'clamp(60px, 8.25vw, 98px)' }}>
              <PlaytestPile spec={PILES[2]} />
            </div>
            <div className="self-start" style={{ width: 'clamp(30px, 4.15vw, 49px)' }}>
              <PlaytestPile spec={PILES[3]} />
            </div>
          </div>
        )}
      </div>
      <PlaytestCardMenu target={menu} onClose={() => setMenu(null)} />
    </div>
  );
}

// Compute card overlap so the hand row always fits within rowWidth. Mirrors the
// `width: clamp(80px, 11vw, 130px)` rule on HandCard — we estimate cardW the
// same way so overlap math reflects the rendered size. A negative return value
// means a gap (no overlap); the row keeps a max 2px gap until cards no longer
// fit, then overlap kicks in as needed.
const MIN_GAP_PX = 2;
function computeOverlap(total: number, rowWidth: number): number {
  if (total <= 1) return 0;
  const cardW = Math.max(80, Math.min(130, typeof window !== 'undefined' ? window.innerWidth * 0.11 : 110));
  if (rowWidth <= 0) return -MIN_GAP_PX;
  // Minimum overlap to fit all cards in the row: total*cardW - (N-1)*overlap = rowWidth.
  const required = Math.ceil((total * cardW - rowWidth) / (total - 1));
  const maxOverlap = Math.max(0, cardW - 12);
  // Floor at -MIN_GAP_PX so cards stay nearly touching even when there's lots
  // of room; raise to `required` when they would otherwise spill over.
  return Math.min(maxOverlap, Math.max(-MIN_GAP_PX, required));
}

function sortedHand(hand: ScryfallCard[], mode: SortMode) {
  const indexed = hand.map((card, originalIndex) => ({ card, originalIndex }));
  if (mode === 'cmc') indexed.sort((a, b) => a.card.cmc - b.card.cmc);
  else if (mode === 'type') indexed.sort((a, b) => getFrontFaceTypeLine(a.card).localeCompare(getFrontFaceTypeLine(b.card)));
  return indexed;
}

interface HandCardProps {
  card: ScryfallCard;
  indexInHand: number;
  fanIndex: number;
  overlap: number;
  hoveredFanIndex: number | null;
  onHoverChange: (hovered: boolean) => void;
  onClickPlay: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function HandCard({ card, indexInHand, fanIndex, overlap, hoveredFanIndex, onHoverChange, onClickPlay, onContextMenu }: HandCardProps) {
  const dragId = `hand:${indexInHand}:${card.id}`;
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: dragId,
    data: { source: { kind: 'zone', zone: 'hand', index: indexInHand } },
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `hand-slot:${indexInHand}`,
    data: { kind: 'hand-slot', index: indexInHand },
  });
  const localRef = useRef<HTMLDivElement | null>(null);
  const composedRef = (node: HTMLDivElement | null) => {
    setDragRef(node);
    setDropRef(node);
    localRef.current = node;
  };
  const [hovered, setHovered] = useState(false);
  const magnify = useMagnifyKey();
  const showPreview = magnify && hovered && !isDragging;

  // Deal-in: capture the lastDrawRange at MOUNT to detect cards that were
  // freshly drawn (vs ones that just remounted because their key shifted on
  // a reorder, or arrived from another zone). Only freshly drawn cards run
  // the deal-in keyframe; everything else snaps into place without growing.
  const animations = usePlaytestSettings(s => s.animations);
  const [drawRangeAtMount] = useState(() => usePlaytestStore.getState().lastDrawRange);
  const [returnRangeAtMount] = useState(() => usePlaytestStore.getState().lastReturnRange);
  const isFreshlyDrawn =
    animations &&
    indexInHand >= drawRangeAtMount.start &&
    indexInHand < drawRangeAtMount.end;
  const isFreshlyReturned =
    animations &&
    indexInHand >= returnRangeAtMount.start &&
    indexInHand < returnRangeAtMount.end;
  // Stagger: when multiple cards arrive in the same draw/return, offset each
  // card's animation by its position in the batch so they cascade in.
  const STAGGER_MS = 70;
  const staggerIdx = isFreshlyDrawn
    ? indexInHand - drawRangeAtMount.start
    : isFreshlyReturned
      ? indexInHand - returnRangeAtMount.start
      : 0;
  const animationDelayMs = staggerIdx * STAGGER_MS;
  const [dealing, setDealing] = useState(isFreshlyDrawn || isFreshlyReturned);
  useEffect(() => {
    if (!dealing) return;
    const t = setTimeout(() => setDealing(false), 380 + animationDelayMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dragTransform = transform ? `translate3d(${transform.x}px, ${transform.y}px, 0) scale(1.05)` : undefined;

  // Hover-fan-spread: when a sibling is hovered, push neighbors away to make
  // room. The hovered card itself lifts and scales up slightly.
  const isHovered = hoveredFanIndex === fanIndex;
  const spreadPx = (() => {
    if (isDragging || dealing || hoveredFanIndex === null || isHovered) return 0;
    const dist = fanIndex - hoveredFanIndex;
    const direction = dist > 0 ? 1 : -1;
    // Spread scales with overlap so a tightly-squeezed hand pushes neighbors
    // away more aggressively — exposing the cards adjacent to the hovered one
    // even when overlap is large. Falls off ~30% per additional neighbor.
    const baseSpread = Math.max(18, overlap * 0.75);
    const falloff = baseSpread * 0.32;
    const magnitude = Math.max(0, Math.min(overlap, baseSpread - (Math.abs(dist) - 1) * falloff));
    return direction * magnitude;
  })();

  const restingTransform = (() => {
    const parts: string[] = [];
    if (spreadPx) parts.push(`translateX(${spreadPx}px)`);
    if (isHovered) {
      parts.push('translateY(-14px)');
      parts.push('scale(1.06)');
    }
    return parts.join(' ') || undefined;
  })();

  // While dealing, let the CSS keyframe drive transform — don't set an inline
  // transform (it would override the keyframe). Drag still wins if it starts.
  const inlineTransform = isDragging
    ? dragTransform
    : dealing
      ? undefined
      : restingTransform;
  const style: React.CSSProperties = {
    marginLeft: fanIndex === 0 ? 0 : `${-overlap}px`,
    transform: inlineTransform,
    zIndex: isDragging ? 50 : isHovered ? 30 : fanIndex,
    transition: isDragging || dealing ? 'none' : 'transform 160ms ease-out',
    width: 'clamp(80px, 11vw, 130px)',
    cursor: isDragging ? 'grabbing' : 'pointer',
    opacity: isDragging ? 0 : 1,
    ...(dealing && animationDelayMs > 0 ? { animationDelay: `${animationDelayMs}ms` } : {}),
  };

  return (
    <div
      ref={composedRef}
      {...attributes}
      {...listeners}
      onClick={onClickPlay}
      onContextMenu={onContextMenu}
      // Only mouse-type pointers trigger the lift/spread animation — taps on
      // touch devices synthesize mouseenter, but we don't want a tap to lift
      // and shift neighbors while the user is just trying to play the card.
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') { setHovered(true); onHoverChange(true); } }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') { setHovered(false); onHoverChange(false); } }}
      title={`Click to play ${card.name} · right-click for more options`}
      data-hand-index={indexInHand}
      className={`relative shrink-0 rounded-[5px] select-none touch-none ${
        isOver && !isDragging ? 'ring-2 ring-primary' : ''
      } ${dealing && !isDragging ? (isFreshlyReturned ? 'animate-deal-in-from-top' : 'animate-deal-in') : ''}`}
      style={style}
    >
      <img
        src={getCardImageUrl(card, 'normal')}
        alt={card.name}
        className="w-full rounded-[5px] shadow-md pointer-events-none"
        loading="lazy"
        draggable={false}
      />
      {showPreview && <MagnifiedPreview card={card} anchorRef={localRef} />}
    </div>
  );
}
