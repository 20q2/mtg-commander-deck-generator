import { useMemo, useState } from 'react';
import type { ScryfallCard, UserCardList } from '@/types';
import { getCardImageUrl } from '@/services/scryfall/client';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import { ColorIdentity } from '@/components/ui/mtg-icons';
import { TopTagsStrip } from './TopTagsStrip';
import type { DeckTagCount } from '@/services/spellchroma/tagIndex';

export interface DeckPanelMenuProps {
  userLists: UserCardList[];
  mustIncludeNames: Set<string>;
  bannedNames: Set<string>;
}

interface DeckContextPanelProps {
  cards: ScryfallCard[];
  colorIdentity: string[];
  topTags: DeckTagCount[];
  selectedTags: string[];
  onTagClick: (slug: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: DeckPanelMenuProps;
  headerExtra?: React.ReactNode;
}

/**
 * SpellChroma's left pane: a lightweight *reference* view of the loaded deck —
 * header (count + color identity + "Change deck"), the deck's top-tags strip
 * (the bridge to the explorer), and a flat CMC-sorted thumbnail grid. Click a
 * card to preview; right-click for the context menu (remove / add-to-list).
 * This is deliberately NOT the full DeckBuildingArea — no group/sort/lands UI.
 */
export function DeckContextPanel({
  cards, colorIdentity, topTags, selectedTags, onTagClick, onCardAction, menuProps, headerExtra,
}: DeckContextPanelProps) {
  const [preview, setPreview] = useState<ScryfallCard | null>(null);

  const sorted = useMemo(
    () => [...cards].sort((a, b) => (a.cmc ?? 0) - (b.cmc ?? 0) || a.name.localeCompare(b.name)),
    [cards],
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-background/85">
      <div className="flex items-center gap-2 px-3 py-2 min-h-[52px] border-b border-border/30 bg-background/40">
        {headerExtra}
        <span className="text-sm font-bold uppercase tracking-wider whitespace-nowrap">
          Deck ({cards.length})
        </span>
        {colorIdentity.length > 0 && <ColorIdentity colors={colorIdentity} size="sm" />}
      </div>

      <div className="flex flex-col gap-3 p-3 overflow-y-auto min-h-0">
        {topTags.length > 0 && (
          <TopTagsStrip tags={topTags} selected={selectedTags} onTagClick={onTagClick} />
        )}
        <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))]">
          {sorted.map(card => (
            <DeckCard
              key={card.id}
              card={card}
              onSelect={setPreview}
              onCardAction={onCardAction}
              menuProps={menuProps}
            />
          ))}
        </div>
      </div>

      <CardPreviewModal card={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function DeckCard({ card, onSelect, onCardAction, menuProps }: {
  card: ScryfallCard;
  onSelect: (c: ScryfallCard) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: DeckPanelMenuProps;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const canMenu = !!(onCardAction && menuProps);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onSelect(card)}
        onContextMenu={(e) => { if (!canMenu) return; e.preventDefault(); setMenuOpen(true); }}
        className="group relative aspect-[5/7] w-full rounded-lg overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        title={card.name}
      >
        <img
          src={getCardImageUrl(card, 'small') ?? ''}
          alt={card.name}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
        />
      </button>
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
