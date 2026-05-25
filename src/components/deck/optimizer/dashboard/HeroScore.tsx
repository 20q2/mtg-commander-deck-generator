// src/components/deck/optimizer/dashboard/HeroScore.tsx
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Pencil, Bookmark, ExternalLink } from 'lucide-react';
import { ColorIdentity } from '@/components/ui/mtg-icons';
import type { PlanScore, ScryfallCard } from '@/types';
import type { ReactNode } from 'react';

export interface HeroScoreProps {
  planScore: PlanScore;
  commander: ScryfallCard;
  partnerCommander?: ScryfallCard;
  colorIdentity?: string[];
  sourceLabel: string;
  /** Display text for the detected plan, e.g. "+1/+1 Counters". null when none detected. */
  planName?: string | null;
  /** Adjust popover content. */
  adjustContent?: ReactNode;
  onSaveAsDeck?: () => void;
  onOpenInDeckView?: () => void;
}

export function HeroScore({
  planScore,
  commander,
  partnerCommander,
  colorIdentity,
  sourceLabel,
  planName,
  adjustContent,
  onSaveAsDeck,
  onOpenInDeckView,
}: HeroScoreProps) {
  const pct = Math.max(0, Math.min(100, planScore.overall));
  const ringStyle = {
    background: `conic-gradient(hsl(var(--primary)) 0% ${pct}%, rgba(255,255,255,0.14) ${pct}% 100%)`,
  };

  // Resolve art_crop URL: try primary commander first, then partner
  const artUrl =
    commander.image_uris?.art_crop ??
    commander.card_faces?.[0]?.image_uris?.art_crop ??
    partnerCommander?.image_uris?.art_crop ??
    partnerCommander?.card_faces?.[0]?.image_uris?.art_crop ??
    null;

  return (
    <div className="relative overflow-hidden rounded-xl border border-border/30 bg-card/40 min-h-[10rem] p-6 sm:p-8">
      {/* Layer 1: commander art backdrop (-z-20) */}
      {artUrl && (
        <div
          className="absolute inset-0 -z-20 bg-cover bg-right rounded-xl pointer-events-none"
          style={{ backgroundImage: `url(${artUrl})`, opacity: 0.3 }}
          aria-hidden="true"
        />
      )}
      {/* Layer 2: heavy left-favoring gradient so text stays readable (-z-10) */}
      <div
        className="absolute inset-0 -z-10 rounded-xl pointer-events-none bg-gradient-to-r from-card via-card/80 to-card/30"
        aria-hidden="true"
      />
      {/* Layer 3: violet radial accent */}
      <div
        className="absolute inset-0 rounded-xl pointer-events-none"
        style={{
          background: 'radial-gradient(circle at top left, rgba(167,139,250,0.12), transparent 60%)',
          zIndex: 0,
        }}
        aria-hidden="true"
      />

      {/* All content sits above backdrop layers */}
      <div className="relative flex flex-col gap-5" style={{ zIndex: 1 }}>

        {/* TOP ROW: commander info + action buttons */}
        <div className="flex flex-col sm:flex-row sm:items-start gap-3">
          {/* Commander info */}
          <div className="flex-1 min-w-0">
            <div className="text-base sm:text-lg font-bold text-foreground leading-snug">
              {commander.name}
              {partnerCommander && (
                <span className="text-muted-foreground font-normal"> + {partnerCommander.name}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground/70">
              <span className="truncate">{sourceLabel}</span>
              {planName && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    Detected plan:
                    <span className="px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 font-semibold text-[10px]">
                      {planName}
                    </span>
                  </span>
                </>
              )}
            </div>
            {colorIdentity && colorIdentity.length > 0 && (
              <div className="mt-1.5">
                <ColorIdentity colors={colorIdentity} size="sm" />
              </div>
            )}
          </div>

          {/* Action buttons — right-aligned, stack below on mobile */}
          <div className="flex items-center gap-2 shrink-0 self-start">
            {adjustContent && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Pencil className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Adjust plan</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="bottom" align="end" className="w-80 p-0">
                  {adjustContent}
                </PopoverContent>
              </Popover>
            )}
            {onOpenInDeckView ? (
              <Button size="sm" variant="outline" onClick={onOpenInDeckView}>
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                <span className="hidden sm:inline">Deck view</span>
              </Button>
            ) : onSaveAsDeck ? (
              <Button size="sm" variant="outline" onClick={onSaveAsDeck}>
                <Bookmark className="w-3.5 h-3.5 mr-1.5" />
                <span className="hidden sm:inline">Save as deck</span>
              </Button>
            ) : null}
          </div>
        </div>

        {/* BOTTOM ROW: score ring + headline + byline */}
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div
            className="w-32 h-32 sm:w-40 sm:h-40 rounded-full flex items-center justify-center shrink-0"
            style={ringStyle}
            aria-label={`Plan score ${pct} out of 100`}
          >
            <div className="w-[78%] h-[78%] rounded-full bg-card flex flex-col items-center justify-center">
              <div className="text-4xl sm:text-5xl font-black tabular-nums leading-none">{pct}</div>
              <div className="mt-1.5 text-[10px] uppercase tracking-wider font-semibold text-violet-300/80">
                {planScore.bandLabel}
              </div>
            </div>
          </div>
          <div className="flex-1 min-w-0 text-center sm:text-left">
            <h2 className="text-lg sm:text-xl font-semibold leading-snug text-foreground">
              {planScore.headline}
            </h2>
            <p className="mt-2 text-xs text-muted-foreground/70">{planScore.byline}</p>
            {planScore.limitedData && (
              <p className="mt-1 text-[11px] text-amber-400/70">
                Limited data — some sub-scores excluded.
              </p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
