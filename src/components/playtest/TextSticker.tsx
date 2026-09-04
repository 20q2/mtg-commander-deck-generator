import { useRef, useState } from 'react';
import { usePlaytestStore } from '@/store/playtestStore';
import type { CardSticker } from '@/components/playtest/types';

interface Props {
  instanceId: string;
  sticker: CardSticker;
  /** Total visual rotation of the parent card, in degrees. */
  rotation: number;
}

/**
 * A free-text label pinned to a battlefield card. The card's outer element carries
 * dnd-kit's drag listeners, so every handler here stops propagation — otherwise
 * dragging a sticker would drag the whole card.
 */
export function TextSticker({ instanceId, sticker, rotation }: Props) {
  const moveSticker = usePlaytestStore(s => s.moveSticker);
  const setStickerText = usePlaytestStore(s => s.setStickerText);
  const removeSticker = usePlaytestStore(s => s.removeSticker);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sticker.text);
  const movedRef = useRef(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editing || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    const originX = sticker.x;
    const originY = sticker.y;
    movedRef.current = false;
    el.setPointerCapture(e.pointerId);

    // Screen-space delta -> card-space delta. The card is drawn rotated, so undo
    // that rotation before applying the movement.
    const rad = (-rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!movedRef.current && Math.hypot(dx, dy) > 3) movedRef.current = true;
      if (!movedRef.current) return;
      moveSticker(instanceId, sticker.id, originX + dx * cos - dy * sin, originY + dx * sin + dy * cos);
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

  const commit = () => {
    setStickerText(instanceId, sticker.id, draft);
    setEditing(false);
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onClick={(e) => {
        e.stopPropagation();
        if (movedRef.current) return;
        setDraft(sticker.text);
        setEditing(true);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        removeSticker(instanceId, sticker.id);
      }}
      title="Drag to move · click to edit · right-click to remove"
      className="absolute z-30 pointer-events-auto select-none touch-none cursor-grab"
      // No counter-rotation: a sticker is stuck to the card, so it turns with it
      // when the card is tapped, the way a real one would. `rotation` is still
      // needed above, to map screen-space drags back into card space.
      style={{ left: sticker.x, top: sticker.y }}
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="w-24 px-1 py-0.5 rounded bg-background border border-teal-400 text-[10px] font-bold outline-none"
        />
      ) : (
        <span className="inline-block max-w-[110px] truncate px-1.5 py-0.5 rounded bg-teal-500/90 text-white text-[10px] font-bold shadow-md ring-1 ring-teal-200/50">
          {sticker.text}
        </span>
      )}
    </div>
  );
}
