import type { ScryfallCard } from '@/types';
import { computeStackOffset, MAX_STACK_OFFSET } from './stackOffset';

interface StacksColumnProps {
  cards: { card: ScryfallCard; quantity: number }[];
  renderTile: (card: ScryfallCard, quantity: number) => React.ReactNode;
  /** Override the auto-computed offset. Defaults to viewport-fit offset. */
  offset?: number;
  /**
   * Optional fixed column height in px. When set, cards are bottom-anchored
   * so the last card sits at the column's baseline — used to align multiple
   * columns of varying card counts.
   */
  targetHeight?: number;
}

export function StacksColumn({ cards, renderTile, offset, targetHeight }: StacksColumnProps) {
  if (cards.length === 0) return null;
  const resolved = offset ?? computeStackOffset(cards.length);
  const lastIndex = cards.length - 1;

  // Bottom-anchor mode: container fills targetHeight, last card sits at the bottom.
  if (targetHeight != null) {
    return (
      <div className="relative w-full" style={{ height: `${targetHeight}px` }}>
        {cards.map((entry, i) => (
          <div
            key={entry.card.id}
            className="absolute left-0 right-0 transition-transform duration-150 hover:-translate-y-1 hover:z-20"
            style={{ bottom: (lastIndex - i) * resolved, zIndex: i }}
          >
            {renderTile(entry.card, entry.quantity)}
          </div>
        ))}
      </div>
    );
  }

  // Default (top-anchored) — container grows with content.
  return (
    <div
      className="relative w-full"
      style={{ paddingTop: `calc(${lastIndex} * ${resolved}px + 140%)` }}
    >
      {cards.map((entry, i) => (
        <div
          key={entry.card.id}
          className="absolute left-0 right-0 transition-transform duration-150 hover:-translate-y-1 hover:z-20"
          style={{ top: i * resolved, zIndex: i }}
        >
          {renderTile(entry.card, entry.quantity)}
        </div>
      ))}
    </div>
  );
}

export { computeStackOffset, MAX_STACK_OFFSET };
