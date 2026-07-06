import { useEffect, useMemo, useState } from 'react';
import { Newspaper, Plus, ArrowRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getCardsByNames, getCardImageUrl } from '@/services/scryfall/client';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import type { ScryfallCard } from '@/types';

interface DeckUpgradesProps {
  newCards: string[];
  /** Add a card to the deck (reuses the list-deck add flow). */
  onApply: (cardName: string) => void;
  /** Record cards the user has now seen (used by Add and by Dismiss). */
  onMarkSeen: (names: string[]) => void;
  /** Open SpellChroma / inspector for deeper tuning. */
  onExplore: () => void;
}

const MAX_VISIBLE = 6;

/** Full card image (frame + text), with DFC front-face handled by getCardImageUrl. */
function cardImage(card: ScryfallCard): string {
  return getCardImageUrl(card, 'normal') ?? '';
}

/**
 * "New cards for this deck" — the return-trigger surface for a saved deck.
 * Surfaces genuinely new cards for the commander (NOT generic inspector-overview
 * synergy, NOT combo completion), art-forward and dismissible. Renders nothing
 * when there's nothing new (quiet by default; never nags).
 */
export function DeckUpgrades({ newCards, onApply, onMarkSeen, onExplore }: DeckUpgradesProps) {
  const visibleNames = useMemo(() => newCards.slice(0, MAX_VISIBLE), [newCards]);
  const [cards, setCards] = useState<Map<string, ScryfallCard>>(new Map());
  const [preview, setPreview] = useState<ScryfallCard | null>(null);

  const namesKey = visibleNames.join('|');
  useEffect(() => {
    if (visibleNames.length === 0) return;
    let cancelled = false;
    getCardsByNames(visibleNames).then(map => { if (!cancelled) setCards(map); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey]);

  if (visibleNames.length === 0) return null;

  return (
    <div className="relative overflow-hidden rounded-xl border border-violet-500/25 bg-gradient-to-br from-violet-500/[0.08] via-card/40 to-card/40 p-4 sm:p-5">
      {/* soft glow to lift it off the deck column */}
      <div aria-hidden className="pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full bg-violet-500/10 blur-3xl" />

      <div className="relative flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-violet-500/15 text-violet-300 border border-violet-500/25">
            <Newspaper className="w-4 h-4" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-violet-100/95">New cards for this deck</p>
            <p className="text-[11px] text-violet-300/60">New printings, ranked by fit with your deck</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="text-violet-300/80 hover:text-violet-100" onClick={onExplore}>
            <span className="hidden sm:inline">Explore more</span>
            <ArrowRight className="w-3.5 h-3.5 sm:ml-1" />
          </Button>
          <Button
            variant="ghost" size="icon"
            className="text-muted-foreground/60 hover:text-foreground h-8 w-8"
            title="Dismiss these"
            onClick={() => onMarkSeen(visibleNames)}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="relative grid grid-cols-3 gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] sm:gap-3">
        {visibleNames.map((name, i) => {
          const card = cards.get(name);
          return (
            <div
              key={name}
              className="group relative animate-sc-card-in"
              style={{ animationDelay: `${Math.min(i, 12) * 45}ms` }}
            >
              <button
                type="button"
                onClick={() => card && setPreview(card)}
                title={name}
                className="relative block w-full aspect-[5/7] rounded-xl overflow-hidden bg-violet-500/10 border border-border/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 transition-transform duration-200 hover:-translate-y-1 hover:shadow-[0_12px_30px_-10px_rgba(0,0,0,0.75)]"
              >
                {card ? (
                  <img
                    src={cardImage(card)}
                    alt={name}
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 animate-pulse bg-violet-500/10" />
                )}
              </button>

              <Button
                size="sm"
                className="absolute bottom-1.5 left-1/2 -translate-x-1/2 h-7 px-3 gap-1 bg-violet-600/95 hover:bg-violet-500 text-white border border-violet-400/40 shadow-lg opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                title={`Add ${name} to deck`}
                onClick={() => { onApply(name); onMarkSeen([name]); }}
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </Button>
            </div>
          );
        })}
      </div>

      <CardPreviewModal card={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
