import { useState, useCallback, useEffect, Fragment } from 'react';
import type { DetectedCombo, ScryfallCard } from '@/types';
import { getCardByName, getCardImageUrl } from '@/services/scryfall/client';
import { getCollectionNameSet } from '@/services/collection/db';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { Sparkles, Check, AlertTriangle, ChevronDown, Plus, Package } from 'lucide-react';
import { trackEvent } from '@/services/analytics';
import { useStore } from '@/store';

interface ComboDisplayProps {
  combos: DetectedCombo[];
}

// Cache fetched card data across renders
const cardDataCache = new Map<string, ScryfallCard>();

export function ComboDisplay({ combos }: ComboDisplayProps) {
  const commander = useStore(s => s.commander);
  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [hasTrackedView, setHasTrackedView] = useState(false);
  const [expandedCombo, setExpandedCombo] = useState<string | null>(null);
  const [showAllNearMisses, setShowAllNearMisses] = useState(false);
  const [cardImages, setCardImages] = useState<Map<string, string>>(new Map());
  const [collectionNames, setCollectionNames] = useState<Set<string> | null>(null);

  // Load collection names when expanded
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    getCollectionNameSet().then(names => {
      if (!cancelled && names.size > 0) setCollectionNames(names);
    });
    return () => { cancelled = true; };
  }, [expanded]);

  // Fetch card images when expanded
  useEffect(() => {
    if (!expanded) return;

    const allNames = [...new Set(combos.flatMap(c => c.cards))];
    const missing = allNames.filter(n => !cardImages.has(n));
    if (missing.length === 0) return;

    let cancelled = false;

    (async () => {
      const newImages = new Map(cardImages);
      for (const name of missing) {
        if (cancelled) break;
        try {
          let card = cardDataCache.get(name);
          if (!card) {
            card = await getCardByName(name);
            if (card) cardDataCache.set(name, card);
          }
          if (card) {
            newImages.set(name, getCardImageUrl(card, 'small'));
          }
        } catch {
          // skip failed fetches
        }
      }
      if (!cancelled) setCardImages(newImages);
    })();

    return () => { cancelled = true; };
  }, [expanded, combos]);

  const handleCardClick = useCallback(async (name: string) => {
    try {
      let card = cardDataCache.get(name);
      if (!card) {
        card = await getCardByName(name);
        if (card) cardDataCache.set(name, card);
      }
      if (card) setPreviewCard(card);
    } catch {
      // silently fail
    }
  }, []);

  if (combos.length === 0) return null;

  const completeCombos = combos.filter(c => c.isComplete);
  const nearMisses = combos.filter(c => !c.isComplete);

  const renderComboCard = (combo: DetectedCombo) => {
    const isComboExpanded = expandedCombo === combo.comboId;
    return (
      <div
        key={combo.comboId}
        className={`p-3 rounded-lg border ${
          combo.isComplete
            ? 'border-green-500/30 bg-green-500/5'
            : 'border-amber-500/30 bg-amber-500/5'
        }`}
      >
        {/* Title + metadata */}
        <div className="mb-2">
          {combo.isComplete ? (
            <span className="flex items-center gap-1 text-xs font-medium text-green-500 min-w-0">
              <Check className="w-3 h-3 shrink-0" />
              <span className="truncate">{combo.cards.join(' + ')}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs font-medium text-amber-500 min-w-0">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              <span className="truncate">{combo.cards.join(' + ')}</span>
            </span>
          )}
          <span className="text-[10px] text-muted-foreground mt-0.5 block">
            {combo.deckCount.toLocaleString()} decks · Bracket {combo.bracket}
          </span>
        </div>

        {/* Card images with + separators */}
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {combo.cards.map((name, i) => {
            const isMissing = combo.missingCards.includes(name);
            const imgUrl = cardImages.get(name);
            return (
              <Fragment key={name}>
                {i > 0 && (
                  <Plus className="w-3 h-3 text-muted-foreground shrink-0" />
                )}
                <button
                  onClick={() => handleCardClick(name)}
                  className={`relative rounded-md overflow-hidden transition-all cursor-pointer ${
                    isMissing ? 'opacity-50 ring-1 ring-amber-500/60' : 'hover:scale-105'
                  }`}
                  title={name}
                  style={{ width: 72 }}
                >
                  {imgUrl ? (
                    <img
                      src={imgUrl}
                      alt={name}
                      className="w-full rounded-md"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full aspect-[488/680] rounded-md bg-accent/30 flex items-center justify-center">
                      <span className="text-[9px] text-muted-foreground text-center px-1 leading-tight">{name}</span>
                    </div>
                  )}
                  {isMissing && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 rounded-md">
                      <span className="text-[9px] font-bold text-amber-400">MISSING</span>
                      {collectionNames?.has(name) && (
                        <span className="flex items-center gap-0.5 text-[8px] font-semibold text-emerald-400 mt-0.5">
                          <Package className="w-2.5 h-2.5" />
                          OWNED
                        </span>
                      )}
                    </div>
                  )}
                </button>
              </Fragment>
            );
          })}
        </div>

        {/* Expandable results */}
        {combo.results.length > 0 && (
          <button
            onClick={() => setExpandedCombo(isComboExpanded ? null : combo.comboId)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${isComboExpanded ? 'rotate-180' : ''}`} />
            {isComboExpanded ? 'Hide details' : 'Show details'}
          </button>
        )}
        {isComboExpanded && combo.results.length > 0 && (
          <p className="text-[11px] text-muted-foreground leading-relaxed mt-1.5 whitespace-pre-wrap">
            {combo.results.join('\n')}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="mt-6 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm">
      <button
        onClick={() => {
          const willExpand = !expanded;
          setExpanded(willExpand);
          if (willExpand && !hasTrackedView) {
            setHasTrackedView(true);
            trackEvent('combos_viewed', {
              commanderName: commander?.name ?? 'unknown',
              comboCount: combos.length,
            });
          }
        }}
        className="flex items-center gap-2 w-full text-left p-4"
      >
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">Combos in Your Deck</h3>
        <span className="text-xs text-muted-foreground ml-auto">
          {completeCombos.length} complete{nearMisses.length > 0 ? ` · ${nearMisses.length} near-miss` : ''}
        </span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <div className={`overflow-hidden transition-all duration-300 ${expanded ? 'px-4 pb-4 max-h-[8000px] opacity-100' : 'max-h-0 opacity-0'}`}>
        {/* Complete combos */}
        {completeCombos.length > 0 && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {completeCombos.map(combo => renderComboCard(combo))}
          </div>
        )}

        {/* Near-misses */}
        {nearMisses.length > 0 && (
          <>
            {completeCombos.length > 0 && (
              <div className="flex items-center gap-2 mt-4 mb-3">
                <span className="text-xs font-medium text-muted-foreground">Near-Misses</span>
                <div className="flex-1 border-t border-border/30" />
              </div>
            )}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(showAllNearMisses ? nearMisses : nearMisses.slice(0, 10)).map(combo => renderComboCard(combo))}
            </div>
            {nearMisses.length > 10 && !showAllNearMisses && (
              <button
                onClick={() => setShowAllNearMisses(true)}
                className="mt-3 w-full py-2 text-xs font-medium text-muted-foreground hover:text-foreground border border-border/30 rounded-lg hover:bg-accent/20 transition-colors"
              >
                Show {nearMisses.length - 10} more near-miss combo{nearMisses.length - 10 > 1 ? 's' : ''}
              </button>
            )}
          </>
        )}
      </div>

      <CardPreviewModal card={previewCard} onClose={() => setPreviewCard(null)} />
    </div>
  );
}
