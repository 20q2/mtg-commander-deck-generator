// src/components/deck/optimizer/CardFitTab.tsx
import { useState } from 'react';
import { Sparkles, ScrollText, ArrowRight } from 'lucide-react';
import type { Misfit, GapAnalysisCard, ScryfallCard } from '@/types';
import { getCardImageUrl } from '@/services/scryfall/client';
import { scryfallImg } from './constants';

export interface CardFitTabProps {
  misfits: Misfit[];
  gapAnalysis: GapAnalysisCard[];
  /** Trigger from a card row — preview the card. */
  onPreview: (cardName: string) => void;
  /** Optional adders/removers for inline action. */
  onAddCard?: (cardName: string) => void;
  onRemoveCard?: (card: ScryfallCard) => void;
  sampleSize?: number | null;
}

export function CardFitTab({
  misfits, gapAnalysis, onPreview, onAddCard, onRemoveCard, sampleSize,
}: CardFitTabProps) {
  const [view, setView] = useState<'misfits' | 'gaps'>('misfits');

  const countLabel = view === 'misfits'
    ? `${misfits.length} misfit${misfits.length !== 1 ? 's' : ''}`
    : `${gapAnalysis.length} gap${gapAnalysis.length !== 1 ? 's' : ''}`;

  return (
    <div className="space-y-4">
      {/* Header: title + citation left, segmented toggle right */}
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Card Fit
            <span className="ml-2 text-xs font-normal text-muted-foreground/70">· {countLabel}</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {sampleSize ? `Based on ${sampleSize.toLocaleString()} decklists.` : 'Based on aggregated EDHREC data.'}
          </p>
        </div>

        {/* Segmented button-tab */}
        <div className="flex items-center border border-border/50 rounded-md overflow-hidden shrink-0 mt-0.5">
          <button
            onClick={() => setView('misfits')}
            className={`flex items-center gap-1 text-[10px] px-2 py-0.5 transition-colors ${view === 'misfits' ? 'bg-rose-500/15 text-rose-400 font-medium' : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-accent/50'}`}
          >
            <ScrollText className="w-2.5 h-2.5" />
            Misfits ({misfits.length})
          </button>
          <div className="w-px h-3 bg-border/50" />
          <button
            onClick={() => setView('gaps')}
            className={`flex items-center gap-1 text-[10px] px-2 py-0.5 transition-colors ${view === 'gaps' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-accent/50'}`}
          >
            <Sparkles className="w-2.5 h-2.5" />
            Gaps ({gapAnalysis.length})
          </button>
        </div>
      </header>

      {/* Misfits panel */}
      {view === 'misfits' && (
        <section>
          {misfits.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <Sparkles className="w-5 h-5 text-violet-300/70" />
              <p className="text-xs text-muted-foreground italic">Every card pulls its weight.</p>
              <button
                onClick={() => setView('gaps')}
                className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              >
                Check the Gaps tab for upgrade suggestions →
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {misfits.map(m => (
                <MisfitRow
                  key={m.card.name}
                  misfit={m}
                  onPreview={onPreview}
                  onRemoveCard={onRemoveCard}
                  onAddReplacement={onAddCard}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Gaps panel */}
      {view === 'gaps' && (
        <section>
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

function MisfitRow({
  misfit, onPreview, onRemoveCard, onAddReplacement,
}: {
  misfit: Misfit;
  onPreview: (name: string) => void;
  onRemoveCard?: (card: ScryfallCard) => void;
  onAddReplacement?: (name: string) => void;
}) {
  const imgUrl = getCardImageUrl(misfit.card, 'small') ?? scryfallImg(misfit.card.name, 'small');
  return (
    <div className="flex items-stretch gap-3 p-2 rounded-lg border-l-2 border-l-rose-500/50 bg-rose-500/5">
      <button type="button" onClick={() => onPreview(misfit.card.name)} className="shrink-0">
        <img src={imgUrl} alt={misfit.card.name} className="w-12 h-16 rounded border border-rose-500/40 object-cover" loading="lazy" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-foreground truncate">{misfit.card.name}</div>
        <ul className="mt-1 space-y-0.5">
          {misfit.reasons.map((r, i) => (
            <li key={i} className="text-[11px] text-muted-foreground">
              <span className="text-rose-400/90 font-medium">{r.label}</span> — {r.detail}
            </li>
          ))}
        </ul>
        {onRemoveCard && (
          <button
            type="button"
            onClick={() => onRemoveCard(misfit.card)}
            className="mt-1.5 text-[10px] text-rose-400 hover:text-rose-300 transition-colors"
          >
            Remove from deck
          </button>
        )}
      </div>
      {misfit.suggestedReplacement && (
        <div className="shrink-0 flex flex-col items-center justify-center text-center px-2 border-l border-border/30 ml-1">
          <ArrowRight className="w-3 h-3 text-violet-300/80 mb-1" />
          <button
            type="button"
            onClick={() => onPreview(misfit.suggestedReplacement!.name)}
            className="text-[10px] text-violet-300 font-semibold hover:text-violet-200 transition-colors max-w-[100px] truncate"
            title={misfit.suggestedReplacement.name}
          >
            {misfit.suggestedReplacement.name}
          </button>
          {onAddReplacement && (
            <button
              type="button"
              onClick={() => onAddReplacement(misfit.suggestedReplacement!.name)}
              className="mt-1 text-[9px] text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              + add
            </button>
          )}
        </div>
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
