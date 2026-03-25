import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useStore } from '@/store';
import { formatRelativeTime } from '@/lib/utils';
import { CardContextMenu, type CardContextMenuProps, type CardAction } from './DeckDisplay';
import type { DeckHistoryEntry, ScryfallCard } from '@/types';

const HISTORY_OPEN_KEY = 'mtg-deck-show-history';

const historyBadges: Record<string, { label: string; color: string; bg: string }> = {
  add:        { label: '+1', color: 'text-emerald-400', bg: 'bg-emerald-500/15' },
  remove:     { label: '-1', color: 'text-red-400',     bg: 'bg-red-500/15' },
  swap:       { label: '↔',  color: 'text-purple-400',  bg: 'bg-purple-500/15' },
  sideboard:  { label: 'SB', color: 'text-sky-400',     bg: 'bg-sky-500/15' },
  maybeboard: { label: 'MB', color: 'text-amber-400',   bg: 'bg-amber-500/15' },
};

interface HistoryRowProps {
  entry: DeckHistoryEntry;
  onPreview?: (name: string) => void;
  resolveCard?: (name: string) => Promise<ScryfallCard | undefined>;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: Omit<CardContextMenuProps, 'card' | 'onAction'>;
  inDeck?: boolean;
}

function HistoryRow({ entry, onPreview, resolveCard, onCardAction, menuProps, inDeck }: HistoryRowProps) {
  const badge = historyBadges[entry.action];
  const [contextCard, setContextCard] = useState<ScryfallCard | null>(null);

  const handleContext = useCallback(async (e: React.MouseEvent, name: string) => {
    if (!resolveCard || !onCardAction || !menuProps) return;
    e.preventDefault();
    const card = await resolveCard(name);
    if (card) setContextCard(card);
  }, [resolveCard, onCardAction, menuProps]);

  const nameBtn = (name: string) => (
    <button
      type="button"
      onClick={() => onPreview?.(name)}
      onContextMenu={(e) => handleContext(e, name)}
      className="hover:underline hover:text-foreground transition-colors"
    >
      {name}
    </button>
  );

  return (
    <div className="flex items-center gap-2 text-xs py-0.5 group">
      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${badge.color} ${badge.bg}`}>
        {badge.label}
      </span>
      <span className="truncate text-foreground/80">
        {entry.action === 'swap' ? (
          <>
            {nameBtn(entry.cardName)}
            <span className="text-muted-foreground/50"> &rarr; </span>
            {nameBtn(entry.targetCardName!)}
          </>
        ) : (
          nameBtn(entry.cardName)
        )}
      </span>
      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/50">
        {formatRelativeTime(entry.timestamp)}
      </span>
      {resolveCard && onCardAction && menuProps && (
        <span className={`shrink-0 transition-all ${contextCard ? 'w-3 opacity-100' : 'w-0 opacity-0 group-hover:w-3 group-hover:opacity-100'}`}>
          <CardContextMenu
            card={contextCard ?? { name: entry.cardName, id: entry.cardName } as ScryfallCard}
            onAction={onCardAction}
            {...menuProps}
            hasRemove={inDeck}
            hasAddToDeck={!inDeck}
            forceOpen={!!contextCard}
            onForceClose={() => setContextCard(null)}
          />
        </span>
      )}
    </div>
  );
}

interface DeckHistoryProps {
  onPreviewCard?: (name: string) => void;
  resolveCard?: (name: string) => Promise<ScryfallCard | undefined>;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  cardMenuProps?: Omit<CardContextMenuProps, 'card' | 'onAction'>;
  deckCardNames?: Set<string>;
}

export function DeckHistory({ onPreviewCard, resolveCard, onCardAction, cardMenuProps, deckCardNames }: DeckHistoryProps) {
  const deckHistory = useStore(s => s.deckHistory);
  const [isOpen, setIsOpen] = useState(() => localStorage.getItem(HISTORY_OPEN_KEY) !== 'false');

  // Re-render periodically to keep relative timestamps fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    if (deckHistory.length === 0) return;
    const interval = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(interval);
  }, [deckHistory.length]);

  if (deckHistory.length === 0) return null;

  return (
    <div className="bg-card/50 rounded-lg border border-border/50 p-4">
      <button
        type="button"
        onClick={() => setIsOpen(prev => {
          const next = !prev;
          localStorage.setItem(HISTORY_OPEN_KEY, String(next));
          return next;
        })}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer w-full"
      >
        {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span className="font-medium uppercase tracking-wide">Recent History</span>
        <span className="ml-auto text-[10px] text-muted-foreground/50">{deckHistory.length}</span>
      </button>
      {isOpen && (
        <div className="mt-3 max-h-48 overflow-x-hidden overflow-y-auto space-y-1 pr-1 scrollbar-thin">
          {deckHistory.map(entry => (
            <HistoryRow
              key={entry.id}
              entry={entry}
              onPreview={onPreviewCard}
              resolveCard={resolveCard}
              onCardAction={onCardAction}
              menuProps={cardMenuProps}
              inDeck={deckCardNames?.has(entry.cardName)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
