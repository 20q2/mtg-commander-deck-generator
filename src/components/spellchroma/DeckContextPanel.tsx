import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { X, ChevronDown, ChevronUp, LayoutGrid, Grid3x3, Columns3, Network, Tag, List, Table2, FileText, Filter, Copy, Check, ExternalLink, ZoomIn, Plus, Layers, Bookmark } from 'lucide-react';
import type { ScryfallCard, UserCardList, DetectedCombo } from '@/types';
import { getCardImageUrl, getCardPrice } from '@/services/scryfall/client';
import { useStore } from '@/store';
import { Popover, PopoverContent, PopoverTrigger, PopoverClose } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ManaCost } from '@/components/ui/mtg-icons';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import { DeckBuildingArea } from '@/components/analyze/DeckBuildingArea';
import { TopTagsStrip } from './TopTagsStrip';
import { DeckTagGraph } from './DeckTagGraph';
import { AddCardPopover } from './AddCardPopover';
import { tagsForOracleId, aggregateDeckTags, type DeckTagCount } from '@/services/spellchroma/tagIndex';
import { isIgnoredTag } from '@/services/spellchroma/ignoredTags';
import { useCardCombos } from './useCardCombos';

type DeckView = 'cards' | 'list' | 'table' | 'text' | 'web';

// Primary card type (the noun before any subtype), e.g. "Legendary Creature — Elf" → "Creature".
function primaryType(card: ScryfallCard): string {
  const head = (card.type_line ?? '').split('—')[0].trim();
  const words = head.split(/\s+/).filter(Boolean);
  return words[words.length - 1] || '—';
}

// Full rules text for the visual Table view; joins both faces of a DFC.
function oracleText(card: ScryfallCard): string {
  if (card.oracle_text) return card.oracle_text;
  const faces = (card.card_faces ?? []).map(f => f.oracle_text).filter(Boolean) as string[];
  return faces.length ? faces.join('\n\n//\n\n') : '';
}

// Renders oracle text with inline mana-font symbols. Unlike the shared ManaText,
// this maps {T}/{Q} to their tap/untap glyphs (ms-t / ms-q don't exist).
function OracleText({ text }: { text: string }) {
  const parts = text.split(/(\{[^}]+\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\{([^}]+)\}$/.exec(part);
        if (!m) return <span key={i}>{part}</span>;
        const sym = m[1];
        const cls = sym === 'T' ? 'ms-tap' : sym === 'Q' ? 'ms-untap' : `ms-${sym.toLowerCase().replace(/\//g, '')}`;
        return <i key={i} className={`ms ${cls} ms-cost`} aria-hidden />;
      })}
    </>
  );
}

