import { useEffect, useRef, useState, useMemo, type ReactNode } from 'react';

interface MasonryItem {
  key: string;
  /** Estimated rendered height in px, used for column balancing. */
  estimatedHeight: number;
  /** Render the item's contents. */
  render: () => ReactNode;
}

interface MasonryStacksProps {
  items: MasonryItem[];
  /** Target width per column in pixels (matches card width). */
  columnWidth?: number;
  /** Gap in px between columns and between items in a column. */
  gap?: number;
}

/**
 * Masonry layout: distributes items across N columns using greedy
 * shortest-column bin-packing so shorter items fill gaps under taller ones.
 * Column count is computed from container width.
 */
export function MasonryStacks({ items, columnWidth = 170, gap = 16 }: MasonryStacksProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const count = Math.max(1, Math.floor((w + gap) / (columnWidth + gap)));
      setColumnCount(count);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [columnWidth, gap]);

  const columns = useMemo(() => {
    const cols: { items: MasonryItem[]; height: number }[] = Array.from(
      { length: columnCount },
      () => ({ items: [], height: 0 })
    );
    for (const item of items) {
      // Find column with smallest current height
      let best = 0;
      for (let i = 1; i < cols.length; i++) {
        if (cols[i].height < cols[best].height) best = i;
      }
      cols[best].items.push(item);
      cols[best].height += item.estimatedHeight + gap;
    }
    return cols;
  }, [items, columnCount, gap]);

  return (
    <div
      ref={containerRef}
      className="flex items-start"
      style={{ gap: `${gap}px` }}
    >
      {columns.map((col, i) => (
        <div
          key={i}
          className="flex flex-col"
          style={{ width: columnWidth, gap: `${gap}px` }}
        >
          {col.items.map((it) => (
            <div key={it.key}>{it.render()}</div>
          ))}
        </div>
      ))}
    </div>
  );
}
