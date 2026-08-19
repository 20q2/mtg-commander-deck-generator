// src/components/deck/optimizer/dashboard/HeroScore.tsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Pencil, ExternalLink, FlaskConical } from 'lucide-react';
import { ColorIdentity } from '@/components/ui/mtg-icons';
import { getCardImageUrl } from '@/services/scryfall/client';
import { formatCommanderNameForUrl } from '@/services/edhrec/client';
import { BRACKET_COLORS } from '../constants';
import { bracketLabelFor, type BracketEstimation } from '@/services/deckBuilder/bracketEstimator';
import { headlineFor, bylineFor } from '@/services/deckBuilder/planScore';
import type { PlanScore, ScryfallCard } from '@/types';
import type { ReactNode } from 'react';

export interface HeroScoreProps {
  planScore: PlanScore;
  commander: ScryfallCard;
  partnerCommander?: ScryfallCard;
  colorIdentity?: string[];
  sourceLabel: string;
  /** Display text for the primary detected plan, e.g. "+1/+1 Counters". null when none detected. */
  planName?: string | null;
  /** Display text for the secondary plan, if one is selected. */
  secondaryPlanName?: string | null;
  /** Bracket estimate for this deck. When present the headline names the bracket;
   *  when absent the stored `planScore.headline` is used unchanged. */
  bracketEstimation?: BracketEstimation;
  /** EDHREC decklist count backing the score — cited in the byline. */
  sampleSize?: number | null;
  /** Opens the Bracket tab. When set, the bracket phrase in the headline becomes
   *  a link to the evidence behind it. */
  onNavigateToBracket?: () => void;
  /** Adjust popover content. */
  adjustContent?: ReactNode;
  onOpenInDeckView?: () => void;
}

