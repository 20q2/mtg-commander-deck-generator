import { useMemo } from 'react';
import { Crown, Target, Check, ScrollText } from 'lucide-react';
import { loadJournal, allTreasury } from '@/services/brew/journal';

/**
 * The Treasury shelf + Brew Journal on the landing page — the binder loop. Every windfall ever
 * revealed sits here with its foil treatment and the run that found it; recent runs list beneath.
 * Meta-MEMORY, never meta-power: this reads the journal, it never feeds anything back into a run.
 * Renders nothing until a first run is recorded, so a new player's landing stays clean.
 */

const SHELF_CAP = 12;   // most-recent pulls shown; the chase is "fill the shelf", not "scroll it"
const RUNS_SHOWN = 5;

export function BrewTreasuryShelf() {
  const runs = useMemo(() => loadJournal(), []);
  if (runs.length === 0) return null;
  const treasury = allTreasury(runs).slice(0, SHELF_CAP);

  return (
    <section className="max-w-2xl mx-auto mt-12 animate-fade-in">
      {/* The binder — gold and rainbow pulls, each remembering the run that found it. */}
      {treasury.length > 0 && (
        <>
          <div className="flex items-center justify-center gap-2 mb-1">
            <Crown className="w-4 h-4 text-amber-300" />
            <h2 className="font-display text-lg tracking-wide text-foreground/90">Your Treasury</h2>
          </div>
          <p className="text-center text-[11px] text-muted-foreground/70 mb-4">
            Every windfall you've pulled — and the runs that found them.
          </p>
          <div className="flex flex-wrap justify-center gap-2.5 mb-8">
            {treasury.map((t, i) => (
              <span
                key={`${t.cardName}-${i}`}
                title={`${t.cardName} — ${t.runTitle} · ${new Date(t.date).toLocaleDateString()}`}
                className={`relative overflow-hidden rounded-lg ring-2 shadow-[0_4px_14px_rgba(0,0,0,0.5)] ${
                  t.tier === 'rainbow'
                    ? 'ring-fuchsia-300/70 shadow-[0_0_18px_-3px_rgba(232,121,249,0.55)]'
                    : 'ring-amber-300/60 shadow-[0_0_14px_-3px_rgba(251,191,36,0.5)]'
                }`}
              >
                {t.art ? (
                  <img src={t.art} alt={t.cardName} loading="lazy" className="block h-14 w-24 object-cover" />
                ) : (
                  <span className="grid h-14 w-24 place-items-center bg-card/70 px-1 text-center text-[9px] leading-tight text-foreground/80">
                    {t.cardName}
                  </span>
                )}
                <span
                  className={`absolute inset-x-0 bottom-0 truncate px-1.5 py-0.5 text-[8px] font-semibold text-white/95 ${
                    t.tier === 'rainbow'
                      ? 'bg-gradient-to-r from-fuchsia-600/80 via-amber-500/80 to-cyan-500/80'
                      : 'bg-[#241803]/85'
                  }`}
                >
                  {t.cardName}
                </span>
              </span>
            ))}
          </div>
        </>
      )}

      {/* The Journal — recent runs, each a one-line story receipt. */}
      <div className="flex items-center justify-center gap-2 mb-3">
        <ScrollText className="w-4 h-4 text-violet-300/90" />
        <h2 className="font-display text-lg tracking-wide text-foreground/90">Brew Journal</h2>
      </div>
      <ol className="space-y-2">
        {runs.slice(0, RUNS_SHOWN).map(r => (
          <li key={r.id} className="foundry-bevel flex items-center gap-3 rounded-xl border border-border/60 bg-card/60 px-4 py-2.5 text-xs">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-[13px] font-semibold text-foreground/95">{r.title}</span>
              <span className="block truncate text-[11px] text-muted-foreground/80">
                {r.commanderName} · {new Date(r.date).toLocaleDateString()} · {r.picks} picks
                {r.philosophy ? ` · ${r.philosophy}` : ''}
              </span>
            </span>
            {r.treasury.length > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1 text-amber-200/90" title={`${r.treasury.length} windfall${r.treasury.length === 1 ? '' : 's'} this run`}>
                <Crown className="w-3.5 h-3.5" /> {r.treasury.length}
              </span>
            )}
            <span
              className={`inline-flex shrink-0 items-center gap-1 ${r.goalDone ? 'text-emerald-300' : 'text-muted-foreground/50'}`}
              title={r.goalDone ? `Goal complete — ${r.goalLabel}` : `Goal missed — ${r.goalLabel}`}
            >
              {r.goalDone ? <Check className="w-3.5 h-3.5" /> : <Target className="w-3.5 h-3.5" />}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
