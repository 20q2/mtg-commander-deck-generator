import { useEffect, useState } from 'react';
import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { DeckBuildingArea } from '@/components/analyze/DeckBuildingArea';
import { ListChecks, X } from 'lucide-react';

/**
 * The live deck-so-far: header + the (heavy) card grid. Shared by the wide-screen side column
 * (BrewPage lays it out beside the game) and the narrow-screen drawer below. Only mounted while
 * visible so the grid isn't recomputing behind the scenes.
 */
export function BrewDeckListContent({ onClose }: { onClose: () => void }) {
  const { brewContext, brewState } = useStore();
  if (!brewContext || !brewState) return null;

  const total = brewState.picks.length + 1 + (brewContext.partnerCommander ? 1 : 0);
  // The commander(s) aren't in the picks list; excluding their names is just defensive.
  const excludeNames = new Set(
    [brewContext.commander.name, brewContext.partnerCommander?.name].filter((n): n is string => !!n),
  );

  return (
    <div className="brew-foundry flex flex-col h-full min-w-0">
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border/40 shrink-0">
        <span className="text-sm font-semibold">
          Your deck so far <span className="text-muted-foreground tabular-nums">· {total} {total === 1 ? 'card' : 'cards'}</span>
        </span>
        <button
          onClick={onClose}
          aria-label="Close deck list"
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <DeckBuildingArea
          currentCards={brewState.picks.map(p => p.card)}
          excludeNames={excludeNames}
        />
      </div>
    </div>
  );
}

/** Track the sticky header's bottom edge (plus an offset) so fixed brew chrome pins just under it. */
export function useHeaderAnchoredTop(offset: number) {
  const [top, setTop] = useState(88 + offset);
  useEffect(() => {
    const header = document.querySelector('header');
    if (!header) return;
    const measure = () => setTop(Math.round(header.getBoundingClientRect().bottom) + offset);
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
  }, [offset]);
  return top;
}

/**
 * The top/bottom insets for a docked side column: top pinned under the sticky header, bottom flush to
 * the viewport edge until the footer scrolls into view — then it lifts to sit exactly above the
 * footer instead of hovering over it. Shared by both side columns (stats left, deck list right) so
 * they bound the same way. Both edges are measured (header height varies with the migration banner;
 * the footer only enters view at the bottom of a scroll).
 */
export function useColumnBounds() {
  const [bounds, setBounds] = useState({ top: 88, bottom: 0 });
  useEffect(() => {
    const header = document.querySelector('header');
    const footer = document.querySelector('footer');
    const measure = () => {
      const top = header ? Math.round(header.getBoundingClientRect().bottom) : 0;
      // Bottom inset = how far the footer has crossed into the viewport (0 while it's still below).
      const bottom = footer ? Math.max(0, Math.round(window.innerHeight - footer.getBoundingClientRect().top)) : 0;
      setBounds({ top, bottom });
    };
    measure();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    const ro = new ResizeObserver(measure); // catch banner dismiss / header + footer reflow
    if (header) ro.observe(header);
    if (footer) ro.observe(footer);
    return () => {
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      ro.disconnect();
    };
  }, []);
  return bounds;
}

/**
 * The wide-screen deck-so-far column: docked flush to the viewport's right/bottom edges (top flush
 * under the header), sliding in from the right when opened and back out on close. BrewPage keeps it
 * mounted through the exit so the slide-out actually plays, and reserves matching page padding so
 * the game column sits beside it rather than under it.
 */
export function BrewDeckListColumn({ closing, onClose }: { closing: boolean; onClose: () => void }) {
  const { top, bottom } = useColumnBounds();
  return (
    <aside
      style={{ top, bottom }}
      className={`fixed right-0 z-20 w-1/4 border-l border-border/50 bg-card/75 backdrop-blur-md shadow-2xl overflow-hidden
        ${closing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}
    >
      <BrewDeckListContent onClose={onClose} />
    </aside>
  );
}

interface BrewDeckListButtonProps {
  open: boolean;
  onToggle: (open: boolean) => void;
  /** Wide screens render the list as its own page column (see BrewPage); narrow screens keep the drawer. */
  asColumn: boolean;
}

/**
 * The deck-list trigger, pinned to the top-right on wide screens — mirroring the left stats rail,
 * so the two affordances bookend the top — and folding down to a right-aligned row above the strip
 * on narrower screens. On wide screens the list opens as a side COLUMN beside the game (laid out by
 * BrewPage, so the trigger hides while it's open — the column's ✕ closes it); on narrow screens it
 * falls back to the right-side drawer.
 */
export function BrewDeckListButton({ open, onToggle, asColumn }: BrewDeckListButtonProps) {
  const { brewContext, brewState } = useStore();

  // Pin just under the sticky header, the same anchor the stats rail uses, so the two wide-screen
  // affordances line up across the top. Tracks scroll / resize / header reflow (migration banner).
  const top = useHeaderAnchoredTop(24);

  if (!brewContext || !brewState) return null;

  // Mirrors the stats rail's inset (dockLeft = 24) on the opposite margin.
  const dockRight = 24;

  return (
    <>
      {/* Wide (≥1560px): fixed to the top-right, content-width, lined up with the stats rail's top.
          Narrow: a static, right-aligned row that sits above the health strip (mb-2 spaces it from
          the HUD below). Hidden while the side column is open — it would float over the column. */}
      {!(asColumn && open) && (
        <div
          style={{ right: dockRight, top }}
          className="flex justify-end mb-2 min-[1560px]:mb-0 min-[1560px]:fixed min-[1560px]:z-20"
        >
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            onClick={() => onToggle(!open)}
            className="h-8 gap-1.5 rounded-xl border border-border/50 bg-card/60 backdrop-blur-md px-3 text-xs font-medium text-violet-200 shadow-lg hover:text-violet-100 hover:border-violet-400/40"
          >
            <ListChecks className="w-3.5 h-3.5" /> Deck list
          </Button>
        </div>
      )}

      {/* Narrow screens only: the side column can't fit, so keep the overlay drawer there. */}
      {!asColumn && (
        <Drawer open={open} onClose={() => onToggle(false)} position="right" onPositionChange={() => {}} defaultSizePercent={40} closeOnOutsideClick>
          {open && <BrewDeckListContent onClose={() => onToggle(false)} />}
        </Drawer>
      )}
    </>
  );
}
