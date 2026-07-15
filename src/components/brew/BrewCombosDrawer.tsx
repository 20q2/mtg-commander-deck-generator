import { useStore } from '@/store';
import { Drawer } from '@/components/ui/drawer';
import { detectCompletedCombos, detectNearMissCombos } from '@/services/brew/engine';
import { Infinity as InfinityIcon, X } from 'lucide-react';

/** One combo row: its pieces (owned = teal-lit), any still-missing pieces (dashed), then payoffs. */
function ComboCard({ pieces, missing = [], results, deckCount }: {
  pieces: string[];
  missing?: string[];
  results: string[];
  deckCount: number;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/50 p-2.5">
      <div className="mb-1.5 flex flex-wrap gap-1">
        {pieces.map(n => (
          <span key={n} className="rounded-md border border-teal-400/30 bg-teal-500/10 px-1.5 py-0.5 text-[11px] text-teal-100/90">
            {n}
          </span>
        ))}
        {missing.map(n => (
          <span key={n} className="rounded-md border border-dashed border-border/60 px-1.5 py-0.5 text-[11px] text-muted-foreground/70">
            + {n}
          </span>
        ))}
      </div>
      {results.length > 0 && (
        <div className="space-y-0.5">
          {results.map((r, i) => (
            <div key={i} className="flex gap-1 text-[11px] leading-snug text-foreground/80">
              <span className="shrink-0 opacity-40">∞</span><span>{r}</span>
            </div>
          ))}
        </div>
      )}
      {deckCount ? (
        <div className="mt-1 text-[9px] uppercase tracking-wide text-muted-foreground/50">
          In {deckCount.toLocaleString()} decks
        </div>
      ) : null}
    </div>
  );
}

/**
 * The combos-in-your-deck drawer — a left-side overlay opened from the deck-stats panel. Leads with
 * the combos fully assembled from the deck so far ("Assembled"), then the ones a card or two away
 * ("Within reach"), so the player can see the engine coming together at a glance. Reads (ctx, state)
 * live via detectCompletedCombos / detectNearMissCombos; no fetch.
 */
export function BrewCombosDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { brewContext, brewState } = useStore();
  const completed = brewContext && brewState ? detectCompletedCombos(brewContext, brewState) : [];
  const nearMiss = brewContext && brewState ? detectNearMissCombos(brewContext, brewState) : [];

  return (
    <Drawer open={open} onClose={onClose} position="left" onPositionChange={() => {}} defaultSizePercent={32} closeOnOutsideClick>
      {open && (
        <div className="brew-foundry flex h-full min-w-0 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 px-4 py-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
              <InfinityIcon className="h-4 w-4 text-teal-300" /> Combos in your deck
            </span>
            <button
              onClick={onClose}
              aria-label="Close combos"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3" style={{ scrollbarWidth: 'thin' }}>
            {completed.length === 0 && nearMiss.length === 0 && (
              <p className="text-xs leading-relaxed text-muted-foreground/70">
                No combos yet. Keep drafting — combos you assemble, and ones a card or two away, will show up here.
              </p>
            )}

            {completed.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-teal-300/80">
                  Assembled · {completed.length}
                </h3>
                <div className="space-y-2">
                  {completed.map(c => (
                    <ComboCard key={c.comboId} pieces={c.cards} results={c.results} deckCount={c.deckCount} />
                  ))}
                </div>
              </section>
            )}

            {nearMiss.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-300/70">
                  Within reach · {nearMiss.length}
                </h3>
                <div className="space-y-2">
                  {nearMiss.map(c => (
                    <ComboCard key={c.comboId} pieces={c.have} missing={c.missing} results={c.results} deckCount={c.deckCount} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
