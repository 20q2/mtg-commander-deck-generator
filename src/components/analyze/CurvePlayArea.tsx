// src/components/analyze/CurvePlayArea.tsx
import { useMemo } from 'react';
import type { ScryfallCard } from '@/types';
import { buildCurveBuckets } from './CurvePlayArea.buckets';

interface CurvePlayAreaProps {
  currentCards: ScryfallCard[];
  excludeNames?: Set<string>;
}

const COLUMN_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7+'];

export function CurvePlayArea({ currentCards, excludeNames }: CurvePlayAreaProps) {
  const buckets = useMemo(
    () => buildCurveBuckets(currentCards, { excludeNames }),
    [currentCards, excludeNames],
  );

  return (
    <div className="mb-2 rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Curve</span>
        <span className="text-[11px] text-muted-foreground/60">
          {buckets.countsByCmc.reduce((n, c) => n + c, 0)} non-land · {buckets.landCount} lands
        </span>
      </div>

      {/* CMC column headers */}
      <div className="grid grid-cols-[80px_repeat(8,1fr)] gap-1 px-2 pt-2 text-[10px] text-muted-foreground/70">
        <div></div>
        {COLUMN_LABELS.map((label, i) => (
          <div key={i} className="text-center font-medium tabular-nums">
            {label} <span className="text-muted-foreground/40">({buckets.countsByCmc[i]})</span>
          </div>
        ))}
      </div>

      {/* Creatures row */}
      <CurveRow label="Creatures" rowCards={buckets.creatures} />

      {/* Non-creatures row */}
      <CurveRow label="Non-creatures" rowCards={buckets.noncreatures} />

      {/* Lands row (collapsed summary for now — Task 8 will add expand) */}
      <div className="grid grid-cols-[80px_repeat(8,1fr)] gap-1 px-2 py-1.5 border-t border-border/20 items-center">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Lands</div>
        <div className="col-span-8 text-[11px] text-muted-foreground/60">{buckets.landCount} lands</div>
      </div>
    </div>
  );
}

interface CurveRowProps {
  label: string;
  rowCards: ScryfallCard[][];
}

function CurveRow({ label, rowCards }: CurveRowProps) {
  return (
    <div className="grid grid-cols-[80px_repeat(8,1fr)] gap-1 px-2 py-2 items-end min-h-[80px]">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</div>
      {rowCards.map((col, i) => (
        <div key={i} className="text-center text-[10px] text-muted-foreground/50">
          {col.length > 0 ? `${col.length}` : ''}
        </div>
      ))}
    </div>
  );
}
