/** Card-stack overlap tuning shared by StacksColumn and its callers. */
import { useEffect, useState } from 'react';

export const MAX_STACK_OFFSET = 36;
export const MIN_STACK_OFFSET = 28;
/** Approximate height of a single card at the default 170px column width. */
export const CARD_HEIGHT = 238;
/** Chrome above the masonry (header, toolbar, padding) — used to estimate the height a stack should fit in. */
const VIEWPORT_RESERVED = 240;

function viewportAvailable(): number {
  const vh = typeof window === 'undefined' ? 900 : window.innerHeight;
  return Math.max(CARD_HEIGHT + MIN_STACK_OFFSET, vh - VIEWPORT_RESERVED);
}

/**
 * Returns the per-card vertical offset for a stack of `count` cards such that
 * the whole stack fits within the current viewport, clamped to [MIN, MAX].
 */
export function computeStackOffset(count: number): number {
  if (count <= 1) return MAX_STACK_OFFSET;
  const fit = (viewportAvailable() - CARD_HEIGHT) / (count - 1);
  return Math.max(MIN_STACK_OFFSET, Math.min(MAX_STACK_OFFSET, fit));
}

/**
 * Returns the per-card offset for a stack of `count` cards such that its
 * total height matches `targetHeight`. Clamped so single-card stacks
 * still render correctly. Used to bottom-align multiple columns.
 */
export function computeStackOffsetForHeight(count: number, targetHeight: number): number {
  if (count <= 1) return MAX_STACK_OFFSET;
  const fit = (targetHeight - CARD_HEIGHT) / (count - 1);
  return Math.max(MIN_STACK_OFFSET, Math.min(MAX_STACK_OFFSET, fit));
}

/**
 * Given the largest stack across all columns, returns the shared target
 * height that every column should occupy — based on the tallest stack
 * (with its viewport-fit offset). All shorter columns can then spread
 * their cards to fill this same height so the bottom edges align.
 */
export function computeUniformStackHeight(maxCount: number): number {
  if (maxCount <= 1) return CARD_HEIGHT;
  const offset = computeStackOffset(maxCount);
  return (maxCount - 1) * offset + CARD_HEIGHT;
}

/** Re-renders on window resize so callers that depend on viewport-based layout reflow. */
export function useViewportHeight(): number {
  const [h, setH] = useState(() => typeof window === 'undefined' ? 900 : window.innerHeight);
  useEffect(() => {
    const onResize = () => setH(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return h;
}
