import { useState } from 'react';
import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { BarChart3, X } from 'lucide-react';
import { BrewStatsContent } from './BrewStatsContent';
import { useHeaderAnchoredTop, useColumnBounds } from './BrewDeckListButton';

/**
 * The living stats — identity / role coverage / card types / mana curve (BrewStatsContent) — wrapped
 * with a header + close so it can render both as the wide-screen side column and inside the narrow
 * drawer. Mirrors BrewDeckListContent on the opposite margin.
 */
function BrewStatsInner({ onClose }: { onClose: () => void }) {
  return (
    <div className="brew-foundry flex flex-col h-full min-w-0">
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border/40 shrink-0">
        <span className="text-sm font-semibold">Deck stats</span>
        <button
          onClick={onClose}
          aria-label="Close deck stats"
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center gap-4 px-4 py-4" style={{ scrollbarWidth: 'thin' }}>
        <BrewStatsContent />
      </div>
    </div>
  );
}

/**
 * The wide-screen living-stats column: docked flush to the viewport's left/bottom edges (top flush
 * under the header), sliding in from the left when opened and back out on close — a mirror image of
 * BrewDeckListColumn on the right. BrewPage keeps it mounted through the exit so the slide-out plays,
 * and reserves matching left page padding so the game column sits beside it rather than under it.
 */
export function BrewStatsColumn({ closing, onClose }: { closing: boolean; onClose: () => void }) {
  const { top, bottom } = useColumnBounds();
  return (
    <aside
      style={{ top, bottom }}
      className={`fixed left-0 z-20 w-[18.75vw] border-r border-border/50 bg-card/75 backdrop-blur-md shadow-2xl overflow-hidden
        ${closing ? 'animate-slide-out-left' : 'animate-slide-in-left'}`}
    >
      <BrewStatsInner onClose={onClose} />
    </aside>
  );
}

interface BrewStatsButtonProps {
  open: boolean;
  onToggle: (open: boolean) => void;
  /** Wide screens render the stats as their own page column (see BrewPage); narrow screens keep the drawer. */
  asColumn: boolean;
}

/**
 * The stats trigger, pinned to the top-left on wide screens — mirroring the deck-list button on the
 * top-right, so the two affordances bookend the top — and folding down to a left-aligned row above
 * the strip on narrower screens. On wide screens the stats open as a side COLUMN beside the game
 * (laid out by BrewPage, so the trigger hides while it's open — the column's ✕ closes it); on narrow
 * screens it falls back to a left-side drawer with its own (default-closed) state, so the stats never
 * auto-cover a phone on load.
 */
export function BrewStatsButton({ open, onToggle, asColumn }: BrewStatsButtonProps) {
  const { brewContext, brewState } = useStore();

  // Pin just under the sticky header, the same anchor the deck-list button uses, so the two
  // wide-screen affordances line up across the top. Tracks scroll / resize / header reflow.
  const top = useHeaderAnchoredTop(24);

  // The narrow-screen drawer keeps its own open state (default closed) — the wide column's `open`
  // pref defaults to shown, which would otherwise auto-open the drawer over a phone on load.
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Stats only exist once a pick has been made — match the column's own guard.
  if (!brewContext || !brewState || brewState.picks.length === 0) return null;

  // Mirrors the deck-list button's inset (dockRight = 24) on the opposite margin.
  const dockLeft = 24;

  return (
    <>
      {/* Wide (≥1560): fixed to the top-left, content-width, lined up with the deck-list button's top.
          Narrow: a static, left-aligned row that sits above the health strip. Hidden while the side
          column is open — it would float over the column. */}
      {!(asColumn && open) && (
        <div
          style={{ left: dockLeft, top }}
          className="flex justify-start mb-2 min-[1560px]:mb-0 min-[1560px]:fixed min-[1560px]:z-20"
        >
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={asColumn ? open : drawerOpen}
            onClick={() => (asColumn ? onToggle(true) : setDrawerOpen(true))}
            className="h-8 gap-1.5 rounded-xl border border-border/50 bg-card/60 backdrop-blur-md px-3 text-xs font-medium text-violet-200 shadow-lg hover:text-violet-100 hover:border-violet-400/40"
          >
            <BarChart3 className="w-3.5 h-3.5" /> Stats
          </Button>
        </div>
      )}

      {/* Narrow screens only: the side column can't fit, so keep the overlay drawer there. */}
      {!asColumn && (
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} position="left" onPositionChange={() => {}} defaultSizePercent={40} closeOnOutsideClick>
          {drawerOpen && <BrewStatsInner onClose={() => setDrawerOpen(false)} />}
        </Drawer>
      )}
    </>
  );
}
