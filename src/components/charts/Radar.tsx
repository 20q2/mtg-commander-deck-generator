import { type ReactNode } from 'react';

// Radar geometry, in px (the SVG viewBox matches the box so the HTML glyph overlay lines up). Sized
// to sit comfortably inside the narrow left-hand rail. Axis count is variable (the role radar is a
// hexagon; the card-type and identity radars are whatever-gon their data calls for).
const W = 192;
const H = 168;
const CX = 96;
const CY = 78;
const R = 46;
const angle = (i: number, n: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
const point = (value: number, i: number, n: number): [number, number] => [
  CX + R * value * Math.cos(angle(i, n)),
  CY + R * value * Math.sin(angle(i, n)),
];
const poly = (pts: [number, number][]) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

// Floor the deck-shape vertices off dead-center so empty/thin axes still trace a small polygon
// rather than collapsing to a single point — this keeps lone spikes reading as spikes, not slivers.
const SHAPE_FLOOR = 0.16;
const shapeValue = (v: number) => Math.max(v, SHAPE_FLOOR);

/** One spoke on a radar: its fill (0-1), per-axis hue, tip glyph, and the count for its tooltip.
 *  `tip` overrides the default hover text (used when the visible `label` is omitted).
 *  `ref` (0-1), when set on any spoke, draws a faint dashed reference outline (e.g. the target
 *  distribution) so the filled shape can be read as above/below reference per axis. */
export interface RadarDatum { key: string; label: string; current: number; target: number; fill: number; hue: string; glyph: ReactNode; tip?: string; ref?: number; }

/**
 * A generic stat-sheet radar. Driven entirely by `data` (any axis count ≥3); the role, card-type,
 * and identity radars all render through it. `accent` tints the deck-shape polygon; `glow` lights it.
 * `gradientId` must be unique per instance (duplicate SVG gradient ids would cross-wire the fills).
 * `scale` shrinks the whole chart (and its layout box) for embedding in small tiles.
 */
export function Radar({ data, accent, glow, gradientId, scale = 1 }: { data: RadarDatum[]; accent: string; glow: boolean; gradientId: string; scale?: number }) {
  const n = data.length;
  const shape = data.map((a, i) => point(shapeValue(a.fill), i, n));
  const hasRef = data.some(a => a.ref != null);

  return (
    <div style={{ width: W * scale, height: H * scale }}>
    <div className="relative" style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full overflow-visible">
        <defs>
          <radialGradient id={gradientId} cx="50%" cy="44%" r="60%">
            <stop offset="0%" stopColor={`hsl(${accent} / 0.40)`} />
            <stop offset="100%" stopColor={`hsl(${accent} / 0.12)`} />
          </radialGradient>
        </defs>

        {/* Faint concentric rings + spokes — the RPG stat-sheet scaffold, kept quiet. */}
        {[0.33, 0.66, 1].map(r => (
          <polygon key={r} points={poly(data.map((_, i) => point(r, i, n)))}
            fill="none" stroke="hsl(var(--border))" strokeWidth={r === 1 ? 1 : 0.5}
            strokeDasharray={r === 1 ? undefined : '2 3'} opacity={r === 1 ? 0.7 : 0.4} />
        ))}
        {data.map((_, i) => {
          const [x, y] = point(1, i, n);
          return <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="hsl(var(--border))" strokeWidth="0.5" opacity="0.45" />;
        })}

        {/* The deck's current shape. */}
        <polygon points={poly(shape)} fill={`url(#${gradientId})`} stroke={`hsl(${accent})`} strokeWidth="1.5"
          strokeLinejoin="round"
          style={{ transition: 'all 320ms cubic-bezier(0.4,0,0.2,1)', filter: glow ? `drop-shadow(0 0 7px hsl(${accent} / 0.55))` : 'none' }} />

        {/* Optional reference outline (e.g. the target distribution) — read the fill against it. */}
        {hasRef && (
          <polygon points={poly(data.map((a, i) => point(a.ref ?? 0, i, n)))}
            fill="none" stroke="hsl(var(--muted-foreground))" strokeOpacity="0.6"
            strokeWidth="1" strokeDasharray="3 2" strokeLinejoin="round" />
        )}

        {/* Vertex pips, tinted per axis. */}
        {data.map((a, i) => {
          const [x, y] = point(shapeValue(a.fill), i, n);
          return <circle key={a.key} cx={x} cy={y} r={a.fill > 0.04 ? 2.2 : 1.1}
            fill={`hsl(${a.hue})`}
            style={{ transition: 'all 320ms cubic-bezier(0.4,0,0.2,1)' }} />;
        })}
      </svg>

      {/* Each spoke's tip carries its glyph + label. It stays a quiet grey when the axis is thin and
          saturates into the axis hue (and glows, when full) as it fills. Hover gives the count. */}
      {data.map((a, i) => {
        const [x, y] = point(1.3, i, n);
        const lit = a.fill > 0;
        const color = lit ? `hsl(${a.hue} / ${0.5 + 0.5 * a.fill})` : 'hsl(var(--muted-foreground) / 0.45)';
        return (
          <div key={a.key} title={a.tip ?? `${a.label} ${a.current}/${a.target}`}
            className="absolute flex flex-col items-center gap-0.5 transition-all duration-300"
            style={{ left: x, top: y, transform: 'translate(-50%, -50%)', width: 48, color }}>
            {a.glyph && (
              <span className="grid place-items-center rounded-full transition-all duration-300"
                style={{
                  width: 20, height: 20,
                  background: lit ? `hsl(${a.hue} / ${0.08 + 0.12 * a.fill})` : 'transparent',
                  boxShadow: a.fill >= 0.999 ? `0 0 7px hsl(${a.hue} / 0.5)` : 'none',
                }}>
                {a.glyph}
              </span>
            )}
            {a.label && (
              <span className="font-medium uppercase leading-none text-center" style={{ fontSize: 8, letterSpacing: '0.05em' }}>
                {a.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
    </div>
  );
}
