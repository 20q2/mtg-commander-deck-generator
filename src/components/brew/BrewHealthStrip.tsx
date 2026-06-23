import { useStore } from '@/store';
import { buildHealth } from '@/services/brew/engine';
import {
  Sparkles, Gem, Flame, PiggyBank, Sprout, Crosshair, Bomb, BookOpen,
  type LucideIcon,
} from 'lucide-react';
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

  // The commander is who the whole brew is built around — lead the strip with it so the deck's
  // identity is always in view. Partner pairs join with "+". Use the art crop (just the artwork)
  // rather than the full card so the circular avatar reads as a portrait, not a shrunk card.
  const commanderName = [brewContext.commander.name, brewContext.partnerCommander?.name]
    .filter((n): n is string => !!n)
    .join(' + ');
  const commanderArt =
    brewContext.commander.image_uris?.art_crop ??
    brewContext.commander.card_faces?.[0]?.image_uris?.art_crop;

  return (
    <div className="rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm px-4 py-2.5 flex items-center gap-3 flex-wrap text-xs">
      {/* Identity — who the brew is built around. The commander is stable, so it reads as a quiet
          label (not the hero); the avatar uses the art crop so it's a portrait, not a shrunk card. */}
      <span className="inline-flex items-center gap-2 min-w-0 max-w-[16rem]" title={commanderName}>
        {commanderArt && (
          <img
            src={commanderArt}
            alt={brewContext.commander.name}
            className="w-6 h-6 shrink-0 rounded-full object-cover ring-1 ring-violet-300/40"
          />
        )}
        <span className="font-display text-sm font-semibold tracking-tight text-foreground/90 truncate">
          {commanderName}
        </span>
      </span>

      {/* The run's live readout, pushed to the right edge: relics earned, then progress (cards · cost),
          then the headline Deck Score anchored last — the biggest, brightest thing in the strip, so
          the number climbing is the reward you feel. (Deck list is its own pinned button now.) */}
      <span className="ml-auto inline-flex items-center gap-3">
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

        <span className="inline-flex items-center gap-2 text-muted-foreground/70 tabular-nums">
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

        <span className="h-5 w-px bg-border/60" aria-hidden="true" />

        <StatPop
          value={h.deckScore}
          format={d => (Math.round(d) >= 1 ? `+${Math.round(d)}` : null)}
          colorClass="text-violet-300"
          className="text-violet-200"
        >
          <Sparkles className="w-3.5 h-3.5 text-violet-300/90" />
          <span className="text-[11px] font-medium text-violet-200/70">Deck Score</span>
          <span className="text-sm font-bold tabular-nums text-violet-100">{Math.round(h.deckScore)}</span>
        </StatPop>
      </span>
    </div>
  );
}
