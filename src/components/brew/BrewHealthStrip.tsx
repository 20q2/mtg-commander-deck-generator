import { useStore } from '@/store';
import { buildHealth } from '@/services/brew/engine';
import {
  Sparkles, Gem, Flame, PiggyBank, Sprout, Crosshair, Bomb, BookOpen,
  type LucideIcon,
} from 'lucide-react';
import { BrewDeckListButton } from './BrewDeckListButton';
import { StatPop } from './StatPop';

// Mirrors the glyph keys in relics.ts so acquired relics show a familiar icon in the tray.
const RELIC_ICON: Record<string, LucideIcon> = {
  gem: Gem, flame: Flame, sparkles: Sparkles, 'piggy-bank': PiggyBank,
  sprout: Sprout, crosshair: Crosshair, bomb: Bomb, 'book-open': BookOpen,
};

export function BrewHealthStrip() {
  const { brewContext, brewState } = useStore();
  if (!brewContext || !brewState) return null;
  const h = buildHealth(brewContext, brewState);
  const totalSlots = brewContext.nonLandTarget + brewContext.landTarget;

  return (
    <div className="rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm px-4 py-2.5 flex items-center gap-4 flex-wrap text-xs">
      {/* The stats-rail show/hide control now lives on the rail itself (BrewStatsPanel), so it stays
          anchored to the panel it governs instead of floating out here in the toolbar. */}
      <StatPop
        value={h.deckScore}
        format={d => (Math.round(d) >= 1 ? `+${Math.round(d)}` : null)}
        colorClass="text-violet-300"
        className="font-semibold text-violet-200"
      >
        <Sparkles className="w-3.5 h-3.5" /> Deck Score {Math.round(h.deckScore)}
      </StatPop>

      {/* Relic tray: acquired modifiers, persistent reminders that the build has evolved. */}
      {brewState.relics.length > 0 && (
        <span className="inline-flex items-center gap-1.5">
          {brewState.relics.map(relic => {
            const Icon = RELIC_ICON[relic.glyph ?? ''] ?? Gem;
            return (
              <span
                key={relic.id}
                title={`${relic.name} — ${relic.description}`}
                className="grid place-items-center w-6 h-6 rounded-full border border-amber-400/50 bg-amber-500/12 text-amber-300"
              >
                <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
              </span>
            );
          })}
        </span>
      )}

      <span className="ml-auto inline-flex items-center gap-2 text-muted-foreground/70 tabular-nums">
        <StatPop
          value={h.cardCount}
          format={d => `+${d} card${d > 1 ? 's' : ''}`}
          colorClass="text-emerald-300"
        >
          {h.cardCount} / {totalSlots}
        </StatPop>
        <span aria-hidden="true">·</span>
        <StatPop
          value={h.estCostUsd}
          format={d => (Math.round(d) >= 1 ? `+$${Math.round(d)}` : null)}
          colorClass="text-amber-300"
        >
          ${h.estCostUsd.toFixed(0)}
        </StatPop>
      </span>

      <BrewDeckListButton />
    </div>
  );
}
