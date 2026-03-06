import { useState, useCallback, useEffect, useMemo, Fragment } from 'react';
import type { DetectedCombo, ScryfallCard } from '@/types';
import { getCardByName, getCardImageUrl } from '@/services/scryfall/client';
import { getCollectionNameSet } from '@/services/collection/db';
import { fetchComboDetails, type ComboDetails } from '@/services/edhrec/client';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { ManaText } from '@/components/ui/mtg-icons';
import { Sparkles, Check, AlertTriangle, ChevronDown, Plus, Package, Ban, Pin, X, ListChecks, Footprints, Infinity, Loader2 } from 'lucide-react';
import { trackEvent } from '@/services/analytics';
import { useStore } from '@/store';
import { createPortal } from 'react-dom';

interface ComboDisplayProps {
  combos: DetectedCombo[];
  /** When true, hide must-include badges and controls (read-only list deck view) */
  hideMustInclude?: boolean;
  /** Callback to trigger immediate regeneration */
  onRegenerate?: () => void;
}

// Cache fetched card data across renders
const cardDataCache = new Map<string, ScryfallCard>();

export function ComboDisplay({ combos, hideMustInclude, onRegenerate }: ComboDisplayProps) {
  const commander = useStore(s => s.commander);
  const bannedCards = useStore(s => s.customization.bannedCards);
  const mustIncludeCards = useStore(s => s.customization.mustIncludeCards);
  const tempMustIncludeCards = useStore(s => s.customization.tempMustIncludeCards ?? []);
  const updateCustomization = useStore(s => s.updateCustomization);
  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);
  const [previewCardName, setPreviewCardName] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [hasTrackedView, setHasTrackedView] = useState(false);
  const [expandedCombo, setExpandedCombo] = useState<string | null>(null);
  const [comboDetails, setComboDetails] = useState<Map<string, ComboDetails | 'loading' | 'error'>>(new Map());
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

  const tempBannedCards = useStore(s => s.customization.tempBannedCards ?? []);

  const handleAddMustInclude = useCallback((name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (mustIncludeCards.includes(name) || tempMustIncludeCards.includes(name)) return;
    // Remove from temp banned if it was previously removed via edit mode
    const newTempBanned = tempBannedCards.filter(n => n !== name);
    updateCustomization({
      tempMustIncludeCards: [...tempMustIncludeCards, name],
      ...(newTempBanned.length !== tempBannedCards.length ? { tempBannedCards: newTempBanned } : {}),
    });
    trackEvent('must_include_added', { commanderName: commander?.name ?? 'unknown', cardName: name, source: 'combo' });
    setToastMessage(`Adding "${name}" to deck...`);
    onRegenerate?.();
  }, [mustIncludeCards, tempMustIncludeCards, tempBannedCards, updateCustomization, commander, onRegenerate]);

  const handleRemoveMustInclude = useCallback((name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tempMustIncludeCards.includes(name)) {
      updateCustomization({ tempMustIncludeCards: tempMustIncludeCards.filter(n => n !== name) });
    } else {
      updateCustomization({ mustIncludeCards: mustIncludeCards.filter(n => n !== name) });
    }
    setToastMessage(`Removed "${name}" from Must Include`);
  }, [mustIncludeCards, tempMustIncludeCards, updateCustomization]);

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
                <div
                  onClick={() => handleCardClick(name)}
                  className={`relative rounded-md overflow-hidden transition-all cursor-pointer active:scale-90 ${
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
                    !hideMustInclude && (mustIncludeCards.includes(name) || tempMustIncludeCards.includes(name)) ? (
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
                      <div className={`absolute inset-0 flex flex-col items-center justify-center bg-black/40 rounded-md ${hideMustInclude ? '' : 'group/owned'}`}>
                        <span className="flex items-center gap-0.5 text-[8px] font-semibold text-emerald-400 group-hover/owned:hidden">
                          <Package className="w-2.5 h-2.5" />
                          OWNED
                        </span>
                        {!hideMustInclude && (
                          <button
                            onClick={(e) => handleAddMustInclude(name, e)}
                            className="hidden group-hover/owned:flex items-center gap-0.5 px-1.5 py-1 rounded bg-emerald-600/90 hover:bg-emerald-500 text-white text-[8px] font-semibold transition-colors"
                            title="Add to deck"
                          >
                            <Plus className="w-2.5 h-2.5" />
                            Add to Deck
                          </button>
                        )}
                      </div>
                    )
                  ) : isMissing ? (
                    !hideMustInclude && (mustIncludeCards.includes(name) || tempMustIncludeCards.includes(name)) ? (
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
                      <div className={`absolute inset-0 flex flex-col items-center justify-center bg-black/40 rounded-md ${hideMustInclude ? '' : 'group/missing'}`}>
                        <span className="flex items-center justify-center text-[9px] font-bold text-amber-400 group-hover/missing:hidden">MISSING</span>
                        {!hideMustInclude && (
                          <button
                            onClick={(e) => handleAddMustInclude(name, e)}
                            className="hidden group-hover/missing:flex items-center gap-0.5 px-1.5 py-1 rounded bg-emerald-600/90 hover:bg-emerald-500 text-white text-[8px] font-semibold transition-colors"
                            title="Add to deck"
                          >
                            <Plus className="w-2.5 h-2.5" />
                            Add to Deck
                          </button>
                        )}
                      </div>
                    )
                  ) : !hideMustInclude && (mustIncludeCards.includes(name) || tempMustIncludeCards.includes(name)) ? (
                    <div className="absolute bottom-1 left-1">
                      <span className="bg-emerald-500/80 text-white rounded-full w-4 h-4 flex items-center justify-center" title="Must Include">
                        <Pin className="w-2.5 h-2.5" />
                      </span>
                    </div>
                  ) : null}
                </div>
              </Fragment>
            );
          })}
        </div>

        {/* Expandable details */}
        <button
          onClick={() => {
            const willExpand = expandedCombo !== combo.comboId;
            setExpandedCombo(willExpand ? combo.comboId : null);
            if (willExpand && !comboDetails.has(combo.comboId)) {
              setComboDetails(prev => new Map(prev).set(combo.comboId, 'loading'));
              fetchComboDetails(combo.comboId)
                .then(details => setComboDetails(prev => new Map(prev).set(combo.comboId, details)))
                .catch(() => setComboDetails(prev => new Map(prev).set(combo.comboId, 'error')));
            }
          }}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown className={`w-3 h-3 transition-transform ${isComboExpanded ? 'rotate-180' : ''}`} />
          {isComboExpanded ? 'Hide details' : 'Show details'}
        </button>
        {isComboExpanded && (() => {
          const details = comboDetails.get(combo.comboId);
          if (details === 'loading') {
            return (
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading combo details...
              </div>
            );
          }
          if (details && details !== 'error') {
            return (
              <div className="space-y-2.5 mt-2">
                {/* Prerequisites */}
                {details.prerequisites.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      <ListChecks className="w-3 h-3" />
                      Prerequisites
                    </div>
                    <div className="space-y-0.5 pl-4">
                      {details.prerequisites.map((prereq, idx) => (
                        <div key={idx} className="text-[11px] text-muted-foreground leading-snug flex gap-1">
                          <span className="shrink-0 opacity-50">•</span>
                          <ManaText text={prereq} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Steps */}
                <div>
                  <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    <Footprints className="w-3 h-3" />
                    Steps
                  </div>
                  <div className="space-y-0.5 pl-4">
                    {details.steps.map((step, idx) => (
                      <div key={idx} className="text-[11px] text-muted-foreground leading-snug flex gap-1.5">
                        <span className="shrink-0 w-3.5 h-3.5 rounded-full bg-muted flex items-center justify-center text-[9px] font-bold mt-0.5">
                          {idx + 1}
                        </span>
                        <ManaText text={step} />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Results */}
                <div>
                  <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    <Infinity className="w-3 h-3" />
                    Results
                  </div>
                  <div className="space-y-0.5 pl-4">
                    {details.results.map((result, idx) => (
                      <div key={idx} className="text-[11px] text-muted-foreground leading-snug flex gap-1">
                        <span className="shrink-0 opacity-50">∞</span>
                        {result}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          }
          // Error or no details — fall back to existing results text
          return combo.results.length > 0 ? (
            <p className="text-[11px] text-muted-foreground leading-relaxed mt-1.5 whitespace-pre-wrap">
              {combo.results.join('\n')}
            </p>
          ) : null;
        })()}
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
        hideMustInclude={hideMustInclude}
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
