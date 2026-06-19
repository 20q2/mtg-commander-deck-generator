import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Floater { id: number; text: string; }

/**
 * Wraps a stat so that when its value rises, a "damage number" delta pops off it and the counter
 * gives a quick pulse. Decreases (undo) are silent. Shared by the health strip and the identity meter.
 */
export function StatPop({ value, format, colorClass, className, children }: {
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
