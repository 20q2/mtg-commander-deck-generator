/**
 * A compact mana-curve chart: per-CMC bars showing where the deck actually is
 * (violet, or ember when a slot overshoots) over a quiet dashed "expected"
 * ghost bar. Generic — driven by `{ cmc, current, target }[]`. `barHeight`
 * scales the chart for different homes (the brew rail vs. a small dashboard tile).
 */
export function MiniCurve({
  curve,
  barHeight = 92,
  variant = 'bars',
  preview,
}: {
  curve: { cmc: number; current: number; target: number }[];
  barHeight?: number;
  variant?: 'bars' | 'line';
  /** Projected `current` per bar (same order as `curve`) — draws a faint cap showing where a hovered
   *  pick would push each slot. Omit for no projection. */
  preview?: number[];
}) {
  if (curve.length === 0) return null;
  const max = Math.max(1, ...curve.map(c => Math.max(c.current, c.target)), ...(preview ?? []));

  // Line variant: your curve as a solid violet line over a dashed "expected" ghost
  // line, both on the same scale. Easier to read the shape of the curve at a glance.
  if (variant === 'line') {
    const n = curve.length;
    const stepX = 26;
    const W = stepX * n;
    const H = barHeight;
    const px = (i: number) => (i + 0.5) * stepX;
    const py = (v: number) => H - (v / max) * (H - 4) - 2; // 2px padding top/bottom
    const path = (key: 'current' | 'target') =>
      curve.map((c, i) => `${px(i).toFixed(1)},${py(c[key]).toFixed(1)}`).join(' ');
    return (
      <div className="flex flex-col items-center">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="overflow-visible">
          {/* Expected curve — quiet dashed ghost line from the commander's averages. */}
          <polyline points={path('target')} fill="none"
            stroke="hsl(var(--muted-foreground))" strokeOpacity="0.45"
            strokeWidth="1.5" strokeDasharray="3 3" strokeLinejoin="round" strokeLinecap="round" />
          {/* Where you actually are. */}
          <polyline points={path('current')} fill="none"
            stroke="hsl(262 84% 72%)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {curve.map((c, i) => (
            <circle key={c.cmc} cx={px(i)} cy={py(c.current)} r="2.5"
              fill={c.current > c.target ? 'hsl(22 88% 58%)' : 'hsl(262 84% 72%)'}>
              <title>{`CMC ${c.cmc >= 7 ? '7+' : c.cmc}: ${c.current} (target ${c.target})`}</title>
            </circle>
          ))}
        </svg>
        <div className="flex" style={{ width: W }}>
          {curve.map(c => (
            <span key={c.cmc} className="text-[8px] text-muted-foreground/70 tabular-nums text-center leading-none"
              style={{ width: stepX }}>{c.cmc >= 7 ? '7+' : c.cmc}</span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end justify-center gap-1.5" style={{ height: barHeight + 20 }}>
      {curve.map((c, i) => {
        const curH = Math.round((c.current / max) * barHeight);
        const tgtH = Math.round((c.target / max) * barHeight);
        const over = c.current > c.target;
        // Projected height if a hovered pick were taken — the faint cap sits above the current bar.
        const pv = preview?.[i];
        const pvH = pv != null ? Math.round((pv / max) * barHeight) : null;
        return (
          <div key={c.cmc} className="flex flex-col items-center gap-1 w-5"
               title={`CMC ${c.cmc >= 7 ? '7+' : c.cmc}: ${c.current} (target ${c.target})${pv != null && pv !== c.current ? ` → ${pv} if taken` : ''}`}>
            <div className="relative w-3.5 flex items-end" style={{ height: barHeight }}>
              {/* Expected curve — a quiet ghost bar from the commander's averages. */}
              <div className="absolute inset-x-0 rounded-[3px] bg-muted-foreground/10 border-t border-dashed border-muted-foreground/40"
                style={{ bottom: 0, height: Math.max(2, tgtH) }} />
              {/* Hover projection — a lighter violet cap from the current top up to where the pick would land. */}
              {pvH != null && pvH > curH && (
                <div className="absolute inset-x-0 rounded-[3px] border border-dashed border-violet-300/70 bg-violet-400/25"
                  style={{ bottom: curH, height: pvH - curH }} />
              )}
              {/* Where you actually are. Ember when you've overshot a slot — the one honest warning. */}
              <div className="relative w-full rounded-[3px]"
                style={{
                  height: Math.max(c.current > 0 ? 3 : 0, curH),
                  background: over
                    ? 'linear-gradient(180deg, hsl(22 88% 60%), hsl(22 80% 48%))'
                    : 'linear-gradient(180deg, hsl(262 84% 72%), hsl(272 70% 54%))',
                  transition: 'height 320ms cubic-bezier(0.4,0,0.2,1)',
                }} />
            </div>
            <span className="text-[8px] text-muted-foreground/70 tabular-nums leading-none">{c.cmc >= 7 ? '7+' : c.cmc}</span>
          </div>
        );
      })}
    </div>
  );
}
