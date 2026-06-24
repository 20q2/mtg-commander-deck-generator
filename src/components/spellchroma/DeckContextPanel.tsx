import { useMemo, useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { X, ChevronDown, ChevronUp, LayoutGrid, Network, Tag, List, Table2, FileText, Copy, Check, ExternalLink, ZoomIn } from 'lucide-react';
import type { ScryfallCard, UserCardList } from '@/types';
import { getCardImageUrl } from '@/services/scryfall/client';
import { Popover, PopoverContent, PopoverTrigger, PopoverClose } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ManaCost } from '@/components/ui/mtg-icons';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import { TopTagsStrip } from './TopTagsStrip';
import { DeckTagGraph } from './DeckTagGraph';
import { tagsForOracleId, type DeckTagCount } from '@/services/spellchroma/tagIndex';
import { isIgnoredTag } from '@/services/spellchroma/ignoredTags';

type DeckView = 'cards' | 'list' | 'table' | 'text' | 'web';

// Shared grid template for the Table view (header + rows align to it).
const TABLE_COLS = 'grid grid-cols-[1fr_2.25rem_4.5rem_2.5rem] items-center gap-2';

// Primary card type (the noun before any subtype), e.g. "Legendary Creature — Elf" → "Creature".
function primaryType(card: ScryfallCard): string {
  const head = (card.type_line ?? '').split('—')[0].trim();
  const words = head.split(/\s+/).filter(Boolean);
  return words[words.length - 1] || '—';
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
  topTags: DeckTagCount[];
  selectedTags: string[];
  onTagClick: (slug: string) => void;
  onRemoveTag?: (slug: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: DeckPanelMenuProps;
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
  cards, topTags, selectedTags, onTagClick, onRemoveTag, onCardAction, menuProps, headerExtra,
}: DeckContextPanelProps) {
  const [view, setView] = useState<DeckView>('cards');
  const [preview, setPreview] = useState<ScryfallCard | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const groups = useMemo(() => {
    const byGroup = new Map<string, Map<string, CardStack>>();
    for (const card of cards) {
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
  }, [cards]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-background/85">
      <div className="flex items-center gap-3 px-3 py-2 min-h-[52px] border-b border-border/30 bg-background/40">
        {headerExtra}
        <span className="text-sm font-bold uppercase tracking-wider whitespace-nowrap">
          Deck ({cards.length})
        </span>
        <div className="ml-auto flex items-center border border-border/50 rounded-md overflow-hidden">
          {([['cards', 'Cards', LayoutGrid], ['list', 'List', List], ['table', 'Table', Table2], ['text', 'Text', FileText], ['web', 'Web', Network]] as const).map(([key, label, Icon], i) => (
            <div key={key} className="contents">
              {i > 0 && <div className="w-px h-4 bg-border/50" />}
              <button type="button" onClick={() => setView(key)} aria-pressed={view === key} title={label}
                className={`flex items-center gap-1 text-xs px-2 py-1 transition-colors ${view === key ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground/70 hover:text-foreground hover:bg-accent/50'}`}>
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {view === 'web' ? (
        <div className="flex-1 min-h-0 p-3">
          <DeckTagGraph cards={cards} selectedTags={selectedTags} onTagClick={onTagClick} />
        </div>
      ) : view === 'text' ? (
        <DeckTextView cards={cards} />
      ) : view === 'table' ? (
        <div className="flex flex-col gap-3 p-3 overflow-y-auto min-h-0">
          {topTags.length > 0 && (
            <TopTagsStrip tags={topTags} selected={selectedTags} onTagClick={onTagClick} onRemoveTag={onRemoveTag} />
          )}
          <DeckTableView
            cards={cards}
            selectedTags={selectedTags}
            onTagClick={onTagClick}
            onRemoveTag={onRemoveTag}
            onCardAction={onCardAction}
            menuProps={menuProps}
            onPreview={setPreview}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-3 overflow-y-auto min-h-0">
          {topTags.length > 0 && (
            <TopTagsStrip tags={topTags} selected={selectedTags} onTagClick={onTagClick} onRemoveTag={onRemoveTag} />
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
              onCardAction={onCardAction}
              menuProps={menuProps}
              onPreview={setPreview}
            />
          ))}
        </div>
      )}

      <CardPreviewModal card={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function DeckSection({
  iconKey, label, count, stacks, layout = 'cards', collapsed, onToggle, selectedTags, onTagClick, onRemoveTag, onCardAction, menuProps, onPreview,
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
              menuProps={menuProps}
              onPreview={onPreview}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// Synergy heat ring keyed on how many selected tags a card shares.
function heatClass(n: number): string {
  if (n <= 0) return '';
  if (n === 1) return 'ring-1 ring-violet-400/45';
  if (n === 2) return 'ring-2 ring-violet-400/70 shadow-[0_0_12px_-2px_rgba(139,92,246,0.6)]';
  return 'ring-2 ring-violet-300/90 shadow-[0_0_16px_-1px_rgba(139,92,246,0.85)]';
}

function DeckCard({ stack, index = 0, layout = 'cards', selectedTags, onTagClick, onRemoveTag, onCardAction, menuProps, onPreview }: {
  stack: CardStack;
  index?: number;
  layout?: 'cards' | 'list' | 'table';
  selectedTags: string[];
  onTagClick: (slug: string) => void;
  onRemoveTag?: (slug: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: DeckPanelMenuProps;
  onPreview?: (card: ScryfallCard) => void;
}) {
  const { card, count } = stack;
  const [menuOpen, setMenuOpen] = useState(false);
  const canMenu = !!(onCardAction && menuProps);

  const tags = useMemo(() => cardTags(card), [card]);
  const selected = useMemo(() => new Set(selectedTags), [selectedTags]);
  const matchCount = useMemo(() => tags.reduce((n, s) => n + (selected.has(s) ? 1 : 0), 0), [tags, selected]);
  // With a search active, cards sharing none of the selected tags recede (hover restores).
  const dim = selectedTags.length > 0 && matchCount === 0;
  const onContextMenu = (e: React.MouseEvent) => { if (!canMenu) return; e.preventDefault(); setMenuOpen(true); };

  // Shared row styling for the list / table layouts.
  const rowBase = `w-full text-left px-2 py-1 rounded-md border transition ${
    matchCount > 0 ? 'border-violet-400/40 bg-violet-500/10 hover:bg-violet-500/20' : 'border-transparent hover:bg-accent/40'
  } ${dim ? 'opacity-50 hover:opacity-100' : ''}`;

  let trigger: React.ReactNode;
  if (layout === 'cards') {
    trigger = (
      <button type="button" onContextMenu={onContextMenu}
        className={`group relative aspect-[5/7] w-full rounded-lg overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-[transform,opacity] duration-200 hover:-translate-y-0.5 hover:scale-[1.04] hover:shadow-[0_8px_22px_-8px_rgba(0,0,0,0.7)] ${heatClass(matchCount)} ${dim ? 'opacity-40 hover:opacity-100' : ''}`}
        title={count > 1 ? `${card.name} ×${count}` : card.name}>
        <img src={getCardImageUrl(card, 'small') ?? ''} alt={card.name} loading="lazy"
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-200 group-hover:scale-105" />
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
      <button type="button" onContextMenu={onContextMenu} className={`flex items-center gap-2 ${rowBase}`}
        title={count > 1 ? `${card.name} ×${count}` : card.name}>
        <span className="w-5 shrink-0 text-[11px] text-muted-foreground/70 tabular-nums text-right">{count > 1 ? `${count}×` : ''}</span>
        <span className="flex-1 min-w-0 truncate text-sm">{card.name}</span>
        <ManaCost cost={card.mana_cost ?? card.card_faces?.[0]?.mana_cost} className="shrink-0 text-xs" />
        {matchCount > 0 && (
          <span className="shrink-0 inline-flex items-center gap-0.5 h-4 pl-1 pr-1.5 rounded-full text-[10px] font-bold bg-violet-500/90 text-violet-50 border border-violet-300/60 tabular-nums">
            <Tag className="w-2.5 h-2.5" />{matchCount}
          </span>
        )}
      </button>
    );
  } else {
    trigger = (
      <button type="button" onContextMenu={onContextMenu} className={`${TABLE_COLS} ${rowBase}`} title={card.name}>
        <span className="min-w-0 truncate text-sm">{card.name}{count > 1 && <span className="text-muted-foreground"> ×{count}</span>}</span>
        <span className="text-xs text-muted-foreground tabular-nums text-center">{card.cmc ?? 0}</span>
        <span className="text-xs text-muted-foreground truncate">{primaryType(card)}</span>
        <span className="text-center">
          {matchCount > 0
            ? <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-violet-200"><Tag className="w-2.5 h-2.5" />{matchCount}</span>
            : <span className="text-muted-foreground/40 text-xs">–</span>}
        </span>
      </button>
    );
  }

  return (
    <div
      className={layout === 'cards' ? 'relative animate-sc-card-in' : 'relative'}
      style={layout === 'cards' ? { animationDelay: `${Math.min(index, 22) * 16}ms` } : undefined}
    >
      <Popover>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <CardTagPopoverContent card={card} count={count} tags={tags} selected={selected} onTagClick={onTagClick} onRemoveTag={onRemoveTag} onPreview={onPreview} />
      </Popover>
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

// Shared card preview + tag chips, used by every deck view's popover.
function CardTagPopoverContent({ card, count, tags, selected, onTagClick, onRemoveTag, onPreview }: {
  card: ScryfallCard;
  count: number;
  tags: string[];
  selected: Set<string>;
  onTagClick: (slug: string) => void;
  onRemoveTag?: (slug: string) => void;
  onPreview?: (card: ScryfallCard) => void;
}) {
  const scryfallUrl = `https://scryfall.com/search?q=!%22${encodeURIComponent(card.name)}%22`;
  const edhrecUrl = `https://edhrec.com/cards/${edhrecSlug(card.name)}`;
  return (
    <PopoverContent side="right" align="start" className="w-80 p-0 overflow-hidden max-h-[80vh] overflow-y-auto">
      <div className="relative animate-preview-pop">
        <PopoverClose
          className="absolute top-2 right-2 z-10 inline-flex items-center justify-center w-7 h-7 rounded-full bg-background/80 text-foreground/80 border border-border/60 shadow-sm hover:bg-background hover:text-foreground transition-colors"
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
        <div className="mt-3 border-t border-border/50" />
        <div className="p-3 flex flex-col gap-2">
          <div>
            <p className="text-sm font-semibold leading-tight">{card.name}{count > 1 && <span className="text-muted-foreground font-normal"> ×{count}</span>}</p>
            {card.type_line && <p className="text-xs text-muted-foreground">{card.type_line}</p>}
          </div>
          {/* Open the card on external resources. */}
          <div className="flex items-center gap-1.5">
            <a href={scryfallUrl} target="_blank" rel="noopener noreferrer" title="Open on Scryfall"
              className="flex-1 inline-flex items-center justify-center gap-1 h-7 rounded-md border border-border/60 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <ExternalLink className="w-3 h-3" /> Scryfall
            </a>
            <a href={edhrecUrl} target="_blank" rel="noopener noreferrer" title="Open on EDHREC"
              className="flex-1 inline-flex items-center justify-center gap-1 h-7 rounded-md border border-border/60 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
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
                          ? 'bg-violet-500/30 text-violet-100 border-violet-400/50'
                          : 'bg-violet-500/12 text-violet-100/90 border-violet-500/25 hover:bg-violet-500/25'
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
function DeckTableView({ cards, selectedTags, onTagClick, onRemoveTag, onCardAction, menuProps, onPreview }: {
  cards: ScryfallCard[];
  selectedTags: string[];
  onTagClick: (slug: string) => void;
  onRemoveTag?: (slug: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
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
      className={`inline-flex items-center gap-0.5 ${className} ${sortKey === k ? 'text-foreground' : 'hover:text-foreground'}`}
    >
      {label}
      {sortKey === k && (dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
    </button>
  );

  return (
    <div className="flex flex-col gap-1">
      <div className={`${TABLE_COLS} px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 border-b border-border/40`}>
        <Th k="name" label="Name" />
        <Th k="mv" label="MV" className="justify-center" />
        <Th k="type" label="Type" />
        <Th k="matches" label={<Tag className="w-3 h-3" />} className="justify-center" />
      </div>
      <div ref={listRef} className="flex flex-col gap-0.5">
        {rows.map(stack => (
          <DeckCard
            key={stack.card.name}
            stack={stack}
            layout="table"
            selectedTags={selectedTags}
            onTagClick={onTagClick}
            onRemoveTag={onRemoveTag}
            onCardAction={onCardAction}
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
