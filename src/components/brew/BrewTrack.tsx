import { useStore } from '@/store';
import { isComplete, NONLAND_COMPLETE_RATIO, brewGoal, goalProgress, peekHorizon, type HorizonSlot } from '@/services/brew/engine';
import { Layers, Check, Target, Flame, Gem, Infinity as InfinityIcon, MessageCircleQuestion, Mountain, type LucideIcon } from 'lucide-react';

/**
 * The "Run" bar — one line that carries everything about where you are in the run, so the HUD stays
 * two bars (deck stats above, run below) instead of a stack of three:
 *   • left   — the Brewer's Goal (live, flips to a green ✓ when nailed)
 *   • center — the cycle track: a few packs then a moment, the "what's next" rhythm
 *   • right  — the "on a roll" synergy streak (only once earned)
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
  if (!brewContext || !brewState) return null;
  if (isComplete(brewContext, brewState)) return null;   // deck's done — only the mana base remains

  // The fate-map: this node first, then what's coming. Moments show their forecast category when
  // it's stable (philosophy due / combo in reach / question due), a "?" rune when the path genuinely
  // depends on future picks — see peekHorizon's honesty rules.
  const horizon = peekHorizon(brewContext, brewState);

  // Overall progress toward the finish line — where the engine calls the nonland deck done and hands
  // the rest to the generator. Rendered as a quiet fill along the bar's bottom edge (+ a small %),
  // so the run visibly "loads" toward done without taking its own row.
  const nonLandPicks = brewState.picks.filter(p => !p.card.type_line.toLowerCase().includes('land')).length;
  const finishLine = Math.max(1, Math.floor(brewContext.nonLandTarget * NONLAND_COMPLETE_RATIO));
  const pct = Math.min(100, Math.round((nonLandPicks / finishLine) * 100));

  const goal = brewGoal(brewContext);
  const goalP = goalProgress(brewContext, brewState);
  const showCount = goal.id === 'wide' && !goalP.done;

  const streak = brewState.synergyStreak ?? 0;
  const streakLabel = streak >= 9 ? 'Unstoppable' : streak >= 6 ? 'Red hot' : 'On a roll';
  const streakHsl = streak >= 9 ? '0 80% 65%' : streak >= 6 ? '25 90% 60%' : '196 62% 56%';

  return (
    <div className="foundry-bevel relative overflow-hidden rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm px-3 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
      {/* Brewer's Goal */}
      <span
        className="inline-flex min-w-0 items-center gap-1.5"
        title={goalP.done ? `Goal complete — ${goal.description}` : `${goal.description} · ${pct}% to a finished deck`}
      >
        {goalP.done
          ? <Check className="w-3.5 h-3.5 shrink-0 text-emerald-300" />
          : <Target className="w-3.5 h-3.5 shrink-0 text-violet-300/90" />}
        <span className="shrink-0 uppercase tracking-[0.16em] text-muted-foreground/55">Goal</span>
        <span className={`truncate font-medium ${goalP.done ? 'text-emerald-200' : 'text-foreground/85'}`}>
          {goal.label}{showCount ? ` · ${goalP.current}/${goalP.target}` : ''}{goalP.done ? ' ✓' : ''}
        </span>
      </span>

      {/* Cycle track — full-width on its own line on mobile (wraps below), flex-1 inline on desktop. */}
      <div className="order-last w-full sm:order-none sm:w-auto sm:flex-1 flex items-center gap-2 min-w-0">
        <span className="shrink-0 tabular-nums text-[10px] font-medium text-violet-200/60">{pct}%</span>
        <div className="relative flex-1 flex items-center justify-between min-w-0">
          {/* The rail the upcoming nodes sit along — the horizon rolls forward with every node. */}
          <span className="pointer-events-none absolute inset-x-1 top-1/2 -translate-y-1/2 h-0.5 rounded-full bg-border/40" />
          {horizon.map((slot, i) => {
            const { Icon, hsl, title } = slotVisual(slot);
            const current = i === 0;   // slot 0 is the node being played right now
            const tint = current ? 0.22 : 0.12;
            return (
              <span
                key={i}
                className={`relative grid place-items-center rounded-full border transition-all duration-200 ${current ? 'w-7 h-7' : 'w-6 h-6'} ${i > 0 ? 'opacity-80' : ''}`}
                style={{
                  color: `hsl(${hsl})`,
                  borderColor: `hsl(${hsl} / ${current ? 0.85 : 0.4})`,
                  background: `linear-gradient(hsl(${hsl} / ${tint}), hsl(${hsl} / ${tint})), hsl(var(--card))`,
                  boxShadow: current ? `0 0 14px hsl(${hsl} / 0.45)` : undefined,
                }}
                title={title}
              >
                {Icon
                  ? <Icon className={current ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
                  : <span className="font-display text-[11px] font-bold leading-none opacity-80">?</span>}
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

      {/* On-a-roll streak — only once it's earned (≥3); pushed to the right edge on mobile. */}
      {streak >= 3 && (
        <span
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-semibold tabular-nums sm:ml-0"
          style={{ color: `hsl(${streakHsl})`, borderColor: `hsl(${streakHsl} / 0.5)`, background: `hsl(${streakHsl} / 0.12)` }}
          title={`${streak} plan-advancing picks in a row`}
        >
          <Flame className="w-3 h-3" /> {streakLabel} · {streak}
        </span>
      )}

      {/* Overall progress as a quiet fill along the bottom edge — the run "loads" toward a done deck. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 h-[2px] rounded-full bg-gradient-to-r from-violet-500/80 to-violet-300/80 transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
