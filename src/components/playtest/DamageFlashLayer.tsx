import { createPortal } from 'react-dom';
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
 * life total drops. One fixed layer at the document level, above the board but under
 * the outcome banner, and never in the way of a click.
 *
 * Peak opacity rides the `--flash-op` custom property so the keyframes can stay
 * generic while each hit lands at its own strength.
 */
export function DamageFlashLayer() {
  const flash = useDamageFlash(s => s.flash);
  const animations = usePlaytestSettings(s => s.animations);

  if (!animations || !flash) return null;

  // A light hit stays a thin rim; a heavy one reaches a third of the way across.
  const reach = 14 + flash.intensity * 20;
  const style = { width: `${reach}vw`, '--flash-op': flash.intensity } as React.CSSProperties;

  return createPortal(
    // Keyed on the hit id so a fresh hit remounts and replays the animation.
    <div key={flash.id} className="fixed inset-0 z-[290] pointer-events-none overflow-hidden" aria-hidden>
      <div
        className="absolute inset-y-0 left-0 origin-left animate-damage-flash"
        style={{ ...style, background: BLOOM('right') }}
      />
      <div
        className="absolute inset-y-0 right-0 origin-right animate-damage-flash"
        style={{ ...style, background: BLOOM('left') }}
      />
    </div>,
    document.body,
  );
}
