import { useRef, useState } from 'react';
import { usePlaytestStore } from '@/store/playtestStore';
import { resolvePT } from '@/services/playtest/powerToughness';
import { TextSticker } from '@/components/playtest/TextSticker';
import type { BattlefieldCard as BfCard } from '@/components/playtest/types';

export const COUNTER_COLOR: Record<string, string> = {
  '+1/+1': 'bg-emerald-500/90 text-white',
  '-1/-1': 'bg-red-500/90 text-white',
  loyalty: 'bg-blue-500/90 text-white',
  charge: 'bg-yellow-500/90 text-black',
  storage: 'bg-zinc-500/90 text-white',
};

const BADGE = 36;
const PAD_X = 8;   // px-2
const PAD_Y = 16;  // py-4
const BOX_W = BADGE + PAD_X * 2;
const BOX_H = BADGE + PAD_Y * 2;

const ARROW =
  'absolute left-1/2 -translate-x-1/2 w-0 h-0 border-x-[7px] border-x-transparent ' +
  'drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)] cursor-pointer pointer-events-auto';

/** Default badge slot: a centred row, so two counter types don't land on each other. */
export function counterDefaultPos(index: number, total: number, cardWidth: number, cardHeight: number) {
  return {
    x: cardWidth / 2 - BOX_W / 2 + (index - (total - 1) / 2) * (BADGE + 8),
    y: cardHeight / 2 - BOX_H / 2,
  };
}

interface Props {
  card: BfCard;
  cardWidth: number;
  cardHeight: number;
  /** False for the drag ghost — same pixels, no handlers, no store writes. */
  interactive?: boolean;
  onAdjust?: (type: string, delta: number) => void;
}

/**
 * Everything drawn on top of a battlefield card image: counter badges, text
 * stickers, and the modified power/toughness. Shared by the live card and the
 * drag preview so a card being dragged doesn't shed its state mid-flight.
 */
