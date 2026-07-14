import { useState, useLayoutEffect, useEffect, useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { getCardImageUrl, getCardPrice } from '@/services/scryfall/client';
import { playPackCrack } from '@/services/brew/brewSound';
import { useBrewSuggest } from '@/services/brew/brewSuggest';
import type { BrewOption, BrewCandidate } from '@/services/brew/engine';
import type { ScryfallCard } from '@/types';
import type { PackSceneAPI } from '@/components/brew/packScene';
import { PACK_FLAVOR, themeColor, legibleText, routeKey, CARD_TYPE_MS } from '@/components/brew/brewVisuals';
import { RoleBadges } from '@/components/brew/RoleBadges';
import { Check, Crown, Link2, Sparkles, Star, Package, Lightbulb, ArrowLeft } from 'lucide-react';

/**
 * The crack-a-pack loop: a pack round offers three SEALED boosters — theme + headline showing,
 * contents hidden. Click one and the ceremony plays in ONE continuous space (no overlay swap):
 * the other two packs FALL away, the chosen pack flies to center and looms closer while you
 * wait… then it CRACKS, Pocket-style — a spark sweeps the seam, the crimp strip rips off and
 * tumbles away, light spills from the open mouth, and the cards SHOOT out of it into the fan
 * while the emptied wrapper sheds underneath. Keep any you like (min 1), pass the rest.
 *
 * Physicality: sealed packs tilt in 3D toward the pointer (spring-simulated — they lag,
 * overshoot, wobble back) with a glare hotspot tracking the cursor. All CSS/DOM, no assets.
 * A windfall rides the fan as a FOIL — the gold/rainbow card is simply *in the pack*.
 */

const COMMIT_MS = 380;    // matches the fly-to-deck / melt-away animations used across brew
const STAGE_MS = 1250;    // fall-away + fly-to-center + the anticipation creep, then the burst
const SOUND_LEAD_MS = 120; // (CSS path) the tear sound starts just before the burst
const GHOST_MS = 950;     // how long the burst wrapper (strip + falling body) stays mounted
const TEAR_SEC = 0.48;    // (3D path) the tear-noise length — matches the scene's TEAR_MS sweep

// --- Spring-driven tilt: the pack has mass. It lags the pointer, overshoots, and wobbles back
//     to rest instead of snapping. Springs run per-element on rAF and write CSS vars directly. ---
const TILT_RANGE = 16;
const SPRING_K = 0.16;
const SPRING_D = 0.78;

// The card-type glyph shown before a fan card's name. A card can wear several types (e.g. "Artifact
// Creature"); we surface the most salient one, and read only the front face of a DFC's type line.
const TYPE_PRIORITY = ['planeswalker', 'creature', 'instant', 'sorcery', 'enchantment', 'artifact', 'battle', 'land'] as const;
function cardTypeGlyph(typeLine: string | undefined): string | null {
  const front = (typeLine ?? '').split('//')[0].toLowerCase();
  for (const t of TYPE_PRIORITY) if (front.includes(t)) return CARD_TYPE_MS[t];
  return null;
}

type Spring = { cur: number; vel: number; target: number };
type TiltState = { rx: Spring; ry: Spring; amt: number; hovered: boolean; raf: number | null };
const tiltStates = new WeakMap<HTMLElement, TiltState>();

// Per-frame engagement rates (~60fps, like the spring constants). Hover on/off is a step
// function — without the ramp, entering from a side edge whips the pack to full side-tilt.
const HOVER_IN = 0.14;
const HOVER_OUT = 0.09;

function tiltStep(el: HTMLElement, s: TiltState): void {
  let live = false;
  for (const sp of [s.rx, s.ry]) {
    sp.vel = sp.vel * SPRING_D + (sp.target - sp.cur) * SPRING_K;
    sp.cur += sp.vel;
    if (Math.abs(sp.vel) > 0.005 || Math.abs(sp.target - sp.cur) > 0.005) live = true;
  }
  const goal = s.hovered ? 1 : 0;
  s.amt += (goal - s.amt) * (s.hovered ? HOVER_IN : HOVER_OUT);
  if (Math.abs(goal - s.amt) > 0.002) live = true;
  el.style.setProperty('--rx', `${(s.rx.cur * s.amt).toFixed(3)}deg`);
  el.style.setProperty('--ry', `${(s.ry.cur * s.amt).toFixed(3)}deg`);
  s.raf = live ? requestAnimationFrame(() => tiltStep(el, s)) : null;
}
function tiltState(el: HTMLElement): TiltState {
  let s = tiltStates.get(el);
  if (!s) {
    s = { rx: { cur: 0, vel: 0, target: 0 }, ry: { cur: 0, vel: 0, target: 0 }, amt: 0, hovered: false, raf: null };
    tiltStates.set(el, s);
  }
  return s;
}
function setTiltTarget(el: HTMLElement, rx: number, ry: number): void {
  const s = tiltState(el);
  s.hovered = true;
  s.rx.target = rx;
  s.ry.target = ry;
  if (s.raf == null) s.raf = requestAnimationFrame(() => tiltStep(el, s));
}

/** Pointer over the pack: glare follows instantly (light is massless); tilt springs after it. */
export function trackTilt(e: ReactPointerEvent<HTMLElement>): void {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  el.style.setProperty('--mx', `${px * 100}%`);
  el.style.setProperty('--my', `${py * 100}%`);
  setTiltTarget(el, (py - 0.5) * -TILT_RANGE, (px - 0.5) * TILT_RANGE);
}
export function resetTilt(e: ReactPointerEvent<HTMLElement>): void {
  const el = e.currentTarget;
  el.style.setProperty('--mx', '50%');
  el.style.setProperty('--my', '50%');
  // Keep the last tilt targets: the engagement fade settles the pack back along its current
  // lean — re-targeting center would spring it back at full stiffness (the old snap).
  const s = tiltState(el);
  s.hovered = false;
  if (s.raf == null) s.raf = requestAnimationFrame(() => tiltStep(el, s));
}

/** The pack's physical depth: back slab + side edges, revealed as the front face tilts. */
export function PackDepth() {
  return (
    <>
      <div aria-hidden="true" className="brew-pack-back absolute inset-0 rounded-lg" />
      <span aria-hidden="true" className="brew-pack-edge brew-pack-edge-l absolute inset-y-1 left-0 w-[10px]" />
      <span aria-hidden="true" className="brew-pack-edge brew-pack-edge-r absolute inset-y-1 right-0 w-[10px]" />
    </>
  );
}

/** The booster wrapper visuals, shared by the sealed grid, the burst ghost, and the special pack.
 *  `artOverride` swaps the featured card's art for generated art (the special packs never tease a card). */
export function PackBody({ option, packColor, brand = true, artOverride }: { option: BrewOption; packColor: string; brand?: boolean; artOverride?: string }) {
  const fl = (option.flavor && PACK_FLAVOR[option.flavor]) || PACK_FLAVOR.value;
  const sigCard = option.cards.find(c => c.name === option.hallmarkName) ?? option.cards[0];
  const packArt = artOverride
    ?? sigCard?.scryfall.image_uris?.art_crop ?? sigCard?.scryfall.card_faces?.[0]?.image_uris?.art_crop;
  const count = option.cards.length + (option.goldCard ? 1 : 0);
  return (
    <>
      <div aria-hidden="true" className="absolute inset-0"
        style={{ background: `linear-gradient(180deg, hsl(${packColor} / 0.55), hsl(${packColor} / 0.28) 18%, hsl(${packColor} / 0.2) 82%, hsl(${packColor} / 0.6))` }} />
      {packArt && (
        <div aria-hidden="true" className="absolute inset-x-0 top-[13%] bottom-[24%]"
          style={{
            backgroundImage: `url(${packArt})`, backgroundSize: 'cover', backgroundPosition: 'center 30%',
            boxShadow: 'inset 0 0 34px rgba(0,0,0,0.55)',
          }} />
      )}
      <div aria-hidden="true" className="absolute inset-0"
        style={{ background: `linear-gradient(180deg, hsl(${packColor} / 0.5) 0%, transparent 20%, transparent 68%, hsl(${packColor} / 0.55) 84%)` }} />
      <div aria-hidden="true" className="brew-pack-foil absolute inset-0" />
      <div aria-hidden="true" className="brew-pack-glare absolute inset-0 z-10" />
      <div aria-hidden="true" className="brew-pack-crimp absolute inset-x-0 bottom-0 h-[18px]" />
      <div className="absolute inset-0 z-10 flex flex-col items-center">
        {brand && (
          <span className="mt-[26px] text-[8px] font-bold uppercase tracking-[0.34em] text-white/75 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            ManaFoundry · Brew
          </span>
        )}
        <div className="flex-1" />
        <div className="mb-[30px] flex w-full flex-col items-center gap-1 px-3">
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-white/25 bg-black/55 px-3 py-1 font-display text-sm font-bold uppercase tracking-wide text-[color:var(--pk-text)] shadow-[0_3px_12px_rgba(0,0,0,0.6)] backdrop-blur-sm">
            <fl.Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{option.label}</span>
          </span>
          {option.hallmarkName && (
            <span className="max-w-full truncate text-[11px] text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
              feat. <span className="font-semibold">{option.hallmarkName}</span>
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.2em] text-white/65 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            <Package className="w-3 h-3" /> {count} cards
          </span>
        </div>
      </div>
    </>
  );
}

export function BrewPackCrack({ onCracked, onBack }: { onCracked?: (cracked: boolean) => void; onBack?: () => void }) {
  const { brewNode, applyBrewOption, customization, setBrewPreview } = useStore();
  // The staged pack (option id): others are falling, this one is flying to center and looming.
  const [staged, setStaged] = useState<string | null>(null);
  // Which pack was cracked — drives the fan phase.
  const [cracked, setCracked] = useState<string | null>(null);
  // The burst wrapper: the strip pops off and the empty pack tumbles away under the shooting cards.
  const [ghost, setGhost] = useState<BrewOption | null>(null);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);
  // Hovering a fan card pops a full, readable preview beside it (mirrors the old pack behavior).
  const [hover, setHover] = useState<{ card: ScryfallCard; rect: DOMRect } | null>(null);
  // Suggestions on/off — the fan highlights the engine's top pick(s) when on. The toggle itself now
  // lives in the HUD (BrewHealthStrip); we just read the shared, persisted value here.
  const [suggestOn] = useBrewSuggest();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  const containerRef = useRef<HTMLDivElement | null>(null);
  const fanRef = useRef<HTMLDivElement | null>(null);
  const packEls = useRef<Map<string, HTMLElement>>(new Map());
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), []);

  // --- The real 3D packs (lazy WebGL; the CSS wrappers below stay as the automatic fallback).
  const [scene, setScene] = useState<PackSceneAPI | null>(null);
  // The CSS packs are ONLY the true fallback (no WebGL / scene failure / reduced motion) — never
  // a loading stand-in. While the 3D scene loads the shelf stays empty, then the meshes fade in;
  // 2D wrappers being covered up by the 3D packs read as a glitch, not a crossfade.
  const [webglFailed, setWebglFailed] = useState(false);
  const sceneRef = useRef<PackSceneAPI | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const zoneEls = useRef<Map<string, HTMLElement>>(new Map());
  const nodeKey = brewNode ? brewNode.routeId + brewNode.options.map(o => o.id).join('|') : '';
  useEffect(() => {
    // Once WebGL has failed, don't retry per round — the CSS fallback owns the session.
    if (reduceMotion || webglFailed || !brewNode || brewNode.options.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const { createPackScene } = await import('@/components/brew/packScene');
        const canvas = canvasRef.current;
        if (cancelled) return;
        if (!canvas) { setWebglFailed(true); return; }   // no stage to render into → CSS owns it
        const specs = brewNode.options.map(o => {
          const fl = (o.flavor && PACK_FLAVOR[o.flavor]) || PACK_FLAVOR.value;
          const sig = o.cards.find(c => c.name === o.hallmarkName) ?? o.cards[0];
          return {
            color: o.flavor === 'theme' ? themeColor(routeKey(o.id) ?? '') : fl.color,
            artUrl: sig?.scryfall.image_uris?.art_crop ?? sig?.scryfall.card_faces?.[0]?.image_uris?.art_crop,
            // The set block is PRINTED on the wrapper — no DOM text ever floats over the mesh.
            label: o.label,
            featName: o.hallmarkName,
            count: o.cards.length + (o.goldCard ? 1 : 0),
            tease: !!o.windfallTease,
          };
        });
        const api = await createPackScene(canvas, specs);
        if (cancelled) { api.dispose(); return; }
        sceneRef.current = api;
        setScene(api);
      } catch {
        // No WebGL / load failure → the CSS packs render instead.
        if (!cancelled) setWebglFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey, reduceMotion, webglFailed]);

  // Align the 3D packs with their DOM label zones (and re-align on resize).
  useLayoutEffect(() => {
    if (!scene || !canvasRef.current || !brewNode) return;
    const align = () => {
      if (!canvasRef.current) return;
      const canvasBox = canvasRef.current.getBoundingClientRect();
      const zones = brewNode.options.map(o => {
        const el = zoneEls.current.get(o.id);
        if (!el) return { cx: canvasBox.width / 2, cy: canvasBox.height / 2, w: 200 };
        const r = el.getBoundingClientRect();
        return { cx: r.left - canvasBox.left + r.width / 2, cy: r.top - canvasBox.top + r.height / 2 - 16, w: r.width - 10 };
      });
      scene.layout(zones);
    };
    align();
    const ro = new ResizeObserver(align);
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  // The shoot-out: once the fan mounts behind a burst, aim every card FROM the pack's mouth
  // TO its own resting slot. With the 3D scene that's literally the torn-open seam (the looming
  // pack's upper region); the CSS path keeps the container center. Measured and written as
  // per-card CSS vars before paint, so the eruption starts exactly inside the pack.
  useLayoutEffect(() => {
    if (!ghost || !fanRef.current || !containerRef.current) return;
    const box = containerRef.current.getBoundingClientRect();
    const originX = box.left + box.width / 2;
    const originY = box.top + (scene ? 100 : Math.min(box.height / 2, 260));
    const cards = fanRef.current.querySelectorAll<HTMLElement>('[data-fan-card]');
    cards.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--fx', `${originX - (r.left + r.width / 2)}px`);
      el.style.setProperty('--fy', `${originY - (r.top + r.height / 2)}px`);
      // Alternating spin so the eruption scatters instead of marching out in a row.
      el.style.setProperty('--fr', `${(i % 2 === 0 ? -1 : 1) * (8 + i * 4)}deg`);
    });
  }, [ghost]);

  // Publish the "what if I keep these?" preview to the deck-stats charts: your kept selection plus
  // the card under the cursor. The charts draw it as a dashed projection. Cleared while committing
  // (the real bars are about to update) and on unmount.
  useEffect(() => {
    const co = cracked ? brewNode?.options.find(o => o.id === cracked) ?? null : null;
    if (!co || committing) { setBrewPreview(null); return; }
    const fan: BrewCandidate[] = [...co.cards, ...(co.goldCard ? [co.goldCard] : [])];
    const hoveredName = hover?.card.name;
    const cards = fan.filter(c => keep.has(c.name) || c.name === hoveredName);
    const packSlug = co.id.startsWith('theme:') ? co.id.slice('theme:'.length) : undefined;
    setBrewPreview(cards.length > 0 ? { cards, packSlug } : null);
  }, [cracked, keep, hover, committing, brewNode, setBrewPreview]);
  useEffect(() => () => setBrewPreview(null), [setBrewPreview]);

  if (!brewNode) return null;
  const options = brewNode.options;
  const crackedOption = cracked ? options.find(o => o.id === cracked) ?? null : null;

  function pick(option: BrewOption) {
    if (committing || cracked || staged) return;
    onCracked?.(true);   // the pick is the commitment — the parent hides Back/reroll
    setKeep(option.goldCard ? new Set([option.goldCard.name]) : new Set());
    if (reduceMotion) { setCracked(option.id); return; }
    if (scene && brewNode) {
      // 3D ceremony: the scene owns the fall / fly / loom / crack (tear sweep → strip pop →
      // mouth open); DOM handles the card eruption. burst() resolves at MOUTH-OPEN — that's the
      // cue to mount the fan, so the cards erupt the moment the wrapper is actually open. The
      // tear sound starts with the visible tear; its pop lands on the strip's release.
      const idx = brewNode.options.findIndex(o => o.id === option.id);
      scene.pointer(null);
      scene.stage(idx);
      setStaged(option.id);
      timers.current.push(window.setTimeout(() => playPackCrack(TEAR_SEC), STAGE_MS));
      timers.current.push(window.setTimeout(() => {
        void scene.burst(idx).then(() => {
          setGhost(option);
          setCracked(option.id);
          setStaged(null);
          timers.current.push(window.setTimeout(() => setGhost(null), GHOST_MS));
        });
      }, STAGE_MS));
      return;
    }
    // CSS ceremony (no WebGL): FLIP the chosen pack to the container center via keyframes while
    // the others drop off the bottom of the screen.
    const el = packEls.current.get(option.id);
    const box = containerRef.current?.getBoundingClientRect();
    if (el && box) {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--fly-x', `${box.left + box.width / 2 - (r.left + r.width / 2)}px`);
      el.style.setProperty('--fly-y', `${box.top + Math.min(box.height / 2, 260) - (r.top + r.height / 2)}px`);
    }
    setStaged(option.id);
    timers.current.push(window.setTimeout(() => playPackCrack(), STAGE_MS - SOUND_LEAD_MS));
    timers.current.push(window.setTimeout(() => {
      setGhost(option);          // the wrapper bursts…
      setCracked(option.id);     // …and the fan mounts underneath, cards shooting out of it
      setStaged(null);
    }, STAGE_MS));
    timers.current.push(window.setTimeout(() => setGhost(null), STAGE_MS + GHOST_MS));
  }

  function toggleKeep(name: string) {
    if (committing) return;
    setKeep(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  // Lock in the kept cards as one decision. The synthetic option keeps the pack's identity
  // (id/label/flavor/engineScore → affinity, Rival, and pack-window bookkeeping all still work);
  // a kept foil stays on `goldCard` so the store's windfall moment + Treasury hook fire as before.
  function commitKeeps(option: BrewOption) {
    if (committing || keep.size === 0) return;
    setCommitting(true);
    const keptRegular = option.cards.filter(c => keep.has(c.name));
    const reasons = keptRegular.map(c => option.reasons[option.cards.findIndex(x => x.name === c.name)] ?? []);
    const foilKept = !!option.goldCard && keep.has(option.goldCard.name);
    const synthetic: BrewOption = {
      ...option,
      cards: keptRegular,
      reasons,
      goldCard: foilKept ? option.goldCard : undefined,
      windfallTier: foilKept ? option.windfallTier : undefined,
      windfallTease: undefined,
      wagerTrade: undefined,
      cardScores: undefined,   // aligned to the ORIGINAL cards — stale once we filtered them
    };
    const allNames = options.flatMap(o => [...o.cards.map(c => c.name), ...(o.goldCard ? [o.goldCard.name] : [])]);
    const passed = allNames.filter(n => !keep.has(n));
    window.setTimeout(() => applyBrewOption(synthetic, passed), COMMIT_MS);
  }

  // ── The fan: the cracked pack's cards, freshly erupted; keep what you like. ──
  const fanView = crackedOption && (() => {
    const fl = (crackedOption.flavor && PACK_FLAVOR[crackedOption.flavor]) || PACK_FLAVOR.value;
    const packColor = crackedOption.flavor === 'theme' ? themeColor(routeKey(crackedOption.id) ?? '') : fl.color;
    const foil = crackedOption.goldCard;
    const fan: { card: BrewCandidate; isFoil: boolean }[] = [
      ...crackedOption.cards.map(card => ({ card, isFoil: false })),
      ...(foil ? [{ card: foil, isFoil: true }] : []),
    ];
    const isRainbow = crackedOption.windfallTier === 'rainbow';
    // The suggested take(s): the engine's top-scored card or two (the same offerScores behind
    // engineScore — relevancy to YOUR build, not raw popularity). The foil rides its own rail.
    const suggested = new Set<string>();
    if (suggestOn && crackedOption.cardScores?.length) {
      crackedOption.cards
        .map((c, i) => ({ name: c.name, score: crackedOption.cardScores?.[i] ?? 0 }))
        .sort((a, b) => b.score - a.score)
        .slice(0, crackedOption.cards.length >= 4 ? 2 : 1)
        .forEach(r => suggested.add(r.name));
    }
    const currencySymbol = customization.currency === 'EUR' ? '€' : '$';
    return (
      <div ref={fanRef} className="relative z-10 text-center" style={{ ['--pk' as string]: `hsl(${packColor})`, ['--pk-text' as string]: `hsl(${legibleText(packColor)})` }}>
        <div className={`mb-5 inline-flex items-center gap-2 font-display text-lg font-semibold text-[color:var(--pk-text)] ${ghost ? 'animate-fade-in' : ''}`}>
          <fl.Icon className="w-4 h-4" /> {crackedOption.label}
        </div>
        <div className="flex flex-wrap items-start justify-center gap-3 sm:gap-4">
          {fan.map(({ card, isFoil }, i) => {
            const kept = keep.has(card.name);
            const priceNum = Number(getCardPrice(card.scryfall, customization.currency) ?? NaN);
            const typeGlyph = cardTypeGlyph(card.scryfall.type_line);
            // The fan's reasons align with crackedOption.cards; the foil rides at the end with none.
            const cardReasons = isFoil ? [] : (crackedOption.reasons[i] ?? []);
            const isGameChanger = cardReasons.some(r => r.kind === 'gameChanger');
            const comboReason = cardReasons.find(r => r.kind === 'comboPiece');
            // The flagship "why this answer": a functional card tuned to your leaning theme (a wipe
            // that spares your tribe, on-theme ramp/draw). Lavender = the synergy/relevancy accent.
            const synergyReason = cardReasons.find(r => r.kind === 'synergy');
            // The wrapper promised "feat. <card>" — once the pack is open, point at that card.
            const isHallmark = !isFoil && card.name === crackedOption.hallmarkName;
            const isSuggested = !isFoil && suggested.has(card.name);
            // The surprise bonus card: a warm glow ring + a sunburst behind it (below). Not "foil" —
            // it's a free extra card, so it reads as a reward, not a print treatment.
            const bonusRing = isRainbow
              ? 'ring-2 ring-fuchsia-300/80 shadow-[0_0_26px_-4px_rgba(232,121,249,0.7),0_6px_18px_rgba(0,0,0,0.55)]'
              : 'ring-2 ring-amber-300/80 shadow-[0_0_26px_-4px_rgba(251,191,36,0.7),0_6px_18px_rgba(0,0,0,0.55)]';
            return (
              <button
                key={card.name}
                data-fan-card
                onClick={() => toggleKeep(card.name)}
                onMouseEnter={(e: ReactMouseEvent<HTMLElement>) => setHover({ card: card.scryfall, rect: e.currentTarget.getBoundingClientRect() })}
                onMouseLeave={() => setHover(null)}
                disabled={committing}
                aria-pressed={kept}
                style={committing ? undefined : { animationDelay: `${120 + i * 65}ms` }}
                className={`relative w-[172px] sm:w-[200px] rounded-[4.8%] transition-transform duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pk)] ${
                  committing
                    ? (kept ? 'animate-brew-to-deck' : 'animate-brew-dismiss')
                    : ghost ? 'brew-card-shoot'
                    : kept ? '-translate-y-2' : ''
                }`}
              >
                {isFoil && (
                  <span
                    aria-hidden="true"
                    className={`brew-bonus-burst pointer-events-none absolute left-1/2 top-[42%] ${isRainbow ? 'brew-bonus-burst--rainbow' : ''}`}
                    style={{ ['--burst' as string]: isRainbow ? '292 80% 62%' : '43 96% 56%' }}
                  />
                )}
                {isFoil && (
                  <span className={`absolute -top-2.5 left-1/2 z-20 -translate-x-1/2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide backdrop-blur-sm ${
                    isRainbow
                      ? 'border-fuchsia-300/80 bg-[#160a2a]/90 text-fuchsia-100'
                      : 'border-amber-300/80 bg-[#241803]/90 text-amber-100'
                  }`}>
                    {isRainbow ? <Sparkles className="w-3 h-3" /> : <Crown className="w-3 h-3" />}
                    {isRainbow ? 'Rare Bonus' : 'Bonus'}
                  </span>
                )}
                {/* One badge per card: the actionable "Suggested" wins over the informational
                    "Signature" when the hallmark is also the engine's top pick. */}
                {isSuggested ? (
                  <span className="absolute -top-2.5 left-1/2 z-20 -translate-x-1/2 inline-flex items-center gap-1 rounded-full border border-violet-300/80 bg-[#150a2e]/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-100 backdrop-blur-sm">
                    <Lightbulb className="w-3 h-3" />
                    Suggested
                  </span>
                ) : isHallmark && (
                  <span className="absolute -top-2.5 left-1/2 z-20 -translate-x-1/2 inline-flex items-center gap-1 rounded-full border border-violet-300/80 bg-[#150a2e]/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-100 backdrop-blur-sm">
                    <Star className="w-3 h-3" />
                    Signature
                  </span>
                )}
                {kept && (
                  <span className="absolute top-1.5 right-1.5 z-20 grid place-items-center w-5 h-5 rounded-full bg-emerald-500 text-white shadow ring-1 ring-black/40">
                    <Check className="w-3.5 h-3.5" />
                  </span>
                )}
                <img
                  src={getCardImageUrl(card.scryfall, 'normal')}
                  alt={card.name}
                  className={`block w-full h-auto rounded-[4.8%] transition-[box-shadow,opacity,transform] duration-150 ${
                    isFoil ? bonusRing
                      : kept ? 'ring-2 ring-emerald-400/90 shadow-[0_0_20px_-4px_rgba(52,211,153,0.6),0_6px_18px_rgba(0,0,0,0.55)]'
                      : isSuggested ? 'ring-2 ring-violet-300/75 shadow-[0_0_20px_-4px_rgba(196,181,253,0.55),0_6px_18px_rgba(0,0,0,0.55)]'
                      : 'ring-1 ring-black/60 shadow-[0_6px_18px_rgba(0,0,0,0.55)] opacity-90 hover:opacity-100'
                  } ${kept ? '' : 'hover:ring-2 hover:ring-[color:var(--pk)]'}`}
                />
                {/* Caption: type glyph + name, the price, then a wrapping row of detail chips
                    (each role named as specifically as we can — "Counterspell", not "Protection"). */}
                <span className="mt-1.5 flex w-full items-center justify-center gap-1 text-[11px] font-semibold leading-tight text-foreground/90">
                  {typeGlyph && <i aria-hidden className={`ms ${typeGlyph} shrink-0 text-[12px] leading-none text-muted-foreground`} />}
                  <span className="min-w-0 truncate">{card.name}</span>
                </span>
                <span className="mt-0.5 block text-[10px] font-bold tabular-nums text-muted-foreground">
                  {Number.isFinite(priceNum) ? `${currencySymbol}${priceNum.toFixed(2)}` : '—'}
                </span>
                <span className="mt-1 flex min-h-[16px] flex-wrap items-center justify-center gap-1">
                  <RoleBadges cardName={card.name} corner="inline" withLabels />
                  {synergyReason && (
                    <span
                      title={synergyReason.label}
                      className="inline-flex items-center gap-1 rounded-full bg-[#150a2e]/85 px-1.5 py-0.5 text-[9px] font-semibold text-violet-200 shadow ring-1 ring-inset ring-violet-400/60"
                    >
                      {synergyReason.label}
                    </span>
                  )}
                  {comboReason && (
                    <span
                      title={comboReason.label}
                      className="inline-flex items-center gap-1 rounded-full bg-[#0b0b10]/85 px-1.5 py-0.5 text-[9px] font-semibold text-teal-300 shadow ring-1 ring-inset ring-teal-400/60"
                    >
                      <Link2 className="w-2.5 h-2.5 shrink-0" strokeWidth={2.25} />
                      Combo
                    </span>
                  )}
                  {isGameChanger && (
                    <span title="Game Changer" className="inline-flex items-center gap-1 rounded-full bg-amber-400/90 px-1.5 py-0.5 text-[9px] font-bold text-black shadow ring-1 ring-black/40">
                      <Crown className="w-2.5 h-2.5 shrink-0" />
                      Game Changer
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <div className={`mt-6 ${ghost ? 'animate-fade-in' : ''}`}>
          <Button size="lg" className="btn-shimmer" disabled={keep.size === 0 || committing} onClick={() => commitKeeps(crackedOption)}>
            {keep.size === 0 ? 'Keep at least 1 card'
              : keep.size === fan.length ? `Keep all ${fan.length}`
              : `Keep ${keep.size} · pass ${fan.length - keep.size}`}
          </Button>
        </div>
      </div>
    );
  })();

  // ── The hover preview: a full, readable copy of the fan card, anchored beside it. ──
  const hoverView = hover && !committing && (() => {
    const W = 268, IMG_H = Math.round(W * 1.4), GAP = 14, PAD = 8;
    const r = hover.rect;
    const vw = window.innerWidth, vh = window.innerHeight;
    // Prefer the card's right side; flip left near the edge; clamp vertically to the viewport.
    const left = r.right + GAP + W <= vw - PAD ? r.right + GAP : Math.max(PAD, r.left - GAP - W);
    const top = Math.min(Math.max(PAD, r.top + r.height / 2 - IMG_H / 2), vh - IMG_H - PAD - 40);
    const priceRaw = getCardPrice(hover.card, customization.currency);
    const n = priceRaw != null ? Number(priceRaw) : NaN;
    const sym = customization.currency === 'EUR' ? '€' : '$';
    return createPortal(
      <div className="pointer-events-none fixed z-[120] flex flex-col items-center gap-1.5 animate-fade-in" style={{ left, top, width: W }}>
        <img src={getCardImageUrl(hover.card, 'normal')} alt={hover.card.name} className="w-full rounded-[4.8%] shadow-2xl ring-1 ring-black/70" />
        <span className="rounded-md border border-border/70 bg-black/80 px-2.5 py-0.5 text-sm font-bold tabular-nums text-foreground/90 shadow-lg">
          {Number.isFinite(n) ? `${sym}${n.toFixed(2)}` : 'No price'}
        </span>
      </div>,
      document.body,
    );
  })();

  // ── The burst ghost: the emptied wrapper at center — strip pops off, body tumbles away.
  //    (CSS fallback only: with WebGL the scene's own pack tumbles instead.) ──
  const ghostView = ghost && !scene && (() => {
    const fl = (ghost.flavor && PACK_FLAVOR[ghost.flavor]) || PACK_FLAVOR.value;
    const packColor = ghost.flavor === 'theme' ? themeColor(routeKey(ghost.id) ?? '') : fl.color;
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 z-30 w-[280px]"
        style={{
          top: 260, transform: 'translate(-50%, -50%)',
          ['--pk' as string]: `hsl(${packColor})`,
          ['--pk-hsl' as string]: packColor,
          ['--pk-text' as string]: `hsl(${legibleText(packColor)})`,
        }}
      >
        <div className="brew-pack-strip-off brew-pack-crimp absolute inset-x-0 top-0 z-10 h-[24px] rounded-t-lg" />
        <div className="brew-pack-shed relative mt-[24px] h-[400px] overflow-hidden rounded-b-lg rounded-t-sm shadow-[0_24px_60px_-16px_rgba(0,0,0,0.85)]">
          <PackBody option={ghost} packColor={packColor} brand={false} />
        </div>
      </div>
    );
  })();

  // ── Sealed grid: three foil boosters that tilt and glare toward the pointer. ──
  const gridView = !crackedOption && (
    <div className="flex flex-wrap items-stretch justify-center gap-6 sm:gap-9">
      {options.map((option, idx) => {
        const fl = (option.flavor && PACK_FLAVOR[option.flavor]) || PACK_FLAVOR.value;
        const packColor = option.flavor === 'theme' ? themeColor(routeKey(option.id) ?? '') : fl.color;
        const isStaged = staged === option.id;
        const falling = staged !== null && !isStaged;
        return (
          <button
            key={option.id}
            ref={el => { if (el) packEls.current.set(option.id, el); else packEls.current.delete(option.id); }}
            onClick={() => pick(option)}
            disabled={committing || !!cracked || !!staged}
            style={{
              perspective: '600px',
              // The two unpicked packs drop off-screen, tumbling away from the chosen one.
              ...(falling ? { ['--fall-rot' as string]: `${idx % 2 === 0 ? -16 : 16}deg`, ['--fall-delay' as string]: `${idx * 40}ms` } : {}),
            }}
            className={`group relative focus:outline-none ${
              isStaged ? 'brew-pack-stage' : falling ? 'brew-pack-fall' : 'animate-brew-card-in'
            }`}
          >
            <div
              onPointerMove={staged ? undefined : trackTilt}
              onPointerLeave={staged ? undefined : resetTilt}
              style={{
                ['--pk' as string]: `hsl(${packColor})`,
                ['--pk-hsl' as string]: packColor,
                ['--pk-soft' as string]: `hsl(${packColor} / 0.4)`,
                ['--pk-text' as string]: `hsl(${legibleText(packColor)})`,
                ...(staged ? {} : { animationDelay: `${idx * 70}ms` }),
              }}
              className="brew-pack3d relative min-h-[340px] w-[212px] text-left sm:w-[232px]"
            >
              <PackDepth />
              <div className={`brew-pack-face relative min-h-[340px] overflow-hidden rounded-lg shadow-[0_16px_40px_-12px_rgba(0,0,0,0.75)] group-focus-visible:ring-2 group-focus-visible:ring-[color:var(--pk)] ${
                brewNode.godPack ? 'brew-godpack-glow' : ''
              }`}>
                <div aria-hidden="true" className="brew-pack-crimp absolute inset-x-0 top-0 z-20 h-[18px]" />
                <PackBody option={option} packColor={packColor} />
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );

  // ── The 3D stage: real booster meshes aligned under DOM label zones. Stays mounted through
  //    the burst (the emptied wrapper tumbles in-scene, under the erupting DOM cards). ──
  const webglView = !reduceMotion && !webglFailed && (!crackedOption || ghost) && (
    <div
      className={crackedOption
        ? 'pointer-events-none absolute inset-x-0 top-0 h-[440px]'
        // The new round is DEALT to you: once the scene is ready, the whole shelf (canvas +
        // zones together, so mesh↔zone alignment holds) slides up from the table edge.
        : `relative h-[440px] ${scene ? 'animate-brew-shelf-in' : ''}`}
    >
      {/* The canvas overshoots 160px ABOVE the shelf (headroom for the looming pack's crimp and
          the popped tear strip — keep in step with packScene's HEADROOM_PX) and far below it so
          falling/tumbling packs exit the screen instead of clipping at an invisible edge. It
          never takes pointer events (the zone buttons do), and it fades in over the CSS packs
          once the scene is ready. */}
      <canvas
        ref={canvasRef}
        className={`pointer-events-none absolute inset-x-0 -top-[160px] h-[1060px] w-full transition-opacity duration-300 ${scene ? 'opacity-100' : 'opacity-0'}`}
      />
      {!crackedOption && scene && (
        <div className="relative flex h-full items-stretch justify-center gap-6 py-2 sm:gap-9">
          {options.map((option, idx) => {
            const count = option.cards.length + (option.goldCard ? 1 : 0);
            return (
              <button
                key={option.id}
                ref={el => { if (el) zoneEls.current.set(option.id, el); else zoneEls.current.delete(option.id); }}
                onClick={() => pick(option)}
                disabled={committing || !!cracked || !!staged}
                onPointerMove={e => {
                  if (staged) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  scene.pointer(idx, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
                }}
                onPointerLeave={() => { if (!staged) scene.pointer(null); }}
                // The set block (label / feat. / count / tease) is PRINTED on the wrapper
                // texture — nothing floats over the mesh, so the zone button is invisible and
                // needs its accessible name spelled out.
                aria-label={`${option.label}${option.hallmarkName ? ` — feat. ${option.hallmarkName}` : ''}, ${count} cards`}
                className="group relative w-[190px] rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:w-[212px]"
              />
            );
          })}
        </div>
      )}
    </div>
  );

  // One continuous stage for all three beats — nothing fades in over anything else.
  return (
    <div ref={containerRef} className="relative min-h-[420px]">
      {/* A quiet way out once a pack is open: no store mutation has happened yet (that waits for
          commit), so this just re-seals the shelf to crack a different pack. Deliberately understated
          — the crack is still meant to feel like the commitment. */}
      {crackedOption && !committing && onBack && (
        <button
          onClick={() => onBack()}
          className="absolute -top-7 left-0 z-30 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60 transition-colors hover:text-foreground/80"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
      )}
      {webglView}
      {/* The CSS packs render ONLY when 3D genuinely can't (reduced motion / no WebGL / scene
          failure) — never as a loading stand-in. While the scene loads, the shelf stays empty
          and the meshes fade in on their own. */}
      {(reduceMotion || webglFailed) && <div>{gridView}</div>}
      {fanView}
      {ghostView}
      {hoverView}
    </div>
  );
}
