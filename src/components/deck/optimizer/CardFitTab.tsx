// src/components/deck/optimizer/CardFitTab.tsx
import { useState, useMemo, useEffect, useCallback } from 'react';
import { Sparkles, ScrollText } from 'lucide-react';
import type { Misfit, GapAnalysisCard, ScryfallCard } from '@/types';
import { featuredMisfits, simulateSwapImpact } from '@/services/deckBuilder/cardFit';
import { CardFitHero } from './cardFit/CardFitHero';
import { CardFitFilmstrip } from './cardFit/CardFitFilmstrip';
import { CardFitFullList } from './cardFit/CardFitFullList';
import { scryfallImg } from './constants';

export interface CardFitTabProps {
  misfits: Misfit[];
  gapAnalysis: GapAnalysisCard[];
  onPreview: (cardName: string) => void;
  onAddCard?: (cardName: string) => void;
  onRemoveCard?: (card: ScryfallCard) => void;
  sampleSize?: number | null;
  /** Fired with the name of the misfit currently in the hero (or null). */
  onFocusedMisfitChange?: (name: string | null) => void;
}

export function CardFitTab({
  misfits, gapAnalysis, onPreview, onAddCard, onRemoveCard, sampleSize, onFocusedMisfitChange,
}: CardFitTabProps) {
  const [view, setView] = useState<'misfits' | 'gaps'>('misfits');
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [fullListOpen, setFullListOpen] = useState(false);

  const featured = useMemo(() => featuredMisfits(misfits), [misfits]);

  useEffect(() => {
    if (featuredIndex >= featured.length) setFeaturedIndex(0);
  }, [featured.length, featuredIndex]);

  const current = featured[featuredIndex];

  // Emit the focused misfit name so the deck view can highlight it differently.
  useEffect(() => {
    if (!onFocusedMisfitChange) return;
    onFocusedMisfitChange(view === 'misfits' && current ? current.card.name : null);
  }, [current, view, onFocusedMisfitChange]);
  const fitImpact = useMemo(
    () => current ? simulateSwapImpact(misfits, current, gapAnalysis.length, current.suggestedReplacement) : 0,
    [misfits, current, gapAnalysis.length],
  );

  const next = useCallback(() => {
    setFeaturedIndex(i => (featured.length === 0 ? 0 : (i + 1) % featured.length));
  }, [featured.length]);

  useEffect(() => {
    if (view !== 'misfits' || featured.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setFeaturedIndex(i => Math.min(i + 1, featured.length - 1));
      if (e.key === 'ArrowLeft') setFeaturedIndex(i => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, featured.length]);

  const handleSwap = (removeName: string, addName: string) => {
    if (onAddCard) onAddCard(addName);
    if (onRemoveCard) {
      const card = misfits.find(m => m.card.name === removeName)?.card;
      if (card) onRemoveCard(card);
    }
  };

  const viewToggle = (
    <div className="flex items-center border border-violet-500/30 rounded-md overflow-hidden shrink-0 backdrop-blur-sm" style={{ background: 'rgba(15,10,24,0.5)' }}>
      <button
        onClick={() => setView('misfits')}
        className={`flex items-center gap-1 text-[10px] px-2 py-1 transition-colors ${view === 'misfits' ? 'bg-rose-500/25 text-rose-300 font-bold' : 'text-violet-200/70 hover:text-violet-100 hover:bg-violet-500/15'}`}
      >
        <ScrollText className="w-2.5 h-2.5" />
        Misfits ({misfits.length})
      </button>
      <div className="w-px h-3 bg-violet-500/30" />
      <button
        onClick={() => setView('gaps')}
        className={`flex items-center gap-1 text-[10px] px-2 py-1 transition-colors ${view === 'gaps' ? 'bg-violet-500/25 text-violet-100 font-bold' : 'text-violet-200/70 hover:text-violet-100 hover:bg-violet-500/15'}`}
      >
        <Sparkles className="w-2.5 h-2.5" />
        Gaps ({gapAnalysis.length})
      </button>
    </div>
  );

  return (
    <div className="space-y-4 h-full">

      {view === 'misfits' && misfits.length === 0 && (
        <div className="p-4">
          <div className="flex justify-end mb-3">{viewToggle}</div>
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Sparkles className="w-5 h-5 text-violet-300/70" />
            <p className="text-xs text-muted-foreground italic">Every card pulls its weight.</p>
            <button
              onClick={() => setView('gaps')}
              className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground"
            >
              Check the Gaps tab for upgrade suggestions →
            </button>
          </div>
        </div>
      )}

      {view === 'misfits' && misfits.length > 0 && featured.length === 0 && (
        <div className="p-4">
          <div className="flex justify-end mb-3">{viewToggle}</div>
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
            <p className="text-xs text-muted-foreground italic">
              {misfits.length} borderline misfit{misfits.length !== 1 ? 's' : ''} — nothing severe.
            </p>
            <button
              onClick={() => setFullListOpen(true)}
              className="text-[11px] text-violet-300 hover:text-violet-200 font-semibold"
            >
              Review all {misfits.length} →
            </button>
          </div>
        </div>
      )}

      {view === 'misfits' && current && (
        <CardFitHero
          misfit={current}
          index={featuredIndex}
          total={featured.length}
          sampleSize={sampleSize ?? null}
          fitImpact={fitImpact}
          onPreview={onPreview}
          onRemove={onRemoveCard}
          onSwap={(onAddCard && onRemoveCard) ? handleSwap : undefined}
          onSkip={next}
          headerActions={viewToggle}
        >
          <CardFitFilmstrip
            featured={featured}
            currentIndex={featuredIndex}
            totalMisfits={misfits.length}
            onJump={setFeaturedIndex}
            onSeeAll={() => setFullListOpen(true)}
          />
          <CardFitFullList
            open={fullListOpen}
            onClose={() => setFullListOpen(false)}
            misfits={misfits}
            onPreview={onPreview}
            onRemove={onRemoveCard}
            onAddReplacement={onAddCard}
          />
        </CardFitHero>
      )}

      {view === 'gaps' && (
        <section className="p-4">
          <div className="flex justify-end mb-3">{viewToggle}</div>
          {gapAnalysis.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-8 text-center">No notable gaps detected.</p>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
              {gapAnalysis.slice(0, 24).map(g => (
                <GapCard key={g.name} gap={g} onPreview={onPreview} onAddCard={onAddCard} />
              ))}
            </div>
          )}
        </section>
      )}

    </div>
  );
}

function GapCard({
  gap, onPreview, onAddCard,
}: {
  gap: GapAnalysisCard;
  onPreview: (name: string) => void;
  onAddCard?: (name: string) => void;
}) {
  const imgUrl = gap.imageUrl || scryfallImg(gap.name, 'small');
  return (
    <div className="group relative">
      <button type="button" onClick={() => onPreview(gap.name)} className="w-full text-left">
        <img
          src={imgUrl}
          alt={gap.name}
          className="w-full aspect-[5/7] rounded border border-violet-500/30 object-cover"
          loading="lazy"
        />
      </button>
      <div className="mt-1 text-[10px] text-muted-foreground text-center truncate">{gap.name}</div>
      <div className="text-[9px] text-violet-300/80 text-center">
        {gap.inclusion.toFixed(0)}% inclusion
      </div>
      {onAddCard && (
        <button
          type="button"
          onClick={() => onAddCard(gap.name)}
          className="absolute top-1 left-1 rounded-tl rounded-br bg-black/60 hover:bg-black/80 text-white px-1.5 py-0.5 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
        >
          + add
        </button>
      )}
    </div>
  );
}
