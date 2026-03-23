import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useStore } from '@/store';
import { formatRelativeTime } from '@/lib/utils';
import type { DeckHistoryEntry } from '@/types';

const HISTORY_OPEN_KEY = 'mtg-deck-show-history';

const historyBadges: Record<string, { label: string; color: string; bg: string }> = {
  add:        { label: '+1', color: 'text-emerald-400', bg: 'bg-emerald-500/15' },
  remove:     { label: '-1', color: 'text-red-400',     bg: 'bg-red-500/15' },
  swap:       { label: '↔',  color: 'text-purple-400',  bg: 'bg-purple-500/15' },
  sideboard:  { label: 'SB', color: 'text-sky-400',     bg: 'bg-sky-500/15' },
  maybeboard: { label: 'MB', color: 'text-amber-400',   bg: 'bg-amber-500/15' },
};

function HistoryRow({ entry, onPreview }: { entry: DeckHistoryEntry; onPreview?: (name: string) => void }) {
  const badge = historyBadges[entry.action];
  return (
    <div className="flex items-center gap-2 text-xs py-0.5">
      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${badge.color} ${badge.bg}`}>
        {badge.label}
      </span>
      <span className="truncate text-foreground/80">
        {entry.action === 'swap' ? (
          <>
            <button type="button" onClick={() => onPreview?.(entry.cardName)} className="hover:underline hover:text-foreground transition-colors">{entry.cardName}</button>
            <span className="text-muted-foreground/50"> &rarr; </span>
            <button type="button" onClick={() => onPreview?.(entry.targetCardName!)} className="hover:underline hover:text-foreground transition-colors">{entry.targetCardName}</button>
          </>
        ) : (
          <button type="button" onClick={() => onPreview?.(entry.cardName)} className="hover:underline hover:text-foreground transition-colors">{entry.cardName}</button>
        )}
      </span>
      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/50">
        {formatRelativeTime(entry.timestamp)}
      </span>
    </div>
  );
}

export function DeckHistory({ onPreviewCard }: { onPreviewCard?: (name: string) => void } = {}) {
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
        <div className="mt-3 max-h-64 overflow-y-auto space-y-1 pr-2 scrollbar-thin">
          {deckHistory.map(entry => (
            <HistoryRow key={entry.id} entry={entry} onPreview={onPreviewCard} />
          ))}
        </div>
      )}
    </div>
  );
}
