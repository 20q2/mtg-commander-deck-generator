import { useMemo } from 'react';
import { useStore } from '@/store';
import { AuroraThemed } from '@/components/ui/AuroraThemed';
import { getAuroraColors } from '@/lib/commanderTheme';

const WUBRG = ['W', 'U', 'B', 'R', 'G'];

/**
 * Brew-reactive aurora — the background shifts as the game plan does:
 *  - hue follows the deck's emerging colors (a running tally of picked cards), so a
 *    4-color start can narrow toward the two colors you're actually drafting;
 *  - it brightens and swells as the deck fills toward its target;
 *  - it drifts a little with every pick.
 * Colour swaps interpolate via the @property transition on `.aurora-themed`; the
 * opacity/transform shifts are eased here. Sits over the commander art, under the content.
 */
export function BrewBackdrop() {
  const brewContext = useStore(s => s.brewContext);
  const brewState = useStore(s => s.brewState);

  const view = useMemo(() => {
    if (!brewContext) return null;
    const picks = brewState?.picks ?? [];

    const tally: Record<string, number> = {};
    for (const p of picks) for (const c of p.card.color_identity ?? []) tally[c] = (tally[c] ?? 0) + 1;
    const ranked = WUBRG.filter(c => tally[c]).sort((a, b) => tally[b] - tally[a]);

    // Lean into the deck's emerging colours once a plan is forming; else the commander's identity.
    const identity = picks.length >= 3 && ranked.length ? ranked.slice(0, 2) : brewContext.colorIdentity;
    const fill = Math.min(1, picks.length / Math.max(1, brewContext.nonLandTarget));

    return {
      colors: getAuroraColors(identity),
      opacity: Math.min(1, 0.6 + 0.45 * fill),
      transform: `translateX(${(Math.sin(picks.length * 0.7) * 7).toFixed(1)}vw) scale(${(1 + fill * 0.18).toFixed(3)})`,
    };
  }, [brewContext, brewState]);

  if (!view) return null;

  return (
    <div
      className="fixed inset-0 z-0 pointer-events-none"
      style={{
        opacity: view.opacity,
        transform: view.transform,
        transition: 'opacity 900ms ease, transform 1400ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <AuroraThemed colors={view.colors} />
    </div>
  );
}
