import { VolumeX } from 'lucide-react';
import { useStore } from '@/store';
import { RAIL_TITLE_CLASS } from '@/components/brew/brewVisuals';

/**
 * "Mute a theme" — the player's steer-away control. The commander's themes are pills; tapping one
 * mutes it, so it stops forming theme packs, drops out of the exploration slot, and stops adding
 * affinity (see the engine's vetoedThemes hooks). It's a steer-away, not a card ban — a muted theme's
 * cards can still show up in a Good Stuff / need pack if they're independently useful.
 *
 * Lives in the stats rail so it's available from the very first fork (before the "pushed into X"
 * feeling builds), without cluttering the crack ceremony. Takes effect from the next round.
 */
export function BrewThemeVeto() {
  const { brewContext, brewState, toggleBrewThemeVeto } = useStore();
  if (!brewContext || !brewState) return null;
  const themes = Object.entries(brewContext.themeNames);
  if (themes.length === 0) return null;
  const vetoed = new Set(brewState.vetoedThemes ?? []);

  return (
    <div className="flex w-full flex-col items-center gap-1.5">
      <div className={RAIL_TITLE_CLASS}>Mute a theme</div>
      <div className="flex flex-wrap justify-center gap-1.5 px-1">
        {themes.map(([slug, name]) => {
          const muted = vetoed.has(slug);
          return (
            <button
              key={slug}
              onClick={() => toggleBrewThemeVeto(slug)}
              aria-pressed={muted}
              title={muted ? `Muted — tap to allow ${name} again` : `Tap to stop being steered toward ${name}`}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                muted
                  ? 'border-rose-400/50 bg-rose-500/15 text-rose-200'
                  : 'border-border/60 bg-card/50 text-muted-foreground hover:text-foreground/80'
              }`}
            >
              {muted && <VolumeX className="h-3 w-3" />}
              <span className={muted ? 'line-through' : ''}>{name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
