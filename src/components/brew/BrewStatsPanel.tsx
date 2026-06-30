import { useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useStore } from '@/store';
import { BrewStatsContent } from './BrewStatsContent';

/**
 * The "living stats" rail — identity/role/type/curve in its own column, docked to the left margin so
 * it sits apart from the centered brew flow. Docked only on very wide screens (≥1560px); narrower
 * viewports reach the same content through the "Stats" drawer button (BrewStatsButton) so it's never
 * lost. The chart body itself lives in BrewStatsContent, shared by both surfaces.
 */
export function BrewStatsPanel() {
  const { brewContext, brewState, brewStatsOpen, toggleBrewStats } = useStore();

  // Anchor the rail between the header's bottom edge and the footer's top edge — both measured rather
  // than hardcoded, since a migration banner makes the header height variable and the footer only
  // enters view at the bottom of a scroll. Tracking scroll keeps the top pinned just under the sticky
  // header, and grows the bottom inset so the rail never rides over the footer once it scrolls in.
  const [top, setTop] = useState(112);
  const [bottom, setBottom] = useState(24);
  useEffect(() => {
    const header = document.querySelector('header');
    const footer = document.querySelector('footer');
    if (!header) return;
    const measure = () => {
      // +24px (the content column's py-6 top padding) so the rail's top lines up with the health strip.
      setTop(Math.round(header.getBoundingClientRect().bottom) + 24);
      // Bottom inset = distance from viewport bottom. Default 24px; once the footer crosses into the
      // viewport, grow the inset to keep the rail's bottom edge 24px above the footer's top.
      if (footer) {
        const overlap = window.innerHeight - footer.getBoundingClientRect().top;
        setBottom(Math.max(24, Math.round(overlap) + 24));
      }
    };
    measure();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    const ro = new ResizeObserver(measure); // catch banner dismiss / header reflow
    ro.observe(header);
    if (footer) ro.observe(footer);
    return () => {
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      ro.disconnect();
    };
  }, []);

  // Keep the rail mounted through its close animation: `show` lags `brewStatsOpen` so we can play the
  // slide-out before unmounting, and `closing` picks the out- vs in-animation.
  const [show, setShow] = useState(brewStatsOpen);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (brewStatsOpen) { setShow(true); setClosing(false); return; }
    setClosing(true);
    const t = window.setTimeout(() => { setShow(false); setClosing(false); }, 200);
    return () => window.clearTimeout(t);
  }, [brewStatsOpen]);

  // The rail stays hidden until the first pack is in — an empty radar before any choice reads as
  // broken, and it gives the opening pack the stage to itself. It appears once the deck has shape.
  if (!brewContext || !brewState || brewState.picks.length === 0) return null;

  // Docked to the left margin with a comfortable inset, pinned just under the sticky header via `top`.
  const dockLeft = 24;

  // Collapsed: the whole rail (identity radar + charts) folds away to a slim re-open handle.
  if (!show) {
    return (
      <button
        onClick={() => toggleBrewStats()}
        title="Show deck stats"
        style={{ left: dockLeft, top }}
        className="hidden min-[1560px]:inline-flex animate-brew-rail-in fixed z-20 items-center gap-1.5 rounded-xl
                   border border-border/50 bg-card/50 backdrop-blur-md px-2.5 py-2 text-[11px] font-medium
                   text-violet-200 hover:text-violet-100 hover:border-violet-400/40 shadow-lg transition-colors">
        <PanelLeftOpen className="w-4 h-4" /> Stats
      </button>
    );
  }

  // The rail spans the full height between the header and the bottom margin (anchored top + bottom),
  // and `justify-between` hands the leftover vertical space out evenly between the sections so the
  // identity/role/types/curve stack breathes to fill the column instead of bunching at the top. `gap-2`
  // is the floor so they never collide; if the content ever outgrows the column it scrolls (thin
  // scrollbar, 240px wide so the gutter clears the radar; overflow-x hidden — only the glow halo is lost).
  return (
    <aside
      style={{ left: dockLeft, top, bottom, scrollbarWidth: 'thin' }}
      className={`hidden min-[1560px]:flex fixed z-20 w-[240px] flex-col justify-between gap-2
                 overflow-y-auto overflow-x-hidden rounded-2xl border border-border/50 bg-card/40 backdrop-blur-md px-4 py-3 shadow-xl
                 ${closing ? 'animate-brew-rail-out' : 'animate-brew-rail-in'}`}>
      {/* Collapse control — pinned to the rail's top-right corner; folds the whole rail to a handle.
          Absolute so it stays out of the vertical flow. */}
      <button
        onClick={() => toggleBrewStats()}
        title="Hide deck stats"
        className="absolute top-2.5 right-2.5 z-10 grid place-items-center w-6 h-6 rounded-md text-muted-foreground/55 hover:text-violet-200 hover:bg-white/5 transition-colors">
        <PanelLeftClose className="w-3.5 h-3.5" />
      </button>

      <BrewStatsContent />
    </aside>
  );
}
