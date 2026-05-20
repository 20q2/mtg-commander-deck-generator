// src/components/analyze/CurvePlayArea.tsx
import { useMemo, useState } from 'react';
import type { ScryfallCard } from '@/types';
import { buildCurveBuckets } from './CurvePlayArea.buckets';
import { getCardImageUrl } from '@/services/scryfall/client';

interface CurvePlayAreaProps {
  currentCards: ScryfallCard[];
  excludeNames?: Set<string>;
}

const COLUMN_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7+'];

const ROLE_STRIPE: Record<string, string> = {
  ramp:      'bg-emerald-500',
  removal:   'bg-rose-500',
  boardwipe: 'bg-orange-500',
  cardDraw:  'bg-sky-500',
};

interface HoverState {
  card: ScryfallCard;
  anchor: { right: number; top: number; height: number };
}

export function CurvePlayArea({ currentCards, excludeNames }: CurvePlayAreaProps) {
  const buckets = useMemo(
    () => buildCurveBuckets(currentCards, { excludeNames }),
    [currentCards, excludeNames],
  );
  const [hover, setHover] = useState<HoverState | null>(null);

  const handleHover = (card: ScryfallCard | null, e?: React.MouseEvent) => {
    if (card && e) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setHover({ card, anchor: { right: rect.right, top: rect.top, height: rect.height } });
    } else {
      setHover(null);
    }
  };

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

      <CurveRow label="Creatures" rowCards={buckets.creatures} onHover={handleHover} />
      <CurveRow label="Non-creatures" rowCards={buckets.noncreatures} onHover={handleHover} />

      <div className="grid grid-cols-[80px_repeat(8,1fr)] gap-1 px-2 py-1.5 border-t border-border/20 items-center">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Lands</div>
        <div className="col-span-8 text-[11px] text-muted-foreground/60">{buckets.landCount} lands</div>
      </div>

      {/* Floating hover preview — hidden on small viewports */}
      {hover && (
        <div
          className="fixed z-[100] pointer-events-none hidden lg:block"
          style={{
            left: hover.anchor.right + 12,
            top: Math.min(Math.max(8, hover.anchor.top + hover.anchor.height / 2 - 180), window.innerHeight - 400),
          }}
        >
          <img
            src={getCardImageUrl(hover.card, 'normal') ?? ''}
            alt={hover.card.name}
            className="w-64 rounded-lg shadow-2xl border border-border/50"
          />
        </div>
      )}
    </div>
  );
}

interface CurveRowProps {
  label: string;
  rowCards: ScryfallCard[][];
  onHover: (card: ScryfallCard | null, e?: React.MouseEvent) => void;
}

function CurveRow({ label, rowCards, onHover }: CurveRowProps) {
  return (
    <div className="grid grid-cols-[80px_repeat(8,1fr)] gap-1 px-2 py-2 items-end min-h-[140px]">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 self-center">{label}</div>
      {rowCards.map((col, i) => (
        <CurveCell key={i} cards={col} onHover={onHover} />
      ))}
    </div>
  );
}

interface CurveCellProps {
  cards: ScryfallCard[];
  onHover: (card: ScryfallCard | null, e?: React.MouseEvent) => void;
}

function CurveCell({ cards, onHover }: CurveCellProps) {
  if (cards.length === 0) {
    return <div className="min-h-[100px]" />;
  }
  const OVERLAP = 18;
  return (
    <div className="relative" style={{ height: `${(cards.length - 1) * OVERLAP + 90}px` }}>
      {cards.map((card, idx) => {
        const stripeClass = card.deckRole ? (ROLE_STRIPE[card.deckRole] ?? '') : '';
        const imgUrl = getCardImageUrl(card, 'small') ?? '';
        return (
          <div
            key={card.name + idx}
            className="absolute left-0 right-0 transition-transform duration-150 hover:z-50 hover:scale-110"
            style={{ top: `${idx * OVERLAP}px`, zIndex: idx }}
            onMouseEnter={(e) => onHover(card, e)}
            onMouseLeave={() => onHover(null)}
          >
            {stripeClass && <div className={`absolute top-0 left-0 right-0 h-[3px] z-10 ${stripeClass} rounded-t`} />}
            <img
              src={imgUrl}
              alt={card.name}
              className="w-full rounded shadow-md border border-border/40"
              loading="lazy"
              draggable={false}
              title={`${card.name}${card.deckRole ? ` · ${card.deckRole}` : ''}`}
            />
          </div>
        );
      })}
    </div>
  );
}
