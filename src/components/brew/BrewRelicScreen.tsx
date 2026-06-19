import { useState } from 'react';
import { useStore } from '@/store';
import {
  Gem, Flame, Sparkles, PiggyBank, Sprout, Crosshair, Bomb, BookOpen, type LucideIcon,
} from 'lucide-react';
import type { BrewRelic } from '@/services/brew/engine';

/**
 * A deck-philosophy offer — a 1-of-3 choice of a persistent deckbuilding stance (Efficient / Spicy /
 * Combo). No skip: you commit once, and it biases every later offer. Shown via the relic plumbing.
 */

const RELIC_ICON: Record<string, LucideIcon> = {
  gem: Gem, flame: Flame, sparkles: Sparkles, 'piggy-bank': PiggyBank,
  sprout: Sprout, crosshair: Crosshair, bomb: Bomb, 'book-open': BookOpen,
};

// Relics read as warm, artifact-gold treasure.
const RELIC_HSL = '38 92% 60%';

export function BrewRelicScreen() {
  const { brewRelicOffer, chooseBrewRelic } = useStore();
  const [chosen, setChosen] = useState<string | null>(null);
  if (!brewRelicOffer || brewRelicOffer.length === 0) return null;

  const exiting = chosen !== null;
  function choose(relic: BrewRelic) {
    if (exiting) return;
    setChosen(relic.id);
    window.setTimeout(() => chooseBrewRelic(relic), 360);
  }

  return (
    <div className="text-center" style={{ ['--op' as string]: `hsl(${RELIC_HSL})` }}>
      <span
        className="mx-auto mb-3 grid place-items-center w-12 h-12 rounded-full border-2 backdrop-blur-sm brew-node-pulse"
        style={{ color: `hsl(${RELIC_HSL})`, borderColor: `hsl(${RELIC_HSL} / 0.6)`,
          background: `hsl(${RELIC_HSL} / 0.12)`, boxShadow: `0 0 30px hsl(${RELIC_HSL} / 0.4)` }}
      >
        <Gem className="w-6 h-6" />
      </span>
      <div className="flex items-center justify-center gap-3 mb-2" style={{ color: `hsl(${RELIC_HSL} / 0.85)` }}>
        <span className="h-px w-8 sm:w-14" style={{ background: `linear-gradient(to right, transparent, hsl(${RELIC_HSL} / 0.5))` }} />
        <span className="text-[10px] uppercase tracking-[0.32em] whitespace-nowrap">Set your approach</span>
        <span className="h-px w-8 sm:w-14" style={{ background: `linear-gradient(to left, transparent, hsl(${RELIC_HSL} / 0.5))` }} />
      </div>
      <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mb-1" style={{ textShadow: `0 2px 22px hsl(${RELIC_HSL} / 0.4)` }}>
        Choose your brew's philosophy
      </h2>
      <p className="text-xs text-muted-foreground mb-7">One stance — it shapes the rest of your brew.</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
        {brewRelicOffer.map((relic, idx) => {
          const Icon = RELIC_ICON[relic.glyph ?? ''] ?? Gem;
          return (
            <button
              key={relic.id}
              onClick={() => choose(relic)}
              disabled={exiting}
              style={exiting ? undefined : { animationDelay: `${idx * 70}ms` }}
              className={`group relative flex flex-col items-center gap-3 rounded-2xl border border-border/50 bg-card/40 backdrop-blur-sm px-5 py-6 text-center shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] transition-[transform,border-color,background-color] duration-200 hover:-translate-y-1.5 hover:bg-card/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                exiting ? (relic.id === chosen ? 'animate-brew-to-deck' : 'animate-brew-dismiss') : 'animate-brew-card-in'
              }`}
            >
              <span
                className="grid place-items-center w-14 h-14 rounded-full border"
                style={{ color: `hsl(${RELIC_HSL})`, borderColor: `hsl(${RELIC_HSL} / 0.5)`, background: `hsl(${RELIC_HSL} / 0.1)` }}
              >
                <Icon className="w-7 h-7" strokeWidth={1.5} />
              </span>
              <span className="font-display text-lg font-semibold text-foreground">{relic.name}</span>
              <span className="text-[13px] leading-snug text-foreground/75">{relic.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
