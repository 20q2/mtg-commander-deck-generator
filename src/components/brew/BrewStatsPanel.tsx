import { useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useStore } from '@/store';
import { computeDeckStats, type RadarAxis, type TypeBar } from '@/services/brew/engine';
import { ROLE_AXES, CARD_TYPE_MS, operationTheme, RAIL_TITLE_CLASS, RAIL_RADAR_SCALE } from '@/components/brew/brewVisuals';
import { BrewIdentityMeter } from './BrewIdentityMeter';
import { Radar, type RadarDatum } from '@/components/charts/Radar';
import { MiniCurve } from '@/components/charts/MiniCurve';

// Each role axis wears its operation's signature hue (matching brewVisuals/the backdrop) and its icon
// — so the radar speaks the same language as the routes: ramp green, removal red, wipes ember, draw
// azure. Shared with the per-card role badges via ROLE_AXES so chart and badge can't drift apart.
const AXIS = Object.fromEntries(ROLE_AXES.map(a => [a.key, { hue: a.hue, Icon: a.Icon }]));

/** Map the role-coverage axes to radar data (lucide icons, per-role hues, role labels under each). */
function roleRadarData(radar: RadarAxis[]): RadarDatum[] {
  return radar.map(a => {
    const meta = AXIS[a.key];
    const Icon = meta?.Icon;
    return {
      key: a.key, label: a.label, current: a.current, target: a.target, fill: a.fill,
      hue: meta?.hue ?? '262 84% 72%',
      glyph: Icon ? <Icon className="w-[13px] h-[13px]" strokeWidth={2} /> : null,
    };
  });
}

/** Map the card-type bars to radar data (mana-font card glyphs, per-type hues, no text labels —
 *  the symbols are self-describing and type names like "Planeswalker" would crowd the small chart). */
function typeRadarData(types: TypeBar[]): RadarDatum[] {
  return types.map(t => {
    const op = operationTheme('draft', t.key); // hue + display name for this card type
    const fill = t.target > 0 ? Math.min(1, t.current / t.target) : (t.current > 0 ? 1 : 0);
    return {
      key: t.key, label: '', current: t.current, target: t.target, fill, hue: op.color,
      glyph: <i className={`ms ${CARD_TYPE_MS[t.key] ?? ''} text-[12px] leading-none`} aria-label={op.label} />,
    };
  });
}

/**
 * The "living stats" rail — radar over curve in its own column, docked to the left margin so it
 * sits apart from the centered brew flow. Wide screens only (the centered content keeps the page
 * to itself on smaller viewports; the always-on health strip still carries the essentials there).
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

  // The identity radar shows from the first pack (the guard above); the coverage charts need a little
  // more deck shape before they read as anything but zeros. `show` is always true past the collapse
  // guard above.
  const showCharts = brewState.picks.length >= 3;
  const stats = showCharts ? computeDeckStats(brewContext, brewState) : null;

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
      {/* Identity meter — always on, the top of the rail. */}
      <BrewIdentityMeter variant="rail" />

      {/* Collapse control — pinned to the rail's top-right corner; folds the whole rail to a handle.
          Absolute so it stays out of the vertical flow. */}
      <button
        onClick={() => toggleBrewStats()}
        title="Hide deck stats"
        className="absolute top-2.5 right-2.5 z-10 grid place-items-center w-6 h-6 rounded-md text-muted-foreground/55 hover:text-violet-200 hover:bg-white/5 transition-colors">
        <PanelLeftClose className="w-3.5 h-3.5" />
      </button>

      {showCharts && stats && (
        <>
          {/* Role coverage — every section is a title-over-chart unit, no dividers, so the rail reads
              as one even rhythm (the aside's gap spaces the sections). */}
          <div className="flex flex-col items-center gap-1">
            <div className={RAIL_TITLE_CLASS}>
              Your deck so far
              {stats.rounded && <div className="mt-0.5 text-emerald-300/90 normal-case tracking-normal font-flavor italic text-[11px]">— well-rounded</div>}
            </div>
            <Radar
              data={roleRadarData(stats.radar)}
              accent={stats.rounded ? '152 64% 56%' : '262 84% 72%'}
              glow={stats.rounded}
              gradientId="radarRole"
              scale={RAIL_RADAR_SCALE}
            />
          </div>

          {/* A radar needs ≥3 axes to read as a shape; the commander's type spread always clears that. */}
          {stats.types.length >= 3 && (
            <div className="flex flex-col items-center gap-1">
              <div className={RAIL_TITLE_CLASS}>Card types</div>
              <Radar data={typeRadarData(stats.types)} accent="262 84% 72%" glow={false} gradientId="radarTypes" scale={RAIL_RADAR_SCALE} />
            </div>
          )}

          {stats.curve.length > 0 && (
            <div className="flex flex-col items-center gap-1">
              <div className={RAIL_TITLE_CLASS}>Mana curve</div>
              <MiniCurve curve={stats.curve} barHeight={64} />
            </div>
          )}
        </>
      )}
    </aside>
  );
}
