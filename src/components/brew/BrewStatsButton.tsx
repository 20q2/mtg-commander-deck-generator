import { useState } from 'react';
import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { BarChart3, X } from 'lucide-react';
import { BrewStatsContent } from './BrewStatsContent';

/**
 * The deck-stats affordance for screens BELOW 1560px, where the docked left rail (BrewStatsPanel)
 * can't fit alongside the centered flow. A left-side drawer surfaces the SAME content
 * (BrewStatsContent: identity / role coverage / card types / mana curve), so the living stats — the
 * centerpiece of the brew — are reachable on a laptop, not just on an ultrawide monitor. Hidden at
 * ≥1560px (the docked rail takes over). Mirrors BrewDeckListButton on the opposite margin.
 */
export function BrewStatsButton() {
  const { brewContext, brewState } = useStore();
  const [open, setOpen] = useState(false);

  // Identity/stats only exist once a pick has been made — match the rail's own guard.
  if (!brewContext || !brewState || brewState.picks.length === 0) return null;

  return (
    <div className="flex justify-start mb-2 min-[1560px]:hidden">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="h-8 gap-1.5 rounded-xl border border-border/50 bg-card/60 backdrop-blur-md px-3 text-xs font-medium text-violet-200 shadow-lg hover:text-violet-100 hover:border-violet-400/40"
      >
        <BarChart3 className="w-3.5 h-3.5" /> Stats
      </Button>

      <Drawer open={open} onClose={() => setOpen(false)} position="left" onPositionChange={() => {}} defaultSizePercent={38} closeOnOutsideClick>
        <div className="brew-foundry flex flex-col h-full min-w-0">
          <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border/40 shrink-0">
            <span className="text-sm font-semibold">Deck stats</span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close deck stats"
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center gap-4 px-4 py-4">
            <BrewStatsContent />
          </div>
        </div>
      </Drawer>
    </div>
  );
}
