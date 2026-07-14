import { useState } from 'react';
import { Gem, Radar as RadarIcon, Shapes, BarChart3, type LucideIcon } from 'lucide-react';
import { useStore } from '@/store';
import { computeDeckStats, projectDeckStats, type RadarAxis, type TypeBar } from '@/services/brew/engine';
import { ROLE_AXES, CARD_TYPE_MS, operationTheme, RAIL_TITLE_CLASS, RAIL_RADAR_SCALE } from '@/components/brew/brewVisuals';
import { BrewIdentityMeter } from './BrewIdentityMeter';
import { BrewThemeVeto } from './BrewThemeVeto';
import { Radar, type RadarDatum } from '@/components/charts/Radar';
import { MiniCurve } from '@/components/charts/MiniCurve';

// Each role axis wears its operation's signature hue (matching brewVisuals/the backdrop) and its icon.
const AXIS = Object.fromEntries(ROLE_AXES.map(a => [a.key, { hue: a.hue, Icon: a.Icon }]));

// The four toggle-able chart sections. The player picks which ones ride in the rail; the choice
// persists so the rail keeps their preferred shape across picks (and across the wide rail ⇄ narrow
// drawer, which share this body). The steer-away control below is not toggle-able — it's a control,
// not a chart.
type StatSection = 'identity' | 'roles' | 'types' | 'curve';
const STAT_SECTIONS_KEY = 'mtg-brew-stat-sections';
const DEFAULT_SECTIONS: Record<StatSection, boolean> = { identity: true, roles: true, types: true, curve: true };
const SECTION_TOGGLES: { key: StatSection; label: string; Icon: LucideIcon }[] = [
  { key: 'identity', label: 'Identity', Icon: Gem },
  { key: 'roles', label: 'Roles', Icon: RadarIcon },
  { key: 'types', label: 'Types', Icon: Shapes },
  { key: 'curve', label: 'Curve', Icon: BarChart3 },
];

