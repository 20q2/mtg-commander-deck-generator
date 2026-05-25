import type { Misfit } from '@/types';
import { ArrowRight } from 'lucide-react';
import { getCardImageUrl } from '@/services/scryfall/client';
import { scryfallImg } from '../constants';

interface CardFitFilmstripProps {
  featured: Misfit[];
  currentIndex: number;
  totalMisfits: number;
  onJump: (index: number) => void;
  onSeeAll: () => void;
}

export function CardFitFilmstrip({
  featured, currentIndex, totalMisfits, onJump, onSeeAll,
}: CardFitFilmstripProps) {
  const longTail = Math.max(0, totalMisfits - featured.length);

  return (
    <div className="mt-6 pt-4 border-t border-violet-500/15">
      <div className="text-[10px] text-muted-foreground/70 uppercase tracking-[0.18em] font-semibold mb-2.5">
        Up next · <span className="text-amber-300 font-bold">{featured.length}</span> in the lineup
      </div>
      <div className="flex gap-2 py-1 items-stretch overflow-x-auto pb-2 -mx-1 px-1">
        {featured.map((m, i) => {
          const isActive = i === currentIndex;
          const imgUrl = getCardImageUrl(m.card, 'small') ?? scryfallImg(m.card.name, 'small');
          return (
            <button
              key={m.card.name}
              type="button"
              onClick={() => onJump(i)}
              className={`relative shrink-0 rounded-md overflow-hidden transition-all w-[72px] aspect-[5/7] ${
                isActive
                  ? 'ring-2 ring-violet-400 ring-offset-2 ring-offset-[#0f0a18] opacity-100'
                  : 'opacity-70 hover:opacity-100'
              }`}
              aria-label={`Jump to misfit ${i + 1}: ${m.card.name}`}
              aria-current={isActive ? 'true' : undefined}
            >
              <img src={imgUrl} alt={m.card.name} className="w-full h-full object-cover" loading="lazy" />
              <span
                className="absolute bottom-1 left-1 text-white text-[9px] font-bold px-1.5 py-px rounded-full bg-rose-500/95"
                title={`${m.reasons.length} reason${m.reasons.length === 1 ? '' : 's'}`}
              >
                {m.reasons.length}
              </span>
            </button>
          );
        })}
        {longTail > 0 && (
          <button
            type="button"
            onClick={onSeeAll}
            className="shrink-0 w-[72px] aspect-[5/7] rounded-md border border-dashed border-violet-500/40 bg-violet-500/5 hover:bg-violet-500/10 hover:border-violet-500/60 transition-colors flex flex-col items-center justify-center gap-1 text-violet-300 hover:text-violet-200"
          >
            <span className="text-sm font-bold">+{longTail}</span>
            <span className="text-[9px] uppercase tracking-wider flex items-center gap-0.5">
              See all <ArrowRight className="w-2.5 h-2.5" />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
