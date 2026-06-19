import { useState } from 'react';
import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { DeckBuildingArea } from '@/components/analyze/DeckBuildingArea';
import { ListChecks, X } from 'lucide-react';

/**
 * Toggles a right-side drawer holding the live deck-building area — the full visual deck so far
 * (the Inspector's grid), summoned on demand instead of pinned beside the choices. Clicking the
 * button again, the close ✕, or Escape hides it.
 */
export function BrewDeckListButton() {
  const { brewContext, brewState } = useStore();
  const [open, setOpen] = useState(false);
  if (!brewContext || !brewState) return null;

  const total = brewState.picks.length + 1 + (brewContext.partnerCommander ? 1 : 0);
  // The commander(s) aren't in the picks list; excluding their names is just defensive.
  const excludeNames = new Set(
    [brewContext.commander.name, brewContext.partnerCommander?.name].filter((n): n is string => !!n),
  );

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="h-7 px-2 text-xs text-violet-200 hover:text-violet-100"
      >
        <ListChecks className="w-3.5 h-3.5 mr-1" /> Deck list
      </Button>

      <Drawer open={open} onClose={() => setOpen(false)} position="right" onPositionChange={() => {}} defaultSizePercent={40} closeOnOutsideClick>
        <div className="flex flex-col h-full min-w-0">
          <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border/40 shrink-0">
            <span className="text-sm font-semibold">
              Your deck so far <span className="text-muted-foreground tabular-nums">· {total} {total === 1 ? 'card' : 'cards'}</span>
            </span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close deck list"
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* Mount the (heavy) grid only while open so it isn't recomputing behind the scenes. */}
          <div className="flex-1 min-h-0 flex flex-col">
            {open && (
              <DeckBuildingArea
                currentCards={brewState.picks.map(p => p.card)}
                excludeNames={excludeNames}
              />
            )}
          </div>
        </div>
      </Drawer>
    </>
  );
}
