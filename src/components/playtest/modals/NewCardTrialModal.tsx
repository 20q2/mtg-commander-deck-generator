import { useState } from 'react';
import { Loader2, Trash2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { useCardNameSearch } from '@/hooks/useCardNameSearch';
import { getCardByName } from '@/services/scryfall/client';
import { FloatingDialog } from '@/components/playtest/FloatingDialog';
import type { TrialPin } from '@/components/playtest/types';
import type { ScryfallCard } from '@/types';

const MAX_PINS = 3;
const TOP_PRESETS = [5, 10, 15];

export function NewCardTrialModal() {
  const closeModal = usePlaytestStore(s => s.closeModal);
  const setTrialPins = usePlaytestStore(s => s.setTrialPins);
  const storedPins = usePlaytestStore(s => s.trialPins);
  const reset = usePlaytestStore(s => s.reset);

  const [pins, setPins] = useState<TrialPin[]>(storedPins);
  const [resolved, setResolved] = useState<Record<string, ScryfallCard>>({});
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = useCardNameSearch({ exclude: new Set(pins.map(p => p.cardName.toLowerCase())) });

  const addPin = async (name: string) => {
    if (pins.length >= MAX_PINS) return;
    setAdding(true);
    setError(null);
    try {
      // Resolve now so the store has full card data if this card isn't in the deck.
      const card = await getCardByName(name);
      setResolved(r => ({ ...r, [card.name]: card }));
      setPins(p => [...p, { cardName: card.name, where: 'hand', topN: 10 }]);
      search.clear();
    } catch {
      setError(`Could not find "${name}" on Scryfall.`);
    } finally {
      setAdding(false);
    }
  };

  const update = (i: number, patch: Partial<TrialPin>) =>
    setPins(p => p.map((pin, idx) => (idx === i ? { ...pin, ...patch } : pin)));

  const apply = (thenReset: boolean) => {
    setTrialPins(pins, resolved);
    closeModal();
    // Pins only take effect at deal time, so a reset is what makes them visible.
    if (thenReset) reset();
  };

  return (
    <FloatingDialog
      title="New Card Trial"
      onClose={closeModal}
      width={460}
      storageKey="playtest-new-card-trial-pos"
    >
      <div className="p-3 space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          Force up to {MAX_PINS} cards to show up, so you can see how they play without
          resetting twenty times. Cards that aren't in the deck get added for the trial.
        </p>

        {pins.length < MAX_PINS && (
          <div className="relative">
            <Input
              value={search.query}
              onChange={(e) => search.setQuery(e.target.value)}
              placeholder="Search for a card…"
              className="h-8 text-xs"
            />
            {(search.loading || adding) && (
              <Loader2 className="absolute right-2 top-2 w-4 h-4 animate-spin text-muted-foreground" />
            )}
            {search.suggestions.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover shadow-xl max-h-52 overflow-y-auto">
                {search.suggestions.map(name => (
                  <button
                    key={name}
                    onClick={() => addPin(name)}
                    className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-accent transition-colors truncate"
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {error && <div className="text-xs text-red-400">{error}</div>}

        {pins.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">No cards pinned yet.</div>
        ) : (
          <div className="space-y-2">
            {pins.map((pin, i) => (
              <div key={pin.cardName} className="rounded-lg border border-border/50 bg-card/40 p-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-xs font-medium truncate">{pin.cardName}</span>
                  <button
                    onClick={() => setPins(p => p.filter((_, idx) => idx !== i))}
                    className="text-muted-foreground hover:text-red-400 transition-colors"
                    aria-label={`Remove ${pin.cardName}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Button
                    variant={pin.where === 'hand' ? 'default' : 'outline'}
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => update(i, { where: 'hand' })}
                  >
                    Opening hand
                  </Button>
                  <Button
                    variant={pin.where === 'top' ? 'default' : 'outline'}
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => update(i, { where: 'top' })}
                  >
                    Top of library
                  </Button>
                  {pin.where === 'top' && (
                    <div className="flex items-center gap-1 ml-1">
                      <span className="text-[10px] uppercase text-muted-foreground/70">within</span>
                      {TOP_PRESETS.map(n => (
                        <Button
                          key={n}
                          variant={pin.topN === n ? 'default' : 'outline'}
                          size="sm"
                          className="h-6 w-7 p-0 text-[11px]"
                          onClick={() => update(i, { topN: n })}
                        >
                          {n}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => { setPins([]); setTrialPins([], {}); }}
          >
            <X className="w-3 h-3 mr-1" />Clear all
          </Button>
          <div className="flex gap-1.5">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={closeModal}>Cancel</Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => apply(false)}>Save</Button>
            <Button size="sm" className="h-7 px-2 text-xs" onClick={() => apply(true)}>Save &amp; redeal</Button>
          </div>
        </div>
      </div>
    </FloatingDialog>
  );
}
