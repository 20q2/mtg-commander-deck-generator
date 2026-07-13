import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';

/**
 * The "set off on your journey" beat, played when the philosophy choice hands off to the fork:
 * the chosen card's frame folds into the map-pin home node, flies up to the spot it lives at
 * during the brew, and routes fan out beneath it — then we hand off to the fork itself.
 * Self-contained (fixed overlay) so it doesn't depend on the workflow being mounted. Positions
 * are driven by inline transitions because the start/target coordinates are measured at runtime.
 */

const PIN = 36;            // final pin diameter (matches the fork's home node, w-9)
const GHOSTS = 3;

type Phase = 'button' | 'morph' | 'fly' | 'routes' | 'out';

interface Props {
  startRect: DOMRect;                 // the chosen card's on-screen frame — the morph origin
  target: { x: number; y: number };   // viewport-space center for the landed home node
  onDone: () => void;
}

export function BrewIntro({ startRect, target, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('button');

  useEffect(() => {
    // Drive the sequence on a fixed timeline; each step's duration matches its CSS transition.
    const raf = requestAnimationFrame(() => setPhase('morph'));
    const timers = [
      window.setTimeout(() => setPhase('fly'), 380),
      window.setTimeout(() => setPhase('routes'), 380 + 480),
      window.setTimeout(() => setPhase('out'), 380 + 480 + 780),
      window.setTimeout(onDone, 380 + 480 + 780 + 320),
    ];
    return () => { cancelAnimationFrame(raf); timers.forEach(clearTimeout); };
  }, [onDone]);

  const morphed = phase !== 'button';
  const flown = phase === 'fly' || phase === 'routes' || phase === 'out';
  const showRoutes = phase === 'routes' || phase === 'out';

  // The morphing pin: starts exactly over the chosen card, collapses to a circle at its own
  // center, then travels to the target. Centered on the card's center throughout the morph.
  const btnCx = startRect.left + startRect.width / 2;
  const btnCy = startRect.top + startRect.height / 2;
  const pinStyle: React.CSSProperties = morphed
    ? {
        left: (flown ? target.x : btnCx) - PIN / 2,
        top: (flown ? target.y : btnCy) - PIN / 2,
        width: PIN,
        height: PIN,
        borderRadius: 9999,
      }
    : {
        left: startRect.left,
        top: startRect.top,
        width: startRect.width,
        height: startRect.height,
        borderRadius: 16,
      };

  return (
    <div
      className="fixed inset-0 z-50 pointer-events-none transition-opacity duration-300"
      style={{ opacity: phase === 'out' ? 0 : 1 }}
      aria-hidden="true"
    >
      {/* The morphing card frame → pin. */}
      <div
        className={`absolute grid place-items-center border-2 text-violet-100 ${flown ? 'brew-node-pulse' : ''}`}
        style={{
          ...pinStyle,
          background: 'hsl(var(--primary) / 0.25)',
          borderColor: 'hsl(262 83% 75% / 0.8)',
          // Morph (size/shape) and fly (position) share one smooth easing.
          transition: 'left 480ms cubic-bezier(0.5,0,0.2,1), top 480ms cubic-bezier(0.5,0,0.2,1), width 360ms ease, height 360ms ease, border-radius 360ms ease',
          boxShadow: '0 8px 30px -6px hsl(var(--primary) / 0.5)',
        }}
      >
        {/* The home-node pin fades in as the card frame collapses. */}
        <MapPin
          className="absolute w-4 h-4 transition-opacity duration-200"
          style={{ opacity: morphed ? 1 : 0, transitionDelay: morphed ? '160ms' : '0ms' }}
        />
      </div>

      {/* Routes fan out from the landed node: branch lines draw, then ghost cards deal in. */}
      {showRoutes && (
        <div
          className="absolute flex flex-col items-center"
          style={{ left: target.x, top: target.y + PIN / 2, transform: 'translateX(-50%)', width: 'min(680px, 92vw)' }}
        >
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full h-9 -mt-1" aria-hidden="true">
            {Array.from({ length: GHOSTS }, (_, i) => {
              const x = ((i + 0.5) / GHOSTS) * 100;
              return (
                <path
                  key={i}
                  d={`M 50 0 C 50 22, ${x} 16, ${x} 40`}
                  pathLength={1}
                  style={{ animationDelay: `${i * 90 + 60}ms` }}
                  className="brew-branch"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
          <div className="grid grid-cols-3 gap-4 w-full">
            {Array.from({ length: GHOSTS }, (_, i) => (
              <div
                key={i}
                className="animate-brew-card-in h-32 rounded-2xl border border-violet-400/30 bg-card/70 backdrop-blur-sm shadow-[0_18px_45px_-18px_hsl(var(--primary)/0.5)]"
                style={{ animationDelay: `${i * 90 + 220}ms` }}
              >
                <span className="block h-[3px] w-full rounded-t-2xl bg-gradient-to-r from-transparent via-violet-400/60 to-transparent" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
