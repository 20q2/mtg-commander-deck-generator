// src/components/deck/optimizer/dashboard/launchpad/PathTo100.tsx
//
// The sentence under the hero headline: how far from 100 and where the swaps on screen would land.
// "How is this scored?" unfolds the four areas, each opening the job working on it. The split itself
// is drawn on the score ring (ScoreRing); the areas are its legend.
import { useId, useState } from 'react';
import { BarChart3, ChevronDown, Shield, Target, Wand2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlanScore, SubScoreKey } from '@/types';
import type { PointsToGain } from '@/services/deckBuilder/planScore';

// Icons match the rail tabs and the old score tiles: Card Fit's wand, Strategy's target, Roles'
// shield, Tempo's bars. `hex` is `text`'s colour, for the ring's SVG strokes.
export const AREA_META: Record<SubScoreKey, { label: string; hex: string; text: string; Icon: LucideIcon; blurb: string }> = {
  cardFit:  { label: 'Card Fit', hex: '#fda4af', text: 'text-rose-300',    Icon: Wand2,     blurb: 'how many of your cards are proven, reliable picks in these decks' },
  strategy: { label: 'Strategy', hex: '#f0abfc', text: 'text-fuchsia-300', Icon: Target,    blurb: 'how much of the deck serves your plan' },
  roles:    { label: 'Roles',    hex: '#fcd34d', text: 'text-amber-300',   Icon: Shield,    blurb: 'enough ramp, removal, wipes, draw and protection' },
  tempo:    { label: 'Tempo',    hex: '#7dd3fc', text: 'text-sky-300',     Icon: BarChart3, blurb: 'a curve shaped like these decks\' curves' },
};
// From here up the deck is tuned: the last few points are the data's fine print, not a race, so
// the sentence says what the score means instead of counting down to 100.
export const WELL_TUNED_AT = 95;
// Fixed order: arcs and chips that reshuffle after every swap look broken.
export const AREA_ORDER: SubScoreKey[] = ['cardFit', 'strategy', 'roles', 'tempo'];
const ORDER = AREA_ORDER;

export function PathTo100({ planScore, gains, reach, onSelectArea, activeAreas }: {
  planScore: PlanScore;
  gains: PointsToGain[];
  /** Points the swaps on screen are projected to win; the sentence names where they land. */
  reach: number;
  onSelectArea: (area: SubScoreKey) => void;
  /** Areas the open job works on: their cells light up, the rest step back. Empty for jobs that
   *  don't move the score. */
  activeAreas: SubScoreKey[];
  sampleSize?: number | null;
  commanderShort: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const overall = planScore.overall;
  const gap = 100 - overall;
  const pointsOf = (k: SubScoreKey) => gains.find(g => g.key === k)?.points ?? 0;
  const scored = ORDER.filter(k => !planScore.subscores[k].partial);
  const inReach = Math.min(reach, pointsOf('cardFit') + pointsOf('strategy'));
  const focus = activeAreas.length > 0;
  const isActive = (k: SubScoreKey) => activeAreas.includes(k);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13.5px] text-muted-foreground">
        {overall >= WELL_TUNED_AT
          ? <>Well tuned. This deck should perform well at any table in its bracket.{' '}</>
          : gap > 0
          ? <>You're <span className="font-semibold text-foreground tabular-nums">{gap}</span> point{gap === 1 ? '' : 's'} from a perfect 100.{' '}
              {inReach > 0 && <>The swaps below get you to about <span className="font-semibold text-violet-300 tabular-nums">{overall + inReach}</span>.{' '}</>}
            </>
          : null}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(o => !o)}
          className="inline-flex cursor-pointer items-center gap-0.5 whitespace-nowrap rounded-sm text-violet-300 underline-offset-2 transition-colors hover:text-violet-200 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          How is this scored?
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
      </p>

      {/* The four areas, folded away until asked for: the number above is the answer, this is the
          working. Each area opens the job that works on it. */}
      <div
        id={panelId}
        className={cn(
          'grid transition-[grid-template-rows,visibility,opacity] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none',
          open ? 'visible grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="rounded-lg border border-border/60 bg-background/80 p-1.5">
            <p className="px-2 pb-1.5 pt-1 text-[12px] text-muted-foreground">
              {overall >= WELL_TUNED_AT
                ? `At ${WELL_TUNED_AT} and up the deck is well tuned. What the areas below can still suggest is polish; it won't change how the deck plays.`
                : 'A 100 means the deck should perform well at any table in its bracket, with little left the data can improve.'}
            </p>
            <div className="grid gap-1 sm:grid-cols-2">
              {scored.map(k => {
                const pts = pointsOf(k);
                const value = planScore.subscores[k].value;
                const { Icon } = AREA_META[k];
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => onSelectArea(k)}
                    aria-pressed={isActive(k)}
                    className={cn(
                      'flex cursor-pointer flex-col gap-0.5 rounded-md border px-2.5 py-2 text-left transition-[background-color,border-color,opacity] duration-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                      isActive(k)
                        ? 'border-violet-400/55 bg-violet-500/15'
                        : cn('border-transparent hover:bg-muted/40', focus && 'opacity-60 hover:opacity-100'),
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-[12.5px]">
                      {/* A maxed area keeps its icon and turns green. */}
                      <Icon className={cn('h-3.5 w-3.5 shrink-0', value >= 100 ? 'text-emerald-400' : AREA_META[k].text)} aria-hidden="true" />
                      <span className="font-medium text-foreground">{AREA_META[k].label}</span>
                      <span className="tabular-nums text-foreground/85">{value}</span>
                      {pts > 0 && overall < WELL_TUNED_AT && <span className="ml-auto font-semibold tabular-nums text-violet-300">+{pts} to gain</span>}
                    </span>
                    <span className="text-[12px] leading-snug text-muted-foreground">
                      {AREA_META[k].blurb[0].toUpperCase() + AREA_META[k].blurb.slice(1)}.
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="px-2 pb-1 pt-1.5 text-[11.5px] text-muted-foreground">
              Keep a card on the Find upgrades list and it won't be suggested as a cut again.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
