import { useState, useMemo } from 'react';
import type { GapAnalysisCard, ScryfallCard } from '@/types';
import { getCardByName } from '@/services/scryfall/client';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { ShoppingCart, PackageCheck } from 'lucide-react';

const RANK_STYLES = [
  { bg: 'bg-amber-500/15', border: 'border-amber-500/40', badge: 'bg-amber-500 text-amber-950', label: '1st' },
  { bg: 'bg-slate-300/15', border: 'border-slate-400/40', badge: 'bg-slate-400 text-slate-950', label: '2nd' },
  { bg: 'bg-orange-700/15', border: 'border-orange-700/40', badge: 'bg-orange-700 text-orange-100', label: '3rd' },
];

interface GapAnalysisDisplayProps {
  cards: GapAnalysisCard[];
}

export function GapAnalysisDisplay({ cards }: GapAnalysisDisplayProps) {
  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);
  const [previewOwned, setPreviewOwned] = useState(false);
  const [hideOwned, setHideOwned] = useState(false);

  const hasAnyOwned = useMemo(() => cards.some(c => c.isOwned), [cards]);

  const MAX_SUGGESTIONS = 15;

  const visibleCards = useMemo(
    () => hideOwned ? cards.filter(c => !c.isOwned).slice(0, MAX_SUGGESTIONS) : cards.slice(0, MAX_SUGGESTIONS),
    [cards, hideOwned]
  );

  if (cards.length === 0) return null;

  const totalCost = visibleCards
    .filter(c => !c.isOwned)
    .reduce((sum, c) => sum + (c.price ? parseFloat(c.price) || 0 : 0), 0);

  const handleCardClick = async (name: string, isOwned: boolean) => {
    try {
      const card = await getCardByName(name);
      if (card) {
        setPreviewCard(card);
        setPreviewOwned(isOwned);
      }
    } catch {
      // silently fail
    }
  };

  return (
    <div className="mt-6 p-4 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-3">
        <ShoppingCart className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">Cards to Consider</h3>
        <span className="text-xs text-muted-foreground ml-auto">
          ~${totalCost.toFixed(2)} to buy
        </span>
      </div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground">
          Top cards that would strengthen this deck.
        </p>
        {hasAnyOwned && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none shrink-0 ml-4">
            <input
              type="checkbox"
              checked={hideOwned}
              onChange={(e) => setHideOwned(e.target.checked)}
              className="rounded border-border accent-purple-500"
            />
            Hide owned
          </label>
        )}
      </div>

      {visibleCards.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          All suggested cards are in your collection!
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5">
          {visibleCards.map((card, i) => {
            const rank = i < 3 ? RANK_STYLES[i] : null;

            return (
              <div
                key={card.name}
                onClick={() => handleCardClick(card.name, !!card.isOwned)}
                className={`flex items-center gap-2.5 py-1.5 px-2 rounded-lg border transition-colors cursor-pointer ${
                  rank
                    ? `${rank.bg} ${rank.border} hover:brightness-110`
                    : 'border-transparent hover:bg-accent/50'
                }`}
              >
                <div className="relative shrink-0">
                  {card.imageUrl ? (
                    <img
                      src={card.imageUrl}
                      alt={card.name}
                      className="w-8 h-auto rounded shadow"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-8 h-11 rounded bg-accent/50" />
                  )}
                  {rank && (
                    <span className={`absolute -top-1.5 -left-1.5 text-[9px] font-bold px-1 py-px rounded-full shadow ${rank.badge}`}>
                      {rank.label}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className={`text-sm truncate ${rank ? 'font-semibold' : 'font-medium'}`}>{card.name}</p>
                    {card.isOwned && (
                      <span title="In your collection">
                        <PackageCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{card.typeLine}</p>
                </div>
                <div className="text-right shrink-0 leading-tight">
                  {card.price && (
                    <p className={`text-xs font-medium ${card.isOwned ? 'text-muted-foreground line-through' : ''}`}>
                      ${parseFloat(card.price).toFixed(2)}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    {Math.round(Number(card.inclusion))}%
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CardPreviewModal card={previewCard} onClose={() => setPreviewCard(null)} isOwned={previewOwned} />
    </div>
  );
}
