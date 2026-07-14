import { useEffect, useState } from 'react';
import { Sparkles, ArrowRight, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The "what is this?" splash shown the moment you reach a brew, BEFORE the setup form. It pitches
 * the experience, plays a looping mini-demo of the actual loop (fork → bundles → pick → deck grows),
 * and lands the "the journey is yours" message — then `onContinue` reveals the budget/power setup.
 *
 * Shows every time but is skippable in one action: the CTA, any key, or a backdrop click all advance.
 * Self-contained — no store coupling; BrewPage passes the commander name and the continue handler.
 */

interface Props {
  commanderName?: string;
  onContinue: () => void;
}

// The three demo "bundles" — abstract previews tinted with the real fork tones (need/theme/neutral),
// labelled with example strategies so the player reads "coherent packages, pick one."
const DEMO_BUNDLES = [
  { label: 'Ramp', tone: '196 62% 56%' },      // blueprint cyan
  { label: 'Removal', tone: '22 92% 58%' },     // molten orange — this is the one that gets "picked"
  { label: 'Tokens', tone: '38 85% 58%' },      // brass
];
const PICKED = 1;            // index of the bundle that flies up to the deck
// The demo plays through in ~1.9s, then holds its final frame; only after a long settle does it
// replay — so it reads as a one-shot example, not a nervous loop.
const CYCLE_MS = 9000;

export function BrewSplash({ commanderName, onContinue }: Props) {
  const reduce = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // Bump a cycle counter to remount the animated subtree, replaying the one-shot keyframes.
  // Under reduced motion we never tick — the demo renders its final still frame.
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setCycle(c => c + 1), CYCLE_MS);
    return () => window.clearInterval(id);
  }, [reduce]);

  // Any key advances (matches the "press any key" hint); Escape/Enter included.
  useEffect(() => {
    const onKey = () => onContinue();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onContinue]);

  return (
    <div
      onClick={onContinue}
      className="relative flex min-h-[60vh] cursor-pointer flex-col items-center justify-center text-center animate-fade-in"
    >
      <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mb-2 drop-shadow-[0_2px_18px_hsl(var(--primary)/0.35)]">
        {commanderName ? <>Brew <span className="gradient-text">{commanderName}</span></> : 'Build your deck, your way'}
      </h1>
      <p className="text-sm text-muted-foreground max-w-md mb-8">
        Draft your deck one choice at a time — we deal the cards, you steer the direction.
      </p>

      {/* ── The looping mini-demo of the loop ───────────────────────────────── */}
      <div
        className="relative w-full max-w-sm h-48 mb-8 overflow-hidden rounded-2xl border border-border/50 bg-card/30 backdrop-blur-sm"
        aria-hidden="true"
      >
        {/* Deck counter — the card that flies up "lands" here as 12 → 15. */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-full border border-violet-400/40 bg-violet-500/10 px-2.5 py-1 text-[11px] font-semibold text-violet-200">
          <span className="opacity-70">Deck</span>
          <span className="tabular-nums">12</span>
          <span
            key={`tick-${cycle}`}
            className={reduce ? '' : 'animate-fade-in'}
            style={reduce ? undefined : { animationDelay: '1700ms', animationFillMode: 'backwards' }}
          >
            <span className="text-violet-100">→ 15</span> <span className="text-emerald-300">✓</span>
          </span>
        </div>

        {/* The animated stage, remounted each cycle so the one-shot keyframes replay. */}
        <div key={cycle} className="absolute inset-0 flex flex-col items-center pt-6">
          {/* "You are here" home node. */}
          <span className="brew-node-pulse relative z-10 w-7 h-7 rounded-full border border-violet-300/80 bg-primary/25 grid place-items-center text-violet-100">
            <MapPin className="w-3.5 h-3.5" />
          </span>

          {/* Branches fan down to the three bundles. */}
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-[78%] h-7 -mt-1" aria-hidden="true">
            {DEMO_BUNDLES.map((_, i) => {
              const x = ((i + 0.5) / DEMO_BUNDLES.length) * 100;
              return (
                <path
                  key={i}
                  d={`M 50 0 V 14 H ${x} V 40`}
                  pathLength={1}
                  className="brew-branch"
                  style={reduce ? { animation: 'none', strokeDashoffset: 0 } : { animationDelay: `${i * 80 + 60}ms` }}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>

          {/* The three bundle cards. The middle one lifts away to the deck. */}
          <div className="grid w-[78%] grid-cols-3 gap-3">
            {DEMO_BUNDLES.map((b, i) => {
              const flies = !reduce && i === PICKED;
              return (
                <div
                  key={b.label}
                  className={`flex flex-col items-center rounded-lg border bg-card/70 px-1 py-2 shadow-[0_8px_22px_-12px_rgba(0,0,0,0.7)] ${
                    reduce ? '' : flies ? 'animate-brew-to-deck' : 'animate-brew-card-in'
                  }`}
                  style={{
                    borderColor: `hsl(${b.tone} / 0.45)`,
                    ...(reduce ? {} : { animationDelay: flies ? '1500ms' : `${600 + i * 90}ms` }),
                  }}
                >
                  <span className="block h-[3px] w-8 rounded-full mb-1.5" style={{ background: `hsl(${b.tone})` }} />
                  <span className="text-[10px] font-semibold" style={{ color: `hsl(${b.tone})` }}>{b.label}</span>
                  <span className="mt-1 block h-1 w-6 rounded-full bg-muted-foreground/25" />
                  <span className="mt-1 block h-1 w-8 rounded-full bg-muted-foreground/20" />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="font-display text-lg sm:text-xl font-semibold text-violet-100 mb-7">
        The journey is yours. Build whatever deck you want.
      </p>

      <Button size="lg" onClick={onContinue} className="min-w-48 h-12 text-base btn-shimmer hover-lift">
        Set it up <ArrowRight className="w-4 h-4 ml-2" />
      </Button>
      <p className="mt-3 text-[11px] text-muted-foreground/60">press any key to continue</p>
    </div>
  );
}
