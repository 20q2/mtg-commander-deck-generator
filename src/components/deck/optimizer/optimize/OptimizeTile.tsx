import { forwardRef } from 'react';
import { Zap } from 'lucide-react';
import type { OptimizeCard } from '@/services/deckBuilder/deckAnalyzer';
import { Checkbox } from '@/components/ui/checkbox';
import { scryfallImg } from '../constants';

export type TileSide = 'remove' | 'add';

interface OptimizeTileProps {
  card: OptimizeCard;
  side: TileSide;
  checked: boolean;
  active: boolean;  // is this tile's drill-down popover currently open
  onClick: () => void;
  onToggleChecked: () => void;
}

const SIDE_CLASSES: Record<TileSide, {
  border: string;
  ring: string;
  hover: string;
}> = {
  remove: {
    border: 'border-red-500/30',
    ring: 'ring-red-400/60',
    hover: 'hover:border-red-400/60',
  },
  add: {
    border: 'border-emerald-500/30',
    ring: 'ring-emerald-400/60',
    hover: 'hover:border-emerald-400/60',
  },
};

export const OptimizeTile = forwardRef<HTMLButtonElement, OptimizeTileProps>(function OptimizeTile(
  { card, side, checked, active, onClick, onToggleChecked },
  ref,
) {
  const sideCls = SIDE_CLASSES[side];
  const imgUrl = card.imageUrl || scryfallImg(card.name, 'small');
  const isComboEnabler = card.reasonCategory === 'combo-enabler';
  const checkboxAria = checked
    ? side === 'remove' ? 'Keep this card (cancel removal)' : 'Skip this card (cancel addition)'
    : side === 'remove' ? 'Mark this card for removal' : 'Mark this card for addition';

  // Inclusion-based "consensus" color/width for the bottom bar:
  // ≤10% red → 30% amber → 60%+ emerald. Gives an ambient sense of how
  // mainstream a pick is without putting a number on the tile.
  const inclusion = card.inclusion ?? 0;
  const inclusionHue = Math.min(120, Math.max(0, inclusion * 1.4));
  const inclusionWidth = Math.min(100, Math.max(4, inclusion));

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="group/tile relative block w-full text-left rounded-lg overflow-visible"
      title={card.name}
    >
      <div
        className={`relative rounded-lg overflow-hidden border transition-all duration-300 ease-out ${
          checked
            ? `${sideCls.border} ${sideCls.hover} shadow-sm shadow-black/40 group-hover/tile:shadow-lg group-hover/tile:shadow-black/60`
            : 'border-muted-foreground/20 opacity-60'
        } ${active ? `ring-2 ${sideCls.ring}` : ''}`}
        style={{
          filter: checked ? undefined : 'grayscale(0.95) brightness(0.55)',
        }}
      >
        <img
          src={imgUrl}
          alt={card.name}
          className="w-full aspect-[5/7] object-cover"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).src = scryfallImg(card.name); }}
        />

        {!checked && (
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'repeating-linear-gradient(45deg, rgba(0,0,0,0.35) 0 6px, transparent 6px 14px)',
            }}
          />
        )}

        {/* Checkbox — toggles selection without opening the drill-down. */}
        <Checkbox
          checked={checked}
          onCheckedChange={() => onToggleChecked()}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={checkboxAria}
          title={checkboxAria}
          className="absolute top-1 left-1 bg-black/55 backdrop-blur-[2px]"
        />

        {side === 'add' && isComboEnabler && (
          <span
            className="absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-violet-500/80 text-white shadow-md shadow-violet-900/50"
            title="Completes a combo"
          >
            <Zap className="w-3 h-3" />
          </span>
        )}

        {!checked && (
          <div className="absolute inset-x-0 bottom-1 flex justify-center opacity-0 group-hover/tile:opacity-100 transition-opacity">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-black/70 text-white">
              {side === 'remove' ? 'Re-keep' : 'Re-add'}
            </span>
          </div>
        )}

        {/* Consensus / inclusion bar — width = inclusion %, color = how mainstream.
            Glanceable signal without adding a number to the tile. */}
        {checked && card.inclusion != null && (
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/40">
            <div
              className="h-full transition-[width,background-color] duration-500 ease-out"
              style={{
                width: `${inclusionWidth}%`,
                backgroundColor: `hsl(${inclusionHue}, 75%, 52%)`,
                boxShadow: `0 0 6px hsl(${inclusionHue}, 80%, 50%, 0.5)`,
              }}
              title={`${Math.round(inclusion)}% EDHREC inclusion`}
            />
          </div>
        )}
      </div>

      <div className={`mt-1 text-[10px] text-center truncate transition-colors ${
        checked ? 'text-foreground/85 group-hover/tile:text-foreground' : 'text-foreground/50'
      }`}>
        {card.name}
      </div>
    </button>
  );
});
