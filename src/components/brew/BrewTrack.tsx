import { useStore } from '@/store';
import { isComplete, STEER_EVERY, isSteerIndex } from '@/services/brew/engine';
import { Package, Sparkles, Check } from 'lucide-react';

/**
 * A slim "what's ahead" bar under the health strip: the current cycle of nodes — a few packs, then
 * a moment (a fork / event / relic) — laid along a little rail. Turns pack-picking into a visible
 * journey instead of an aimless stream. Pure read-out of the run cadence (STEER_EVERY).
 */
const PACK_HSL = '262 80% 68%';   // violet, like the rest of the brew chrome
const EVENT_HSL = '43 92% 60%';   // gold — the moment stands out

export function BrewTrack() {
  const { brewContext, brewState } = useStore();
  if (!brewContext || !brewState) return null;
  if (isComplete(brewContext, brewState)) return null;   // deck's done — only the mana base remains

  const pos = brewState.history.length % STEER_EVERY;     // where we are in this cycle
  const slots = Array.from({ length: STEER_EVERY }, (_, i) => ({
    i,
    event: isSteerIndex(i),       // the last node of each cycle is the moment
    current: i === pos,
    done: i < pos,
  }));

  return (
    <div className="rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm px-4 py-2 flex items-center gap-4">
      <span className="shrink-0 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/55">Up next</span>
      <div className="relative flex-1 flex items-center justify-between">
        {/* The rail the nodes sit along, with a fill that grows to the current node — a little
            progress bar that increments step by step as you advance through the cycle. */}
        <span className="pointer-events-none absolute inset-x-1 top-1/2 -translate-y-1/2 h-0.5 rounded-full bg-border/40">
          <span
            className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out"
            style={{
              width: `${(pos / Math.max(1, STEER_EVERY - 1)) * 100}%`,
              background: 'linear-gradient(to right, hsl(262 80% 68%), hsl(43 92% 60%))',
              boxShadow: '0 0 8px hsl(262 80% 68% / 0.5)',
            }}
          />
        </span>
        {slots.map((s) => {
          const hsl = s.event ? EVENT_HSL : PACK_HSL;
          const Icon = s.event ? Sparkles : Package;
          const tint = s.current ? 0.22 : 0.12;
          return (
            <span
              key={s.i}
              className={`relative grid place-items-center rounded-full border transition-all duration-200 ${s.current ? 'w-7 h-7' : 'w-6 h-6'} ${s.done ? 'opacity-45' : ''}`}
              style={{
                color: `hsl(${hsl})`,
                borderColor: `hsl(${hsl} / ${s.current ? 0.85 : 0.4})`,
                // Opaque card base under the tint so the rail doesn't show through the node.
                background: `linear-gradient(hsl(${hsl} / ${tint}), hsl(${hsl} / ${tint})), hsl(var(--card))`,
                boxShadow: s.current ? `0 0 14px hsl(${hsl} / 0.45)` : undefined,
              }}
              title={s.event ? 'A moment — a fork, an event, or a relic' : 'Open a pack'}
            >
              {s.done ? <Check className="w-3 h-3" /> : <Icon className={s.current ? 'w-3.5 h-3.5' : 'w-3 h-3'} />}
            </span>
          );
        })}
      </div>
    </div>
  );
}
