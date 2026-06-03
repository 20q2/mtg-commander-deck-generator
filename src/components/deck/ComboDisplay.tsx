import { useState, useCallback, useEffect, useMemo, useRef, Fragment } from 'react';
import type { DetectedCombo, ScryfallCard } from '@/types';
import { getCardByName, getCardsByNames, getCardImageUrl } from '@/services/scryfall/client';
import { getCollectionNameSet } from '@/services/collection/db';
import { fetchComboDetails, type ComboDetails } from '@/services/edhrec/client';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import { ManaText } from '@/components/ui/mtg-icons';
import { Sparkles, Check, AlertTriangle, ChevronDown, Plus, Package, Ban, Pin, X, ListChecks, Footprints, Infinity, Loader2, Crown } from 'lucide-react';
import { trackEvent } from '@/services/analytics';
import { useStore } from '@/store';
import { useUserLists } from '@/hooks/useUserLists';
import { createPortal } from 'react-dom';

interface ComboDisplayProps {
  combos: DetectedCombo[];
  /** When true, hide must-include badges and controls (read-only list deck view) */
  hideMustInclude?: boolean;
  /** Callback to trigger immediate regeneration */
  onRegenerate?: () => void;
  /** List deck view callbacks */
  onAddToDeck?: (cardNames: string[]) => void;
  onRemoveFromDeck?: (cardNames: string[]) => void;
  onMoveToSideboard?: (cardNames: string[]) => void;
  onMoveToMaybeboard?: (cardNames: string[]) => void;
  /** When true, the panel starts expanded and cannot be collapsed (Inspector usage). */
  forceExpanded?: boolean;
}

// Cache fetched card data across renders
const cardDataCache = new Map<string, ScryfallCard>();

// EDHREC prereqs often include trivial card-location statements like
// "X and Y on the battlefield." that just restate where the combo cards belong.
// Strip the combo card names + obvious filler from each prereq; if nothing
// substantive is left, treat it as trivial and drop it. What survives is the
// stuff worth showing up front — e.g. "You control at least three Foods."
const TRIVIAL_WORDS = new Set([
  'on', 'the', 'battlefield', 'and', 'or', 'in', 'your', 'graveyard', 'library',
  'hand', 'exile', 'command', 'zone', 'have', 'a', 'an', 'is', 'are', 'this',
  'that', 'these', 'those', 'with', 'control', 'controlled', 'controls',
  // Generic "everything" words — "all permanents on the battlefield" is a
  // no-op prereq (permanents are by definition on the battlefield).
  'all', 'any', 'each', 'every', 'some', 'permanent', 'permanents',
  'card', 'cards', 'you', 'to',
  // Card-state words — "X doesn't have summoning sickness" / "X is untapped"
  // are assumed operational conditions of a combo with cards already in play.
  'does', 'not', 'no', 'doesnt', 'summoning', 'sickness',
  'tapped', 'untapped', 'haste', 'has', 'be', 'can', 'cant',
]);
function extractMeaningfulPrereqs(prereqs: string[], cardNames: string[]): string[] {
  // Build the list of strings to strip from each prereq: full card names AND
  // individual significant words from each name. Card names often include commas
  // or titles ("Mikaeus, the Unhallowed"), and prereqs may refer to just one piece
  // ("Mikaeus and Devoted Druid"). We need to strip both.
  const fragments: string[] = [];
  for (const name of cardNames) {
    const front = name.includes(' // ') ? name.split(' // ')[0] : name;
    fragments.push(front);
    for (const piece of front.split(/[^a-zA-Z]+/)) {
      if (piece.length >= 3 && !TRIVIAL_WORDS.has(piece.toLowerCase())) {
        fragments.push(piece);
      }
    }
  }
  // Strip longer fragments first so the full-name match wins over individual words.
  fragments.sort((a, b) => b.length - a.length);

  return prereqs.filter(p => {
    let stripped = p;
    for (const frag of fragments) {
      const escaped = frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      stripped = stripped.replace(new RegExp('\\b' + escaped + '\\b', 'gi'), '');
    }
    const normalized = stripped.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
    const words = normalized.split(/\s+/).filter(w => w && !TRIVIAL_WORDS.has(w));
    return words.length > 0;
  });
}

