import { type ReactNode } from 'react';
import { Tags, ArrowRight } from 'lucide-react';
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
 * So this is a state, not a notification: it has no dismiss, and it disappears the moment a theme
 * is set. Nagging that the user cannot resolve would be worse than silence, but this one resolves
 * in a single click.
 *
 * The one-click path matters as much as the notice. Auto-declaring the near miss was measured and
 * rejected — 20 of 20 decks built from random cards also clear the classifier's floor, so nothing
 * available separates a real off-meta deck from a pile. The person who built the deck settles that
 * in a glance, which is why the closest match is offered rather than applied.
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
    <section className="rounded-xl border border-violet-400/35 bg-violet-500/[0.09] px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <Tags className="w-4 h-4 mt-0.5 shrink-0 text-violet-300/90" />
        <div className="flex-1 min-w-[16rem]">
          <h3 className="text-sm font-semibold text-violet-100">
            Set a theme so the Inspector can read this deck
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Strategy can&apos;t be scored without one, and suggestions fall back to this
            commander&apos;s generic top cards instead of your plan.
          </p>

          {closest && (
            <div className="mt-2">
              <div className="text-xs text-foreground/80">
                Closest match: <span className="font-medium text-violet-200">{closest.theme.name}</span>
                {' — '}
                <span className="text-muted-foreground">{themeEvidence(closest)}</span>
              </div>
              {names && (
                <div className="text-[10px] text-muted-foreground/60 truncate mt-0.5" title={names.full}>
                  {names.text}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {closest && (
            <Button
              size="sm"
              variant="secondary"
              className="gap-1.5"
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
