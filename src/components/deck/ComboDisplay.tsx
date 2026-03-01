import { useState, useCallback, useEffect, useMemo, Fragment } from 'react';
import type { DetectedCombo, ScryfallCard } from '@/types';
import { getCardByName, getCardImageUrl } from '@/services/scryfall/client';
import { getCollectionNameSet } from '@/services/collection/db';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { Sparkles, Check, AlertTriangle, ChevronDown, Plus, Package, Ban, Pin, X } from 'lucide-react';
import { trackEvent } from '@/services/analytics';
import { useStore } from '@/store';
import { createPortal } from 'react-dom';

interface ComboDisplayProps {
  combos: DetectedCombo[];
}

// Cache fetched card data across renders
const cardDataCache = new Map<string, ScryfallCard>();

export function ComboDisplay({ combos }: ComboDisplayProps) {
  const commander = useStore(s => s.commander);
  const bannedCards = useStore(s => s.customization.bannedCards);
  const mustIncludeCards = useStore(s => s.customization.mustIncludeCards);
  const updateCustomization = useStore(s => s.updateCustomization);
  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);
  const [previewCardName, setPreviewCardName] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [hasTrackedView, setHasTrackedView] = useState(false);
  const [expandedCombo, setExpandedCombo] = useState<string | null>(null);
  const [showAllNearMisses, setShowAllNearMisses] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
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
      if (card) {
        setPreviewCardName(name.includes(' // ') ? name.split(' // ')[0] : name);
        setPreviewCard(card);
      }
    } catch {
      // silently fail
    }
  }, []);

  const handleAddMustInclude = useCallback((name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (mustIncludeCards.includes(name)) return;
    updateCustomization({ mustIncludeCards: [...mustIncludeCards, name] });
    setToastMessage(`Added "${name}" to Must Include — regenerate to see changes`);
  }, [mustIncludeCards, updateCustomization]);

  const handleRemoveMustInclude = useCallback((name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    updateCustomization({ mustIncludeCards: mustIncludeCards.filter(n => n !== name) });
    setToastMessage(`Removed "${name}" from Must Include`);
  }, [mustIncludeCards, updateCustomization]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Build a map of card name → combos involving that card (for preview modal navigation)
  const cardComboMap = useMemo(() => {
    const map = new Map<string, DetectedCombo[]>();
    for (const combo of combos) {
      for (const name of combo.cards) {
        const frontName = name.includes(' // ') ? name.split(' // ')[0] : name;
        const existing = map.get(frontName);
        if (existing) existing.push(combo);
        else map.set(frontName, [combo]);
      }
    }
    return map;
  }, [combos]);

  if (combos.length === 0) return null;

  const bannedSet = new Set(bannedCards.map(n => n.toLowerCase()));
  const hasExcludedCard = (combo: DetectedCombo) => combo.cards.some(n => bannedSet.has(n.toLowerCase()));

  const completeCombos = combos.filter(c => c.isComplete && !hasExcludedCard(c));
  const nearMisses = combos.filter(c => !c.isComplete && !hasExcludedCard(c));
  const excludedCombos = combos.filter(c => hasExcludedCard(c));

  const renderComboCard = (combo: DetectedCombo, isExcluded = false) => {
    const isComboExpanded = expandedCombo === combo.comboId;
    return (
      <div
        key={combo.comboId}
        className={`p-3 rounded-lg border overflow-hidden ${
          isExcluded
            ? 'border-red-500/20 bg-red-500/5'
            : combo.isComplete
              ? 'border-green-500/30 bg-green-500/5'
              : 'border-amber-500/30 bg-amber-500/5'
        }`}
      >
        {/* Title + metadata */}
        <div className="mb-2 min-w-0">
          {isExcluded ? (
            <span className="flex items-center gap-1 text-xs font-medium text-red-400 min-w-0">
              <Ban className="w-3 h-3 shrink-0" />
              <span className="truncate">{combo.cards.join(' + ')}</span>
            </span>
          ) : combo.isComplete ? (
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
            const isBanned = bannedSet.has(name.toLowerCase());
            const imgUrl = cardImages.get(name);
            return (
              <Fragment key={name}>
                {i > 0 && (
                  <Plus className="w-3 h-3 text-muted-foreground shrink-0" />
                )}
                <button
                  onClick={() => handleCardClick(name)}
                  className={`relative rounded-md overflow-hidden transition-all cursor-pointer ${
                    isBanned ? 'opacity-50 ring-1 ring-red-500/60'
                    : isMissing && collectionNames?.has(name) ? 'opacity-50 ring-1 ring-emerald-500/60'
                    : isMissing ? 'opacity-50 ring-1 ring-amber-500/60'
                    : 'hover:scale-105'
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
                  {isBanned ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 rounded-md">
                      <span className="text-[9px] font-bold text-red-400">EXCLUDED</span>
                    </div>
                  ) : isMissing && collectionNames?.has(name) ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-md">
                      <span className="flex items-center gap-0.5 text-[8px] font-semibold text-emerald-400">
                        <Package className="w-2.5 h-2.5" />
                        OWNED
                      </span>
                    </div>
                  ) : isMissing ? (
                    mustIncludeCards.includes(name) ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 rounded-md group/added">
                        <span className="flex items-center gap-0.5 text-[8px] font-semibold text-emerald-400 group-hover/added:hidden">
                          <Pin className="w-2.5 h-2.5" />
                          Added
                        </span>
                        <button
                          onClick={(e) => handleRemoveMustInclude(name, e)}
                          className="hidden group-hover/added:flex items-center gap-0.5 px-1.5 py-1 rounded bg-red-600/90 hover:bg-red-500 text-white text-[8px] font-semibold transition-colors"
                          title="Remove from Must Include list"
                        >
                          <X className="w-2.5 h-2.5" />
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-end justify-end bg-black/40 rounded-md group/missing">
                        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-amber-400 group-hover/missing:hidden">MISSING</span>
                        <button
                          onClick={(e) => handleAddMustInclude(name, e)}
                          className="hidden group-hover/missing:flex items-center gap-0.5 m-1 px-1.5 py-1 rounded bg-emerald-600/90 hover:bg-emerald-500 text-white text-[8px] font-semibold transition-colors"
                          title="Add to Must Include list"
                        >
                          <Pin className="w-2.5 h-2.5" />
                          Must Include
                        </button>
                      </div>
                    )
                  ) : mustIncludeCards.includes(name) ? (
                    <div className="absolute bottom-1 left-1">
                      <span className="bg-emerald-500/80 text-white rounded-full w-4 h-4 flex items-center justify-center" title="Must Include">
                        <Pin className="w-2.5 h-2.5" />
                      </span>
                    </div>
                  ) : null}
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
    <div className="mt-6 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
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
        <Sparkles className="w-4 h-4 text-primary shrink-0" />
        <h3 className="text-sm font-semibold truncate">Combos in Your Deck</h3>
        <span className="text-xs text-muted-foreground ml-auto shrink-0 whitespace-nowrap">
          {completeCombos.length} complete{nearMisses.length > 0 ? ` · ${nearMisses.length} near-miss` : ''}{excludedCombos.length > 0 ? ` · ${excludedCombos.length} excluded` : ''}
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

        {/* Excluded combos */}
        {excludedCombos.length > 0 && (
          <>
            <button
              onClick={() => setShowExcluded(!showExcluded)}
              className="flex items-center gap-2 mt-4 mb-3 w-full group"
            >
              <span className="text-xs font-medium text-muted-foreground">
                Excluded ({excludedCombos.length})
              </span>
              <div className="flex-1 border-t border-border/30" />
              <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform group-hover:text-foreground ${showExcluded ? 'rotate-180' : ''}`} />
            </button>
            {showExcluded && (
              <>
                <p className="text-[11px] text-muted-foreground mb-2">
                  These combos involve cards on your exclude list.
                </p>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {excludedCombos.map(combo => renderComboCard(combo, true))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <CardPreviewModal
        card={previewCard}
        onClose={() => { setPreviewCard(null); setPreviewCardName(null); }}
        combos={previewCardName ? cardComboMap.get(previewCardName) : undefined}
        cardComboMap={cardComboMap}
      />
      {toastMessage && createPortal(
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 bg-emerald-600/90 text-white text-sm rounded-lg shadow-lg animate-fade-in max-w-sm flex items-center gap-2">
          <Pin className="w-4 h-4 shrink-0" />
          {toastMessage}
        </div>,
        document.body
      )}
    </div>
  );
}
