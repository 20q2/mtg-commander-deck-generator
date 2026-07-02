import { useState } from 'react';
import { useStore } from '@/store';
import { buildHealth, leaningThemes } from '@/services/brew/engine';
import {
  Sparkles, Gem, Flame, PiggyBank, Sprout, Crosshair, Bomb, BookOpen, Volume2, VolumeX,
  type LucideIcon,
} from 'lucide-react';
import { StatPop } from './StatPop';
import { isBrewSoundEnabled, setBrewSoundEnabled } from '@/services/brew/brewSound';

// Mirrors the glyph keys in relics.ts so acquired relics show a familiar icon in the tray.
const RELIC_ICON: Record<string, LucideIcon> = {
  gem: Gem, flame: Flame, sparkles: Sparkles, 'piggy-bank': PiggyBank,
  sprout: Sprout, crosshair: Crosshair, bomb: Bomb, 'book-open': BookOpen,
};

export function BrewHealthStrip() {
  const { brewContext, brewState } = useStore();
  // Celebration sound/haptic toggle (persisted). Hook stays above the early return per Rules of Hooks.
  const [soundOn, setSoundOn] = useState(isBrewSoundEnabled);
  if (!brewContext || !brewState) return null;
  const h = buildHealth(brewContext, brewState);
  const totalSlots = brewContext.nonLandTarget + brewContext.landTarget;

  // Cost guardrail: if the player set a deck budget, the running total colors against it (green →
  // amber near it → rose once over) and shows "/ $budget" so they feel the ceiling approaching.
  // With no budget set we don't nag — but a genuinely steep total still warms (amber/rose) so a
  // runaway price (e.g. an all-staples combo build) is visible rather than silent.
  // The deck's emerging identity, folded inline next to the commander so it doesn't need its own HUD
  // row — "Atraxa → Infect · Planeswalkers". (The wide-screen rail still shows the full identity radar.)
  const leaning = leaningThemes(brewContext, brewState);

  const budget = brewContext.customization.deckBudget;
  const costTone = budget && budget > 0
    ? (h.estCostUsd >= budget ? 'text-rose-300' : h.estCostUsd >= budget * 0.8 ? 'text-amber-300' : 'text-emerald-300')
    : (h.estCostUsd >= 400 ? 'text-rose-300' : h.estCostUsd >= 250 ? 'text-amber-300' : '');

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
    <div className="foundry-bevel rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm px-4 py-2.5 flex items-center gap-3 flex-wrap text-xs">
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

      {/* Emerging identity, inline — keeps the leaning readout in view without its own HUD row. */}
      {leaning.length > 0 && (
        <span className="inline-flex min-w-0 items-center gap-1.5" title={`Leaning into ${leaning.join(' · ')}`}>
          <span aria-hidden="true" className="text-violet-300/40">→</span>
          <span className="truncate font-medium text-violet-200/80">{leaning.join(' · ')}</span>
        </span>
      )}

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
            <span className={costTone || undefined}>${h.estCostUsd.toFixed(0)}</span>
            {budget && budget > 0 ? <span className="text-muted-foreground/60"> / ${budget}</span> : null}
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

        {/* Mute/unmute the celebration sound + haptic cues. */}
        <button
          type="button"
          onClick={() => { const next = !soundOn; setBrewSoundEnabled(next); setSoundOn(next); }}
          title={soundOn ? 'Mute celebration sounds' : 'Unmute celebration sounds'}
          aria-label={soundOn ? 'Mute celebration sounds' : 'Unmute celebration sounds'}
          aria-pressed={soundOn}
          className="grid place-items-center w-6 h-6 rounded-md text-muted-foreground/55 hover:text-violet-200 hover:bg-white/5 transition-colors"
        >
          {soundOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
        </button>
      </span>
    </div>
  );
}
