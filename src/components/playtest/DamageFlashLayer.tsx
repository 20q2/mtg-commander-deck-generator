import { useDamageFlash } from '@/store/damageFlashStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';

/** The glow's own gradient — opaque at the edge, gone by the inner lip. */
const BLOOM = (towards: 'right' | 'left') =>
  `linear-gradient(to ${towards},` +
  ' rgba(220,38,38,0.60) 0%,' +
  ' rgba(220,38,38,0.30) 32%,' +
  ' rgba(220,38,38,0.09) 66%,' +
  ' rgba(220,38,38,0) 100%)';

/**
 * "Ouch." A soft red bloom pushing in from the left and right edges whenever your
 * life total drops. Above everything on the board and never in the way of a click.
 *
 * It lives inside the battlefield rather than over the document, so the bloom
 * stops at the edges of the table. As a fixed full-viewport layer it also washed
 * the game log and your hand, which made a hit read as the whole app flinching
 * rather than as something happening on the board — and the log is text you may
 * be reading at that moment.
 *
 * `overflow-hidden` on this layer rather than relying on the battlefield's: the
 * canvas drops its own clip while a group of cards is being dragged.
 *
 * Peak opacity rides the `--flash-op` custom property so the keyframes can stay
 * generic while each hit lands at its own strength.
 */
export function DamageFlashLayer() {
  const flash = useDamageFlash(s => s.flash);
  const animations = usePlaytestSettings(s => s.animations);

  if (!animations || !flash) return null;

  // A light hit stays a thin rim; a heavy one reaches a third of the way across
  // the table. A share of the table, not of the viewport: the side panel is no
  // longer part of the width this is measured against.
  const reach = 18 + flash.intensity * 26;
  const style = { width: `${reach}%`, '--flash-op': flash.intensity } as React.CSSProperties;

  return (
    // Keyed on the hit id so a fresh hit remounts and replays the animation.
    <div
      key={flash.id}
      className="absolute inset-0 z-[45] pointer-events-none overflow-hidden"
      aria-hidden
    >
      <div
        className="absolute inset-y-0 left-0 origin-left animate-damage-flash"
        style={{ ...style, background: BLOOM('right') }}
      />
      <div
        className="absolute inset-y-0 right-0 origin-right animate-damage-flash"
        style={{ ...style, background: BLOOM('left') }}
      />
    </div>
  );
}
