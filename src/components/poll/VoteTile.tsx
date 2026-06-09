// src/components/poll/VoteTile.tsx
import { useState } from 'react';

interface Props {
  count: number;
  voted: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export function VoteTile({ count, voted, onToggle, disabled }: Props) {
  const [shake, setShake] = useState(false);
  const handleClick = () => {
    if (disabled) {
      setShake(true);
      setTimeout(() => setShake(false), 450);
      return;
    }
    onToggle();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={voted}
      aria-label={voted ? `Voted, ${count} total — click to remove your vote` : `${count} votes — click to vote`}
      className={[
        'flex flex-col items-center justify-center w-16 h-16 rounded-xl border transition-all duration-150 select-none flex-shrink-0',
        voted
          ? 'bg-primary/15 border-primary/60 shadow-[0_0_24px_hsl(var(--primary)/0.25)]'
          : 'bg-secondary/60 border-border hover:border-primary/50 hover:bg-primary/10',
        shake && 'animate-jiggle',
      ].filter(Boolean).join(' ')}
    >
      <span
        className={[
          'text-[22px] font-bold leading-none tabular-nums',
          voted ? 'gradient-text' : 'text-foreground',
        ].join(' ')}
      >
        {count}
      </span>
      <span
        className={[
          'text-[9px] font-semibold uppercase tracking-[0.08em] mt-1',
          voted ? 'text-violet-300/80' : 'text-muted-foreground',
        ].join(' ')}
      >
        {voted ? 'Voted' : count === 1 ? 'Vote' : 'Votes'}
      </span>
    </button>
  );
}
