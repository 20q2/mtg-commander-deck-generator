import { type ReactNode } from 'react';
import { Tags, ArrowRight, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ThemeMatchResult } from '@/services/deckBuilder/themeDetector';
import { themeEvidence, memberPreview } from '@/services/deckBuilder/themeEvidence';

/**
 * Shown on the Overview whenever the deck has no theme declared.
 *
 * Without one the Inspector is running at half power and saying so only in small print: Strategy
 * scores 0, the recommendation pool falls back to the commander's generic top cards, and the cut
 * logic loses its "this card serves the plan" exemption. A tuned off-meta deck — a Glissa
 * prison/stax pile whose commander page is all infect and counters — is exactly the deck that
 * needs a theme most and is least likely to get one automatically.
 *
 * When there IS a candidate to offer, this REPLACES the suggested-next-steps block rather than
 * stacking above it. Two stacked call-to-action bands read as noise, and more to the point those
 * next steps are computed against role targets that change the moment a theme is set — so they are
 * advice about to be recalculated. They come back, corrected, one click later. With no candidate to
 * offer there is no one-click fix, so the real advice stays and this sits above it instead.
 *
 * Amber rather than violet: violet is this app's synergy/theme accent and reads as decoration in a
 * page already full of it. Amber is the established "needs your attention" colour here (the stale
 * re-analyse button, the limited-data note). Not red — nothing is broken, and a deck with no theme
 * is the normal state of a freshly pasted list.
 *
 * A state, not a notification: no dismiss, and it disappears the moment a theme is set. Nagging
 * that the user cannot resolve would be worse than silence; this one resolves in a single click.
 *
 * That click is the point. Auto-declaring the near miss was measured and rejected — 20 of 20 decks
 * built from RANDOM cards also clear the classifier's floor, one scoring higher than a real
 * off-meta deck's correct answer. Nothing available separates the two, so the person who built the
 * deck settles it in a glance.
 */
export interface ThemePromptProps {
  /** Best candidate the detector found, even though it fell short of declaring. */
  closest?: ThemeMatchResult | null;
  /** Apply a single theme as the primary. */
  onApply: (slug: string) => void;
  /** The Adjust popover's contents, so "Choose themes" opens the real picker. */
  adjustContent?: ReactNode;
}

export function ThemePrompt({ closest, onApply, adjustContent }: ThemePromptProps) {
  const names = closest ? memberPreview(closest) : null;

  return (
    // Mirrors the suggested-next-steps block it stands in for — same radius, border weight and
    // gradient — so the swap reads as that slot changing its mind, not as a new widget appearing.
    <section className="rounded-xl border border-amber-500/45 bg-gradient-to-br from-amber-500/[0.12] via-amber-500/[0.05] to-transparent p-4 animate-fade-in">
      <div className="flex items-center gap-1.5 mb-3">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
        <span className="text-[11px] uppercase tracking-wider font-semibold text-amber-300/80">
          Action needed
        </span>
      </div>

      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="flex-1 min-w-[17rem]">
          <h3 className="text-sm font-semibold text-foreground">
            Set a theme so the Inspector can read this deck
          </h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Strategy can&apos;t be scored without one, suggestions fall back to this
            commander&apos;s generic top cards instead of your plan, and the other advice on this
            page is measured against targets a theme would change.
          </p>

          {closest && (
            <div className="mt-2.5 flex items-start gap-1.5">
              <Tags className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-300/70" />
              <div className="min-w-0">
                <div className="text-xs text-foreground/85">
                  Closest match: <span className="font-medium text-amber-100">{closest.theme.name}</span>
                  {' — '}
                  <span className="text-muted-foreground">{themeEvidence(closest)}</span>
                </div>
                {names && (
                  <div className="text-[10px] text-muted-foreground/60 truncate mt-0.5" title={names.full}>
                    {names.text}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto shrink-0">
          {/* No amber variant exists on Button and `destructive` is red, which overstates this —
              so it's the ghost base with an amber skin rather than a raw element. */}
          {closest && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 bg-amber-500/25 border border-amber-400/60 text-amber-50 hover:bg-amber-500/40 hover:text-white"
              onClick={() => onApply(closest.theme.slug)}
            >
              Use {closest.theme.name}
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          )}
          {adjustContent && (
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant={closest ? 'ghost' : 'secondary'}>
                  {closest ? 'Pick another' : 'Choose themes'}
                </Button>
              </PopoverTrigger>
              <PopoverContent side="bottom" align="end" className="w-80 p-0">
                {adjustContent}
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
    </section>
  );
}
