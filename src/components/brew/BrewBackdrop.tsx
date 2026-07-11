import { useMemo, useRef } from 'react';
import { useStore } from '@/store';
import { AuroraThemed } from '@/components/ui/AuroraThemed';
import { getAuroraColors } from '@/lib/commanderTheme';
import { operationTheme, routeKey, BrewGlyph, type OperationTheme } from '@/components/brew/brewVisuals';

const WUBRG = ['W', 'U', 'B', 'R', 'G'];

/**
 * Brew-reactive aurora — the background shifts as the game plan does:
 *  - hue follows the deck's emerging colors (a running tally of picked cards), so a
 *    4-color start can narrow toward the two colors you're actually drafting;
 *  - it brightens and swells as the deck fills toward its target;
 *  - it drifts a little with every pick.
 * Colour swaps interpolate via the @property transition on `.aurora-themed`; the
 * opacity/transform shifts are eased here. Sits over the commander art, under the content.
 *
 * On top of the aurora, an *operation* layer tints the whole page toward whatever move
 * you're performing — green & sprout-strewn for ramp, burning red for removal, etc. —
 * and floats a giant ghosted glyph of that operation behind the content.
 */
export function BrewBackdrop() {
  const brewContext = useStore(s => s.brewContext);
  const brewState = useStore(s => s.brewState);
  const brewNode = useStore(s => s.brewNode);

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

  // The active operation (only while inside a route/node). Keep the last one around so the
  // overlay can fade *out* gracefully when you step back to the fork rather than snapping off.
  const op: OperationTheme | null = useMemo(
    () => (brewNode ? operationTheme(brewNode.type, routeKey(brewNode.routeId)) : null),
    [brewNode],
  );
  const lastOp = useRef<OperationTheme | null>(null);
  if (op) lastOp.current = op;
  const shownOp = op ?? lastOp.current;

  // The static Foundry base renders on every brew screen — including the landing page, before any
  // session exists — so the whole flow (pick a commander → brew → finish) reads as one place. The
  // colour-reactive aurora + operation layers only join in once a run is underway (`view`).

  return (
    <>
      {/* Industrial Foundry base: dark steel, a blueprint grid, and a molten ember glow rising from
          the forge at the bottom. The colour-reactive aurora rides on top, dimmed to a faint heat-haze
          so the steel + grid read as the dominant surface rather than a soft glow. */}
      <div className="fixed inset-0 z-0 pointer-events-none" aria-hidden="true"
        style={{ background: 'linear-gradient(hsl(216 18% 9%), hsl(218 20% 6%))' }} />

      {view && (
        <div
          className="fixed inset-0 z-0 pointer-events-none"
          style={{
            opacity: view.opacity * 0.5,
            transform: view.transform,
            transition: 'opacity 900ms ease, transform 1400ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <AuroraThemed colors={view.colors} />
        </div>
      )}

      <div className="brew-grid fixed inset-0 z-0 pointer-events-none" aria-hidden="true" />
      <div className="fixed inset-0 z-0 pointer-events-none" aria-hidden="true"
        style={{ background: 'radial-gradient(72% 42% at 50% 119%, hsl(22 92% 50% / 0.18), transparent 60%)' }} />

      {/* Operation complexion — fades in over the aurora while a move is in progress. */}
      <div
        className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
        style={{ opacity: op ? 1 : 0, transition: 'opacity 700ms ease' }}
        aria-hidden="true"
      >
        {shownOp && (
          <>
            {/* Colour wash from the top, in the operation's hue. */}
            <div
              className="absolute inset-0"
              style={{ background: `radial-gradient(75% 55% at 50% -5%, hsl(${shownOp.color} / 0.20), transparent 68%)` }}
            />
            {/* Giant ghosted glyph, drifting slowly — the operation's sigil presiding over the page. */}
            <div
              className="brew-op-sigil absolute -right-[8%] top-[16%] text-[42vw] sm:text-[34vw] leading-none"
              style={{ color: `hsl(${shownOp.color} / 0.06)` }}
            >
              <BrewGlyph sym={shownOp.glyph} className="text-[42vw] sm:text-[34vw] w-[42vw] h-[42vw] sm:w-[34vw] sm:h-[34vw]" />
            </div>
          </>
        )}
      </div>
    </>
  );
}
