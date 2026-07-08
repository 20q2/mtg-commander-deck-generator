// src/components/deck/optimizer/dashboard/SynergyWebTile.tsx
import { ChartNetwork, ArrowRight } from 'lucide-react';
import { MiniSynergyWeb, type MiniSynergyGraph } from '@/components/charts/MiniSynergyWeb';

export interface SynergyWebTileProps {
  /** Derived mini graph, or null while loading / when synergy data is unavailable. */
  graph: MiniSynergyGraph | null;
  loading: boolean;
  onClick: () => void;
}

/** 0 islands is the good end (fully woven); the count climbs through amber into rose. */
function colorForIslands(n: number): string {
  if (n === 0) return 'text-emerald-400';
  if (n <= 3) return 'text-amber-400';
  return 'text-rose-400';
}

export function SynergyWebTile({ graph, loading, onClick }: SynergyWebTileProps) {
  const count = graph?.islandCount ?? null;
  const numberColor = count == null ? 'text-muted-foreground/60' : colorForIslands(count);
  const iconColor = count == null ? 'text-muted-foreground/60' : count === 0 ? 'text-emerald-400' : 'text-amber-400';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className="group relative bg-card/40 border border-border/30 rounded-lg p-3 pb-6 text-left hover:bg-accent/30 hover:border-border/60 transition-all w-full h-full cursor-pointer"
    >
      <span className={`absolute top-3 right-3 text-2xl font-black tabular-nums leading-none ${numberColor}`}>
        {loading && graph == null ? '…' : count == null ? '—' : count}
      </span>
      <div className="flex items-center gap-2 mb-1.5 pr-12">
        <ChartNetwork className={`w-4 h-4 ${iconColor} opacity-80`} />
        <span className="text-sm font-semibold uppercase tracking-wider text-foreground/90">
          Synergy Web
        </span>
      </div>

      {graph ? (
        <>
          <p className="text-xs text-foreground/90 leading-snug">
            {count === 0 ? 'All cards connected' : `${count} non-land outlier${count === 1 ? '' : 's'}`}
          </p>
          <div className="mt-2.5 flex justify-center">
            <MiniSynergyWeb graph={graph} />
          </div>
        </>
      ) : loading ? (
        <div className="mt-2.5 flex justify-center gap-1.5 h-[86px] items-center">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-2 h-2 rounded-full bg-foreground/10 animate-pulse" />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/70 leading-snug">Synergy data unavailable.</p>
      )}

      <div className="absolute bottom-2 right-3 flex items-center text-[10px] text-muted-foreground/60 group-hover:text-muted-foreground/80 transition-colors">
        Lift Web <ArrowRight className="w-2.5 h-2.5 ml-0.5" />
      </div>
    </div>
  );
}