export function CardOverlays({ card, cardWidth, cardHeight, interactive = true, onAdjust }: Props) {
  const rotation = (card.tapped ? 90 : 0) + (card.rotation ?? 0);
  const counterEntries = Object.entries(card.counters).filter(([t, v]) => v > 0 && t !== 'loyalty');
  const pt = resolvePT(card);
  // Only worth showing when it differs from what's printed on the art.
  const showPT = pt !== null && (pt.modified !== pt.base || pt.overridden);

  return (
    <>
      {counterEntries.map(([type, value], i) => {
        const pos =
          card.counterPositions?.[type] ??
          counterDefaultPos(i, counterEntries.length, cardWidth, cardHeight);
        return interactive ? (
          <CounterBadge
            key={type}
            instanceId={card.instanceId}
            type={type}
            value={value}
            pos={pos}
            rotation={rotation}
            onAdjust={(d) => onAdjust?.(type, d)}
          />
        ) : (
          <div
            key={type}
            className="absolute z-20 pointer-events-none"
            style={{
              left: pos.x + PAD_X,
              top: pos.y + PAD_Y,
              transform: rotation ? `rotate(${-rotation}deg)` : undefined,
              transformOrigin: 'center',
            }}
          >
            <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm tabular-nums shadow-lg ring-2 ring-white/40 ${COUNTER_COLOR[type] ?? 'bg-zinc-600/90 text-white'}`}>
              {value}
            </div>
          </div>
        );
      })}

      {(card.stickers ?? []).map(st =>
        interactive ? (
          <TextSticker key={st.id} instanceId={card.instanceId} sticker={st} rotation={rotation} />
        ) : (
          <div
            key={st.id}
            className="absolute z-30 pointer-events-none"
            style={{
              left: st.x,
              top: st.y,
              transform: rotation ? `rotate(${-rotation}deg)` : undefined,
              transformOrigin: 'top left',
            }}
          >
            <span className="inline-block max-w-[110px] truncate px-1.5 py-0.5 rounded bg-teal-500/90 text-white text-[10px] font-bold shadow-md ring-1 ring-teal-200/50">
              {st.text}
            </span>
          </div>
        ),
      )}

      {showPT && pt && <PTBadge value={pt.modified} cardWidth={cardWidth} />}
    </>
  );
}

/**
 * The modified P/T, sitting directly on top of the printed one. These percentages
 * track the P/T box of the modern card frame, so it lands right at every card size.
 *
 * Deliberately NOT counter-rotated, unlike the counters and stickers. Those are
 * labels you read, so they stay upright; this one is impersonating printed text,
 * so it has to turn with the card and stay glued over the value it replaces.
 */
function PTBadge({ value, cardWidth }: { value: string; cardWidth: number }) {
  return (
    <div
      className="absolute z-30 pointer-events-none"
      style={{ right: '4.5%', bottom: '3.4%', width: '25%', height: '8%' }}
    >
      <span
        className="flex items-center justify-center w-full h-full rounded-[3px] bg-fuchsia-600 text-white font-bold tabular-nums ring-1 ring-black/50 shadow-[0_1px_4px_rgba(0,0,0,0.8)]"
        style={{ fontSize: Math.max(9, Math.round(cardWidth * 0.088)) }}
      >
        {value}
      </span>
    </div>
  );
}

function CounterBadge({
  instanceId, type, value, pos, rotation, onAdjust,
}: {
  instanceId: string;
  type: string;
  value: number;
  pos: { x: number; y: number };
  rotation: number;
  onAdjust: (delta: number) => void;
}) {
  const moveCounterBadge = usePlaytestStore(s => s.moveCounterBadge);
  const [hovered, setHovered] = useState(false);
  const movedRef = useRef(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // The card underneath carries dnd-kit's listeners — without this, dragging the
    // badge would drag the whole card.
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    const originX = pos.x;
    const originY = pos.y;
    movedRef.current = false;
    el.setPointerCapture(e.pointerId);

    // Screen-space delta -> card-space delta, undoing the card's rotation.
    const rad = (-rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!movedRef.current && Math.hypot(dx, dy) > 3) movedRef.current = true;
      if (!movedRef.current) return;
      moveCounterBadge(instanceId, type, originX + dx * cos - dy * sin, originY + dx * sin + dy * cos);
    };
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      try { el.releasePointerCapture(ev.pointerId); } catch { /* noop */ }
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onWheel={(e) => { e.stopPropagation(); onAdjust(e.deltaY < 0 ? 1 : -1); }}
      className="absolute z-20 select-none touch-none"
      style={{
        left: pos.x,
        top: pos.y,
        width: BOX_W,
        height: BOX_H,
        transform: rotation ? `rotate(${-rotation}deg)` : undefined,
        transformOrigin: 'center',
        // Only the badge itself is hit-testable at rest, so the padding doesn't
        // eat clicks meant for the card. Once hovered the whole padded box goes
        // live, which is what keeps the arrows reachable: moving from the badge
        // to an arrow never leaves this element, so hover never drops.
        pointerEvents: hovered ? 'auto' : 'none',
      }}
    >
      {hovered && (
        <button
          type="button"
          aria-label={`Add ${type} counter`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onAdjust(1); }}
          className={`${ARROW} top-1 border-b-[9px] border-b-white/90`}
        />
      )}
      <div
        onPointerDown={onPointerDown}
        onClick={(e) => {
          e.stopPropagation();
          if (movedRef.current) return;
          if (e.altKey) onAdjust(-value);
          else if (e.shiftKey) onAdjust(-1);
          else onAdjust(1);
        }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onAdjust(-1); }}
        title={`${value} ${type} · drag to move · click +1 · right-click −1 · scroll to adjust · alt-click clears`}
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm tabular-nums shadow-lg ring-2 ring-white/40 cursor-grab pointer-events-auto ${COUNTER_COLOR[type] ?? 'bg-zinc-600/90 text-white'}`}
      >
        {value}
      </div>
      {hovered && (
        <button
          type="button"
          aria-label={`Remove ${type} counter`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onAdjust(-1); }}
          className={`${ARROW} bottom-1 border-t-[9px] border-t-white/90`}
        />
      )}
    </div>
  );
}