// EDHREC card-page slug, matching the rest of the app's link helpers.
function edhrecSlug(name: string): string {
  return name.split(' // ')[0].toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export interface DeckPanelMenuProps {
  userLists: UserCardList[];
  mustIncludeNames: Set<string>;
  bannedNames: Set<string>;
}

interface DeckContextPanelProps {
  cards: ScryfallCard[];
  /** The active list's sideboard cards, if any — exposed via the header switcher. */
  sideboard?: ScryfallCard[];
  /** The active list's maybeboard cards, if any — exposed via the header switcher. */
  maybeboard?: ScryfallCard[];
  topTags: DeckTagCount[];
  selectedTags: string[];
  onTagClick: (slug: string) => void;
  onRemoveTag?: (slug: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  /** Context-menu actions on a sideboard/maybeboard card (board supplied). */
  onBoardCardAction?: (card: ScryfallCard, action: CardAction, board: 'sideboard' | 'maybeboard') => void;
  /** The deck's adopted color identity — scopes the manual add-card search. */
  colorIdentity?: string[];
  /** A saved list is loaded → manual-add offers sideboard/maybeboard targets. */
  boardsEnabled?: boolean;
  menuProps?: DeckPanelMenuProps;
  /** Card name → combos it appears in, for the preview modal's combo tab. */
  cardComboMap?: Map<string, DetectedCombo[]>;
  headerExtra?: React.ReactNode;
}

/** A run of identical cards (basics stack; everything else is count 1). */
interface CardStack { card: ScryfallCard; count: number }

// Which type a card is filed under. Order matters: `land` first so manlands /
// artifact-lands file under Lands; `creature` before artifact/enchantment so
// an Artifact Creature files under Creatures.
const GROUP_MATCH = ['land', 'creature', 'planeswalker', 'instant', 'sorcery', 'artifact', 'enchantment', 'battle'] as const;
// Reading order of the sections (lands sink to the bottom).
const GROUP_ORDER = ['creature', 'planeswalker', 'instant', 'sorcery', 'artifact', 'enchantment', 'battle', 'land', 'other'] as const;
const GROUP_LABEL: Record<string, string> = {
  creature: 'Creatures', planeswalker: 'Planeswalkers', instant: 'Instants', sorcery: 'Sorceries',
  artifact: 'Artifacts', enchantment: 'Enchantments', battle: 'Battles', land: 'Lands', other: 'Other',
};

function groupKey(card: ScryfallCard): string {
  const tl = (card.type_line ?? '').toLowerCase();
  for (const k of GROUP_MATCH) if (tl.includes(k)) return k;
  return 'other';
}

/** Helpful (non-trivia) oracle tags for a card, falling back to all if that's all it has. */
function cardTags(card: ScryfallCard): string[] {
  const all = tagsForOracleId(card.oracle_id ?? '');
  const helpful = all.filter(s => !isIgnoredTag(s));
  return helpful.length ? helpful : all;
}

/**
 * SpellChroma's left pane: a *reference* view of the loaded deck. Cards are
 * grouped by card type (with counts), duplicate basics are condensed into a
 * single ×N thumbnail, and each card is heat-tinted by how many of the
 * currently-selected search tags it shares — so the deck reacts live to what
 * you're exploring. Click a card for its info + tags (which refine the search);
 * right-click for the context menu.
 */
export function DeckContextPanel({
  cards, sideboard, maybeboard, topTags, selectedTags, onTagClick, onRemoveTag, onCardAction, onBoardCardAction, colorIdentity = [], boardsEnabled = false, menuProps, cardComboMap, headerExtra,
}: DeckContextPanelProps) {
  // Both view groups remember the user's last pick across decks and sessions.
  const [view, setView] = useState<DeckView>(() => {
    const stored = localStorage.getItem('spellchroma-deck-view');
    return stored === 'cards' || stored === 'list' || stored === 'table' || stored === 'web' || stored === 'text'
      ? stored
      : 'cards';
  });
  // Cards sub-mode: our grouped thumbnail grid, or the full DeckBuildingArea playmat.
  const [cardsMode, setCardsMode] = useState<'grid' | 'builder'>(() =>
    localStorage.getItem('spellchroma-deck-cards-mode') === 'builder' ? 'builder' : 'grid',
  );
  const selectView = useCallback((next: DeckView) => {
    setView(next);
    localStorage.setItem('spellchroma-deck-view', next);
  }, []);
  const selectCardsMode = useCallback((next: 'grid' | 'builder') => {
    setCardsMode(next);
    localStorage.setItem('spellchroma-deck-cards-mode', next);
  }, []);
  // When on, hide deck cards that don't share any of the currently-selected tags
  // (e.g. select "boardwipe" to see only your board wipes). Persisted; only has an
  // effect while at least one tag is selected.
  const [tagFilter, setTagFilter] = useState(() => localStorage.getItem('spellchroma-deck-tag-filter') === 'true');
  const toggleTagFilter = useCallback(() => {
    setTagFilter(prev => {
      const next = !prev;
      localStorage.setItem('spellchroma-deck-tag-filter', String(next));
      return next;
    });
  }, []);
  const [preview, setPreview] = useState<ScryfallCard | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Which board the panel is showing. The main deck is always available; the
  // sideboard/maybeboard appear in the header switcher only once they hold cards
  // (populated from the explorer's Add buttons). If the active board empties out
  // — e.g. the list changed — fall back to the main deck.
  const [activeBoard, setActiveBoard] = useState<'main' | 'sideboard' | 'maybeboard'>('main');
  const hasSideboard = !!sideboard?.length;
  const hasMaybeboard = !!maybeboard?.length;
  useEffect(() => {
    if (activeBoard === 'sideboard' && !hasSideboard) setActiveBoard('main');
    else if (activeBoard === 'maybeboard' && !hasMaybeboard) setActiveBoard('main');
  }, [activeBoard, hasSideboard, hasMaybeboard]);
  const boardCards = activeBoard === 'sideboard' ? (sideboard ?? [])
    : activeBoard === 'maybeboard' ? (maybeboard ?? [])
    : cards;
  // `boardType` is set only on a board view; it tells DeckCard to show board-aware
  // context-menu options (remove from board, move to deck / the other board).
  const boardType = activeBoard === 'main' ? undefined : activeBoard;
  // The main deck routes through onCardAction; a board view routes through the
  // board-aware handler, binding the source board so the menu acts on the board.
  const boardCardAction = boardType
    ? (onBoardCardAction ? (card: ScryfallCard, action: CardAction) => onBoardCardAction(card, action, boardType) : undefined)
    : onCardAction;
  // The toolbar lives in a resizable panel, so viewport breakpoints can't tell us
  // when it's out of room. Instead we detect real overflow: the button cluster is a
  // flex-1 box whose clientWidth is the space it's allotted and whose scrollWidth is
  // the width its content actually wants. When the labelled buttons would overflow,
  // drop to icons; expand again once the remembered full-label width fits. Measuring
  // in a layout effect (before paint) means the brief overflow never flashes.
  const clusterRef = useRef<HTMLDivElement>(null);
  const fullWidthRef = useRef(0);
  const [clusterWidth, setClusterWidth] = useState(0);
  const [compactToolbar, setCompactToolbar] = useState(false);
  useEffect(() => {
    const el = clusterRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setClusterWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // When the present button set changes (the filter button and Grid/Builder group
  // appear conditionally), expand first so the next measure re-records the full-label
  // width from scratch rather than trusting a stale value.
  useLayoutEffect(() => {
    setCompactToolbar(false);
  }, [view, selectedTags.length]);
  // Re-evaluate on resize and after any expand above: record the full-label width
  // while expanded, collapse if it overflows, and expand again once it fits.
  useLayoutEffect(() => {
    const el = clusterRef.current;
    if (!el) return;
    if (!compactToolbar) {
      fullWidthRef.current = el.scrollWidth;
      if (el.scrollWidth > el.clientWidth) setCompactToolbar(true);
    } else if (el.clientWidth >= fullWidthRef.current) {
      setCompactToolbar(false);
    }
  }, [compactToolbar, clusterWidth, view, selectedTags.length]);
  const deckNames = useMemo(() => new Set(boardCards.map(c => c.name)), [boardCards]);
  // Main-deck names (independent of the active board) — the add-card search drops
  // cards already in the deck from its suggestions.
  const mainDeckNames = useMemo(() => new Set(cards.map(c => c.name)), [cards]);
  const previewCombos = useCardCombos(preview, deckNames, cardComboMap);
  // Top tags reflect whatever board is on screen, so the strip stays coherent
  // when you switch (the main deck keeps the already-computed prop).
  const displayTags = useMemo(
    () => (activeBoard === 'main' ? topTags : aggregateDeckTags(boardCards)),
    [activeBoard, topTags, boardCards],
  );

  // DeckBuildingArea's menu shape needs sideboard/maybeboard sets (unused here).
  const builderMenuProps = useMemo(
    () => (menuProps ? { ...menuProps, sideboardNames: new Set<string>(), maybeboardNames: new Set<string>() } : undefined),
    [menuProps],
  );
  const toggle = (key: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // The deck restricted to cards sharing a selected tag, when the tag filter is
  // active. Matched against the full tag set (not just the helpful subset) so any
  // selected tag filters correctly. Feeds every reference view except the builder
  // playmat, which always shows the whole deck for editing.
  const filterActive = tagFilter && selectedTags.length > 0;
  const visibleCards = useMemo(() => {
    if (!filterActive) return boardCards;
    const wanted = new Set(selectedTags);
    return boardCards.filter(card => tagsForOracleId(card.oracle_id ?? '').some(t => wanted.has(t)));
  }, [boardCards, filterActive, selectedTags]);

  const groups = useMemo(() => {
    const byGroup = new Map<string, Map<string, CardStack>>();
    for (const card of visibleCards) {
      const g = groupKey(card);
      let stacks = byGroup.get(g);
      if (!stacks) { stacks = new Map(); byGroup.set(g, stacks); }
      const existing = stacks.get(card.name);
      if (existing) existing.count += 1;
      else stacks.set(card.name, { card, count: 1 });
    }
    return GROUP_ORDER
      .filter(g => byGroup.has(g))
      .map(g => {
        const stacks = [...byGroup.get(g)!.values()].sort(
          (a, b) => (a.card.cmc ?? 0) - (b.card.cmc ?? 0) || a.card.name.localeCompare(b.card.name),
        );
        return { key: g, label: GROUP_LABEL[g] ?? 'Other', stacks, count: stacks.reduce((n, s) => n + s.count, 0) };
      });
  }, [visibleCards]);

  // Header board switcher: the main deck is always present; sideboard/maybeboard
  // join the menu only when populated. The caret appears only when there's more
  // than one board to choose between.
  const boardOptions = [
    { key: 'main' as const, label: 'Deck', count: cards.length, Icon: LayoutGrid, tint: '' },
    ...(hasSideboard ? [{ key: 'sideboard' as const, label: 'Sideboard', count: sideboard!.length, Icon: Layers, tint: 'text-amber-300' }] : []),
    ...(hasMaybeboard ? [{ key: 'maybeboard' as const, label: 'Maybeboard', count: maybeboard!.length, Icon: Bookmark, tint: 'text-purple-300' }] : []),
  ];
  const activeOption = boardOptions.find(o => o.key === activeBoard) ?? boardOptions[0];
  const showSwitcher = boardOptions.length > 1;
  const headerCount = filterActive ? `${visibleCards.length} / ${boardCards.length}` : boardCards.length;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-background/85">
      <div className="flex items-center gap-3 px-3 py-2 min-h-[52px] border-b border-border/30 bg-background/40">
        {headerExtra}
        {showSwitcher ? (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" title="Switch board"
                className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider whitespace-nowrap text-foreground hover:text-foreground/80 transition-colors">
                {activeOption.label} ({headerCount})
                <ChevronDown className="w-3.5 h-3.5 opacity-70" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-48 p-1">
              {boardOptions.map(opt => (
                <PopoverClose asChild key={opt.key}>
                  <button type="button" onClick={() => setActiveBoard(opt.key)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors ${
                      opt.key === activeBoard ? 'bg-accent text-foreground' : 'text-foreground/80 hover:bg-accent/60'
                    }`}>
                    <opt.Icon className={`w-3.5 h-3.5 shrink-0 ${opt.tint}`} />
                    <span className="flex-1">{opt.label}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{opt.count}</span>
                  </button>
                </PopoverClose>
              ))}
            </PopoverContent>
          </Popover>
        ) : (
          <span className="text-sm font-bold uppercase tracking-wider whitespace-nowrap">
            Deck ({headerCount})
          </span>
        )}
        {onCardAction && (
          <AddCardPopover
            colorIdentity={colorIdentity}
            boardsEnabled={boardsEnabled}
            deckNames={mainDeckNames}
            onCardAction={onCardAction}
          />
        )}
        <div ref={clusterRef} className="ml-auto flex-1 min-w-0 flex items-center justify-end gap-2 overflow-hidden">
          {/* Narrow the deck to cards that share a selected tag. Only meaningful
              once a tag is selected, so the button appears only then. */}
          {selectedTags.length > 0 && (
            <button
              type="button"
              onClick={toggleTagFilter}
              aria-pressed={tagFilter}
              title={tagFilter ? 'Showing only cards with a selected tag — click to show all' : 'Show only cards with a selected tag'}
              className={`shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border/50 transition-colors ${
                tagFilter ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground/70 hover:text-foreground hover:bg-accent/50'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              {!compactToolbar && <span className="whitespace-nowrap">Matched</span>}
            </button>
          )}
          {/* Cards sub-mode: our grouped grid, or the full DeckBuildingArea playmat. */}
          {view === 'cards' && (
            <div className="shrink-0 flex items-center border border-border/50 rounded-md overflow-hidden">
              {([['grid', 'Grid', Grid3x3], ['builder', 'Builder', Columns3]] as const).map(([key, label, Icon], i) => (
                <div key={key} className="contents">
                  {i > 0 && <div className="w-px h-4 bg-border/50" />}
                  <button type="button" onClick={() => selectCardsMode(key)} aria-pressed={cardsMode === key} title={`${label} view`}
                    className={`flex items-center text-xs px-2 py-1 transition-colors ${cardsMode === key ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground/70 hover:text-foreground hover:bg-accent/50'}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="shrink-0 flex items-center border border-border/50 rounded-md overflow-hidden">
            {([['cards', 'Cards', LayoutGrid], ['list', 'List', List], ['table', 'Table', Table2], ['web', 'Web', Network], ['text', 'Text', FileText]] as const).map(([key, label, Icon], i) => (
              <div key={key} className="contents">
                {i > 0 && <div className="w-px h-4 bg-border/50" />}
                <button type="button" onClick={() => selectView(key)} aria-pressed={view === key} title={label}
                  className={`flex items-center gap-1 text-xs px-2 py-1 transition-colors ${view === key ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground/70 hover:text-foreground hover:bg-accent/50'}`}>
                  <Icon className="w-3.5 h-3.5" />
                  {!compactToolbar && <span className="whitespace-nowrap">{label}</span>}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {view === 'cards' && cardsMode === 'builder' ? (
        <div className="flex-1 min-h-0 flex flex-col">
          {displayTags.length > 0 && (
            <div className="px-3 pt-3">
              <TopTagsStrip tags={displayTags} selected={selectedTags} onTagClick={onTagClick} onRemoveTag={onRemoveTag} />
            </div>
          )}
          <DeckBuildingArea currentCards={boardCards} onCardAction={boardCardAction} menuProps={builderMenuProps} />
        </div>
      ) : view === 'web' ? (
        <div className="flex-1 min-h-0 p-3">
          <DeckTagGraph cards={visibleCards} selectedTags={selectedTags} onTagClick={onTagClick} />
        </div>
      ) : view === 'text' ? (
        <DeckTextView cards={visibleCards} />
      ) : view === 'table' ? (
        <div className="flex flex-col gap-3 p-3 overflow-y-auto min-h-0">
          {displayTags.length > 0 && (
            <TopTagsStrip tags={displayTags} selected={selectedTags} onTagClick={onTagClick} onRemoveTag={onRemoveTag} />
          )}
          <DeckTableView
            cards={visibleCards}
            selectedTags={selectedTags}
            onTagClick={onTagClick}
            onRemoveTag={onRemoveTag}
            onCardAction={boardCardAction}
            boardType={boardType}
            menuProps={menuProps}
            onPreview={setPreview}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-3 overflow-y-auto min-h-0">
          {displayTags.length > 0 && (
            <TopTagsStrip tags={displayTags} selected={selectedTags} onTagClick={onTagClick} onRemoveTag={onRemoveTag} />
          )}
          {groups.map(group => (
            <DeckSection
              key={group.key}
              iconKey={group.key}
              label={group.label}
              count={group.count}
              stacks={group.stacks}
              layout={view === 'list' ? 'list' : 'cards'}
              collapsed={collapsed.has(group.key)}
              onToggle={() => toggle(group.key)}
              selectedTags={selectedTags}
              onTagClick={onTagClick}
              onRemoveTag={onRemoveTag}
              onCardAction={boardCardAction}
              boardType={boardType}
              menuProps={menuProps}
              onPreview={setPreview}
            />
          ))}
        </div>
      )}

      <CardPreviewModal
        card={preview}
        onClose={() => setPreview(null)}
        onTagClick={onTagClick}
        combos={previewCombos}
        cardComboMap={cardComboMap}
      />
    </div>
  );
}

function DeckSection({
  iconKey, label, count, stacks, layout = 'cards', collapsed, onToggle, selectedTags, onTagClick, onRemoveTag, onCardAction, boardType, menuProps, onPreview,
}: {
  iconKey: string;
  label: string;
  count: number;
  stacks: CardStack[];
  layout?: 'cards' | 'list';
  collapsed: boolean;
  onToggle: () => void;
  selectedTags: string[];
  onTagClick: (slug: string) => void;
  onRemoveTag?: (slug: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  boardType?: 'sideboard' | 'maybeboard';
  menuProps?: DeckPanelMenuProps;
  onPreview?: (card: ScryfallCard) => void;
}) {
  const [gridRef] = useAutoAnimate<HTMLDivElement>({ duration: 300, easing: 'cubic-bezier(0.34, 1.4, 0.5, 1)' });
  return (
    <section className="flex flex-col gap-1.5">
      <button type="button" onClick={onToggle}
        className="flex items-center gap-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80 hover:text-foreground transition-colors">
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
        {iconKey !== 'other' && <i className={`ms ms-${iconKey} text-sm not-italic text-foreground/70`} aria-hidden />}
        {label}
        <span className="text-muted-foreground/60 normal-case tracking-normal">· {count}</span>
      </button>
      {!collapsed && (
        <div
          ref={gridRef}
          className={layout === 'list'
            ? 'grid gap-x-3 gap-y-0.5 grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]'
            : 'grid gap-2 grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))]'}
        >
          {stacks.map((stack, i) => (
            <DeckCard
              key={stack.card.name}
              stack={stack}
              index={i}
              layout={layout}
              selectedTags={selectedTags}
              onTagClick={onTagClick}
              onRemoveTag={onRemoveTag}
              onCardAction={onCardAction}
              boardType={boardType}
              menuProps={menuProps}
              onPreview={onPreview}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function DeckCard({ stack, index = 0, layout = 'cards', selectedTags, onTagClick, onRemoveTag, onCardAction, boardType, menuProps, onPreview }: {
  stack: CardStack;
  index?: number;
  layout?: 'cards' | 'list' | 'table';
  selectedTags: string[];
  onTagClick: (slug: string) => void;
  onRemoveTag?: (slug: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  /** Set when this card lives in a board view → board-aware context-menu options. */
  boardType?: 'sideboard' | 'maybeboard';
  menuProps?: DeckPanelMenuProps;
  onPreview?: (card: ScryfallCard) => void;
}) {
  const { card, count } = stack;
  const [menuOpen, setMenuOpen] = useState(false);
  // Controlled so the floating hover preview can step aside while the tag
  // popover is open (otherwise the two would overlap on click).
  const [popoverOpen, setPopoverOpen] = useState(false);
  const canMenu = !!(onCardAction && menuProps);
  // Hovering a row/card floats a full-size card preview (portal'd,
  // pointer-events-none, so it never blocks the click-to-open popover).
  // A callback ref keeps one HTMLElement ref usable as either the thumbnail
  // image (cards/table) or the whole row button (list).
  const anchorRef = useRef<HTMLElement | null>(null);
  const setAnchor = (el: HTMLElement | null) => { anchorRef.current = el; };
  const [hovered, setHovered] = useState(false);
  const hoverProps = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  };

  // Not memoized on [card]: the oracle-tag index loads *after* the deck mounts,
  // so a memo keyed only on the card would cache an empty list and never refill
  // once the index arrives. Recomputing each render (a cheap map lookup) lets the
  // tags + heat ring appear when the index is ready.
  const tags = cardTags(card);
  const selected = useMemo(() => new Set(selectedTags), [selectedTags]);
  const matchCount = tags.reduce((n, s) => n + (selected.has(s) ? 1 : 0), 0);
  // With a search active, cards sharing none of the selected tags recede (hover restores).
  const dim = selectedTags.length > 0 && matchCount === 0;
  const onContextMenu = (e: React.MouseEvent) => { if (!canMenu) return; e.preventDefault(); setMenuOpen(true); };

  // Shared row styling for the list / table layouts. A match is signalled by the
  // tag chip alone — no violet backdrop/border.
  const rowBase = `w-full text-left px-2 py-1 rounded-md border border-transparent transition hover:bg-accent/40 ${dim ? 'opacity-50 hover:opacity-100' : ''}`;

  let trigger: React.ReactNode;
  if (layout === 'cards') {
    trigger = (
      <button type="button" onContextMenu={onContextMenu} {...hoverProps}
        className={`group relative aspect-[5/7] w-full rounded-lg overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-opacity duration-200 ${dim ? 'opacity-40 hover:opacity-100' : ''}`}
        title={count > 1 ? `${card.name} ×${count}` : card.name}>
        <img ref={setAnchor} src={getCardImageUrl(card, 'small') ?? ''} alt={card.name} loading="lazy"
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-200 group-hover:scale-110" />
        {count > 1 && (
          <span className="absolute bottom-1 right-1 z-10 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-background/90 text-foreground border border-border/60 shadow-sm tabular-nums">×{count}</span>
        )}
        {matchCount > 0 && (
          <span className="absolute top-1 right-1 z-10 inline-flex items-center gap-0.5 h-4 pl-1 pr-1.5 rounded-full text-[10px] font-bold bg-violet-500/90 text-violet-50 border border-violet-300/60 shadow-sm tabular-nums"
            title={`Shares ${matchCount} of your selected tag${matchCount > 1 ? 's' : ''}`}>
            <Tag className="w-2.5 h-2.5" />{matchCount}
          </span>
        )}
      </button>
    );
  } else if (layout === 'list') {
    trigger = (
      <button ref={setAnchor} type="button" onContextMenu={onContextMenu} {...hoverProps} className={`flex items-center gap-2 ${rowBase}`}
        title={count > 1 ? `${card.name} ×${count}` : card.name}>
        <span className="w-5 shrink-0 text-[11px] text-muted-foreground/70 tabular-nums text-right">{count > 1 ? `${count}×` : ''}</span>
        <span className="flex-1 min-w-0 truncate text-sm">{card.name}</span>
        {matchCount > 0 && (
          <span className="shrink-0 inline-flex items-center gap-0.5 h-4 pl-1 pr-1.5 rounded-full text-[10px] font-bold bg-violet-500/90 text-violet-50 border border-violet-300/60 tabular-nums">
            <Tag className="w-2.5 h-2.5" />{matchCount}
          </span>
        )}
        <ManaCost cost={card.mana_cost ?? card.card_faces?.[0]?.mana_cost} className="shrink-0 text-xs" />
      </button>
    );
  } else {
    // 'table' → a dense, column-aligned table row: thumbnail · name/type/oracle · MV.
    // Rows share one divided surface (see DeckTableView) so they scan as a single
    // table rather than a stack of floating cards. Columns line up with the header.
    const oracle = oracleText(card);
    trigger = (
      <button type="button" onContextMenu={onContextMenu}
        className={`grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-start gap-3 w-full text-left px-3 py-2.5 transition-colors hover:bg-accent/40 ${dim ? 'opacity-50 hover:opacity-100' : ''}`}
        title={card.name}>
        <img ref={setAnchor} {...hoverProps} src={getCardImageUrl(card, 'small') ?? ''} alt={card.name} loading="lazy"
          className="w-11 shrink-0 rounded-[3px] aspect-[5/7] object-cover bg-muted/40 ring-1 ring-border/40" />
        <div className="min-w-0 self-center">
          <span className="block font-semibold text-sm leading-tight truncate">
            {card.name}{count > 1 && <span className="text-muted-foreground font-normal"> ×{count}</span>}
          </span>
          {card.type_line && <p className="text-[11px] text-muted-foreground truncate">{card.type_line}</p>}
          {oracle && (
            <p className="mt-1 text-xs leading-snug text-foreground/80 whitespace-pre-wrap line-clamp-3">
              <OracleText text={oracle} />
            </p>
          )}
          {matchCount > 0 && (
            <span className="mt-1.5 inline-flex items-center gap-0.5 h-4 pl-1 pr-1.5 rounded-full text-[10px] font-bold bg-violet-500/90 text-violet-50 border border-violet-300/60 tabular-nums">
              <Tag className="w-2.5 h-2.5" />{matchCount}
            </span>
          )}
        </div>
        <ManaCost cost={card.mana_cost ?? card.card_faces?.[0]?.mana_cost} className="shrink-0 justify-self-end self-center text-xs" />
      </button>
    );
  }

  return (
    <div
      className={
        layout === 'cards'
          ? 'relative animate-sc-card-in'
          // Zebra striping reinforces the table grid (odd rows faintly tinted).
          : layout === 'table'
            ? `relative ${index % 2 === 1 ? 'bg-foreground/[0.025]' : ''}`
            : 'relative'
      }
      style={layout === 'cards' ? { animationDelay: `${Math.min(index, 22) * 16}ms` } : undefined}
    >
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <CardTagPopoverContent card={card} count={count} tags={tags} selected={selected} onTagClick={onTagClick} onRemoveTag={onRemoveTag} onPreview={onPreview} />
      </Popover>
      {hovered && !popoverOpen && <MagnifiedPreview card={card} anchorRef={anchorRef} side="right" width={250} z={40} />}
      {canMenu && (
        <span
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-0"
          onClick={(e) => e.stopPropagation()}
          aria-hidden
        >
          <CardContextMenu
            card={card}
            onAction={onCardAction!}
            hasRemove
            hasAddToDeck={!!boardType}
            hasSideboard={boardType === 'maybeboard'}
            hasMaybeboard={boardType === 'sideboard'}
            isMustInclude={menuProps!.mustIncludeNames.has(card.name)}
            isBanned={menuProps!.bannedNames.has(card.name)}
            userLists={menuProps!.userLists}
            forceOpen={menuOpen}
            onForceClose={() => setMenuOpen(false)}
          />
        </span>
      )}
    </div>
  );
}

// Shared card preview + tag chips, used by every deck view's popover (and the
// SpellChroma explorer, so both sides look identical).
export function CardTagPopoverContent({ card, count, tags, selected, onTagClick, onRemoveTag, onPreview, onAddToDeck, onAddToSideboard, onAddToMaybeboard }: {
  card: ScryfallCard;
  count: number;
  tags: string[];
  selected: Set<string>;
  onTagClick: (slug: string) => void;
  onRemoveTag?: (slug: string) => void;
  onPreview?: (card: ScryfallCard) => void;
  /** When provided, a quick "Add to deck" button is shown (used by the explorer). */
  onAddToDeck?: (card: ScryfallCard) => void;
  /** When provided (a saved list is loaded), stacked board buttons share the add row. */
  onAddToSideboard?: (card: ScryfallCard) => void;
  onAddToMaybeboard?: (card: ScryfallCard) => void;
}) {
  const scryfallUrl = `https://scryfall.com/search?q=!%22${encodeURIComponent(card.name)}%22`;
  const edhrecUrl = `https://edhrec.com/cards/${edhrecSlug(card.name)}`;
  const currency = useStore((s) => s.customization.currency);
  const price = getCardPrice(card, currency);
  const sym = currency === 'EUR' ? '€' : '$';
  return (
    <PopoverContent side="right" align="start" className="w-80 p-0 overflow-hidden max-h-[80vh] overflow-y-auto border-2 border-violet-400/40 ring-1 ring-violet-500/10 shadow-2xl shadow-violet-950/40">
      <div className="relative animate-preview-pop">
        <PopoverClose
          className="absolute top-2 right-2 z-10 inline-flex items-center justify-center w-7 h-7 rounded-full bg-background/80 text-foreground/80 border border-border shadow-sm hover:bg-background hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </PopoverClose>
        {/* Click the image to open the full card preview (closes this popover). */}
        <PopoverClose asChild>
          <button
            type="button"
            onClick={() => onPreview?.(card)}
            title="Open full preview"
            className="group/img relative block w-full cursor-zoom-in"
          >
            <img src={getCardImageUrl(card, 'normal') ?? ''} alt={card.name}
              className="mx-auto block w-auto max-h-52 pt-3 transition group-hover/img:brightness-75" />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity">
              <span className="inline-flex items-center gap-1 rounded-full bg-background/85 border border-border/60 px-2.5 py-1 text-[11px] font-medium shadow">
                <ZoomIn className="w-3.5 h-3.5" /> Preview
              </span>
            </span>
          </button>
        </PopoverClose>
        <div className="mt-3 border-t border-border" />
        <div className="p-3 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">{card.name}{count > 1 && <span className="text-muted-foreground font-normal"> ×{count}</span>}</p>
              {card.type_line && <p className="text-xs text-muted-foreground">{card.type_line}</p>}
            </div>
            {price && <p className="text-xs font-medium text-muted-foreground/90 whitespace-nowrap shrink-0">{sym}{price}</p>}
          </div>
          {/* Quick add (explorer only — closes the popover after adding). When a
              saved list is loaded, a big "Add to deck" shares the row with a
              stacked Sideboard / Maybeboard pair on the right. */}
          {onAddToDeck && (
            <div className="flex items-stretch gap-1">
              <PopoverClose asChild>
                <button type="button" onClick={() => onAddToDeck(card)}
                  className="flex-[2] inline-flex items-center justify-center gap-1.5 min-h-[2.5rem] rounded-md bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors">
                  <Plus className="w-4 h-4" /> Add to deck
                </button>
              </PopoverClose>
              {(onAddToSideboard || onAddToMaybeboard) && (
                <div className="flex-1 flex flex-col gap-1">
                  {onAddToSideboard && (
                    <PopoverClose asChild>
                      <button type="button" onClick={() => onAddToSideboard(card)} title="Add to sideboard"
                        className="flex-1 inline-flex items-center justify-center gap-1 h-[1.2rem] min-h-[1.2rem] px-1.5 rounded-md border border-violet-500/50 text-violet-100/90 text-[11px] font-medium hover:bg-violet-500/15 transition-colors">
                        <Layers className="w-3 h-3 text-amber-300 shrink-0" /> Sideboard
                      </button>
                    </PopoverClose>
                  )}
                  {onAddToMaybeboard && (
                    <PopoverClose asChild>
                      <button type="button" onClick={() => onAddToMaybeboard(card)} title="Add to maybeboard"
                        className="flex-1 inline-flex items-center justify-center gap-1 h-[1.2rem] min-h-[1.2rem] px-1.5 rounded-md border border-violet-500/50 text-violet-100/90 text-[11px] font-medium hover:bg-violet-500/15 transition-colors">
                        <Bookmark className="w-3 h-3 text-purple-300 shrink-0" /> Maybeboard
                      </button>
                    </PopoverClose>
                  )}
                </div>
              )}
            </div>
          )}
          {/* Open the card on external resources. */}
          <div className="flex items-center gap-1.5">
            <a href={scryfallUrl} target="_blank" rel="noopener noreferrer" title="Open on Scryfall"
              className="flex-1 inline-flex items-center justify-center gap-1 h-7 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <ExternalLink className="w-3 h-3" /> Scryfall
            </a>
            <a href={edhrecUrl} target="_blank" rel="noopener noreferrer" title="Open on EDHREC"
              className="flex-1 inline-flex items-center justify-center gap-1 h-7 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <ExternalLink className="w-3 h-3" /> EDHREC
            </a>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-violet-300/90 mb-1.5">Tags · click to refine your search</p>
            {tags.length === 0 ? (
              <p className="text-xs text-muted-foreground">No oracle tags for this card.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {tags.map(slug => {
                  const active = selected.has(slug);
                  return (
                    <button
                      key={slug}
                      type="button"
                      onClick={() => (active ? onRemoveTag?.(slug) : onTagClick(slug))}
                      title={active ? `Remove “${slug}” from search` : `Add “${slug}” to search`}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                        active
                          ? 'bg-violet-500/30 text-violet-100 border-violet-400/70'
                          : 'bg-violet-500/12 text-violet-100/90 border-violet-500/45 hover:bg-violet-500/25'
                      }`}
                    >
                      <Tag className="w-3 h-3 opacity-70" />
                      {slug}
                      {active && <X className="w-3 h-3" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </PopoverContent>
  );
}

type TableSort = 'name' | 'mv' | 'type' | 'matches';

// Flat, sortable table of the deck. Click a header to sort (re-click flips dir).
function DeckTableView({ cards, selectedTags, onTagClick, onRemoveTag, onCardAction, boardType, menuProps, onPreview }: {
  cards: ScryfallCard[];
  selectedTags: string[];
  onTagClick: (slug: string) => void;
  onRemoveTag?: (slug: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  boardType?: 'sideboard' | 'maybeboard';
  menuProps?: DeckPanelMenuProps;
  onPreview?: (card: ScryfallCard) => void;
}) {
  const [sortKey, setSortKey] = useState<TableSort>('name');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [listRef] = useAutoAnimate<HTMLDivElement>({ duration: 220, easing: 'ease-in-out' });
  const selected = useMemo(() => new Set(selectedTags), [selectedTags]);

  const rows = useMemo(() => {
    const map = new Map<string, CardStack>();
    for (const c of cards) {
      const e = map.get(c.name);
      if (e) e.count += 1; else map.set(c.name, { card: c, count: 1 });
    }
    const matches = (s: CardStack) => cardTags(s.card).reduce((n, t) => n + (selected.has(t) ? 1 : 0), 0);
    const sign = dir === 'asc' ? 1 : -1;
    return [...map.values()].sort((a, b) => {
      let d = 0;
      if (sortKey === 'name') d = a.card.name.localeCompare(b.card.name);
      else if (sortKey === 'mv') d = (a.card.cmc ?? 0) - (b.card.cmc ?? 0);
      else if (sortKey === 'type') d = primaryType(a.card).localeCompare(primaryType(b.card));
      else d = matches(a) - matches(b);
      return sign * d || a.card.name.localeCompare(b.card.name);
    });
  }, [cards, selected, sortKey, dir]);

  const Th = ({ k, label, className = '' }: { k: TableSort; label: React.ReactNode; className?: string }) => (
    <button
      type="button"
      onClick={() => {
        if (sortKey === k) setDir(d => (d === 'asc' ? 'desc' : 'asc'));
        else { setSortKey(k); setDir(k === 'mv' || k === 'matches' ? 'desc' : 'asc'); }
      }}
      className={`inline-flex items-center gap-0.5 transition-colors ${className} ${sortKey === k ? 'text-foreground' : 'hover:text-foreground'}`}
    >
      {label}
      {sortKey === k && (dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
    </button>
  );

  // One bounded surface: a sticky, column-aligned header over hairline-divided
  // rows. The header columns line up with the row grid below, and it sticks to
  // the top of the scroll area so you keep the sort controls while scrolling.
  // (No overflow-hidden here — that would trap the sticky header.)
  return (
    <div className="rounded-lg border border-border/50 bg-card/20">
      <div className="sticky top-0 z-10 grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 rounded-t-lg border-b border-border/60 bg-muted/70 backdrop-blur-sm text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        <span aria-hidden />
        <Th k="name" label="Card" />
        <div className="flex items-center gap-2 justify-self-end">
          <Th k="type" label="Type" />
          <span aria-hidden className="text-border">·</span>
          <Th k="matches" label={<Tag className="w-3 h-3" />} />
          <span aria-hidden className="text-border">·</span>
          <Th k="mv" label="MV" />
        </div>
      </div>
      <div ref={listRef} className="divide-y divide-border/30">
        {rows.map((stack, i) => (
          <DeckCard
            key={stack.card.name}
            stack={stack}
            index={i}
            layout="table"
            selectedTags={selectedTags}
            onTagClick={onTagClick}
            onRemoveTag={onRemoveTag}
            onCardAction={onCardAction}
            boardType={boardType}
            menuProps={menuProps}
            onPreview={onPreview}
          />
        ))}
      </div>
    </div>
  );
}

// Plain-text decklist (qty + name) for copy-out to Moxfield / Archidekt / etc.
function DeckTextView({ cards }: { cards: ScryfallCard[] }) {
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of cards) map.set(c.name, (map.get(c.name) ?? 0) + 1);
    return [...map.entries()].map(([name, n]) => `${n} ${name}`).join('\n');
  }, [cards]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{cards.length} cards · paste into Moxfield, Archidekt, etc.</p>
        <Button variant="outline" size="sm" onClick={copy} className="gap-1.5">
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <textarea
        readOnly
        value={text}
        onFocus={e => e.currentTarget.select()}
        className="flex-1 min-h-[200px] w-full text-xs font-mono rounded-md bg-background border border-border/60 p-3 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
      />
    </div>
  );
}
