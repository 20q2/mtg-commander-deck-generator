// src/components/poll/SuggestionRow.tsx
import { Info } from 'lucide-react';
import type { Suggestion } from '@/services/poll/types';
import { VoteTile } from './VoteTile';
import { CommentThread } from './CommentThread';
import { relativeTime } from './relativeTime';
import type { ReactNode } from 'react';

interface Props {
  suggestion: Suggestion;
  voted: boolean;
  onToggleVote: () => void;
  voteDisabled?: boolean;
  admin?: boolean;
  onCommentCountChange: (count: number) => void;
  adminControls?: ReactNode;
}

export function SuggestionRow({
  suggestion, voted, onToggleVote, voteDisabled, admin, onCommentCountChange, adminControls,
}: Props) {
  const isShipped = suggestion.status === 'shipped';

  return (
    <div
      className={[
        'glass rounded-2xl p-[18px] grid grid-cols-[64px_1fr] gap-[18px] items-start hover-lift transition-colors',
        isShipped && 'opacity-90',
      ].filter(Boolean).join(' ')}
    >
      <VoteTile
        count={suggestion.voteCount}
        voted={voted}
        onToggle={onToggleVote}
        disabled={voteDisabled}
      />
      <div>
        <h3
          className={[
            'text-[15px] font-semibold leading-snug mb-1',
            isShipped ? 'text-foreground/80' : 'text-foreground',
          ].join(' ')}
        >
          {suggestion.title}
        </h3>
        <p className="text-[13px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
          {suggestion.description}
        </p>

        <div className="flex items-center gap-2.5 mt-2.5 text-[11px] text-muted-foreground/80">
          {isShipped ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[hsl(var(--success)/0.15)] text-[hsl(142_71%_65%)]">
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              Shipped
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/15 text-violet-300/80">
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              Open
            </span>
          )}
          <span className="opacity-40">·</span>
          {isShipped && suggestion.shippedVersion ? (
            <span>in v{suggestion.shippedVersion}</span>
          ) : (
            <span>{relativeTime(suggestion.createdAt)}</span>
          )}
        </div>

        {suggestion.devNote && (
          <div className="mt-3 p-2.5 rounded-md bg-primary/[0.06] border border-primary/20 flex gap-2.5 text-[12px] leading-relaxed text-foreground/80">
            <div className="flex-shrink-0 w-[18px] h-[18px] rounded-full bg-primary/30 text-violet-200 flex items-center justify-center mt-0.5">
              <Info className="w-3 h-3" />
            </div>
            <div>
              <strong className="text-violet-300/90 font-semibold">From the dev: </strong>
              {suggestion.devNote}
            </div>
          </div>
        )}

        <CommentThread
          suggestion={suggestion}
          admin={admin}
          onCountChange={onCommentCountChange}
        />

        {adminControls}
      </div>
    </div>
  );
}
