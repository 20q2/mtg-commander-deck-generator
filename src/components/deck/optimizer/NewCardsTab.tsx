import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Plus, Check, CalendarDays, Crown, Tags } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import { getCardsByNames, getCardImageUrl } from '@/services/scryfall/client';
import { Button } from '@/components/ui/button';
import { getUpgradeDetails, type UpgradeDetail } from '@/services/deckUpgrades/getRelevantCards';

/**
 * "New Cards" inspector tab — the deep surface behind the deck view's
 * "New cards for this deck" panel. Same producer, but with the reasoning shown:
 * where each card came from (commander page / intended-theme page / recent set)
 * and which of YOUR cards back it (lift edges), so the ranking is inspectable
 * rather than a black box.
 */

interface NewCardsTabProps {
  currentCards: ScryfallCard[];
  commanderName: string;
  partnerCommanderName?: string;
  colorIdentity?: string[];
  /** Intended EDHREC theme names (from the saved list / generated deck). */
  intendedThemes?: string[];
  onAdd: (name: string) => void;
  addedCards: Set<string>;
  onPreview: (name: string) => void;
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'done'; details: UpgradeDetail[] }
  | { phase: 'error' };

/** EDHREC caps lift display at 99+; mirror that so absurd values never read as ×1376. */
const liftLabel = (l: number) => (l >= 99 ? '99+' : `×${l.toFixed(1)}`);

/** Below this many shared decks a lift edge is thin evidence — shown, but dimmed. */
const EDGE_CONFIDENCE_FLOOR = 50;

