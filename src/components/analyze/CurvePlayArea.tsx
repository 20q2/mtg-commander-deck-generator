// src/components/analyze/CurvePlayArea.tsx
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import { buildCurveBuckets } from './CurvePlayArea.buckets';
import { getCardImageUrl } from '@/services/scryfall/client';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';

interface CurvePlayAreaProps {
  currentCards: ScryfallCard[];
  excludeNames?: Set<string>;
  onCmcSelect?: (cmc: number) => void;
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

export function CurvePlayArea({ currentCards, excludeNames, onCmcSelect }: CurvePlayAreaProps) {
  const buckets = useMemo(
    () => buildCurveBuckets(currentCards, { excludeNames }),
    [currentCards, excludeNames],
  );
  const COLLAPSED_KEY = 'analyze-play-area-collapsed';

  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem(COLLAPSED_KEY) === 'true');

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem(COLLAPSED_KEY, String(next));
      return next;
    });
  };

  const LANDS_KEY = 'analyze-play-area-lands-expanded';

  const [landsExpanded, setLandsExpanded] = useState<boolean>(() => localStorage.getItem(LANDS_KEY) === 'true');

  const toggleLands = () => {
    setLandsExpanded(prev => {
      const next = !prev;
      localStorage.setItem(LANDS_KEY, String(next));
      return next;
    });
  };

  const [hover, setHover] = useState<HoverState | null>(null);
  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);

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
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground/60">
            {buckets.countsByCmc.reduce((n, c) => n + c, 0)} non-land · {buckets.landCount} lands
          </span>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="p-0.5 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label={collapsed ? 'Expand play area' : 'Collapse play area'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {collapsed ? (
        <div className="px-3 py-2 grid grid-cols-8 gap-1 items-end h-12">
          {buckets.countsByCmc.map((count, i) => {
            const max = Math.max(...buckets.countsByCmc, 1);
            const heightPct = Math.max(8, Math.round((count / max) * 100));
            return (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <div
                  className="w-full bg-primary/40 rounded-sm"
                  style={{ height: `${heightPct}%` }}
                  title={`CMC ${COLUMN_LABELS[i]}: ${count}`}
                />
                <span className="text-[9px] text-muted-foreground/60 tabular-nums">{count}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {/* CMC column headers */}
          <div className="grid grid-cols-[80px_repeat(8,1fr)] gap-1 px-2 pt-2 text-[10px] text-muted-foreground/70">
            <div></div>
            {COLUMN_LABELS.map((label, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onCmcSelect?.(i)}
                className="text-center font-medium tabular-nums py-1 rounded hover:bg-primary/10 hover:text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label={`Filter analyzer to CMC ${label}`}
              >
                {label} <span className="text-muted-foreground/40">({buckets.countsByCmc[i]})</span>
              </button>
            ))}
          </div>

          <CurveRow label="Creatures" rowCards={buckets.creatures} onHover={handleHover} onSelect={setPreviewCard} onCmcSelect={onCmcSelect} />
          <CurveRow label="Non-creatures" rowCards={buckets.noncreatures} onHover={handleHover} onSelect={setPreviewCard} onCmcSelect={onCmcSelect} />

          <div className="border-t border-border/20">
            <button
              type="button"
              onClick={toggleLands}
              className="w-full grid grid-cols-[80px_repeat(8,1fr)] gap-1 px-2 py-1.5 items-center hover:bg-accent/20 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-expanded={landsExpanded}
            >
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1">
                {landsExpanded
                  ? <ChevronDown className="w-3 h-3" />
                  : <ChevronRight className="w-3 h-3" />}
                Lands
              </div>
              <div className="col-span-8 text-[11px] text-muted-foreground/60">
                {buckets.landCount} lands{landsExpanded ? '' : ' · click to expand'}
              </div>
            </button>
            {landsExpanded && (
              <CurveRow label="" rowCards={buckets.lands} onHover={handleHover} onSelect={setPreviewCard} />
            )}
          </div>
        </>
      )}

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

      <CardPreviewModal card={previewCard} onClose={() => setPreviewCard(null)} />
    </div>
  );
}

interface CurveRowProps {
  label: string;
  rowCards: ScryfallCard[][];
  onHover: (card: ScryfallCard | null, e?: React.MouseEvent) => void;
  onSelect: (card: ScryfallCard) => void;
  onCmcSelect?: (cmc: number) => void;
}

function CurveRow({ label, rowCards, onHover, onSelect, onCmcSelect }: CurveRowProps) {
  return (
    <div className="grid grid-cols-[80px_repeat(8,1fr)] gap-1 px-2 py-2 items-end min-h-[140px]">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 self-center">{label}</div>
      {rowCards.map((col, i) => (
        <CurveCell key={i} cards={col} cmcIndex={i} onHover={onHover} onSelect={onSelect} onEmptyClick={onCmcSelect ? () => onCmcSelect(i) : undefined} />
      ))}
    </div>
  );
}

interface CurveCellProps {
  cards: ScryfallCard[];
  cmcIndex: number;
  onHover: (card: ScryfallCard | null, e?: React.MouseEvent) => void;
  onSelect: (card: ScryfallCard) => void;
  onEmptyClick?: () => void;
}

function CurveCell({ cards, cmcIndex, onHover, onSelect, onEmptyClick }: CurveCellProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (cards.length === 0) {
    if (!onEmptyClick) {
      return <div className="min-h-[100px]" />;
    }
    return (
      <button
        type="button"
        onClick={onEmptyClick}
        className="min-h-[100px] w-full rounded hover:bg-primary/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={`Filter analyzer to CMC ${cmcIndex === 7 ? '7+' : cmcIndex} (empty column)`}
      />
    );
  }
  const OVERLAP = 18;
  return (
    <div className="relative" style={{ height: `${(cards.length - 1) * OVERLAP + 90}px` }}>
      {cards.map((card, idx) => {
        const stripeClass = card.deckRole ? (ROLE_STRIPE[card.deckRole] ?? '') : '';
        const imgUrl = getCardImageUrl(card, 'small') ?? '';
        const isHovered = hoveredIdx === idx;
        return (
          <button
            key={card.name + idx}
            type="button"
            className="absolute left-0 right-0 transition-transform duration-150 hover:scale-110 text-left w-full p-0 bg-transparent border-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded"
            style={{ top: `${idx * OVERLAP}px`, zIndex: isHovered ? 50 : idx }}
            onClick={() => onSelect(card)}
            onMouseEnter={(e) => { setHoveredIdx(idx); onHover(card, e); }}
            onMouseLeave={() => { setHoveredIdx(null); onHover(null); }}
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
          </button>
        );
      })}
    </div>
  );
}
