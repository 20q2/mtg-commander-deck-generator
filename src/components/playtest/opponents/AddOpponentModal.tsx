import { useEffect, useMemo } from 'react';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { useOpponentStore, MAX_OPPONENTS } from '@/store/opponentStore';
import { OPPONENT_STUBS } from '@/services/playtest/opponents/deckSources';
import { FloatingDialog } from '@/components/playtest/FloatingDialog';
import { BRACKET_LABELS, type Bracket, type OpponentStub } from '@/components/playtest/opponentTypes';

/** Cool at the bottom of the range, hot at the top. */
const BRACKET_TINT: Record<Bracket, string> = {
  1: 'bg-sky-500/20 text-sky-200 border-sky-400/40',
  2: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40',
  3: 'bg-amber-500/20 text-amber-200 border-amber-400/40',
  4: 'bg-orange-500/20 text-orange-200 border-orange-400/40',
  5: 'bg-rose-500/20 text-rose-200 border-rose-400/40',
};

export function AddOpponentModal() {
  const closeModal = usePlaytestStore(s => s.closeModal);
  const opponents = useOpponentStore(s => s.opponents);
  const loadingStubIds = useOpponentStore(s => s.loadingStubIds);
  const error = useOpponentStore(s => s.error);
  const addFromStub = useOpponentStore(s => s.addFromStub);
  const remove = useOpponentStore(s => s.remove);
  const clearError = useOpponentStore(s => s.clearError);

  // A failure belongs to the visit that caused it. Closing the picker and
  // opening it again should not show you last time's error.
  useEffect(() => clearError, [clearError]);

  const full = opponents.length >= MAX_OPPONENTS;

  /**
   * Grouped by bracket, ascending.
   *
   * A flat list was fine at four decks and stops being fine well before ten.
   * Bracket is also the single most useful thing to sort by: it is the one
   * number that says what kind of game you are signing up for.
   */
  const byBracket = useMemo(() => {
    const groups = new Map<Bracket, OpponentStub[]>();
    for (const stub of OPPONENT_STUBS) {
      const list = groups.get(stub.bracket) ?? [];
      list.push(stub);
      groups.set(stub.bracket, list);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a - b)
      .map(([bracket, stubs]) => ({ bracket, stubs }));
  }, []);

  return (
    <FloatingDialog
      title="Play against bots"
      onClose={closeModal}
      width={560}
      storageKey="playtest-opponents-pos"
    >
      <div className="p-3 space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          Pick up to {MAX_OPPONENTS} decks to sit across from you. They untap, draw, play
          lands, cast what they can afford, block, and attack whoever looks softest — so you
          have a clock to race and a board to interact with.
        </p>

        {error && (
          <div className="px-2.5 py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-400 flex items-start gap-2">
            <span className="flex-1 min-w-0">{error}</span>
            <button
              onClick={clearError}
              title="Dismiss"
              className="shrink-0 text-red-400/70 hover:text-red-300 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        <div className="space-y-3">
          {byBracket.map(({ bracket, stubs }) => {
            const { name, hint } = BRACKET_LABELS[bracket];
            return (
              <div key={bracket} className="space-y-1.5">
                <div className="flex items-center gap-2" title={hint}>
                  <span
                    className={`shrink-0 inline-flex items-center justify-center w-4 h-4 rounded border text-[10px] font-bold ${BRACKET_TINT[bracket]}`}
                  >
                    {bracket}
                  </span>
                  <span className="text-[11px] font-semibold shrink-0">{name}</span>
                  <span className="flex-1 h-px bg-border/40" />
                  <span className="text-[10px] text-muted-foreground/70 truncate max-w-[58%]">
                    {hint}
                  </span>
                </div>

                {stubs.map(stub => {
                  const loading = loadingStubIds.includes(stub.id);
                  const seated = opponents.filter(o => o.stubId === stub.id);
                  return (
                    <div
                      key={stub.id}
                      className="rounded-lg border border-border/50 bg-card/40 p-2.5 flex items-start gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold">{stub.name}</span>
                          <span className="flex items-center gap-0.5">
                            {stub.colors.map(c => (
                              <i key={c} className={`ms ms-${c.toLowerCase()} ms-cost text-xs`} aria-hidden />
                            ))}
                          </span>
                          {stub.source && (
                            <span className="ml-auto shrink-0 text-[9px] text-muted-foreground/60 truncate">
                              {stub.source}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{stub.blurb}</p>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">
                          Commander: {stub.commander}
                        </p>
                        {seated.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {seated.map((o, i) => (
                              <button
                                key={o.id}
                                onClick={() => remove(o.id)}
                                title="Remove this opponent"
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-violet-400/40 bg-violet-500/10 text-[10px] text-violet-200 hover:bg-red-500/15 hover:border-red-400/50 hover:text-red-200 transition-colors"
                              >
                                <Trash2 className="w-2.5 h-2.5" />
                                Seated{seated.length > 1 ? ` #${i + 1}` : ''}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px] shrink-0"
                        disabled={full || loading}
                        onClick={() => addFromStub(stub.id)}
                        title={full ? `Table is full (${MAX_OPPONENTS} opponents)` : `Seat ${stub.name}`}
                      >
                        {loading
                          ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Dealing…</>
                          : <><Plus className="w-3 h-3 mr-1" />Seat</>}
                      </Button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end pt-1">
          <Button size="sm" className="h-7 px-3 text-xs" onClick={closeModal}>Done</Button>
        </div>
      </div>
    </FloatingDialog>
  );
}
