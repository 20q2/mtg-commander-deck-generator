import { useState, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { playPackCrack } from '@/services/brew/brewSound';
import type { BrewOption } from '@/services/brew/engine';
import type { PackSceneAPI } from '@/components/brew/packScene';
import { PackBody, PackDepth, trackTilt, resetTilt } from '@/components/brew/BrewPackCrack';
import { legibleText, routeKey } from '@/components/brew/brewVisuals';
import { specialPackArt } from '@/components/brew/specialPackArt';

/**
 * The special-route pack: a fork pick (Combos / Headliner / Hidden Synergy) doesn't throw its
 * choices on screen — it hands you ONE sealed, route-flavored booster. Crack it (same 3D ceremony
 * as a pack round: stage → spark tear → strip pop) and the route's choices erupt out of it — the
 * children render at mouth-open. Contents are hidden until the crack, so the crack is the
 * commitment: the parent hides Back/"Show different" via onCracked (mirrors the pack rounds).
 *
 * Same render strategy as BrewPackCrack: a CSS pack shows instantly and crossfades to the lazy
 * WebGL mesh; no WebGL (or reduced motion) keeps the CSS pack, reduced motion skips the ceremony.
 */

const STAGE_MS = 1250;     // fly-to-focus + anticipation creep, then the burst (matches BrewPackCrack)
const GHOST_MS = 950;      // how long the burst wrapper / in-scene shed stays up under the content
const SOUND_LEAD_MS = 120; // (CSS path) the tear sound starts just before the burst
const TEAR_SEC = 0.48;     // (3D path) tear-noise length — matches the scene's TEAR_MS sweep

export function BrewSpecialPack({ face, packColor, onCracked, children }: {
  /** The sealed face: label/count/art for the wrapper. `cards` = everything inside the round. */
  face: BrewOption;
  /** Bare HSL triplet — the route's operation color wears the wrapper. */
  packColor: string;
  /** Fires the moment the player commits to the crack (before the ceremony finishes). */
  onCracked?: () => void;
  /** The route's actual choices — mounted when the pack is open. */
  children: ReactNode;
}) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [staged, setStaged] = useState(false);
  const [opened, setOpened] = useState(false);
  // CSS-path burst wrapper (strip pops, body sheds) while the content mounts underneath.
  const [ghost, setGhost] = useState(false);
  // The 3D stage stays mounted through the in-scene shed, then unmounts for good.
  const [sceneGone, setSceneGone] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const zoneRef = useRef<HTMLButtonElement | null>(null);
  const sceneRef = useRef<PackSceneAPI | null>(null);
  const [scene, setScene] = useState<PackSceneAPI | null>(null);
  // The CSS pack is ONLY the true fallback (no WebGL / scene failure / reduced motion) — never a
  // loading stand-in; while the scene loads the stage stays empty and the mesh fades in.
  const [webglFailed, setWebglFailed] = useState(false);
  // The wrapper never teases a card — abstract art generated from the route's motif + color.
  const art = useMemo(() => specialPackArt(routeKey(face.id) ?? face.id, packColor), [face.id, packColor]);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), []);

  // Lazy 3D pack — one mesh, same wrapper printing as a pack round (label + count on the foil).
  useEffect(() => {
    if (reduceMotion) return;
    let cancelled = false;
    (async () => {
      try {
        const { createPackScene } = await import('@/components/brew/packScene');
        const canvas = canvasRef.current;
        if (cancelled) return;
        if (!canvas) { setWebglFailed(true); return; }   // no stage to render into → CSS owns it
        const api = await createPackScene(canvas, [{
          color: packColor,
          artUrl: art,
          label: face.label ?? 'Special',
          featName: undefined,
          count: face.cards.length,
          tease: !!face.windfallTease,
        }]);
        if (cancelled) { api.dispose(); return; }
        sceneRef.current = api;
        setScene(api);
      } catch {
        // No WebGL / load failure → the CSS pack renders instead.
        if (!cancelled) setWebglFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Center the mesh on the (single) DOM zone; re-align on resize.
  useLayoutEffect(() => {
    if (!scene || !canvasRef.current) return;
    const align = () => {
      if (!canvasRef.current) return;
      const box = canvasRef.current.getBoundingClientRect();
      const r = zoneRef.current?.getBoundingClientRect();
      scene.layout([r
        ? { cx: r.left - box.left + r.width / 2, cy: r.top - box.top + r.height / 2 - 16, w: r.width - 10 }
        : { cx: box.width / 2, cy: 380, w: 190 }]);
    };
    align();
    const ro = new ResizeObserver(align);
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  function crack() {
    if (staged || opened) return;
    onCracked?.();
    if (reduceMotion) { setOpened(true); return; }
    setStaged(true);
    if (sceneRef.current) {
      const api = sceneRef.current;
      api.pointer(null);
      api.stage(0);
      timers.current.push(window.setTimeout(() => playPackCrack(TEAR_SEC), STAGE_MS));
      timers.current.push(window.setTimeout(() => {
        void api.burst(0).then(() => {
          setOpened(true);
          timers.current.push(window.setTimeout(() => setSceneGone(true), GHOST_MS));
        });
      }, STAGE_MS));
      return;
    }
    // CSS ceremony: the pack is already centered — it looms in place, then bursts.
    timers.current.push(window.setTimeout(() => playPackCrack(), STAGE_MS - SOUND_LEAD_MS));
    timers.current.push(window.setTimeout(() => { setGhost(true); setOpened(true); }, STAGE_MS));
    timers.current.push(window.setTimeout(() => { setGhost(false); setSceneGone(true); }, STAGE_MS + GHOST_MS));
  }

  const packVars = {
    ['--pk' as string]: `hsl(${packColor})`,
    ['--pk-hsl' as string]: packColor,
    ['--pk-soft' as string]: `hsl(${packColor} / 0.4)`,
    ['--pk-text' as string]: `hsl(${legibleText(packColor)})`,
  };

  // ── The sealed CSS pack: fallback ONLY — reduced motion or WebGL failure, never while loading. ──
  const cssPack = !opened && (reduceMotion || webglFailed) && (
    <div className="flex justify-center">
      <button
        onClick={crack}
        disabled={staged}
        style={{ perspective: '600px', ['--fly-x' as string]: '0px', ['--fly-y' as string]: '0px' }}
        className={`group relative focus:outline-none ${staged ? 'brew-pack-stage' : 'animate-brew-card-in'}`}
      >
        <div
          onPointerMove={staged ? undefined : trackTilt}
          onPointerLeave={staged ? undefined : resetTilt}
          style={packVars}
          className="brew-pack3d relative min-h-[340px] w-[212px] text-left sm:w-[232px]"
        >
          <PackDepth />
          <div className="brew-pack-face relative min-h-[340px] overflow-hidden rounded-lg shadow-[0_16px_40px_-12px_rgba(0,0,0,0.75)] group-focus-visible:ring-2 group-focus-visible:ring-[color:var(--pk)]">
            <div aria-hidden="true" className="brew-pack-crimp absolute inset-x-0 top-0 z-20 h-[18px]" />
            <PackBody option={face} packColor={packColor} artOverride={art} />
          </div>
        </div>
      </button>
    </div>
  );

  // ── CSS burst wrapper: the strip pops and the emptied body tumbles under the content. ──
  const ghostView = ghost && !scene && (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 z-30 w-[280px]"
      style={{ top: 260, transform: 'translate(-50%, -50%)', ...packVars }}
    >
      <div className="brew-pack-strip-off brew-pack-crimp absolute inset-x-0 top-0 z-10 h-[24px] rounded-t-lg" />
      <div className="brew-pack-shed relative mt-[24px] h-[400px] overflow-hidden rounded-b-lg rounded-t-sm shadow-[0_24px_60px_-16px_rgba(0,0,0,0.85)]">
        <PackBody option={face} packColor={packColor} brand={false} artOverride={art} />
      </div>
    </div>
  );

  // ── The 3D stage: mounted from the start (the canvas must exist before the scene loads) and
  //    kept through the burst so the emptied wrapper visibly sheds under the erupting content. ──
  const webglView = !reduceMotion && !webglFailed && !sceneGone && (
    <div className={opened ? 'pointer-events-none absolute inset-x-0 top-0 h-[440px]' : 'relative h-[440px]'}>
      {/* Headroom above/below matches packScene's HEADROOM_PX — see BrewPackCrack. */}
      <canvas
        ref={canvasRef}
        className={`pointer-events-none absolute inset-x-0 -top-[160px] h-[1060px] w-full transition-opacity duration-300 ${scene ? 'opacity-100' : 'opacity-0'}`}
      />
      {!opened && scene && (
        <div className="relative flex h-full items-stretch justify-center py-2">
          <button
            ref={zoneRef}
            onClick={crack}
            disabled={staged}
            onPointerMove={e => {
              if (staged) return;
              const r = e.currentTarget.getBoundingClientRect();
              scene.pointer(0, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
            }}
            onPointerLeave={() => { if (!staged) scene.pointer(null); }}
            aria-label={`${face.label ?? 'Special pack'}, ${face.cards.length} cards — crack it open`}
            className="group relative w-[190px] rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:w-[212px]"
          />
        </div>
      )}
    </div>
  );

  return (
    <div className="relative min-h-[420px]">
      {webglView}
      {cssPack}
      {opened && <div className={reduceMotion ? '' : 'animate-brew-view-in'}>{children}</div>}
      {ghostView}
    </div>
  );
}
