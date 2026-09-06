import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { HoverPreviewImage } from '@/components/playtest/HoverPreviewImage';
import { captureHandBoxes, flyHandToZone } from '@/components/playtest/CardFlight';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import type { ScryfallCard } from '@/types';

/**
 * The cleanup step: pick which cards go when your hand is over its limit.
 *
 * Deliberately not folded into MulliganModal even though the grid looks the
 * same. That one is a drag-enabled view of an opening hand with a bottom-N
 * sub-mode bolted on; this is a plain pick-exactly-N. Sharing them would mean
 * a component that is two interactions wearing one costume, and the mulligan
 * flow is load-bearing enough not to disturb for a cosmetic saving.
 */
export function HandDiscardModal({ downTo }: { downTo: number }) {
  const hand = usePlaytestStore(s => s.zones.hand);
  const discardFromHand = usePlaytestStore(s => s.discardFromHand);
  const closeModal = usePlaytestStore(s => s.closeModal);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const needed = Math.max(0, hand.length - downTo);
  const remaining = needed - picked.size;

  const toggle = (i: number) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else if (next.size < needed) next.add(i);
      return next;
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-background/85 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-2xl max-w-4xl w-full p-6">
        <h2 className="text-lg font-semibold mb-1">
          {remaining > 0 ? `Discard ${remaining} more` : 'Ready to discard'}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Hand size is {downTo}. You&rsquo;re holding {hand.length} — click cards to send them to the graveyard.
        </p>
        <div className="grid grid-cols-7 gap-2 mb-5">
          {hand.map((card, i) => (
            <DiscardCard
              key={`${card.id}-${i}`}
              card={card}
              selected={picked.has(i)}
              onPick={() => toggle(i)}
            />
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={closeModal}>Cancel</Button>
          <Button
            onClick={() => {
              // Same order as the menu discards: measure, then discard, then
              // fly from the snapshot. The modal covers the hand, so the
              // boxes come from the row underneath it.
              const indices = Array.from(picked);
              const boxes = captureHandBoxes();
              discardFromHand(indices);
              if (usePlaytestSettings.getState().animations) {
                flyHandToZone(indices, 'graveyard', boxes, hand);
              }
            }}
            disabled={picked.size !== needed}
          >
            Discard {picked.size}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DiscardCard({ card, selected, onPick }: { card: ScryfallCard; selected: boolean; onPick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onPick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        transform: hovered && !selected ? 'translateY(-8px) scale(1.05)' : undefined,
        transition: 'transform 160ms ease-out',
        zIndex: hovered ? 10 : undefined,
      }}
      className={`relative rounded-[5px] cursor-pointer select-none ${
        selected ? 'ring-4 ring-red-500 opacity-70' : ''
      }`}
    >
      <HoverPreviewImage card={card} size="normal" className="w-full rounded-[5px] shadow" />
      {selected && (
        <span className="absolute top-1 right-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
          discard
        </span>
      )}
    </div>
  );
}
