import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { ShieldCheck, Sparkles, PiggyBank, Layers, type LucideIcon } from 'lucide-react';
import type { ManaMix, ManaPhilosophy } from '@/types';

/**
 * The mana-base ratio wheel: a donut split into four arcs, one per land style, where each arc's sweep
 * IS that style's share of the base. Drag the knob between two slices to grow one and shrink its
 * neighbor; the other two hold. A controlled component — it owns no state, just renders `mix` and
 * emits the next `mix` on every drag. Reliable begins at the top and the four run clockwise, so the
 * boundary between Spell Lands and Reliable is the fixed anchor (three draggable knobs → four weights).
 */

export const MANA_STYLE_ORDER: ManaPhilosophy[] = ['reliable', 'greedy', 'budget', 'spelllands'];
export const MANA_STYLE_META: Record<ManaPhilosophy, { name: string; hsl: string; blurb: string; Icon: LucideIcon }> = {
  reliable:   { name: 'Reliable',    hsl: '199 89% 60%', blurb: 'Best fixing — duals, fetches, triomes', Icon: ShieldCheck },
  greedy:     { name: 'Greedy',      hsl: '38 92% 58%',  blurb: 'Utility lands, shakier fixing',          Icon: Sparkles },
  budget:     { name: 'Budget',      hsl: '152 62% 48%', blurb: 'The cheapest functional base',           Icon: PiggyBank },
  spelllands: { name: 'Spell Lands', hsl: '265 85% 70%', blurb: 'MDFCs / flex lands that double as spells', Icon: Layers },
};

export const EVEN_MIX: ManaMix = { reliable: 0.25, greedy: 0.25, budget: 0.25, spelllands: 0.25 };

const MIN_W = 0.05;          // no slice can vanish
const MIN_DEG = MIN_W * 360;
const START = -90;           // Reliable begins at the top
const BOX = 240, CX = 120, CY = 120, R = 88, RIN = 54;
const RMID = (R + RIN) / 2;

/** Normalize any mix (raw / partial / empty) to four weights summing to 1; empty → even quarters. */
export function normalizeMix(mix: ManaMix): number[] {
  const raw = MANA_STYLE_ORDER.map(k => Math.max(0, mix[k] ?? 0));
  const total = raw.reduce((s, v) => s + v, 0);
  return total <= 0 ? [0.25, 0.25, 0.25, 0.25] : raw.map(v => v / total);
}

function polar(r: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
}
/** A donut wedge from a0→a1 (degrees, clockwise). */
function arcPath(a0: number, a1: number): string {
  const large = a1 - a0 > 180 ? 1 : 0;
  const o0 = polar(R, a0), o1 = polar(R, a1), i1 = polar(RIN, a1), i0 = polar(RIN, a0);
  return `M ${o0.x} ${o0.y} A ${R} ${R} 0 ${large} 1 ${o1.x} ${o1.y} L ${i1.x} ${i1.y} A ${RIN} ${RIN} 0 ${large} 0 ${i0.x} ${i0.y} Z`;
}

