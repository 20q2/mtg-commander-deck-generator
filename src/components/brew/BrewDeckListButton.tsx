import { useEffect, useState } from 'react';
import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { DeckBuildingArea } from '@/components/analyze/DeckBuildingArea';
import { ListChecks, X } from 'lucide-react';

/**
 * The live deck-so-far, opened in a right-side drawer. The trigger is its own button now (no longer
 * riding in the health strip): pinned to the top-right on wide screens — mirroring the left stats
 * rail, so the two affordances bookend the top — and folding down to a right-aligned row above the
 * strip on narrower screens (≥1560px is where the left rail also appears) so it's never lost.
 * Clicking again, the close ✕, or Escape hides the drawer.
 */
export function BrewDeckListButton() {
  const { brewContext, brewState } = useStore();
  const [open, setOpen] = useState(false);

  // Pin just under the sticky header, the same anchor the stats rail uses, so the two wide-screen
  // affordances line up across the top. Tracks scroll / resize / header reflow (migration banner).
  const [top, setTop] = useState(112);
  useEffect(() => {
    const header = document.querySelector('header');
    if (!header) return;
    const measure = () => setTop(Math.round(header.getBoundingClientRect().bottom) + 24);
    measure();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    return () => {
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      ro.disconnect();
    };
  }, []);

  if (!brewContext || !brewState) return null;

  const total = brewState.picks.length + 1 + (brewContext.partnerCommander ? 1 : 0);
  // The commander(s) aren't in the picks list; excluding their names is just defensive.
  const excludeNames = new Set(
    [brewContext.commander.name, brewContext.partnerCommander?.name].filter((n): n is string => !!n),
  );

  // Mirrors the stats rail's inset (dockLeft = 24) on the opposite margin.
  const dockRight = 24;

  return (
    <>
      {/* Wide (≥1560px): fixed to the top-right, content-width, lined up with the stats rail's top.
          Narrow: a static, right-aligned row that sits above the health strip (mb-2 spaces it from
          the HUD below). The right/top insets only take effect once the wrapper is `fixed`. */}
      <div
        style={{ right: dockRight, top }}
        className="flex justify-end mb-2 min-[1560px]:mb-0 min-[1560px]:fixed min-[1560px]:z-20"
      >
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          className="h-8 gap-1.5 rounded-xl border border-border/50 bg-card/60 backdrop-blur-md px-3 text-xs font-medium text-violet-200 shadow-lg hover:text-violet-100 hover:border-violet-400/40"
        >
          <ListChecks className="w-3.5 h-3.5" /> Deck list
        </Button>
      </div>

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
