import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { leaningThemes, generateRunTitle } from '@/services/brew/engine';
import {
  Sparkles, Infinity as InfinityIcon, GitFork, Gem, Compass, ArrowRight, ScrollText, Crown, Dices, type LucideIcon,
} from 'lucide-react';
import { getCardImageUrl } from '@/services/scryfall/client';
import type { BrewMoment } from '@/services/brew/engine';

/**
 * The end-of-run story. Built entirely from the moments logged during the brew (Strange Signals
 * trusted, combos chased, Crossroads committed, relics gained) plus the deck's final leaning. The
 * deck is the output; this is the story of how it came together — the thing that makes you replay.
 */

const MOMENT_ICON: Record<BrewMoment['kind'], { Icon: LucideIcon; color: string }> = {
  opening: { Icon: Compass, color: '262 80% 68%' },
  strangeSignal: { Icon: Sparkles, color: '292 76% 64%' },
  comboFragment: { Icon: InfinityIcon, color: '172 70% 50%' },
  crossroads: { Icon: GitFork, color: '43 92% 60%' },
  signaturePick: { Icon: Crown, color: '268 84% 72%' },
  gamble: { Icon: Dices, color: '25 88% 58%' },
  relic: { Icon: Gem, color: '38 92% 60%' },
  goldCard: { Icon: Crown, color: '45 92% 56%' },
};

export function BrewRunRecap({ onContinue }: { onContinue: () => void }) {
  const { brewContext, brewState } = useStore();
  if (!brewContext || !brewState) return null;

  const identity = leaningThemes(brewContext, brewState);
  const title = generateRunTitle(brewContext, brewState);
  const philosophy = brewState.relics[0]?.name;
  const moments = brewState.moments;
  const secretTech = moments.filter(m => m.kind === 'strangeSignal' && m.label.startsWith('Trusted')).length;
  const cardCount = brewState.picks.length;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/85 backdrop-blur-md p-4 animate-brew-view-in">
      <div className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl border border-border/60 bg-card/80 backdrop-blur-xl shadow-[0_24px_80px_-20px_rgba(0,0,0,0.8)] p-6 sm:p-8 text-center">
        <span className="mx-auto mb-3 grid place-items-center w-12 h-12 rounded-full border-2 border-violet-300/60 bg-violet-500/12 text-violet-200 shadow-[0_0_28px_hsl(262_83%_58%/0.35)]">
          <ScrollText className="w-6 h-6" />
        </span>
        <div className="flex items-center justify-center gap-3 mb-2 text-muted-foreground/70">
          <span className="h-px w-10 bg-gradient-to-r from-transparent to-border" />
          <span className="text-[10px] uppercase tracking-[0.32em] whitespace-nowrap">Your run</span>
          <span className="h-px w-10 bg-gradient-to-l from-transparent to-border" />
        </div>

        <div className="flex items-center justify-center gap-3 mb-1">
          <img
            src={getCardImageUrl(brewContext.commander, 'small')}
            alt={brewContext.commander.name}
            className="w-10 h-10 rounded-full object-cover ring-1 ring-black/50"
            style={{ objectPosition: 'center 18%' }}
          />
          <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">
            {title}
          </h2>
        </div>
        {identity.length > 0 && (
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-1">
            {identity.join(' · ')}
          </p>
        )}
        <p className="text-xs text-muted-foreground mb-6">
          {cardCount} cards drafted{secretTech > 0 ? ` · ${secretTech} secret-tech find${secretTech > 1 ? 's' : ''}` : ''}
          {philosophy ? ` · guided by ${philosophy}` : ''}
        </p>

        {moments.length > 0 ? (
          <ol className="text-left space-y-2.5 mb-7">
            {moments.map((m, i) => {
              const { Icon, color } = MOMENT_ICON[m.kind];
              return (
                <li key={i} className="flex items-start gap-3">
                  <span
                    className="mt-0.5 grid place-items-center w-7 h-7 shrink-0 rounded-full border"
                    style={{ color: `hsl(${color})`, borderColor: `hsl(${color} / 0.5)`, background: `hsl(${color} / 0.1)` }}
                  >
                    <Icon className="w-4 h-4" strokeWidth={1.75} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="font-display text-sm font-semibold text-foreground">{m.label}</span>
                    {m.detail && <span className="block font-flavor text-[13px] italic text-muted-foreground leading-snug">{m.detail}</span>}
                  </span>
                  <span className="text-[10px] tabular-nums text-muted-foreground/50 mt-1">#{m.atPick}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="font-flavor text-[15px] italic text-muted-foreground mb-7">A quiet, focused build — straight down the line.</p>
        )}

        <Button size="lg" className="btn-shimmer" onClick={onContinue}>
          View your deck <ArrowRight className="w-4 h-4 ml-1.5" />
        </Button>
      </div>
    </div>
  );
}
