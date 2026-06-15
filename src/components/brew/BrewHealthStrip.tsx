import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '@/store';
import { buildHealth } from '@/services/brew/engine';
import { Sparkles } from 'lucide-react';
import { BrewDeckListButton } from './BrewDeckListButton';

const ROLE_ROW: { key: 'ramp' | 'removal' | 'boardwipe' | 'cardDraw'; label: string }[] = [
  { key: 'ramp', label: 'Ramp' }, { key: 'removal', label: 'Removal' },
  { key: 'boardwipe', label: 'Wipes' }, { key: 'cardDraw', label: 'Draw' },
];

interface Floater { id: number; text: string; }

/**
 * Wraps a stat so that when its value rises, a "damage number" delta pops off it and the
 * counter gives a quick pulse. Decreases (undo) are silent.
 */
function StatPop({ value, format, colorClass, className, children }: {
  value: number;
  format: (delta: number) => string | null;  // return null to suppress the pop (e.g. sub-$1)
  colorClass: string;
  className?: string;
  children: ReactNode;
}) {
  const prev = useRef(value);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [pulseKey, setPulseKey] = useState<number | null>(null);

  useEffect(() => {
    const delta = value - prev.current;
    prev.current = value;
    if (delta <= 0) return;
    const text = format(delta);
    if (!text) return;
    const id = seq.current++;
    setFloaters(f => [...f, { id, text }]);
    setPulseKey(id);
    const t = window.setTimeout(() => setFloaters(f => f.filter(x => x.id !== id)), 1000);
    timers.current.push(t);
  // format is recreated each render but only `value` should re-trigger the pop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return (
    <span className={`relative inline-flex ${className ?? ''}`}>
      <span
        key={pulseKey ?? 'init'}
        className={`inline-flex items-center gap-1.5 ${pulseKey === null ? '' : 'animate-stat-pulse'}`}
      >
        {children}
      </span>
      {floaters.map(f => (
        <span
          key={f.id}
          className={`pointer-events-none absolute left-1/2 bottom-full whitespace-nowrap text-[11px] font-bold tabular-nums drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)] animate-damage-float ${colorClass}`}
        >
          {f.text}
        </span>
      ))}
    </span>
  );
}

export function BrewHealthStrip() {
  const { brewContext, brewState } = useStore();
  if (!brewContext || !brewState) return null;
  const h = buildHealth(brewContext, brewState);
  const totalSlots = brewContext.nonLandTarget + brewContext.landTarget;

  function tone(current: number, target: number): string {
    if (target <= 0) return 'bg-muted-foreground/40';
    const ratio = current / target;
    if (ratio >= 0.9) return 'bg-[hsl(var(--success))]';
    if (ratio >= 0.4) return 'bg-amber-400';
    return 'bg-destructive';
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm px-4 py-2.5 flex items-center gap-4 flex-wrap text-xs">
      <StatPop
        value={h.deckScore}
        format={d => (Math.round(d) >= 1 ? `+${Math.round(d)}` : null)}
        colorClass="text-violet-300"
        className="font-semibold text-violet-200"
      >
        <Sparkles className="w-3.5 h-3.5" /> Deck Score {Math.round(h.deckScore)}
      </StatPop>

      {ROLE_ROW.map(r => (
        <StatPop
          key={r.key}
          value={h.roleCounts[r.key]}
          format={d => `+${d} ${r.label}`}
          colorClass="text-emerald-300"
          className="text-muted-foreground tabular-nums"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${tone(h.roleCounts[r.key], h.roleTargets[r.key])}`} />
          {r.label} {h.roleCounts[r.key]}/{h.roleTargets[r.key]}
        </StatPop>
      ))}

      <span className="ml-auto inline-flex items-center gap-2 text-muted-foreground/70 tabular-nums">
        <StatPop
          value={h.cardCount}
          format={d => `+${d} card${d > 1 ? 's' : ''}`}
          colorClass="text-emerald-300"
        >
          {h.cardCount} / {totalSlots}
        </StatPop>
        <span aria-hidden="true">·</span>
        <StatPop
          value={h.estCostUsd}
          format={d => (Math.round(d) >= 1 ? `+$${Math.round(d)}` : null)}
          colorClass="text-amber-300"
        >
          ${h.estCostUsd.toFixed(0)}
        </StatPop>
      </span>

      <BrewDeckListButton />
    </div>
  );
}
