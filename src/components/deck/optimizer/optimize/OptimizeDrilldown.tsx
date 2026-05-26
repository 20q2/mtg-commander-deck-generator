import { X, Zap, ArrowRight } from 'lucide-react';
import type { ScryfallCard, DetectedCombo } from '@/types';
import type { OptimizeCard } from '@/services/deckBuilder/deckAnalyzer';
import { Button } from '@/components/ui/button';
import { ManaText } from '@/components/ui/mtg-icons';
import { getCachedCard, getCardImageUrl } from '@/services/scryfall/client';
import { scryfallImg } from '../constants';
import type { TileSide } from './OptimizeTile';

export interface OptimizeDrilldownProps {
  card: OptimizeCard;
  side: TileSide;
  checked: boolean;
  /** For cuts only: candidate replacement cards from the swap-candidates index. */
  candidates?: ScryfallCard[];
  /** For adds tagged combo-enabler only: the combo this card completes. */
  combo?: DetectedCombo;
  onToggle: (name: string) => void;
  onClose: () => void;
  /** Called when the user clicks a replacement candidate (cut side) — typically a preview modal opener. */
  onPreviewCard?: (name: string) => void;
  /** Called when the user clicks "View combo" — typically scrolls to the combo footer. */
  onViewCombo?: (comboId: string) => void;
}

const SIDE_STYLE: Record<TileSide, { panelBorder: string; reasonAccent: string; toggleVariant: 'destructive' | 'default' }> = {
  remove: { panelBorder: 'border-red-500/30',     reasonAccent: 'text-red-300/80',     toggleVariant: 'destructive' },
  add:    { panelBorder: 'border-emerald-500/30', reasonAccent: 'text-emerald-300/80', toggleVariant: 'default' },
};

function resolveTypeLine(card: OptimizeCard): string {
  if (card.primaryType && card.primaryType !== 'Unknown') return card.primaryType;
  const cached = getCachedCard(card.name);
  if (cached) {
    const tl = (cached.card_faces?.[0]?.type_line ?? cached.type_line ?? '')
      .split('—')[0].replace(/Legendary\s+/i, '').trim();
    if (tl) return tl;
  }
  return '';
}

function resolveBigImage(card: OptimizeCard): string {
  const cached = getCachedCard(card.name);
  if (cached) {
    const url = getCardImageUrl(cached, 'normal');
    if (url) return url;
  }
  return scryfallImg(card.name, 'normal');
}

function resolveManaCost(card: OptimizeCard): string {
  const cached = getCachedCard(card.name);
  if (!cached) return '';
  return cached.mana_cost ?? cached.card_faces?.[0]?.mana_cost ?? '';
}