export function NewCardsTab({
  currentCards, commanderName, partnerCommanderName, colorIdentity, intendedThemes,
  onAdd, addedCards, onPreview,
}: NewCardsTabProps) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [images, setImages] = useState<Map<string, ScryfallCard>>(new Map());

  const deckCardNames = useMemo(
    () => [...new Set([commanderName, partnerCommanderName, ...currentCards.map(c => c.name)].filter(Boolean) as string[])],
    [commanderName, partnerCommanderName, currentCards],
  );

  const themesKey = (intendedThemes ?? []).join('|');
  useEffect(() => {
    let cancelled = false;
    setState({ phase: 'loading' });
    getUpgradeDetails({
      commanderName,
      partnerName: partnerCommanderName,
      deckCardNames,
      themes: intendedThemes,
      colorIdentity,
    }).then(async details => {
      if (cancelled) return;
      setState({ phase: 'done', details });
      // Hydrate art after the list is up — rows render with a pulse placeholder until then.
      const map = await getCardsByNames(details.map(d => d.name));
      if (!cancelled) setImages(map);
    }).catch(() => { if (!cancelled) setState({ phase: 'error' }); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commanderName, partnerCommanderName, themesKey]);

  const maxFit = state.phase === 'done' ? Math.max(0, ...state.details.map(d => d.liftFit)) : 0;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="bg-card/60 border border-border/30 rounded-lg p-4 sm:p-5">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-violet-500/15 text-violet-300 border border-violet-500/25 shrink-0">
            <Sparkles className="w-4 h-4" />
          </span>
          <div className="leading-tight min-w-0">
            <h3 className="text-sm font-semibold text-foreground">New cards for this deck</h3>
            <p className="text-xs text-muted-foreground/80">
              EDHREC's new-card lists for {commanderName}
              {intendedThemes && intendedThemes.length > 0 && <> and its {intendedThemes.join(' + ')} theme page{intendedThemes.length > 1 ? 's' : ''}</>}
              , plus recent sets — ranked by how strongly they play alongside the cards already in your deck.
            </p>
          </div>
        </div>
      </div>

      {state.phase === 'loading' && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-24 rounded-lg bg-card/40 border border-border/20 animate-pulse" />
          ))}
        </div>
      )}

      {state.phase === 'error' && (
        <div className="bg-card/60 border border-border/30 rounded-lg p-6 text-sm text-muted-foreground">
          Couldn't load new-card data right now — EDHREC may be unreachable. Try again in a bit.
        </div>
      )}

      {state.phase === 'done' && state.details.length === 0 && (
        <div className="bg-card/60 border border-border/30 rounded-lg p-6 text-center">
          <Sparkles className="w-6 h-6 text-violet-300/60 mx-auto mb-2" />
          <p className="text-sm text-foreground/90">Nothing new for this deck right now.</p>
          <p className="text-xs text-muted-foreground/80 mt-1">Check back after the next set drops — this list tracks EDHREC's new-card data as it moves.</p>
        </div>
      )}

      {state.phase === 'done' && state.details.map(d => {
        const card = images.get(d.name);
        const img = card ? getCardImageUrl(card, 'small') : null;
        const added = addedCards.has(d.name);
        const fitPct = maxFit > 0 ? Math.round((d.liftFit / maxFit) * 100) : 0;
        return (
          <div key={d.name} className="bg-card/60 border border-border/30 rounded-lg p-3 sm:p-4 flex gap-3">
            {/* Art */}
            <button
              type="button"
              onClick={() => onPreview(d.name)}
              title={d.name}
              className="relative w-14 sm:w-16 shrink-0 aspect-[5/7] rounded-md overflow-hidden bg-violet-500/10 border border-border/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 self-start"
            >
              {img
                ? <img src={img} alt={d.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                : <div className="absolute inset-0 animate-pulse bg-violet-500/10" />}
            </button>

            {/* Body */}
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onPreview(d.name)}
                    className="text-sm font-medium text-foreground hover:text-violet-300 transition-colors truncate block max-w-full text-left"
                  >
                    {d.name}
                  </button>
                  {/* Source badges — where this recommendation came from */}
                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    {d.sources.includes('commander') && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 border border-violet-500/30 px-2 py-0.5 text-[10px] font-medium text-violet-300/90">
                        <Crown className="w-2.5 h-2.5" /> New for {commanderName.split(',')[0]}
                      </span>
                    )}
                    {d.matchedThemes.map(t => (
                      <span key={t} className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 px-2 py-0.5 text-[10px] font-medium text-violet-300/80">
                        <Tags className="w-2.5 h-2.5" /> {t}
                      </span>
                    ))}
                    {d.sources.includes('recent-set') && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium text-amber-300/90">
                        <CalendarDays className="w-2.5 h-2.5" /> Recent set
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant={added ? 'ghost' : 'outline'}
                  size="sm"
                  disabled={added}
                  className="shrink-0"
                  onClick={() => onAdd(d.name)}
                >
                  {added ? <><Check className="w-3.5 h-3.5 mr-1 text-emerald-400" /> Added</> : <><Plus className="w-3.5 h-3.5 mr-1" /> Add</>}
                </Button>
              </div>

              {/* Signals: fit meter + synergy + inclusion */}
              <div className="flex items-center gap-3 text-[11px]">
                <div className="flex items-center gap-1.5 flex-1 min-w-0 max-w-56" title="Summed lift between this card and the cards in your deck, scaled to the strongest candidate">
                  <span className="text-muted-foreground/80 shrink-0">Deck fit</span>
                  <div className="h-1.5 flex-1 rounded-full bg-border/40 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-violet-500/60 to-violet-400" style={{ width: `${fitPct}%` }} />
                  </div>
                </div>
                {typeof d.synergy === 'number' && (
                  <span className="text-violet-300/80 shrink-0" title="EDHREC synergy: how much more this commander plays it than the average deck">
                    {d.synergy >= 0 ? '+' : ''}{Math.round(d.synergy * 100)}% synergy
                  </span>
                )}
                {d.inclusion > 0 && (
                  <span className="text-muted-foreground/80 shrink-0">in {Math.round(d.inclusion)}% of decks</span>
                )}
              </div>

              {/* Evidence: which of YOUR cards back it */}
              {d.topEdges.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1 text-[11px]">
                  <span className="text-muted-foreground/70">Plays with your</span>
                  {d.topEdges.map(e => (
                    <button
                      key={e.deckCard}
                      type="button"
                      onClick={() => onPreview(e.deckCard)}
                      title={`Lift ${liftLabel(e.lift)} · together in ${e.numDecks.toLocaleString()} decks${e.numDecks < EDGE_CONFIDENCE_FLOOR ? ' (thin data)' : ''}`}
                      className={`inline-flex items-center gap-1 rounded-full bg-accent/40 hover:bg-accent/70 border border-border/40 px-2 py-0.5 transition-colors ${e.numDecks < EDGE_CONFIDENCE_FLOOR ? 'text-foreground/60' : 'text-foreground/85'}`}
                    >
                      {e.deckCard}
                      <span className="text-violet-300/80 font-medium">{liftLabel(e.lift)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground/70">No lift data against your cards yet — too new for co-occurrence stats.</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
