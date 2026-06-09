// src/components/poll/SuggestionList.tsx
import { useMemo, type ReactNode } from 'react';
import type { Suggestion } from '@/services/poll/types';
import { SuggestionRow } from './SuggestionRow';

export type Tab = 'top' | 'new' | 'shipped';

interface Props {
  suggestions: Suggestion[];
  myVotes: Set<string>;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  onToggleVote: (id: string) => void;
  voteDisabled?: boolean;
  renderAdminControls?: (s: Suggestion) => ReactNode;
}

export function SuggestionList({
  suggestions, myVotes, tab, onTabChange, onToggleVote, voteDisabled, renderAdminControls,
}: Props) {
  const counts = useMemo(() => {
    let open = 0, shipped = 0;
    for (const s of suggestions) (s.status === 'shipped' ? shipped++ : open++);
    return { top: open, new: open, shipped };
  }, [suggestions]);

  const filtered = useMemo(() => {
    const open = suggestions.filter(s => s.status === 'open');
    if (tab === 'top') {
      return [...open].sort((a, b) =>
        b.voteCount - a.voteCount || b.createdAt.localeCompare(a.createdAt)
      );
    }
    if (tab === 'new') {
      return [...open].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return suggestions
      .filter(s => s.status === 'shipped')
      .sort((a, b) => (b.shippedAt || '').localeCompare(a.shippedAt || ''));
  }, [suggestions, tab]);

  const tabClass = (t: Tab) => [
    'inline-flex items-center gap-2 text-[13px] px-3.5 py-1.5 rounded-full transition-colors border',
    t === tab
      ? 'bg-primary/15 border-primary/25 text-violet-300/90'
      : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50',
  ].join(' ');

  return (
    <div>
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="flex gap-1">
          <button type="button" onClick={() => onTabChange('top')} className={tabClass('top')}>
            Top <span className="text-[11px] opacity-70 bg-white/[0.06] px-1.5 rounded-full font-semibold">{counts.top}</span>
          </button>
          <button type="button" onClick={() => onTabChange('new')} className={tabClass('new')}>
            New <span className="text-[11px] opacity-70 bg-white/[0.06] px-1.5 rounded-full font-semibold">{counts.new}</span>
          </button>
          <button type="button" onClick={() => onTabChange('shipped')} className={tabClass('shipped')}>
            Shipped <span className="text-[11px] opacity-70 bg-white/[0.06] px-1.5 rounded-full font-semibold">{counts.shipped}</span>
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="glass rounded-2xl p-10 text-center text-muted-foreground">
          {tab === 'shipped'
            ? 'Nothing shipped from the poll yet.'
            : 'No suggestions yet. Be the first.'}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filtered.map(s => (
            <SuggestionRow
              key={s.id}
              suggestion={s}
              voted={myVotes.has(s.id)}
              onToggleVote={() => onToggleVote(s.id)}
              voteDisabled={voteDisabled}
              adminControls={renderAdminControls?.(s)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
