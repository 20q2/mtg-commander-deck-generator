import { useMemo, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { FloatingDialog } from '@/components/playtest/FloatingDialog';
import type { TrialPin } from '@/components/playtest/types';
import type { ScryfallCard } from '@/types';

const MAX_PINS = 3;
const TOP_PRESETS = [5, 10, 15];
const SUGGESTION_LIMIT = 8;

export function NewCardTrialModal() {
  const closeModal = usePlaytestStore(s => s.closeModal);
  const setTrialPins = usePlaytestStore(s => s.setTrialPins);
  const storedPins = usePlaytestStore(s => s.trialPins);
  const reset = usePlaytestStore(s => s.reset);
  const zones = usePlaytestStore(s => s.zones);
  const battlefield = usePlaytestStore(s => s.battlefield);

  const [pins, setPins] = useState<TrialPin[]>(storedPins);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);

  /**
   * Every distinct card in the deck. Commanders are deliberately excluded: reset()
   * keeps the command zone out of the reshuffle, so a pinned commander would never
   * be in the library at deal time and the pin could never resolve. Tokens are out
   * for the same reason — they're dropped on reset.
   */
  const deckCards = useMemo(() => {
    const seen = new Set<string>();
    const out: ScryfallCard[] = [];
    const push = (c: ScryfallCard) => {
      if (c.type_line.toLowerCase().includes('token')) return;
      if (seen.has(c.name)) return;
      seen.add(c.name);
      out.push(c);
    };
    zones.library.forEach(push);
    zones.hand.forEach(push);
    zones.graveyard.forEach(push);
    zones.exile.forEach(push);
    battlefield.forEach(b => push(b.card));
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [zones, battlefield]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pinned = new Set(pins.map(p => p.cardName));
    return deckCards
      .filter(c => !pinned.has(c.name) && (!q || c.name.toLowerCase().includes(q)))
      .slice(0, SUGGESTION_LIMIT);
  }, [deckCards, query, pins]);

  const addPin = (name: string) => {
    if (pins.length >= MAX_PINS) return;
    setPins(p => [...p, { cardName: name, where: 'hand', topN: 10 }]);
    setQuery('');
  };

  const update = (i: number, patch: Partial<TrialPin>) =>
    setPins(p => p.map((pin, idx) => (idx === i ? { ...pin, ...patch } : pin)));

  const apply = (thenReset: boolean) => {
    setTrialPins(pins);
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
          Force up to {MAX_PINS} cards from this deck to show up, so you can see how they
          play without resetting twenty times.
        </p>

        {pins.length < MAX_PINS && (
          <div className="relative">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={`Search this deck (${deckCards.length} cards)…`}
              className="h-8 text-xs"
            />
            {focused && suggestions.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover shadow-xl max-h-52 overflow-y-auto">
                {suggestions.map(c => (
                  <button
                    key={c.name}
                    // onMouseDown, not onClick — the input's blur would close this
                    // list before a click ever landed.
                    onMouseDown={(e) => { e.preventDefault(); addPin(c.name); }}
                    className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-accent transition-colors truncate"
                  >
                    {c.name}
                    <span className="ml-1.5 text-[10px] text-muted-foreground/70">{c.type_line}</span>
                  </button>
                ))}
              </div>
            )}
            {focused && query.trim() !== '' && suggestions.length === 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover shadow-xl px-2.5 py-2 text-xs text-muted-foreground">
                No card in this deck matches "{query.trim()}".
              </div>
            )}
          </div>
        )}

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
            onClick={() => { setPins([]); setTrialPins([]); }}
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
