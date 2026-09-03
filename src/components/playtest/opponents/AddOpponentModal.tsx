import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { useOpponentStore, MAX_OPPONENTS } from '@/store/opponentStore';
import { OPPONENT_STUBS } from '@/services/playtest/opponents/deckSources';
import { FloatingDialog } from '@/components/playtest/FloatingDialog';

export function AddOpponentModal() {
  const closeModal = usePlaytestStore(s => s.closeModal);
  const opponents = useOpponentStore(s => s.opponents);
  const loadingStubIds = useOpponentStore(s => s.loadingStubIds);
  const error = useOpponentStore(s => s.error);
  const addFromStub = useOpponentStore(s => s.addFromStub);
  const remove = useOpponentStore(s => s.remove);

  const full = opponents.length >= MAX_OPPONENTS;

  return (
    <FloatingDialog
      title="Play against bots"
      onClose={closeModal}
      width={520}
      storageKey="playtest-opponents-pos"
    >
      <div className="p-3 space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          Pick up to {MAX_OPPONENTS} decks to sit across from you. They untap, draw, play
          lands, cast what they can afford, and attack on each of your Next Turns — so you
          have a clock to race and a board to interact with.
        </p>

        {error && (
          <div className="px-2.5 py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-400">
            {error}
          </div>
        )}

        <div className="space-y-2">
          {OPPONENT_STUBS.map(stub => {
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

        <div className="flex justify-end pt-1">
          <Button size="sm" className="h-7 px-3 text-xs" onClick={closeModal}>Done</Button>
        </div>
      </div>
    </FloatingDialog>
  );
}
