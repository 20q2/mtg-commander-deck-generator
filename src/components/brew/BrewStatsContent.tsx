import { useStore } from '@/store';
import { computeDeckStats, type RadarAxis, type TypeBar } from '@/services/brew/engine';
import { ROLE_AXES, CARD_TYPE_MS, operationTheme, RAIL_TITLE_CLASS, RAIL_RADAR_SCALE } from '@/components/brew/brewVisuals';
import { BrewIdentityMeter } from './BrewIdentityMeter';
import { Radar, type RadarDatum } from '@/components/charts/Radar';
import { MiniCurve } from '@/components/charts/MiniCurve';

// Each role axis wears its operation's signature hue (matching brewVisuals/the backdrop) and its icon.
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

/** Map the card-type bars to radar data (mana-font card glyphs, per-type hues, no text labels). */
function typeRadarData(types: TypeBar[]): RadarDatum[] {
  return types.map(t => {
    const op = operationTheme('draft', t.key);
    const fill = t.target > 0 ? Math.min(1, t.current / t.target) : (t.current > 0 ? 1 : 0);
    return {
      key: t.key, label: '', current: t.current, target: t.target, fill, hue: op.color,
      glyph: <i className={`ms ${CARD_TYPE_MS[t.key] ?? ''} text-[12px] leading-none`} aria-label={op.label} />,
    };
  });
}

/**
 * The body of the "living stats" rail — identity radar, role coverage, card types, and mana curve.
 * Extracted so it can render BOTH in the docked left rail (wide screens) and inside a drawer on
 * narrower screens (where the docked rail can't fit), via BrewStatsButton — so every player can see
 * the deck taking shape, not just ultrawide ones.
 */
export function BrewStatsContent() {
  const { brewContext, brewState } = useStore();
  if (!brewContext || !brewState || brewState.picks.length === 0) return null;

  // The identity radar shows from the first pack; the coverage charts need a little more deck shape
  // before they read as anything but zeros.
  const showCharts = brewState.picks.length >= 3;
  const stats = showCharts ? computeDeckStats(brewContext, brewState) : null;

  return (
    <>
      {/* Identity meter — always on, the top of the rail. */}
      <BrewIdentityMeter variant="rail" />

      {showCharts && stats && (
        <>
          <div className="flex flex-col items-center gap-1">
            <div className={RAIL_TITLE_CLASS}>
              Your deck so far
              {stats.rounded && <div className="mt-0.5 text-emerald-300/90 normal-case tracking-normal font-flavor italic text-[11px]">— well-rounded</div>}
            </div>
            <Radar
              data={roleRadarData(stats.radar)}
              accent={stats.rounded ? '152 64% 56%' : '196 62% 56%'}
              glow={stats.rounded}
              gradientId="radarRole"
              scale={RAIL_RADAR_SCALE}
            />
          </div>

          {stats.types.length >= 3 && (
            <div className="flex flex-col items-center gap-1">
              <div className={RAIL_TITLE_CLASS}>Card types</div>
              <Radar data={typeRadarData(stats.types)} accent="196 62% 56%" glow={false} gradientId="radarTypes" scale={RAIL_RADAR_SCALE} />
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
    </>
  );
}
