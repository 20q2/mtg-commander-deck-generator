import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Landmark, ArrowLeft, Minus, Plus } from 'lucide-react';
import type { ManaMix, ScryfallCard } from '@/types';
import { getCardImageUrl } from '@/services/scryfall/client';
import { ManaWheel, EVEN_MIX } from '@/components/brew/ManaWheel';

/**
 * The run's capstone, played as its OWN STEP on the normal brew background (not a dialog): a ratio
 * WHEEL that blends the four land styles, a land-COUNT dial (the recommendation ± a few), and a live
 * preview of the non-land cards that will round out the "remaining space" — which grows as you dial
 * lands down. Emits { mix, landCount } to finishBrew, which blends both WHICH lands fill the base and
 * the count/basic split. After locking in, the fly-in reveal plays and the deck is revealed.
 */
const HSL = '40 92% 62%'; // mana-base gold
const WIGGLE = 3;         // how far above/below the recommendation you can dial the land count
const MAX_THUMBS = 12;    // backfill faces to show before collapsing to "+N more"

export function BrewManaCapstone({
  onChoose, onBack, recommendedLandCount, total, nonlandPicks, backfillPool,
}: {
  onChoose: (mix: ManaMix, landCount: number) => void;
  onBack: () => void;
  recommendedLandCount: number;
  total: number;             // deck size the count/lands fill toward (nonLandTarget + landTarget)
  nonlandPicks: number;      // non-land cards already brewed
  backfillPool: ScryfallCard[]; // top unused non-land candidates, best first
}) {
  const [mix, setMix] = useState<ManaMix>(EVEN_MIX);
  const [landCount, setLandCount] = useState(recommendedLandCount);
  const [exiting, setExiting] = useState(false);

  const min = Math.max(20, recommendedLandCount - WIGGLE);
  const max = recommendedLandCount + WIGGLE;
  const clampLand = (n: number) => Math.max(min, Math.min(max, n));

  // Slots left after brew picks + the chosen lands — the "remaining space" the generator tops up.
  const remaining = Math.max(0, Math.min(total - landCount - nonlandPicks, backfillPool.length));
  const shown = Math.min(remaining, MAX_THUMBS);
  const extra = remaining - shown;

  function confirm(nextMix: ManaMix) {
    if (exiting) return;
    setMix(nextMix);
    setExiting(true);
    window.setTimeout(() => onChoose(nextMix, landCount), 220);
  }

  return (
    <div
      className={`mx-auto max-w-xl text-center transition-[opacity,transform] duration-200 ${exiting ? 'scale-95 opacity-0' : ''}`}
      style={{ ['--op' as string]: `hsl(${HSL})` }}
    >
      <span className="mx-auto mb-3 grid place-items-center w-12 h-12 rounded-full border-2 brew-node-pulse"
        style={{ color: `hsl(${HSL})`, borderColor: `hsl(${HSL} / 0.6)`, background: `hsl(${HSL} / 0.12)`, boxShadow: `0 0 30px hsl(${HSL} / 0.4)` }}>
        <Landmark className="w-6 h-6" />
      </span>
      <div className="flex items-center justify-center gap-3 mb-2" style={{ color: `hsl(${HSL} / 0.85)` }}>
        <span className="h-px w-10" style={{ background: `linear-gradient(to right, transparent, hsl(${HSL} / 0.5))` }} />
        <span className="text-[10px] uppercase tracking-[0.32em] whitespace-nowrap">The final call</span>
        <span className="h-px w-10" style={{ background: `linear-gradient(to left, transparent, hsl(${HSL} / 0.5))` }} />
      </div>
      <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mb-1">Shape your mana base</h2>
      <p className="text-xs text-muted-foreground mb-6">Drag the wheel to lean the base — then set how many lands you want.</p>

      <ManaWheel mix={mix} onChange={setMix} landCount={landCount} />

      {/* Land count — the recommendation with a few lands of wiggle room. */}
      <div className="mt-6 flex flex-col items-center gap-1.5">
        <div className="inline-flex items-center gap-3 rounded-full border border-border/60 bg-card/50 px-2 py-1.5">
          <button
            type="button" aria-label="One fewer land" disabled={exiting || landCount <= min}
            onClick={() => setLandCount(n => clampLand(n - 1))}
            className="grid place-items-center w-7 h-7 rounded-full text-foreground/80 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none"
          >
            <Minus className="w-4 h-4" />
          </button>
          <span className="min-w-[92px] tabular-nums text-sm font-semibold">
            <span className="text-lg" style={{ color: `hsl(${HSL})` }}>{landCount}</span> lands
          </span>
          <button
            type="button" aria-label="One more land" disabled={exiting || landCount >= max}
            onClick={() => setLandCount(n => clampLand(n + 1))}
            className="grid place-items-center w-7 h-7 rounded-full text-foreground/80 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {landCount === recommendedLandCount ? 'Recommended' : `Recommended ${recommendedLandCount}`}
        </span>
      </div>

      {/* The remaining space: the non-land cards we'll top the deck up with (an estimate; the real
          fill lands when the deck builds). Grows as you dial lands down. */}
      {remaining > 0 && (
        <div className="mt-6">
          <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Rounding out the deck — {remaining} {remaining === 1 ? 'card' : 'cards'}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {backfillPool.slice(0, shown).map(c => (
              <img
                key={c.name}
                src={getCardImageUrl(c, 'small')}
                alt={c.name}
                title={c.name}
                loading="lazy"
                className="w-11 sm:w-12 rounded-[5%] ring-1 ring-black/50 shadow-[0_3px_10px_rgba(0,0,0,0.5)]"
              />
            ))}
            {extra > 0 && (
              <span className="grid h-[62px] w-11 sm:w-12 place-items-center rounded-[5%] border border-dashed border-border/60 text-[11px] font-semibold text-muted-foreground">
                +{extra}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="mt-7 flex flex-col items-center gap-2">
        <Button className="btn-shimmer w-full max-w-xs" disabled={exiting} onClick={() => confirm(mix)}>
          Lock it in
        </Button>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Button variant="ghost" size="sm" disabled={exiting} onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>
          <span className="w-1 h-1 rotate-45 bg-border" />
          <Button variant="ghost" size="sm" disabled={exiting} onClick={() => { setMix(EVEN_MIX); confirm(EVEN_MIX); }}>
            Keep it balanced
          </Button>
        </div>
      </div>
    </div>
  );
}
