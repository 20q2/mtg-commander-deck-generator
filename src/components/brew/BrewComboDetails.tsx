import { useEffect, useState } from 'react';
import { ListChecks, Footprints, Infinity as InfinityIcon, Loader2 } from 'lucide-react';
import { fetchComboDetails, type ComboDetails } from '@/services/edhrec/client';
import { ManaText } from '@/components/ui/mtg-icons';

/**
 * The on-demand combo details panel for the brew "combos" screen — shown only when the player opens
 * a combo option's "Details" popover ("if we want it"). The full result lines + popularity come from
 * the option (already in memory, no fetch); the prerequisites + ordered steps are lazy-fetched by
 * comboId via fetchComboDetails (cached; its href map is already warm from prepareBrewContext). The
 * Prerequisites / Steps / Results layout mirrors the deck view's ComboDisplay for app-wide consistency.
 */
type DetailState = ComboDetails | 'loading' | 'error' | null;

const SECTION_LABEL = 'flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide mb-1';
const ROW = 'text-[11px] leading-snug flex gap-1';

export function BrewComboDetails({ comboId, results, deckCount }: {
  comboId: string;
  results: string[];          // full payoff lines from the option — shown immediately
  deckCount?: number;
}) {
  const [state, setState] = useState<DetailState>(null);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    fetchComboDetails(comboId)
      .then(d => { if (!cancelled) setState(d); })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [comboId]);

  const details = state && state !== 'loading' && state !== 'error' ? state : null;
  // Prefer the fetched results (canonical) once present; otherwise the option's results.
  const shownResults = details && details.results.length ? details.results : results;

  return (
    <div className="w-72 max-w-[82vw] p-3.5 text-left">
      {deckCount ? (
        <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-300/70">
          In {deckCount.toLocaleString()} EDHREC decks
        </div>
      ) : null}

      {/* Results — always available immediately from the option. */}
      {shownResults.length > 0 && (
        <section className="mb-2.5">
          <div className={`${SECTION_LABEL} text-teal-300/80`}>
            <InfinityIcon className="w-3 h-3" /> Results
          </div>
          <div className="space-y-0.5 pl-4">
            {shownResults.map((r, i) => (
              <div key={i} className={`${ROW} text-foreground/85`}>
                <span className="shrink-0 opacity-50">∞</span><span>{r}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Prerequisites + Steps — lazy-fetched by comboId. */}
      {state === 'loading' && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading the walkthrough…
        </div>
      )}

      {details && details.prerequisites.length > 0 && (
        <section className="mb-2.5">
          <div className={`${SECTION_LABEL} text-muted-foreground`}>
            <ListChecks className="w-3 h-3" /> Prerequisites
          </div>
          <div className="space-y-0.5 pl-4">
            {details.prerequisites.map((p, i) => (
              <div key={i} className={`${ROW} text-muted-foreground`}>
                <span className="shrink-0 opacity-50">•</span><ManaText text={p} />
              </div>
            ))}
          </div>
        </section>
      )}

      {details && details.steps.length > 0 && (
        <section>
          <div className={`${SECTION_LABEL} text-muted-foreground`}>
            <Footprints className="w-3 h-3" /> Steps
          </div>
          <div className="space-y-0.5 pl-4">
            {details.steps.map((s, i) => (
              <div key={i} className="text-[11px] leading-snug text-muted-foreground flex gap-1.5">
                <span className="shrink-0 w-3.5 h-3.5 rounded-full bg-muted flex items-center justify-center text-[9px] font-bold mt-0.5">{i + 1}</span>
                <ManaText text={s} />
              </div>
            ))}
          </div>
        </section>
      )}

      {state === 'error' && (
        <div className="text-[11px] text-muted-foreground/70">Couldn’t load the full walkthrough — the payoff is above.</div>
      )}
    </div>
  );
}
