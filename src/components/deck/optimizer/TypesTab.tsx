import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AnalyzedCard } from '@/services/deckBuilder/deckAnalyzer';
import { AnalyzedCardRow } from './shared';

// ─── Types Tab: Per-Type Card Section ────────────────────────────────
export function TypeCardSection({
  type, cards, current, target, delta, isOver, isUnder, onPreview,
}: {
  type: string;
  cards: AnalyzedCard[];
  current: number;
  target: number;
  delta: number;
  isOver: boolean;
  isUnder: boolean;
  onPreview: (name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-card/60 border border-border/30 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(p => !p)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/20 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
        <span className="text-sm font-bold capitalize">{type}</span>
        <span className={`text-xs font-bold tabular-nums ${isOver ? 'text-amber-400' : isUnder ? 'text-sky-400' : 'text-muted-foreground'}`}>
          {current}/{target}
        </span>
        {(isOver || isUnder) && (
          <span className={`text-[11px] ${isOver ? 'text-amber-400/70' : 'text-sky-400/70'}`}>
            {delta > 0 ? '+' : ''}{delta}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-0.5">
          {cards.map(ac => (
            <AnalyzedCardRow key={ac.card.name} ac={ac} onPreview={onPreview} />
          ))}
        </div>
      )}
    </div>
  );
}
