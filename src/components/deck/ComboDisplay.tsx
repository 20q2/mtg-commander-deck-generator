import { useState, useCallback, useEffect, useMemo, Fragment } from 'react';
import type { ComboTemplate, ComboTemplateFit, DetectedCombo, ScryfallCard, LoadPhase, UserCombo } from '@/types';
import { getCardByName, getCardsByNames, getCardImageUrl, useScryfallImage } from '@/services/scryfall/client';
import { getCollectionNameSet } from '@/services/collection/db';
import { fetchComboDetails, type ComboDetails } from '@/services/edhrec/client';
import { comboFitsBracket } from '@/services/deckBuilder/bracketEstimator';
import { templateLabel, slotSearchQuery, slotSearchUrl } from '@/services/combos/templateFit';
import { SlotSearchPanel } from '@/components/deck/SlotSearchPanel';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import { ManaText } from '@/components/ui/mtg-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sparkles, Check, AlertTriangle, ChevronDown, Plus, Package, Ban, Pin, X, ListChecks, Footprints, Infinity, Loader2, Pencil, Trash2, EyeOff, HelpCircle } from 'lucide-react';
import { trackEvent } from '@/services/analytics';
import { useStore } from '@/store';
import { useUserLists } from '@/hooks/useUserLists';
import { useDeckColorIdentity, useDeckNamesLower } from '@/hooks/useDeckFacts';
import { createPortal } from 'react-dom';

// An unnamed combo slot ("Creature with Persist") measured against the deck.
// 'unknown' covers both a combo detected before slot-checking shipped and a slot
// whose Scryfall query the local evaluator can't model — neither is a reason to
// tell the user their combo is broken, so it reads neutral, not red.
type SlotState = 'filled' | 'empty' | 'unknown';

const SLOT_STYLES: Record<SlotState, { box: string; icon: string; text: string; Icon: typeof Check }> = {
  filled: {
    box: 'border-green-400/50 bg-green-500/10 hover:bg-green-500/20 hover:border-green-400/80',
    icon: 'text-green-300/80',
    text: 'text-green-100/90',
    Icon: Check,
  },
  empty: {
    box: 'border-dashed border-red-400/50 bg-red-500/10 hover:bg-red-500/20 hover:border-red-400/80',
    icon: 'text-red-300/80',
    text: 'text-red-100/90',
    Icon: AlertTriangle,
  },
  unknown: {
    box: 'border-dashed border-amber-400/50 bg-amber-500/10 hover:bg-amber-500/20 hover:border-amber-400/80',
    icon: 'text-amber-300/80',
    text: 'text-amber-100/90',
    Icon: HelpCircle,
  },
};

/**
 * How a slot reads in a combo's title: "a persist creature", "2× mana rock".
 * Lower-cased with an article so it sits among proper card names as a role to
 * fill rather than a card to search for by name.
 */
function slotPhrase(t: ComboTemplate): string {
  const label = t.name.toLowerCase();
  if (t.quantity && t.quantity > 1) return `${t.quantity}× ${label}`;
  return `${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label}`;
}

/** Tooltip for a slot, shared by the title phrase and the chip below it. */
function slotTitleFor(t: ComboTemplate, fit: ComboTemplateFit | undefined): string {
  if (fit?.satisfied && fit.verified) {
    const names = fit.filledBy;
    return `${templateLabel(t)} — filled by ${names.slice(0, 6).join(', ')}${names.length > 6 ? `, +${names.length - 6} more` : ''}`;
  }
  if (fit && !fit.verified) {
    return `This combo also needs ${templateLabel(t)}. We couldn't check your deck for it automatically.`;
  }
  return `Your deck has no ${t.name.toLowerCase()} — this combo can't be assembled yet.`;
}

/**
 * An unfilled slot's chip. Opens the in-app browser of cards that would fill the
 * slot when the template ships a query to search; a plain box otherwise, so a
 * blank-query template doesn't offer a search for nothing.
 */
function SlotChip({ onClick, className, style, title, children }: {
  onClick: (() => void) | null;
  className: string;
  style: React.CSSProperties;
  title: string;
  children: React.ReactNode;
}) {
  if (!onClick) return <div className={className} style={style} title={title}>{children}</div>;
  return (
    <button type="button" onClick={onClick} className={`${className} active:scale-95`} style={style} title={title}>
      {children}
    </button>
  );
}

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
  /**
   * The deck's target bracket (1–5) when known — enables the bracket-ceiling
   * filter, which hides near-misses rated above the chosen level. Combos already
   * assembled in the deck always show regardless. Omit for decks with no known
   * bracket (e.g. user lists) to hide the control entirely.
   */
  deckBracket?: number;
  /** Progressive load phases — when 'combos' is missing, render skeleton. */
  phasesDone?: Set<LoadPhase>;
  /** User-authored combos. Rendered alongside detected combos, marked "Yours". */
  customCombos?: UserCombo[];
  /** Deck card names — the pool the user picks from when authoring a combo. */
  deckCardNames?: string[];
  /** Persist a new user combo. When provided, the "Add combo" button is shown. */
  onAddCombo?: (combo: { cards: string[]; result: string; details: string }) => void;
  /** Persist edits to an existing user combo. */
  onEditCombo?: (id: string, combo: { cards: string[]; result: string; details: string }) => void;
  /** Delete a user combo. */
  onDeleteCombo?: (id: string) => void;
  /** When set, open the authoring form seeded with this card (from a card's "Create combo" menu). */
  seedCard?: string | null;
  /** Called once the seedCard has been consumed (form opened), so the parent can clear it. */
  onSeedConsumed?: () => void;
}

// Cache fetched card data across renders
const cardDataCache = new Map<string, ScryfallCard>();

// Near-misses render a page at a time — the Spellbook index can surface
// thousands in a single deck's colors, far more than the panel can hold.
const NEAR_MISS_PAGE_SIZE = 50;

// Cards muted from the combo panel, shared across decks — "I never want to see
// Thassa's Oracle lines" is a standing preference, not a per-deck one.
const HIDDEN_COMBO_CARDS_KEY = 'combos.hiddenCards';

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
  'does', 'do', 'did', 'dont', 'didnt', 'not', 'no', 'doesnt', 'summoning', 'sickness',
  'tapped', 'untapped', 'haste', 'has', 'be', 'can', 'cant',
  // Attachment / enchant relationships are visible from card types — don't restate.
  'attached', 'attach', 'equipped', 'equip', 'enchanted', 'enchant', 'as',
  // Other zone-location verbs (the noun forms are already trivial).
  'exiled', 'sacrificed', 'destroyed', 'cast', 'by', 'from', 'ability', 'abilities',
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

  const isMeaningful = (sentence: string): boolean => {
    let stripped = sentence;
    for (const frag of fragments) {
      const escaped = frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      stripped = stripped.replace(new RegExp('\\b' + escaped + '\\b', 'gi'), '');
    }
    const normalized = stripped.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
    const words = normalized.split(/\s+/).filter(w => w && !TRIVIAL_WORDS.has(w));
    return words.length > 0;
  };

  // Split each prereq on sentence boundaries and keep only the meaningful sentences.
  // Compound prereqs like "All Equipments attached to the same creature. That creature
  // does not have summoning sickness." should keep just the first half.
  const out: string[] = [];
  for (const p of prereqs) {
    const sentences = p
      .split(/(?<=\.)\s+/)
      .map(s => s.trim())
      .filter(Boolean);
    const kept = sentences.filter(isMeaningful);
    if (kept.length > 0) out.push(kept.join(' '));
  }
  return out;
}

