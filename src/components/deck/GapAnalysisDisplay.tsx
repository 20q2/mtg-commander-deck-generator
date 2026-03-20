import { useState, useMemo, useCallback, useEffect } from 'react';
import type { GapAnalysisCard, ScryfallCard, UserCardList } from '@/types';
import { getCardByName } from '@/services/scryfall/client';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import { ShoppingCart, PackageCheck } from 'lucide-react';
import { CardContextMenu, type CardAction } from './DeckDisplay';
import { useUserLists } from '@/hooks/useUserLists';
import { useStore } from '@/store';

const RANK_STYLES = [
  { bg: 'bg-amber-500/15', border: 'border-amber-500/40', badge: 'bg-amber-500 text-amber-950', label: '1st' },
  { bg: 'bg-slate-300/15', border: 'border-slate-400/40', badge: 'bg-slate-400 text-slate-950', label: '2nd' },
  { bg: 'bg-orange-700/15', border: 'border-orange-700/40', badge: 'bg-orange-700 text-orange-100', label: '3rd' },
];

const ROLE_BADGE_COLORS: Record<string, string> = {
  ramp: 'bg-emerald-500/20 text-emerald-400',
  removal: 'bg-rose-500/20 text-rose-400',
  boardwipe: 'bg-orange-500/20 text-orange-400',
  cardDraw: 'bg-sky-500/20 text-sky-400',
};

/* ── Per-card row with context menu ── */

interface GapCardItemProps {
  card: GapAnalysisCard;
  rank: typeof RANK_STYLES[number] | null;
  badgeColor: string | null;
  onPreview: (name: string, isOwned: boolean) => void;
  onAction: (card: ScryfallCard, action: CardAction) => void;
  isMustInclude: boolean;
  isBanned: boolean;
  userLists: UserCardList[];
}

