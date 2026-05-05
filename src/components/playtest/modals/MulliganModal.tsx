import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardImageUrl } from '@/services/scryfall/client';

export function MulliganModal() {
  const hand = usePlaytestStore(s => s.zones.hand);
  const mulliganCount = usePlaytestStore(s => s.mulliganCount);
  const beginMulligan = usePlaytestStore(s => s.beginMulligan);
  const keepHandSendToBottom = usePlaytestStore(s => s.keepHandSendToBottom);
  const closeModal = usePlaytestStore(s => s.closeModal);

  // Sub-mode: choosing the bottom-N cards
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const handSize = Math.max(0, 7 - mulliganCount);
  const toBottomCount = Math.min(mulliganCount, hand.length);

  useEffect(() => { setPicked(new Set()); }, [picking]);

  const togglePick = (i: number) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else if (next.size < toBottomCount) next.add(i);
      return next;
    });
  };

  const confirmKeep = () => {
    if (toBottomCount === 0) {
      closeModal();
      return;
    }
    setPicking(true);
  };

  const confirmBottom = () => {
    keepHandSendToBottom(Array.from(picked));
    setPicking(false);
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-background/85 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-card border border-border rounded-lg shadow-2xl max-w-4xl w-full p-6">
        <h2 className="text-lg font-semibold mb-1">
          {picking ? `Send ${toBottomCount - picked.size} more to bottom` : `Opening hand · keeping ${handSize}`}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {picking
            ? `Click cards to mark them for the bottom of the library.`
            : mulliganCount === 0
              ? 'Mulligan is free this time.'
              : `London mulligan: ${mulliganCount} card(s) will go to the bottom of the library if you keep.`}
        </p>
        <div className="grid grid-cols-7 gap-2 mb-5">
          {hand.map((card, i) => {
            const sel = picked.has(i);
            return (
              <button
                key={`${card.id}-${i}`}
                onClick={() => picking && togglePick(i)}
                className={`relative rounded-[4px] transition-all ${picking ? 'cursor-pointer' : 'cursor-default'} ${sel ? 'ring-4 ring-amber-400' : ''}`}
              >
                <img src={getCardImageUrl(card, 'normal')} alt={card.name} className="w-full rounded-[4px] shadow" />
                {sel && <span className="absolute top-1 right-1 bg-amber-500 text-black text-[10px] font-bold px-1.5 py-0.5 rounded">↓ bottom</span>}
              </button>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          {!picking ? (
            <>
              <Button variant="outline" onClick={beginMulligan}>Mulligan again</Button>
              <Button onClick={confirmKeep}>Keep this hand</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setPicking(false)}>Back</Button>
              <Button onClick={confirmBottom} disabled={picked.size !== toBottomCount}>Send to bottom</Button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