export function ComboDisplay({ combos, hideMustInclude, onRegenerate, onAddToDeck, onRemoveFromDeck, onMoveToSideboard, onMoveToMaybeboard, forceExpanded, deckBracket, phasesDone, customCombos, deckCardNames, onAddCombo, onEditCombo, onDeleteCombo, seedCard, onSeedConsumed }: ComboDisplayProps) {
  const combosReady = !phasesDone || phasesDone.has('combos');
  const commander = useStore(s => s.commander);
  const deckColorIdentity = useDeckColorIdentity();

  // The slot the user is browsing cards for, if any. Opening a slot runs its
  // Scryfall query in-app rather than handing off to a Scryfall tab.
  const [slotSearch, setSlotSearch] = useState<{ label: string; query: string; url: string | null; subtitle: string } | null>(null);

  const deckNamesLower = useDeckNamesLower(deckCardNames);

  const bannedCards = useStore(s => s.customization.bannedCards);
  // Scope owned combo pieces to the binders this deck was built from (falls back to the
  // live customization for an in-progress build that isn't stored on a deck yet), so a saved
  // deck's owned markers match its Owned count rather than every binder.
  const collectionBinderIds = useStore(s => s.generatedDeck?.collectionBinderIds ?? s.customization.collectionBinderIds);
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
  const [nearMissPage, setNearMissPage] = useState(0);
  const [showExcluded, setShowExcluded] = useState(false);
  const [comboSort, setComboSort] = useState<'popularity' | 'relevance'>('relevance');
  // Max bracket ceiling for near-misses. null = "All" (no filter). Defaults to the
  // deck's target bracket when known, so an over-bracket near-miss pile is hidden by
  // default. Complete combos (already in the deck) are never filtered by this.
  const [bracketCeiling, setBracketCeiling] = useState<number | null>(deckBracket ?? null);
  const [showSynergy, setShowSynergy] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('combos.showSynergy') !== 'false';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('combos.showSynergy', String(showSynergy));
  }, [showSynergy]);
  const [showPrereqs, setShowPrereqs] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('combos.showPrereqs') !== 'false';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('combos.showPrereqs', String(showPrereqs));
  }, [showPrereqs]);
  // Cards the user has muted from the combo panel. Purely a view filter — unlike
  // the generator's bannedCards, this never touches the deck or a build. Combos
  // involving any muted card drop out of every section rather than moving to
  // "Excluded", which is where *deck-level* exclusions land.
  const [hiddenComboCards, setHiddenComboCards] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(HIDDEN_COMBO_CARDS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem(HIDDEN_COMBO_CARDS_KEY, JSON.stringify(hiddenComboCards));
  }, [hiddenComboCards]);
  const [showHiddenCards, setShowHiddenCards] = useState(false);
  const [cardFilter, setCardFilter] = useState<string | null>(null);
  const [cardImages, setCardImages] = useState<Map<string, string>>(new Map());
  const [collectionNames, setCollectionNames] = useState<Set<string> | null>(null);
  // The one open card menu, if any. `at` records which surface was right-clicked
  // so the popover anchors where the click happened — the art, or the card's name
  // in the combo title — rather than always at the thumbnail.
  const [openMenu, setOpenMenu] = useState<{ comboId: string; name: string; at: 'art' | 'name' } | null>(null);
  const closeMenu = useCallback(() => setOpenMenu(null), []);
  const [hoverPreview, setHoverPreview] = useState<{ name: string; top: number; left: number; placement: 'right' | 'left' } | null>(null);
  const hoverImage = useScryfallImage(hoverPreview?.name ?? null, 'normal');
  const { lists: userLists, updateList, createList } = useUserLists();

  // Combo authoring form: null = closed; editingId = null means "new combo".
  const [comboForm, setComboForm] = useState<{ editingId: string | null; cards: string[]; result: string; details: string } | null>(null);
  const [comboCardQuery, setComboCardQuery] = useState('');

  // Lookup for a user combo's free-form details, keyed by its mapped comboId ('user:<id>').
  const userCombosById = useMemo(() => {
    const map = new Map<string, UserCombo>();
    for (const uc of customCombos ?? []) map.set('user:' + uc.id, uc);
    return map;
  }, [customCombos]);

  // Map user-authored combos into the DetectedCombo shape so they render through
  // the same path as EDHREC combos. They're always complete; missing cards are
  // recomputed against the current deck so a later removal shows as MISSING.
  const userDetectedCombos = useMemo<DetectedCombo[]>(() => {
    const deckSet = new Set((deckCardNames ?? []).map(n => n.toLowerCase()));
    return (customCombos ?? []).map(uc => ({
      comboId: 'user:' + uc.id,
      cards: uc.cards,
      results: uc.result ? [uc.result] : [],
      isComplete: true,
      missingCards: deckCardNames ? uc.cards.filter(c => !deckSet.has(c.toLowerCase())) : [],
      deckCount: 0,
      bracket: '',
      source: 'user' as const,
    }));
  }, [customCombos, deckCardNames]);

  // User combos first so they lead the list; detected combos follow.
  const allCombos = useMemo(() => [...userDetectedCombos, ...combos], [userDetectedCombos, combos]);

  const userComboId = (comboId: string) => comboId.startsWith('user:') ? comboId.slice(5) : null;

  // ── Visible combo lists ────────────────────────────────────────────────
  // Memos rather than inline render computation because the detail/image
  // prefetch effects below scope their EDHREC/Scryfall requests to what's
  // actually rendered — the Spellbook index can put thousands of near-misses
  // in the pool, and prefetching for all of them would starve the
  // rate-limited clients for minutes.

  // The user's "show synergy combos" toggle applies before any other
  // filtering. Complete combos are always shown — the toggle only hides
  // incomplete synergy combos, never a combo the deck already assembles.
  // User combos are never hidden.
  const visibleCombos = useMemo(
    () => showSynergy ? allCombos : allCombos.filter(c => c.source !== 'color-identity' || c.isComplete),
    [showSynergy, allCombos],
  );
  const hiddenSynergyCount = allCombos.length - visibleCombos.length;

  const bannedSet = useMemo(() => new Set(bannedCards.map(n => n.toLowerCase())), [bannedCards]);
  const hasExcludedCard = useCallback(
    (combo: DetectedCombo) => combo.cards.some(n => bannedSet.has(n.toLowerCase())),
    [bannedSet],
  );

  // Muted cards knock out their combos ahead of the complete/near-miss/excluded
  // split, so a muted card can't leak back in through any one section.
  const hiddenCardSet = useMemo(() => new Set(hiddenComboCards.map(n => n.toLowerCase())), [hiddenComboCards]);
  const notHidden = useMemo(
    () => visibleCombos.filter(c => !c.cards.some(n => hiddenCardSet.has(n.toLowerCase()))),
    [visibleCombos, hiddenCardSet],
  );
  const hiddenByCardCount = visibleCombos.length - notHidden.length;

  const filteredVisible = useMemo(
    () => notHidden.filter(combo =>
      !cardFilter || combo.cards.some(n => (n.includes(' // ') ? n.split(' // ')[0] : n) === cardFilter)),
    [notHidden, cardFilter],
  );

  const sortCombos = useCallback((list: DetectedCombo[]) => {
    // User-authored combos always lead — they're the ones the player deliberately built around.
    const userFirst = (a: DetectedCombo, b: DetectedCombo) =>
      (b.source === 'user' ? 1 : 0) - (a.source === 'user' ? 1 : 0);
    if (comboSort === 'relevance') {
      return [...list].sort((a, b) => {
        const uf = userFirst(a, b);
        if (uf !== 0) return uf;
        const aMissing = a.missingCards.length;
        const bMissing = b.missingCards.length;
        if (aMissing !== bMissing) return aMissing - bMissing;
        // Among near-misses equally close to completion, the one involving
        // more cards the deck actually runs is more relevant. Skipped for
        // complete combos, where piece count is not a merit signal.
        if (aMissing > 0) {
          const aPresent = a.cards.length - aMissing;
          const bPresent = b.cards.length - bMissing;
          if (aPresent !== bPresent) return bPresent - aPresent;
        }
        return b.deckCount - a.deckCount;
      });
    }
    return [...list].sort((a, b) => userFirst(a, b) || b.deckCount - a.deckCount);
  }, [comboSort]);

  // Bracket ceiling only trims incomplete combos — a combo the deck already
  // assembles always shows, no matter how it's rated.
  const withinBracket = useCallback(
    (combo: DetectedCombo) => bracketCeiling == null || comboFitsBracket(combo.bracket, bracketCeiling),
    [bracketCeiling],
  );

  const completeCombos = useMemo(
    () => sortCombos(filteredVisible.filter(c => c.isComplete && !hasExcludedCard(c))),
    [filteredVisible, hasExcludedCard, sortCombos],
  );
  const { nearMisses, overBracketHiddenCount } = useMemo(() => {
    const inBracket = filteredVisible.filter(c => !c.isComplete && !hasExcludedCard(c));
    const within = inBracket.filter(withinBracket);
    return { nearMisses: sortCombos(within), overBracketHiddenCount: inBracket.length - within.length };
  }, [filteredVisible, hasExcludedCard, withinBracket, sortCombos]);
  const excludedCombos = useMemo(
    () => filteredVisible.filter(c => hasExcludedCard(c) && withinBracket(c)),
    [filteredVisible, hasExcludedCard, withinBracket],
  );

  // Near-miss pagination. The page index is clamped rather than reset when the
  // list shrinks; explicit filter/sort changes jump back to page one.
  const nearMissPageCount = Math.max(1, Math.ceil(nearMisses.length / NEAR_MISS_PAGE_SIZE));
  const currentNearMissPage = Math.min(nearMissPage, nearMissPageCount - 1);
  const pagedNearMisses = useMemo(
    () => nearMisses.slice(currentNearMissPage * NEAR_MISS_PAGE_SIZE, (currentNearMissPage + 1) * NEAR_MISS_PAGE_SIZE),
    [nearMisses, currentNearMissPage],
  );
  useEffect(() => { setNearMissPage(0); }, [comboSort, cardFilter, bracketCeiling, showSynergy, hiddenCardSet]);

  // Exactly what's on screen — drives the detail/image prefetches.
  const renderedCombos = useMemo(
    () => [...completeCombos, ...pagedNearMisses, ...(showExcluded ? excludedCombos : [])],
    [completeCombos, pagedNearMisses, showExcluded, excludedCombos],
  );

  // A card's "Create combo" menu entry seeds the authoring form with that card.
  useEffect(() => {
    if (!seedCard || !onAddCombo) return;
    setExpanded(true);
    setComboCardQuery('');
    setComboForm({ editingId: null, cards: [seedCard], result: '', details: '' });
    onSeedConsumed?.();
  }, [seedCard, onAddCombo, onSeedConsumed]);

  // Card data (for image previews) for the deck pool the authoring form searches.
  // Prefetched once when the form opens so search results show thumbnails instantly.
  const [deckCardData, setDeckCardData] = useState<Map<string, ScryfallCard>>(new Map());
  const comboFormOpen = comboForm !== null;
  useEffect(() => {
    if (!comboFormOpen || !deckCardNames || deckCardNames.length === 0) return;
    const seeded = new Map<string, ScryfallCard>();
    const missing: string[] = [];
    for (const name of deckCardNames) {
      const cached = cardDataCache.get(name);
      if (cached) seeded.set(name, cached);
      else missing.push(name);
    }
    if (seeded.size > 0) setDeckCardData(prev => (prev.size >= seeded.size ? prev : seeded));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const map = await getCardsByNames(missing);
        if (cancelled) return;
        for (const [n, c] of map) cardDataCache.set(n, c);
        setDeckCardData(prev => {
          const next = new Map(prev);
          for (const [n, c] of map) next.set(n, c);
          for (const [n, c] of seeded) next.set(n, c);
          return next;
        });
      } catch { /* ignore fetch failures — names still render without images */ }
    })();
    return () => { cancelled = true; };
  }, [comboFormOpen, deckCardNames]);

  /**
   * Open a card's context menu at the surface that was right-clicked. The menu
   * renders in place anchored to that surface, so this only has to make sure the
   * Scryfall card is loaded first — `CardContextMenu` needs it to render at all.
   */
  const openCardMenu = useCallback((comboId: string, name: string, at: 'art' | 'name') => {
    if (cardDataCache.has(name)) {
      setOpenMenu({ comboId, name, at });
      return;
    }
    void getCardByName(name).then(card => {
      if (!card) return;
      cardDataCache.set(name, card);
      setOpenMenu({ comboId, name, at });
    });
  }, []);

  // Load collection names when expanded
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    getCollectionNameSet(collectionBinderIds).then(names => {
      if (!cancelled && names.size > 0) setCollectionNames(names);
    });
    return () => { cancelled = true; };
  }, [expanded, collectionBinderIds]);

  // Background-prefetch combo details for rendered combos so we can show
  // non-trivial prerequisites (e.g. "three Foods") as chips alongside cards
  // without making the user click "Show details". Scoped to the rendered
  // page, not the whole pool — details are one EDHREC request per combo.
  useEffect(() => {
    if (!expanded) return;
    for (const combo of renderedCombos) {
      if (combo.source === 'user') continue; // no EDHREC page to fetch
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
  }, [expanded, renderedCombos]);

  // Fetch card images when expanded (bulk batch via /cards/collection).
  // Scoped to the rendered page — the full pool can reference thousands of
  // distinct cards.
  useEffect(() => {
    if (!expanded) return;

    // Named combo pieces plus the card filling each satisfied slot — a filled
    // slot renders as that card's actual image, so it needs the same prefetch.
    const allNames = [...new Set(renderedCombos.flatMap(c => [
      ...c.cards,
      ...(c.templateFits ?? []).flatMap(f => (f.satisfied && f.verified && f.filledBy[0]) ? [f.filledBy[0]] : []),
    ]))];
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
  }, [expanded, renderedCombos]);

  // Track the combo card list for the current preview so the modal's existing
  // deck-nav machinery (slide animations, peek images, position indicator) can
  // cycle through the combo's cards.
  const [previewComboCards, setPreviewComboCards] = useState<string[] | null>(null);

  const openPreviewForCard = useCallback(async (name: string, comboCards: string[] | null) => {
    try {
      let card = cardDataCache.get(name);
      if (!card) {
        card = await getCardByName(name);
        if (card) cardDataCache.set(name, card);
      }
      if (card) {
        setPreviewCardName(name.includes(' // ') ? name.split(' // ')[0] : name);
        setPreviewCard(card);
        setPreviewComboCards(comboCards);
      }
    } catch {
      // silently fail
    }
  }, []);


  const tempBannedCards = useStore(s => s.customization.tempBannedCards ?? []);

  const handleAddMustInclude = useCallback((name: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
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
      case 'filterCombos': {
        const front = name.includes(' // ') ? name.split(' // ')[0] : name;
        setCardFilter(prev => (prev === front ? null : front));
        break;
      }
      case 'hideFromCombos': {
        const hidden = hiddenComboCards.some(n => n.toLowerCase() === name.toLowerCase());
        setHiddenComboCards(hidden
          ? hiddenComboCards.filter(n => n.toLowerCase() !== name.toLowerCase())
          : [...hiddenComboCards, name]);
        // Filtering *to* the card you just muted would leave an empty panel.
        if (!hidden && cardFilter === (name.includes(' // ') ? name.split(' // ')[0] : name)) setCardFilter(null);
        setToastMessage(hidden ? `Showing combos with "${name}" again` : `Hiding combos with "${name}"`);
        break;
      }
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
  }, [mustIncludeCards, bannedCards, updateCustomization, userLists, updateList, createList, onAddToDeck, onRemoveFromDeck, onMoveToSideboard, onMoveToMaybeboard, hiddenComboCards, cardFilter]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Build a map of card name → combos involving that card (for preview modal navigation)
  const cardComboMap = useMemo(() => {
    const map = new Map<string, DetectedCombo[]>();
    for (const combo of allCombos) {
      for (const name of combo.cards) {
        const frontName = name.includes(' // ') ? name.split(' // ')[0] : name;
        const existing = map.get(frontName);
        if (existing) existing.push(combo);
        else map.set(frontName, [combo]);
      }
    }
    return map;
  }, [allCombos]);

  if (!combosReady) {
    return (
      <div className="mt-6 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
        <div className="flex items-center gap-2 p-4">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Checking combos…</span>
        </div>
        <div className="px-4 pb-4 space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 w-full bg-accent/20 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }
  // Show the panel when there are combos of any kind, or when the user can author
  // one (onAddCombo provided) — so the "Add combo" button is reachable on an
  // otherwise combo-less saved deck.
  if (allCombos.length === 0 && !onAddCombo) return null;

  // Custom (user-authored) combos among the currently-visible set — reported separately
  // in the summary even though they also count toward "complete".
  const customCount = [...completeCombos, ...nearMisses, ...excludedCombos].filter(c => c.source === 'user').length;

  const toggleCardFilter = (name: string) => {
    const front = name.includes(' // ') ? name.split(' // ')[0] : name;
    setCardFilter(prev => (prev === front ? null : front));
  };

  const renderComboCard = (combo: DetectedCombo, isExcluded = false) => {
    const isComboExpanded = expandedCombo === combo.comboId;

    // Dynamic item sizing — pack cards + prereq chips into one row when feasible.
    // Each combo cell is ~340px inner width (lg:grid-cols-3). Subtract separators
    // (~18px each) and distribute the rest. Cap at [40, 80] so we don't get giant
    // thumbs for 2-card combos or unreadable specks for 7-card ones.
    const _details = comboDetails.get(combo.comboId);
    // Compute prereqs regardless of toggle so we can keep chips mounted and
    // animate their width/opacity when the user toggles details on/off.
    const allPrereqs = (_details && _details !== 'loading' && _details !== 'error')
      ? extractMeaningfulPrereqs(_details.prerequisites, combo.cards)
      : [];
    const showingPrereqs = showPrereqs && allPrereqs.length > 0;
    // Template slots sit alongside the named cards rather than with the prereq
    // chips: they're a card you still have to supply, not a footnote, so they
    // stay visible even with Details off.
    const templates = combo.templates ?? [];
    const templateFits = combo.templateFits ?? [];
    const itemCount = combo.cards.length + templates.length + (showingPrereqs ? allPrereqs.length : 0);
    const availablePx = 340 - Math.max(0, itemCount - 1) * 18;
    const itemWidth = Math.min(80, Math.max(40, Math.floor(availablePx / Math.max(1, itemCount))));
    const itemHeight = Math.round(itemWidth * 680 / 488);

    // One menu definition, rendered at whichever surface was right-clicked so
    // the art and the title name give identical options.
    const renderCardMenu = (name: string, at: 'art' | 'name') => {
      const card = cardDataCache.get(name);
      if (!card) return null;
      const isMissing = combo.missingCards.includes(name);
      const front = name.includes(' // ') ? name.split(' // ')[0] : name;
      return (
        <CardContextMenu
          card={card}
          onAction={handleComboCardAction}
          hasRemove={!isMissing && !!onRemoveFromDeck}
          hasAddToDeck={isMissing && !!onAddToDeck}
          hasSideboard={!!onMoveToSideboard}
          hasMaybeboard={!!onMoveToMaybeboard}
          isMustInclude={mustIncludeCards.includes(name) || tempMustIncludeCards.includes(name)}
          isBanned={bannedSet.has(name.toLowerCase())}
          hasHideFromCombos
          isHiddenFromCombos={hiddenCardSet.has(name.toLowerCase())}
          isComboFiltered={cardFilter === front}
          userLists={userLists}
          forceOpen={openMenu?.comboId === combo.comboId && openMenu.name === name && openMenu.at === at}
          onForceClose={closeMenu}
        />
      );
    };

    return (
      <div
        key={combo.comboId}
        style={{ minHeight: 205 }}
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
        {combo.source === 'user' && (
          <span
            className="absolute top-2 right-2 inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium text-violet-300/80 bg-violet-500/10 border border-violet-500/20"
            title="A combo you added by hand."
          >
            <Pin className="w-2.5 h-2.5" />
            Yours
          </span>
        )}

        {/* Title + metadata */}
        <div className={`mb-2 min-w-0 ${combo.source === 'color-identity' || combo.source === 'user' ? 'pr-16' : ''}`}>
          {(() => {
            // isComplete already accounts for unnamed slots (see
            // services/combos/detect.ts), so the tone just follows it.
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
                    // Right-clicking a name opens the same menu as right-clicking
                    // its art, anchored to the name rather than the thumbnail.
                    const handleNameContextMenu = (e: React.MouseEvent<HTMLElement>) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openCardMenu(combo.comboId, n, 'name');
                    };
                    return (
                      <Fragment key={n}>
                        {i > 0 && <span className="text-muted-foreground/70 mx-0.5">+</span>}
                        {/* Stays inline (not inline-block) so long card names can
                            still wrap mid-name inside the title. */}
                        <span className="relative">
                          {filterable ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); toggleCardFilter(n); }}
                              onContextMenu={handleNameContextMenu}
                              className={`underline-offset-2 hover:underline hover:text-foreground transition-colors ${isActive ? 'underline text-foreground' : ''}`}
                              title={isActive ? `Clear filter (${front})` : `Show more combos with ${front} (${comboCount} combos)`}
                            >
                              {front}
                            </button>
                          ) : (
                            <span
                              onContextMenu={handleNameContextMenu}
                              className="cursor-context-menu"
                              title={`${front} appears in only this combo`}
                            >
                              {front}
                            </span>
                          )}
                          {/* Invisible trigger stretched over the name, so the menu
                              drops from the text you right-clicked. Mounted only
                              while open — at most one across the whole panel. */}
                          {openMenu?.comboId === combo.comboId && openMenu.name === n && openMenu.at === 'name' && (
                            <span className="absolute inset-0 opacity-0 pointer-events-none [&>button]:block [&>button]:w-full [&>button]:h-full">
                              {renderCardMenu(n, 'name')}
                            </span>
                          )}
                        </span>
                      </Fragment>
                    );
                  })}
                  {/* The unnamed slots are pieces of the combo too — "Mikaeus +
                      Phyrexian Altar" is really a three-card combo. Listing them
                      in the title says so up front; italics and the muted tone
                      keep them readable as a role to fill rather than a card to
                      go find by name. */}
                  {templates.map((tpl, i) => (
                    <Fragment key={`tpl-name-${i}`}>
                      <span className="text-muted-foreground/70 mx-0.5">+</span>
                      <span className="italic opacity-90" title={slotTitleFor(tpl, templateFits[i])}>
                        {slotPhrase(tpl)}
                      </span>
                    </Fragment>
                  ))}
                </span>
              </span>
            );
          })()}
          <span className="text-[10px] text-muted-foreground mt-0.5 block">
            {combo.source === 'user'
              ? (combo.results[0] || 'Custom combo')
              : `${combo.deckCount.toLocaleString()} decks · Bracket ${combo.bracket}`}
          </span>

        </div>

        {/* Card images with + separators */}
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {combo.cards.map((name, i) => {
            const isMissing = combo.missingCards.includes(name);
            const isBanned = bannedSet.has(name.toLowerCase());
            const imgUrl = cardImages.get(name);
            const frontName = name.includes(' // ') ? name.split(' // ')[0] : name;
            const cardComboCount = cardComboMap.get(frontName)?.length ?? 0;
            return (
              <Fragment key={name}>
                {i > 0 && (
                  <Plus className="w-3 h-3 text-muted-foreground shrink-0" />
                )}
                <div
                  className="group/combo relative transition-all duration-300"
                  style={{ width: itemWidth }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openCardMenu(combo.comboId, name, 'art');
                  }}
                  // Hover lives on the whole cell, not the art: the OWNED/MISSING
                  // overlay and its "Add to Deck" button are siblings of the art,
                  // so tracking the art alone dropped the preview the moment you
                  // reached for the button the preview had just talked you into.
                  onMouseEnter={(e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const viewportW = window.innerWidth;
                    // Show preview on the right if there's room, else left of the card.
                    const placement: 'right' | 'left' = (viewportW - rect.right > 220) ? 'right' : 'left';
                    setHoverPreview({
                      name,
                      top: rect.top + rect.height / 2,
                      left: placement === 'right' ? rect.right + 8 : rect.left - 8,
                      placement,
                    });
                  }}
                  onMouseLeave={() => setHoverPreview(null)}
                >
                <div
                  onClick={() => openPreviewForCard(name, combo.cards)}
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
                          className={`hidden group-hover/combo:flex items-center gap-0.5 rounded bg-emerald-600/90 hover:bg-emerald-500 text-white font-semibold transition-colors pointer-events-auto ${itemWidth < 60 ? 'px-1 py-1 text-[8px]' : 'px-1.5 py-1 text-[8px]'}`}
                          title="Add to deck"
                        >
                          <Plus className="w-2.5 h-2.5" />
                          {itemWidth >= 60 && 'Add to Deck'}
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
                          className={`hidden group-hover/combo:flex items-center gap-0.5 rounded bg-emerald-600/90 hover:bg-emerald-500 text-white font-semibold transition-colors pointer-events-auto ${itemWidth < 60 ? 'px-1 py-1 text-[8px]' : 'px-1.5 py-1 text-[8px]'}`}
                          title="Add to deck"
                        >
                          <Plus className="w-2.5 h-2.5" />
                          {itemWidth >= 60 && 'Add to Deck'}
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
                    <span className={`absolute top-0.5 right-0.5 z-10 transition-opacity ${openMenu?.comboId === combo.comboId && openMenu.name === name ? 'opacity-100' : 'opacity-0 group-hover/combo:opacity-100'}`}>
                      {renderCardMenu(name, 'art')}
                    </span>
                  )}
                </div>
              </Fragment>
            );
          })}
          {templates.map((tpl, idx) => {
            // A slot card, shown exactly like the named pieces: green when the
            // deck fills it (and saying which card does), red when it doesn't.
            const fit = templateFits[idx];
            const state: SlotState = !fit ? 'unknown' : !fit.verified ? 'unknown' : fit.satisfied ? 'filled' : 'empty';
            const style = SLOT_STYLES[state];
            const fillers = fit?.filledBy ?? [];
            const fillerLabel = state !== 'filled'
              ? null
              : fillers.length === 1
                ? fillers[0]
                : `${fillers.length} cards`;
            const filler = state === 'filled' ? fillers[0] : undefined;
            const fillerImg = filler ? cardImages.get(filler) : undefined;
            const slotQuery = slotSearchQuery(tpl.scryfallQuery, deckColorIdentity);
            const slotTitle = slotTitleFor(tpl, fit)
              + (slotQuery ? ' Click to browse cards that fill it, in your colours.' : '');

            return (
              <Fragment key={`tpl-${idx}`}>
                {(combo.cards.length > 0 || idx > 0) && (
                  <Plus className="w-3 h-3 text-muted-foreground shrink-0" />
                )}
                {filler && fillerImg ? (
                  // A filled slot is a real card, so it reads as one: the actual
                  // art, banded with the role it's filling. The dashed emerald
                  // ring marks it as a slot rather than a named combo piece —
                  // swapping this card for another persist creature keeps the
                  // combo, swapping a named piece doesn't.
                  <div
                    className="relative rounded-md overflow-hidden cursor-pointer transition-all active:scale-90 outline outline-2 outline-dashed -outline-offset-2 outline-emerald-400/80 hover:outline-emerald-300"
                    style={{ width: itemWidth, height: itemHeight }}
                    title={slotTitle}
                    onClick={() => openPreviewForCard(filler, combo.cards)}
                    onMouseEnter={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const placement: 'right' | 'left' = (window.innerWidth - rect.right > 220) ? 'right' : 'left';
                      setHoverPreview({
                        name: filler,
                        top: rect.top + rect.height / 2,
                        left: placement === 'right' ? rect.right + 8 : rect.left - 8,
                        placement,
                      });
                    }}
                    onMouseLeave={() => setHoverPreview(null)}
                  >
                    <img src={fillerImg} alt={filler} className="w-full h-full object-cover" loading="lazy" />
                    <div className="absolute inset-x-0 bottom-0 bg-emerald-950/85 backdrop-blur-[2px] border-t border-emerald-400/50 px-1 py-0.5">
                      <span className="block text-[8px] font-semibold leading-tight text-center text-emerald-100 break-words">
                        {templateLabel(tpl)}
                      </span>
                    </div>
                    {fillers.length > 1 && (
                      <span
                        className="absolute top-0.5 right-0.5 px-1 rounded bg-emerald-950/85 text-[8px] font-semibold text-emerald-200"
                        title={`${fillers.length} cards in your deck fill this slot`}
                      >
                        +{fillers.length - 1}
                      </span>
                    )}
                  </div>
                ) : (
                  <SlotChip
                    onClick={slotQuery ? () => setSlotSearch({
                      label: templateLabel(tpl),
                      query: slotQuery,
                      url: slotSearchUrl(tpl.scryfallQuery, deckColorIdentity),
                      subtitle: combo.cards.length > 0 ? `Fills the open slot in ${combo.cards.join(' + ')}` : '',
                    }) : null}
                    className={`rounded-md border overflow-y-auto overflow-x-hidden transition-colors ${style.box}`}
                    style={{ width: itemWidth, height: itemHeight }}
                    title={slotTitle}
                  >
                    <div className="flex flex-col items-center justify-center gap-1 min-h-full px-1.5 py-2">
                      <style.Icon className={`w-3 h-3 shrink-0 ${style.icon}`} />
                      <span className={`text-[9px] leading-tight text-center break-words ${style.text}`}>
                        {templateLabel(tpl)}
                      </span>
                      {fillerLabel && (
                        <span className="text-[8px] leading-tight text-center break-words text-green-200/70">
                          {fillerLabel}
                        </span>
                      )}
                      {state === 'empty' && (
                        <span className="text-[8px] leading-tight text-center text-red-200/70">not in deck</span>
                      )}
                    </div>
                  </SlotChip>
                )}
              </Fragment>
            );
          })}
          {allPrereqs.map((prereq, idx) => (
            <Fragment key={`prereq-${idx}`}>
              <Plus
                className="w-3 h-3 text-muted-foreground shrink-0 transition-all duration-300"
                style={{ opacity: showingPrereqs ? 1 : 0, width: showingPrereqs ? undefined : 0, marginLeft: showingPrereqs ? undefined : -6 }}
              />
              <div
                className="rounded-md border border-zinc-500/30 bg-zinc-500/10 overflow-y-auto overflow-x-hidden transition-all duration-300"
                style={{
                  width: showingPrereqs ? itemWidth : 0,
                  height: showingPrereqs ? itemHeight : 0,
                  opacity: showingPrereqs ? 1 : 0,
                  borderWidth: showingPrereqs ? undefined : 0,
                }}
                title={prereq}
              >
                <div className="flex items-center justify-center min-h-full px-2 py-2.5">
                  <span className="text-[10px] text-zinc-200/90 leading-tight text-center break-words">
                    <ManaText text={prereq.replace(/\.$/, '')} />
                  </span>
                </div>
              </div>
            </Fragment>
          ))}
        </div>

        {/* User combos: optional details expander + edit/delete controls in place of the EDHREC details toggle. */}
        {combo.source === 'user' ? (
          (() => {
            const uc = userCombosById.get(combo.comboId);
            const details = uc?.details?.trim();
            return (
              <>
                <div className="flex items-center gap-3">
                  {details && (
                    <button
                      onClick={() => setExpandedCombo(isComboExpanded ? null : combo.comboId)}
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ChevronDown className={`w-3 h-3 transition-transform ${isComboExpanded ? 'rotate-180' : ''}`} />
                      {isComboExpanded ? 'Hide details' : 'Show details'}
                    </button>
                  )}
                  <div className="flex items-center gap-3 ml-auto">
                    {onEditCombo && (
                      <button
                        onClick={() => {
                          const id = userComboId(combo.comboId);
                          if (id) setComboForm({ editingId: id, cards: combo.cards, result: combo.results[0] ?? '', details: uc?.details ?? '' });
                        }}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                        Edit
                      </button>
                    )}
                    {onDeleteCombo && (
                      <button
                        onClick={() => {
                          const id = userComboId(combo.comboId);
                          if (id) { onDeleteCombo(id); setToastMessage('Combo deleted'); }
                        }}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                {details && (
                  <div className={`overflow-hidden transition-all duration-300 ease-out ${isComboExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}>
                    <p className="text-[11px] text-muted-foreground leading-relaxed mt-1.5 whitespace-pre-wrap">
                      {details}
                    </p>
                  </div>
                )}
              </>
            );
          })()
        ) : (
        <>
        {/* Expandable details */}
        <button
          onClick={() => {
            const willExpand = expandedCombo !== combo.comboId;
            setExpandedCombo(willExpand ? combo.comboId : null);
            // Re-fetch on a previous failure as well as a first open: the href a
            // detail fetch needs can arrive after the first attempt (a deck
            // hydrated from cache gets it when the background refresh lands), so
            // caching 'error' for the session would strand the combo on the
            // results-only fallback until a reload.
            const prior = comboDetails.get(combo.comboId);
            if (willExpand && (prior === undefined || prior === 'error')) {
              setComboDetails(prev => new Map(prev).set(combo.comboId, 'loading'));
              fetchComboDetails(combo.comboId, combo.href)
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
        </>
        )}
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
        className={`flex flex-wrap items-center gap-2 w-full text-left p-4 ${forceExpanded ? '' : 'cursor-pointer'}`}
      >
        <Sparkles className="w-4 h-4 text-primary shrink-0" />
        <h3 className="text-sm font-semibold truncate">Combos in Your Deck</h3>
        <span className="text-xs text-muted-foreground ml-auto shrink-0 whitespace-nowrap">
          {completeCombos.length} complete{nearMisses.length > 0 ? ` · ${nearMisses.length} near-miss` : ''}{customCount > 0 ? ` · ${customCount} custom` : ''}{excludedCombos.length > 0 ? ` · ${excludedCombos.length} excluded` : ''}{overBracketHiddenCount > 0 ? ` · ${overBracketHiddenCount} over-bracket hidden` : ''}{hiddenByCardCount > 0 ? ` · ${hiddenByCardCount} muted` : ''}
        </span>
        {onAddCombo && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(true);
              setComboCardQuery('');
              setComboForm({ editingId: null, cards: [], result: '', details: '' });
            }}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border border-violet-500/40 bg-violet-500/15 text-violet-200 hover:bg-violet-500/25 transition-colors shrink-0"
            title="Add your own combo"
          >
            <Plus className="w-3 h-3" />
            <span>Add</span>
          </button>
        )}
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
        {expanded && hiddenComboCards.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowHiddenCards(v => !v); }}
            className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border transition-colors shrink-0 ${
              showHiddenCards
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                : 'border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
            title={`${hiddenComboCards.length} card${hiddenComboCards.length === 1 ? '' : 's'} muted${hiddenByCardCount > 0 ? ` · ${hiddenByCardCount} combo${hiddenByCardCount === 1 ? '' : 's'} hidden` : ''}`}
          >
            <EyeOff className="w-3 h-3" />
            <span>{hiddenComboCards.length} muted</span>
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
          <button
            onClick={(e) => { e.stopPropagation(); setShowPrereqs(p => !p); }}
            className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border transition-colors shrink-0 ${
              showPrereqs
                ? 'border-zinc-400/40 bg-zinc-400/15 text-zinc-100 hover:bg-zinc-400/25'
                : 'border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
            title={showPrereqs ? 'Hide combo requirements (e.g. three Foods)' : 'Show combo requirements'}
          >
            <ListChecks className="w-3 h-3" />
            <span>Details: {showPrereqs ? 'On' : 'Off'}</span>
          </button>
        )}
        {expanded && (
          <span className="flex items-center rounded-md border border-border overflow-hidden shrink-0" onClick={(e) => e.stopPropagation()}>
            {(['relevance', 'popularity'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setComboSort(mode)}
                className={`px-2 py-1 text-[10px] transition-colors ${comboSort === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
              >
                {mode === 'popularity' ? 'Popular' : 'Relevant'}
              </button>
            ))}
          </span>
        )}
        {expanded && deckBracket != null && (
          <span
            className="flex items-center gap-1 shrink-0"
            onClick={(e) => e.stopPropagation()}
            title="Hide near-miss combos rated above this bracket. Combos already in your deck always show."
          >
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">Bracket ≤</span>
            <span className="flex items-center rounded-md border border-border overflow-hidden">
              {([1, 2, 3, 4, 5, null] as const).map((lvl) => (
                <button
                  key={lvl ?? 'all'}
                  onClick={() => setBracketCeiling(lvl)}
                  className={`px-2 py-1 text-[10px] transition-colors ${bracketCeiling === lvl ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
                >
                  {lvl === null ? 'All' : lvl}
                </button>
              ))}
            </span>
          </span>
        )}
        {!forceExpanded && (
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
        )}
      </div>

      <div className={`overflow-hidden transition-all duration-300 ${expanded ? 'px-4 pb-4 max-h-[20000px] opacity-100' : 'max-h-0 opacity-0'}`}>
        {/* Muted cards — the un-hide surface for right-click → "Hide combos with this card". */}
        {showHiddenCards && hiddenComboCards.length > 0 && (
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
            <div className="flex items-center gap-2 mb-2">
              <EyeOff className="w-3 h-3 text-amber-300/80 shrink-0" />
              <span className="text-[11px] text-amber-100/90">
                Combos using these cards are hidden
                {hiddenByCardCount > 0 && <span className="text-amber-200/60"> · {hiddenByCardCount.toLocaleString()} hidden here</span>}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setHiddenComboCards([])}
                className="ml-auto h-6 px-2 text-[10px] text-amber-200/80 hover:text-amber-100"
              >
                Clear all
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {hiddenComboCards.map(name => (
                <button
                  key={name}
                  onClick={() => setHiddenComboCards(hiddenComboCards.filter(n => n !== name))}
                  className="flex items-center gap-1 px-2 py-1 rounded-md border border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-100/90 hover:bg-amber-500/20 transition-colors"
                  title={`Show combos with "${name}" again`}
                >
                  <span className="truncate max-w-[180px]">{name}</span>
                  <X className="w-3 h-3 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}
        {/* Empty state — no combos yet, but authoring is available. */}
        {onAddCombo && completeCombos.length === 0 && nearMisses.length === 0 && excludedCombos.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="text-xs text-muted-foreground">No combos found in this deck yet.</p>
            <button
              onClick={() => { setComboCardQuery(''); setComboForm({ editingId: null, cards: [], result: '', details: '' }); }}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-md border border-violet-500/40 bg-violet-500/15 text-violet-200 hover:bg-violet-500/25 transition-colors"
            >
              <Plus className="w-3 h-3" />
              Add your own combo
            </button>
          </div>
        )}
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
              {pagedNearMisses.map(combo => renderComboCard(combo))}
            </div>
            {nearMissPageCount > 1 && (
              <div className="flex items-center justify-center gap-2 mt-3">
                <button
                  onClick={() => setNearMissPage(Math.max(0, currentNearMissPage - 1))}
                  disabled={currentNearMissPage === 0}
                  className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border/30 rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  ‹ Prev
                </button>
                <span className="px-2 text-xs text-muted-foreground whitespace-nowrap">
                  Page {currentNearMissPage + 1} of {nearMissPageCount} · {nearMisses.length.toLocaleString()} near-misses
                </span>
                <button
                  onClick={() => setNearMissPage(Math.min(nearMissPageCount - 1, currentNearMissPage + 1))}
                  disabled={currentNearMissPage === nearMissPageCount - 1}
                  className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border/30 rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  Next ›
                </button>
              </div>
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
        onClose={() => { setPreviewCard(null); setPreviewCardName(null); setPreviewComboCards(null); }}
        {...(previewComboCards && previewComboCards.length > 1 && previewCard ? (() => {
          // Cycle through the combo's cards via the modal's regular deck-nav machinery.
          const cards = previewComboCards;
          const currentName = previewCard.name;
          const front = currentName.includes(' // ') ? currentName.split(' // ')[0] : currentName;
          let currentIdx = cards.indexOf(currentName);
          if (currentIdx === -1) currentIdx = cards.indexOf(front);
          if (currentIdx === -1) currentIdx = 0;
          const len = cards.length;
          const prevIdx = (currentIdx - 1 + len) % len;
          const nextIdx = (currentIdx + 1) % len;
          const prevCard = cardDataCache.get(cards[prevIdx]);
          const nextCard = cardDataCache.get(cards[nextIdx]);
          return {
            onNavigate: (direction: 'prev' | 'next') => {
              const targetIdx = direction === 'next' ? nextIdx : prevIdx;
              const targetName = cards[targetIdx];
              openPreviewForCard(targetName, cards);
            },
            canNavigate: { prev: true, next: true },
            cardIndex: currentIdx,
            totalCards: len,
            prevCardImage: prevCard ? getCardImageUrl(prevCard, 'small') : null,
            nextCardImage: nextCard ? getCardImageUrl(nextCard, 'small') : null,
          };
        })() : {})}
        combos={previewCardName ? cardComboMap.get(previewCardName) : undefined}
        cardComboMap={cardComboMap}
        hideMustInclude={hideMustInclude}
        onRegenerate={onRegenerate}
      />
      {slotSearch && (
        <SlotSearchPanel
          label={slotSearch.label}
          subtitle={slotSearch.subtitle}
          query={slotSearch.query}
          scryfallUrl={slotSearch.url}
          deckCardNames={deckNamesLower}
          ownedNames={collectionNames}
          onAdd={(!hideMustInclude || !!onAddToDeck) ? (name) => handleAddMustInclude(name) : undefined}
          onSideboard={onMoveToSideboard ? (name) => onMoveToSideboard([name]) : undefined}
          onMaybeboard={onMoveToMaybeboard ? (name) => onMoveToMaybeboard([name]) : undefined}
          onClose={() => setSlotSearch(null)}
        />
      )}
      {hoverPreview && createPortal(
        <div
          className="pointer-events-none fixed z-[110] animate-fade-in"
          style={{
            top: hoverPreview.top,
            left: hoverPreview.left,
            transform: hoverPreview.placement === 'right' ? 'translate(0, -50%)' : 'translate(-100%, -50%)',
          }}
        >
          <img
            src={hoverImage.url}
            alt={hoverPreview.name}
            className="w-56 rounded-lg shadow-2xl border border-white/10"
          />
        </div>,
        document.body
      )}
      {comboForm && createPortal(
        (() => {
          const selected = comboForm.cards;
          const q = comboCardQuery.trim().toLowerCase();
          // Results only appear once the user searches — no auto-populated list.
          const candidates = q
            ? (deckCardNames ?? [])
                .filter(n => !selected.includes(n))
                .filter(n => n.toLowerCase().includes(q))
                .slice(0, 8)
            : [];
          const canSave = selected.length >= 2;
          const closeForm = () => { setComboForm(null); setComboCardQuery(''); };
          const toggleCard = (name: string) =>
            setComboForm(f => f ? { ...f, cards: f.cards.includes(name) ? f.cards.filter(c => c !== name) : [...f.cards, name] } : f);
          const save = () => {
            if (!canSave) return;
            const payload = { cards: selected, result: comboForm.result.trim(), details: comboForm.details.trim() };
            if (comboForm.editingId && onEditCombo) {
              onEditCombo(comboForm.editingId, payload);
              setToastMessage('Combo updated');
            } else if (onAddCombo) {
              onAddCombo(payload);
              setToastMessage('Combo added');
            }
            closeForm();
          };
          return (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 animate-fade-in" onClick={closeForm}>
              <div
                className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl p-5 max-h-[85vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 text-primary shrink-0" />
                  <h3 className="text-sm font-semibold">{comboForm.editingId ? 'Edit combo' : 'Add a combo'}</h3>
                  <button onClick={closeForm} className="ml-auto text-muted-foreground hover:text-foreground transition-colors" title="Close">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Selected cards */}
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Cards {selected.length > 0 && <span className="text-muted-foreground/70">({selected.length})</span>}
                </label>
                {selected.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {selected.map(name => (
                      <span key={name} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/50 text-violet-100 text-[11px]">
                        {name.includes(' // ') ? name.split(' // ')[0] : name}
                        <button onClick={() => toggleCard(name)} className="rounded-full hover:bg-violet-500/30 p-0.5" title="Remove">
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground/70 mb-2">Pick at least two cards from your deck.</p>
                )}

                {/* Card search — matching deck cards show in an image-preview popover, like modify-mode add-a-card. */}
                <div className="relative mb-3">
                  <Input
                    value={comboCardQuery}
                    onChange={(e) => setComboCardQuery(e.target.value)}
                    placeholder="Search your deck…"
                    className="h-9 text-xs border-border"
                  />
                  {q && (
                    <div className="absolute top-full left-0 right-0 mt-1 z-10 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-2xl py-1">
                      {candidates.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground px-3 py-2.5">No matching cards in your deck.</p>
                      ) : candidates.map(name => {
                        const card = deckCardData.get(name);
                        const img = card ? getCardImageUrl(card, 'small') : cardImages.get(name);
                        const front = name.includes(' // ') ? name.split(' // ')[0] : name;
                        return (
                          <button
                            key={name}
                            onClick={() => { toggleCard(name); setComboCardQuery(''); }}
                            className="flex items-center gap-3 w-full text-left px-3 py-1.5 hover:bg-accent transition-colors group"
                          >
                            {img
                              ? <img src={img} alt={front} className="w-8 h-auto rounded shadow shrink-0" loading="lazy" />
                              : <div className="w-8 aspect-[488/680] rounded bg-accent/50 shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{front}</p>
                              {card?.type_line && <p className="text-[10px] text-muted-foreground truncate">{card.type_line}</p>}
                            </div>
                            <Plus className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Result note */}
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  What does it do?
                </label>
                <Input
                  value={comboForm.result}
                  onChange={(e) => setComboForm(f => f ? { ...f, result: e.target.value } : f)}
                  placeholder="e.g. Infinite mana"
                  className="h-8 text-xs mb-3"
                />

                {/* Optional free-form details — shown under "Show details" in the viewer. */}
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Additional details <span className="text-muted-foreground/70 normal-case font-normal">(optional)</span>
                </label>
                <textarea
                  value={comboForm.details}
                  onChange={(e) => setComboForm(f => f ? { ...f, details: e.target.value } : f)}
                  placeholder="How the combo works, prerequisites, steps…"
                  rows={3}
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-xs resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mb-4"
                />

                <div className="flex items-center justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={closeForm}>Cancel</Button>
                  <Button size="sm" onClick={save} disabled={!canSave}>
                    {comboForm.editingId ? 'Save changes' : 'Add combo'}
                  </Button>
                </div>
              </div>
            </div>
          );
        })(),
        document.body
      )}
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
