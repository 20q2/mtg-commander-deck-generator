import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { SwapRow as SwapRowData, Confidence } from '@/services/deckBuilder/costAnalyzer';
import { formatPrice } from '@/services/deckBuilder/costAnalyzer';
import { scryfallImg } from './constants';

const CONFIDENCE_STYLE: Record<Confidence, { label: string; cls: string }> = {
  'drop-in':  { label: 'Drop-in',     cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  sidegrade:  { label: 'Sidegrade',   cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  budget:     { label: 'Budget pick', cls: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
};

interface Props {
  row: SwapRowData;
  checked: boolean;
  onToggle: (id: string) => void;
  onPreviewCurrent: (name: string) => void;
  onPreviewSuggestion: (name: string) => void;
  flagOverPrice?: number;
  currency: 'USD' | 'EUR';
}

export function SwapRow({
  row, checked, onToggle, onPreviewCurrent, onPreviewSuggestion, flagOverPrice, currency,
}: Props) {
  const style = CONFIDENCE_STYLE[row.confidence];
  const flagged = flagOverPrice != null && flagOverPrice > 0 && row.currentPrice > flagOverPrice;
  const inclusionDelta = `${Math.round(row.currentInclusion)}% → ${Math.round(row.suggestion.inclusion)}%`;

  return (
    <div
      className={[
        'flex items-center gap-3 px-3 py-2 rounded border bg-zinc-900/40 hover:bg-zinc-900/70 transition-colors',
        flagged ? 'border-l-4 border-l-rose-500/60 border-zinc-800' : 'border-zinc-800',
      ].join(' ')}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(row.id)}
        className="h-4 w-4 accent-violet-500"
        aria-label={`Swap ${row.current.name} for ${row.suggestion.name}`}
      />

      <button
        type="button"
        onClick={() => onPreviewCurrent(row.current.name)}
        className="flex items-center gap-2 min-w-0 flex-1 text-left hover:text-violet-300"
      >
        <img src={scryfallImg(row.current.name, 'small')} alt="" className="h-8 w-6 rounded-sm object-cover flex-shrink-0" />
        <span className="truncate text-sm text-zinc-200">{row.current.name}</span>
        <span className="text-xs text-zinc-400 tabular-nums">{formatPrice(row.currentPrice, currency)}</span>
      </button>

      <ArrowRight className="h-4 w-4 text-zinc-500 flex-shrink-0" />

      <button
        type="button"
        onClick={() => onPreviewSuggestion(row.suggestion.name)}
        className="flex items-center gap-2 min-w-0 flex-1 text-left hover:text-violet-300"
      >
        <img src={scryfallImg(row.suggestion.name, 'small')} alt="" className="h-8 w-6 rounded-sm object-cover flex-shrink-0" />
        <span className="truncate text-sm text-zinc-200">{row.suggestion.name}</span>
        <span className="text-xs text-zinc-400 tabular-nums">{formatPrice(row.suggestion.price, currency)}</span>
      </button>

      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-sm font-semibold text-violet-300/80 tabular-nums">
          Save {formatPrice(row.savings, currency)}
        </span>
        <Badge className={`text-xs border ${style.cls}`}>{style.label}</Badge>
        <span className="text-xs text-zinc-500 tabular-nums hidden md:inline">{inclusionDelta}</span>
      </div>
    </div>
  );
}