function GapCardItem({ card, rank, badgeColor, onPreview, onAction, isMustInclude, isBanned, userLists }: GapCardItemProps) {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const stubCard = useMemo(() => ({ name: card.name } as ScryfallCard), [card.name]);

  return (
    <div
      onClick={() => onPreview(card.name, !!card.isOwned)}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenuOpen(true);
      }}
      className={`group flex items-center gap-2.5 py-1.5 px-2 rounded-lg border transition-colors cursor-pointer ${
        rank
          ? `${rank.bg} ${rank.border} hover:brightness-110`
          : 'border-transparent hover:bg-accent/50'
      }`}
    >
      <div className="relative shrink-0">
        {card.imageUrl ? (
          <img
            src={card.imageUrl}
            alt={card.name}
            className="w-8 h-auto rounded shadow"
            loading="lazy"
          />
        ) : (
          <div className="w-8 h-11 rounded bg-accent/50" />
        )}
        {rank && (
          <span className={`absolute -top-1.5 -left-1.5 text-[9px] font-bold px-1 py-px rounded-full shadow ${rank.badge}`}>
            {rank.label}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className={`text-sm truncate ${rank ? 'font-semibold' : 'font-medium'}`}>{card.name}</p>
          {card.isOwned && (
            <span title="In your collection">
              <PackageCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            </span>
          )}
          {card.roleLabel && badgeColor && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${badgeColor}`}>
              {card.roleLabel}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground truncate">{card.typeLine}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <div className="text-right leading-tight">
          {card.price && (
            <p className={`text-xs font-medium ${card.isOwned ? 'text-muted-foreground line-through' : ''}`}>
              ${parseFloat(card.price).toFixed(2)}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground">
            {Math.round(Number(card.inclusion))}%
          </p>
        </div>
        <span
          className={`shrink-0 transition-opacity ${contextMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <CardContextMenu
            card={stubCard}
            onAction={onAction}
            isMustInclude={isMustInclude}
            isBanned={isBanned}
            userLists={userLists}
            forceOpen={contextMenuOpen}
            onForceClose={() => setContextMenuOpen(false)}
          />
        </span>
      </div>
    </div>
  );
}

/* ── Main component ── */

interface GapAnalysisDisplayProps {
  cards: GapAnalysisCard[];
}

export function GapAnalysisDisplay({ cards }: GapAnalysisDisplayProps) {
  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);
  const [previewOwned, setPreviewOwned] = useState(false);
  const [hideOwned, setHideOwned] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const customization = useStore(s => s.customization);
  const updateCustomization = useStore(s => s.updateCustomization);
  const { lists: userLists, updateList } = useUserLists();

  const mustIncludeNames = useMemo(() => new Set(customization.mustIncludeCards), [customization.mustIncludeCards]);
  const bannedNames = useMemo(() => new Set(customization.bannedCards), [customization.bannedCards]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 2500);
    return () => clearTimeout(t);
  }, [toastMessage]);

  const MAX_SUGGESTIONS = 20;

  const topCards = useMemo(() => cards.slice(0, MAX_SUGGESTIONS), [cards]);
  const hasAnyOwned = useMemo(() => topCards.some(c => c.isOwned), [topCards]);

  const visibleCards = useMemo(
    () => hideOwned ? cards.filter(c => !c.isOwned).slice(0, MAX_SUGGESTIONS) : topCards,
    [cards, topCards, hideOwned]
  );

  const handleCardAction = useCallback((card: ScryfallCard, action: CardAction) => {
    const name = card.name;
    switch (action.type) {
      case 'mustInclude': {
        const current = customization.mustIncludeCards;
        const has = current.includes(name);
        updateCustomization({ mustIncludeCards: has ? current.filter(n => n !== name) : [...current, name] });
        setToastMessage(has ? `Removed "${name}" from must-include` : `"${name}" will be must-included next generation`);
        break;
      }
      case 'exclude': {
        const currentBanned = customization.bannedCards;
        const hasBan = currentBanned.includes(name);
        updateCustomization({ bannedCards: hasBan ? currentBanned.filter(n => n !== name) : [...currentBanned, name] });
        setToastMessage(hasBan ? `Removed "${name}" from excludes` : `"${name}" will be excluded next generation`);
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
    }
  }, [customization.mustIncludeCards, customization.bannedCards, updateCustomization, userLists, updateList]);

  if (cards.length === 0) return null;

  const totalCost = visibleCards
    .filter(c => !c.isOwned)
    .reduce((sum, c) => sum + (c.price ? parseFloat(c.price) || 0 : 0), 0);

  const handleCardClick = async (name: string, isOwned: boolean) => {
    try {
      const card = await getCardByName(name);
      if (card) {
        setPreviewCard(card);
        setPreviewOwned(isOwned);
      }
    } catch {
      // silently fail
    }
  };

  return (
    <div className="mt-6 p-4 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-3">
        <ShoppingCart className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">Cards to Consider</h3>
        <span className="text-xs text-muted-foreground ml-auto">
          ~${totalCost.toFixed(2)} to buy
        </span>
      </div>
      <div className="mb-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Top cards that would strengthen this deck.
          </p>
          {hasAnyOwned && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none shrink-0 ml-4">
              <input
                type="checkbox"
                checked={hideOwned}
                onChange={(e) => setHideOwned(e.target.checked)}
                className="rounded border-border accent-purple-500"
              />
              Hide owned
            </label>
          )}
        </div>
        {hasAnyOwned && (
          <p className="text-xs text-muted-foreground mt-1">
            Cards marked <PackageCheck className="w-3 h-3 text-emerald-500 inline align-text-top mx-0.5" /> are in your collection but weren&apos;t selected&mdash;your deck already uses the cards that best fit your commander, strategy, and customization settings. These are potential swaps.
          </p>
        )}
      </div>

      {visibleCards.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          All suggested cards are in your collection!
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5">
          {visibleCards.map((card, i) => {
            const rank = i < 3 ? RANK_STYLES[i] : null;
            const badgeColor = card.role ? ROLE_BADGE_COLORS[card.role] : null;

            return (
              <GapCardItem
                key={card.name}
                card={card}
                rank={rank}
                badgeColor={badgeColor}
                onPreview={handleCardClick}
                onAction={handleCardAction}
                isMustInclude={mustIncludeNames.has(card.name)}
                isBanned={bannedNames.has(card.name)}
                userLists={userLists}
              />
            );
          })}
        </div>
      )}

      <CardPreviewModal card={previewCard} onClose={() => setPreviewCard(null)} isOwned={previewOwned} />

      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2 bg-amber-500/90 text-white text-sm rounded-lg shadow-lg animate-fade-in max-w-sm">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