/** Which chart sections are showing, backed by localStorage so the choice survives re-mounts. */
function useStatSections() {
  const [sections, setSections] = useState<Record<StatSection, boolean>>(() => {
    try {
      const raw = localStorage.getItem(STAT_SECTIONS_KEY);
      if (raw) return { ...DEFAULT_SECTIONS, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return DEFAULT_SECTIONS;
  });
  const toggle = (key: StatSection) => setSections(s => {
    const next = { ...s, [key]: !s[key] };
    try { localStorage.setItem(STAT_SECTIONS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  return { sections, toggle };
}

/** The show/hide chips at the top of the rail — one per chart section, active = lavender-lit. */
function SectionToggles({ sections, toggle }: ReturnType<typeof useStatSections>) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {SECTION_TOGGLES.map(({ key, label, Icon }) => {
        const on = sections[key];
        return (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            aria-pressed={on}
            title={`${on ? 'Hide' : 'Show'} ${label}`}
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium transition-colors ${
              on
                ? 'border-violet-400/40 bg-violet-500/10 text-violet-200'
                : 'border-border/40 text-muted-foreground/55 hover:text-muted-foreground hover:border-border/70'
            }`}
          >
            <Icon className="w-3 h-3" strokeWidth={2} /> {label}
          </button>
        );
      })}
    </div>
  );
}

/** Map the role-coverage axes to radar data (lucide icons, per-role hues, role labels under each).
 *  `proj` (projected axes) draws the hover projection as the radar's dashed reference outline. */
function roleRadarData(radar: RadarAxis[], proj?: RadarAxis[]): RadarDatum[] {
  return radar.map(a => {
    const meta = AXIS[a.key];
    const Icon = meta?.Icon;
    const ref = proj ? proj.find(p => p.key === a.key)?.fill : undefined;
    return {
      key: a.key, label: a.label, current: a.current, target: a.target, fill: a.fill,
      hue: meta?.hue ?? '262 84% 72%',
      glyph: Icon ? <Icon className="w-[13px] h-[13px]" strokeWidth={2} /> : null,
      ...(ref != null ? { ref } : {}),
    };
  });
}

const typeFill = (t: TypeBar) => (t.target > 0 ? Math.min(1, t.current / t.target) : (t.current > 0 ? 1 : 0));

/** Map the card-type bars to radar data (mana-font card glyphs, per-type hues, no text labels).
 *  `proj` (projected bars) draws the hover projection as the radar's dashed reference outline. */
function typeRadarData(types: TypeBar[], proj?: TypeBar[]): RadarDatum[] {
  return types.map(t => {
    const op = operationTheme('draft', t.key);
    const ref = proj ? proj.find(p => p.key === t.key) : undefined;
    return {
      key: t.key, label: '', current: t.current, target: t.target, fill: typeFill(t), hue: op.color,
      glyph: <i className={`ms ${CARD_TYPE_MS[t.key] ?? ''} text-[12px] leading-none`} aria-label={op.label} />,
      ...(ref ? { ref: typeFill(ref) } : {}),
    };
  });
}

/**
 * The body of the "living stats" rail — identity radar, role coverage, card types, and mana curve,
 * each independently show/hide-able via the toggle chips at the top (persisted). Extracted so it can
 * render BOTH in the docked left rail (wide screens) and inside a drawer on narrower screens (where
 * the docked rail can't fit), via BrewStatsButton — so every player can see the deck taking shape,
 * not just ultrawide ones.
 */
export function BrewStatsContent() {
  const { brewContext, brewState, brewPreview } = useStore();
  const { sections, toggle } = useStatSections();
  if (!brewContext || !brewState) return null;

  // The identity radar shows from the first pack; the coverage charts need a little more deck shape
  // before they read as anything but zeros.
  const showCharts = brewState.picks.length >= 3;
  const stats = showCharts ? computeDeckStats(brewContext, brewState) : null;
  // Hover projection: what the coverage charts WOULD show with the previewed cards added. Drawn as a
  // dashed outline (radars) / faint cap (curve) so you can read a pick's effect before taking it.
  const proj = showCharts && brewPreview && brewPreview.cards.length > 0
    ? projectDeckStats(brewContext, brewState, brewPreview.cards)
    : null;

  return (
    <>
      {/* Show/hide chips — the top of the rail, so the player tunes which charts ride along. */}
      <SectionToggles sections={sections} toggle={toggle} />

      {/* Identity meter — the top chart when shown. */}
      {sections.identity && <BrewIdentityMeter variant="rail" />}

      {showCharts && stats && (
        <>
          {sections.roles && (
            <div className="flex flex-col items-center gap-1">
              <div className={RAIL_TITLE_CLASS}>
                Your deck so far
                {stats.rounded && <div className="mt-0.5 text-emerald-300/90 normal-case tracking-normal font-flavor italic text-[11px]">— well-rounded</div>}
              </div>
              <Radar
                data={roleRadarData(stats.radar, proj?.radar)}
                accent={stats.rounded ? '152 64% 56%' : '196 62% 56%'}
                glow={stats.rounded}
                gradientId="radarRole"
                scale={RAIL_RADAR_SCALE}
              />
            </div>
          )}

          {sections.types && stats.types.length >= 3 && (
            <div className="flex flex-col items-center gap-1">
              <div className={RAIL_TITLE_CLASS}>Card types</div>
              <Radar data={typeRadarData(stats.types, proj?.types)} accent="196 62% 56%" glow={false} gradientId="radarTypes" scale={RAIL_RADAR_SCALE} />
            </div>
          )}

          {sections.curve && stats.curve.length > 0 && (
            <div className="flex flex-col items-center gap-1">
              <div className={RAIL_TITLE_CLASS}>Mana curve</div>
              <MiniCurve curve={stats.curve} barHeight={64} preview={proj ? proj.curve.map(c => c.current) : undefined} />
            </div>
          )}
        </>
      )}

      {/* Steer-away control — available from the first fork so the player can mute a theme they don't
          want (e.g. a tribal commander's own tribe) before the lean compounds. */}
      <BrewThemeVeto />
    </>
  );
}
