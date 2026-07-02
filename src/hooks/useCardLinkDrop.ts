import { useCallback, useRef, useState } from 'react';
import type { ScryfallCard } from '@/types';
import { getCardByName, getCardById } from '@/services/scryfall/client';
import { parseCardDropUrl } from '@/services/cardLinks/parseCardDropUrl';

interface UseCardLinkDropOptions {
  /** When false, all handlers no-op and no drag affordance is reported. */
  enabled: boolean;
  /** Called with the resolved card after a card link is dropped. */
  onCard: (card: ScryfallCard) => void;
  /** Called when a recognized card link fails to resolve. Unrecognized (non-card) drops are ignored silently. */
  onError?: (message: string) => void;
}

/**
 * Drag a card link (EDHREC / Scryfall / Moxfield) onto an element to add it.
 * Dragging a link puts its URL on the drop's dataTransfer; we parse the slug into
 * a query, resolve it via Scryfall fuzzy lookup, and hand the card to `onCard`.
 *
 * Browsers hide dataTransfer *contents* mid-drag (getData is empty until drop,
 * especially cross-origin), so the affordance can only key off the payload *type*.
 * We require a real link drag (`text/uri-list`) — this excludes selected-text,
 * image, and file drags, so `isDraggingCard` only flips when a URL is in hand.
 */
export function useCardLinkDrop({ enabled, onCard, onError }: UseCardLinkDropOptions) {
  const [isDraggingCard, setIsDraggingCard] = useState(false);
  // Drag events fire per child element; a depth counter avoids flicker as the
  // pointer crosses internal boundaries (entering a child fires leave on parent).
  const dragDepthRef = useRef(0);

  // Keep the latest callbacks without re-creating the handlers every render.
  const onCardRef = useRef(onCard);
  onCardRef.current = onCard;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const isLinkDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('text/uri-list');

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!enabled || !isLinkDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingCard(true);
  }, [enabled]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!enabled || !isLinkDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, [enabled]);

  const onDragLeave = useCallback(() => {
    if (!enabled) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingCard(false);
  }, [enabled]);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    if (!enabled) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingCard(false);

    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    const ref = parseCardDropUrl(text);
    if (!ref) return; // Not a recognized card link — ignore silently.

    try {
      const card = ref.kind === 'scryfallId'
        ? await getCardById(ref.id)
        : await getCardByName(ref.query, false);
      onCardRef.current(card);
    } catch {
      onErrorRef.current?.("Couldn't find that card");
    }
  }, [enabled]);

  return {
    isDraggingCard,
    dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
