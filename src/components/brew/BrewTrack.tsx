import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { isComplete, NONLAND_COMPLETE_RATIO, peekHorizon, type HorizonSlot } from '@/services/brew/engine';
import { Layers, Gem, Infinity as InfinityIcon, MessageCircleQuestion, Mountain, type LucideIcon } from 'lucide-react';

/**
 * The "Run" bar — one line that carries everything about where you are in the run, so the HUD stays
 * two bars (deck stats above, run below) instead of a stack of three:
 *   • center — the cycle track: a few packs then a moment, the "what's next" rhythm
 *   • base   — a subtle fill across the bottom edge = overall progress to a finished deck
 */
const PACK_HSL = '196 62% 56%';   // blueprint cyan — the Foundry's structural line
const EVENT_HSL = '33 92% 56%';   // molten brass — the moment stands out
const COMBO_HSL = '172 70% 50%';  // combo teal — matches the recap's combo moments

/** How each fate-map slot renders: icon (or the "?" rune), colour, and its honest tooltip. */
function slotVisual(slot: HorizonSlot): { Icon: LucideIcon | null; hsl: string; title: string } {
  if (slot.kind === 'pack') return { Icon: Layers, hsl: PACK_HSL, title: 'Open a pack' };
  if (slot.kind === 'manabase') return { Icon: Mountain, hsl: PACK_HSL, title: 'Build the mana base' };
  switch (slot.category) {
    case 'philosophy': return { Icon: Gem, hsl: EVENT_HSL, title: 'A philosophy choice is due' };
    case 'combo': return { Icon: InfinityIcon, hsl: COMBO_HSL, title: 'A combo fragment is within reach' };
    case 'question': return { Icon: MessageCircleQuestion, hsl: EVENT_HSL, title: 'A question about your playstyle' };
    default: return { Icon: null, hsl: EVENT_HSL, title: 'A moment — the path shifts with your picks' };
  }
}

export function BrewTrack() {
  const { brewContext, brewState } = useStore();

  // The fate-map: this node first, then what's coming. Moments show their forecast category when
  // it's stable (philosophy due / combo in reach / question due), a "?" rune when the path genuinely
  // depends on future picks — see peekHorizon's honesty rules.
  const horizon = brewContext && brewState && !isComplete(brewContext, brewState)
    ? peekHorizon(brewContext, brewState)
    : [];

  // Each slot is keyed by its ABSOLUTE node index in the run (history.length + offset). When a
  // round completes the horizon rolls forward, but every circle keeps its DOM node and its new
  // rail position transitions — the whole row visibly slides one step down instead of blinking.
  // The just-completed node lives one more render as a "ghost" (from the previous frame's slots)
  // so it can slide off the left edge while fading, instead of vanishing.
  const base = brewState?.history.length ?? 0;
  const slots = horizon.map((slot, i) => ({ key: base + i, slot }));
  const prevSlotsRef = useRef<typeof slots>([]);
  const ghost = prevSlotsRef.current.find(s => s.key === base - 1);
  useEffect(() => { prevSlotsRef.current = slots; });

  // No run, or deck's done — only the mana base remains. (horizon is only non-empty when both exist.)
  if (!brewContext || !brewState || horizon.length === 0) return null;

  // Overall progress toward the finish line — where the engine calls the nonland deck done and hands
  // the rest to the generator. Rendered as a quiet fill along the bar's bottom edge (+ a small %),
  // so the run visibly "loads" toward done without taking its own row.
  const nonLandPicks = brewState.picks.filter(p => !p.card.type_line.toLowerCase().includes('land')).length;
  const finishLine = Math.max(1, Math.floor(brewContext.nonLandTarget * NONLAND_COMPLETE_RATIO));
  const pct = Math.min(100, Math.round((nonLandPicks / finishLine) * 100));

  return (
    <div className="foundry-bevel relative overflow-hidden rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm px-3 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
      {/* Cycle track */}
      <div className="w-full flex items-center gap-2 min-w-0">
        <span className="shrink-0 tabular-nums text-[10px] font-medium text-violet-200/60">{pct}%</span>
        <div className="relative h-7 flex-1 min-w-0" style={{ containerType: 'inline-size' }}>
          {/* The rail the upcoming nodes sit along — the horizon rolls forward with every node. */}
          <span className="pointer-events-none absolute inset-x-1 top-1/2 -translate-y-1/2 h-0.5 rounded-full bg-border/40" />
          {/* Every slot is pinned at left:0 and placed purely via transform — (100cqw - 100%) is the
              rail's usable span (container minus one slot), so frac walks it justify-between style.
              Transform-only motion stays on the compositor: no per-frame layout, no jitter. */}
          {[...(ghost ? [{ ...ghost, i: -1 }] : []), ...slots.map((s, i) => ({ ...s, i }))].map(({ key, slot, i }) => {
            const { Icon, hsl, title } = slotVisual(slot);
            const current = i === 0;   // slot 0 is the node being played right now
            const gone = i < 0;        // the ghost — just completed, sliding off the left edge
            const frac = i / Math.max(1, horizon.length - 1);
            const tint = current ? 0.22 : 0.12;
            return (
              <span
                key={key}
                aria-hidden={gone || undefined}
                className={`brew-horizon-slot absolute left-0 top-1/2 grid h-7 w-7 place-items-center ${gone ? 'pointer-events-none' : ''}`}
                style={{
                  transform: `translate(calc((100cqw - 100%) * ${frac}), -50%) scale(${gone ? 0.7 : 1})`,
                  opacity: gone ? 0 : i > 0 ? 0.8 : 1,
                }}
                title={gone ? undefined : title}
              >
                <span
                  className={`grid place-items-center rounded-full border transition-all duration-[560ms] ease-[cubic-bezier(0.22,0.9,0.32,1)] ${current ? 'w-7 h-7' : 'w-6 h-6'}`}
                  style={{
                    color: `hsl(${hsl})`,
                    borderColor: `hsl(${hsl} / ${current ? 0.85 : 0.4})`,
                    background: `linear-gradient(hsl(${hsl} / ${tint}), hsl(${hsl} / ${tint})), hsl(var(--card))`,
                    boxShadow: current ? `0 0 14px hsl(${hsl} / 0.45)` : undefined,
                  }}
                >
                  {Icon
                    ? <Icon className={current ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
                    : <span className="font-display text-[11px] font-bold leading-none opacity-80">?</span>}
                </span>
              </span>
            );
          })}
        </div>
        {/* Dotted tail — the journey continues past the moment. */}
        <span
          aria-hidden="true"
          className="pointer-events-none shrink-0 h-1 w-8 sm:w-16"
          style={{
            backgroundImage: 'radial-gradient(circle at center, hsl(var(--border) / 0.4) 1.3px, transparent 1.6px)',
            backgroundSize: '7px 4px',
            backgroundRepeat: 'repeat-x',
            maskImage: 'linear-gradient(to right, black, transparent 92%)',
            WebkitMaskImage: 'linear-gradient(to right, black, transparent 92%)',
          }}
        />
      </div>

      {/* Overall progress as a quiet fill along the bottom edge — the run "loads" toward a done deck. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 h-[2px] rounded-full bg-gradient-to-r from-violet-500/80 to-violet-300/80 transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