export function ManaWheel({ mix, onChange, landCount }: { mix: ManaMix; onChange: (mix: ManaMix) => void; landCount?: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragIdx = useRef<number | null>(null);

  const w = normalizeMix(mix);
  // Cumulative boundary angles: [top, B1, B2, B3]; the wrap-around boundary (top + 360) is the anchor.
  const bounds = [START, START + w[0] * 360, START + (w[0] + w[1]) * 360, START + (w[0] + w[1] + w[2]) * 360];
  const ext = [...bounds, START + 360];

  function angleAt(e: ReactPointerEvent): number {
    const rect = svgRef.current!.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let deg = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;
    while (deg < START) deg += 360;
    while (deg >= START + 360) deg -= 360;
    return deg;
  }

  function onKnobDown(idx: number, e: ReactPointerEvent) {
    e.preventDefault(); e.stopPropagation();
    dragIdx.current = idx;
    svgRef.current?.setPointerCapture(e.pointerId);
  }
  function onMove(e: ReactPointerEvent) {
    const idx = dragIdx.current;
    if (idx == null) return;
    const lo = ext[idx - 1] + MIN_DEG;
    const hi = ext[idx + 1] - MIN_DEG;
    const deg = Math.max(lo, Math.min(hi, angleAt(e)));
    const nb = [...ext]; nb[idx] = deg;
    const next: ManaMix = {};
    MANA_STYLE_ORDER.forEach((k, i) => { next[k] = (nb[i + 1] - nb[i]) / 360; });
    onChange(next);
  }
  function onUp(e: ReactPointerEvent) {
    if (dragIdx.current == null) return;
    dragIdx.current = null;
    svgRef.current?.releasePointerCapture(e.pointerId);
  }

  const leadIdx = w.indexOf(Math.max(...w));
  const lead = MANA_STYLE_META[MANA_STYLE_ORDER[leadIdx]];

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative touch-none" style={{ width: BOX, height: BOX }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${BOX} ${BOX}`}
          className="absolute inset-0 h-full w-full"
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {MANA_STYLE_ORDER.map((k, i) => {
            const m = MANA_STYLE_META[k];
            return (
              <path
                key={k}
                d={arcPath(ext[i] + 0.6, ext[i + 1] - 0.6)}
                fill={`hsl(${m.hsl})`}
                opacity={0.9}
                style={{ filter: `drop-shadow(0 0 6px hsl(${m.hsl} / 0.45))`, transition: dragIdx.current == null ? 'd 120ms ease' : undefined }}
              />
            );
          })}
          {/* Draggable knobs on the three internal boundaries (B1/B2/B3). */}
          {[1, 2, 3].map(idx => {
            const p = polar(RMID, ext[idx]);
            return (
              <circle
                key={idx}
                cx={p.x} cy={p.y} r={9}
                className="cursor-grab active:cursor-grabbing"
                fill="hsl(240 10% 12%)"
                stroke="white" strokeOpacity={0.85} strokeWidth={2}
                onPointerDown={(e) => onKnobDown(idx, e)}
                style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.6))' }}
              />
            );
          })}
        </svg>
        {/* Each slice's icon, floated at its mid-angle inside the band. */}
        {MANA_STYLE_ORDER.map((k, i) => {
          const m = MANA_STYLE_META[k];
          const mid = (ext[i] + ext[i + 1]) / 2;
          const p = polar(RMID, mid);
          return (
            <span
              key={k}
              className="pointer-events-none absolute grid place-items-center"
              style={{ left: `${(p.x / BOX) * 100}%`, top: `${(p.y / BOX) * 100}%`, transform: 'translate(-50%, -50%)', color: 'hsl(240 10% 8%)' }}
            >
              <m.Icon className="h-4 w-4" strokeWidth={2.25} />
            </span>
          );
        })}
        {/* Center readout: land count + the leading lean. */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            {landCount != null && (
              <div className="font-display text-2xl font-bold leading-none text-foreground">≈{landCount}</div>
            )}
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">lands</div>
            <div className="mt-1 text-[11px] font-semibold" style={{ color: `hsl(${lead.hsl})` }}>{lead.name}</div>
          </div>
        </div>
      </div>

      {/* Exact readout: color · icon · name · live %. */}
      <div className="grid w-full max-w-sm grid-cols-2 gap-x-4 gap-y-1.5">
        {MANA_STYLE_ORDER.map((k, i) => {
          const m = MANA_STYLE_META[k];
          return (
            <div key={k} className="flex items-center gap-2 text-left">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `hsl(${m.hsl})` }} />
              <m.Icon className="h-3.5 w-3.5 shrink-0" style={{ color: `hsl(${m.hsl})` }} strokeWidth={2} />
              <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/80">{m.name}</span>
              <span className="tabular-nums text-[12px] font-semibold text-foreground/90">{Math.round(w[i] * 100)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
