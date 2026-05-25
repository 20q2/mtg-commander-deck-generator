// src/components/deck/optimizer/dashboard/StrategyDrillIn.tsx
import type { ScryfallCard, EDHRECCommanderData } from '@/types';
import type { ThemeMembership } from '@/components/analyze/themeMembership';
import { isAnyLand } from '@/services/scryfall/client';

export interface StrategyDrillInProps {
  cards: ScryfallCard[];
  themeMembership: ThemeMembership | null;
  primaryThemeData?: EDHRECCommanderData | null;
  planName?: string | null;
  /** Sample size for byline citation. */
  sampleSize?: number | null;
}

export function StrategyDrillIn({
  cards, themeMembership, primaryThemeData, planName, sampleSize,
}: StrategyDrillInProps) {
  if (!themeMembership || themeMembership.themes.length === 0) {
    return (
      <div className="mt-3 p-4 bg-card/40 border border-border/30 rounded-lg text-xs text-muted-foreground">
        Set a plan in the Adjust popover to see strategy details.
      </div>
    );
  }
  const nonLand = cards.filter(c => !isAnyLand(c));
  const inThemeCount = nonLand.filter(c => themeMembership.byCard.has(c.name.toLowerCase())).length;
  const offThemeCount = nonLand.length - inThemeCount;

  let overlap = 0;
  if (primaryThemeData?.cardlists.allNonLand?.length) {
    const topN = primaryThemeData.cardlists.allNonLand.slice(0, 60);
    const deckNames = new Set(nonLand.map(c => c.name.toLowerCase()));
    overlap = topN.filter(t => deckNames.has(t.name.toLowerCase())).length;
  }

  return (
    <div className="mt-3 p-4 bg-card/40 border border-border/30 rounded-lg space-y-2.5 text-xs animate-fade-in">
      <div className="font-semibold text-foreground/90 text-sm">
        Strategy detail{planName ? ` — ${planName}` : ''}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">In theme</div>
          <div className="text-lg font-bold text-emerald-400 tabular-nums">{inThemeCount}<span className="text-muted-foreground/70 text-xs"> / {nonLand.length}</span></div>
          <div className="text-[11px] text-muted-foreground/80">non-land cards that reinforce the plan</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Off theme</div>
          <div className="text-lg font-bold text-amber-400 tabular-nums">{offThemeCount}</div>
          <div className="text-[11px] text-muted-foreground/80">may be staples or filler — see Card Fit</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Top-60 overlap</div>
          <div className="text-lg font-bold text-violet-300 tabular-nums">{overlap}<span className="text-muted-foreground/70 text-xs"> / 60</span></div>
          <div className="text-[11px] text-muted-foreground/80">match with the top-60 cards in this theme bucket</div>
        </div>
      </div>
      <div className="text-[10px] text-muted-foreground/60 pt-1.5 border-t border-border/30">
        Sources: EDHREC theme bucket + active theme membership.
        {sampleSize ? ` Based on ${sampleSize.toLocaleString()} decklists.` : ''}
      </div>
    </div>
  );
}
