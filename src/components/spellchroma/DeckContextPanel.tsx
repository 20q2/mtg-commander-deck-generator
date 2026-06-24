import { useMemo, useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { X, ChevronDown, LayoutGrid, Network, Tag } from 'lucide-react';
import type { ScryfallCard, UserCardList } from '@/types';
import { getCardImageUrl } from '@/services/scryfall/client';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import { TopTagsStrip } from './TopTagsStrip';
import { DeckTagGraph } from './DeckTagGraph';
import { tagsForOracleId, type DeckTagCount } from '@/services/spellchroma/tagIndex';
import { isIgnoredTag } from '@/services/spellchroma/ignoredTags';

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
  const [view, setView] = useState<'cards' | 'web'>('cards');
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
      <div className="flex items-center gap-2 px-3 py-2 min-h-[52px] border-b border-border/30 bg-background/40">
        {headerExtra}
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center border border-border/50 rounded-md overflow-hidden">
            {([['cards', 'Cards', LayoutGrid], ['web', 'Web', Network]] as const).map(([key, label, Icon], i) => (
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
          <span className="text-sm font-bold uppercase tracking-wider whitespace-nowrap">
            Deck ({cards.length})
          </span>
        </div>
      </div>

      {view === 'web' ? (
        <div className="flex-1 min-h-0 p-3">
          <DeckTagGraph cards={cards} selectedTags={selectedTags} onTagClick={onTagClick} />
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-3 overflow-y-auto min-h-0">
          {topTags.length > 0 && (
            <TopTagsStrip tags={topTags} selected={selectedTags} onTagClick={onTagClick} />
          )}
          {groups.map(group => (
            <DeckSection
              key={group.key}
              iconKey={group.key}
              label={group.label}
              count={group.count}
              stacks={group.stacks}
              collapsed={collapsed.has(group.key)}
              onToggle={() => toggle(group.key)}
              selectedTags={selectedTags}
              onTagClick={onTagClick}
              onRemoveTag={onRemoveTag}
              onCardAction={onCardAction}
              menuProps={menuProps}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DeckSection({
  iconKey, label, count, stacks, collapsed, onToggle, selectedTags, onTagClick, onRemoveTag, onCardAction, menuProps,
}: {
  iconKey: string;
  label: string;
  count: number;
  stacks: CardStack[];
  collapsed: boolean;
  onToggle: () => void;
  selectedTags: string[];
  onTagClick: (slug: string) => void;
  onRemoveTag?: (slug: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: DeckPanelMenuProps;
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
        <div ref={gridRef} className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))]">
          {stacks.map((stack, i) => (
            <DeckCard
              key={stack.card.name}
              stack={stack}
              index={i}
              selectedTags={selectedTags}
              onTagClick={onTagClick}
              onRemoveTag={onRemoveTag}
              onCardAction={onCardAction}
              menuProps={menuProps}
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

function DeckCard({ stack, index, selectedTags, onTagClick, onRemoveTag, onCardAction, menuProps }: {
  stack: CardStack;
  index: number;
  selectedTags: string[];
  onTagClick: (slug: string) => void;
  onRemoveTag?: (slug: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: DeckPanelMenuProps;
}) {
  const { card, count } = stack;
  const [menuOpen, setMenuOpen] = useState(false);
  const canMenu = !!(onCardAction && menuProps);

  const tags = useMemo(() => cardTags(card), [card]);
  const selected = new Set(selectedTags);
  const matchCount = useMemo(() => tags.reduce((n, s) => n + (selected.has(s) ? 1 : 0), 0), [tags, selectedTags]);

  return (
    <div className="relative animate-sc-card-in" style={{ animationDelay: `${Math.min(index, 22) * 16}ms` }}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            onContextMenu={(e) => { if (!canMenu) return; e.preventDefault(); setMenuOpen(true); }}
            className={`group relative aspect-[5/7] w-full rounded-lg overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-transform duration-200 hover:-translate-y-0.5 hover:scale-[1.04] hover:shadow-[0_8px_22px_-8px_rgba(0,0,0,0.7)] ${heatClass(matchCount)}`}
            title={count > 1 ? `${card.name} ×${count}` : card.name}
          >
            <img
              src={getCardImageUrl(card, 'small') ?? ''}
              alt={card.name}
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
            />
            {count > 1 && (
              <span className="absolute bottom-1 right-1 z-10 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-background/90 text-foreground border border-border/60 shadow-sm tabular-nums">
                ×{count}
              </span>
            )}
            {matchCount > 0 && (
              <span className="absolute top-1 right-1 z-10 inline-flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full text-[10px] font-bold bg-violet-500/90 text-violet-50 border border-violet-300/60 shadow-sm tabular-nums"
                title={`Shares ${matchCount} of your selected tag${matchCount > 1 ? 's' : ''}`}>
                {matchCount}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-64 p-0 overflow-hidden max-h-[80vh] overflow-y-auto">
          <img src={getCardImageUrl(card, 'normal') ?? ''} alt={card.name} className="w-full block" />
          <div className="p-3 flex flex-col gap-2">
            <div>
              <p className="text-sm font-semibold leading-tight">{card.name}{count > 1 && <span className="text-muted-foreground font-normal"> ×{count}</span>}</p>
              {card.type_line && <p className="text-xs text-muted-foreground">{card.type_line}</p>}
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
        </PopoverContent>
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
