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

  useEffect(() => {
    if (!brewCelebration) return;
    // Fire the sound + haptic cue once when this beat appears (respects the mute preference).
    playCelebration(brewCelebration.kind);
    const t = window.setTimeout(() => setBrewCelebration(null), 2800);
    return () => window.clearTimeout(t);
  }, [brewCelebration, setBrewCelebration]);

  if (!brewCelebration) return null;
  const { kind, title, subtitle } = brewCelebration;
  const { Icon, hsl } = STYLE[kind];

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