export function HeroScore({
  planScore,
  commander,
  partnerCommander,
  colorIdentity,
  sourceLabel,
  planName,
  secondaryPlanName,
  bracketEstimation,
  sampleSize,
  onNavigateToBracket,
  adjustContent,
  onOpenInDeckView,
}: HeroScoreProps) {
  const [hover, setHover] = useState<{ card: ScryfallCard; rect: DOMRect } | null>(null);
  const target = Math.max(0, Math.min(100, planScore.overall));
  const [displayed, setDisplayed] = useState(0);

  // The bracket is a second, independent fact about the deck, not a scope on the
  // score — see headlineFor's contract. Falls back to the stored headline when
  // the deck has no estimate (e.g. a list the tagger hasn't enriched).
  const bracketPhrase = bracketEstimation
    ? bracketLabelFor(bracketEstimation.bracket, bracketEstimation.bracketMax)
    : null;
  const headline = bracketPhrase
    ? headlineFor(planScore.overall, planName, bracketPhrase)
    : planScore.headline;

  // Short name only — "the average Skullbriar deck", not "the average
  // Skullbriar, the Walking Grave deck".
  const commanderLabel = [commander, partnerCommander]
    .filter((c): c is ScryfallCard => !!c)
    .map(c => c.name.split(',')[0].trim())
    .join(' + ');
  const byline = bylineFor(sampleSize, commanderLabel);

  // The bracket phrase links to the tab that justifies it. headlineFor inserts
  // the phrase verbatim exactly once, so splitting on it yields [before, after];
  // anything else means the contract changed, so fall back to plain text rather
  // than render a mangled sentence.
  const headlineContent = (() => {
    if (!bracketPhrase || !onNavigateToBracket) return headline;
    const parts = headline.split(bracketPhrase);
    if (parts.length !== 2) return headline;
    const tint = bracketEstimation ? BRACKET_COLORS[bracketEstimation.bracket]?.text : undefined;
    return (
      <>
        {parts[0]}
        <button
          type="button"
          onClick={onNavigateToBracket}
          title="See how this bracket was estimated"
          className={`cursor-pointer hover:opacity-75 transition-opacity ${tint ?? ''}`}
        >
          {bracketPhrase}
        </button>
        {parts[1]}
      </>
    );
  })();

  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const duration = 700;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplayed(Math.round(ease(t) * target));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  const ringStyle = {
    background: `conic-gradient(hsl(var(--primary)) 0% ${displayed}%, rgba(255,255,255,0.14) ${displayed}% 100%)`,
  };

  // Resolve art_crop URL: try primary commander first, then partner
  const artUrl =
    commander.image_uris?.art_crop ??
    commander.card_faces?.[0]?.image_uris?.art_crop ??
    partnerCommander?.image_uris?.art_crop ??
    partnerCommander?.card_faces?.[0]?.image_uris?.art_crop ??
    null;

  return (
    <div className="relative overflow-hidden rounded-xl border border-border/30 bg-card/40 min-h-[10rem] p-6 sm:p-8 animate-fade-in">
      {/* Layer 1: commander art backdrop (-z-20) */}
      {artUrl && (
        <div
          className="absolute inset-0 -z-20 bg-cover bg-right rounded-xl pointer-events-none"
          style={{ backgroundImage: `url(${artUrl})`, opacity: 0.5 }}
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

        {/* TOP ROW: commander art + info (+ action buttons on desktop) */}
        <div className="flex flex-row items-start sm:items-center gap-3 sm:-mx-3 sm:-mt-3">
          {/* Commander card thumbnail(s) — hover to preview */}
          <div className="flex items-center gap-1.5 shrink-0">
            {(commander.image_uris?.small ?? commander.card_faces?.[0]?.image_uris?.small) && (
              <img
                src={commander.image_uris?.small ?? commander.card_faces?.[0]?.image_uris?.small ?? ''}
                alt={commander.name}
                onMouseEnter={(e) => setHover({ card: commander, rect: e.currentTarget.getBoundingClientRect() })}
                onMouseLeave={() => setHover(null)}
                className="w-12 h-[4.2rem] rounded-md border border-border/50 object-cover shadow-md cursor-pointer transition-transform hover:scale-105"
              />
            )}
            {partnerCommander && (partnerCommander.image_uris?.small ?? partnerCommander.card_faces?.[0]?.image_uris?.small) && (
              <img
                src={partnerCommander.image_uris?.small ?? partnerCommander.card_faces?.[0]?.image_uris?.small ?? ''}
                alt={partnerCommander.name}
                onMouseEnter={(e) => setHover({ card: partnerCommander, rect: e.currentTarget.getBoundingClientRect() })}
                onMouseLeave={() => setHover(null)}
                className="w-12 h-[4.2rem] rounded-md border border-border/50 object-cover shadow-md -ml-3 cursor-pointer transition-transform hover:scale-105"
              />
            )}
          </div>

          {/* Commander info */}
          <div className="flex-1 min-w-0">
            <div className="text-base sm:text-lg font-bold text-foreground leading-snug">
              {commander.name}
              {partnerCommander && (
                <span className="text-muted-foreground font-normal"> + {partnerCommander.name}</span>
              )}
              <a
                href={`https://edhrec.com/commanders/${
                  partnerCommander
                    ? `${formatCommanderNameForUrl(commander.name)}-${formatCommanderNameForUrl(partnerCommander.name)}`
                    : formatCommanderNameForUrl(commander.name)
                }`}
                target="_blank"
                rel="noopener noreferrer"
                title="View on EDHREC"
                aria-label="View commander on EDHREC"
                className="inline-flex items-center align-middle ml-1.5 -translate-y-0.5 text-muted-foreground/70 hover:text-violet-300 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground/70">
              {onOpenInDeckView ? (
                <button
                  type="button"
                  onClick={onOpenInDeckView}
                  className="truncate hover:text-violet-300 hover:underline transition-colors"
                  title="Open deck"
                >
                  {sourceLabel}
                </button>
              ) : (
                <span className="truncate">{sourceLabel}</span>
              )}
              {planName && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1 flex-wrap">
                    Detected plan:
                    <span className="px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 font-semibold text-[10px]">
                      {planName}
                    </span>
                    {secondaryPlanName && (
                      <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 font-semibold text-[10px]">
                        {secondaryPlanName}
                      </span>
                    )}
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

          {/* Action buttons — desktop only (top-right of header row) */}
          <div className="hidden sm:flex items-center gap-2 shrink-0 self-start">
            {adjustContent && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Adjust plan</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="bottom" align="end" className="w-80 p-0">
                  {adjustContent}
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>

        {/* MOBILE-ONLY ACTION ROW: full-width row beneath art + info */}
        {adjustContent && (
          <div className="flex sm:hidden items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 flex-1">
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Adjust plan</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent side="bottom" align="start" className="w-80 p-0">
                {adjustContent}
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* BOTTOM ROW: score ring + headline + byline */}
        <div className="flex flex-row items-center gap-4 sm:gap-6">
          <div
            className="w-24 h-24 sm:w-40 sm:h-40 rounded-full flex items-center justify-center shrink-0"
            style={ringStyle}
            aria-label={`Plan score ${target} out of 100`}
          >
            <div className="w-[78%] h-[78%] rounded-full bg-card flex flex-col items-center justify-center">
              <div className="text-3xl sm:text-5xl font-black tabular-nums leading-none">{displayed}</div>
              <div className="mt-1 sm:mt-1.5 text-[9px] sm:text-[10px] uppercase tracking-wider font-semibold text-violet-300/80">
                {planScore.bandLabel}
              </div>
            </div>
          </div>
          <div className="flex-1 min-w-0 text-left">
            <h2 className="text-base sm:text-xl font-semibold leading-snug text-foreground">
              {headlineContent}
            </h2>
            <p className="mt-1.5 sm:mt-2 text-xs text-muted-foreground/70">{byline}</p>
            {planScore.limitedData && (
              <p className="mt-1 text-[11px] text-amber-400/70">
                Limited data — some sub-scores excluded.
              </p>
            )}
            <p className="mt-2 inline-flex items-start gap-1.5 text-[11px] text-violet-300/70">
              <FlaskConical className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                Inspector is still in early development — bugs may exist, and suggestions may be off if your deck does something unique.
              </span>
            </p>
          </div>
        </div>

      </div>

      {hover && createPortal(
        <div
          className="fixed pointer-events-none hidden md:block z-50"
          style={{
            top: Math.max(8, Math.min(hover.rect.top - 20, window.innerHeight - 360)),
            left: hover.rect.right + 12,
          }}
        >
          <img
            src={getCardImageUrl(hover.card, 'normal') ?? ''}
            alt={hover.card.name}
            className="w-[250px] rounded-xl shadow-2xl border border-border/50"
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
