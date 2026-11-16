import { useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import { useStore } from '@/store';
import { useUserLists } from '@/hooks/useUserLists';
import { searchCards, getCardImageUrl } from '@/services/scryfall/client';
import { loadTaggerData } from '@/services/tagger/client';
import { landKind, isFetchLand, fetchedColors, type LandKind } from '@/services/deckBuilder/landMix';
import type { ScryfallCard } from '@/types';

const PER_GROUP = 6;
const CLOSE_DELAY_MS = 150;

/**
 * The most-played non-basics in the commander's colors, sorted into the same four groups the
 * generator uses — so the examples show what each group actually means for this deck.
 */
function useLandExamples(colors: string[], enabled: boolean) {
  const key = [...colors].sort().join('');
  return useQuery({
    queryKey: ['land-group-examples', key],
    enabled,
    staleTime: Infinity,
    queryFn: async () => {
      await loadTaggerData(); // utility detection reads the tagger's utility-land tag
      const [lands, spellLands] = await Promise.all([
        searchCards('t:land -t:basic', colors),
        searchCards('is:mdfc t:land', colors),
      ]);
      const out: Record<LandKind, ScryfallCard[]> = { fixing: [], mdfc: [], utility: [], other: [] };
      const fetches: Record<LandKind, number> = { fixing: 0, mdfc: 0, utility: 0, other: 0 };
      for (const card of [...lands.data, ...spellLands.data]) {
        // Rainbow lands are dropped from mono decks by the generator; don't offer them as examples.
        const rainbow = new Set((card.produced_mana ?? []).filter(c => 'WUBRG'.includes(c))).size >= 2;
        if (colors.length < 2 && rainbow) continue;
        // Fetches are played everywhere, so popularity alone would fill every group with them.
        // Skip ones that can't find any of your colors, and show at most two per group.
        const fetch = isFetchLand(card);
        if (fetch && fetchedColors(card, colors) === 0) continue;
        const kind = landKind(card, colors);
        if (out[kind].length >= PER_GROUP || out[kind].some(c => c.name === card.name)) continue;
        if (fetch && fetches[kind] >= 2) continue;
        if (fetch) fetches[kind]++;
        out[kind].push(card);
      }
      return out;
    },
  });
}

function ExampleCard({ card, menuOpen, onMenu, onMenuClose, onAction }: {
  card: ScryfallCard;
  menuOpen: boolean;
  onMenu: () => void;
  onMenuClose: () => void;
  onAction: (card: ScryfallCard, action: CardAction) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const mustInclude = useStore(s => s.customization.mustIncludeCards);
  const banned = useStore(s => s.customization.bannedCards);
  const { lists: userLists } = useUserLists();

  return (
    <div
      ref={ref}
      className="group relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onContextMenu={e => { e.preventDefault(); setHover(false); onMenu(); }}
    >
      <img
        src={getCardImageUrl(card, 'normal')}
        alt={card.name}
        loading="lazy"
        className={`w-full rounded-[5px] border border-border/50 ${banned.includes(card.name) ? 'opacity-40 grayscale' : ''}`}
        style={{ aspectRatio: '488 / 680' }}
      />
      <span className={`absolute top-0.5 right-0.5 rounded bg-background/80 backdrop-blur-sm transition-opacity ${menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        <CardContextMenu
          card={card}
          onAction={onAction}
          userLists={userLists}
          isMustInclude={mustInclude.includes(card.name)}
          isBanned={banned.includes(card.name)}
          forceOpen={menuOpen}
          onForceClose={onMenuClose}
        />
      </span>
      {hover && !menuOpen && <MagnifiedPreview card={card} anchorRef={ref} side="right" width={260} />}
    </div>
  );
}

/**
 * A group name in the land split that opens the group's example cards on hover (or tap). Each card
 * has the usual hover preview and right-click menu — excluding a land here is the quickest way to
 * keep it out of this deck.
 */
export function LandGroupExamples({ kind, label, colors, children }: {
  kind: LandKind;
  label: string;
  colors: string[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // Read by the close timer, which may fire after a re-render — a ref sees the current value.
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuFor !== null;
  const closeTimer = useRef<number | null>(null);
  const { data, isLoading, isError } = useLandExamples(colors, open);
  const updateCustomization = useStore(s => s.updateCustomization);
  const { lists: userLists, updateList, createList } = useUserLists();

  const cancelClose = () => { if (closeTimer.current) window.clearTimeout(closeTimer.current); closeTimer.current = null; };
  const scheduleClose = () => {
    cancelClose();
    // Moving into a card's right-click menu leaves this popover; keep it open while that menu is.
    closeTimer.current = window.setTimeout(() => { if (!menuOpenRef.current) setOpen(false); }, CLOSE_DELAY_MS);
  };

  const onAction = (card: ScryfallCard, action: CardAction) => {
    const { mustIncludeCards, bannedCards } = useStore.getState().customization;
    const name = card.name;
    switch (action.type) {
      case 'mustInclude': {
        const has = mustIncludeCards.includes(name);
        updateCustomization({ mustIncludeCards: has ? mustIncludeCards.filter(n => n !== name) : [...mustIncludeCards, name] });
        break;
      }
      case 'exclude': {
        const has = bannedCards.includes(name);
        updateCustomization({ bannedCards: has ? bannedCards.filter(n => n !== name) : [...bannedCards, name] });
        break;
      }
      case 'addToList': {
        const list = userLists.find(l => l.id === action.listId);
        if (list && !list.cards.includes(name)) updateList(action.listId, { cards: [...list.cards, name] });
        break;
      }
      case 'createListAndAdd':
        createList(action.listName, [name]);
        break;
      default:
        break;
    }
  };

  const cards = data?.[kind] ?? [];

  return (
    <Popover open={open} onOpenChange={v => { setOpen(v); if (!v) setMenuFor(null); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-left"
          onMouseEnter={() => { cancelClose(); setOpen(true); }}
          onMouseLeave={scheduleClose}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-[272px] p-3"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        onOpenAutoFocus={e => e.preventDefault()}
      >
        <div className="mb-2">
          <div className="text-xs font-medium">{label} examples</div>
          <div className="text-[10px] text-muted-foreground leading-snug">Popular in your colors. Your deck picks its own.</div>
        </div>
        {isLoading ? (
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: PER_GROUP }, (_, i) => (
              <div key={i} className="rounded-[5px] bg-muted/40 animate-pulse" style={{ aspectRatio: '488 / 680' }} />
            ))}
          </div>
        ) : isError ? (
          <p className="text-xs text-muted-foreground">Couldn't load examples right now.</p>
        ) : cards.length === 0 ? (
          <p className="text-xs text-muted-foreground">None in your colors.</p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {cards.map(card => (
              <ExampleCard
                key={card.name}
                card={card}
                menuOpen={menuFor === card.name}
                onMenu={() => setMenuFor(card.name)}
                onMenuClose={() => setMenuFor(null)}
                onAction={onAction}
              />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
