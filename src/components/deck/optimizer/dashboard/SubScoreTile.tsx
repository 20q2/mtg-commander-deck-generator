// src/components/deck/optimizer/dashboard/SubScoreTile.tsx
import type { ReactNode } from 'react';
import type { SubScore } from '@/types';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight } from 'lucide-react';

export interface SubScoreTileProps {
  label: string;
  subscore: SubScore;
  onClick?: () => void;
  /** Lucide icon component for the tile's category. */
  Icon?: LucideIcon;
  /** Optional one-line micro-detail shown below the surface text. */
  hint?: string;
  /** Optional glanceable chart rendered between the surface text and the footer. */
  visual?: ReactNode;
}

function colorForScore(value: number): string {
  if (value >= 75) return 'text-emerald-400';
  if (value >= 60) return 'text-violet-300';
  if (value >= 40) return 'text-amber-400';
  return 'text-rose-400';
}

export function SubScoreTile({ label, subscore, onClick, Icon, hint, visual }: SubScoreTileProps) {
  const color = colorForScore(subscore.value);
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className="group relative bg-card/40 border border-border/30 rounded-lg p-3 pb-6 text-left hover:bg-accent/30 hover:border-border/60 transition-all w-full h-full cursor-pointer"
    >
      <span className={`absolute top-3 right-3 text-2xl font-black tabular-nums leading-none ${color}`}>
        {subscore.value}
      </span>
      <div className="flex items-center gap-2 mb-1.5 pr-12">
        {Icon && <Icon className={`w-4 h-4 ${color} opacity-80`} />}
        <span className="text-sm font-semibold uppercase tracking-wider text-foreground/90">
          {label}
        </span>
      </div>
      <p className="text-xs text-foreground/90 leading-snug">{subscore.surface}</p>
      {hint && (
        <p className="mt-1 text-[10px] italic text-muted-foreground/70 leading-snug">{hint}</p>
      )}
      {visual && (
        <div className="mt-2.5 flex justify-center">{visual}</div>
      )}
      <div className="absolute bottom-2 right-3 flex items-center text-[10px] text-muted-foreground/60 group-hover:text-muted-foreground/80 transition-colors">
        See more <ArrowRight className="w-2.5 h-2.5 ml-0.5" />
      </div>
    </div>
  );
}
