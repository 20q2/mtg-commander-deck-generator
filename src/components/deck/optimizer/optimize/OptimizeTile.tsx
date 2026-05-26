import { useEffect, useRef } from 'react';
import { Zap } from 'lucide-react';
import type { OptimizeCard } from '@/services/deckBuilder/deckAnalyzer';
import { scryfallImg, ROLE_BADGE_COLORS, ROLE_LABEL_ICONS } from '../constants';

export type TileSide = 'remove' | 'add';

interface OptimizeTileProps {
  card: OptimizeCard;
  side: TileSide;
  checked: boolean;
  active: boolean;  // is this tile's drill-down currently open
  onClick: () => void;
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

export function OptimizeTile({ card, side, checked, active, onClick }: OptimizeTileProps) {
  const sideCls = SIDE_CLASSES[side];
  const imgUrl = card.imageUrl || scryfallImg(card.name, 'small');
  const RoleIcon = card.roleLabel ? ROLE_LABEL_ICONS[card.roleLabel] : null;
  const roleBadgeColor = card.roleLabel ? ROLE_BADGE_COLORS[card.roleLabel] : null;
  const isComboEnabler = card.reasonCategory === 'combo-enabler';

  // Scroll the tile into view when it becomes active so the user sees both
  // the clicked tile and the drill-down panel that opens directly below it.
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) buttonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [active]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      // scroll-mt clears the sticky plan header above so the tile lands below it.
      className={`group/tile relative block w-full text-left transition-all duration-200 rounded-lg overflow-visible scroll-mt-40 ${
        active ? `ring-2 ${sideCls.ring}` : ''
      }`}
      title={card.name}
    >
      <div
        className={`relative rounded-lg overflow-hidden border transition-all duration-200 ${
          checked ? `${sideCls.border} ${sideCls.hover} group-hover/tile:scale-[1.03]` : 'border-muted-foreground/20 opacity-60'
        }`}
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

        {RoleIcon && roleBadgeColor && (
          <span
            className={`absolute top-1 left-1 inline-flex items-center gap-0.5 text-[9px] font-bold px-1 py-px rounded-full ${roleBadgeColor}`}
            title={card.roleLabel}
          >
            <RoleIcon className="w-2.5 h-2.5" />
          </span>
        )}

        {side === 'add' && isComboEnabler && (
          <span
            className="absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-violet-500/80 text-white"
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
      </div>

      <div className="mt-1 text-[10px] text-center truncate text-foreground/80">
        {card.name}
      </div>
    </button>
  );
}