export function OptimizeDrilldown({
  card, side, checked, candidates, combo, onToggle, onClose, onPreviewCard, onViewCombo,
}: OptimizeDrilldownProps) {
  const style = SIDE_STYLE[side];
  const imgUrl = resolveBigImage(card);
  const typeLine = resolveTypeLine(card);
  const manaCost = resolveManaCost(card);
  const inclusionPct = card.inclusion != null ? Math.round(card.inclusion) : null;
  const scoreVal = card.score != null ? Math.round(card.score) : null;
  const toggleLabel = side === 'remove'
    ? (checked ? 'Keep in deck' : 'Swap out')
    : (checked ? 'Skip this card' : 'Add to deck');

  return (
    <div
      className={`relative rounded-xl border ${style.panelBorder} bg-card/80 backdrop-blur-md shadow-xl shadow-black/50 p-3 sm:p-4 animate-fade-in`}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-2 right-2 p-1 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-accent/40"
        aria-label="Close details"
      >
        <X className="w-3.5 h-3.5" />
      </button>

      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        <div className="shrink-0 w-32 sm:w-40">
          <img
            src={imgUrl}
            alt={card.name}
            className="w-full aspect-[5/7] rounded-lg shadow-lg"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).src = scryfallImg(card.name, 'normal'); }}
          />
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div>
            <div className="flex items-start gap-2 pr-8">
              <h4 className="text-sm font-semibold flex-1 min-w-0 truncate">
                {card.name}
              </h4>
              {manaCost && (
                <ManaText text={manaCost} className="shrink-0 text-sm leading-none" />
              )}
            </div>
            {(card.isGameChanger || card.isThemeSynergy) && (
              <div className="flex items-center gap-1.5 mt-1">
                {card.isThemeSynergy && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-violet-400/90" title="High synergy with commander themes">
                    <Zap className="w-2.5 h-2.5" />
                    High Synergy
                  </span>
                )}
                {card.isGameChanger && (
                  <span className="text-[10px] font-bold text-amber-400/90" title="Game Changer (EDHREC)">GC</span>
                )}
              </div>
            )}
            {typeLine && (
              <p className="text-[11px] text-foreground/70 mt-1">
                {typeLine}{card.cmc != null && card.cmc > 0 ? ` · CMC ${card.cmc}` : ''}
              </p>
            )}
          </div>

          <p className={`text-xs leading-snug ${style.reasonAccent}`}>
            {card.reason}
          </p>

          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold">
            {inclusionPct != null && (() => {
              const hue = Math.min(120, Math.max(0, inclusionPct * 1.4));
              return (
                <span
                  className="inline-flex items-baseline gap-1 px-2 py-1 rounded-md border tabular-nums"
                  style={{
                    color: `hsl(${hue}, 75%, 65%)`,
                    backgroundColor: `hsla(${hue}, 70%, 30%, 0.15)`,
                    borderColor: `hsla(${hue}, 70%, 45%, 0.35)`,
                  }}
                  title="EDHREC inclusion — % of decks running this card"
                >
                  <span className="text-xs">{inclusionPct}%</span>
                  <span className="text-[9px] opacity-80 uppercase tracking-wider">inclusion</span>
                </span>
              );
            })()}
            {scoreVal != null && (
              <span
                className="inline-flex items-baseline gap-1 px-2 py-1 rounded-md border border-violet-500/30 bg-violet-500/15 text-violet-300 tabular-nums"
                title="Relevancy score (composite of inclusion + synergy + role fit)"
              >
                <span className="text-xs">{scoreVal}</span>
                <span className="text-[9px] opacity-80 uppercase tracking-wider">score</span>
              </span>
            )}
            {card.price && (
              <span
                className="inline-flex items-baseline gap-1 px-2 py-1 rounded-md border border-border/40 bg-muted/30 text-foreground/80 tabular-nums"
                title="Current market price"
              >
                <span className="text-xs">${card.price}</span>
              </span>
            )}
          </div>

          {side === 'remove' && candidates && candidates.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                Could swap with
              </p>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {candidates.slice(0, 6).map(cand => {
                  const candImg = cand.image_uris?.small ?? scryfallImg(cand.name, 'small');
                  return (
                    <button
                      key={cand.name}
                      type="button"
                      onClick={() => onPreviewCard?.(cand.name)}
                      className="shrink-0 w-12 rounded border border-border/40 hover:border-emerald-500/40 transition-colors overflow-hidden"
                      title={cand.name}
                    >
                      <img src={candImg} alt={cand.name} className="w-full aspect-[5/7] object-cover" loading="lazy" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {side === 'add' && combo && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                Completes combo
              </p>
              <button
                type="button"
                onClick={() => onViewCombo?.(combo.comboId)}
                className="inline-flex items-center gap-1 text-[11px] text-violet-300/80 hover:text-violet-200 transition-colors"
              >
                {combo.cards.join(' + ')}
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          )}

          <div className="mt-auto pt-2">
            <Button
              type="button"
              variant={checked ? style.toggleVariant : 'outline'}
              size="sm"
              onClick={() => onToggle(card.name)}
              className="w-full"
            >
              {toggleLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