export function ComboDisplay({ combos, hideMustInclude, onRegenerate, onAddToDeck, onRemoveFromDeck, onMoveToSideboard, onMoveToMaybeboard, forceExpanded }: ComboDisplayProps) {
  const commander = useStore(s => s.commander);
  const bannedCards = useStore(s => s.customization.bannedCards);
  const mustIncludeCards = useStore(s => s.customization.mustIncludeCards);
  const tempMustIncludeCards = useStore(s => s.customization.tempMustIncludeCards ?? []);
  const updateCustomization = useStore(s => s.updateCustomization);
  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);
  const [previewCardName, setPreviewCardName] = useState<string | null>(null);
  const [expandedState, setExpanded] = useState(false);
  const expanded = forceExpanded || expandedState;
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [hasTrackedView, setHasTrackedView] = useState(false);
  const [expandedCombo, setExpandedCombo] = useState<string | null>(null);
  const [comboDetails, setComboDetails] = useState<Map<string, ComboDetails | 'loading' | 'error'>>(new Map());
  const [showAllNearMisses, setShowAllNearMisses] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const [comboSort, setComboSort] = useState<'popularity' | 'relevance' | 'source'>('relevance');
  const [showSynergy, setShowSynergy] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('combos.showSynergy') !== 'false';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('combos.showSynergy', String(showSynergy));
  }, [showSynergy]);
  // Source sort is meaningless without synergy combos — fall back to relevance.
  useEffect(() => {
    if (!showSynergy && comboSort === 'source') setComboSort('relevance');
  }, [showSynergy, comboSort]);
  const [cardFilter, setCardFilter] = useState<string | null>(null);
  const [cardImages, setCardImages] = useState<Map<string, string>>(new Map());
  const [collectionNames, setCollectionNames] = useState<Set<string> | null>(null);
  const [contextMenuCard, setContextMenuCard] = useState<string | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const { lists: userLists, updateList, createList } = useUserLists();

  // When right-click sets contextMenuCard, click the trigger button after render
  useEffect(() => {
    if (!contextMenuCard || !contextMenuRef.current) return;
    const el = contextMenuRef.current.querySelector<HTMLButtonElement>('[data-combo-menu-trigger] button');
    el?.click();
  }, [contextMenuCard]);

  // Load collection names when expanded
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    getCollectionNameSet().then(names => {
      if (!cancelled && names.size > 0) setCollectionNames(names);
    });
    return () => { cancelled = true; };
  }, [expanded]);

  // Background-prefetch combo details for visible combos so we can show
  // non-trivial prerequisites (e.g. "three Foods") as chips alongside cards
  // without making the user click "Show details".
  useEffect(() => {
    if (!expanded) return;
    for (const combo of combos) {
      if (comboDetails.has(combo.comboId)) continue;
      setComboDetails(prev => {
        if (prev.has(combo.comboId)) return prev;
        return new Map(prev).set(combo.comboId, 'loading');
      });
      fetchComboDetails(combo.comboId)
        .then(details => setComboDetails(prev => new Map(prev).set(combo.comboId, details)))
        .catch(() => setComboDetails(prev => new Map(prev).set(combo.comboId, 'error')));
    }
    // We intentionally don't include comboDetails in the deps — it's read
    // through state-setter callbacks to avoid re-running on every update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, combos]);

  // Fetch card images when expanded (bulk batch via /cards/collection)
  useEffect(() => {
    if (!expanded) return;

    const allNames = [...new Set(combos.flatMap(c => c.cards))];
    const missing = allNames.filter(n => !cardImages.has(n) && !cardDataCache.has(n));
    // Build images from already-cached cards first
    const newImages = new Map(cardImages);
    for (const name of allNames) {
      if (newImages.has(name)) continue;
      const cached = cardDataCache.get(name);
      if (cached) newImages.set(name, getCardImageUrl(cached, 'small'));
    }
    if (missing.length === 0) {
      if (newImages.size !== cardImages.size) setCardImages(newImages);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const cardMap = await getCardsByNames(missing);
        if (cancelled) return;
        for (const [name, card] of cardMap) {
          cardDataCache.set(name, card);
          newImages.set(name, getCardImageUrl(card, 'small'));
        }
      } catch {
        // skip failed bulk fetch
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
    // Inspector / list-deck context: add directly to the deck rather than
    // touching must-include + triggering a regen (regen doesn't run there).
    if (onAddToDeck) {
      onAddToDeck([name]);
      setToastMessage(`Added "${name}" to deck`);
      return;
    }
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
  }, [onAddToDeck, mustIncludeCards, tempMustIncludeCards, tempBannedCards, updateCustomization, commander, onRegenerate]);

  const handleRemoveMustInclude = useCallback((name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tempMustIncludeCards.includes(name)) {
      updateCustomization({ tempMustIncludeCards: tempMustIncludeCards.filter(n => n !== name) });
    } else {
      updateCustomization({ mustIncludeCards: mustIncludeCards.filter(n => n !== name) });
    }
    setToastMessage(`Removed "${name}" from Must Include`);
  }, [mustIncludeCards, tempMustIncludeCards, updateCustomization]);

  const handleComboCardAction = useCallback((card: ScryfallCard, action: CardAction) => {
    const name = card.name;
    switch (action.type) {
      case 'remove':
        onRemoveFromDeck?.([name]);
        setToastMessage(`Removed "${name}" from deck`);
        break;
      case 'addToDeck':
        onAddToDeck?.([name]);
        setToastMessage(`Added "${name}" to deck`);
        break;
      case 'sideboard':
        onMoveToSideboard?.([name]);
        setToastMessage(`Moved "${name}" to sideboard`);
        break;
      case 'maybeboard':
        onMoveToMaybeboard?.([name]);
        setToastMessage(`Moved "${name}" to maybeboard`);
        break;
      case 'mustInclude': {
        const current = mustIncludeCards;
        const has = current.includes(name);
        updateCustomization({ mustIncludeCards: has ? current.filter(n => n !== name) : [...current, name] });
        setToastMessage(has ? `Removed "${name}" from Must Include` : `Added "${name}" to Must Include`);
        break;
      }
      case 'exclude':
        updateCustomization({ bannedCards: [...bannedCards, name] });
        setToastMessage(`Excluded "${name}"`);
        break;
      case 'addToList': {
        const list = userLists.find(l => l.id === action.listId);
        if (list && !list.cards.includes(name)) {
          updateList(action.listId, { cards: [...list.cards, name] });
          setToastMessage(`Added "${name}" to "${list.name}"`);
        }
        break;
      }
      case 'createListAndAdd': {
        createList(action.listName, [name]);
        setToastMessage(`Created "${action.listName}" with "${name}"`);
        break;
      }
    }
  }, [mustIncludeCards, bannedCards, updateCustomization, userLists, updateList, createList, onAddToDeck, onRemoveFromDeck, onMoveToSideboard, onMoveToMaybeboard]);

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

  // Apply the user's "show synergy combos" toggle before any other filtering.
  const visibleCombos = showSynergy ? combos : combos.filter(c => c.source !== 'color-identity');
  const hiddenSynergyCount = combos.length - visibleCombos.length;

  const bannedSet = new Set(bannedCards.map(n => n.toLowerCase()));
  const hasExcludedCard = (combo: DetectedCombo) => combo.cards.some(n => bannedSet.has(n.toLowerCase()));

  // Sort by completeness first (complete combos before near-misses), then deckCount.
  // Used for grouping within a source section in 'source' sort mode.
  const sortByCompletenessThenPopularity = (list: DetectedCombo[]) =>
    [...list].sort((a, b) => {
      if (a.isComplete !== b.isComplete) return a.isComplete ? -1 : 1;
      return b.deckCount - a.deckCount;
    });

  const sortCombos = (list: DetectedCombo[]) => {
    if (comboSort === 'relevance') {
      return [...list].sort((a, b) => {
        const aMissing = a.missingCards.length;
        const bMissing = b.missingCards.length;
        if (aMissing !== bMissing) return aMissing - bMissing;
        return b.deckCount - a.deckCount;
      });
    }
    return [...list].sort((a, b) => b.deckCount - a.deckCount);
  };

  const matchesCardFilter = (combo: DetectedCombo) =>
    !cardFilter || combo.cards.some(n => (n.includes(' // ') ? n.split(' // ')[0] : n) === cardFilter);

  const completeCombos = sortCombos(visibleCombos.filter(c => c.isComplete && !hasExcludedCard(c) && matchesCardFilter(c)));
  const nearMisses = sortCombos(visibleCombos.filter(c => !c.isComplete && !hasExcludedCard(c) && matchesCardFilter(c)));
  const excludedCombos = visibleCombos.filter(c => hasExcludedCard(c) && matchesCardFilter(c));

  // For source-sort view: split everything visible by source, each pre-sorted by completeness.
  const commanderSourceCombos = sortByCompletenessThenPopularity(
    visibleCombos.filter(c => c.source === 'commander' && !hasExcludedCard(c) && matchesCardFilter(c)),
  );
  const synergySourceCombos = sortByCompletenessThenPopularity(
    visibleCombos.filter(c => c.source === 'color-identity' && !hasExcludedCard(c) && matchesCardFilter(c)),
  );

  const toggleCardFilter = (name: string) => {
    const front = name.includes(' // ') ? name.split(' // ')[0] : name;
    setCardFilter(prev => (prev === front ? null : front));
  };

  const renderComboCard = (combo: DetectedCombo, isExcluded = false) => {
    const isComboExpanded = expandedCombo === combo.comboId;
    return (
      <div
        key={combo.comboId}
        className={`relative p-3 rounded-lg border overflow-hidden ${
          isExcluded
            ? 'border-red-500/20 bg-red-500/5'
            : combo.isComplete
              ? 'border-green-500/30 bg-green-500/5'
              : 'border-amber-500/30 bg-amber-500/5'
        }`}
      >
        {/* Source badge — only synergy combos get a visual marker; commander combos are the default. */}
        {combo.source === 'color-identity' && (
          <span
            className="absolute top-2 right-2 inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium text-violet-300/80 bg-violet-500/10 border border-violet-500/20"
            title="Not from this commander's typical builds — emerged from your deck's color identity."
          >
            <Sparkles className="w-2.5 h-2.5" />
            Synergy
          </span>
        )}

        {/* Title + metadata */}
        <div className={`mb-2 min-w-0 ${combo.source === 'color-identity' ? 'pr-20' : ''}`}>
          {(() => {
            const tone = isExcluded ? 'text-red-400' : combo.isComplete ? 'text-green-500' : 'text-amber-500';
            const Icon = isExcluded ? Ban : combo.isComplete ? Check : AlertTriangle;
            return (
              <span className={`flex items-start gap-1 text-xs font-medium min-w-0 ${tone}`}>
                <Icon className="w-3 h-3 shrink-0 mt-0.5" />
                <span className="break-words">
                  {combo.cards.map((n, i) => {
                    const front = n.includes(' // ') ? n.split(' // ')[0] : n;
                    const isActive = cardFilter === front;
                    const comboCount = cardComboMap.get(front)?.length ?? 0;
                    const filterable = comboCount > 1;
                    return (
                      <Fragment key={n}>
                        {i > 0 && <span className="text-muted-foreground/70 mx-0.5">+</span>}
                        {filterable ? (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleCardFilter(n); }}
                            className={`underline-offset-2 hover:underline hover:text-foreground transition-colors ${isActive ? 'underline text-foreground' : ''}`}
                            title={isActive ? `Clear filter (${front})` : `Filter combos by ${front} (${comboCount} combos)`}
                          >
                            {front}
                          </button>
                        ) : (
                          <span title={`${front} appears in only this combo`}>{front}</span>
                        )}
                      </Fragment>
                    );
                  })}
                </span>
              </span>
            );
          })()}
          <span className="text-[10px] text-muted-foreground mt-0.5 block">
            {combo.deckCount.toLocaleString()} decks · Bracket {combo.bracket}
          </span>
        </div>

        {/* Card images with + separators */}
        <div className="flex flex-wrap items-start gap-1.5 mb-2">
          {combo.cards.map((name, i) => {
            const isMissing = combo.missingCards.includes(name);
            const isBanned = bannedSet.has(name.toLowerCase());
            const imgUrl = cardImages.get(name);
            const frontName = name.includes(' // ') ? name.split(' // ')[0] : name;
            const cardComboCount = cardComboMap.get(frontName)?.length ?? 0;
            return (
              <Fragment key={name}>
                {i > 0 && (
                  <Plus className="w-3 h-3 text-muted-foreground shrink-0 mt-10" />
                )}
                <div
                  className="group/combo relative flex flex-col gap-1"
                  style={{ width: 72 }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    contextMenuRef.current = e.currentTarget as HTMLDivElement;
                    if (cardDataCache.has(name)) {
                      setContextMenuCard(name);
                    } else {
                      getCardByName(name).then(card => {
                        if (card) {
                          cardDataCache.set(name, card);
                          setContextMenuCard(name);
                        }
                      });
                    }
                  }}
                >
                <div
                  onClick={() => handleCardClick(name)}
                  className={`relative rounded-md overflow-hidden transition-all cursor-pointer active:scale-90 ${
                    isBanned ? 'opacity-50 ring-1 ring-red-500/60'
                    : isMissing && collectionNames?.has(name) ? 'opacity-50 ring-1 ring-emerald-500/60'
                    : isMissing ? 'opacity-50 ring-1 ring-amber-500/60'
                    : 'hover:scale-105'
                  }`}
                  title={name}
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
                </div>
                {isBanned ? (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 rounded-md pointer-events-none">
                    <span className="text-[9px] font-bold text-red-400">EXCLUDED</span>
                  </div>
                ) : isMissing && collectionNames?.has(name) ? (
                  !hideMustInclude && (mustIncludeCards.includes(name) || tempMustIncludeCards.includes(name)) ? (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 rounded-md pointer-events-none">
                      <span className="flex items-center gap-0.5 text-[8px] font-semibold text-emerald-400 group-hover/combo:hidden">
                        <Pin className="w-2.5 h-2.5" />
                        Added
                      </span>
                      <button
                        onClick={(e) => handleRemoveMustInclude(name, e)}
                        className="hidden group-hover/combo:flex items-center gap-0.5 px-1.5 py-1 rounded bg-red-600/90 hover:bg-red-500 text-white text-[8px] font-semibold transition-colors pointer-events-auto"
                        title="Remove from Must Include list"
                      >
                        <X className="w-2.5 h-2.5" />
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 rounded-md pointer-events-none">
                      <span className={`flex items-center gap-0.5 text-[8px] font-semibold text-emerald-400 ${hideMustInclude && !onAddToDeck ? '' : 'group-hover/combo:hidden'}`}>
                        <Package className="w-2.5 h-2.5" />
                        OWNED
                      </span>
                      {(!hideMustInclude || !!onAddToDeck) && (
                        <button
                          onClick={(e) => handleAddMustInclude(name, e)}
                          className="hidden group-hover/combo:flex items-center gap-0.5 px-1.5 py-1 rounded bg-emerald-600/90 hover:bg-emerald-500 text-white text-[8px] font-semibold transition-colors pointer-events-auto"
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
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 rounded-md pointer-events-none">
                      <span className="flex items-center gap-0.5 text-[8px] font-semibold text-emerald-400 group-hover/combo:hidden">
                        <Pin className="w-2.5 h-2.5" />
                        Added
                      </span>
                      <button
                        onClick={(e) => handleRemoveMustInclude(name, e)}
                        className="hidden group-hover/combo:flex items-center gap-0.5 px-1.5 py-1 rounded bg-red-600/90 hover:bg-red-500 text-white text-[8px] font-semibold transition-colors pointer-events-auto"
                        title="Remove from Must Include list"
                      >
                        <X className="w-2.5 h-2.5" />
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 rounded-md pointer-events-none">
                      <span className={`flex items-center justify-center text-[9px] font-bold text-amber-400 ${hideMustInclude && !onAddToDeck ? '' : 'group-hover/combo:hidden'}`}>MISSING</span>
                      {(!hideMustInclude || !!onAddToDeck) && (
                        <button
                          onClick={(e) => handleAddMustInclude(name, e)}
                          className="hidden group-hover/combo:flex items-center gap-0.5 px-1.5 py-1 rounded bg-emerald-600/90 hover:bg-emerald-500 text-white text-[8px] font-semibold transition-colors pointer-events-auto"
                          title="Add to deck"
                        >
                          <Plus className="w-2.5 h-2.5" />
                          Add to Deck
                        </button>
                      )}
                    </div>
                  )
                ) : !hideMustInclude && (mustIncludeCards.includes(name) || tempMustIncludeCards.includes(name)) ? (
                  <div className="absolute bottom-1 left-1 z-10 pointer-events-none">
                    <span className="bg-emerald-500/80 text-white rounded-full w-4 h-4 flex items-center justify-center" title="Must Include">
                      <Pin className="w-2.5 h-2.5" />
                    </span>
                  </div>
                ) : null}
                  {cardComboCount > 1 && (
                    <span
                      className="absolute top-0.5 left-0.5 z-10 px-1 py-0.5 rounded bg-violet-500/90 text-white text-[9px] font-bold leading-none opacity-0 group-hover/combo:opacity-100 transition-opacity pointer-events-none"
                      title={`Part of ${cardComboCount} combos in this list`}
                    >
                      {cardComboCount}× combos
                    </span>
                  )}
                  {cardDataCache.has(name) && (
                    <span data-combo-menu-trigger className={`absolute top-0.5 right-0.5 z-10 transition-opacity ${contextMenuCard === name ? 'opacity-100' : 'opacity-0 group-hover/combo:opacity-100'}`}>
                      <CardContextMenu
                        card={cardDataCache.get(name)!}
                        onAction={handleComboCardAction}
                        hasRemove={!isMissing && !!onRemoveFromDeck}
                        hasAddToDeck={isMissing && !!onAddToDeck}
                        hasSideboard={!!onMoveToSideboard}
                        hasMaybeboard={!!onMoveToMaybeboard}
                        isMustInclude={mustIncludeCards.includes(name) || tempMustIncludeCards.includes(name)}
                        userLists={userLists}
                        onForceClose={() => setContextMenuCard(null)}
                      />
                    </span>
                  )}
                </div>
              </Fragment>
            );
          })}
          {(() => {
            // Render non-trivial prerequisites as chips after the card images so the
            // user can see at a glance what else the combo needs (e.g. "three Foods").
            const details = comboDetails.get(combo.comboId);
            if (!details || details === 'loading' || details === 'error') return null;
            const meaningful = extractMeaningfulPrereqs(details.prerequisites, combo.cards);
            if (meaningful.length === 0) return null;
            return meaningful.map((prereq, idx) => (
              <Fragment key={`prereq-${idx}`}>
                <Plus className="w-3 h-3 text-muted-foreground shrink-0" />
                <div
                  className="rounded-md border border-zinc-500/30 bg-zinc-500/10 px-2 py-1 flex items-center justify-center"
                  style={{ width: 72, minHeight: 100 }}
                  title={prereq}
                >
                  <span className="text-[10px] text-zinc-200/90 leading-tight text-center break-words">
                    <ManaText text={prereq.replace(/\.$/, '')} />
                  </span>
                </div>
              </Fragment>
            ));
          })()}
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
        <div className={`overflow-hidden transition-all duration-300 ease-out ${isComboExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}>
        {(() => {
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
      </div>
    );
  };

  return (
    <div className="mt-6 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
      <div
        role={forceExpanded ? undefined : 'button'}
        onClick={forceExpanded ? undefined : () => {
          const willExpand = !expanded;
          setExpanded(willExpand);
          if (willExpand && !hasTrackedView) {
            setHasTrackedView(true);
            trackEvent('combos_viewed', {
              commanderName: commander?.name ?? 'unknown',
              comboCount: combos.length,
              commanderComboCount: combos.filter(c => c.source === 'commander').length,
              colorIdentityComboCount: combos.filter(c => c.source === 'color-identity').length,
            });
          }
        }}
        className={`flex items-center gap-2 w-full text-left p-4 ${forceExpanded ? '' : 'cursor-pointer'}`}
      >
        <Sparkles className="w-4 h-4 text-primary shrink-0" />
        <h3 className="text-sm font-semibold truncate">Combos in Your Deck</h3>
        <span className="text-xs text-muted-foreground ml-auto shrink-0 whitespace-nowrap">
          {completeCombos.length} complete{nearMisses.length > 0 ? ` · ${nearMisses.length} near-miss` : ''}{excludedCombos.length > 0 ? ` · ${excludedCombos.length} excluded` : ''}
        </span>
        {expanded && cardFilter && (
          <button
            onClick={(e) => { e.stopPropagation(); setCardFilter(null); }}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md bg-violet-500/20 text-violet-200 hover:bg-violet-500/30 transition-colors shrink-0"
            title="Clear card filter"
          >
            <span className="truncate max-w-[140px]">Filter: {cardFilter}</span>
            <X className="w-3 h-3 shrink-0" />
          </button>
        )}
        {expanded && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowSynergy(s => !s); }}
            className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border transition-colors shrink-0 ${
              showSynergy
                ? 'border-violet-500/40 bg-violet-500/15 text-violet-200 hover:bg-violet-500/25'
                : 'border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
            title={showSynergy ? `Hide ${hiddenSynergyCount || ''} synergy combos`.trim() : 'Show synergy combos'}
          >
            <Sparkles className="w-3 h-3" />
            <span>Synergy: {showSynergy ? 'On' : 'Off'}</span>
          </button>
        )}
        {expanded && (
          <span className="flex items-center rounded-md border border-border overflow-hidden shrink-0" onClick={(e) => e.stopPropagation()}>
            {(showSynergy ? (['relevance', 'popularity', 'source'] as const) : (['relevance', 'popularity'] as const)).map((mode) => (
              <button
                key={mode}
                onClick={() => setComboSort(mode)}
                className={`px-2 py-1 text-[10px] transition-colors ${comboSort === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
              >
                {mode === 'popularity' ? 'Popular' : mode === 'relevance' ? 'Relevant' : 'Source'}
              </button>
            ))}
          </span>
        )}
        {!forceExpanded && (
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
        )}
      </div>

      <div className={`overflow-hidden transition-all duration-300 ${expanded ? 'px-4 pb-4 max-h-[8000px] opacity-100' : 'max-h-0 opacity-0'}`}>
        {comboSort === 'source' ? (
          <>
            {/* Commander combos section */}
            {commanderSourceCombos.length > 0 && (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <Crown className="w-3.5 h-3.5 text-amber-300/90 shrink-0" />
                  <span className="text-xs font-medium text-muted-foreground">Commander combos ({commanderSourceCombos.length})</span>
                  <div className="flex-1 border-t border-border/30" />
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
                  {commanderSourceCombos.map(combo => renderComboCard(combo))}
                </div>
              </>
            )}
            {/* Synergy combos section */}
            {synergySourceCombos.length > 0 && (
              <>
                <div className={`flex items-center gap-2 mb-3 ${commanderSourceCombos.length > 0 ? 'mt-4' : ''}`}>
                  <Sparkles className="w-3.5 h-3.5 text-violet-300/80 shrink-0" />
                  <span className="text-xs font-medium text-muted-foreground">Synergy combos ({synergySourceCombos.length})</span>
                  <div className="flex-1 border-t border-border/30" />
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
                  {synergySourceCombos.map(combo => renderComboCard(combo))}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {/* Complete combos */}
            {completeCombos.length > 0 && (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
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
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
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
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
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
        onRegenerate={onRegenerate}
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
