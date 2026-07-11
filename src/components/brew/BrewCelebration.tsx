import { useEffect } from 'react';
import { Target, Flame, Infinity as InfinityIcon, type LucideIcon } from 'lucide-react';
import { useStore } from '@/store';
import type { BrewCelebration as Celebration } from '@/services/brew/engine';
import { playCelebration } from '@/services/brew/brewSound';

/**
 * A brief, celebratory toast fired at an earned beat — the run's "juice": completing the Brewer's
 * Goal, an "on a roll" synergy streak, or bringing a combo online. Mirrors BrewCommitFlash (lives in
 * BrewPage so it survives the screen unmounting, auto-dismisses), but sits a touch lower so the two
 * can coexist, and wears the beat's own color.
 */
const STYLE: Record<Celebration['kind'], { Icon: LucideIcon; hsl: string }> = {
  goal: { Icon: Target, hsl: '262 84% 72%' },     // violet — the run's objective
  streak: { Icon: Flame, hsl: '25 90% 60%' },     // ember — heating up
  combo: { Icon: InfinityIcon, hsl: '172 70% 50%' }, // teal — combo family
};

export function BrewCelebration() {
  const { brewCelebration, setBrewCelebration } = useStore();

  // A combo with its pieces attached earns the centered "engine comes online" takeover, which holds
  // a beat longer than a corner toast.
  const isComboTakeover = brewCelebration?.kind === 'combo' && !!brewCelebration.cards?.length;

  useEffect(() => {
    if (!brewCelebration) return;
    // Fire the sound + haptic cue once when this beat appears (respects the mute preference).
    playCelebration(brewCelebration.kind);
    const t = window.setTimeout(() => setBrewCelebration(null), isComboTakeover ? 3400 : 2800);
    return () => window.clearTimeout(t);
  }, [brewCelebration, setBrewCelebration, isComboTakeover]);

  if (!brewCelebration) return null;
  const { kind, title, subtitle, cards } = brewCelebration;
  const { Icon, hsl } = STYLE[kind];

  // ── Combo online: the pieces fly to center, a spark connects them, the spread locks with a punch.
  if (isComboTakeover && cards) {
    return (
      <div className="pointer-events-none fixed inset-0 z-[100] grid place-items-center px-4 animate-fade-in">
        <div
          className="flex flex-col items-center gap-3 rounded-3xl border px-7 py-6 backdrop-blur-md animate-brew-combo-lock"
          style={{
            borderColor: `hsl(${hsl} / 0.6)`,
            background: `linear-gradient(hsl(${hsl} / 0.18), hsl(${hsl} / 0.06)), hsl(var(--card) / 0.92)`,
            boxShadow: `0 18px 60px -10px hsl(${hsl} / 0.6)`,
          }}
        >
          <div className="flex items-center gap-2 font-display text-lg font-semibold" style={{ color: `hsl(${hsl})` }}>
            <Icon className="w-5 h-5" /> {title}
          </div>
          <div className="flex items-center gap-1.5">
            {cards.map((c, i) => (
              <div key={`${c.name}-${i}`} className="flex items-center gap-1.5">
                {i > 0 && (
                  <span
                    aria-hidden="true"
                    className="animate-brew-combo-line block h-[2px] w-6 rounded-full"
                    style={{ background: `hsl(${hsl})`, boxShadow: `0 0 8px hsl(${hsl} / 0.9)` }}
                  />
                )}
                <div
                  className="animate-brew-combo-piece overflow-hidden rounded-lg ring-1"
                  style={{ animationDelay: `${i * 110}ms`, width: 108, height: 78, ['--tw-ring-color' as string]: `hsl(${hsl} / 0.7)` }}
                >
                  {c.art
                    ? <img src={c.art} alt={c.name} className="w-full h-full object-cover" />
                    : <div className="grid h-full w-full place-items-center px-1 text-center text-[9px] font-semibold leading-tight text-foreground/80" style={{ background: `hsl(${hsl} / 0.16)` }}>{c.name}</div>}
                </div>
              </div>
            ))}
          </div>
          {subtitle && <div className="max-w-xs text-center text-xs text-foreground/80">{subtitle}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-40 z-[95] flex justify-center px-4 animate-brew-view-in">
      <div
        className="flex items-center gap-3 rounded-2xl border px-5 py-3 backdrop-blur-md"
        style={{
          borderColor: `hsl(${hsl} / 0.55)`,
          background: `linear-gradient(hsl(${hsl} / 0.16), hsl(${hsl} / 0.06)), hsl(var(--card) / 0.9)`,
          boxShadow: `0 12px 44px -10px hsl(${hsl} / 0.5)`,
        }}
      >
        <span
          className="grid place-items-center w-9 h-9 rounded-full border brew-node-pulse"
          style={{ color: `hsl(${hsl})`, borderColor: `hsl(${hsl} / 0.6)`, background: `hsl(${hsl} / 0.14)` }}
        >
          <Icon className="w-5 h-5" />
        </span>
        <div className="text-left">
          <div className="font-display text-sm font-semibold" style={{ color: `hsl(${hsl})` }}>{title}</div>
          {subtitle && <div className="text-[11px] text-foreground/75">{subtitle}</div>}
        </div>
      </div>
    </div>
  );
}
